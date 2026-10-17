#!/usr/bin/env python3
"""Loopback ECHO reader and audio adapter. No model, reference or credentials copied."""
import hashlib
import io
import json
import mimetypes
import os
import stat
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8787
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ORIGINS = {f"http://{host}" for host in HOSTS} | {"https://martin.govern-ai.ca"}
REFERENCE_SHA = "1367bb796d941ec4cf8d221b7e971be27ab14966394faa8e254dc6fb4c67c67c"
VOICE_HOME = Path.home() / ".local/share/echo-voice"
DIST = Path(__file__).resolve().parent.parent / "dist"
XTTS = "http://127.0.0.1:8765"
MAX_AUDIO = 8 * 1024 * 1024
MAX_CACHE = 32 * 1024 * 1024
MAX_TEXT = 80


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def voice_identity():
    if hashlib.sha256((VOICE_HOME / "reference.wav").read_bytes()).hexdigest() != REFERENCE_SHA:
        raise ValueError("PHAROS’s pinned voice reference has changed.")
    return hashlib.sha256((VOICE_HOME / "server.py").read_bytes()).hexdigest()


def health():
    voice_identity()
    with HTTP.open(XTTS + "/health", timeout=2) as response:
        if json.loads(response.read(4096)).get("status") != "ok":
            raise ValueError("PHAROS voice is not ready.")
    return {"service": "echo-pharos-companion", "ready": True, "voice": "pharos-echo", "language": "en", "max_chars": MAX_TEXT}


def validate_text(body):
    if not isinstance(body, dict) or set(body) != {"text"}:
        raise ValueError("Provide only the text to read.")
    text = body["text"]
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ValueError(f"Use 1–{MAX_TEXT} characters per voice clip.")
    if any(ord(char) < 32 and char not in "\n\t\r" for char in text):
        raise ValueError("Text contains unsupported control characters.")
    return text.strip()


def read_audio(path):
    """Read only a fresh regular XTTS temp WAV owned by this user, then remove it."""
    path = Path(path)
    roots = {Path(tempfile.gettempdir()).resolve(), Path("/tmp").resolve()}
    if path.parent.resolve() not in roots or not path.name.startswith("echosay-") or path.suffix != ".wav":
        raise ValueError("PHAROS returned an unexpected audio path.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or not 44 < info.st_size <= MAX_AUDIO:
            raise ValueError("PHAROS returned an invalid audio file.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(MAX_AUDIO + 1)
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 24000) or not wav.getnframes():
                raise ValueError("PHAROS returned an unsupported audio format.")
        return data
    finally:
        os.close(fd)
        # Only the verified regular file is ours to remove.
        if 'info' in locals() and stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid():
            path.unlink(missing_ok=True)


class Synthesizer:
    def __init__(self):
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(3)
        self.cache = OrderedDict()

    def render(self, text):
        identity = voice_identity()
        key = hashlib.sha256((identity + REFERENCE_SHA + text).encode()).hexdigest()
        # Small bounded queue. Never starts a second model or changes inference parameters.
        if not self.slots.acquire(blocking=False):
            raise BlockingIOError("PHAROS is busy. Try again shortly.")
        try:
            with self.lock:
                if key in self.cache:
                    self.cache.move_to_end(key)
                    return self.cache[key]
                request = urllib.request.Request(XTTS + "/speak", json.dumps({"text": text}).encode(), {"Content-Type": "application/json"})
                with HTTP.open(request, timeout=150) as response:
                    result = json.loads(response.read(4096))
                data = read_audio(result["path"])
                self.cache[key] = data
                while sum(map(len, self.cache.values())) > MAX_CACHE:
                    self.cache.popitem(last=False)
                return data
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Reading text and generated audio never enter logs.

    def trusted(self):
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in HOSTS:
            return False
        if origin is not None:
            return origin in ORIGINS
        return self.headers.get("Sec-Fetch-Site") in (None, "none", "same-origin")

    def send(self, code, body, content_type="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Vary", "Origin")
        origin = self.headers.get("Origin")
        if origin in ORIGINS and self.trusted():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Echo-Client")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send(204 if self.trusted() else 403, b"")

    def do_GET(self):
        if not self.trusted():
            self.send(403, {"error": "This reader origin is not allowed."}); return
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/api/pharos/health":
            try:
                self.send(200, health())
            except (OSError, ValueError):
                self.send(503, {"error": "PHAROS’s pinned Echo voice is offline. Start its voice service, then reconnect."})
            return
        if parsed.path == "/echo/api/extract":
            # Same extraction service as the hosted reader; no arbitrary proxy target.
            url = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
            endpoint = "https://martin.govern-ai.ca/echo/api/extract?" + urllib.parse.urlencode({"url": url})
            try:
                with HTTP.open(endpoint, timeout=25) as response:
                    data = response.read(2 * 1024 * 1024 + 1)
                    if len(data) > 2 * 1024 * 1024:
                        raise ValueError("extraction too large")
                    self.send(200, data)
            except (OSError, ValueError):
                self.send(502, {"error": "Could not extract that web page."})
            return
        if parsed.path in ("/", "/echo", "/echo/"):
            path = DIST / "index.html"
        elif parsed.path.startswith("/echo/assets/"):
            path = (DIST / urllib.parse.unquote(parsed.path[len('/echo/'):])).resolve()
            if not path.is_relative_to(DIST.resolve()):
                self.send(404, {"error": "Not found."}); return
        else:
            self.send(404, {"error": "Not found."}); return
        if not path.is_file():
            self.send(404, {"error": "Build the ECHO reader first."}); return
        self.send(200, path.read_bytes(), mimetypes.guess_type(path)[0] or "application/octet-stream")

    def do_POST(self):
        if not self.trusted():
            self.send(403, {"error": "This reader origin is not allowed."}); return
        if self.path != "/api/pharos/speak":
            self.send(404, {"error": "Not found."}); return
        if self.headers.get("X-Echo-Client") != "echo-reader" or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.send(415, {"error": "Use the ECHO reader to request audio."}); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 2048 or self.headers.get("Transfer-Encoding"):
                self.send(413, {"error": "Invalid request size."}); return
            text = validate_text(json.loads(self.rfile.read(length)))
        except (ValueError, TypeError):
            self.send(400, {"error": "Provide a text clip of 1–80 characters."}); return
        try:
            self.send(200, self.server.synthesizer.render(text), "audio/wav")
        except BlockingIOError as error:
            self.send(429, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass  # A stopped reader discards the result; PHAROS keeps running.
        except Exception:
            self.send(503, {"error": "PHAROS could not render this clip. Check its voice service and try again."})


def main():
    if not (DIST / "index.html").is_file():
        raise SystemExit("Run npm run build before starting the local reader.")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.synthesizer = Synthesizer()
    print(f"ECHO local reader: http://127.0.0.1:{PORT}/echo/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
