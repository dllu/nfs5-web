#!/usr/bin/env python3
"""Upload the packaged static release and enable its scoped Caddy route."""
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HOST = 'pupserver.linode'
DESTINATION = '/www/misc/nfs5'


def main():
    release = ROOT / 'build/public'
    if not (release / 'index.html').is_file() or not (release / 'engine.wasm.gz').is_file():
        raise RuntimeError('Run npm run build:public first')
    subprocess.run(['ssh', HOST, 'mkdir -p ' + shlex.quote(DESTINATION)], check=True)
    # Content-addressed payloads are uploaded first. Keep old payloads so an
    # already-running browser can finish its current release after an update.
    subprocess.run(['rsync', '-az', '--exclude=index.html', str(release) + '/', HOST + ':' + DESTINATION + '/'], check=True)
    subprocess.run(['rsync', '-az', str(release / 'index.html'), HOST + ':' + DESTINATION + '/index.html'], check=True)
    fragment = (ROOT / 'tools/nfs5.caddy').read_text()
    # Edit only this project's delimited route in the existing site. Back up the
    # prior configuration and validate before reload; restore on failure.
    script = '''from pathlib import Path
import datetime, subprocess
path=Path('/etc/caddy/Caddyfile')
original=path.read_text()
start='# BEGIN nfs5-web\\n'
end='# END nfs5-web\\n'
block=start+FRAGMENT+end
if start in original:
    before,rest=original.split(start,1)
    _,after=rest.split(end,1)
    updated=before+block+after
else:
    marker='lawrence.lu, daniel.lawrence.lu {\\n'
    if original.count('\\n'+marker)!=1:
        raise RuntimeError('Cannot locate the intended Caddy site block')
    updated=original.replace('\\n'+marker,'\\n'+marker+block,1)
if updated!=original:
    backup=path.with_name('Caddyfile.pre-nfs5-'+datetime.datetime.now().strftime('%Y%m%dT%H%M%S'))
    backup.write_text(original)
    path.write_text(updated)
    try:
        subprocess.run(['caddy','validate','--config',str(path),'--adapter','caddyfile'],check=True)
        subprocess.run(['systemctl','reload','caddy'],check=True)
    except BaseException:
        path.write_text(original)
        raise
print('https://daniel.lawrence.lu/nfs5/')
'''.replace('FRAGMENT', repr(fragment))
    subprocess.run(['ssh', HOST, 'sudo -n python3 -'], input=script, text=True, check=True)


if __name__ == '__main__':
    main()
