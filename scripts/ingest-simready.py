#!/usr/bin/env python3
"""Ingest the NVIDIA SimReady assets (Hugging Face nvidia/simready-assets, CC BY 4.0)
into the three.ws object library.

For every asset folder it downloads only what the conversion needs (the USD layers
and the textures the materials reference, never the .thumbs or source_assets copies),
runs scripts/simready-to-glb.py, writes a 512px WebP poster from the dataset's own
thumbnail, records the entry in public/objects/simready/catalog.json (same schema as
public/objects/polyhaven/catalog.json) and deletes the download. Resumable: assets
already marked done are skipped.

Usage:
  python3 scripts/ingest-simready.py [--out DIR] [--workers 4] [--limit N] [--only NAME ...]

DIR (default ~/simready-out) receives glb/<slug>.glb and thumbs/<slug>.webp, ready for
scripts/publish-simready.mjs. Needs usd-core on PYTHONPATH (pip install usd-core).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

REPO = 'nvidia/simready-assets'
API = f'https://huggingface.co/api/datasets/{REPO}'
RAW = f'https://huggingface.co/datasets/{REPO}/resolve/main'
ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'public' / 'objects' / 'simready' / 'catalog.json'
CONVERTER = ROOT / 'scripts' / 'simready-to-glb.py'
SKIP_DIRS = ('/.thumbs', '/source_assets', '/.metadata')
TEX_EXT = ('.png', '.jpg', '.jpeg', '.exr', '.tga')

# Name prefix (before the first underscore or digit run) to a coarse category. Anything
# not listed falls into the category of its dataset collection (see collection_of).
COLLECTION_CATEGORY = {
    'props_hospital': 'hospital',
    'props_industrial': 'industrial',
    'props_residential': 'residential',
    'props_lighting': 'lighting',
    'props_oem': 'oem',
}


def backoff(err, attempt):
    """Seconds to wait after a failed request: Retry-After on a 429, else exponential."""
    if isinstance(err, urllib.error.HTTPError) and err.code == 429:
        try:
            return min(300, max(5, int(err.headers.get('Retry-After', ''))))
        except ValueError:
            return min(300, 20 * (attempt + 1))
    return 2 ** attempt


def http_json(url, retries=12):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'three.ws-simready-ingest'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r), r.headers
        except (urllib.error.URLError, TimeoutError) as e:
            if i == retries - 1:
                raise
            time.sleep(backoff(e, i))


def download(url, dest, retries=12):
    dest.parent.mkdir(parents=True, exist_ok=True)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'three.ws-simready-ingest'})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
                shutil.copyfileobj(r, f)
            return
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if i == retries - 1:
                raise
            time.sleep(backoff(e, i))


def list_assets():
    names, url = [], f'{API}/tree/main'
    while url:
        data, headers = http_json(url)
        names += [x['path'] for x in data if x['type'] == 'directory']
        m = re.search(r'<([^>]+)>;\s*rel="next"', headers.get('Link', ''))
        url = m.group(1) if m else None
    return sorted(names)


def asset_files(name):
    out, url = [], f'{API}/tree/main/{urllib.parse.quote(name)}/simready_usd?recursive=true'
    while url:
        data, headers = http_json(url)
        out += [x for x in data if x['type'] == 'file']
        m = re.search(r'<([^>]+)>;\s*rel="next"', headers.get('Link', ''))
        url = m.group(1) if m else None
    return out


def slugify(name):
    return re.sub(r'[^A-Za-z0-9_]+', '_', name).strip('_')


def pretty(name):
    words = re.sub(r'_[a-z]?\d+$', '', name)
    words = re.sub(r'([a-z])([A-Z])', r'\1 \2', words).replace('_', ' ')
    return re.sub(r'\s+', ' ', words).strip().title() or name


def tags_of(name):
    base = re.sub(r'_[a-z]?\d+$', '', name)
    base = re.sub(r'([a-z])([A-Z])', r'\1_\2', base)
    return sorted({t.lower() for t in base.split('_') if len(t) > 1 and not t.isdigit()})


def collection_of(root_usd):
    from pxr import Sdf
    layer_data = Sdf.Layer.FindOrOpen(str(root_usd)).customLayerData
    loc = (layer_data.get('SimReady_Metadata') or {}).get('asset_location', '')
    for part in re.split(r'[\\/]', loc):
        if part in COLLECTION_CATEGORY:
            return COLLECTION_CATEGORY[part]
    return None


def process(name, out_dir, max_tex, max_tris):
    slug = slugify(name)
    glb = out_dir / 'glb' / f'{slug}.glb'
    thumb = out_dir / 'thumbs' / f'{slug}.webp'
    files = asset_files(name)
    prefix = f'{name}/simready_usd/'
    rel = {f['path'][len(prefix):]: f for f in files}
    work = Path(tempfile.mkdtemp(prefix='simready-', dir=out_dir))
    try:
        keep = [r for r in rel if not any(('/' + r).startswith(s) or s + '/' in '/' + r for s in SKIP_DIRS)
                and not r.startswith('Textures/') and not r.startswith('.')]
        layers = [r for r in keep if r.endswith(('.usd', '.usda', '.usdc'))]
        for r in layers:
            download(f'{RAW}/{urllib.parse.quote(prefix + r)}', work / 'simready_usd' / r)
        referenced = set()
        for r in layers:
            p = work / 'simready_usd' / r
            if r.endswith('.usda'):
                referenced |= set(re.findall(r'[A-Za-z0-9_\-.]+\.(?:png|jpg|jpeg|exr|tga)', p.read_text(errors='ignore')))
        tex_paths = {Path(r).name: r for r in rel if r.startswith('Textures/') and r.lower().endswith(TEX_EXT)
                     and '/.thumbs' not in r}
        for t in referenced:
            if t in tex_paths:
                download(f'{RAW}/{urllib.parse.quote(prefix + tex_paths[t])}', work / 'simready_usd' / tex_paths[t])
        roots = sorted(r for r in layers if '/' not in r and r.startswith('sm_'))
        if not roots:
            roots = sorted(r for r in layers if '/' not in r)
        if not roots:
            raise RuntimeError('no root layer')
        glb.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.run([sys.executable, str(CONVERTER), str(work), str(glb), '--max-tex', str(max_tex)],
                              capture_output=True, text=True, env=os.environ)
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout).strip().splitlines()[-1][:300])
        stats = json.loads(proc.stdout.strip().splitlines()[-1])
        slim = subprocess.run(['node', str(ROOT / 'scripts' / 'slim-glb.mjs'), str(glb), f'--tris={max_tris}'],
                              capture_output=True, text=True, cwd=ROOT)
        if slim.returncode != 0:
            raise RuntimeError('slim: ' + (slim.stderr or slim.stdout).strip().splitlines()[-1][:280])
        slimmed = json.loads(slim.stdout.strip().splitlines()[-1])
        stats['bytes'], stats['tris'] = slimmed['bytes'], int(slimmed['tris_after'])
        category = collection_of(work / 'simready_usd' / roots[0])
        thumbs = [r for r in rel if r.startswith('.thumbs/') and r.endswith('_thumbnail.png')]
        has_thumb = False
        if thumbs:
            tmp = work / 'thumb.png'
            download(f'{RAW}/{urllib.parse.quote(prefix + thumbs[0])}', tmp)
            thumb.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(tmp) as im:
                im = im.convert('RGBA')
                im.thumbnail((512, 512), Image.LANCZOS)
                im.save(thumb, 'WEBP', quality=85)
            has_thumb = True
        cats = ['simready'] + ([category] if category else [])
        return {
            'slug': slug,
            'name': pretty(name),
            'categories': cats,
            'tags': tags_of(name),
            'authors': ['NVIDIA'],
            'glb_file': f'objects/simready/glb/{slug}.glb',
            'thumb_file': f'objects/simready/thumbs/{slug}.webp' if has_thumb else None,
            'glb_bytes': stats['bytes'],
            'meshes': stats['meshes'],
            'triangles': stats['tris'],
            'materials': stats['materials'],
            'size_m': stats['size_m'],
            'license': 'CC-BY-4.0',
            'attribution': 'NVIDIA SimReady Assets, CC BY 4.0, https://huggingface.co/datasets/nvidia/simready-assets',
            'source': 'simready',
            'status': 'done',
            'done_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def load_catalog():
    if CATALOG.exists():
        return json.loads(CATALOG.read_text())
    return {'source': 'nvidia/simready-assets', 'license': 'CC-BY-4.0', 'models': {}}


def save_catalog(cat):
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    tmp = CATALOG.with_suffix('.tmp')
    tmp.write_text(json.dumps(cat, indent=1, sort_keys=True) + '\n')
    tmp.replace(CATALOG)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(Path.home() / 'simready-out'))
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit', type=int)
    ap.add_argument('--max-tex', type=int, default=1024)
    ap.add_argument('--max-tris', type=int, default=80000)
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--retry-failed', action='store_true')
    a = ap.parse_args()
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    cat = load_catalog()
    models = cat['models']
    names = a.only or list_assets()
    todo = [n for n in names if (slugify(n) not in models)
            or (models[slugify(n)]['status'] != 'done' and a.retry_failed)]
    if a.limit:
        todo = todo[:a.limit]
    print(f'{len(names)} assets, {len(todo)} to ingest', flush=True)
    done = failed = 0
    with ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(process, n, out_dir, a.max_tex, a.max_tris): n for n in todo}
        for f in as_completed(futs):
            n = futs[f]
            try:
                models[slugify(n)] = f.result()
                done += 1
            except Exception as e:
                models[slugify(n)] = {'slug': slugify(n), 'name': pretty(n), 'status': 'failed', 'error': str(e)[:300],
                                      'source': 'simready'}
                failed += 1
                print(f'FAIL {n}: {e}', flush=True)
            if (done + failed) % 10 == 0:
                save_catalog(cat)
                print(f'{done} ok, {failed} failed of {len(todo)}', flush=True)
    save_catalog(cat)
    print(f'finished: {done} ok, {failed} failed', flush=True)


if __name__ == '__main__':
    main()
