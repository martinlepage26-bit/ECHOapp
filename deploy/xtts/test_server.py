import json, os, sys, threading, unittest, urllib.request, urllib.error
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(__file__))
import server


class FakeEngine:
    model = object()
    def __init__(self): self.calls = []
    def speak(self, text, voice, lang):
        self.calls.append((text, voice, lang)); return b"RIFF....WAVEfake"


class ValidateTest(unittest.TestCase):
    def test_defaults_to_echo_fr(self):
        self.assertEqual(server.validate({"text": " Bonjour "}), ("Bonjour", "echo", "fr"))
    def test_martin_voice(self):
        self.assertEqual(server.validate({"text": "Salut", "voice": "martin", "engine": "xtts"})[1], "martin")
    def test_rejects(self):
        for body in [None, {}, {"text": ""}, {"text": "x" * 601}, {"text": "a", "voice": "patricia"},
                     {"text": "a", "engine": "f5"}, {"text": "a", "lang": "de"}]:
            with self.assertRaises(ValueError): server.validate(body)
    def test_voice_refs_distinct(self):
        self.assertEqual(set(server.REFS), {"echo", "martin"})
        self.assertNotEqual(server.REFS["echo"], server.REFS["martin"])
    def test_binds_loopback(self):
        self.assertEqual(server.HOST, "127.0.0.1")


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.engine = FakeEngine()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(self.engine))
        self.port = self.httpd.server_address[1]
        server.ALLOWED_HOSTS.add(f"127.0.0.1:{self.port}")
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
    def tearDown(self): self.httpd.shutdown(); self.httpd.server_close()

    def req(self, path, body=None, host=None):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                   data=None if body is None else json.dumps(body).encode())
        if host: r.add_header("Host", host)
        try:
            with urllib.request.urlopen(r) as resp: return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e: return e.code, e.headers, e.read()

    def test_health(self):
        code, _, body = self.req("/health")
        self.assertEqual(code, 200); self.assertEqual(json.loads(body)["voices"], ["echo", "martin"])
    def test_tts_passes_voice(self):
        code, h, _ = self.req("/tts", {"text": "Bonjour", "voice": "martin"})
        self.assertEqual(code, 200); self.assertEqual(h["content-type"], "audio/wav")
        self.assertEqual(self.engine.calls, [("Bonjour", "martin", "fr")])
    def test_bad_voice_400(self):
        self.assertEqual(self.req("/tts", {"text": "a", "voice": "x"})[0], 400)
    def test_foreign_host_403(self):
        self.assertEqual(self.req("/health", host="evil.example")[0], 403)


if __name__ == "__main__": unittest.main()
