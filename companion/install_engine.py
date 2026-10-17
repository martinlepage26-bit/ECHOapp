#!/usr/bin/env python3
"""Tune the existing Mac PHAROS LaunchAgent; preserve its server and environment."""
import argparse
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from engine_profile import BASE_SERVER_SHA, require_model_assets

LABEL = 'com.pharos.echosay-server'
REFERENCE_SHA = '1367bb796d941ec4cf8d221b7e971be27ab14966394faa8e254dc6fb4c67c67c'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write(path, content, mode=0o600):
    temporary = path.with_name(path.name + '.echo-next')
    if temporary.exists():
        raise RuntimeError(f'Unexpected staging file: {temporary}')
    with temporary.open('xb') as output:
        os.chmod(temporary, mode)
        output.write(content)
    temporary.replace(path)


def prepare_environment(voice):
    env = voice / '.venv-torch28'
    python = env / 'bin/python'
    if not env.exists():
        subprocess.run([str(voice / '.venv/bin/python'), '-m', 'venv', str(env)], check=True)
        subprocess.run([str(python), '-m', 'pip', 'install', '--no-deps',
                        'torch==2.8.0', 'torchaudio==2.8.0', 'sympy==1.14.0'], check=True)
        # Other dependencies are read from the preserved PHAROS environment.
        (env / 'lib/python3.11/site-packages/pharos-base.pth').write_text(
            str(voice / '.venv/lib/python3.11/site-packages') + '\n')
    result = subprocess.check_output([str(python), '-c',
        'import sys,json,torch,torchaudio; print(json.dumps([sys.prefix,torch.__version__,torchaudio.__version__]))'], text=True)
    prefix, torch_version, audio_version = json.loads(result)
    if Path(prefix).resolve() != env.resolve() or (torch_version, audio_version) != ('2.8.0', '2.8.0'):
        raise RuntimeError('Candidate environment differs from the verified versions.')
    return python


def wait_ready(profile_sha=None):
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            with http.open('http://127.0.0.1:8765/health', timeout=2) as response:
                status = json.load(response)
            if status.get('status') == 'ok' and (profile_sha is None or status.get('profile_sha256') == profile_sha):
                return status
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('PHAROS did not become ready within 180 seconds.')


def bootstrap_service(domain, plist):
    # launchd can briefly reject re-registration while bootout is still being
    # finalized. Retry that transient status without escalating privileges.
    for attempt in range(20):
        result = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True, text=True)
        if result.returncode == 0:
            return
        if result.returncode != 5 or attempt == 19:
            raise RuntimeError('macOS could not register the PHAROS LaunchAgent: ' + result.stderr.strip())
        time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restore', action='store_true', help='Restore the original PHAROS LaunchAgent.')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        raise SystemExit('This profile is for the existing PHAROS voice on macOS.')
    voice = Path.home() / '.local/share/echo-voice'
    plist = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    if digest(voice / 'server.py') != BASE_SERVER_SHA or digest(voice / 'reference.wav') != REFERENCE_SHA:
        raise SystemExit('PHAROS source/reference changed; review before installing this profile.')
    require_model_assets()
    previous = plist.read_bytes()
    original = plistlib.loads(previous)
    if original.get('Label') != LABEL:
        raise SystemExit('Unexpected LaunchAgent; left unchanged.')
    backups = voice / 'echo-performance-backup'
    backup = backups / 'original-launch-agent.plist'
    profile_sha = None
    target = voice / 'engine_profile.py'
    old_profile = target.read_bytes() if target.exists() else None
    changed_profile = False
    if args.restore:
        replacement = backup.read_bytes()
    else:
        python = prepare_environment(voice)
        source = Path(__file__).with_name('engine_profile.py')
        backups.mkdir(mode=0o700, exist_ok=True)
        if target.exists() and digest(target) != digest(source):
            receipt = json.loads((voice / 'echo-performance-receipt.json').read_text())
            old_sha = digest(target)
            if receipt.get('profile_sha256') != old_sha:
                raise SystemExit('Execution profile has unrecorded edits; preserve and review before replacing.')
            saved_profile = backups / ('profile-' + old_sha + '.py')
            if not saved_profile.exists():
                atomic_write(saved_profile, target.read_bytes())
            atomic_write(target, source.read_bytes())
            changed_profile = True
        if not target.exists():
            atomic_write(target, source.read_bytes())
        profile_sha = digest(source)
        if not backup.exists():
            if original.get('ProgramArguments', [None])[-1] != str(voice / 'server.py'):
                raise SystemExit('Original PHAROS entrypoint is unexpected; left unchanged.')
            atomic_write(backup, previous)
        data = dict(original)
        data['ProgramArguments'] = [str(python), str(target)]
        data['EnvironmentVariables'] = dict(original.get('EnvironmentVariables', {}))
        # Compatibility with already-installed, trusted legacy model checkpoints.
        # No new checkpoint is downloaded or accepted here.
        data['EnvironmentVariables']['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD'] = '1'
        replacement = plistlib.dumps(data)
    service = f'gui/{os.getuid()}/{LABEL}'
    domain = f'gui/{os.getuid()}'
    if subprocess.run(['launchctl', 'print', service], capture_output=True).returncode == 0:
        subprocess.run(['launchctl', 'bootout', service], check=True)
    try:
        atomic_write(plist, replacement)
        bootstrap_service(domain, plist)
        status = wait_ready(profile_sha)
    except Exception:
        subprocess.run(['launchctl', 'bootout', service], capture_output=True)
        if changed_profile and old_profile is not None:
            atomic_write(target, old_profile)
        atomic_write(plist, previous)
        bootstrap_service(domain, plist)
        wait_ready()
        raise
    receipt = {'service': service, 'profile': 'original' if args.restore else 'echo-gpu-v1',
               'profile_sha256': profile_sha, 'backup': str(backup), 'health': status,
               'server_sha256': digest(voice / 'server.py'), 'reference_sha256': digest(voice / 'reference.wav')}
    atomic_write(voice / 'echo-performance-receipt.json', (json.dumps(receipt, indent=2) + '\n').encode())
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
