"""Speech provider abstraction for ECHO.

ECHO was scaffolded against `emergentintegrations`, a proprietary wrapper that is no
longer installable. This module replaces it with a provider-selected implementation so
ECHO is never welded to a single vendor again.

Select with SPEECH_PROVIDER: "elevenlabs" (default) | "openai".
The chosen provider needs its own key (ELEVENLABS_API_KEY / OPENAI_API_KEY). When no key
is present the app still boots and serves /api/voices; only synthesis and transcription
raise SpeechUnavailable, which the API surfaces as a clean 503 rather than a crash.
"""

import base64
import io
import logging
import os
from typing import List, Optional, Tuple

logger = logging.getLogger("echo.speech")

DEFAULT_PROVIDER = "elevenlabs"


class SpeechUnavailable(RuntimeError):
    """Raised when the selected provider has no usable credentials."""


class SpeechProvider:
    """Contract the server depends on. Providers must not raise at construction."""

    name = "base"
    #: Falls back to this when a client requests an unknown voice.
    default_voice_id = ""

    def configured(self) -> bool:
        raise NotImplementedError

    async def list_voices(self) -> List[dict]:
        """[{id, name, tag}] — the /api/voices contract the frontend renders."""
        raise NotImplementedError

    async def synthesize(
        self, text: str, voice_id: str, speed: float
    ) -> Tuple[str, float]:
        """Return (base64 mp3, speed actually applied).

        The applied speed is returned because providers clamp it to different ranges and
        the caller scales word timings by it. Scaling by the *requested* speed when the
        provider clamped it would drift the readback highlight out of sync with the voice.
        """
        raise NotImplementedError

    async def transcribe(self, data: bytes, filename: str) -> str:
        raise NotImplementedError


def _require(flag: bool, provider: str, env_var: str) -> None:
    if not flag:
        raise SpeechUnavailable(
            f"{provider} is selected but {env_var} is not set. "
            f"Add {env_var} to backend/.env, or set SPEECH_PROVIDER to a configured provider."
        )


class ElevenLabsProvider(SpeechProvider):
    """ElevenLabs TTS + Scribe STT.

    The account's own voices are fetched live when the key permits it. ElevenLabs keys carry
    granular scopes, and a synthesis-only key (no `voices_read`) is both common and
    perfectly sufficient to run ECHO. So the catalog degrades to a verified stock list
    rather than failing: listing voices must never be a hard dependency of speaking.
    """

    name = "elevenlabs"

    # ElevenLabs applies speed inside voice_settings and rejects values outside this band.
    SPEED_MIN = 0.7
    SPEED_MAX = 1.2

    # Stock ElevenLabs voices, each confirmed to synthesize with a scope-limited key.
    # Used when the key cannot read the account catalog.
    STOCK_VOICES = [
        {"id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "tag": "calm · narration"},
        {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "tag": "soft · news"},
        {"id": "JBFqnCBsd6RMkjVDRZzb", "name": "George", "tag": "warm · narration"},
        {"id": "onwK4e9ZLuTAKqWW03F9", "name": "Daniel", "tag": "deep · news"},
        {"id": "pqHfZKP75CvOlQylNhV4", "name": "Bill", "tag": "trustworthy · narration"},
        {"id": "N2lVS1w4EtoT3dr4eOWO", "name": "Callum", "tag": "intense · character"},
        {"id": "XB0fDUnXU5powFXDhCwa", "name": "Charlotte", "tag": "expressive · character"},
    ]

    def __init__(self) -> None:
        self._api_key = os.environ.get("ELEVENLABS_API_KEY") or ""
        self._model = os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
        self._stt_model = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v1")
        self._voices_cache: Optional[List[dict]] = None
        self._client = None
        # Honour an explicit default voice, otherwise the first catalog entry wins.
        self.default_voice_id = os.environ.get("ELEVENLABS_DEFAULT_VOICE", "")

    def configured(self) -> bool:
        return bool(self._api_key)

    def _get_client(self):
        _require(self.configured(), "elevenlabs", "ELEVENLABS_API_KEY")
        if self._client is None:
            from elevenlabs.client import AsyncElevenLabs

            self._client = AsyncElevenLabs(api_key=self._api_key)
        return self._client

    def _finalize(self, voices: List[dict]) -> List[dict]:
        if not self.default_voice_id or not any(
            v["id"] == self.default_voice_id for v in voices
        ):
            self.default_voice_id = voices[0]["id"]
        self._voices_cache = voices
        return voices

    async def list_voices(self) -> List[dict]:
        if self._voices_cache is not None:
            return self._voices_cache

        client = self._get_client()  # raises SpeechUnavailable when there is no key at all

        try:
            result = await client.voices.get_all()
        except Exception as e:
            # Scope-limited key, or ElevenLabs is unreachable. Speaking still works.
            logger.warning(
                "ElevenLabs voice catalog unavailable (%s); using the stock voice list. "
                "Grant the key `voices_read` to serve this account's own voices.",
                str(e)[:120],
            )
            return self._finalize([dict(v) for v in self.STOCK_VOICES])

        voices = []
        for v in getattr(result, "voices", []) or []:
            labels = getattr(v, "labels", None) or {}
            # Build the "tag" the UI shows from whatever descriptors the account exposes.
            descriptors = [
                labels.get(k)
                for k in ("accent", "description", "age", "gender", "use_case")
                if labels.get(k)
            ]
            voices.append(
                {
                    "id": getattr(v, "voice_id", ""),
                    "name": getattr(v, "name", "") or "Unnamed",
                    "tag": " · ".join(descriptors[:2]) if descriptors else "elevenlabs",
                }
            )

        voices = [v for v in voices if v["id"]]
        if not voices:
            logger.warning("ElevenLabs returned no voices; using the stock voice list.")
            voices = [dict(v) for v in self.STOCK_VOICES]

        return self._finalize(voices)

    async def synthesize(
        self, text: str, voice_id: str, speed: float
    ) -> Tuple[str, float]:
        client = self._get_client()
        applied = max(self.SPEED_MIN, min(speed, self.SPEED_MAX))

        from elevenlabs import VoiceSettings

        stream = client.text_to_speech.convert(
            voice_id=voice_id,
            text=text,
            model_id=self._model,
            output_format="mp3_44100_128",
            voice_settings=VoiceSettings(
                stability=0.5, similarity_boost=0.75, speed=applied
            ),
        )

        chunks = bytearray()
        async for chunk in stream:
            if chunk:
                chunks.extend(chunk)

        if not chunks:
            raise SpeechUnavailable("ElevenLabs returned empty audio.")

        return base64.b64encode(bytes(chunks)).decode("ascii"), applied

    async def transcribe(self, data: bytes, filename: str) -> str:
        client = self._get_client()
        buf = io.BytesIO(data)
        buf.name = filename
        result = await client.speech_to_text.convert(
            file=buf, model_id=self._stt_model
        )
        return (getattr(result, "text", "") or "").strip()


class OpenAIProvider(SpeechProvider):
    """OpenAI TTS + Whisper. The catalog ECHO originally shipped against."""

    name = "openai"

    SPEED_MIN = 0.5
    SPEED_MAX = 2.0

    VOICES = [
        {"id": "alloy", "name": "Alloy", "tag": "neutral · balanced"},
        {"id": "ash", "name": "Ash", "tag": "clear · articulate"},
        {"id": "coral", "name": "Coral", "tag": "warm · friendly"},
        {"id": "echo", "name": "Echo", "tag": "smooth · calm"},
        {"id": "fable", "name": "Fable", "tag": "expressive · storyteller"},
        {"id": "nova", "name": "Nova", "tag": "energetic · upbeat"},
        {"id": "onyx", "name": "Onyx", "tag": "deep · authoritative"},
        {"id": "sage", "name": "Sage", "tag": "wise · measured"},
        {"id": "shimmer", "name": "Shimmer", "tag": "bright · cheerful"},
    ]

    def __init__(self) -> None:
        self._api_key = os.environ.get("OPENAI_API_KEY") or ""
        self._model = os.environ.get("OPENAI_TTS_MODEL", "tts-1")
        self._stt_model = os.environ.get("OPENAI_STT_MODEL", "whisper-1")
        self._client = None
        self.default_voice_id = "echo"

    def configured(self) -> bool:
        return bool(self._api_key)

    def _get_client(self):
        _require(self.configured(), "openai", "OPENAI_API_KEY")
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=self._api_key)
        return self._client

    async def list_voices(self) -> List[dict]:
        return list(self.VOICES)

    async def synthesize(
        self, text: str, voice_id: str, speed: float
    ) -> Tuple[str, float]:
        client = self._get_client()
        applied = max(self.SPEED_MIN, min(speed, self.SPEED_MAX))
        response = await client.audio.speech.create(
            model=self._model,
            voice=voice_id,
            input=text,
            speed=applied,
            response_format="mp3",
        )
        audio = response.content
        if not audio:
            raise SpeechUnavailable("OpenAI returned empty audio.")
        return base64.b64encode(audio).decode("ascii"), applied

    async def transcribe(self, data: bytes, filename: str) -> str:
        client = self._get_client()
        result = await client.audio.transcriptions.create(
            model=self._stt_model,
            file=(filename, data),
        )
        return (getattr(result, "text", "") or "").strip()


_PROVIDERS = {
    ElevenLabsProvider.name: ElevenLabsProvider,
    OpenAIProvider.name: OpenAIProvider,
}

_active: Optional[SpeechProvider] = None


def get_provider() -> SpeechProvider:
    """Resolve SPEECH_PROVIDER once. Never raises: an unkeyed provider still lists voices."""
    global _active
    if _active is None:
        choice = (os.environ.get("SPEECH_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
        factory = _PROVIDERS.get(choice)
        if factory is None:
            logger.warning(
                "Unknown SPEECH_PROVIDER=%r; falling back to %s. Known: %s",
                choice,
                DEFAULT_PROVIDER,
                ", ".join(sorted(_PROVIDERS)),
            )
            factory = _PROVIDERS[DEFAULT_PROVIDER]
        _active = factory()
        logger.info(
            "speech provider=%s configured=%s", _active.name, _active.configured()
        )
    return _active


def reset_provider() -> None:
    """Drop the cached provider. Tests use this after patching the environment."""
    global _active
    _active = None
