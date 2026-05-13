#!/usr/bin/env python3
"""
Vosk streaming speech recognition helper.
Reads raw PCM audio (16kHz, mono, 16-bit signed LE) from stdin,
outputs JSON lines to stdout with partial and final results.

Protocol (stdout JSON lines):
  {"type": "partial", "text": "parcial..."}
  {"type": "result",  "text": "frase finalizada"}
  {"type": "ready"}
  {"type": "error", "message": "..."}
"""

import sys
import os
import json
import site

# Ensure user site-packages is on the path (needed when spawned from Electron)
user_site = site.getusersitepackages()
if user_site and user_site not in sys.path:
    sys.path.insert(0, user_site)

# Suppress Vosk verbose logging
try:
    from vosk import SetLogLevel, Model, KaldiRecognizer
except ImportError as e:
    sys.stdout.write(json.dumps({
        "type": "error",
        "message": "Vosk não está instalado neste Python. Execute: pip3 install --user vosk"
    }) + "\n")
    sys.stdout.flush()
    sys.exit(1)
SetLogLevel(-1)

SAMPLE_RATE = 16000
CHUNK_SIZE = 4000  # ~250ms of audio at 16kHz 16-bit mono


def main():
    model_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "vosk-model")

    if not os.path.exists(model_path):
        emit({"type": "error", "message": f"Model not found: {model_path}"})
        sys.exit(1)

    try:
        model = Model(model_path)
        rec = KaldiRecognizer(model, SAMPLE_RATE)
        rec.SetWords(False)
        rec.SetPartialWords(False)
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load model: {e}"})
        sys.exit(1)

    emit({"type": "ready"})

    try:
        stdin = sys.stdin.buffer
        while True:
            data = stdin.read(CHUNK_SIZE)
            if not data:
                break

            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                text = result.get("text", "").strip()
                if text:
                    emit({"type": "result", "text": text})
            else:
                partial = json.loads(rec.PartialResult())
                text = partial.get("partial", "").strip()
                if text:
                    emit({"type": "partial", "text": text})

        # Flush final result
        final = json.loads(rec.FinalResult())
        text = final.get("text", "").strip()
        if text:
            emit({"type": "result", "text": text})

    except (BrokenPipeError, KeyboardInterrupt):
        pass
    except Exception as e:
        emit({"type": "error", "message": str(e)})


def emit(obj):
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        pass


if __name__ == "__main__":
    main()
