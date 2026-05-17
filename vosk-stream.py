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


def load_vocab_substitutions():
    """Carrega dicionario de substituicoes pra corrigir termos tecnicos em ingles
    que o modelo PT-BR transcreve errado (ex: 'cloud computing' -> 'claudio computing').
    Retorna lista de (regex_compilado, replacement)."""
    import re as _re
    vocab_path = os.path.join(os.path.dirname(__file__), "vosk-vocab.json")
    subs = []
    try:
        with open(vocab_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for src, dst in data.get("substitutions", []):
            # word boundary em ambos os lados, case-insensitive
            pattern = _re.compile(r"\b" + _re.escape(src) + r"\b", _re.IGNORECASE)
            subs.append((pattern, dst))
    except FileNotFoundError:
        pass
    except Exception as e:
        sys.stderr.write(f"[vosk-stream] erro carregando vocab: {e}\n")
    return subs


_VOCAB_SUBS = load_vocab_substitutions()


def apply_vocab(text):
    """Aplica substituicoes do dicionario no texto reconhecido."""
    if not text or not _VOCAB_SUBS:
        return text
    out = text
    for pattern, dst in _VOCAB_SUBS:
        out = pattern.sub(dst, out)
    return out


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
                    emit({"type": "result", "text": apply_vocab(text)})
            else:
                partial = json.loads(rec.PartialResult())
                text = partial.get("partial", "").strip()
                if text:
                    emit({"type": "partial", "text": apply_vocab(text)})

        # Flush final result
        final = json.loads(rec.FinalResult())
        text = final.get("text", "").strip()
        if text:
            emit({"type": "result", "text": apply_vocab(text)})

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
