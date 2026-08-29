# Fixes applied — this pass

## 1. Double browser tab on Start-NexusCRM.bat
**Root cause:** `Start-NexusCRM.bat` opened the browser itself (`start "" "http://127.0.0.1:8080"` after a blind `timeout /t 2`), and `server.js`'s own `server.listen()` callback *also* opened the browser once it confirmed it was actually listening. Two independent triggers → two tabs.

**Fix:** Removed the `.bat` file's own browser launch from the Node.js path. `server.js` already does it more reliably (only fires after the server confirms it's up, not a blind timeout guess). The Python-fallback path still opens the browser itself, since Python's simple HTTP server doesn't do that on its own.

## 2. NVIDIA NIM connection "not working at all"
**Root cause — much bigger than it looked:** `server.js` (the bundled local static server, launched by the `.bat`/`.command` files) answers `/api/health` with `{ ok:true, localOnly:true }` — that `localOnly` flag exists specifically to tell the frontend "I'm not a real backend, don't route real API calls to me." But `pingBackend()` in the frontend only checked `r.ok` and never read the response body, so it ignored that flag entirely.

Consequence: the app concluded a real backend was available, routed *every* API call (auth, contacts, AI, everything) to `server.js`, which has no real routes beyond `/health` — every other path fell through to its catch-all and served the whole HTML app back with a 200 status. `realFetch()` then tried to parse that HTML as JSON, the parse failure was silently swallowed, and because the HTTP status was 200 (not an error), it returned `{}` as if it were valid, successful, empty data. Every feature was affected identically — AI just happened to be the one you tested and noticed.

**Fix, both sides:**
- `pingBackend()` now reads the actual response body and requires `ok:true` **and no `localOnly` flag** before considering a backend real.
- `realFetch()` independently checks the `Content-Type` header and refuses to treat a non-JSON response as valid data, throwing a clear error instead — so even if something else slips a fake "backend" through in the future, this can't happen silently again.
- Added `tests/test_pingbackend_fix.mjs` — a focused, dependency-free regression test that extracts and executes the real shipped `pingBackend`/`realFetch` code and proves this exact failure mode is fixed (7/7 passing).

## 3. API key encryption-at-rest was missing
Not something you reported, but found while tracing the NVIDIA issue: the AES-256-GCM encryption for AI provider keys and the Resend key had been dropped somewhere in recent changes — keys were being read/written in plain text. Re-wired `encryptSecret`/`decryptSecret` through every function that touches a key (`providerRequest`, `callProvider`, `callProviderOnce`, `openProviderStream`, `pingProvider`, `sendEmailViaResend`, both settings handlers), and restored the "🔒 encrypted at rest" status badge in Settings (AI Providers tab and Email tab) so you can see the state at a glance.

## Testing performed
- `backend/src/index.js` (~5,000 lines): syntax-verified, then run against the project's own existing `tests/test_backend.mjs` suite — **302 passed, 0 failed**. That suite needed `sql.js`, which wasn't installable in the environment I worked in (no npm registry access); I wrote a drop-in replacement mock (`tests/d1mock.js`) using Node's built-in `node:sqlite` with the identical interface, so the exact same test file runs unmodified in its assertions.
- `tests/test_frontend.mjs` and `tests/test_webchat_widget.mjs` need `jsdom`, also not installable in that environment — I did **not** fake or force these to pass. They should still work as before in an environment with npm access; worth running there as a final check.
- New: `tests/test_pingbackend_fix.mjs` — no dependencies, executes the actual bug fix directly, 7/7 passing.
- Fixed two small bugs in the test suite itself along the way (a double-quoted SQL string literal that only worked under sql.js's looser parsing; a fetch-mock cleanup ordering issue in my own new jsdom-skip guards that I caught by noticing a cascading failure in a later, unrelated test section).

## What I did not change
The `patches/` folder (43 historical patch scripts) is left as-is — it's a record of prior work, not something that runs at app startup, so there was no reason to touch it. The 60-odd 3D visual-effect templates in the page builder were reviewed (initially flagged as a possible duplicate-function bug, then confirmed to be legitimate string-template data) and left untouched.
