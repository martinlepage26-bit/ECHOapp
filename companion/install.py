#!/usr/bin/env python3
"""Install the already-built local reader for this macOS user. Preserve releases."""
import datetime
import json
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path


def install():
    if sys.platform != 'darwin':
        raise SystemExit('This installer is for macOS. Elsewhere use npm run voice:local.')
    source = Path(__file__).resolve().parent.parent
    if not (source / 'dist/index.html').is_file():
        raise SystemExit('Run npm run build first.')
    label = 'ca.govern.echo-reader'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    root = Path.home() / 'Library/Application Support/ECHOReader'
    release = root / 'releases' / stamp
    release.mkdir(parents=True)
    shutil.copytree(source / 'dist', release / 'dist')
    (release / 'companion').mkdir()
    shutil.copy2(source / 'companion/server.py', release / 'companion/server.py')
    current = root / 'current'
    if current.exists() and not current.is_symlink():
        raise SystemExit(f'Refusing to replace the existing non-symlink {current}')
    previous = str(current.resolve()) if current.exists() else None
    temporary_link = root / ('current-' + stamp)
    temporary_link.symlink_to(release, target_is_directory=True)
    temporary_link.replace(current)
    logs = Path.home() / 'Library/Logs/ECHOReader'
    logs.mkdir(parents=True, exist_ok=True)
    plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
    plist.parent.mkdir(parents=True, exist_ok=True)
    if plist.exists():
        shutil.copy2(plist, release / 'previous-launch-agent.plist')
    data = {
        'Label': label,
        'ProgramArguments': [sys.executable, str(current / 'companion/server.py')],
        'WorkingDirectory': str(current), 'RunAtLoad': True,
        'KeepAlive': {'SuccessfulExit': False}, 'ThrottleInterval': 10,
        'ProcessType': 'Background',
        'StandardOutPath': str(logs / 'companion.log'),
        'StandardErrorPath': str(logs / 'companion.log'),
    }
    plist.write_bytes(plistlib.dumps(data)); plist.chmod(0o600)
    service = f'gui/{os.getuid()}/{label}'
    if subprocess.run(['launchctl', 'print', service], capture_output=True).returncode == 0:
        subprocess.run(['launchctl', 'bootout', service], check=True)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)], check=True)
    launcher = Path.home() / 'Desktop/ECHO — PHAROS Voice.command'
    if launcher.exists():
        shutil.copy2(launcher, release / 'previous-desktop-launcher.command')
    launcher.write_text(f'#!/bin/sh\nlaunchctl kickstart {service}\nopen http://127.0.0.1:8787/echo/\n')
    launcher.chmod(0o755)
    receipt = {'release': str(release), 'previous_release': previous, 'service': service,
               'url': 'http://127.0.0.1:8787/echo/', 'launcher': str(launcher)}
    (release / 'installation.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    install()
