"""Docker HEALTHCHECK: healthy only when the model is on the GPU and JupyterLab answers."""

import sys
import urllib.error
import urllib.request


def ok(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=4) as res:
            return res.status == 200
    except (urllib.error.URLError, OSError):
        return False


studio = ok("http://127.0.0.1:8000/health")
jupyter = ok("http://127.0.0.1:8888/api")
if not (studio and jupyter):
    print(f"studio={'up' if studio else 'down'} jupyter={'up' if jupyter else 'down'}")
    sys.exit(1)
