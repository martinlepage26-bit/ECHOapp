"""ECHO backend API tests - exercises health, voices, TTS, STT, parse-file, drafts, transcripts."""

import base64
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://echo-demo.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    return sess


# ---------------- Health ----------------
class TestHealth:
    def test_root(self, s):
        r = s.get(f"{API}/")
        assert r.status_code == 200
        j = r.json()
        assert j.get("status") == "online"
        assert j.get("service") == "echo"


# ---------------- Voices & Sample ----------------
class TestMeta:
    def test_voices(self, s):
        r = s.get(f"{API}/voices")
        assert r.status_code == 200
        j = r.json()
        assert "voices" in j and "default" in j
        assert len(j["voices"]) == 9
        for v in j["voices"]:
            assert {"id", "name", "tag"} <= set(v.keys())
        ids = [v["id"] for v in j["voices"]]
        assert j["default"] in ids

    def test_sample_text(self, s):
        r = s.get(f"{API}/sample-text")
        assert r.status_code == 200
        assert isinstance(r.json().get("text"), str)
        assert len(r.json()["text"]) > 20


# ---------------- TTS ----------------
class TestTTS:
    def test_tts_success(self, s):
        payload = {"text": "Hello world. This is ECHO speaking.", "voice_id": "alloy", "speed": 1.0}
        r = s.post(f"{API}/tts/generate", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["voice_id"] == "alloy"
        assert j["mime"] == "audio/mpeg"
        assert isinstance(j["audio_base64"], str) and len(j["audio_base64"]) > 100
        # decodable
        base64.b64decode(j["audio_base64"][:200] + "==")
        expected_word_count = len(payload["text"].split())
        assert j["word_count"] == expected_word_count
        assert j["char_count"] == len(payload["text"])
        assert len(j["words"]) == expected_word_count
        assert j["estimated_duration"] > 0
        # words ordering
        for i, w in enumerate(j["words"]):
            assert w["index"] == i
            assert w["end"] >= w["start"]

    def test_tts_empty_text_400(self, s):
        r = s.post(f"{API}/tts/generate", json={"text": "   ", "voice_id": "alloy"})
        assert r.status_code == 400

    def test_tts_over_limit_413(self, s):
        long = "word " * 900  # ~4500 chars
        r = s.post(f"{API}/tts/generate", json={"text": long, "voice_id": "alloy"})
        assert r.status_code == 413

    def test_tts_invalid_voice_fallback(self, s):
        r = s.post(f"{API}/tts/generate", json={"text": "Quick check.", "voice_id": "nope"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["voice_id"] == "echo"


# ---------------- Parse file ----------------
class TestParseFile:
    def test_parse_txt(self, s):
        content = b"Line one.\nLine two has more text."
        files = {"file": ("sample.txt", content, "text/plain")}
        r = s.post(f"{API}/parse-file", files=files)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "Line one" in j["text"]
        assert j["filename"] == "sample.txt"
        assert j["word_count"] > 0
        assert j["char_count"] > 0

    def test_parse_md(self, s):
        content = b"# Title\n\nParagraph body."
        files = {"file": ("note.md", content, "text/markdown")}
        r = s.post(f"{API}/parse-file", files=files)
        assert r.status_code == 200
        assert "Title" in r.json()["text"]

    def test_parse_unsupported_415(self, s):
        files = {"file": ("evil.exe", b"MZ\x00\x00", "application/octet-stream")}
        r = s.post(f"{API}/parse-file", files=files)
        assert r.status_code == 415

    def test_parse_empty_400(self, s):
        files = {"file": ("empty.txt", b"", "text/plain")}
        r = s.post(f"{API}/parse-file", files=files)
        assert r.status_code == 400


# ---------------- Drafts ----------------
class TestDrafts:
    def test_drafts_roundtrip(self, s):
        title = "TEST_draft_echo"
        payload = {"title": title, "text": "TEST body content for draft."}
        r = s.post(f"{API}/drafts", json=payload)
        assert r.status_code == 200, r.text
        created = r.json()
        assert "id" in created and created["title"] == title
        assert "_id" not in created  # must not leak ObjectId

        r2 = s.get(f"{API}/drafts")
        assert r2.status_code == 200
        rows = r2.json()
        assert isinstance(rows, list)
        for d in rows:
            assert "_id" not in d
        assert any(d["id"] == created["id"] for d in rows)


# ---------------- Transcripts ----------------
class TestTranscripts:
    def test_transcripts_roundtrip(self, s):
        payload = {"text": "TEST transcript body.", "duration": 2.5}
        r = s.post(f"{API}/transcripts", json=payload)
        assert r.status_code == 200, r.text
        created = r.json()
        assert "id" in created
        assert "_id" not in created

        r2 = s.get(f"{API}/transcripts")
        assert r2.status_code == 200
        for t in r2.json():
            assert "_id" not in t
        assert any(t["id"] == created["id"] for t in r2.json())


# ---------------- STT ----------------
class TestSTT:
    def test_stt_transcribe(self, s):
        # Use a tiny mp3-like payload. We cannot generate real audio without deps;
        # use the TTS endpoint to produce a known mp3 and then send it to STT.
        tts = s.post(
            f"{API}/tts/generate",
            json={"text": "Testing one two three.", "voice_id": "alloy", "speed": 1.0},
            timeout=60,
        )
        if tts.status_code != 200:
            pytest.skip(f"TTS unavailable; cannot build audio for STT test: {tts.status_code}")
        audio_bytes = base64.b64decode(tts.json()["audio_base64"])
        files = {"audio": ("capture.mp3", audio_bytes, "audio/mpeg")}
        r = s.post(f"{API}/stt/transcribe", files=files, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "id" in j and isinstance(j["transcript"], str)
        # Whisper should produce something non-empty for this clear phrase
        assert len(j["transcript"].strip()) > 0

    def test_stt_empty_400(self, s):
        files = {"audio": ("empty.mp3", b"", "audio/mpeg")}
        r = s.post(f"{API}/stt/transcribe", files=files)
        assert r.status_code == 400
