import base64
import importlib
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


FAKE_VOICES = [
    {"id": "v-calm", "name": "Calm", "tag": "smooth · calm"},
    {"id": "v-bright", "name": "Bright", "tag": "bright · cheerful"},
]


class FakeProvider:
    """Stands in for a real vendor. Records what the server asked it to synthesize."""

    name = "fake"
    default_voice_id = "v-calm"

    def __init__(self):
        self.captured = {}

    def configured(self):
        return True

    async def list_voices(self):
        return list(FAKE_VOICES)

    async def synthesize(self, text, voice_id, speed):
        self.captured.update({"text": text, "voice_id": voice_id, "speed": speed})
        applied = max(0.7, min(speed, 1.2))
        return base64.b64encode(b"fake-audio").decode("ascii"), applied

    async def transcribe(self, data, filename):
        return "fake transcript"


def load_server_module(monkeypatch, provider):
    # No MONGO_URL / no vendor key on purpose: the server must import without either.
    monkeypatch.delenv("MONGO_URL", raising=False)
    monkeypatch.delenv("DB_NAME", raising=False)
    sys.modules.pop("server", None)
    server = importlib.import_module("server")
    monkeypatch.setattr(server, "get_provider", lambda: provider)
    return server


@pytest.mark.anyio
async def test_get_voices_reports_provider_default(monkeypatch):
    provider = FakeProvider()
    server = load_server_module(monkeypatch, provider)

    result = await server.get_voices()

    assert result["default"] == "v-calm"
    assert result["provider"] == "fake"
    assert any(voice["id"] == result["default"] for voice in result["voices"])


@pytest.mark.anyio
async def test_generate_tts_cleans_text_and_falls_back_to_provider_default(monkeypatch):
    provider = FakeProvider()
    server = load_server_module(monkeypatch, provider)

    req = server.TTSRequest(
        text="# Heading\n\n- first item\n- second item\n\nThis sentence should keep going naturally until the end.",
        voice_id="nope",
        speed=1.0,
    )

    response = await server.generate_tts(req)

    # An unknown voice must resolve to the provider's default, never a hardcoded id.
    assert provider.captured["voice_id"] == "v-calm"
    assert response.voice_id == "v-calm"

    # Markdown must be normalized before it reaches the vendor, not spoken literally.
    assert provider.captured["text"] == (
        "Heading.\n\nfirst item. second item.\n\nThis sentence should keep going naturally until the end."
    )
    assert response.word_count == len(response.words)
    assert response.words[0].word == "Heading."
    assert response.words[-1].word == "end."


@pytest.mark.anyio
async def test_generate_tts_honours_known_voice(monkeypatch):
    provider = FakeProvider()
    server = load_server_module(monkeypatch, provider)

    req = server.TTSRequest(text="Hello there.", voice_id="v-bright", speed=1.0)
    response = await server.generate_tts(req)

    assert provider.captured["voice_id"] == "v-bright"
    assert response.voice_id == "v-bright"


@pytest.mark.anyio
async def test_word_timings_scale_by_the_speed_the_provider_applied(monkeypatch):
    """The provider clamps 2.0 to 1.2, so timings must scale by 1.2 — not by 2.0."""
    provider = FakeProvider()
    server = load_server_module(monkeypatch, provider)

    baseline = await server.generate_tts(
        server.TTSRequest(text="one two three four five.", voice_id="v-calm", speed=1.0)
    )
    fast = await server.generate_tts(
        server.TTSRequest(text="one two three four five.", voice_id="v-calm", speed=2.0)
    )

    assert provider.captured["speed"] == 2.0  # server passes the raw request through
    assert fast.estimated_duration == pytest.approx(
        baseline.estimated_duration / 1.2, rel=0.01
    )


@pytest.mark.anyio
async def test_speech_unavailable_surfaces_as_503(monkeypatch):
    from fastapi import HTTPException

    from speech_providers import SpeechUnavailable

    class UnkeyedProvider(FakeProvider):
        async def list_voices(self):
            raise SpeechUnavailable("ELEVENLABS_API_KEY is not set.")

    server = load_server_module(monkeypatch, UnkeyedProvider())

    with pytest.raises(HTTPException) as exc:
        await server.get_voices()

    assert exc.value.status_code == 503
