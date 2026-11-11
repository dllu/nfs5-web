#!/usr/bin/env python3
"""Upload the static release to nfspu.com and update its Caddy routes."""
import argparse
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HOST = 'pupserver.linode'
DESTINATION = '/www/nfspu'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-legacy-route', action='store_true',
                        help='Keep the old game route while verifying the new domain')
    args = parser.parse_args()
    release = ROOT / 'build/public'
    if not (release / 'index.html').is_file() or not (release / 'engine.wasm.gz').is_file():
        raise RuntimeError('Run npm run build:public first')
    subprocess.run(['ssh', HOST, 'mkdir -p ' + shlex.quote(DESTINATION)], check=True)
    # Content-addressed payloads are uploaded first. Keep old payloads so an
    # already-running browser can finish its current release after an update.
    subprocess.run(['rsync', '-az', '--exclude=index.html', str(release) + '/', HOST + ':' + DESTINATION + '/'], check=True)
    subprocess.run(['rsync', '-az', str(release / 'index.html'), HOST + ':' + DESTINATION + '/index.html'], check=True)
    blocks = [('nfspu-web', (ROOT / 'tools/nfs5.caddy').read_text(), None)]
    if not args.keep_legacy_route:
        blocks.append(('nfs5-web', (ROOT / 'tools/nfs5-redirect.caddy').read_text(),
                       'lawrence.lu, daniel.lawrence.lu {\n'))
    # Edit this project's delimited blocks. Validate and back up the existing
    # configuration before reloading, restoring it if validation or reload fails.
    script = '''from pathlib import Path
import datetime, subprocess
path=Path('/etc/caddy/Caddyfile')
original=path.read_text()
updated=original
for name,fragment,site in BLOCKS:
    start='# BEGIN '+name+'\\n'
    end='# END '+name+'\\n'
    block=start+fragment+end
    if start in updated:
        if updated.count(start)!=1 or updated.count(end)!=1:
            raise RuntimeError('Duplicate Caddy block markers for '+name)
        before,rest=updated.split(start,1)
        _,after=rest.split(end,1)
        updated=before+block+after
    elif site:
        if updated.count('\\n'+site)!=1:
            raise RuntimeError('Cannot locate the intended Caddy site block')
        updated=updated.replace('\\n'+site,'\\n'+site+block,1)
    else:
        updated=updated.rstrip()+'\\n\\n'+block
if updated!=original:
    backup=path.with_name('Caddyfile.pre-nfs5-'+datetime.datetime.now().strftime('%Y%m%dT%H%M%S'))
    backup.write_text(original)
    path.write_text(updated)
    try:
        subprocess.run(['caddy','validate','--config',str(path),'--adapter','caddyfile'],check=True)
        subprocess.run(['systemctl','reload','caddy'],check=True)
    except BaseException:
        path.write_text(original)
        subprocess.run(['systemctl','reload','caddy'],check=False)
        raise
print('https://nfspu.com/')
'''.replace('BLOCKS', repr(blocks))
    subprocess.run(['ssh', HOST, 'sudo -n python3 -'], input=script, text=True, check=True)


if __name__ == '__main__':
    main()
