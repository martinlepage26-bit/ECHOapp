import io
import logging
import os
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from hmac import compare_digest
from pathlib import Path
from typing import Deque, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from speech_providers import SpeechUnavailable, get_provider
from speech_text import estimate_word_timings, normalize_tts_text

# ------------------------------------------------------------------------------
# Setup
# ------------------------------------------------------------------------------

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("echo")

# Mongo — resolved lazily. Reading MONGO_URL at import time meant a missing var killed the
# whole app, including the endpoints that need no database at all.
_mongo_client: Optional[AsyncIOMotorClient] = None


def get_db():
    global _mongo_client
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        raise HTTPException(
            status_code=503,
            detail="Storage unavailable: MONGO_URL and DB_NAME are not configured.",
        )
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(mongo_url)
    return _mongo_client[db_name]


# Shared-secret gate. TTS/STT/parse-file and storage write paths must not be open to
# drive-by traffic on a public URL. Enforced only when ECHO_API_KEY is set; local
# development without it stays frictionless.
#
# The web client ships the same value as EXPO_PUBLIC_ECHO_KEY (compiled into the
# bundle). Treat it as a shared gate + rate-limit key, not a user secret: anyone
# who loads the page can extract it. Public deploys still need rate limits (below)
# and preferably a reverse-proxy or session layer in front.
ECHO_API_KEY = os.environ.get("ECHO_API_KEY") or ""

if not ECHO_API_KEY:
    logger.warning(
        "ECHO_API_KEY is not set: metered and storage endpoints are UNPROTECTED. "
        "Set it before exposing this server on a public URL."
    )

# Soft rate limit for expensive routes. Key is client IP. Defaults are generous for
# solo use; tighten via env on a public tunnel.
RATE_LIMIT_WINDOW_S = int(os.environ.get("ECHO_RATE_LIMIT_WINDOW_S", "60"))
RATE_LIMIT_MAX = int(os.environ.get("ECHO_RATE_LIMIT_MAX", "30"))
_rate_buckets: Dict[str, Deque[float]] = defaultdict(deque)


async def require_api_key(x_echo_key: str = Header(default="")) -> None:
    if not ECHO_API_KEY:
        return
    if not compare_digest(x_echo_key, ECHO_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Echo-Key.")


async def rate_limit_expensive(request: Request) -> None:
    """Bound TTS/STT/parse traffic per IP so a leaked client key cannot run unbounded."""
    if RATE_LIMIT_MAX <= 0:
        return
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    bucket = _rate_buckets[client]
    cutoff = now - RATE_LIMIT_WINDOW_S
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: {RATE_LIMIT_MAX} requests per {RATE_LIMIT_WINDOW_S}s.",
        )
    bucket.append(now)


# Applied to every route that spends vendor credits or writes user content.
_protected = [Depends(require_api_key), Depends(rate_limit_expensive)]
_auth_only = [Depends(require_api_key)]


app = FastAPI(title="ECHO Backend")
api_router = APIRouter(prefix="/api")

SAMPLE_TEXT = (
    "ECHO is a browser-native reading surface for listening to drafts out loud. "
    "Paste text or import a document, choose a voice profile, and hear the language "
    "back with live word tracking."
)

MAX_TTS_CHARS = 4000  # OpenAI TTS hard limit is 4096; keep buffer


# ------------------------------------------------------------------------------
# Models
# ------------------------------------------------------------------------------


class TTSRequest(BaseModel):
    text: str
    voice_id: str = "echo"
    speed: float = 1.0


class WordTiming(BaseModel):
    word: str
    start: float  # seconds
    end: float  # seconds
    index: int


class TTSResponse(BaseModel):
    audio_base64: str
    mime: str = "audio/mpeg"
    voice_id: str
    word_count: int
    char_count: int
    words: List[WordTiming]
    estimated_duration: float


class STTResponse(BaseModel):
    id: str
    transcript: str
    created_at: str
    duration: Optional[float] = None


class ParseFileResponse(BaseModel):
    text: str
    filename: str
    word_count: int
    char_count: int


class Draft(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    text: str
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class DraftCreate(BaseModel):
    title: str
    text: str


class Transcript(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str
    duration: Optional[float] = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class TranscriptCreate(BaseModel):
    text: str
    duration: Optional[float] = None


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------


def _estimate_word_timings(text: str) -> tuple[List[WordTiming], float]:
    timings, total_duration = estimate_word_timings(text)
    return (
        [
            WordTiming(
                word=timing.word,
                start=timing.start,
                end=timing.end,
                index=timing.index,
            )
            for timing in timings
        ],
        total_duration,
    )


def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception as e:
            logger.warning("pdf page extract failed: %s", e)
    return "\n\n".join(p.strip() for p in parts if p and p.strip())


def _extract_docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text]
    return "\n".join(parts)


# ------------------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------------------


@api_router.get("/")
async def root():
    return {"service": "echo", "status": "online"}


@api_router.get("/voices")
async def get_voices():
    provider = get_provider()
    try:
        voices = await provider.list_voices()
    except SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("voice catalog fetch failed: %s", e)
        raise HTTPException(
            status_code=502, detail=f"Voice catalog unavailable: {str(e)[:200]}"
        )
    # Merge local sample-clone voices (Patricia, Martin, …) when present.
    try:
        from clone_tts import get_clone_engine

        clone_voices = get_clone_engine().available_voices()
        known = {v["id"] for v in voices}
        for cv in clone_voices:
            if cv["id"] not in known:
                voices.append(
                    {"id": cv["id"], "name": cv["name"], "tag": cv["tag"] + " · sample"}
                )
    except Exception as e:
        logger.warning("clone voice catalog skipped: %s", e)
    return {
        "voices": voices,
        "default": provider.default_voice_id,
        "provider": provider.name,
    }


@api_router.get("/sample-text")
async def get_sample_text():
    return {"text": SAMPLE_TEXT}


@api_router.post(
    "/tts/generate",
    response_model=TTSResponse,
    dependencies=_protected,
)
async def generate_tts(req: TTSRequest):
    source_text = (req.text or "").strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="Text is required.")
    text = normalize_tts_text(source_text)
    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text contains no readable content after cleanup.",
        )
    if len(text) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Text exceeds {MAX_TTS_CHARS} character limit. Split into smaller passages.",
        )

    provider = get_provider()
    # Sample-backed voices (patricia, martin-en, …) always use local SpeechT5 clone —
    # no ElevenLabs API/token. Other voice ids use the configured SPEECH_PROVIDER.
    use_clone = False
    try:
        from clone_tts import get_clone_engine

        use_clone = get_clone_engine().has_voice(req.voice_id)
    except Exception:
        use_clone = False

    if use_clone:
        from speech_providers import CloneVoiceProvider

        synth_provider = CloneVoiceProvider()
        voice_id = req.voice_id
    else:
        synth_provider = provider
        try:
            catalog = await provider.list_voices()
        except SpeechUnavailable as e:
            raise HTTPException(status_code=503, detail=str(e))

        # Fall back to the provider's own default, not a hardcoded id.
        voice_id = (
            req.voice_id
            if any(v["id"] == req.voice_id for v in catalog)
            else provider.default_voice_id
        )

    try:
        audio_b64, speed, mime = await synth_provider.synthesize(
            text=text, voice_id=voice_id, speed=req.speed or 1.0
        )
    except SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("TTS generation failed: %s", e)
        raise HTTPException(
            status_code=502, detail=f"TTS generation failed: {str(e)[:200]}"
        )

    timings, total_dur = _estimate_word_timings(text)
    # Scale timings by the speed the provider actually applied (providers clamp differently),
    # so the readback highlight stays in sync with the voice.
    if speed and speed > 0:
        scaled = []
        for t in timings:
            scaled.append(
                WordTiming(
                    word=t.word,
                    start=round(t.start / speed, 3),
                    end=round(t.end / speed, 3),
                    index=t.index,
                )
            )
        timings = scaled
        total_dur = round(total_dur / speed, 3)

    return TTSResponse(
        audio_base64=audio_b64,
        mime=mime or "audio/mpeg",
        voice_id=voice_id,
        word_count=len(timings),
        char_count=len(text),
        words=timings,
        estimated_duration=total_dur,
    )


@api_router.post("/tts/raw", dependencies=_protected)
async def generate_tts_raw(req: TTSRequest):
    """Same as /tts/generate but returns raw audio bytes (for Pages Function proxy)."""
    result = await generate_tts(req)
    import base64

    try:
        audio = base64.b64decode(result.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bad audio payload: {e}")
    from fastapi.responses import Response

    return Response(
        content=audio,
        media_type=result.mime or "audio/wav",
        headers={
            "X-Echo-Voice": result.voice_id,
            "X-Echo-Backend": "SpeechT5-clone" if result.voice_id in {
                "echo", "patricia", "martin-en", "martin-fr"
            } else "provider",
        },
    )


@api_router.post(
    "/stt/transcribe",
    response_model=STTResponse,
    dependencies=_protected,
)
async def transcribe(audio: UploadFile = File(...)):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio filename required.")

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio payload.")
    if len(raw) > 24 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Audio over 24 MB. Split into shorter clips.",
        )

    try:
        text = await get_provider().transcribe(data=raw, filename=audio.filename)
    except SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("Transcription failed: %s", e)
        raise HTTPException(
            status_code=502, detail=f"Transcription failed: {str(e)[:200]}"
        )

    text = (text or "").strip()

    doc = Transcript(text=text)
    await get_db().transcripts.insert_one(doc.dict())
    return STTResponse(
        id=doc.id,
        transcript=text,
        created_at=doc.created_at,
        duration=None,
    )


@api_router.post(
    "/parse-file",
    response_model=ParseFileResponse,
    dependencies=_protected,
)
async def parse_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File over 12 MB.")

    name = file.filename.lower()
    try:
        if name.endswith(".txt") or name.endswith(".md"):
            text = raw.decode("utf-8", errors="replace")
        elif name.endswith(".pdf"):
            text = _extract_pdf(raw)
        elif name.endswith(".docx"):
            text = _extract_docx(raw)
        else:
            raise HTTPException(
                status_code=415,
                detail="Unsupported file type. Use .txt, .md, .docx, or .pdf.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("parse-file failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)[:200]}")

    text = text.strip()
    words = len([w for w in text.split() if w])
    return ParseFileResponse(
        text=text,
        filename=file.filename,
        word_count=words,
        char_count=len(text),
    )


@api_router.post("/drafts", response_model=Draft, dependencies=_auth_only)
async def save_draft(payload: DraftCreate):
    draft = Draft(**payload.dict())
    await get_db().drafts.insert_one(draft.dict())
    return draft


@api_router.get("/drafts", response_model=List[Draft], dependencies=_auth_only)
async def list_drafts():
    rows = await get_db().drafts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Draft(**r) for r in rows]


@api_router.post("/transcripts", response_model=Transcript, dependencies=_auth_only)
async def save_transcript(payload: TranscriptCreate):
    doc = Transcript(**payload.dict())
    await get_db().transcripts.insert_one(doc.dict())
    return doc


@api_router.get("/transcripts", response_model=List[Transcript], dependencies=_auth_only)
async def list_transcripts():
    rows = (
        await get_db().transcripts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    )
    return [Transcript(**r) for r in rows]


@api_router.delete("/drafts/{draft_id}", dependencies=_auth_only)
async def delete_draft(draft_id: str):
    res = await get_db().drafts.delete_one({"id": draft_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"deleted": res.deleted_count, "id": draft_id}


@api_router.delete("/transcripts/{transcript_id}", dependencies=_auth_only)
async def delete_transcript(transcript_id: str):
    res = await get_db().transcripts.delete_one({"id": transcript_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return {"deleted": res.deleted_count, "id": transcript_id}


# ------------------------------------------------------------------------------
# Wire router + middleware
# ------------------------------------------------------------------------------

app.include_router(api_router)

# CORS: never pair allow_origins=["*"] with allow_credentials=True (browsers reject it
# and it is a bad public posture). Same-origin static serve needs no CORS at all.
# Split-origin local dev: set CORS_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
_cors_raw = (os.environ.get("CORS_ORIGINS") or "").strip()
if not _cors_raw:
    _cors_origins: List[str] = []
    _cors_credentials = False
elif _cors_raw == "*":
    _cors_origins = ["*"]
    _cors_credentials = False
else:
    _cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
    _cors_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_cors_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    if _mongo_client is not None:
        _mongo_client.close()


# Serve the exported Expo web build from the same origin as the API, when it exists. One
# origin means one URL to publish and no CORS surface. Expo static export writes
# `readback.html` (not `readback/index.html`); Starlette StaticFiles html=True does not
# map clean routes, so we resolve the same way as frontend/scripts/serve-export.mjs.
_web_dist = ROOT_DIR.parent / "frontend" / "dist"
_WEB_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


def _resolve_web_file(url_path: str) -> Optional[Path]:
    if not _web_dist.is_dir():
        return None
    # Normalize and block path escape.
    raw = (url_path or "").split("?", 1)[0].split("#", 1)[0]
    stripped = raw.lstrip("/")
    if ".." in Path(stripped).parts:
        return None

    candidate = _web_dist / stripped if stripped else _web_dist
    if candidate.is_file():
        return candidate
    if candidate.is_dir():
        index = candidate / "index.html"
        if index.is_file():
            return index
    if stripped and not Path(stripped).suffix:
        html = _web_dist / f"{stripped}.html"
        if html.is_file():
            return html
    if not stripped:
        root = _web_dist / "index.html"
        if root.is_file():
            return root
    not_found = _web_dist / "+not-found.html"
    return not_found if not_found.is_file() else None


if _web_dist.is_dir():

    @app.get("/{full_path:path}")
    async def serve_web(full_path: str):
        # /api is owned by the router; this catch-all only runs when no API route matched.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        target = _resolve_web_file(full_path)
        if target is None:
            raise HTTPException(status_code=404, detail="Not found")
        media = _WEB_TYPES.get(target.suffix.lower(), "application/octet-stream")
        status = 404 if target.name == "+not-found.html" else 200
        return FileResponse(target, media_type=media, status_code=status)

    @app.get("/")
    async def serve_web_root():
        target = _resolve_web_file("")
        if target is None:
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(target, media_type="text/html; charset=utf-8")

    logger.info("serving web build from %s (clean Expo routes)", _web_dist)
else:
    logger.info("no web build at %s; API only", _web_dist)
