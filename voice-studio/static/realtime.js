/* Full-duplex realtime voice client.
 *
 * Replaces the v48 record -> upload -> wait -> play loop. The three things that
 * actually made v48 feel slow, and what happens here instead:
 *
 *   1. v48 re-uploaded the ENTIRE utterance every 700 ms, so cost grew with the
 *      square of turn length and the last second of a long sentence was the
 *      slowest. Here audio streams out continuously as 20 ms PCM frames and the
 *      server keeps a bounded recognition window.
 *
 *   2. v48 waited for a whole audio blob per sentence before playing anything.
 *      Here audio chunks are scheduled on the Web Audio clock as they arrive,
 *      so speech starts on the first clause and continues gaplessly.
 *
 *   3. v48 hard-ignored the microphone while speaking, so you could not
 *      interrupt it. Here capture never stops, and interrupting is a first
 *      class action.
 *
 * Usage:
 *   const rt = new RealtimeVoice({ onEvent: e => ... });
 *   await rt.start();
 *   rt.stop();
 */
(function (global) {
  "use strict";

  const SAMPLE_RATE = 16000;

  // Consecutive voiced frames (20 ms each) required to call it real speech.
  // A single frame is far too twitchy - a door closing or a keyboard clack
  // clears an energy threshold easily. Requiring a run means it has to look
  // like sustained voicing.
  const SPEECH_FRAMES = 3;

  // Longer run required to interrupt the agent, because the cost of being
  // wrong is asymmetric: a missed barge-in is mildly annoying, but a FALSE
  // barge-in cuts the agent off mid-word for nothing and is much worse.
  const BARGE_FRAMES = 8;

  function now() { return (global.performance || Date).now(); }

  class RealtimeVoice {
    constructor(opts) {
      opts = opts || {};
      this.onEvent = opts.onEvent || function () {};
      this.url = opts.url || null;
      this.params = opts.params || {};
      this.autoReconnect = opts.autoReconnect !== false;

      this.ws = null;
      this.ctx = null;
      this.playCtx = null;
      this.node = null;
      this.stream = null;
      this.source = null;

      this.running = false;
      this.agentSpeaking = false;
      this.voicedRun = 0;
      this.silentRun = 0;
      this.bargeSent = false;

      // v52. Monotonic playback generation.
      //
      // THE BUG THIS KILLS - and it is the reason the call was "fully broken":
      // v49-v51 used the sticky `bargeSent` flag to decide whether an arriving
      // audio chunk was stale. But `bargeSent` was only ever cleared inside
      // `src.onended`, and `_stopPlayback()` deliberately sets `onended = null`
      // before stopping every source - so after ONE barge-in, ONE mute, or ONE
      // Stop press, `onended` never fired again and `bargeSent` stayed true for
      // the rest of the call. Every subsequent chunk hit the
      // `if (this.bargeSent) return;` guard and was silently discarded. The
      // socket stayed open, the transcript kept scrolling, the server kept
      // synthesising - and the agent never made another sound. Exactly one
      // interruption killed the call, permanently and invisibly.
      //
      // A generation counter is the correct primitive: "discard audio that was
      // synthesised before the last interruption" is a statement about
      // ORDERING, not a boolean state, so it cannot get stuck.
      this.epoch = 0;

      // Playback scheduling state.
      this.playHead = 0;
      this.queued = [];
      this.pendingSpeak = null;
      this.gain = null;

      this._retry = 0;
      this._closing = false;
      this._prosodyTimer = null;
      this._recent = [];
    }

    // -- transport --------------------------------------------------------
    _wsUrl() {
      if (this.url) return this.url;
      const proto = global.location.protocol === "https:" ? "wss:" : "ws:";
      const qs = new URLSearchParams();
      Object.keys(this.params).forEach((k) => {
        const v = this.params[k];
        if (v !== null && v !== undefined && v !== "") qs.set(k, v);
      });
      const q = qs.toString();
      return proto + "//" + global.location.host + "/ws/voice" + (q ? "?" + q : "");
    }

    _connect() {
      return new Promise((resolve, reject) => {
        let ws;
        try {
          ws = new WebSocket(this._wsUrl());
        } catch (err) {
          reject(err);
          return;
        }
        ws.binaryType = "arraybuffer";
        this.ws = ws;

        ws.onopen = () => {
          this._retry = 0;
          this._send({ t: "start" });
          this.onEvent({ type: "open" });
          resolve();
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            this._onControl(msg);
          } else {
            this._onAudio(ev.data);
          }
        };

        ws.onerror = () => { /* surfaced by onclose */ };

        ws.onclose = (ev) => {
          this.onEvent({ type: "close", code: ev.code });
          this.ws = null;
          if (ev.code === 4401) {
            this.onEvent({ type: "error", error: "unauthorized" });
            this.stop();
            return;
          }
          if (this.running && this.autoReconnect && !this._closing) {
            // Exponential backoff, capped. A tight reconnect loop against a
            // server that is down is a self-inflicted denial of service.
            const delay = Math.min(8000, 400 * Math.pow(2, this._retry++));
            setTimeout(() => { if (this.running) this._connect().catch(() => {}); }, delay);
          }
        };
      });
    }

    _send(obj) {
      const ws = this.ws;
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(obj)); } catch (e) { /* closing */ }
      }
    }

    _sendPcm(buf) {
      const ws = this.ws;
      if (ws && ws.readyState === 1) {
        try { ws.send(buf); } catch (e) { /* closing */ }
      }
    }

    // -- capture ----------------------------------------------------------
    async start() {
      if (this.running) return;
      this.running = true;
      this._closing = false;

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Browser AEC is what makes open-mic barge-in viable at all: without
          // it the agent's own voice comes back through the mic and it
          // interrupts itself constantly.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      const AC = global.AudioContext || global.webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state === "suspended") await this.ctx.resume();

      await this.ctx.audioWorklet.addModule("/capture-worklet.js");

      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, "capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { targetRate: SAMPLE_RATE },
      });
      this.node.port.onmessage = (e) => this._onFrame(e.data);
      this.source.connect(this.node);

      // A SEPARATE context for playback. Sharing one context means a glitch or
      // a suspend on the render thread stalls capture and playback together.
      this.playCtx = new AC();
      if (this.playCtx.state === "suspended") await this.playCtx.resume();
      this.gain = this.playCtx.createGain();
      this.gain.connect(this.playCtx.destination);
      this.playHead = this.playCtx.currentTime;

      await this._connect();
      this._startProsody();
      this.onEvent({ type: "listening" });
    }

    _onFrame(d) {
      if (!d || d.type !== "pcm") return;

      if (d.voiced) { this.voicedRun++; this.silentRun = 0; }
      else { this.silentRun++; if (this.silentRun > 2) this.voicedRun = 0; }

      // Keep a short rolling history for prosody.
      this._recent.push({ rms: d.rms, zcr: d.zcr, voiced: d.voiced, t: now() });
      if (this._recent.length > 60) this._recent.shift();

      if (this.agentSpeaking && !this.bargeSent && this.voicedRun >= BARGE_FRAMES) {
        this.bargeSent = true;
        this._send({ t: "barge" });
        this._stopPlayback();
        this.onEvent({ type: "barge" });
      }

      // Report end-of-speech to the server explicitly. The server has its own
      // energy VAD, but the browser sees the pre-resample signal with hardware
      // AEC applied, so its silence measurement is both earlier and cleaner.
      // Endpointing on the better of the two signals is free latency.
      if (!this.agentSpeaking && this.silentRun === 4 && this._everVoiced) {
        this._send({ t: "eos", silence_ms: this.silentRun * 20 });
      }
      if (d.voiced) this._everVoiced = true;

      if (!this.agentSpeaking && this.voicedRun === SPEECH_FRAMES) {
        this.onEvent({ type: "speech" });
      }

      this._sendPcm(d.pcm);
    }

    _startProsody() {
      if (this._prosodyTimer) clearInterval(this._prosodyTimer);
      // Prosody is advisory. The server decides turn-taking on its own audio
      // clock and treats a missing prosody hint as "no information", so
      // dropping these packets degrades timing slightly rather than breaking
      // anything.
      this._prosodyTimer = setInterval(() => {
        const r = this._recent;
        if (r.length < 8) return;
        const tail = r.slice(-8);
        const head = r.slice(-24, -8);
        if (!head.length) return;

        const avg = (a) => a.reduce((s, x) => s + x.rms, 0) / Math.max(1, a.length);
        const tailE = avg(tail);
        const headE = avg(head);

        // ZCR is a cheap stand-in for pitch direction: as voiced pitch falls at
        // the end of a statement, the zero-crossing rate falls with it. It is
        // not a pitch tracker, but it is free and directionally right.
        const zc = (a) => a.reduce((s, x) => s + x.zcr, 0) / Math.max(1, a.length);
        const slope = (zc(tail) - zc(head)) * 100;

        this._send({
          t: "prosody",
          f0_slope: slope,
          energy_ratio: headE > 0 ? tailE / headE : 1.0,
          final_lengthening: 1.0,
          voiced: tail.some((x) => x.voiced),
        });
      }, 200);
    }

    // -- playback ---------------------------------------------------------
    _onControl(msg) {
      switch (msg.t) {
        case "speak":
          // The audio frame for this arrives next. The server holds a lock
          // across both sends so they cannot interleave with another turn.
          this.pendingSpeak = msg;
          break;
        case "eot":
          this.onEvent({ type: "eot", data: msg });
          break;
        case "partial":
          this.onEvent({ type: "partial", text: msg.text || "", data: msg });
          break;
        case "final":
          this.onEvent({ type: "final", text: msg.text || "", data: msg });
          break;
        case "token":
          this.onEvent({ type: "token", text: msg.text || "", data: msg });
          break;
        case "interrupt":
          this._stopPlayback();
          this.onEvent({ type: "interrupt", data: msg });
          break;
        case "done":
          this.onEvent({ type: "done", data: msg });
          break;
        case "error":
          this.onEvent({ type: "error", error: msg.error, data: msg });
          break;
        default:
          this.onEvent({ type: msg.t, data: msg });
      }
    }

    async _onAudio(buf) {
      const meta = this.pendingSpeak;
      this.pendingSpeak = null;
      if (!this.playCtx || !buf || !buf.byteLength) return;

      // Capture the generation BEFORE the await. decodeAudioData is async, so
      // an interruption can land while we are decoding.
      const epoch = this.epoch;

      let audio;
      try {
        audio = await this.playCtx.decodeAudioData(buf.slice(0));
      } catch (e) {
        this.onEvent({ type: "error", error: "decode failed" });
        return;
      }
      // Stale only if an interruption happened while we were decoding. Once the
      // generation matches again, audio flows normally - which is what the old
      // sticky `bargeSent` guard could never do.
      if (epoch !== this.epoch || !this.running) return;

      const src = this.playCtx.createBufferSource();
      src.buffer = audio;
      src.connect(this.gain);

      // Gapless scheduling: each chunk starts exactly where the previous one
      // ends, on the audio clock. Chaining via onended instead would insert a
      // main-thread round trip between every chunk and produce audible seams.
      const t = this.playCtx.currentTime;

      // v52 HUMAN PACING. The server tells us how long a silence belongs in
      // FRONT of this clause (`pause_ms`), because pausing is a property of the
      // sentence, not of the audio file. Baking the silence into the WAV would
      // waste synthesis time generating nothing and would make the pause
      // uninterruptible; scheduling it on the audio clock costs nothing and a
      // barge-in during the pause cancels it instantly.
      //
      // Perfectly gapless delivery was itself a realism bug: humans do not
      // machine-gun clauses together, and zero-gap speech is one of the
      // strongest "this is a robot" cues there is.
      let gap = 0;
      if (meta && meta.pause_ms) {
        gap = Math.max(0, Math.min(1500, +meta.pause_ms || 0)) / 1000;
      }

      // Jitter buffer. Starting the very first clause a few tens of ms in the
      // future means a late-arriving second chunk does not cause a gap in the
      // middle of a word. 60ms is inaudible as delay and removes the most
      // common stutter on a loaded CPU.
      const lead = this.agentSpeaking ? 0.02 : 0.06;
      if (this.playHead < t) this.playHead = t + lead;
      this.playHead += gap;
      src.start(this.playHead);
      this.playHead += audio.duration;

      this.queued.push(src);
      src.onended = () => {
        const i = this.queued.indexOf(src);
        if (i >= 0) this.queued.splice(i, 1);
        if (!this.queued.length) {
          this.agentSpeaking = false;
          this.bargeSent = false;
          this.onEvent({ type: "speaking", value: false });
        }
      };

      if (!this.agentSpeaking) {
        this.agentSpeaking = true;
        this.onEvent({ type: "speaking", value: true, meta: meta });
      }
    }

    _stopPlayback() {
      // Invalidate everything already in flight. Must happen FIRST: a chunk
      // that finishes decoding during this function must be dropped.
      this.epoch++;

      // Ramp the gain down over 15ms instead of cutting the waveform dead. A
      // hard stop mid-vowel is a click, and a click on every interruption is
      // both unpleasant and reads as a fault.
      if (this.gain && this.playCtx) {
        try {
          const g = this.gain.gain;
          const t = this.playCtx.currentTime;
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t);
          g.linearRampToValueAtTime(0.0001, t + 0.015);
          g.setValueAtTime(1.0, t + 0.02);
        } catch (e) { /* older browsers: fall through to the hard stop */ }
      }

      this.queued.forEach((s) => {
        try { s.onended = null; s.stop(this.playCtx ? this.playCtx.currentTime + 0.02 : 0); }
        catch (e) { try { s.stop(); } catch (e2) { /* already ended */ } }
      });
      this.queued = [];
      if (this.playCtx) this.playHead = this.playCtx.currentTime;
      this.agentSpeaking = false;

      // THE FIX. Clearing this here is what lets the agent speak again after an
      // interruption. Leaving it set was a permanent, silent mute.
      this.bargeSent = false;
      this.voicedRun = 0;

      this.onEvent({ type: "speaking", value: false });
    }

    // -- control ----------------------------------------------------------
    sendText(text) { this._send({ t: "text", text: String(text || "") }); }
    reset() { this._stopPlayback(); this._send({ t: "reset" }); }

    interrupt() {
      this.bargeSent = true;
      this._send({ t: "barge" });
      this._stopPlayback();
    }

    stop() {
      this._closing = true;
      this.running = false;
      if (this._prosodyTimer) { clearInterval(this._prosodyTimer); this._prosodyTimer = null; }
      this._stopPlayback();
      this._send({ t: "stop" });

      try { if (this.ws) this.ws.close(); } catch (e) {}
      this.ws = null;

      // Release the microphone. Leaving tracks live keeps the browser's
      // recording indicator on, which users reasonably read as spyware.
      if (this.stream) {
        this.stream.getTracks().forEach((tr) => { try { tr.stop(); } catch (e) {} });
        this.stream = null;
      }
      try { if (this.source) this.source.disconnect(); } catch (e) {}
      try { if (this.node) this.node.disconnect(); } catch (e) {}
      this.source = this.node = null;

      [this.ctx, this.playCtx].forEach((c) => {
        if (c && c.state !== "closed") { try { c.close(); } catch (e) {} }
      });
      this.ctx = this.playCtx = null;
      this.onEvent({ type: "stopped" });
    }
  }

  global.RealtimeVoice = RealtimeVoice;
  if (typeof module !== "undefined" && module.exports) module.exports = { RealtimeVoice };
})(typeof window !== "undefined" ? window : this);
