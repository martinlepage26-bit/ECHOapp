import unittest
import tempfile
from pathlib import Path

from engine_profile import windows, require_model_assets, WINDOW, CONTEXT


class VocoderWindowTests(unittest.TestCase):
    def test_windows_cover_audio_once_with_context_at_every_internal_seam(self):
        for length in (1, 31, 32, 63, 128, 191, 192, 193, 256, 375, 384, 1024, 4096):
            position = 0
            for start, end, first, last in windows(length):
                self.assertEqual(first, position)
                self.assertTrue(0 <= start <= first < last <= end <= length)
                self.assertLessEqual(end - start, WINDOW)
                if start:
                    self.assertGreaterEqual(first - start, CONTEXT)
                if end < length:
                    self.assertGreaterEqual(end - last, CONTEXT)
                position = last
            self.assertEqual(position, length)

    def test_invalid_windows_cannot_loop_or_drop_audio(self):
        for args in ((0,), (-1,), (100, 64, 32), (100, 30, -1)):
            with self.assertRaises(ValueError):
                list(windows(*args))

    def test_missing_checkpoint_stops_before_model_loader_can_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('model.pth', 'config.json', 'vocab.json', 'speakers_xtts.pth'):
                with self.assertRaises(RuntimeError):
                    require_model_assets(root)
                (root / name).write_bytes(b'existing asset')
            require_model_assets(root)
            (root / 'model.pth').write_bytes(b'')
            with self.assertRaises(RuntimeError):
                require_model_assets(root)


if __name__ == '__main__':
    unittest.main()
