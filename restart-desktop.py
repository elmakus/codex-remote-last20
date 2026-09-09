"""Restart the selected existing unit, including GNOME's escaped main process."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

unit = sys.argv[1]
def systemctl(*args):
    return subprocess.run(['systemctl', '--user', *args], check=True,
                          capture_output=True, text=True, timeout=80).stdout.strip()
if systemctl('show', unit, '-p', 'LoadState', '--value') != 'loaded':
    raise SystemExit('Desktop unit is not loaded')
if systemctl('show', unit, '-p', 'Transient', '--value') != 'no':
    raise SystemExit('Desktop unit must survive stop/start')
def owned(pid):
    try:
        return os.readlink(f'/proc/{pid}/exe') == '/opt/codex-desktop/ChatGPT'
    except OSError:
        return False
main=[]
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit() or not owned(proc.name):
        continue
    try:
        if b'--type=' not in (proc/'cmdline').read_bytes():
            main.append(int(proc.name))
    except OSError:
        pass
if len(main)>1:
    raise SystemExit('Multiple desktop main processes; refusing ambiguous restart')
if '--check' in sys.argv:
    print(f'Restart target: {unit}; main processes: {len(main)}; persistent unit verified')
    raise SystemExit(0)
systemctl('stop', unit)
for pid in main:
    if owned(pid):
        os.kill(pid, signal.SIGTERM)
deadline=time.monotonic()+12
while any(owned(pid) for pid in main) and time.monotonic()<deadline:
    time.sleep(0.5)
for pid in main:
    if owned(pid):
        os.kill(pid, signal.SIGKILL)
systemctl('start', unit)
print('Desktop unit started')
