"""Echo F5-TTS local API. Binds 127.0.0.1:5434 only; public access is via an Access-protected tunnel."""
import io, json, os, threading
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from f5_tts.api import F5TTS

HERE = os.path.dirname(os.path.abspath(__file__))
VOICES = {}
for vid in ("echo", "martin"):  # allowlist; default stays "echo"
    meta = json.load(open(os.path.join(HERE, "voices", f"{vid}.json")))
    VOICES[vid] = (os.path.join(HERE, "voices", f"{vid}.wav"), meta["ref_text"])
ALLOWED_HOSTS = set(os.environ.get("F5_ALLOWED_HOSTS", "127.0.0.1:5434,localhost:5434,f5tts.govern-ai.ca").split(","))
MAX_CHARS = 600
device = "mps" if torch.backends.mps.is_available() else "cpu"
tts = F5TTS(model="F5TTS_v1_Base", device=device)
lock = threading.Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def host_guard(request: Request, call_next):
    if request.headers.get("host", "") not in ALLOWED_HOSTS:
        return JSONResponse({"error": "forbidden host"}, status_code=403)
    return await call_next(request)

class Req(BaseModel):
    text: str
    voice: str = "echo"
    engine: str = "f5"

@app.get("/health")
def health():
    return {"service": "echo-f5tts", "ready": True, "device": device, "voices": list(VOICES), "default": "echo"}

@app.post("/tts")
def speak(req: Req):
    text = req.text.strip()
    if not text or len(text) > MAX_CHARS: raise HTTPException(400, "bad text")
    if req.voice not in VOICES: raise HTTPException(400, "unknown voice")
    if req.engine != "f5": raise HTTPException(400, "unsupported engine")
    ref, ref_text = VOICES[req.voice]
    with lock:
        wav, sr, _ = tts.infer(ref_file=ref, ref_text=ref_text, gen_text=text, remove_silence=False, seed=1234, show_info=lambda *a: None)
    buf = io.BytesIO(); sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), media_type="audio/wav", headers={"cache-control": "no-store"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5434, log_level="warning")
