/* 16 kHz PCM capture worklet.
 *
 * Replaces MediaRecorder. The difference is not cosmetic:
 *
 *   MediaRecorder gives you Opus/WebM CONTAINERS. A container cannot be cut at
 *   an arbitrary point, so v48 could only ever re-send the whole utterance from
 *   the beginning - which is exactly why its cost grew with every tick. It also
 *   only hands you a blob every N hundred milliseconds, so N hundred
 *   milliseconds is your floor on reacting to anything.
 *
 *   This runs on the audio render thread and emits raw little-endian int16 every
 *   ~20 ms. Raw PCM is sliceable anywhere, which is what makes a bounded,
 *   constant-cost recognition window possible at all.
 *
 * It also computes RMS/ZCR here rather than on the main thread, so voice
 * activity is detected on the audio clock and never delayed by a busy UI or a
 * long garbage-collection pause. Barge-in has to work while the page is doing
 * other things.
 */

const TARGET_RATE = 16000;
const FRAME_MS = 20;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || TARGET_RATE;
    this.frameSamples = Math.round((this.targetRate * FRAME_MS) / 1000);

    // Linear resampling state. sampleRate is the hardware rate (usually 48000).
    this.ratio = sampleRate / this.targetRate;
    this.pos = 0;
    this.last = 0;

    this.buf = new Float32Array(this.frameSamples);
    this.n = 0;

    // Last sample of the PREVIOUS render block, so interpolation can span the
    // block boundary. See process() for why this matters.
    this.prev = 0;
    this.havePrev = false;

    // One-pole DC/rumble high-pass state (~60 Hz).
    this.hpX = 0;
    this.hpY = 0;

    // Adaptive noise floor. A fixed threshold fails the moment someone takes a
    // call in a car or a cafe; tracking the floor means the same code works in
    // a quiet room and a loud one.
    this.noise = 0.0;
    this.primed = false;
    this.muted = false;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === "mute") this.muted = !!d.value;
      if (d.type === "resetNoise") { this.noise = 0; this.primed = false; }
    };
  }

  flush() {
    const frame = this.buf.subarray(0, this.n);

    let sum = 0;
    let crossings = 0;
    let prev = this.last;
    for (let i = 0; i < frame.length; i++) {
      const s = frame[i];
      sum += s * s;
      if ((s >= 0) !== (prev >= 0)) crossings++;
      prev = s;
    }
    this.last = prev;
    const rms = Math.sqrt(sum / Math.max(1, frame.length));
    const zcr = crossings / Math.max(1, frame.length);

    // Track the floor only on quiet frames, and rise 20x slower than we fall.
    // Asymmetry matters: adapting upward quickly would let the floor climb into
    // the speaker's own voice during a long sentence and mute them mid-word.
    if (!this.primed) {
      this.noise = rms;
      this.primed = true;
    } else if (rms < this.noise * 2.0) {
      const a = rms > this.noise ? 0.001 : 0.02;
      this.noise = this.noise * (1 - a) + rms * a;
    }

    const thresh = Math.max(0.006, this.noise * 2.2);
    const voiced = rms > thresh && zcr < 0.35;

    const pcm = new Int16Array(frame.length);
    if (!this.muted) {
      for (let i = 0; i < frame.length; i++) {
        let v = frame[i];
        if (v > 1) v = 1;
        else if (v < -1) v = -1;
        // Asymmetric int16 range: 32767 positive, 32768 negative. Using 0x8000
        // for both wraps the loudest positive sample to full-scale NEGATIVE,
        // which is an audible click on every peak.
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    }

    this.port.postMessage(
      { type: "pcm", pcm: pcm.buffer, rms: rms, zcr: zcr, voiced: voiced,
        noise: this.noise },
      [pcm.buffer]
    );
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const ch = input[0];
    if (!ch) return true;

    // Decimate to the target rate with linear interpolation. Dropping samples
    // outright aliases high frequencies down into the speech band, which
    // measurably raises word error rate on sibilants.
    //
    // v52 CORRECTNESS FIX - interpolation now spans the block boundary.
    //
    // The old loop did `b = i + 1 < ch.length ? ch[i + 1] : a`. When the
    // resample position landed on the LAST sample of a render block there was
    // no next sample to interpolate toward, so it silently degraded to a
    // sample-and-hold. Render blocks are 128 samples, so at 44.1 kHz (ratio
    // 2.756, a non-integer, so the landing position drifts through the block)
    // this fired on a large fraction of blocks - roughly 300+ times a second.
    // Each one is a tiny flat step in the waveform, and a periodic train of
    // flat steps is broadband distortion sitting directly on top of the speech
    // band. It is inaudible as "noise" but it is exactly the kind of corruption
    // that costs word accuracy on fricatives and sibilants, which is precisely
    // the "it drops/mangles words" complaint.
    //
    // The fix is to keep the previous block's final sample and, when we need a
    // lookahead sample we do not have yet, STOP and resume next block instead
    // of inventing one. `pos` is allowed to go negative, meaning "between the
    // previous block's last sample and this block's first".
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      if (i + 1 >= ch.length) break;      // need the next block; resume later
      const frac = this.pos - i;
      const a = i < 0 ? this.prev : ch[i];
      const b = i + 1 < 0 ? this.prev : ch[i + 1];
      let s = a + (b - a) * frac;

      // One-pole high-pass at ~60 Hz. Desk thumps, HVAC rumble and mic handling
      // noise are almost all below the speech band, but they carry real energy,
      // so they inflate RMS and hold the VAD open long after the caller stopped
      // talking - which directly delays end-of-turn detection. Removing them
      // here, before RMS is measured, makes the silence clock honest.
      this.hpY = 0.995 * (this.hpY + s - this.hpX);
      this.hpX = s;
      s = this.hpY;

      this.buf[this.n++] = s;
      if (this.n >= this.frameSamples) this.flush();
      this.pos += this.ratio;
    }
    this.prev = ch[ch.length - 1];
    this.havePrev = true;
    this.pos -= ch.length;

    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
