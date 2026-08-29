/* Voice Studio frontend (English).
   Flow: you talk -> browser Speech-to-Text -> /api/reply -> /api/tts (chosen mode)
   -> audio plays. If the backend or a mode is unavailable, it falls back to the
   browser's built-in voice so the page ALWAYS talks. */

const $ = (id) => document.getElementById(id);
const LANG = "en";
const state = {
  mode: "best",
  modes: [],
  listening: false,
  speaking: false,
  backend: true,
  history: [],
  brain: null,
  // AI brain selection (persisted in this browser only)
  brainSel: localStorage.getItem("vs_brain") || "auto",
  nimKey: localStorage.getItem("vs_nim_key") || "",
  nimModel: localStorage.getItem("vs_nim_model") || "",
  nimModels: [],
  nimLive: false,
  nimLoading: false,
  // Voice tuning + input prefs (persisted in this browser only)
  pitch: parseFloat(localStorage.getItem("vs_pitch") || "0") || 0,
  micMode: localStorage.getItem("vs_mic_mode") || "toggle",   // "toggle" | "hold"
  // Call mode: the mic stays open from "start call" to "end call", exactly like
  // a phone call. Turns are detected inside the open stream; the stream itself
  // is never closed between turns.
  inCall: false,
  muted: false,
  callStartedAt: 0,
  hotkeyTalk: localStorage.getItem("vs_hotkey_talk") || "Space",
  hotkeyStop: localStorage.getItem("vs_hotkey_stop") || "Escape",
  // Turn-taking: base silence gap (ms) before we treat a spoken turn as done.
  // Smart endpointing adjusts it per utterance, so a "let me think" pause
  // still won't cut you off even though the base is short.
  // 550ms. Measured guidance is consistent: silence thresholds in the 400-600ms
  // range feel materially faster than the 800-1000ms defaults most agents ship,
  // and the perceived-quality knee sits around 600ms. The adaptive rules below
  // still stretch this out when you are clearly mid-thought, so a shorter base
  // buys speed on finished sentences without cutting off hesitant ones.
  endpointMs: parseInt(localStorage.getItem("vs_endpoint_ms") || "550", 10) || 550,
};

const hasNimBrain = () => state.brainSel === "nvidia" && !!state.nimKey;

/* ---------------- engine discovery ---------------- */
async function loadEngines() {
  try {
    const r = await fetch(`/api/engines?lang=${LANG}`);
    if (!r.ok) throw new Error("bad status");
    const data = await r.json();
    state.modes = data.modes || [];
    state.brain = data.brain || null;
    state.nimModels = data.nim_models || [];
    if (!state.nimModel) state.nimModel = data.nim_default || (state.nimModels[0] && state.nimModels[0].id) || "";
    state.backend = true;
  } catch (e) {
    // Backend not running -> browser-only mode.
    state.backend = false;
    state.modes = browserOnlyModes();
  }
  renderModes();
  populateVoices();
  populateNimModels();
  syncBrainUI();
  if (state.backend) {
    const b = state.brain;
    if (hasNimBrain()) {
      setStatus("Ready. Brain: NVIDIA NIM (your key).");
    } else {
      setStatus(b && b.mode === "ai"
        ? `Ready. Smart AI brain: ${b.active}.`
        : "Ready. Offline brain \u2014 open \ud83e\udde0 AI Brain to use NVIDIA NIM models, or add a free key in .env.");
    }
  } else {
    setStatus("Backend offline \u2014 using the browser voice. Start the Python server for the 5 premium modes + NVIDIA NIM.");
  }
}

/* ---------------- AI brain panel ---------------- */
function populateNimModels() {
  const sel = $("nimModel");
  if (!sel) return;
  const q = (($("nimModelSearch") && $("nimModelSearch").value) || "").trim().toLowerCase();
  const all = state.nimModels || [];
  const list = q ? all.filter((m) => (m.id + " " + (m.label || "")).toLowerCase().includes(q)) : all;
  sel.innerHTML = "";
  list.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.label || m.id;
    if (m.id === state.nimModel) o.selected = true;
    sel.appendChild(o);
  });
  if (list.length && !list.some((m) => m.id === state.nimModel)) {
    // keep a valid selection visible
    sel.selectedIndex = 0;
  }
}

// Pull the user's REAL, live NVIDIA NIM model catalogue using their saved key.
// Falls back silently to whatever we already have if the call fails.
async function loadLiveNimModels(force) {
  if (!state.nimKey || state.nimLoading) return;
  if (state.nimLive && !force) return;
  state.nimLoading = true;
  const st = $("brainState");
  if (st) st.textContent = "Loading live NVIDIA NIM models\u2026";
  try {
    const r = await fetch("/api/nim-models", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: state.nimKey }),
    });
    const d = await r.json();
    if (d && Array.isArray(d.models) && d.models.length) {
      state.nimModels = d.models;
      state.nimLive = !!d.live;
      if (!state.nimModel || !d.models.some((m) => m.id === state.nimModel)) {
        state.nimModel = d.models[0].id;
        localStorage.setItem("vs_nim_model", state.nimModel);
      }
      populateNimModels();
      if (st) st.textContent = d.live
        ? `\u2705 Loaded ${d.models.length} live NVIDIA NIM models. Pick any one above.`
        : `Showing built-in model list${d.error ? " (live fetch failed: " + d.error + ")" : ""}.`;
    } else if (st) {
      st.textContent = "Couldn't load live models" + (d && d.error ? ": " + d.error : "") + ". Using built-in list.";
    }
  } catch (e) {
    if (st) st.textContent = "Couldn't reach the server to load models. Using built-in list.";
  } finally {
    state.nimLoading = false;
  }
}

function syncBrainUI() {
  const isNim = state.brainSel === "nvidia";
  const brainSel = $("brainSel");
  if (brainSel) brainSel.value = state.brainSel;
  const nimKeyEl = $("nimKey");
  if (nimKeyEl && document.activeElement !== nimKeyEl) nimKeyEl.value = state.nimKey || "";
  ["nimKeyWrap", "nimSave", "nimClear"].forEach((id) => {
    const el = $(id); if (el) el.hidden = !isNim;
  });
  // The live model picker only makes sense once a key is present.
  const modelRow = $("nimModelRow");
  if (modelRow) modelRow.hidden = !(isNim && state.nimKey);
  const st = $("brainState");
  if (st) {
    if (!isNim) st.textContent = "";
    else if (state.nimKey) st.textContent = "NVIDIA NIM key saved \u2014 used for the brain" + " (and available for the Magpie voice).";
    else st.textContent = "Enter your NVIDIA NIM key, then Save & test.";
  }
  // Show how many keys the caller pasted and what that buys them, so the
  // speed/capacity benefit of adding more free keys is visible immediately.
  const ps = $("poolState");
  if (ps) {
    const n = splitKeys(state.nimKey).length;
    if (!isNim || n === 0) {
      ps.textContent = "";
    } else if (n === 1) {
      ps.textContent = "1 key \u2014 roughly 36 requests/min (about 9 callers at once). "
        + "Add a second free key to double it.";
    } else {
      ps.textContent = n + " keys rotating \u2014 roughly " + (n * 36)
        + " requests/min (about " + Math.floor((n * 36) / 4)
        + " callers at once), still free.";
    }
  }
  // Key manager: only meaningful once NIM is selected and a key exists.
  const kmRow = $("keyMgrRow");
  if (kmRow) kmRow.hidden = !(isNim && state.nimKey);
  const kr = $("keyRefresh");
  if (kr && !kr._wired) {
    kr._wired = true;
    kr.addEventListener("click", () => refreshKeyHealth(true));
  }
  const kx = $("keyReset");
  if (kx && !kx._wired) {
    kx._wired = true;
    kx.addEventListener("click", resetKeyHealth);
  }
  if (isNim && state.nimKey) refreshKeyHealth(false);
  else { const kb = $("keyMgr"); if (kb) kb.textContent = ""; }
  refreshPoolStatus();
  // Auto-load the real live catalogue the moment NIM is active with a key.
  if (isNim && state.nimKey && !state.nimLive && !state.nimLoading) loadLiveNimModels(false);
}

// Users may paste several free keys; more keys = proportionally more
// requests per minute, which is what keeps a busy site fast and error-free.
function splitKeys(raw) {
  if (!raw) return [];
  return raw
    .replace(/[\n\r ]+/g, ",")
    .split(",")
    .map((s) => s.trim())
    .filter((s, i, a) => s && a.indexOf(s) === i);
}

// Ask the server what the real server-side pool looks like (keys configured
// in .env plus how well the instant cache is doing).
let _poolTimer = null;
async function refreshPoolStatus() {
  if (_poolTimer) return;
  _poolTimer = setTimeout(() => { _poolTimer = null; }, 4000);
  try {
    const r = await fetch("/api/pool");
    if (!r.ok) return;
    const d = await r.json();
    const el = $("poolState");
    if (!el) return;
    const bits = [];
    if (d.total_keys > 0) {
      bits.push(d.total_keys + " server key" + (d.total_keys === 1 ? "" : "s")
        + " \u2248 " + d.capacity_rpm + " req/min (~"
        + d.estimated_concurrent_callers + " callers at once)");
    }
    const rc = d.reply_cache || {};
    if (rc.entries > 0) {
      bits.push("instant cache: " + rc.entries + " answers, "
        + Math.round((rc.hit_rate || 0) * 100) + "% hit rate");
    }
    if (bits.length) el.textContent = bits.join("  \u2022  ");
  } catch (e) {
    /* status display is best-effort only */
  }
}

// --- KEY MANAGER (v0.0.46) -------------------------------------------------
// Several keys are only useful if you can SEE which ones are working. The server
// returns MASKED labels (last four characters) and per-key health - never the
// key itself - and the key is sent by POST, so it cannot end up in an access
// log, a proxy log, or browser history the way a query string would.
let _keyTimer = null;
async function refreshKeyHealth(force) {
  if (!force && _keyTimer) return;
  if (_keyTimer) clearTimeout(_keyTimer);
  _keyTimer = setTimeout(() => { _keyTimer = null; }, 4000);
  const box = $("keyMgr");
  if (!box) return;
  if (!state.nimKey) { box.textContent = ""; return; }
  try {
    const r = await fetch("/api/keys", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: state.nimKey }),
    });
    if (!r.ok) return;
    const d = await r.json();
    const rows = d.keys || [];
    if (!rows.length) { box.textContent = ""; return; }
    const LABEL = {
      ready: "\u2705 ready",
      cooling: "\u23f3 rate limited",
      rejected: "\u26d4 rejected \u2014 check or replace this key",
      resting: "\u26a0\ufe0f resting after an error",
    };
    const lines = rows.map((k) => {
      const bits = [k.mask, LABEL[k.state] || k.state];
      if (k.cooldown_sec > 0) bits.push("back in " + Math.ceil(k.cooldown_sec) + "s");
      if (k.ok) bits.push(k.ok + " ok");
      if (k.rate_limited) bits.push(k.rate_limited + " limited");
      if (k.rejected) bits.push(k.rejected + " rejected");
      return bits.join(" \u2014 ");
    });
    box.textContent = d.ready + " of " + d.total + " key"
      + (d.total === 1 ? "" : "s") + " ready \u2248 " + d.estimated_rpm
      + " req/min   \u2022   " + lines.join("    |    ");
  } catch (e) {
    /* health display is best-effort only */
  }
}

// The quarantine on a rejected key is deliberately long (10 minutes), because
// retrying a revoked key just spends the caller's latency budget. If you fix a
// key upstream you should not have to wait it out, or restart the server.
async function resetKeyHealth() {
  try {
    await fetch("/api/keys/reset", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: state.nimKey }),
    });
  } catch (e) {
    /* best effort */
  }
  refreshKeyHealth(true);
}

async function saveNimKey() {
  const key = ($("nimKey").value || "").trim();
  const model = $("nimModel").value || state.nimModel;
  const st = $("brainState");
  if (!key) { if (st) st.textContent = "Please paste your nvapi-... key first."; return; }
  state.nimKey = key; state.nimModel = model;
  localStorage.setItem("vs_nim_key", key);
  localStorage.setItem("vs_nim_model", model);
  if (st) st.textContent = "Testing key against NVIDIA NIM\u2026";
  try {
    const r = await fetch("/api/verify-key", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, model }),
    });
    const d = await r.json();
    if (d.ok) { if (st) st.textContent = `\u2705 NVIDIA NIM key works (${d.model}). Brain + Magpie voice enabled.`; }
    else { if (st) st.textContent = `\u26a0\ufe0f Key/model didn't work${d.error ? ": " + d.error : ""}. It's still saved; you can try another model.`; }
  } catch (e) {
    if (st) st.textContent = "Couldn't reach the server to test the key (is it running?). Key saved locally.";
  }
  syncBrainUI();
  // Now that we have a key, fetch the real live model catalogue.
  loadLiveNimModels(true);
  renderModes();
  populateVoices();
}

function clearNimKey() {
  state.nimKey = "";
  localStorage.removeItem("vs_nim_key");
  const el = $("nimKey"); if (el) el.value = "";
  syncBrainUI();
  renderModes();
}

function browserOnlyModes() {
  const mk = (id, title, description, q) => ({
    id, title, description,
    availability: { ok: false, cpu: true, needs_network: false, needs_key: false, quality: q,
      reason: "Backend offline \u2014 will use the browser voice.", setup: "Run the launcher (Start Voice Studio)" },
    voices: [],
  });
  return [
    mk("edge", "Current voice (Edge Neural)", "Microsoft Edge online neural voice.", 4),
    mk("piper", "Pocket TTS (Piper)", "Offline local-CPU neural voice.", 3),
    mk("kokoro", "Kokoro TTS", "Open-weight 82M voice, CPU via ONNX.", 5),
    mk("magpie", "NVIDIA Magpie (cloud)", "NVIDIA NIM GPU voice (needs key).", 5),
    mk("best", "Vox Premium (auto-best)", "Best ready voice + mastering.", 5),
  ];
}

function renderModes() {
  const wrap = $("modes");
  wrap.innerHTML = "";
  state.modes.forEach((m) => {
    const av = Object.assign({}, m.availability || {});
    // Magpie becomes usable once the user saves an NVIDIA NIM key in the UI.
    if (m.id === "magpie" && state.nimKey && !av.ok) {
      av.ok = true;
      av.reason = "Ready (using your NVIDIA NIM key from the AI Brain panel).";
    }
    const card = document.createElement("div");
    card.className = "mode" + (m.id === state.mode ? " active" : "") + (av.ok ? "" : " off");
    card.onclick = () => selectMode(m.id);
    const q = "\u2605".repeat(av.quality || 3);
    const badges = [];
    badges.push(av.ok
      ? `<span class="badge ok"><span class="dot ok"></span> ready</span>`
      : `<span class="badge no"><span class="dot no"></span> setup</span>`);
    badges.push(av.cpu
      ? `<span class="badge cpu">CPU</span>`
      : `<span class="badge cloud">cloud GPU</span>`);
    if (av.needs_network) badges.push(`<span class="badge cloud">internet</span>`);
    if (av.needs_key) badges.push(`<span class="badge cloud">API key</span>`);
    badges.push(`<span class="badge q">${q}</span>`);
    card.innerHTML =
      `<div class="mt">${m.title}</div>` +
      `<div class="md">${m.description || ""}</div>` +
      `<div class="badges">${badges.join("")}</div>`;
    card.title = av.ok ? av.reason : (av.reason + (av.setup ? "\nSetup: " + av.setup : ""));
    wrap.appendChild(card);
  });
}

function selectMode(id) {
  state.mode = id;
  renderModes();
  populateVoices();
  const m = state.modes.find((x) => x.id === id);
  if (m && !m.availability.ok) {
    setStatus(`\u201c${m.title}\u201d needs setup: ${m.availability.setup || m.availability.reason}. The browser voice will be used until then.`);
  } else {
    setStatus(`Mode: ${m ? m.title : id}.`);
  }
}

function populateVoices() {
  const sel = $("voice");
  const m = state.modes.find((x) => x.id === state.mode);
  sel.innerHTML = "";
  const voices = (m && m.voices) || [];
  if (!voices.length) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "(default)";
    sel.appendChild(o);
    return;
  }
  voices.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.label + (v.ready === false ? " (not downloaded)" : "");
    sel.appendChild(o);
  });
}

/* ---------------- conversation ui ---------------- */
function addMsg(text, who) {
  const conv = $("conversation");
  const row = document.createElement("div");
  row.className = `msg ${who}`;
  row.innerHTML = `<div class="bubble"></div>`;
  row.querySelector(".bubble").textContent = text;
  conv.appendChild(row);
  conv.scrollTop = conv.scrollHeight;
  return row;
}
function setStatus(t) { $("status").textContent = t; }

// v0.0.34 - SHOW ALL THE WORDS, NOT THE LAST 64 CHARACTERS.
// The captured text used to be appended to the single-line status element as
// `shown.slice(-64)`, so the beginning of a longer sentence scrolled out of
// view. Nothing was ever lost - the full transcript stayed in _finalBuf /
// _liveCommitted and the whole thing was sent to the brain - but you could not
// SEE what capture heard, which is exactly what you need to see in order to
// trust it. This writes the complete text into a wrapping, scrolling panel and
// keeps it pinned to the newest words.
function setLiveText(t) {
  const box = $("liveCap"), out = $("liveCapText");
  if (!box || !out) return;
  const text = (t || "").trim();
  box.hidden = !text;
  if (!text) { out.textContent = ""; return; }
  out.textContent = text;
  box.scrollTop = box.scrollHeight;   // follow the newest words
}

/* ---------------- speak (TTS) ---------------- */
// A monotonically increasing token; bumping it cancels any in-flight speech.
state.speakSeq = 0;
state.currentAudio = null;
state.ttsChain = Promise.resolve();
state.currentBotBubble = null;

// ---------------------------------------------------------------------------
// v0.0.36 - THE AGENT WAS TRANSCRIBING ITSELF AND POSTING IT AS YOUR TURN.
// ---------------------------------------------------------------------------
// Reported as "it is hearing what the ai told me and repeating it again in the
// chat", and that is exactly what happened. There were TWO leaks, and the v7.2
// fix only closed one of them (the model tick at _liveTick).
//
//   1. The browser recogniser was never gated on playback. When the agent's
//      voice came out of the speakers and back into the mic, those were REAL
//      words, so they passed the backchannel test, triggered barge-in, and were
//      LEFT IN _finalBuf - so the agent's own sentence was submitted as the
//      user's next turn.
//   2. The MediaRecorder kept recording throughout playback, so the agent's
//      voice was inside the audio uploaded to the ASR model. The model result
//      always outranks the browser transcript, so the agent's words won.
//
// Browser echo cancellation is a mitigation, not a guarantee: on laptop
// speakers at normal volume it leaks. So we compare what we HEAR against what
// we are SAYING and drop the overlap.
let _agentSaid = "";

function _noteAgentSpeech(t) {
  const k = _normKey(t || "");
  if (!k) return;
  _agentSaid = (_agentSaid + " " + k).slice(-700);
}

function _forgetAgentSpeech() { _agentSaid = ""; }

// Drop what we just heard if it was our own voice. Returns true when rejected.
// The echo test deliberately runs on THIS EVENT'S words only: if it ran on the
// whole accumulated turn, real words you said earlier would dilute the overlap
// and the leak would sail through.
function _rejectEcho(fresh, interim) {
  const heard = (fresh + " " + interim).trim();
  if (!heard || !_looksLikeEcho(heard)) return false;
  _dropEarlyTranscribe();
  // Anything genuine you said before the leak must still reach the brain,
  // otherwise rejecting echo would strand a real turn and answer nothing.
  if (_finalBuf) _scheduleEndpoint();
  return true;
}

// Is this text our own voice coming back, rather than yours?
// Only ever consulted DURING playback, which is the only window in which echo
// can exist - so a caller repeating the agent's wording afterwards is safe.
// Single words are NOT auto-rejected: "stop", "wait" and "no" are the most
// important barge-ins there are, and they only match if the agent just said
// them.
function _looksLikeEcho(text) {
  return _looksLikeEchoIn(text, _agentSaid);
}

// v0.0.44 - THE SAME TEST, AGAINST A SNAPSHOT.
// The echo check used to be readable only against the LIVE _agentSaid buffer,
// which _submitTurn clears at the start of every turn. That made it useless for
// anything asynchronous: by the time the server transcript came back, the
// memory of what the agent had just said was already erased, so the agent's own
// sentence was accepted as the caller's words. In call mode the microphone never
// closes, so this is exactly how "is that okay?" came back as if the caller had
// said it. Taking a reference string lets the async paths test against a
// snapshot captured before the turn was reset.
function _looksLikeEchoIn(text, ref) {
  if (!ref) return false;
  const words = _normKey(text || "").split(" ").filter((w) => w.length > 2);
  if (!words.length) return false;
  let hit = 0;
  for (let i = 0; i < words.length; i++) {
    if (ref.indexOf(words[i]) >= 0) hit++;
  }
  return (hit / words.length) >= 0.6;
}

// Barge-in: instantly stop whatever the agent is saying.
function stopSpeaking() {
  state.speakSeq++;
  try { if (state.currentAudio) { state.currentAudio.pause(); state.currentAudio.src = ""; } } catch (e) {}
  state.currentAudio = null;
  if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  state.ttsChain = Promise.resolve();
  markSpeaking(false);
}

// Split text into complete sentences; `rest` is a trailing partial sentence
// (still streaming). Exposed for testing.
function splitSentences(text) {
  const out = [];
  const re = /[^.!?\u2026]*[.!?\u2026]+[\"')\]]*\s*/g;
  let m, last = 0;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
    last = re.lastIndex;
  }
  return { sentences: out, rest: text.slice(last) };
}

// Fetch audio for one sentence. Starts immediately so the NEXT sentence can be
// fetched while the current one plays (pipelining -> low latency).
async function synthOne(text) {
  const rate = parseFloat($("rate").value || "1.0");
  const pitch = parseFloat(($("pitch") && $("pitch").value) || "0") || 0;
  const voice = $("voice").value || null;
  // v0.0.44 - VOICE STICKINESS.
  // The server picks a fallback engine PER REQUEST (server.py: candidates =
  // [req.mode] + _FALLBACK_ORDER), and we synthesise one sentence per request.
  // So a single failed sentence used to come back in a completely different
  // voice in the MIDDLE of a reply - which is the "voices changes sometimes
  // from voice to another" problem. Once we learn which engine actually
  // produced audio for the mode the caller chose, we keep asking for that one
  // explicitly, so the voice stays the same for the whole conversation.
  const pinned = (state.pinnedFor === state.mode && state.pinnedEngine) ? state.pinnedEngine : null;
  const useMode = pinned || state.mode;
  // A voice name only means something to the engine it belongs to, so when we
  // are pinned to a different engine we let the server choose its own default.
  const useVoice = (pinned && pinned !== state.mode) ? null : voice;
  const body = { text, mode: useMode, voice: useVoice, lang: LANG, rate, pitch };
  if (useMode === "magpie" && state.nimKey) body.api_key = state.nimKey;
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const blob = await r.blob();
      const engine = r.headers.get("X-Voice-Engine") || state.mode;
      // Remember what really spoke, keyed to the mode the caller selected, so
      // switching mode in the UI naturally invalidates the pin.
      if (engine) { state.pinnedEngine = engine; state.pinnedFor = state.mode; }
      return { blob, engine, detail: r.headers.get("X-Voice-Detail") || "" };
    }
  } catch (e) { /* fall through to browser voice */ }
  return null;
}

function playBlobTracked(blob, seq) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.currentAudio = audio;
    markSpeaking(true);
    const done = () => {
      URL.revokeObjectURL(url);
      if (state.currentAudio === audio) state.currentAudio = null;
      if (seq === state.speakSeq) markSpeaking(false);
      resolve();
    };
    audio.onended = audio.onerror = done;
    audio.play().catch(() => done());
  });
}

// ---------------------------------------------------------------------------
// Front-end safety net for stage directions.
// The browser fallback voice never went through the server's sanitizer, so a
// model writing "*sighs*" got READ ALOUD as the word "sighs". Never again.
// ---------------------------------------------------------------------------
const _ACTION_WORD = /^(laugh|laughs|laughing|laughter|chuckle|chuckles|chuckling|sigh|sighs|sighing|breath|breathes|breathing|inhale|inhales|exhale|exhales|cough|coughs|coughing|whisper|whispers|whispering|gasp|gasps|gasping|clears?\s+throat|hmm+|pause|pauses|pausing|beat|silence|softly|warmly|gently|cheerfully|sadly|excitedly|nervously|smiling|smiles|grins|nods|shrugs|thinking|hesitates|hesitating|emphatically|quietly)\b/i;

function stripStageDirections(text) {
  let out = String(text || "");
  // Any bracketed aside whose contents read as an action, in any bracket style.
  out = out.replace(/[\[\(\{<]\s*([^\]\)\}>\n]{1,40})\s*[\]\)\}>]/g, (m, inner) =>
    _ACTION_WORD.test(String(inner).trim()) ? " " : m);
  // *sighs deeply* — asterisk emphasis holding only an action.
  out = out.replace(/\*([^*\n]{1,40})\*/g, (m, inner) =>
    _ACTION_WORD.test(String(inner).trim()) ? " " : m);
  // A leading "Sighs." at the very start of the line.
  out = out.replace(/^\s*(?:laughs?|chuckles?|sighs?|pauses?|whispers?|gasps?|coughs?)\s*[.,:;!-]+\s*/i, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

// Emotion for the browser voice: rate and pitch actually move with meaning.
function _browserEmotion(text) {
  const low = String(text || "").toLowerCase();
  const has = (arr) => arr.some((w) => low.includes(w));
  if (has(["sorry", "apolog", "unfortunately", "i'm afraid", "declined", "can't", "cannot"]))
    return { rate: 0.92, pitch: 0.92 };
  if (has(["i understand", "i hear you", "frustrat", "that must be", "sorry to hear"]))
    return { rate: 0.94, pitch: 0.95 };
  if (has(["congratulations", "amazing", "fantastic", "brilliant", "so exciting"]))
    return { rate: 1.11, pitch: 1.12 };
  if (has(["great news", "good news", "all set", "perfect", "wonderful", "glad to", "happy to", "confirmed"]))
    return { rate: 1.06, pitch: 1.07 };
  if (has(["let me check", "one moment", "one sec", "bear with me", "let me see", "hold on"]))
    return { rate: 0.93, pitch: 0.97 };
  if (has(["important", "security", "urgent", "do not share", "permanent", "cannot be undone"]))
    return { rate: 0.95, pitch: 0.94 };
  if (has(["don't worry", "no worries", "no problem", "i can help", "leave it with me"]))
    return { rate: 0.98, pitch: 1.0 };
  if (low.trim().endsWith("?")) return { rate: 1.03, pitch: 1.05 };
  if (low.includes("!")) return { rate: 1.05, pitch: 1.06 };
  return { rate: 1.0, pitch: 1.0 };
}

function browserSpeakAwait(text, seq) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const spoken = stripStageDirections(text);
    if (!spoken) return resolve();
    const u = new SpeechSynthesisUtterance(spoken);
    const emo = _browserEmotion(spoken);
    u.rate = Math.max(0.5, Math.min(2, parseFloat($("rate").value || "1.0") * emo.rate));
    u.pitch = Math.max(0, Math.min(2, emo.pitch));
    u.lang = "en-US";
    const vs = window.speechSynthesis.getVoices();
    const preferred = vs.find((v) => /en[-_]/i.test(v.lang) && /natural|neural|google|premium|enhanced/i.test(v.name))
      || vs.find((v) => /en[-_]/i.test(v.lang));
    if (preferred) u.voice = preferred;
    markSpeaking(true);
    u.onend = u.onerror = () => { if (seq === state.speakSeq) markSpeaking(false); resolve(); };
    window.speechSynthesis.speak(u);
    $("engineInfo").textContent = "Spoken by: browser (fallback)";
  });
}

// Queue a sentence for sequential playback while its audio prefetches.
function enqueueSpeak(sentence, seq) {
  if (!sentence || seq !== state.speakSeq) return;
  const audioPromise = state.backend ? synthOne(sentence) : Promise.resolve(null);
  state.ttsChain = state.ttsChain.then(async () => {
    if (seq !== state.speakSeq) return;
    let res = null;
    try { res = await audioPromise; } catch (e) { res = null; }
    if (seq !== state.speakSeq) return;
    // Remember our own words BEFORE they are audible, so the echo test has
    // something to compare against the instant the mic hears them.
    _noteAgentSpeech(sentence);
    if (res && res.blob) {
      $("engineInfo").textContent = `Spoken by: ${res.engine}${res.detail ? " (" + res.detail + ")" : ""}`;
      await playBlobTracked(res.blob, seq);
    } else if ($("browserFallback").checked) {
      // v0.0.36 - BE HONEST ABOUT THIS: the browser's built-in speech synthesis
      // has no pitch contour, no emphasis and no emotion rendering at all. If
      // this is what is speaking, every emotion improvement in the engines is
      // bypassed, which is why emotion can seem entirely absent. Say so in the
      // UI instead of leaving it looking like the emotion work simply failed.
      $("engineInfo").textContent =
        "Spoken by: browser fallback voice \u2014 no emotion support (install a neural voice for emotions)";
      await browserSpeakAwait(sentence, seq);
    }
  });
  return state.ttsChain;
}

// Speak an already-complete text, chunked into sentences.
function speakText(text, seq) {
  const sp = splitSentences(text);
  const all = sp.sentences.concat(sp.rest.trim() ? [sp.rest.trim()] : []);
  if (!all.length && text.trim()) all.push(text.trim());
  all.forEach((s) => enqueueSpeak(s, seq));
}

function markSpeaking(on) {
  state.speaking = on;
  const b = document.querySelector(".msg.bot:last-child");
  if (b) b.classList.toggle("speaking", on);
}

/* ---------------- streaming reply (SSE) ---------------- */
async function streamReply(body, seq) {
  const r = await fetch("/api/reply-stream", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body || !r.body.getReader) throw new Error("no stream");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "", pending = "";
  const bubble = state.currentBotBubble;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (seq !== state.speakSeq) { try { await reader.cancel(); } catch (e) {} break; }
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let obj; try { obj = JSON.parse(dataLine.slice(5).trim()); } catch (e) { continue; }
      if (obj.delta) {
        full += obj.delta; pending += obj.delta;
        if (bubble) bubble.textContent = full;
        $("conversation").scrollTop = $("conversation").scrollHeight;
        const sp = splitSentences(pending);
        pending = sp.rest;
        sp.sentences.forEach((s) => enqueueSpeak(s, seq));
      }
      if (obj.done) {
        if (pending.trim()) { enqueueSpeak(pending.trim(), seq); pending = ""; }
        full = obj.reply || full;
        if (bubble) bubble.textContent = full;
      }
    }
  }
  return full;
}

/* ---------------- turn handling ---------------- */
async function handleUserText(text) {
  text = (text || "").trim();
  if (!text) return;
  stopSpeaking();                       // barge-in: cut off any current speech
  const seq = state.speakSeq;           // this turn's speech token
  _lastUserBubble = addMsg(text, "user").querySelector(".bubble");
  state.history.push({ role: "user", content: text });
  const botRow = addMsg("\u2026", "bot");
  state.currentBotBubble = botRow.querySelector(".bubble");
  setStatus("Thinking\u2026");

  let reply = "";

  // Did the brain already answer these exact words during the pause? If so the
  // slowest stage of the pipeline has already happened and we can speak now.
  const pre = _pendingReply && _pendingReply.key === _normKey(text) ? _pendingReply : null;
  _pendingReply = null;
  if (pre) {
    try { reply = await pre.promise; } catch (e) { reply = ""; }
    if (reply) {
      if (state.currentBotBubble) state.currentBotBubble.textContent = reply;
      speakText(reply, seq);
    }
  }

  if (!reply && state.backend) {
    const body = { text, lang: LANG, history: state.history.slice(-8) };
    if (hasNimBrain()) { body.provider = "nvidia"; body.api_key = state.nimKey; body.model = state.nimModel; }
    try {
      reply = await streamReply(body, seq);         // streams text + speaks per sentence
    } catch (e) {
      // Streaming unavailable -> one-shot endpoint, then speak it chunked.
      try {
        const rr = await fetch("/api/reply", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await rr.json();
        reply = d.reply || "";
      } catch (e2) { reply = ""; }
      if (state.currentBotBubble) state.currentBotBubble.textContent = reply || "";
      if (reply) speakText(reply, seq);
    }
  }
  if (!reply) {
    reply = "I'm here to help with that.";
    if (state.currentBotBubble) state.currentBotBubble.textContent = reply;
    speakText(reply, seq);
  }
  state.history.push({ role: "assistant", content: reply });
  if (state.history.length > 16) state.history = state.history.slice(-16);
  setStatus(hasNimBrain() ? "Brain: NVIDIA NIM (your key)." : "Ready.");

  // Wait for this turn's speech to finish before auto-listening again.
  try { await state.ttsChain; } catch (e) {}
  // In call mode the mic was never closed, so there is nothing to reopen - we
  // just make sure the recognizer is still alive after the reply.
  if (state.inCall) { _ensureAlive(); return; }
  if (seq === state.speakSeq && $("autoListen").checked && recognition && !state.listening) startListening();
}

function resetConversation() {
  stopSpeaking();
  state.history = [];
  const conv = $("conversation");
  if (conv) conv.innerHTML = "";
  addMsg("Hi! How can I help you today?", "bot");
  setStatus("New conversation started.");
}

/* ---------------- speech-to-text (GPT-4o-style smart turn-taking) ----------
   Instead of firing the moment the browser marks a result "final" (which cuts
   people off mid-thought), we keep the mic open and watch for a natural PAUSE.
   An adaptive silence timer decides whether you've truly finished a thought or
   are just thinking for a second — exactly how a good human agent waits its
   turn. This mirrors "semantic endpointing": finished sentences get a snappy
   ~200-400ms human gap; hesitations ("and", "so", "um", trailing comma) get a
   longer patient gap so a 1-second pause never interrupts you. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let _endpointTimer = null;
let _finalBuf = "";      // finalized transcript collected so far this turn
let _lastInterim = "";   // latest not-yet-final words

// Trailing cues that mean the speaker is probably NOT done yet -> wait longer.
const _HESITATION = /(\b(and|but|so|or|because|cause|well|um+|uh+|erm+|hmm+|like|the|a|an|to|of|for|with|i|i'm|i am|i think|i mean|maybe|actually|then|if|when|that|my|your|our|is|it's|it is|we|they|you|let me|give me|hold on|one sec|wait)\s*$|,\s*$|-\s*$)/i;
// A clearly complete sentence -> respond fast, like a natural human gap.
const _COMPLETE = /[.!?]\s*$/;

/* --- microphone pre-warm + real audio VAD ---------------------------------
   Two problems the browser recognizer alone cannot solve:
   1) start() has to power the mic up every single turn, and that startup
      swallows your first word or two. We now hold ONE mic stream open for the
      whole session instead of reopening it constantly.
   2) The recognizer only reports words it has ALREADY transcribed. If you are
      still talking but it has not caught up, silence is indistinguishable from
      thinking. So we also measure real microphone energy and refuse to end a
      turn while the mic can still physically hear you. */
let _micStream = null, _audioCtx = null, _analyser = null, _vadData = null;
let _lastVoiceAt = 0;
let _noiseFloor = 0.012;          // adapts to the room, so a noisy office still works
const VAD_HANGOVER_MS = 420;      // keep "voice active" this long after last energy

// ---------------------------------------------------------------------------
// TURBO CAPTURE (the "words taker")
//
// The browser's SpeechRecognition is the weakest part of the stack: slow finals
// and silently dropped words. So we ALSO record the raw audio of each turn from
// the already-open mic stream and send it to a Parakeet-class ASR model, which
// transcribes a spoken turn in milliseconds of model time instead of waiting on
// the browser. The browser text is still used for instant live captions and for
// pause detection, but the recorded audio decides the FINAL words.
// ---------------------------------------------------------------------------
let _recorder = null;
let _chunks = [];
let _turboReady = false;      // set from /api/stt-status
let _turboMime = "";
// Why this is not smaller: when this timer fires we THROW AWAY the good model
// transcript and fall back to the browser's, which is the component that drops
// words. At 1500ms, measured from after the pause had already elapsed, that
// happened constantly - so the accurate recogniser was being paid for and then
// discarded, which is a large part of why capture felt bad. The clock now
// starts during the pause (see speculative transcription), so a longer ceiling
// costs nothing in the common case and rescues the slow ones.
const TURBO_WAIT_MS = 3000;
// v0.0.32 - WHY "SOMETIMES RIGHT, SOMETIMES WRONG" HAPPENED.
// Every upload shared ONE 3s deadline. On the final pass that is far too tight:
// a cold model or a slow network blew the deadline, the accurate result was
// thrown away, and the browser's own recogniser - a completely DIFFERENT engine
// with different words - was used instead. Fast network: right words. Slow
// network: wrong words. Same sentence, same speaker, different outcome, which is
// exactly the randomness reported.
// So the two jobs get two budgets. Speculative passes stay impatient because
// they are only guesses and a late guess is worthless. The FINAL pass, which
// decides what you actually said, is patient - the reply is already being warmed
// from the speculation, so waiting here costs no perceived latency.
// v0.0.42 - THE FIX FOR "IT TAKES 4-7 SECONDS TO WRITE WHAT I SAID".
// This was 9000ms, and _submitTurn used to AWAIT it before displaying a single
// word or asking the brain anything. So the pipeline was strictly serial:
// finish speaking -> pause timer -> upload -> wait for the model -> only THEN
// show the words and start thinking. On a slow upload that is exactly the
// "he waits on purpose" feeling, because he was: the words were already known
// by the browser and deliberately withheld until the model replied.
// It is now only an ABORT ceiling for a hung request, never a wait the caller
// experiences - the dispatch budget below decides when we stop waiting.
//
// v0.0.43 - AND IT MUST STAY GENEROUS. Lowering this to 2500 in v0.0.42 broke
// capture completely for anyone whose browser recogniser produces nothing (no
// SpeechRecognition support, denied permission, or simply a miss): in that case
// the server ASR is the ONLY source of words, so aborting it early meant no
// words at all. Decoupling the *wait* from the *ceiling* was right; shortening
// the ceiling was not. The ceiling exists only to kill a hung socket.
const TURBO_FINAL_WAIT_MS = 9000;
// How long a turn may wait for the better transcript before we go anyway.
// Fast ASR normally lands well inside this, so accuracy is kept in the common
// case; when it does not, the caller is answered immediately from the words we
// already have and the transcript is corrected afterwards.
const DISPATCH_BUDGET_MS = 650;
const LIVE_WAIT_MS = 2200;          // a live guess: never allowed to pile up

function _pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const tries = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of tries) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {}
  }
  return "";
}

async function _checkTurbo() {
  try {
    const r = await fetch("/api/stt-status");
    const s = await r.json();
    _turboMime = _pickRecorderMime();
    // Needs a server-side ASR key AND a browser that can record audio.
    _turboReady = !!(s && s.ready) && !!_turboMime;
    const info = document.getElementById("engineInfo");
    if (_turboReady && info) {
      info.textContent = "Turbo capture: " + (s.model || "NVIDIA ASR");
    }
  } catch (e) { _turboReady = false; }
  return _turboReady;
}

// Records continuously while the line is open. We slice per turn rather than
// stopping and restarting, because restarting a recorder loses the first
// syllables - exactly the "it did not capture what I said" bug.
function _startRecorder() {
  if (!_turboReady || !_micStream || _recorder) return;
  try {
    // 32kbps was starving the recogniser. Opus mono is still tiny to upload but
    // keeps the high-frequency detail that consonants live in, and consonants
    // are exactly what a mis-transcription gets wrong.
    // v7.2 - 48kbps Opus was audibly lossy on sibilants and plosives, which is
    // exactly what separates "sixty" from "sixteen" or "can" from "can't".
    // 64kbps mono Opus is transparent for speech and costs ~2KB/s more.
    _recorder = new MediaRecorder(_micStream, { mimeType: _turboMime, audioBitsPerSecond: 64000 });
  } catch (e) { _recorder = null; _turboReady = false; return; }
  _chunks = [];
  _recorder.ondataavailable = (e) => {
    // v0.0.36 - DO NOT RECORD OUR OWN VOICE.
    // These chunks are uploaded to the ASR model, and the model's result
    // outranks the browser transcript. Recording through playback therefore
    // guaranteed that the agent's own words could be returned as the user's
    // words. Dropping them costs the first fraction of a second of a barge-in,
    // which the browser recogniser still catches from the start, and it is the
    // only way to be certain the uploaded audio contains you and not us.
    if (state.speaking) return;
    if (e.data && e.data.size > 0) _chunks.push(e.data);
    // Bound memory on very long calls (about the last 60s of 100ms slices).
    // v0.0.34 - must outlive MAX_TURN_WAIT_MS (45s), or the oldest audio would
    // be discarded while the turn was still open and the final transcript would
    // be missing the START of what you said. At 100ms per chunk, 900 is 90s.
    if (_chunks.length > 900) _chunks.splice(0, _chunks.length - 900);
  };
  _recorder.onerror = () => { _turboReady = false; };
  try { _recorder.start(100); _startLiveCapture(); } catch (e) { _recorder = null; _turboReady = false; }
}

function _stopRecorder() {
  _stopLiveCapture();
  if (_recorder) {
    try { if (_recorder.state !== "inactive") _recorder.stop(); } catch (e) {}
  }
  _recorder = null;
  _chunks = [];
}

// Takes everything recorded since the last turn and clears the buffer.
function _takeTurnAudio() {
  if (!_chunks.length) return null;
  const blob = new Blob(_chunks, { type: _turboMime || "audio/webm" });
  _chunks = [];
  _resetLiveCapture();   // the turn is over: start the next one clean
  return blob.size > 1200 ? blob : null;   // ignore pure silence/click
}

// Non-destructive copy, so we can start transcribing BEFORE the turn is over
// without stealing audio from the real submit.
function _snapshotAudio() {
  if (!_chunks.length) return null;
  const n = _chunks.length;
  const blob = new Blob(_chunks, { type: _turboMime || "audio/webm" });
  return blob.size > 1200 ? { blob: blob, n: n } : null;
}

// ---------------------------------------------------------------------------
// SPECULATIVE TRANSCRIPTION - the fix for "everything happens one after another"
//
// The pipeline used to be strictly serial: you stop talking -> we wait out the
// full pause timer -> ONLY THEN do we start uploading your audio -> wait for
// the model -> then think -> then speak. The upload and the pause were stacked
// on top of each other even though the audio was already sitting in memory.
//
// Now the moment you pause we start transcribing in the background, in
// parallel with the pause countdown. If you really were finished, the words
// are usually already back by the time the timer fires and the ASR cost drops
// to roughly zero. If you carry on talking, the speculative result is simply
// discarded and we transcribe the complete turn instead. Wasted work is far
// cheaper than wasted seconds.
// ---------------------------------------------------------------------------
let _pendingAsr = null;   // { n, promise }

/* ---------------- v6.7: streaming word capture (LocalAgreement-2) ---------
   Until now, words only appeared when you STOPPED talking. That is batch
   capture, and it is the real reason the words felt slow: nothing could even
   begin until the whole turn had been uploaded. Every serious streaming agent
   commits words WHILE you are still speaking.

   The naive way to do that - re-transcribe the whole turn every second - is a
   documented disaster. The audio keeps growing, each pass costs more than the
   last, and latency runs away (a widely reported 3s -> 10s -> 30s spiral on
   CPU). So the window here is BOUNDED. We always resend the container header
   (chunk 0, without which a webm slice cannot be decoded at all) plus a
   rolling tail - never the whole turn. Cost per pass stays flat no matter how
   long you talk.

   Fast AND right is the hard part, and it is exactly what was asked for.
   Partial hypotheses flicker: "i am" becomes "i'm", then "i am a". Printing
   every guess would be fast and WRONG. So we use LocalAgreement-2, the
   algorithm behind whisper_streaming: run the recogniser repeatedly and only
   COMMIT the leading words that two consecutive independent hypotheses agree
   on. Agreement is the confidence signal. A word that survives two passes is
   almost never revised later, so committed text is stable enough to hand to
   the brain immediately, while the unsettled tail stays provisional on screen
   until it stabilises. */
const LIVE_MS = 700;                 // how often we re-examine the audio
const LIVE_MAX_CHUNKS = 400;         // ~40s: past this we stop guessing early
const LIVE_HOLDBACK_WORDS = 2;       // never commit the unstable trailing words
const LIVE_AGREE_PASSES = 3;         // passes a word must survive to be trusted
let _liveTimer = null;
let _liveCommitted = "";          // survived N passes: safe to speculate on
let _liveTail = "";               // provisional, may still be revised
let _liveHyps = [];               // recent hypotheses, for N-way agreement
let _liveBusy = false;
let _liveOverflow = false;        // utterance longer than we can safely window

/* v7.1 - WHY THIS NO LONGER SPLICES AUDIO.

   The old window was [chunks[0]].concat(chunks.slice(-100)): the WebM/Opus
   container header glued onto an arbitrary mid-stream tail. Opus frames
   decoded WITHOUT the frames that precede them are garbage, and the container
   timestamps no longer line up either. So once an utterance passed ~10s the
   model was being handed corrupt audio - and a speech model given corrupt
   audio does not return nothing, it returns confident wrong words. That is
   exactly the "it hears them wrong" symptom.

   A partial window must ALWAYS be a genuine prefix of the recording. We only
   ever send chunks 0..N, so the bytes we upload are a real, decodable file.
   Past the cap we simply stop speculating and let the final pass do the work,
   because being slightly later is infinitely better than being wrong. */
function _liveWindowBlob() {
  if (_chunks.length < 2) return null;
  if (_chunks.length > LIVE_MAX_CHUNKS) { _liveOverflow = true; return null; }
  const blob = new Blob(_chunks.slice(0), { type: _turboMime || "audio/webm" });
  return blob.size > 1200 ? blob : null;
}

const _normWord = (w) => (w || "").toLowerCase().replace(/[^a-z0-9']/g, "");
const _countWords = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;

// The longest leading run of words that BOTH hypotheses agree on.
function _agreedPrefix(a, b) {
  const x = (a || "").trim().split(/\s+/).filter(Boolean);
  const y = (b || "").trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const nx = _normWord(x[i]);
    if (!nx || nx !== _normWord(y[i])) break;
    out.push(x[i]);
  }
  return out.join(" ");
}

/* Words that survived LIVE_AGREE_PASSES consecutive hypotheses, MINUS a
   trailing holdback.

   The holdback is the other half of the accuracy fix. The last words of a
   partial transcript have no right-hand context yet, so they are precisely the
   ones the model gets wrong - and because two windows are cut at nearly the
   same point, they tend to produce the SAME wrong guess. The old pairwise
   check treated that repetition as confirmation, which is how it "agreed" its
   way into confident errors. Requiring three passes AND discarding the
   unsettled tail means we only ever act on words that had real context. */
function _stablePrefix(hyps, holdback) {
  if (!hyps || !hyps.length) return "";
  const split = (s) => (s || "").trim().split(/\s+/).filter(Boolean);
  const lists = hyps.map(split);
  const shortest = Math.min.apply(null, lists.map((l) => l.length));
  const out = [];
  for (let i = 0; i < shortest; i++) {
    const w = _normWord(lists[0][i]);
    if (!w) break;
    let same = true;
    for (let j = 1; j < lists.length; j++) {
      if (_normWord(lists[j][i]) !== w) { same = false; break; }
    }
    if (!same) break;
    out.push(lists[lists.length - 1][i]);   // newest spelling/casing wins
  }
  const keep = Math.max(0, out.length - (holdback || 0));
  return out.slice(0, keep).join(" ");
}

function _liveText() { return (_liveCommitted + " " + _liveTail).trim(); }

function _resetLiveCapture() {
  _liveCommitted = ""; _liveTail = ""; _liveHyps = [];
  _liveBusy = false; _liveOverflow = false;
}

async function _liveTick() {
  // Never let two passes overlap: that is how the runaway spiral starts.
  if (_liveBusy || !_turboReady || state.muted || !state.listening) return;
  // v7.2 - DO NOT TRANSCRIBE OUR OWN VOICE.
  // While the agent is speaking, its audio leaks into the mic. Browser echo
  // cancellation is good but NOT perfect (laptop speakers, high volume, no
  // headset), and whatever leaks through gets transcribed as if the user had
  // said it - the model happily returns the agent's own words as "user" words.
  // That is a direct cause of "it captures wrong words". Barge-in still works:
  // the VAD in _vadLoop listens independently and stops playback, and once
  // playback stops this guard opens again.
  if (state.speaking) return;
  if (!_voiceActive() && !_liveCommitted) return;    // silence: nothing to do
  const blob = _liveWindowBlob();
  if (!blob) return;
  _liveBusy = true;
  try {
    const hyp = await _turboTranscribe(blob, LIVE_WAIT_MS);
    if (!hyp) return;
    _liveHyps.push(hyp);
    if (_liveHyps.length > LIVE_AGREE_PASSES) _liveHyps.shift();
    if (_liveHyps.length < LIVE_AGREE_PASSES) { _liveTail = hyp; return; }
    const stable = _stablePrefix(_liveHyps, LIVE_HOLDBACK_WORDS);
    // Move forward only, AND only when the new prefix still contains what we
    // already committed. If it contradicts us we were wrong about those words,
    // and the right response is to stop speculating rather than double down -
    // the final pass will sort it out.
    if (_countWords(stable) > _countWords(_liveCommitted) &&
        _normKey(stable).indexOf(_normKey(_liveCommitted)) === 0) {
      _liveCommitted = stable;
      // The instant a word is genuinely safe, the brain can start thinking.
      _beginEarlyReply(_liveCommitted);
    }
    _liveTail = hyp.length > _liveCommitted.length
      ? hyp.slice(_liveCommitted.length).trim() : "";
    const shown = _liveText();
    if (shown) { setStatus("Listening\u2026"); setLiveText(shown); }
  } catch (e) {
    /* a dropped partial is harmless - the final pass still runs */
  } finally { _liveBusy = false; }
}

function _startLiveCapture() {
  _resetLiveCapture();
  if (_liveTimer) clearInterval(_liveTimer);
  _liveTimer = setInterval(_liveTick, LIVE_MS);
}

function _stopLiveCapture() {
  if (_liveTimer) clearInterval(_liveTimer);
  _liveTimer = null;
  _resetLiveCapture();
}

function _beginEarlyTranscribe() {
  if (!_turboReady || state.muted) return;
  const snap = _snapshotAudio();
  if (!snap) return;
  // Already speculating on exactly this audio - do not upload it twice.
  if (_pendingAsr && _pendingAsr.n === snap.n) return;
  _pendingAsr = {
    n: snap.n,
    promise: _turboTranscribe(snap.blob).catch(() => ""),
  };
}

// ---------------------------------------------------------------------------
// PREEMPTIVE BRAIN (v6.5)
//
// Speculative transcription removed the ASR from the critical path. The brain
// is what is left, and it is the single most expensive stage - industry
// measurements put the LLM at 60-70% of total voice-agent latency.
//
// So we do the same trick one stage further down: as soon as the words come
// back from the speculative transcription, we start ASKING THE BRAIN, still
// during the pause countdown. If you were finished, the answer is already
// written by the time the turn is committed.
//
// Critically, and exactly like LiveKit's preemptive generation: only the BRAIN
// runs early. Nothing is ever SPOKEN until the turn is genuinely committed, so
// a speculation that turns out wrong is silent and invisible - it costs tokens,
// never a wrong word out loud.
// ---------------------------------------------------------------------------
let _pendingReply = null;   // { key, promise }
const PREEMPTIVE_BRAIN = true;

// Loose match: the committed transcript rarely matches the speculative one
// character for character (punctuation and casing move around), but if the
// words are the same the answer is the same.
function _normKey(t) {
  return (t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function _replyBody(text) {
  const body = {
    text,
    lang: LANG,
    history: state.history.concat([{ role: "user", content: text }]).slice(-8),
  };
  if (hasNimBrain()) { body.provider = "nvidia"; body.api_key = state.nimKey; body.model = state.nimModel; }
  return body;
}

function _beginEarlyReply(text) {
  if (!PREEMPTIVE_BRAIN || !state.backend || state.muted) return;
  const key = _normKey(text);
  // Too short to be a real turn, or we are already speculating on these words.
  if (key.split(" ").filter(Boolean).length < 2) return;
  if (_pendingReply && _pendingReply.key === key) return;
  _pendingReply = {
    key,
    promise: fetch("/api/reply", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_replyBody(text)),
    }).then((r) => r.json()).then((d) => (d && d.reply) || "").catch(() => ""),
  };
}

function _dropEarlyTranscribe() { _pendingAsr = null; _pendingReply = null; }

// Returns the model's transcript, or "" to mean "use the browser's words".
async function _turboTranscribe(blob, waitMs) {
  if (!blob) return "";
  const fd = new FormData();
  fd.append("audio", blob, "turn.webm");
  fd.append("lang", "en");
  const key = localStorage.getItem("vs_nim_key") || "";
  if (key) fd.append("key", key);
  // Keyword boosting: bias the recogniser toward words it would otherwise get
  // wrong - product names, people, reference codes. This is the cheapest
  // accuracy win in speech recognition: no training, no model swap. Set it in
  // Settings, or via VOICE_ASR_HOTWORDS on the server for every caller.
  const boost = (localStorage.getItem("vs_hotwords") || "").trim();
  if (boost) fd.append("boost", boost.slice(0, 900));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), waitMs || TURBO_WAIT_MS);
  try {
    const r = await fetch("/api/stt", { method: "POST", body: fd, signal: ctrl.signal });
    if (!r.ok) {
      // A 503 means no backend is configured; stop paying the upload cost.
      if (r.status === 503) _turboReady = false;
      return "";
    }
    const j = await r.json();
    return (j && typeof j.text === "string") ? j.text.trim() : "";
  } catch (e) {
    return "";   // timeout or offline: the browser transcript still works
  } finally { clearTimeout(t); }
}

async function ensureMic() {
  if (_micStream && _micStream.active) {
    if (_audioCtx && _audioCtx.state === "suspended") { try { await _audioCtx.resume(); } catch (e) {} }
    return true;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // stop the agent's own voice from re-triggering us
        noiseSuppression: true,   // kills fan/street hiss that masked quiet speech
        autoGainControl: true,    // quiet speakers and far-from-mic speakers get boosted
        channelCount: 1,
        // v7.2 - ASR models (Parakeet included) run at 16kHz mono. Asking the
        // browser for it lets the OS resample with a proper anti-alias filter
        // instead of leaving it to a downstream naive decimation. Treated as a
        // hint: browsers that ignore it still work, so this cannot break capture.
        sampleRate: 16000,
      },
    });
  } catch (e) { return false; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    _audioCtx = new AC();
    if (_audioCtx.state === "suspended") { try { await _audioCtx.resume(); } catch (e) {} }
    const src = _audioCtx.createMediaStreamSource(_micStream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 1024;
    _analyser.smoothingTimeConstant = 0.6;
    src.connect(_analyser);
    _vadData = new Float32Array(_analyser.fftSize);
    _vadLoop();
  } catch (e) { _analyser = null; }   // VAD is an enhancement; capture still works without it
  return true;
}

function _vadLoop() {
  if (!_analyser) return;
  _analyser.getFloatTimeDomainData(_vadData);
  let sum = 0;
  for (let i = 0; i < _vadData.length; i++) sum += _vadData[i] * _vadData[i];
  const rms = Math.sqrt(sum / _vadData.length);
  if (!state.muted && rms > _noiseFloor * 2.2) _lastVoiceAt = Date.now();
  else if (!state.muted) _noiseFloor = _noiseFloor * 0.995 + rms * 0.005; // learn the room
  // Live input meter: proof to the caller that they are actually being heard,
  // which is the single most reassuring thing a voice UI can show.
  const meter = document.getElementById("micLevel");
  if (meter) {
    const pct = state.muted ? 0 : Math.min(100, Math.round(Math.sqrt(rms) * 320));
    meter.style.width = pct + "%";
    meter.classList.toggle("hot", pct > 70);
  }
  requestAnimationFrame(_vadLoop);
}

// Fully release the microphone (call ended) so the browser tab drops its
// recording indicator instead of appearing to listen forever.
function releaseMic() {
  _stopRecorder();
  try { if (_micStream) _micStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  try { if (_audioCtx) _audioCtx.close(); } catch (e) {}
  _micStream = null; _audioCtx = null; _analyser = null; _vadData = null;
  const meter = document.getElementById("micLevel");
  if (meter) meter.style.width = "0%";
}

// True while the microphone can still hear you actually talking.
function _voiceActive() {
  if (!_analyser) return false;
  return (Date.now() - _lastVoiceAt) < VAD_HANGOVER_MS;
}

// Listener noises that mean "I'm still here, keep going" - NOT an interruption.
const _BACKCHANNEL = /^((mm+|mhm+|mmhmm+|uh[\s-]?huh|a[\s-]?ha|yeah|yep|yup|ok|okay|sure|right|i see|got it|go on|exactly|true|nice|wow)[\s,.!?]*)+$/i;

// Sounds that are NOT a turn. If this is all we have, you are thinking, not asking.
const _FILLER_ONLY = /^((um+|uh+|erm+|hmm+|mm+|ah+|oh+|er+|like|so|well|okay|ok|yeah|right|and|but|i|i'm|my)[\s,.!?]*)+$/i;
// Short, complete answers. "Yes." IS a whole turn - it is one of the most
// common things anyone says on a support call. The old rule punished these
// with an extra 700ms just for being short, which made the agent feel slow
// exactly when it should have felt instant.
const _CONFIRMATION = /^(yes|yeah|yep|yup|no|nope|nah|correct|right|wrong|sure|okay|ok|please|thanks|thank you|that's right|that is right|that's correct|exactly|done|stop|hello|hi|hey|bye|goodbye|help|agreed|confirm|confirmed|cancel|continue|repeat|again|louder|slower)[\s,.!?]*$/i;

// Someone reading out an email, card, postcode or phone number pauses BETWEEN
// characters. Endpointing on those pauses is the classic way voice agents cut
// people off mid-address. When we see this shape, we get much more patient.
const _SPELLING_OUT = /(\b[a-z0-9]\s+[a-z0-9]\s+[a-z0-9]\b)|@|\bdot\b|\bat\b\s|\bdash\b|\bhyphen\b|\bunderscore\b|\bslash\b|\bzero\b|\bdouble\b/i;

// Trailing conjunction/preposition = the sentence is grammatically unfinished,
// no matter how long the silence is.
const _DANGLING = /\b(and|but|or|so|because|if|when|while|that|which|to|for|with|from|at|on|in|of|my|your|the|a|an|is|are|was|were|will|would|can|could|it's|i'm)\s*$/i;

// v0.0.34 - THE REAL LIMIT, FOUND WHILE CHECKING THE DISPLAY BUG.
// This was 20s, and it is a HARD cut: once the deadline passes the turn is
// submitted even if you are still mid-sentence. So talking for longer than
// twenty seconds genuinely got you cut off - a real limit, not a display
// artefact. 45s covers a long, detailed complaint (roughly 150 words at normal
// speaking pace) while still guaranteeing that a stuck microphone can never
// hang the turn forever, which is what this ceiling exists for.
const MAX_TURN_WAIT_MS = 45000;
let _turnDeadline = 0;

let _earlyTimer = null;
function _clearEndpoint() {
  if (_endpointTimer) { clearTimeout(_endpointTimer); _endpointTimer = null; }
  if (_earlyTimer) { clearTimeout(_earlyTimer); _earlyTimer = null; }
}

// How long to wait (ms) after the last speech before treating the turn as over.
//
// This single function is the largest controllable latency in the whole
// product. A fixed silence timeout taxes every fast turn in order to protect
// the slow ones: wait 1100ms for everybody and you have added a second to
// "yes". So instead of one number we read the SHAPE of what was said and spend
// patience only where it is actually needed.
function _endpointDelay(text) {
  const base = state.endpointMs || 550;
  const t = (text || "").trim();
  if (!t) return base;
  const words = t.split(/\s+/).length;

  // --- be patient: these mean the caller is NOT finished -------------------
  if (_FILLER_ONLY.test(t)) return base + 1400;      // pure thinking noise
  if (_SPELLING_OUT.test(t)) return base + 900;      // reading out an email/number
  if (_DANGLING.test(t)) return base + 850;          // grammatically unfinished
  if (_HESITATION.test(t)) return base + 800;        // clearly mid-thought

  // --- be instant: these are genuinely complete ----------------------------
  // A bare "yes" is a finished turn. Answering it in ~250ms is the single
  // most noticeable speed improvement a caller feels, because confirmations
  // are the most frequent utterance in a support conversation.
  if (_CONFIRMATION.test(t) && words <= 3) return Math.max(220, base - 450);
  if (_COMPLETE.test(t) && words >= 4) return Math.max(260, base - 380);

  // A long utterance without end punctuation is usually still finished; the
  // browser just did not punctuate it. Do not make people wait for that.
  if (words >= 8) return Math.max(300, base - 180);
  if (words <= 2) return base + 420;                 // probably a fragment
  return base;
}

function _submitTurn() {
  if (!state.listening) return;
  const utter = (_finalBuf + " " + _lastInterim).trim();
  if (!utter) { _clearEndpoint(); return; }
  // Hold the turn open if the mic still hears you, or if all you have said so
  // far is a filler noise. This is what stops "um... I think..." being sent as
  // the single word "um". The deadline guarantees we still always answer.
  if ((_voiceActive() || _FILLER_ONLY.test(utter)) && Date.now() < _turnDeadline) {
    _clearEndpoint();
    _endpointTimer = setTimeout(_submitTurn, 260);
    return;
  }
  _finalBuf = ""; _lastInterim = ""; _turnDeadline = 0; setLiveText("");
  // Snapshot what the agent just said BEFORE forgetting it. The transcript for
  // this turn arrives asynchronously, and it may well be our own voice picked
  // up by an open microphone - so the async paths need something to compare
  // against after the live buffer has been cleared.
  const echoRef = _agentSaid;
  _forgetAgentSpeech();   // this turn is yours; our last reply is history now
  _clearEndpoint();

  // Did the speculative upload already cover this exact turn? It has if no new
  // audio arrived after it started. That is the common case when you have
  // genuinely finished speaking, and it means the transcript is already in
  // flight (often already back) instead of starting from zero right now.
  const covered = _pendingAsr && _pendingAsr.n === _chunks.length;
  const early = covered ? _pendingAsr.promise : null;
  _pendingAsr = null;

  // Grab the recorded audio for this turn BEFORE anything async can add more.
  const audio = _turboReady ? _takeTurnAudio() : null;
  // In call mode the microphone NEVER closes between turns - this is a phone
  // call, not a walkie-talkie. We only clear the buffer and keep listening.
  if (!state.inCall) stopListening();

  if (early) { _dispatchTurn(early, utter, echoRef); return; }
  if (!audio) { _answer(utter, echoRef); return; }
  // Fast ASR decides the final wording; the browser transcript is the safety
  // net. Crucially we no longer WAIT for it before answering - see _dispatchTurn.
  _dispatchTurn(_turboTranscribe(audio, TURBO_FINAL_WAIT_MS), utter, echoRef);
}

// ---------------------------------------------------------------------------
// TURN DISPATCH (v0.0.42)
//
// The rule that used to govern this path was "the model transcript always
// wins", which is right for ACCURACY and was wrong for LATENCY, because it was
// implemented as "nothing happens until the model answers". Those are not the
// same requirement and they do not need the same code.
//
// So: give the better transcript a short, bounded chance to arrive. If it does
// - the normal case - it is used, exactly as before, and accuracy is unchanged.
// If it does not, we answer NOW using the words the browser already gave us,
// and quietly correct the transcript on screen when the model catches up. The
// caller never waits on a network round trip they cannot see.
// ---------------------------------------------------------------------------
let _lastUserBubble = null;

function _raceBudget(promise, ms) {
  return Promise.race([
    promise.then((t) => ({ arrived: true, text: (t || "").trim() }))
           .catch(() => ({ arrived: true, text: "" })),
    new Promise((res) => setTimeout(() => res({ arrived: false, text: "" }), ms)),
  ]);
}

// Fix the transcript on screen after the fact. This never re-speaks and never
// re-asks the brain: the answer is already being spoken, and swapping words
// mid-sentence would be far more jarring than a corrected line of text.
function _lateCorrect(model, dispatched, echoRef) {
  const m = (model || "").trim();
  if (!m || !_lastUserBubble) return;
  // A correction must never paste our own voice into the caller's line either.
  if (_looksLikeEchoIn(m, echoRef)) return;
  if (_normKey(m) === _normKey(dispatched)) return;
  _lastUserBubble.textContent = m;
  _lastUserBubble.title = "corrected by the speech model";
}

// THE ONLY WAY A TURN REACHES THE BRAIN.
// Every path funnels through here so the echo test cannot be forgotten on one
// of them again - which is precisely what happened when the model and live
// paths were added and only the browser recogniser was being filtered.
function _answer(text, echoRef) {
  const t = (text || "").trim();
  if (!t) return;
  if (_looksLikeEchoIn(t, echoRef)) {
    // Our own voice came back through the microphone. Say nothing, and do not
    // let it enter the history as if the caller had said it.
    if (state.inCall) setStatus("Listening\u2026");
    return;
  }
  handleUserText(t);
}

function _dispatchTurn(asrPromise, utter, echoRef) {
  const heard = (utter || "").trim();
  if (!asrPromise) { _answer(heard, echoRef); return; }
  // If the browser gave us nothing at all, the model is our ONLY source and we
  // have no choice but to wait for it.
  if (!heard) {
    // The model is our only source, so we genuinely have to wait for it - but
    // we must never end up silent. If it yields nothing, fall back to whatever
    // the live pass committed during the turn; that is still real recognised
    // speech, and an imperfect transcript beats ignoring the caller entirely.
    // But waiting up to the ceiling is only acceptable when we have NOTHING
    // else. If the live pass already recognised words during the turn, that is
    // real speech and we can answer at the normal budget instead of sitting
    // through the whole upload - which is the "capturing is too slow" symptom
    // for anyone whose browser recogniser is not producing final results.
    const live0 = (_liveCommitted || "").trim();
    if (live0) {
      _raceBudget(asrPromise, DISPATCH_BUDGET_MS).then((r) => {
        if (r.arrived) { _answer(_bestTranscript(r.text, live0), echoRef); return; }
        _answer(live0, echoRef);
        asrPromise.then((better) => _lateCorrect(_bestTranscript(better, live0), live0, echoRef))
                  .catch(() => {});
      });
      return;
    }
    asrPromise
      .then((better) => _answer((better || "").trim() || (_liveCommitted || "").trim(), echoRef))
      .catch(() => _answer((_liveCommitted || "").trim(), echoRef));
    return;
  }
  _raceBudget(asrPromise, DISPATCH_BUDGET_MS).then((r) => {
    if (r.arrived) { _answer(_bestTranscript(r.text, heard), echoRef); return; }
    _answer(heard, echoRef);
    asrPromise.then((better) => _lateCorrect(_bestTranscript(better, heard), heard, echoRef))
              .catch(() => {});
  });
}

// Chooses between the model transcript and the browser transcript.
// The model wins when it produced anything usable, because the browser is the
// component that drops words. We only keep the browser text when the model
// returned nothing, or returned something suspiciously shorter (a truncated
// upload) than what the browser already heard.
function _bestTranscript(model, browser) {
  const m = (model || "").trim();
  const b = (browser || "").trim();
  // If the final pass gave us nothing, the words we already committed during
  // the turn are still the best record of what was actually said - and they
  // came from the good model, not the browser.
  // v7.1 - THE FIX FOR "IT HEARS THE WRONG WORDS".
  // Live partial text is SPECULATION, never truth. The final pass sees the
  // complete utterance with full context on both sides of every word, so it
  // always wins when it produced anything at all. Previously live text could
  // override it whenever it was longer, which permanently locked in words that
  // had been guessed from a half-finished sentence - the accurate result was
  // computed and then thrown away. Live words now survive only as a last
  // resort, when neither the model nor the browser gave us anything.
  const live = (_liveCommitted || "").trim();
  if (!m && !b) return live;
  if (!m) return b;
  if (!b) return m;
  // v0.0.32 - THE BROWSER MAY NEVER OVERRIDE THE MODEL.
  // This used to hand the turn to the browser whenever the model's text was
  // less than half the browser's word count, on the theory that a short model
  // result meant a truncated upload. That theory was wrong and the cure was
  // worse: the browser recogniser is a DIFFERENT engine that hears different
  // words, so this swapped in a whole alternative transcript on a length
  // heuristic. Legitimately terse speech ("yes", "tomorrow please") tripped it
  // constantly, which is why the same phrase came out right one time and wrong
  // the next.
  // The model is the accurate engine, full stop. If it returned anything, that
  // is what was said. The browser is a fallback for when the model returns
  // NOTHING - never a competitor to it.
  return m;
}

// Fresh speech restarts the pause clock (VAD-style), so we only reply once the
// caller has genuinely paused for their chosen gap.
function _scheduleEndpoint() {
  _clearEndpoint();
  const text = (_finalBuf + " " + _lastInterim).trim();
  if (!text) return;
  if (!_turnDeadline) _turnDeadline = Date.now() + MAX_TURN_WAIT_MS;
  const delay = _endpointDelay(text);
  _endpointTimer = setTimeout(_submitTurn, delay);
  // Start transcribing a short moment into the pause, in parallel with the
  // countdown. Every new word clears this timer, so we only ever speculate on
  // a genuine pause rather than uploading on every syllable.
  _earlyTimer = setTimeout(() => {
    _beginEarlyTranscribe();
    // Chain the brain onto the speculative words. If the fast recogniser is
    // unavailable we fall back to the browser's interim text, which is good
    // enough to guess with - a wrong guess is silent, never spoken.
    if (_pendingAsr) {
      const p = _pendingAsr;
      p.promise.then((words) => {
        if (_pendingAsr === p) _beginEarlyReply(_bestTranscript(words, text));
      }).catch(() => {});
    } else {
      _beginEarlyReply(text);
    }
  }, Math.max(160, Math.min(260, Math.round(delay / 2))));
}

if (SR) {
  recognition = new SR();
  recognition.continuous = true;      // keep the stream open; WE decide when the turn ends
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = "en-US";
  recognition.onresult = (ev) => {
    if (state.muted) return;          // held mute: hear nothing, stay connected

    // v0.0.36 - finals from THIS event are held in a local first. The old code
    // appended them straight into _finalBuf BEFORE deciding whether they were
    // even yours, so anything the mic picked up from the speakers was already
    // committed to your turn by the time we looked at it. Nothing is committed
    // now until it has passed the echo test.
    let interim = "";
    let fresh = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const seg = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) fresh += (fresh ? " " : "") + seg.trim();
      else interim += seg;
    }

    // ---- barge-in, backchannel suppression, echo rejection --------------
    // The mic is live while the agent talks, so there are THREE possibilities,
    // not two: you interrupted, you said "mm-hmm" to show you are listening, or
    // what we heard was our own voice leaking back in. Cutting the agent off
    // for a "yeah" is one of the most annoying failures in voice agents, and
    // submitting our own sentence as your turn is one of the most confusing.
    //
    // The backchannel decision is made on the WHOLE accumulated turn, not just
    // this event: judging "yeah" alone would discard it while leaving real words
    // you said a moment earlier stranded in the buffer with nothing to send them.
    // When the whole turn really is nothing but noise, clearing it is correct -
    // that is what stops "yeah" being submitted as a question.
    const shown = (_finalBuf + " " + fresh + " " + interim).trim();
    if (state.speaking && shown) {
      if (_BACKCHANNEL.test(shown) || _FILLER_ONLY.test(shown)) {
        _finalBuf = ""; _lastInterim = ""; _dropEarlyTranscribe(); return;
      }
      if (_rejectEcho(fresh, interim)) return;
      if (fresh) _finalBuf += (_finalBuf ? " " : "") + fresh;
      _lastInterim = interim;
      stopSpeaking();                 // real words -> yield the floor at once
      setStatus("Go ahead\u2026");
    } else {
      if (fresh) _finalBuf += (_finalBuf ? " " : "") + fresh;
      _lastInterim = interim;
    }

    const display = (_finalBuf + " " + _lastInterim).trim();
    if (display) { setStatus("Listening\u2026"); setLiveText(display); }
    _scheduleEndpoint();              // any new speech resets the pause clock
  };
  recognition.onerror = (e) => {
    const err = e && e.error;
    if (err === "no-speech" || err === "aborted") return;   // normal, keep waiting
    // In a call, a transient error must never hang up the line - the watchdog
    // revives it. Only a genuine permission failure ends the call.
    if (state.inCall && err !== "not-allowed" && err !== "service-not-allowed") {
      _restartRecognition();
      return;
    }
    if (err === "not-allowed" || err === "service-not-allowed") {
      setStatus("Microphone permission denied \u2014 allow mic access to talk.");
      if (state.inCall) endCall();
      return;
    }
    _clearEndpoint(); stopListening();
  };
  recognition.onstart = () => { _recogRunning = true; _restartTries = 0; };
  recognition.onend = () => {
    _recogRunning = false;
    // Chrome closes the stream by itself after a short silence even when
    // continuous is true. The old code treated that as "the caller finished"
    // and fired off whatever it had -- which is EXACTLY why a thinking pause
    // after "um" got submitted as the word "um". onend must never end a turn.
    // We keep the words, restart the recognizer at once, and let the pause
    // timer and the microphone decide when you are genuinely done.
    if (!state.listening) return;
    if (_lastInterim.trim()) {
      _finalBuf += (_finalBuf ? " " : "") + _lastInterim.trim();
      _lastInterim = "";
    }
    _restartRecognition();
  };
}

// Restarting can throw if the previous session has not fully torn down yet, so
// back off and retry rather than silently dropping the microphone mid-call.
//
// v6.4 - THE BUG THAT KILLED EVERY CALL.
// start() throws InvalidStateError when the recognizer is ALREADY RUNNING,
// which is the healthiest possible state. The old code counted that throw as a
// failure. The 3-second watchdog called this function on every tick believing
// it was a no-op, so a completely healthy call burned one "retry" every 3
// seconds and, after 8 of them (~24s in), showed "Microphone stopped
// unexpectedly" and shut the microphone off. The keep-alive was the killer.
//
// The fix is to know whether we are actually running instead of inferring it
// from an exception, and to treat "already running" as success.
let _restartTries = 0;
let _recogRunning = false;
let _restartPending = false;

function _restartRecognition() {
  if (!state.listening) return;
  if (_recogRunning) { _restartTries = 0; return; }   // genuinely a no-op now
  if (_restartPending) return;
  try {
    recognition.start();
    _restartTries = 0;
  } catch (e) {
    // InvalidStateError means it is already live: success, not failure.
    if (e && (e.name === "InvalidStateError" || /already start/i.test(e.message || ""))) {
      _recogRunning = true;
      _restartTries = 0;
      return;
    }
    // Anything else: back off and try again. In a call we NEVER give up, we
    // just keep retrying more slowly - hanging up on the caller is worse than
    // a second of dead air.
    _restartPending = true;
    const wait = Math.min(1500, 90 * (_restartTries + 1));
    _restartTries++;
    setTimeout(() => { _restartPending = false; _restartRecognition(); }, wait);
    // v6.6 - DO NOT ACCUSE THE MICROPHONE OF DYING WHILE IT IS RECOVERING.
    //
    // The v6.4 fix stopped the watchdog killing the call, but this message was
    // still printed the instant the counter hit 8 - even though the very next
    // retry usually succeeded. Restarting throws repeatedly for a moment while
    // Chrome tears the previous session down, which is exactly what happens
    // when you stop talking and we hand the turn over. So the user got an
    // alarming "microphone stopped" on a microphone that was perfectly fine.
    //
    // Now we wait, check whether we recovered, and if we really are dead we
    // silently re-acquire the device and restart ourselves. The message is a
    // last resort after self-healing has genuinely failed.
    if (_restartTries === 8) {
      setTimeout(async () => {
        if (_recogRunning || !state.listening) return;       // recovered - say nothing
        let ok = false;
        try { ok = await ensureMic(); } catch (e) { ok = false; }
        if (_recogRunning || !state.listening) return;
        if (ok) { _restartTries = 0; _restartRecognition(); return; }   // self-healed
        if (!state.inCall) {
          setStatus("Microphone stopped unexpectedly \u2014 click the mic to resume.");
        }
      }, 1400);
    }
  }
}

/* ---------------- call mode: an open line, not a walkie-talkie -------------
   Chrome's recognizer is documented to die on its own after roughly a minute or
   two of silence, and it can also fail silently mid-call. A single restart on
   'end' is not enough, so a watchdog independently verifies every few seconds
   that the line is genuinely still open and revives it if not. That is what
   makes "the mic never stops until I stop it" actually true in practice. */
let _aliveTimer = null;
let _timerTick = null;

function _ensureAlive() {
  if (!state.inCall) return;
  if (!state.listening) { startListening(); return; }
  if (_recogRunning) return;   // healthy: leave it completely alone
  _restartRecognition();       // genuinely dead: revive it
}

function _fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

async function startCall() {
  if (state.inCall) return;
  const micOk = await ensureMic();
  if (!micOk) {
    setStatus("Microphone blocked \u2014 allow mic access in your browser to start a call.");
    return;
  }
  state.inCall = true;
  state.muted = false;
  state.callStartedAt = Date.now();
  document.body.classList.add("in-call");
  _syncCallUi();
  await startListening();
  // Watchdog: the line stays open until YOU end the call.
  if (_aliveTimer) clearInterval(_aliveTimer);
  _startRecorder();   // turbo capture rides along on the open mic stream
  _aliveTimer = setInterval(_ensureAlive, 3000);
  if (_timerTick) clearInterval(_timerTick);
  _timerTick = setInterval(_syncCallUi, 1000);
  setStatus("Call connected \u2014 just talk. The mic stays open until you end the call.");
}

function endCall() {
  state.inCall = false;
  state.muted = false;
  if (_aliveTimer) { clearInterval(_aliveTimer); _aliveTimer = null; }
  if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
  _clearEndpoint();
  stopSpeaking();
  stopListening();
  releaseMic();
  document.body.classList.remove("in-call");
  const dur = state.callStartedAt ? _fmtDuration(Date.now() - state.callStartedAt) : "";
  state.callStartedAt = 0;
  _syncCallUi();
  setStatus(dur ? ("Call ended (" + dur + ").") : "Call ended.");
}

function toggleCall() { state.inCall ? endCall() : startCall(); }

function toggleMute() {
  if (!state.inCall) return;
  state.muted = !state.muted;
  // Muting must not drop the line: we keep the stream and simply stop feeding
  // it into the conversation, so unmuting is instant with no re-permission.
  if (_micStream) _micStream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
  if (state.muted) { _clearEndpoint(); _dropEarlyTranscribe(); _finalBuf = ""; _lastInterim = ""; }
  _syncCallUi();
  setStatus(state.muted ? "Muted \u2014 still connected." : "Unmuted \u2014 go ahead.");
}

// Reflect call state in the UI (button labels, timer, mute state).
function _syncCallUi() {
  const btn = $("callBtn");
  if (btn) {
    btn.textContent = state.inCall ? "End call" : "Start call";
    btn.classList.toggle("danger", state.inCall);
  }
  const mute = $("muteBtn");
  if (mute) {
    mute.hidden = !state.inCall;
    mute.textContent = state.muted ? "Unmute" : "Mute";
    mute.classList.toggle("active", state.muted);
  }
  const t = $("callTimer");
  if (t) {
    t.hidden = !state.inCall;
    if (state.inCall) t.textContent = _fmtDuration(Date.now() - state.callStartedAt);
  }
}

async function startListening() {
  if (!recognition) {
    setStatus("Your browser has no speech recognition \u2014 please type instead (Chrome/Edge support voice).");
    return;
  }
  stopSpeaking();  // barge-in: talking over the agent interrupts it
  // Open (or reuse) the mic BEFORE starting recognition so device startup does
  // not eat your first word.
  const micOk = await ensureMic();
  if (!micOk) {
    setStatus("Microphone blocked \u2014 allow mic access in your browser, or type instead.");
    return;
  }
  _finalBuf = ""; _lastInterim = ""; _turnDeadline = 0; setLiveText(""); _restartTries = 0;
  _lastVoiceAt = Date.now();   // grace period so we never cut off your opening word
  try {
    recognition.lang = "en-US";
    recognition.start();
    state.listening = true;
    $("mic").classList.add("listening");
    $("mic").querySelector(".mic-label").textContent = "Listening\u2026";
    setStatus("Listening\u2026 speak now.");
  } catch (e) { /* already started */ }
}
function stopListening() {
  state.listening = false;
  _clearEndpoint();
  _dropEarlyTranscribe();
  $("mic").classList.remove("listening");
  $("mic").querySelector(".mic-label").textContent =
    state.micMode === "hold" ? "Hold to talk" : "Click to talk";
  try { recognition && recognition.stop(); } catch (e) {}
}

function toggleListening() { state.listening ? stopListening() : startListening(); }

/* ---------------- customizable hotkeys ---------------- */
// Build a normalized combo string from a keyboard event, e.g. "Ctrl+M", "Space".
function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  let k = e.code || e.key;
  // Prefer readable names for common keys.
  if (e.code === "Space" || e.key === " ") k = "Space";
  else if (e.key === "Escape") k = "Escape";
  else if (e.key && e.key.length === 1) k = e.key.toUpperCase();
  else if (e.code && e.code.startsWith("Key")) k = e.code.slice(3);
  else if (e.code && e.code.startsWith("Digit")) k = e.code.slice(5);
  else k = e.key || e.code;
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return parts.join("+"); // modifier only
  parts.push(k);
  return parts.join("+");
}

function typingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

function applyHotkeyLabels() {
  const t = $("hotkeyTalk"); if (t) t.value = state.hotkeyTalk || "";
  const s = $("hotkeyStop"); if (s) s.value = state.hotkeyStop || "";
  const mm = $("micMode"); if (mm) mm.value = state.micMode;
  const micLbl = $("mic") && $("mic").querySelector(".mic-label");
  if (micLbl && !state.listening) micLbl.textContent = state.micMode === "hold" ? "Hold to talk" : "Click to talk";
}

// Let a shortcut box capture the next key combo the user presses.
function bindHotkeyCapture(inputId, storageKey, stateKey) {
  const el = $(inputId);
  if (!el) return;
  el.addEventListener("focus", () => { el.value = "Press keys\u2026"; });
  el.addEventListener("blur", () => applyHotkeyLabels());
  el.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Backspace" || e.key === "Delete") {
      state[stateKey] = "";
      localStorage.setItem(storageKey, "");
      el.value = "";
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo || ["Ctrl", "Alt", "Shift", "Meta"].includes(combo)) return; // wait for a real key
    state[stateKey] = combo;
    localStorage.setItem(storageKey, combo);
    el.value = combo;
    el.blur();
  });
}

function handleGlobalHotkey(e) {
  if (typingInField()) return;             // don't hijack typing
  const combo = comboFromEvent(e);
  if (state.hotkeyStop && combo === state.hotkeyStop) {
    e.preventDefault();
    stopSpeaking();
    if (state.listening) stopListening();
    setStatus("Stopped.");
    return;
  }
  if (state.hotkeyTalk && combo === state.hotkeyTalk) {
    e.preventDefault();
    if (state.micMode === "hold") { if (!state.listening) startListening(); }
    else { toggleListening(); }
  }
}

function handleGlobalHotkeyUp(e) {
  if (state.micMode !== "hold") return;
  if (typingInField()) return;
  const combo = comboFromEvent(e);
  // For hold mode, releasing the talk key stops listening.
  if (state.hotkeyTalk && (combo === state.hotkeyTalk || e.key === " " || e.code === "Space")) {
    if (state.listening) stopListening();
  }
}

/* ---------------- wire up ---------------- */
function wire() {
  const mic = $("mic");
  // Mic behavior depends on the chosen mode:
  //  - "toggle" (default): ONE click starts, another click stops.
  //  - "hold": press and hold (walkie-talkie) for people who prefer it.
  // Call controls: one click opens the line and it STAYS open until End call.
  _checkTurbo();   // decide the best 'words taker' before the first turn
  const callBtn = $("callBtn");
  if (callBtn) callBtn.onclick = toggleCall;
  const muteBtn = $("muteBtn");
  if (muteBtn) muteBtn.onclick = toggleMute;
  _syncCallUi();

  // Ending the call properly on tab close releases the mic indicator.
  window.addEventListener("beforeunload", () => { if (state.inCall) endCall(); });
  // Browsers suspend audio in background tabs; revive the line on return.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.inCall) { ensureMic().then(_ensureAlive); }
  });

  mic.addEventListener("click", () => { if (state.micMode !== "hold") toggleListening(); });
  mic.addEventListener("mousedown", () => { if (state.micMode === "hold" && !state.listening) startListening(); });
  mic.addEventListener("mouseup", () => { if (state.micMode === "hold" && state.listening) stopListening(); });
  mic.addEventListener("mouseleave", () => { if (state.micMode === "hold" && state.listening) stopListening(); });
  // Touch support for hold mode on mobile.
  mic.addEventListener("touchstart", (e) => { if (state.micMode === "hold") { e.preventDefault(); if (!state.listening) startListening(); } }, { passive: false });
  mic.addEventListener("touchend", (e) => { if (state.micMode === "hold") { e.preventDefault(); if (state.listening) stopListening(); } }, { passive: false });

  // Global customizable keyboard shortcuts.
  document.addEventListener("keydown", handleGlobalHotkey);
  document.addEventListener("keyup", handleGlobalHotkeyUp);

  // Settings panel wiring (speed, pitch, mic mode, shortcuts).
  const settingsBtn = $("settingsBtn");
  if (settingsBtn) settingsBtn.onclick = () => { const p = $("settingsPanel"); if (p) p.hidden = !p.hidden; };
  const rateEl = $("rate");
  const rateVal = $("rateVal");
  if (rateEl) {
    const savedRate = localStorage.getItem("vs_rate");
    if (savedRate) rateEl.value = savedRate;
    const showRate = () => { if (rateVal) rateVal.textContent = parseFloat(rateEl.value).toFixed(2) + "\u00d7"; };
    showRate();
    rateEl.addEventListener("input", () => { localStorage.setItem("vs_rate", rateEl.value); showRate(); });
  }
  const pitchEl = $("pitch");
  const pitchVal = $("pitchVal");
  if (pitchEl) {
    pitchEl.value = String(state.pitch);
    const showPitch = () => { if (pitchVal) pitchVal.textContent = (parseFloat(pitchEl.value) > 0 ? "+" : "") + parseFloat(pitchEl.value); };
    showPitch();
    pitchEl.addEventListener("input", () => {
      state.pitch = parseFloat(pitchEl.value) || 0;
      localStorage.setItem("vs_pitch", String(state.pitch));
      showPitch();
    });
  }
  // "Reply after pause" — GPT-4o-style turn-taking sensitivity (silence gap).
  const epEl = $("endpoint");
  const epVal = $("endpointVal");
  if (epEl) {
    epEl.value = String(state.endpointMs);
    const showEp = () => { if (epVal) epVal.textContent = (parseInt(epEl.value, 10) / 1000).toFixed(2) + "s"; };
    showEp();
    epEl.addEventListener("input", () => {
      state.endpointMs = parseInt(epEl.value, 10) || 550;
      localStorage.setItem("vs_endpoint_ms", String(state.endpointMs));
      showEp();
    });
  }
  // Keyword boosting for the recogniser. Persisted locally and sent with every
  // turn of audio, so the words you care about stop coming back wrong.
  const hwEl = $("hotwords");
  if (hwEl) {
    hwEl.value = localStorage.getItem("vs_hotwords") || "";
    hwEl.addEventListener("input", () => {
      localStorage.setItem("vs_hotwords", hwEl.value.slice(0, 900));
    });
  }
  const micModeEl = $("micMode");
  if (micModeEl) {
    micModeEl.value = state.micMode;
    micModeEl.onchange = () => {
      state.micMode = micModeEl.value;
      localStorage.setItem("vs_mic_mode", state.micMode);
      applyHotkeyLabels();
    };
  }
  bindHotkeyCapture("hotkeyTalk", "vs_hotkey_talk", "hotkeyTalk");
  bindHotkeyCapture("hotkeyStop", "vs_hotkey_stop", "hotkeyStop");
  const hkReset = $("hotkeyReset");
  if (hkReset) hkReset.onclick = () => {
    state.hotkeyTalk = "Space"; state.hotkeyStop = "Escape";
    localStorage.setItem("vs_hotkey_talk", "Space");
    localStorage.setItem("vs_hotkey_stop", "Escape");
    applyHotkeyLabels();
  };
  applyHotkeyLabels();

  // Live NVIDIA NIM model search + reload.
  const nimSearch = $("nimModelSearch");
  if (nimSearch) nimSearch.addEventListener("input", populateNimModels);
  const nimRefresh = $("nimRefresh");
  if (nimRefresh) nimRefresh.onclick = () => loadLiveNimModels(true);

  // AI Brain panel wiring
  const brainBtn = $("brainBtn");
  if (brainBtn) brainBtn.onclick = () => { const p = $("brainPanel"); if (p) p.hidden = !p.hidden; };
  const brainSel = $("brainSel");
  if (brainSel) brainSel.onchange = () => {
    state.brainSel = brainSel.value;
    localStorage.setItem("vs_brain", state.brainSel);
    syncBrainUI();
  };
  const nimModelSel = $("nimModel");
  if (nimModelSel) nimModelSel.onchange = () => {
    state.nimModel = nimModelSel.value;
    localStorage.setItem("vs_nim_model", state.nimModel);
  };
  if ($("nimSave")) $("nimSave").onclick = saveNimKey;
  if ($("nimClear")) $("nimClear").onclick = clearNimKey;
  if ($("resetBtn")) $("resetBtn").onclick = resetConversation;
  if ($("stopBtn")) $("stopBtn").onclick = () => { stopSpeaking(); setStatus("Stopped."); };

  $("sendBtn").onclick = () => { const v = $("textInput").value; $("textInput").value = ""; handleUserText(v); };
  $("textInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const v = $("textInput").value; $("textInput").value = ""; handleUserText(v); }
  });
  if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = () => {};
  loadEngines();
}
document.addEventListener("DOMContentLoaded", wire);

/* ================= v49: realtime full-duplex call path =====================
 *
 * This block is appended to app.js on purpose rather than living in its own
 * file: everything above is one classic (non-module) script, so being in the
 * same file is what lets this reuse `state`, `_syncCallUi`, `setStatus` and
 * friends without exporting them or duplicating them.
 *
 * It OVERRIDES startCall/endCall only when the browser can actually do it. If
 * anything is missing - no AudioWorklet, no WebSocket, a proxy that blocks the
 * upgrade, a mic permission failure - the original v48 HTTP path is used
 * unchanged. That fallback is the reason this is safe to ship: the worst case
 * is the behaviour you already had.
 */
(function () {
  "use strict";

  const supported = !!(
    window.RealtimeVoice &&
    window.WebSocket &&
    window.AudioWorkletNode &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia
  );
  if (!supported) return;   // keep the original path entirely

  // Allow an explicit opt-out for debugging or A/B comparison: ?rt=0
  try {
    if (new URLSearchParams(location.search).get("rt") === "0") return;
  } catch (e) { /* URLSearchParams missing - carry on */ }

  const origStartCall = window.startCall;
  const origEndCall = window.endCall;

  let rt = null;
  let agentRow = null;     // live assistant bubble for streaming tokens
  let agentText = "";
  let interimRow = null;   // live user bubble for partial transcripts

  function clearInterim() {
    if (interimRow && interimRow.parentNode) interimRow.parentNode.removeChild(interimRow);
    interimRow = null;
  }

  function onEvent(ev) {
    switch (ev.type) {
      case "listening":
        setStatus("Call connected \u2014 just talk. You can interrupt me any time.");
        break;

      case "partial": {
        if (!ev.text) break;
        // Show words as they settle. These are provisional, so they live in a
        // throwaway bubble that the final transcript replaces.
        if (!interimRow) {
          interimRow = addMsg(ev.text, "user");
          interimRow.classList.add("interim");
        } else {
          interimRow.querySelector(".bubble").textContent = ev.text;
        }
        break;
      }

      case "final": {
        clearInterim();
        if (ev.text) {
          addMsg(ev.text, "user");
          state.history.push({ role: "user", content: ev.text });
        }
        agentText = "";
        agentRow = null;
        break;
      }

      case "token": {
        if (!ev.text) break;
        agentText += ev.text;
        if (!agentRow) agentRow = addMsg(agentText, "bot");
        else agentRow.querySelector(".bubble").textContent = agentText;
        break;
      }

      case "speaking":
        state.speaking = !!ev.value;
        break;

      case "barge":
      case "interrupt":
        setStatus("Go ahead \u2014 I'm listening.");
        break;

      case "done": {
        const d = ev.data || {};
        if (agentText) state.history.push({ role: "assistant", content: agentText });
        agentText = "";
        agentRow = null;
        // Surface the real numbers. "first audio" is the one users actually
        // feel - it is the gap between finishing their sentence and hearing a
        // voice - so it is the one worth showing.
        if (d.first_audio_ms) {
          setStatus("Replied in " + Math.round(d.first_audio_ms) + "ms \u2014 go ahead.");
        }
        break;
      }

      case "error":
        if (ev.error === "unauthorized") setStatus("Not authorised for this site key.");
        break;

      case "close":
        if (state.inCall) setStatus("Reconnecting\u2026");
        break;

      default:
        break;
    }
  }

  window.startCall = async function startCallRealtime() {
    if (state.inCall) return;

    // Map the existing endpoint slider onto the new sensitivity knob so the
    // user's saved preference keeps meaning something: a shorter configured
    // gap means they want a snappier agent.
    const base = state.endpointMs || 550;
    const sensitivity = Math.max(0.5, Math.min(2.0, 550 / base));

    try {
      rt = new window.RealtimeVoice({
        onEvent: onEvent,
        params: {
          mode: state.mode || "best",
          lang: LANG,
          sensitivity: sensitivity.toFixed(2),
          pitch: state.pitch || 0,
          api_key: hasNimBrain() ? state.nimKey : "",
        },
      });
      await rt.start();
    } catch (err) {
      // Could not open the realtime path. Fall back to the original pipeline
      // rather than failing the call.
      try { if (rt) rt.stop(); } catch (e) {}
      rt = null;
      console.warn("realtime unavailable, using HTTP path:", err);
      return origStartCall.apply(this, arguments);
    }

    state.inCall = true;
    state.muted = false;
    state.callStartedAt = Date.now();
    document.body.classList.add("in-call");
    _syncCallUi();
    if (_timerTick) clearInterval(_timerTick);
    _timerTick = setInterval(_syncCallUi, 1000);
  };

  window.endCall = function endCallRealtime() {
    if (!rt) return origEndCall.apply(this, arguments);

    try { rt.stop(); } catch (e) {}
    rt = null;
    clearInterim();
    agentRow = null;
    agentText = "";

    state.inCall = false;
    state.muted = false;
    state.speaking = false;
    if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
    document.body.classList.remove("in-call");
    const dur = state.callStartedAt ? _fmtDuration(Date.now() - state.callStartedAt) : "";
    state.callStartedAt = 0;
    _syncCallUi();
    setStatus(dur ? ("Call ended (" + dur + ").") : "Call ended.");
  };

  // Mute must not drop the line. The socket stays open and the mic stays
  // permitted; we just stop feeding audio in, so unmuting is instant.
  const origToggleMute = window.toggleMute;
  window.toggleMute = function toggleMuteRealtime() {
    if (!rt || !state.inCall) return origToggleMute.apply(this, arguments);
    state.muted = !state.muted;
    if (rt.node && rt.node.port) {
      rt.node.port.postMessage({ type: "mute", value: state.muted });
    }
    if (state.muted) rt.interrupt();
    _syncCallUi();
    setStatus(state.muted ? "Muted \u2014 still connected." : "Unmuted \u2014 go ahead.");
  };

  // Typed messages should go down the same socket during a call, so the agent
  // answers with one voice and one history instead of two parallel ones.
  const origHandleUserText = window.handleUserText;
  window.handleUserText = async function handleUserTextRealtime(text) {
    const t = (text || "").trim();
    if (!t) return;
    if (rt && state.inCall) {
      addMsg(t, "user");
      state.history.push({ role: "user", content: t });
      agentText = "";
      agentRow = null;
      rt.sendText(t);
      return;
    }
    return origHandleUserText.apply(this, arguments);
  };

  console.info("Voice Studio v49: realtime full-duplex path active.");
})();
