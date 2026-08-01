"""Unit tests for the Cloudflare Workers AI provider (HTTP client to echo-ai)."""

import base64
import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeAsyncClient:
    """Minimal httpx.AsyncClient stand-in."""

    instances = []

    def __init__(self, *args, **kwargs):
        self.calls = []
        self.get_response = None
        self.post_response = None
        FakeAsyncClient.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None):
        self.calls.append(("GET", url, headers, None))
        return self.get_response

    async def post(self, url, headers=None, json=None, files=None):
        self.calls.append(("POST", url, headers, json if json is not None else files))
        return self.post_response


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv("WORKERS_AI_URL", "https://echo-ai.example.workers.dev")
    monkeypatch.setenv("WORKERS_AI_TOKEN", "test-token")
    import speech_providers as sp

    importlib.reload(sp)
    sp.reset_provider()
    FakeAsyncClient.instances.clear()
    return sp.WorkersAIProvider()


@pytest.mark.anyio(backends=["asyncio"])
async def test_list_voices_from_worker(provider, monkeypatch):
    import httpx

    def factory(*a, **k):
        client = FakeAsyncClient()
        client.get_response = FakeResponse(
            200,
            {
                "voices": [{"id": "luna", "name": "Luna", "tag": "warm"}],
                "default": "luna",
                "provider": "workers_ai",
            },
        )
        return client

    monkeypatch.setattr(httpx, "AsyncClient", factory)

    voices = await provider.list_voices()
    assert voices[0]["id"] == "luna"
    assert provider.default_voice_id == "luna"
    client = FakeAsyncClient.instances[-1]
    assert client.calls[0][0] == "GET"
    assert client.calls[0][1].endswith("/api/voices")
    assert client.calls[0][2]["X-Echo-Key"] == "test-token"


@pytest.mark.anyio(backends=["asyncio"])
async def test_synthesize_posts_echo_shape(provider, monkeypatch):
    import httpx

    audio_b64 = base64.b64encode(b"mp3-bytes").decode("ascii")

    def factory(*a, **k):
        client = FakeAsyncClient()
        client.post_response = FakeResponse(
            200,
            {
                "audio_base64": audio_b64,
                "mime": "audio/mpeg",
                "voice_id": "athena",
                "words": [],
                "estimated_duration": 1.0,
            },
        )
        return client

    monkeypatch.setattr(httpx, "AsyncClient", factory)

    b64, speed, mime = await provider.synthesize("Hello world.", "athena", 1.0)
    assert b64 == audio_b64
    assert mime == "audio/mpeg"
    assert speed == 1.0
    client = FakeAsyncClient.instances[-1]
    method, url, headers, body = client.calls[0]
    assert method == "POST"
    assert url.endswith("/api/tts/generate")
    assert body["text"] == "Hello world."
    assert body["voice_id"] == "athena"
    assert headers["X-Echo-Key"] == "test-token"


@pytest.mark.anyio(backends=["asyncio"])
async def test_missing_url_raises(monkeypatch):
    monkeypatch.delenv("WORKERS_AI_URL", raising=False)
    import speech_providers as sp

    importlib.reload(sp)
    p = sp.WorkersAIProvider()
    assert p.configured() is False
    with pytest.raises(sp.SpeechUnavailable):
        await p.synthesize("hi", "athena", 1.0)


def test_provider_aliases_registered():
    import speech_providers as sp

    importlib.reload(sp)
    assert sp._PROVIDERS["workers_ai"] is sp.WorkersAIProvider
    assert sp._PROVIDERS["cloudflare"] is sp.WorkersAIProvider
    assert sp._PROVIDERS["cf"] is sp.WorkersAIProvider
