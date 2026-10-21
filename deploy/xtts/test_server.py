import json, os, sys, threading, unittest, urllib.request, urllib.error
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(__file__))
import server


TOKEN = "t" * 40


class FakeEngine:
    model = object()
    def __init__(self, hold=None): self.calls, self.hold = [], hold
    def speak(self, text, voice, lang):
        if self.hold: self.hold.wait(5)
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
    token = TOKEN
    def setUp(self):
        self.engine = FakeEngine()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(self.engine, self.token))
        self.port = self.httpd.server_address[1]
        server.ALLOWED_HOSTS.add(f"127.0.0.1:{self.port}")
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
    def tearDown(self): self.httpd.shutdown(); self.httpd.server_close()

    def req(self, path, body=None, host=None, token=TOKEN):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                   data=None if body is None else json.dumps(body).encode())
        if host: r.add_header("Host", host)
        if token is not None: r.add_header(server.TOKEN_HEADER, token)
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


    def test_missing_token_403(self):
        self.assertEqual(self.req("/health", token=None)[0], 403)
        code, _, _ = self.req("/tts", {"text": "Bonjour", "voice": "martin"}, token=None)
        self.assertEqual(code, 403); self.assertEqual(self.engine.calls, [])
    def test_wrong_token_403(self):
        self.assertEqual(self.req("/tts", {"text": "a"}, token="x" * 40)[0], 403)
        self.assertEqual(self.req("/health", token="")[0], 403)
    def test_tunnel_host_alone_is_not_enough(self):
        self.assertEqual(self.req("/health", host="tts.govern-ai.ca", token=None)[0], 403)


class NoTokenConfiguredTest(HttpTest):
    token = None
    def test_health(self): self.assertEqual(self.req("/health")[0], 503)
    def test_tts_passes_voice(self): self.assertEqual(self.req("/tts", {"text": "a"})[0], 503)
    def test_bad_voice_400(self): self.assertEqual(self.req("/tts", {"text": "a", "voice": "x"})[0], 503)
    def test_missing_token_403(self): self.assertEqual(self.req("/health", token=None)[0], 503)
    def test_wrong_token_403(self): self.assertEqual(self.req("/health", token="x" * 40)[0], 503)
    def test_tunnel_host_alone_is_not_enough(self): pass
    def test_foreign_host_403(self): self.assertEqual(self.req("/health", host="evil.example")[0], 403)


class TokenLoadTest(unittest.TestCase):
    def test_short_or_missing_token_is_none(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", delete=False) as f: f.write("short\n")
        os.chmod(f.name, 0o600)
        os.environ["ECHO_XTTS_TOKEN_FILE"] = f.name
        try:
            self.assertIsNone(server.load_token())
            open(f.name, "w").write("k" * 40 + "\n"); self.assertEqual(server.load_token(), "k" * 40)
            os.environ["ECHO_XTTS_TOKEN_FILE"] = f.name + ".missing"; os.environ.pop("ECHO_XTTS_TOKEN", None)
            self.assertIsNone(server.load_token())
        finally:
            os.environ.pop("ECHO_XTTS_TOKEN_FILE", None); os.unlink(f.name)

    def test_group_or_world_readable_token_is_refused(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", delete=False) as f: f.write("k" * 40)
        os.environ["ECHO_XTTS_TOKEN_FILE"] = f.name
        try:
            os.chmod(f.name, 0o644); self.assertIsNone(server.load_token())
            os.chmod(f.name, 0o600); self.assertEqual(server.load_token(), "k" * 40)
        finally:
            os.environ.pop("ECHO_XTTS_TOKEN_FILE", None); os.unlink(f.name)


class BusyTest(unittest.TestCase):
    def test_503_when_queue_full(self):
        hold = threading.Event()
        engine = FakeEngine(hold)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(engine, TOKEN, server.Gate(max_queue=1)))
        port = httpd.server_address[1]; server.ALLOWED_HOSTS.add(f"127.0.0.1:{port}")
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        def post():
            r = urllib.request.Request(f"http://127.0.0.1:{port}/tts", data=b'{"text":"a"}', headers={server.TOKEN_HEADER: TOKEN})
            try: return urllib.request.urlopen(r).status
            except urllib.error.HTTPError as e: return e.code
        results = []
        ts = [threading.Thread(target=lambda: results.append(post())) for _ in range(2)]
        for t in ts: t.start()
        import time; time.sleep(0.5)
        third = post()
        hold.set()
        for t in ts: t.join()
        httpd.shutdown(); httpd.server_close()
        self.assertEqual(third, 503); self.assertEqual(sorted(results), [200, 200])


if __name__ == "__main__": unittest.main()
