import http.client
import io
import json
import os
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import server


def wav_bytes():
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
        wav.writeframes(b'\x01\x00' * 240)
    return out.getvalue()


class CompanionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.calls = []
        class Synth:
            def render(self, text):
                cls.calls.append(text); return wav_bytes()
        cls.http.synthesizer = Synth()
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()

    def request(self, method='POST', path='/api/pharos/speak', body=None, **headers):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=3)
        base = {'Host': '127.0.0.1:8787', 'Content-Type': 'application/json', 'X-Echo-Client': 'echo-reader'}
        base.update(headers)
        conn.request(method, path, body if body is not None else json.dumps({'text': 'Hello Martin.'}), base)
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close(); return result

    def test_exact_hosted_origin_can_read_audio(self):
        status, headers, data = self.request(Origin='https://martin.govern-ai.ca')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://martin.govern-ai.ca')
        self.assertEqual(headers['Content-Type'], 'audio/wav')
        self.assertEqual(data, wav_bytes())

    def test_foreign_origin_and_rebinding_are_refused_before_synthesis(self):
        before = len(self.calls)
        for headers in ({'Origin': 'https://evil.test'}, {'Origin': 'null'}, {'Host': 'evil.test:8787'}, {'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.request(**headers)[0], 403)
        self.assertEqual(len(self.calls), before)

    def test_simple_forms_and_missing_custom_header_are_refused(self):
        self.assertEqual(self.request(**{'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request(**{'X-Echo-Client': ''})[0], 415)

    def test_invalid_and_oversized_text_and_save_paths_are_refused(self):
        for body in ({'text': 'x' * 81}, {'text': ''}, {'text': 'hello', 'save_path': '/tmp/a.wav'}, {'text': 42}, []):
            self.assertEqual(self.request(body=json.dumps(body))[0], 400)
        self.assertEqual(self.request(body='x' * 2049)[0], 413)

    def test_preflight_only_grants_the_exact_reader_origin(self):
        status, headers, _ = self.request(method='OPTIONS', Origin='https://martin.govern-ai.ca')
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Private-Network'], 'true')
        status, headers, _ = self.request(method='OPTIONS', Origin='https://evil.test')
        self.assertEqual(status, 403)
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_health_fails_closed_on_reference_or_service_failure(self):
        with patch.object(server, 'health', side_effect=ValueError('reference mismatch')):
            self.assertEqual(self.request(method='GET', path='/api/pharos/health')[0], 503)

    def test_an_external_link_can_open_static_reader_but_cannot_call_api(self):
        with tempfile.TemporaryDirectory() as d, patch.object(server, 'DIST', Path(d)):
            (Path(d) / 'index.html').write_text('<title>ECHO</title>')
            headers = {'Sec-Fetch-Site': 'cross-site'}
            self.assertEqual(self.request(method='GET', path='/echo/', **headers)[0], 200)
            self.assertEqual(self.request(method='GET', path='/api/pharos/health', **headers)[0], 403)

    def test_head_serves_headers_without_a_body(self):
        with tempfile.TemporaryDirectory() as d, patch.object(server, 'DIST', Path(d)):
            (Path(d) / 'index.html').write_text('<title>ECHO</title>')
            status, headers, body = self.request(method='HEAD', path='/echo/')
            self.assertEqual(status, 200)
            self.assertEqual(body, b'')
            self.assertEqual(headers['Content-Security-Policy'], "frame-ancestors 'none'")

    def test_temp_audio_is_validated_and_removed(self):
        fd, path = tempfile.mkstemp(prefix='echosay-', suffix='.wav')
        with os.fdopen(fd, 'wb') as f: f.write(wav_bytes())
        self.assertEqual(server.read_audio(path), wav_bytes())
        self.assertFalse(Path(path).exists())

    def test_reference_and_non_temp_paths_are_never_read_as_audio(self):
        for path in ('/etc/passwd', str(server.VOICE_HOME / 'reference.wav'), '/tmp/not-echo.wav'):
            with self.assertRaises(ValueError): server.read_audio(path)

    def test_symlinks_are_not_followed_or_removed(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / 'keep.wav'; target.write_bytes(wav_bytes())
            link = Path(tempfile.gettempdir()) / f'echosay-test-{os.getpid()}.wav'
            link.symlink_to(target)
            try:
                with self.assertRaises(OSError): server.read_audio(link)
                self.assertTrue(target.exists()); self.assertTrue(link.is_symlink())
            finally: link.unlink()

    def test_voice_reference_digest_is_pinned(self):
        with tempfile.TemporaryDirectory() as d, patch.object(server, 'VOICE_HOME', Path(d)):
            (Path(d) / 'reference.wav').write_bytes(b'wrong voice')
            with self.assertRaises(ValueError): server.voice_identity()

    def test_cache_uses_real_audio_and_sends_only_text_to_existing_service(self):
        audio = wav_bytes()
        response = io.BytesIO(json.dumps({'path': '/tmp/echosay-fixture.wav'}).encode())
        synth = server.Synthesizer()
        with patch.object(server, 'voice_identity', return_value='same-service'), patch.object(server.HTTP, 'open', return_value=response) as send, patch.object(server, 'read_audio', return_value=audio):
            self.assertEqual(synth.render('Hello.'), audio)
            self.assertEqual(synth.render('Hello.'), audio)
            self.assertEqual(send.call_count, 1)
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, 'http://127.0.0.1:8765/speak')
            self.assertEqual(json.loads(request.data), {'text': 'Hello.'})

    def test_queue_is_bounded(self):
        synth = server.Synthesizer()
        for _ in range(3): synth.slots.acquire()
        with patch.object(server, 'voice_identity', return_value='same-service'):
            with self.assertRaises(BlockingIOError): synth.render('Hello.')


if __name__ == '__main__':
    unittest.main()
