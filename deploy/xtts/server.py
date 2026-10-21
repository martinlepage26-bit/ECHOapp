"""Echo XTTS-v2 local API (default Echo engine). Binds 127.0.0.1 only.

POST /tts  {"text": str, "voice": "echo"|"martin", "engine": "xtts", "lang": "fr"|"en"} -> audio/wav
GET  /health -> {"service","ready","engine","voices","default"}

Reference clips per voice come from env (ECHO_XTTS_REF_ECHO, ECHO_XTTS_REF_MARTIN).
Licence: XTTS-v2 weights are under the Coqui Public Model License (non-commercial).
Stdlib HTTP only; the model is imported lazily so validation is testable without torch.
"""
import io, json, os, threading, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("ECHO_XTTS_PORT", "8765"))
MAX_CHARS = 600
DEFAULT_VOICE = "echo"
LANGS = {"fr", "en"}
REFS = {
    "echo": os.path.expanduser(os.environ.get("ECHO_XTTS_REF_ECHO", "~/.local/share/echo-voice/reference.wav")),
    "martin": os.path.expanduser(os.environ.get("ECHO_XTTS_REF_MARTIN", "~/.local/share/f5tts/voices/martin.wav")),
}
ALLOWED_HOSTS = set(os.environ.get(
    "ECHO_XTTS_ALLOWED_HOSTS", f"127.0.0.1:{PORT},localhost:{PORT},tts.govern-ai.ca").split(","))


def validate(body):
    """Return (text, voice, lang) or raise ValueError with a short reason."""
    if not isinstance(body, dict): raise ValueError("bad json")
    text = body.get("text")
    text = text.strip() if isinstance(text, str) else ""
    if not text or len(text) > MAX_CHARS: raise ValueError("bad text")
    voice = body.get("voice", DEFAULT_VOICE)
    if voice not in REFS: raise ValueError("unknown voice")
    if body.get("engine", "xtts") != "xtts": raise ValueError("unsupported engine")
    lang = body.get("lang", "fr")
    if lang not in LANGS: raise ValueError("unsupported lang")
    return text, voice, lang


class Engine:
    def __init__(self):
        self.lock, self.model, self.latents = threading.Lock(), None, {}

    def load(self):
        os.environ.setdefault("COQUI_TOS_AGREED", "1")
        from TTS.api import TTS
        self.model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").synthesizer.tts_model
        for vid, ref in REFS.items():
            self.latents[vid] = self.model.get_conditioning_latents(
                audio_path=[ref], gpt_cond_len=30, gpt_cond_chunk_len=4, max_ref_length=30, sound_norm_refs=False)

    def speak(self, text, voice, lang):
        import numpy as np, torch
        lat, spk = self.latents[voice]
        with self.lock:
            torch.manual_seed(1234)
            out = self.model.inference(text, lang, lat, spk, temperature=0.75, length_penalty=1.0,
                                       repetition_penalty=10.0, top_k=50, top_p=0.85)
        pcm = (np.clip(out["wav"], -1, 1) * 32767).astype("<i2").tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
        return buf.getvalue()


def make_handler(engine):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def send(self, code, body, ctype="application/json"):
            data = json.dumps(body).encode() if ctype == "application/json" else body
            self.send_response(code)
            self.send_header("content-type", ctype); self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)

        def guarded(self):
            if self.headers.get("host", "") not in ALLOWED_HOSTS:
                self.send(403, {"error": "forbidden host"}); return False
            return True

        def do_GET(self):
            if not self.guarded(): return
            if self.path != "/health": return self.send(404, {"error": "not found"})
            self.send(200, {"service": "echo-xtts", "ready": engine.model is not None, "engine": "xtts",
                            "voices": list(REFS), "default": DEFAULT_VOICE})

        def do_POST(self):
            if not self.guarded(): return
            if self.path != "/tts": return self.send(404, {"error": "not found"})
            try:
                n = int(self.headers.get("content-length", "0"))
                if n > 16384: raise ValueError("too large")
                text, voice, lang = validate(json.loads(self.rfile.read(n) or b"null"))
            except (ValueError, json.JSONDecodeError) as e:
                return self.send(400, {"error": str(e) or "bad json"})
            if engine.model is None: return self.send(503, {"error": "not ready"})
            self.send(200, engine.speak(text, voice, lang), "audio/wav")
    return H


if __name__ == "__main__":
    eng = Engine(); eng.load()
    ThreadingHTTPServer((HOST, PORT), make_handler(eng)).serve_forever()
