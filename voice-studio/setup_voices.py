#!/usr/bin/env python3
"""Download the neural voices for Pocket TTS (Piper) and Kokoro.

WHY THIS FILE EXISTS
--------------------
Every emotion feature in this project - the per-sentence performance, the
emotional arc, the prosody DSP, the pauses, the tags - runs on a NEURAL voice.
If no neural voice is installed, the app falls back to the browser's built-in
`speechSynthesis` voice, which accepts no rate/pitch shaping worth hearing and
has ZERO emotion support. On that fallback the agent sounds flat and robotic no
matter how good the emotion engine is, because the emotion is computed and then
thrown away at the last step.

So: if the line under the microphone says "browser fallback voice", run this.

A SECOND, WORSE PROBLEM THIS NOW SOLVES
---------------------------------------
Voices only cover HALF of a phone call. Until now there was no way at all to
install speech RECOGNITION, so a fresh clone with no cloud API key could not
hear a word the caller said - and it failed silently: the call connected, the
socket stayed open, and the agent simply never answered. `--asr` fixes that with
a free, Apache-2.0, CPU-only streaming recogniser.

USAGE
    python setup_voices.py            # everything: ears + voices (recommended)
    python setup_voices.py --all      # same as above, written explicitly
    python setup_voices.py --asr      # speech recognition only (ears)
    python setup_voices.py --tts      # both voices only (mouth)
    python setup_voices.py --piper    # Pocket TTS only (small, ~63 MB, fastest)
    python setup_voices.py --kokoro   # Kokoro only (~330 MB, highest quality)
    python setup_voices.py --silero   # Silero VAD only (~2 MB)
    python setup_voices.py --check    # just report what is already installed

Notes
  * Downloads resume-safely: a partial file is re-fetched, never half-used.
  * Nothing here needs a GPU, an API key, or an account.
  * Files land in models/piper and models/kokoro, which is exactly where the
    engines look. No configuration required afterwards - restart the server and
    the engine appears as available.
"""
from __future__ import annotations

import os
import sys
import tarfile
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PIPER_DIR = os.path.join(HERE, "models", "piper")
KOKORO_DIR = os.path.join(HERE, "models", "kokoro")

# Each entry: (destination, minimum plausible size in bytes, [mirror urls])
# Mirrors matter: a single hardcoded URL is a single point of failure, and these
# projects move files between releases.
PIPER_FILES = [
    (
        os.path.join(PIPER_DIR, "en_US-amy-medium.onnx"), 40 * 1024 * 1024,
        [
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true",
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx",
        ],
    ),
    (
        os.path.join(PIPER_DIR, "en_US-amy-medium.onnx.json"), 900,
        [
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true",
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
        ],
    ),
]

KOKORO_FILES = [
    (
        os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx"), 200 * 1024 * 1024,
        [
            "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
            "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1_0.pth",
        ],
    ),
    (
        os.path.join(KOKORO_DIR, "voices-v1.0.bin"), 10 * 1024 * 1024,
        [
            "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
        ],
    ),
]


ASR_DIR = os.path.join(HERE, "models", "asr")
SILERO_DIR = os.path.join(ASR_DIR, "silero")

# Streaming recognition. This is the piece that lets the agent hear words AS
# THEY ARE SPOKEN instead of waiting for the caller to go quiet and then
# uploading a clip. Apache-2.0, CPU-only, no key, no account, no GPU.
# Each entry: (destination directory, marker file proving success, [mirrors])
ASR_ARCHIVES = [
    (
        os.path.join(ASR_DIR, "sherpa-onnx-streaming-zipformer-en-2023-06-26"),
        "tokens.txt",
        [
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2",
        ],
    ),
]

# Silero VAD: about 2 MB, MIT, well under a millisecond per 30 ms chunk on CPU,
# and far better at separating speech from background noise than a plain energy
# threshold - which is what decides whether a cough interrupts the agent.
SILERO_FILES = [
    (
        os.path.join(SILERO_DIR, "silero_vad.onnx"), 1024 * 1024,
        [
            "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx",
            "https://huggingface.co/deepghs/silero-vad-onnx/resolve/main/silero_vad.onnx",
        ],
    ),
]


def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit)
        n /= 1024.0
    return str(n)


def installed(path: str, min_size: int) -> bool:
    """A file counts as installed only if it is plausibly complete.

    An interrupted download leaves a small file behind, and a truncated model
    fails at synthesis time with a confusing error instead of at setup time.
    Checking the size here turns a mystery into a re-download.
    """
    try:
        return os.path.isfile(path) and os.path.getsize(path) >= min_size
    except OSError:
        return False


def fetch(url: str, dest: str, min_size: int) -> bool:
    tmp = dest + ".part"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "voice-studio-setup"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            with open(tmp, "wb") as fh:
                while True:
                    chunk = resp.read(262144)
                    if not chunk:
                        break
                    fh.write(chunk)
                    done += len(chunk)
                    if total:
                        pct = 100.0 * done / total
                        sys.stdout.write("\r    %5.1f%%  %s / %s   " %
                                         (pct, _human(done), _human(total)))
                    else:
                        sys.stdout.write("\r    %s   " % _human(done))
                    sys.stdout.flush()
        sys.stdout.write("\n")
        if os.path.getsize(tmp) < min_size:
            print("    too small to be the real file - treating as failed")
            os.remove(tmp)
            return False
        os.replace(tmp, dest)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError) as exc:
        sys.stdout.write("\n")
        print("    failed: %s" % exc)
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False


def get_group(name: str, files) -> bool:
    print("\n== %s ==" % name)
    all_ok = True
    for dest, min_size, urls in files:
        label = os.path.basename(dest)
        if installed(dest, min_size):
            print("  already installed: %s (%s)" % (label, _human(os.path.getsize(dest))))
            continue
        print("  downloading %s" % label)
        ok = False
        for url in urls:
            if fetch(url, dest, min_size):
                ok = True
                break
            print("    trying next mirror...")
        if not ok:
            all_ok = False
            print("  COULD NOT GET %s" % label)
    return all_ok


def _safe_members(tar, root):
    """Yield only archive members that stay inside `root`.

    A tar archive can carry paths like ../../.ssh/authorized_keys - the "tar
    slip" traversal attack. These archives are downloaded from the public
    internet, so extracting them blindly would let a compromised or
    man-in-the-middled release write anywhere the server user can write.
    Newer Pythons offer an extraction filter, but this script has to run on
    older ones too, so the check is explicit here.
    """
    root_abs = os.path.realpath(root)
    for m in tar.getmembers():
        target = os.path.realpath(os.path.join(root, m.name))
        inside = (target == root_abs or target.startswith(root_abs + os.sep))
        if not inside:
            print("    skipping unsafe path in archive: %s" % m.name)
            continue
        # Symlinks and devices have no business in a model archive.
        if m.isfile() or m.isdir():
            yield m
        else:
            print("    skipping non-regular entry: %s" % m.name)


def fetch_archive(url: str, dest_dir: str, marker: str,
                  min_size: int = 10 * 1024 * 1024) -> bool:
    """Download a .tar.bz2 model bundle and unpack it beside its siblings."""
    if os.path.isfile(os.path.join(dest_dir, marker)):
        print("  already installed: %s" % os.path.basename(dest_dir))
        return True

    parent = os.path.dirname(dest_dir)
    os.makedirs(parent, exist_ok=True)
    tmp = dest_dir + ".tar.bz2"
    print("  downloading %s" % os.path.basename(dest_dir))
    if not fetch(url, tmp, min_size):
        return False

    print("  unpacking...")
    try:
        with tarfile.open(tmp, "r:*") as tar:
            tar.extractall(parent, members=_safe_members(tar, parent))
    except (tarfile.TarError, OSError) as exc:
        print("    could not unpack: %s" % exc)
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    ok = os.path.isfile(os.path.join(dest_dir, marker))
    if not ok:
        print("    unpacked, but %s is missing - treating as failed" % marker)
    return ok


def get_archives(name: str, archives) -> bool:
    print("\n== %s ==" % name)
    all_ok = True
    for dest_dir, marker, urls in archives:
        got = False
        for url in urls:
            if fetch_archive(url, dest_dir, marker):
                got = True
                break
            print("    trying next mirror...")
        if not got:
            all_ok = False
            print("  COULD NOT GET %s" % os.path.basename(dest_dir))
    return all_ok


def report() -> None:
    print("\nCurrent state:")
    for name, files in (("Pocket TTS (Piper)", PIPER_FILES),
                        ("Kokoro", KOKORO_FILES),
                        ("Silero VAD", SILERO_FILES)):
        have = sum(1 for d, m, _ in files if installed(d, m))
        mark = "READY" if have == len(files) else "missing files"
        print("  %-20s %s (%d/%d files)" % (name, mark, have, len(files)))
    for dest_dir, marker, _ in ASR_ARCHIVES:
        ready = os.path.isfile(os.path.join(dest_dir, marker))
        print("  %-20s %s" % ("Streaming ASR",
                              "READY" if ready else "not installed"))

    # The only two questions an operator actually has, answered in plain words,
    # each with the exact command that fixes a "no".
    can_speak = any(all(installed(d, m) for d, m, _ in files)
                    for files in (PIPER_FILES, KOKORO_FILES))
    can_hear = any(os.path.isfile(os.path.join(d, mk))
                   for d, mk, _ in ASR_ARCHIVES)
    print("")
    print("  can speak: %s" % ("yes" if can_speak else
                               "NO  ->  python setup_voices.py --tts"))
    print("  can hear:  %s" % ("yes" if can_hear else
                               "NO  ->  python setup_voices.py --asr"))


def main() -> int:
    args = [a.lower() for a in sys.argv[1:]]
    if "--check" in args:
        report()
        return 0
    # No arguments now means "install everything", including the ears. The old
    # default installed voices only, which produced an agent that could talk but
    # not listen - the single most confusing state this product could be in.
    selectors = ("--piper", "--kokoro", "--asr", "--tts", "--silero", "--all")
    explicit = any(a in args for a in selectors)
    want_all = ("--all" in args) or not explicit

    want_piper = want_all or ("--piper" in args) or ("--tts" in args)
    want_kokoro = want_all or ("--kokoro" in args) or ("--tts" in args)
    want_asr = want_all or ("--asr" in args)
    # Silero rides along with --asr: recognition without good speech detection
    # is what makes an agent talk over its caller.
    want_silero = want_all or ("--silero" in args) or ("--asr" in args)

    print("Voice Studio - voice and recognition setup")
    print("Voices make the emotion engine audible; the recogniser is what")
    print("lets the agent hear the caller without any cloud account.")

    ok = True
    if want_asr:
        ok = get_archives("Streaming speech recognition - hears words as they "
                          "are spoken, on CPU", ASR_ARCHIVES) and ok
    if want_silero:
        ok = get_group("Silero VAD - tells real speech from coughs and noise",
                       SILERO_FILES) and ok
    if want_piper:
        ok = get_group("Pocket TTS (Piper) - small and fast, good on any CPU",
                       PIPER_FILES) and ok
    if want_kokoro:
        ok = get_group("Kokoro - larger, the most natural of the local voices",
                       KOKORO_FILES) and ok

    report()
    if ok:
        print("\nDone. Restart the server and pick Pocket TTS or Kokoro in the app.")
        print("The line under the microphone should stop saying 'browser fallback'.")
    else:
        print("\nSome files could not be downloaded.")
        print("This is almost always a network/proxy issue, not a bug in the app.")
        print("You can also install the Piper voice with its official tool:")
        print("  python -m piper.download_voices en_US-amy-medium --data-dir models/piper")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
