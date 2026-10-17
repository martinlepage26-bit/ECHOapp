import hashlib
import json
import plistlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import install_engine


class InstallerRollbackTests(unittest.TestCase):
    def test_transient_launchd_registration_retries_without_privilege_escalation(self):
        responses = [SimpleNamespace(returncode=5, stderr='temporary I/O error'), SimpleNamespace(returncode=0)]
        with patch.object(install_engine.subprocess, 'run', side_effect=responses) as run, \
             patch.object(install_engine.time, 'sleep') as sleep:
            install_engine.bootstrap_service('gui/501', Path('/tmp/example.plist'))
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.args[0], ['launchctl', 'bootstrap', 'gui/501', '/tmp/example.plist'])
        sleep.assert_called_once_with(0.5)

    def test_failed_profile_update_restores_both_entrypoint_and_launchagent(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            voice = home / '.local/share/echo-voice'
            voice.mkdir(parents=True)
            target = voice / 'engine_profile.py'
            target.write_bytes(b'previous reviewed profile')
            previous_profile = target.read_bytes()
            (voice / 'server.py').write_bytes(b'canonical server')
            (voice / 'reference.wav').write_bytes(b'canonical reference')
            (voice / 'echo-performance-receipt.json').write_text(json.dumps({
                'profile_sha256': hashlib.sha256(previous_profile).hexdigest()}))
            plist = home / 'Library/LaunchAgents/com.pharos.echosay-server.plist'
            plist.parent.mkdir(parents=True)
            previous_plist = plistlib.dumps({'Label': install_engine.LABEL,
                'ProgramArguments': [str(voice / '.venv-torch28/bin/python'), str(target)]})
            plist.write_bytes(previous_plist)
            backup = voice / 'echo-performance-backup/original-launch-agent.plist'
            backup.parent.mkdir()
            backup.write_bytes(b'original backup retained')
            with patch.object(Path, 'home', return_value=home), \
                 patch.object(install_engine.sys, 'platform', 'darwin'), \
                 patch.object(install_engine.sys, 'argv', ['install_engine.py']), \
                 patch.object(install_engine, 'BASE_SERVER_SHA', hashlib.sha256(b'canonical server').hexdigest()), \
                 patch.object(install_engine, 'REFERENCE_SHA', hashlib.sha256(b'canonical reference').hexdigest()), \
                 patch.object(install_engine, 'require_model_assets'), \
                 patch.object(install_engine, 'prepare_environment', return_value=voice / '.venv-torch28/bin/python'), \
                 patch.object(install_engine.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), \
                 patch.object(install_engine, 'wait_ready', side_effect=[RuntimeError('startup failed'), {'status': 'ok'}]):
                with self.assertRaisesRegex(RuntimeError, 'startup failed'):
                    install_engine.main()
            self.assertEqual(target.read_bytes(), previous_profile)
            self.assertEqual(plist.read_bytes(), previous_plist)
            self.assertEqual(backup.read_bytes(), b'original backup retained')
            self.assertEqual((voice / 'server.py').read_bytes(), b'canonical server')


if __name__ == '__main__':
    unittest.main()
