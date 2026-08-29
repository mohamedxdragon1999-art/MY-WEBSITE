/*
 * Voice Studio embeddable widget (enterprise, multi-tenant).
 *
 * Drop into ANY website with one tag:
 *   <script src="https://your-host/widget.js"
 *           data-site="acme"
 *           data-api="https://your-host"
 *           defer></script>
 *
 * - Self-contained IIFE, renders inside a Shadow DOM so it never clashes with
 *   the host page's CSS/JS.
 * - Pulls per-tenant theme / greeting / voice from /api/config?site=ID.
 * - Streams replies (SSE) and speaks each sentence as soon as it is ready.
 * - Barge-in: talking or pressing Stop instantly cuts off the current speech.
 * - Falls back to the browser voice if the server voice is unavailable.
 * - Keeps a per-visitor session id so the server can hold short context.
 */
(function () {
  "use strict";

  // Find our own <script> tag to read config (works with defer/async too).
  var SELF =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();

  var SITE = (SELF && SELF.getAttribute("data-site")) || "default";
  var API =
    (SELF && SELF.getAttribute("data-api")) ||
    (SELF && SELF.src ? SELF.src.replace(/\/widget\.js.*$/, "") : "");
  var TOKEN = (SELF && SELF.getAttribute("data-token")) || "";
  API = (API || "").replace(/\/$/, "");

  if (window.__voiceStudioWidgetLoaded) return; // guard against double-embed
  window.__voiceStudioWidgetLoaded = true;

  // --------------------------- small helpers ---------------------------
  // PER-CALL memory only. The session id lives in memory and is NEVER persisted
  // (no localStorage/cookies), so the moment the visitor ends the call, closes
  // the chat, or closes the tab, their identity and the server-side context are
  // gone -> the assistant "forgets" them. While the call is open the same id is
  // reused every turn, so it remembers everything said during the call. Each
  // new call gets a brand-new id, starting from a clean slate.
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  var SESSION = newId();

  // End the current call: ask the server to forget this session's context, then
  // (optionally) rotate to a fresh id so nothing carries into the next call.
  // Uses keepalive so it still fires while the tab is being closed, and can
  // carry the auth token header (unlike sendBeacon).
  function endCall(rotate) {
    var id = SESSION;
    if (rotate !== false) SESSION = newId();
    try {
      fetch(API + "/api/reset", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ site: SITE, session_id: id }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function headers(json) {
    var h = {};
    if (json) h["Content-Type"] = "application/json";
    if (TOKEN) h["X-API-Token"] = TOKEN;
    return h;
  }

  // Split streamed text into speakable sentences (keep trailing punctuation).
  var SENT_RE = /[^.!?\u2026]*[.!?\u2026]+["')\]]*\s*/g;
  function splitSentences(buf) {
    var out = [];
    var m;
    SENT_RE.lastIndex = 0;
    var last = 0;
    while ((m = SENT_RE.exec(buf)) !== null) {
      out.push(m[0]);
      last = SENT_RE.lastIndex;
    }
    return { done: out, rest: buf.slice(last) };
  }

  // ------------------------------- state -------------------------------
  var cfg = {
    name: "Assistant",
    greeting: "Hi! How can I help you today?",
    theme: { primary: "#4f46e5", bubble: "#4f46e5" },
    voice_mode: "best",
    voice: null,
    lang: "en",
    rate: 1.0,
    pitch: 0.0,
    brain: {},
  };
  var speaking = false;
  var audioEl = null;
  var speakQueue = [];
  var speakBusy = false;
  var recognition = null;
  var listening = false;

  // --------------------------- speech output ---------------------------
  function stopSpeaking() {
    speakQueue.length = 0;
    speakBusy = false;
    speaking = false;
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.src = "";
      } catch (e) {}
      audioEl = null;
    }
    try {
      window.speechSynthesis && window.speechSynthesis.cancel();
    } catch (e) {}
    setSpeakingUI(false);
  }

  function browserSpeak(text) {
    return new Promise(function (resolve) {
      try {
        if (!window.speechSynthesis) return resolve();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = cfg.rate || 1.0;
        u.onend = function () {
          resolve();
        };
        u.onerror = function () {
          resolve();
        };
        window.speechSynthesis.speak(u);
      } catch (e) {
        resolve();
      }
    });
  }

  function serverSpeak(text) {
    return fetch(API + "/api/tts", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        text: text,
        site: SITE,
        mode: cfg.voice_mode || null,
        voice: cfg.voice || null,
        lang: cfg.lang || "en",
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("tts " + r.status);
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve) {
          var url = URL.createObjectURL(blob);
          var a = new Audio(url);
          audioEl = a;
          a.onended = function () {
            URL.revokeObjectURL(url);
            resolve();
          };
          a.onerror = function () {
            URL.revokeObjectURL(url);
            resolve();
          };
          a.play().catch(function () {
            resolve();
          });
        });
      });
  }

  function speakOne(text) {
    text = (text || "").trim();
    if (!text) return Promise.resolve();
    return serverSpeak(text).catch(function () {
      return browserSpeak(text);
    });
  }

  function drainQueue() {
    if (speakBusy) return;
    speakBusy = true;
    var step = function () {
      if (!speaking || speakQueue.length === 0) {
        speakBusy = false;
        if (speakQueue.length === 0) setSpeakingUI(false);
        return;
      }
      var next = speakQueue.shift();
      speakOne(next).then(step);
    };
    step();
  }

  function enqueueSpeak(text) {
    if (!text || !text.trim()) return;
    speaking = true;
    setSpeakingUI(true);
    speakQueue.push(text.trim());
    drainQueue();
  }

  // ------------------------- streaming replies -------------------------
  function streamReply(userText) {
    var botEl = addMsg("", "bot");
    var full = "";
    var buffer = "";
    return fetch(API + "/api/reply-stream", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        text: userText,
        site: SITE,
        session_id: SESSION,
        lang: cfg.lang || "en",
      }),
    })
      .then(function (resp) {
        if (resp.status === 429) {
          botEl.textContent =
            "I'm getting a lot of requests right now \u2014 give me a moment and try again.";
          return;
        }
        if (!resp.ok || !resp.body) {
          return oneShotReply(userText, botEl);
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var sseBuf = "";
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) return;
            sseBuf += decoder.decode(res.value, { stream: true });
            var chunks = sseBuf.split("\n\n");
            sseBuf = chunks.pop();
            chunks.forEach(function (c) {
              var line = c.trim();
              if (line.indexOf("data:") !== 0) return;
              var payload = line.replace(/^data:\s*/, "");
              if (!payload) return;
              var evt;
              try {
                evt = JSON.parse(payload);
              } catch (e) {
                return;
              }
              if (evt.delta) {
                full += evt.delta;
                buffer += evt.delta;
                botEl.textContent = full;
                scrollDown();
                var sp = splitSentences(buffer);
                if (sp.done.length) {
                  sp.done.forEach(enqueueSpeak);
                  buffer = sp.rest;
                }
              }
              if (evt.done) {
                if (buffer.trim()) {
                  enqueueSpeak(buffer);
                  buffer = "";
                }
                if (evt.reply && !full) {
                  botEl.textContent = evt.reply;
                  enqueueSpeak(evt.reply);
                }
              }
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        return oneShotReply(userText, botEl);
      });
  }

  function oneShotReply(userText, botEl) {
    return fetch(API + "/api/reply", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        text: userText,
        site: SITE,
        session_id: SESSION,
        lang: cfg.lang || "en",
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var reply = (d && d.reply) || "Sorry, I couldn't reach the assistant.";
        botEl.textContent = reply;
        scrollDown();
        enqueueSpeak(reply);
      })
      .catch(function () {
        botEl.textContent = "Sorry, I couldn't reach the assistant.";
      });
  }

  // --------------------------- speech input ----------------------------
  function initRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onresult = function (e) {
      var t = e.results[0][0].transcript;
      if (t && t.trim()) handleUserText(t.trim());
    };
    r.onend = function () {
      listening = false;
      setMicUI(false);
    };
    r.onerror = function () {
      listening = false;
      setMicUI(false);
    };
    return r;
  }

  function toggleMic() {
    if (!recognition) recognition = initRecognition();
    if (!recognition) {
      addMsg("Voice input isn't supported in this browser.", "bot");
      return;
    }
    if (listening) {
      try {
        recognition.stop();
      } catch (e) {}
      listening = false;
      setMicUI(false);
      return;
    }
    stopSpeaking(); // barge-in: talking interrupts the assistant
    try {
      recognition.start();
      listening = true;
      setMicUI(true);
    } catch (e) {}
  }

  function handleUserText(text) {
    stopSpeaking(); // barge-in
    addMsg(text, "user");
    streamReply(text);
  }

  // ------------------------------- UI ----------------------------------
  var root, panel, messagesEl, inputEl, launchBtn, micBtn, stopBtn, speakingDot;

  function css() {
    var p = cfg.theme.primary || "#4f46e5";
    return (
      ":host{all:initial;}" +
      "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}" +
      ".launch{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);background:" +
      p +
      ";color:#fff;font-size:26px;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s;}" +
      ".launch:hover{transform:scale(1.06);}" +
      ".panel{position:fixed;right:20px;bottom:92px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;}" +
      ".panel.open{display:flex;}" +
      ".hd{background:" +
      p +
      ";color:#fff;padding:14px 16px;display:flex;align-items:center;gap:8px;}" +
      ".hd .nm{font-weight:600;font-size:15px;flex:1;}" +
      ".hd .dot{width:8px;height:8px;border-radius:50%;background:#8affc1;opacity:0;transition:opacity .2s;}" +
      ".hd .dot.on{opacity:1;animation:pulse 1s infinite;}" +
      "@keyframes pulse{0%{transform:scale(1);}50%{transform:scale(1.6);}100%{transform:scale(1);}}" +
      ".hd button{background:transparent;border:none;color:#fff;cursor:pointer;font-size:16px;opacity:.85;padding:2px 6px;border-radius:6px;}" +
      ".hd button:hover{opacity:1;background:rgba(255,255,255,.15);}" +
      ".msgs{flex:1;overflow-y:auto;padding:14px;background:#f7f7f9;display:flex;flex-direction:column;gap:8px;}" +
      ".msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;}" +
      ".msg.user{align-self:flex-end;background:" +
      p +
      ";color:#fff;border-bottom-right-radius:4px;}" +
      ".msg.bot{align-self:flex-start;background:#fff;color:#111;border:1px solid #e5e7eb;border-bottom-left-radius:4px;}" +
      ".ft{display:flex;gap:6px;padding:10px;border-top:1px solid #eee;background:#fff;align-items:center;}" +
      ".ft input{flex:1;border:1px solid #d1d5db;border-radius:20px;padding:9px 14px;font-size:14px;outline:none;}" +
      ".ft input:focus{border-color:" +
      p +
      ";}" +
      ".ft button{border:none;cursor:pointer;border-radius:50%;width:38px;height:38px;font-size:16px;display:flex;align-items:center;justify-content:center;}" +
      ".mic{background:#eef2ff;color:" +
      p +
      ";}" +
      ".mic.on{background:#ef4444;color:#fff;animation:pulse 1s infinite;}" +
      ".send{background:" +
      p +
      ";color:#fff;}" +
      ".stop{background:#f3f4f6;color:#ef4444;}" +
      ".pw{text-align:center;font-size:10px;color:#9ca3af;padding:4px 0 8px;background:#fff;}"
    );
  }

  function addMsg(text, who) {
    var d = document.createElement("div");
    d.className = "msg " + who;
    d.textContent = text;
    messagesEl.appendChild(d);
    scrollDown();
    return d;
  }
  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function setSpeakingUI(on) {
    if (speakingDot) speakingDot.className = on ? "dot on" : "dot";
  }
  function setMicUI(on) {
    if (micBtn) micBtn.className = on ? "mic on" : "mic";
  }

  function build() {
    var host = document.createElement("div");
    host.id = "voice-studio-widget";
    document.body.appendChild(host);
    root = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = css();
    root.appendChild(style);

    launchBtn = document.createElement("button");
    launchBtn.className = "launch";
    launchBtn.innerHTML = "\uD83C\uDFA7";
    launchBtn.title = "Talk to " + cfg.name;
    launchBtn.onclick = togglePanel;
    root.appendChild(launchBtn);

    panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML =
      '<div class="hd"><span class="dot"></span><span class="nm"></span>' +
      '<button class="newc" title="New conversation">\u21BA</button>' +
      '<button class="cls" title="Close">\u2715</button></div>' +
      '<div class="msgs"></div>' +
      '<div class="ft">' +
      '<button class="mic" title="Speak">\uD83C\uDFA4</button>' +
      '<input type="text" placeholder="Type or press the mic\u2026"/>' +
      '<button class="stop" title="Stop">\u23F9</button>' +
      '<button class="send" title="Send">\u27A4</button>' +
      "</div>" +
      '<div class="pw">Powered by Voice Studio</div>';
    root.appendChild(panel);

    messagesEl = panel.querySelector(".msgs");
    inputEl = panel.querySelector("input");
    micBtn = panel.querySelector(".mic");
    stopBtn = panel.querySelector(".stop");
    speakingDot = panel.querySelector(".dot");
    panel.querySelector(".nm").textContent = cfg.name;

    panel.querySelector(".cls").onclick = togglePanel;
    panel.querySelector(".newc").onclick = newConversation;
    micBtn.onclick = toggleMic;
    stopBtn.onclick = stopSpeaking;
    panel.querySelector(".send").onclick = sendInput;
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendInput();
    });

    // Leaving/closing the tab ends the call -> forget the context. pagehide is
    // the most reliable lifecycle event across desktop and mobile browsers.
    window.addEventListener("pagehide", function () { endCall(false); });
  }

  var greeted = false;
  function togglePanel() {
    var open = panel.classList.toggle("open");
    if (open && !greeted) {
      greeted = true;
      addMsg(cfg.greeting, "bot");
    }
    if (open) {
      inputEl.focus();
    } else {
      // Closing the chat = ending the call -> forget this visitor's context and
      // clear the transcript so re-opening starts a fresh call.
      stopSpeaking();
      endCall(true);
      greeted = false;
      if (messagesEl) messagesEl.innerHTML = "";
    }
  }
  function sendInput() {
    var t = (inputEl.value || "").trim();
    if (!t) return;
    inputEl.value = "";
    handleUserText(t);
  }
  function newConversation() {
    stopSpeaking();
    messagesEl.innerHTML = "";
    endCall(true); // forget the current call and start a brand-new one
    addMsg(cfg.greeting, "bot");
  }

  // ------------------------------ boot ---------------------------------
  function applyConfig(data) {
    if (!data) return;
    var c = data.config || {};
    if (c.name) cfg.name = c.name;
    if (c.greeting) cfg.greeting = c.greeting;
    if (c.theme) cfg.theme = Object.assign(cfg.theme, c.theme);
    if (c.voice_mode) cfg.voice_mode = c.voice_mode;
    if (typeof c.voice !== "undefined") cfg.voice = c.voice;
    if (c.lang) cfg.lang = c.lang;
    if (typeof c.rate === "number") cfg.rate = c.rate;
    if (typeof c.pitch === "number") cfg.pitch = c.pitch;
  }

  function boot() {
    fetch(API + "/api/config?site=" + encodeURIComponent(SITE), {
      headers: headers(false),
    })
      .then(function (r) {
        return r.json();
      })
      .then(applyConfig)
      .catch(function () {})
      .then(function () {
        build();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
