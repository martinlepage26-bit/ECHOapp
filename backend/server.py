import io
import logging
import os
import uuid
from datetime import datetime, timezone
from hmac import compare_digest
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
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


# Shared-secret gate. TTS and STT spend metered vendor credits per call, so on any public
# URL they must not be open to drive-by traffic. Enforced only when ECHO_API_KEY is set;
# local development without it stays frictionless, but a public deploy must set it.
ECHO_API_KEY = os.environ.get("ECHO_API_KEY") or ""

if not ECHO_API_KEY:
    logger.warning(
        "ECHO_API_KEY is not set: the metered TTS/STT endpoints are UNPROTECTED. "
        "Set it before exposing this server on a public URL."
    )


async def require_api_key(x_echo_key: str = Header(default="")) -> None:
    if not ECHO_API_KEY:
        return
    if not compare_digest(x_echo_key, ECHO_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Echo-Key.")


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
    dependencies=[Depends(require_api_key)],
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
    try:
        catalog = await provider.list_voices()
    except SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Fall back to the provider's own default, not a hardcoded id. ElevenLabs voice ids are
    # opaque hashes, so the old `else "echo"` fallback would have sent an unknown voice.
    voice_id = (
        req.voice_id
        if any(v["id"] == req.voice_id for v in catalog)
        else provider.default_voice_id
    )

    try:
        audio_b64, speed = await provider.synthesize(
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
        mime="audio/mpeg",
        voice_id=voice_id,
        word_count=len(timings),
        char_count=len(text),
        words=timings,
        estimated_duration=total_dur,
    )


@api_router.post(
    "/stt/transcribe",
    response_model=STTResponse,
    dependencies=[Depends(require_api_key)],
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
    dependencies=[Depends(require_api_key)],
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


@api_router.post("/drafts", response_model=Draft)
async def save_draft(payload: DraftCreate):
    draft = Draft(**payload.dict())
    await get_db().drafts.insert_one(draft.dict())
    return draft


@api_router.get("/drafts", response_model=List[Draft])
async def list_drafts():
    rows = await get_db().drafts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [Draft(**r) for r in rows]


@api_router.post("/transcripts", response_model=Transcript)
async def save_transcript(payload: TranscriptCreate):
    doc = Transcript(**payload.dict())
    await get_db().transcripts.insert_one(doc.dict())
    return doc


@api_router.get("/transcripts", response_model=List[Transcript])
async def list_transcripts():
    rows = (
        await get_db().transcripts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    )
    return [Transcript(**r) for r in rows]


@api_router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str):
    res = await get_db().drafts.delete_one({"id": draft_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"deleted": res.deleted_count, "id": draft_id}


@api_router.delete("/transcripts/{transcript_id}")
async def delete_transcript(transcript_id: str):
    res = await get_db().transcripts.delete_one({"id": transcript_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return {"deleted": res.deleted_count, "id": transcript_id}


# ------------------------------------------------------------------------------
# Wire router + middleware
# ------------------------------------------------------------------------------

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    if _mongo_client is not None:
        _mongo_client.close()


# Serve the exported Expo web build from the same origin as the API, when it exists. One
# origin means one URL to publish and no CORS surface. Mounted last so /api always wins.
_web_dist = ROOT_DIR.parent / "frontend" / "dist"
if _web_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_web_dist), html=True), name="web")
    logger.info("serving web build from %s", _web_dist)
else:
    logger.info("no web build at %s; API only", _web_dist)
