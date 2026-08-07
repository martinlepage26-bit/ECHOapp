"""Minimal FastAPI sidecar for the ECHO clone TTS engine."""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from engine import get_clone_engine, synthesize as synthesize_wav

logger = logging.getLogger("echo.clone.server")

app = FastAPI(title="ECHO Clone TTS Sidecar", version="1.0.0")


class TTSRequest(BaseModel):
    text: str
    voice_id: str
    speed: float = 1.0


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(_request, exc: RequestValidationError):
    """Map Pydantic validation failures to the requested 400 bad-input shape."""
    return JSONResponse(status_code=400, content={"detail": exc.errors()})


@app.get("/health")
async def health() -> dict:
    return {"service": "echo-clone", "status": "online"}


@app.post("/tts")
async def tts(
    body: TTSRequest,
    x_echo_key: str | None = Header(default=None, alias="X-Echo-Key"),
):
    expected_key = os.environ.get("ECHO_API_KEY")
    if expected_key:
        if not x_echo_key or not hmac.compare_digest(x_echo_key, expected_key):
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    voice_id = (body.voice_id or "").strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    engine = get_clone_engine()
    if not engine.has_voice(voice_id):
        raise HTTPException(
            status_code=404, detail=f"Voice {voice_id!r} not found"
        )

    try:
        wav_bytes = synthesize_wav(text, voice_id, body.speed)
    except Exception as exc:  # pragma: no cover - engine failures are environment-specific
        logger.exception("clone engine failed for voice=%s", voice_id)
        raise HTTPException(
            status_code=503, detail=f"Engine failure: {exc}"
        ) from exc

    return Response(content=wav_bytes, media_type="audio/wav")
