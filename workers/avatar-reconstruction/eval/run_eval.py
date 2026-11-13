"""
Batch identity evaluation — score a whole reference set against a live
reconstruction worker, and compare two revisions head to head.

This is the regression gate for the reconstruction pipeline. Point it at a
directory of reference selfies and a deployed worker; it submits every photo,
waits for the GLBs, scores each with `identity_eval`, and writes a report. Run
it against two service URLs (or the same service before and after a change) to
get a defensible answer to "did that actually improve fidelity?" instead of
comparing screenshots.

Usage
-----
    export RECON_KEY=$(gcloud secrets versions access latest \
        --secret=avatar-reconstruction-key --project=aerial-vehicle-466722-p5)

    # score one deployment
    python -m eval.run_eval --photos eval/refs --url https://<service>.run.app \
        --out eval/reports/v2.json

    # score the pipeline in-process (no worker; same face_pipeline.process a job
    # runs), e.g. the dense head fit off and on
    DENSE_FIT=0 python -m eval.run_eval --photos eval/refs --local --out eval/reports/dense-off.json
    DENSE_FIT=1 python -m eval.run_eval --photos eval/refs --local --out eval/reports/dense-on.json

    # compare a report against an earlier one
    python -m eval.run_eval --compare eval/reports/v1.json eval/reports/v2.json

Reference set
-------------
`--photos` is a directory of frontal selfies. Use faces that span the axes the
pipeline is expected to handle — skin tone, age, face shape, facial hair,
glasses, lighting — because a mean over a narrow set hides exactly the failures
that matter. Each file is one sample; sub-directories are ignored.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import statistics
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import recon_templates  # noqa: E402
from eval.identity_eval import EvalError, evaluate  # noqa: E402

POLL_INTERVAL_S = 3.0
JOB_TIMEOUT_S = 300.0
SUBMIT_TIMEOUT_S = 60.0
PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def _data_url(path: Path) -> str:
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def reconstruct(client: httpx.Client, url: str, key: str, photo: Path, body_type: str) -> bytes:
    """Submit one photo, wait for the job, return the finished GLB bytes."""
    return reconstruct_data_url(client, url, key, _data_url(photo), photo.name, body_type)


def reconstruct_image(client: httpx.Client, url: str, key: str, img, label: str,
                      body_type: str = "neutral") -> bytes:
    """Submit an in-memory PIL image (e.g. a degraded variant) as a PNG."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data_url = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"
    return reconstruct_data_url(client, url, key, data_url, label, body_type)


def reconstruct_data_url(client: httpx.Client, url: str, key: str, data_url: str, label: str,
                         body_type: str) -> bytes:
    """Submit one image, wait for the job, return the finished GLB bytes."""
    headers = {"authorization": f"Bearer {key}"}
    submit = client.post(
        f"{url}/reconstruct",
        headers=headers,
        json={"images": [data_url], "body_type": body_type},
        timeout=SUBMIT_TIMEOUT_S,
    )
    submit.raise_for_status()
    job_id = submit.json()["job_id"]

    deadline = time.monotonic() + JOB_TIMEOUT_S
    while time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_S)
        poll = client.get(f"{url}/jobs/{job_id}", headers=headers, timeout=SUBMIT_TIMEOUT_S)
        if poll.status_code >= 500:
            # A cold GPU instance or a transient frontend error: the job itself is
            # still running server-side, so keep polling until the deadline.
            continue
        job = poll.json()
        status = job.get("status")
        if status == "done":
            glb_url = job.get("glb_url")
            if not glb_url:
                raise EvalError(f"{label}: job finished without a glb_url")
            glb = client.get(glb_url, timeout=120.0)
            glb.raise_for_status()
            return glb.content
        if status == "failed":
            detail = (job.get("error") or "unknown").strip().splitlines()[-1]
            raise EvalError(f"{label}: {detail}")

    raise EvalError(f"{label}: job {job_id} did not finish within {JOB_TIMEOUT_S:.0f}s")


def head_positions(glb_bytes: bytes):
    """The reconstructed head's vertex positions, in template vertex order."""
    import numpy as np

    import glb_ops

    positions, _, _ = glb_ops.get_head_mesh_data(glb_ops.load_glb(glb_bytes))
    return np.asarray(positions, dtype=np.float64)


class _DenseOutcome(logging.Handler):
    """Captures what the dense step did on one job from the pipeline's own log lines."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.outcome: str | None = None

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if record.name == "face_pipeline" and "dense fit refined" in msg:
            self.outcome = "refined: " + msg.split("dense fit refined the head: ", 1)[-1]
        elif record.name == "face_pipeline" and "dense fit skipped" in msg:
            self.outcome = "skipped: input not eligible"
        elif record.name == "dense_fit" and self.outcome is None:
            self.outcome = "kept morph: " + msg


def reconstruct_local(photo: Path, body_type: str) -> tuple[bytes, str | None]:
    """
    Run the job pipeline in this process, exactly as the worker's /reconstruct
    does. Returns the GLB and what the dense step did (None when it is off).
    """
    import face_pipeline

    watcher = _DenseOutcome()
    loggers = [logging.getLogger("face_pipeline"), logging.getLogger("dense_fit")]
    for lg in loggers:
        lg.addHandler(watcher)
        lg.setLevel(logging.INFO)
    try:
        glb = face_pipeline.process(f"eval-{photo.stem}", [_data_url(photo)], body_type)
    except Exception as exc:  # noqa: BLE001: a failing sample is reported, not fatal
        raise EvalError(f"{photo.name}: {exc}") from exc
    finally:
        for lg in loggers:
            lg.removeHandler(watcher)
    return glb, watcher.outcome


def local_health() -> dict:
    """The same fields the worker's /health reports, for the in-process path."""
    import dense_fit
    import face_pipeline

    geometry = face_pipeline.GEOMETRY_MORPH_ENABLED and face_pipeline._get_face_map() is not None
    return {
        "template": recon_templates.active().key,
        "pipeline": ("face_texture_transfer_v2" if geometry else "face_texture_transfer_v1") + " (local)",
        "geometry_morph": bool(geometry),
        "dense_fit": dense_fit.enabled() and dense_fit.torch_available(),
        "dense_fit_silhouette": dense_fit.silhouette_available(),
    }


def template_floor_glb(template: str, body_type: str, out: Path) -> Path:
    """
    The unmorphed template, shaped for body_type exactly as a job shapes it,
    written beside the report so every sample is scored against the floor its
    texture-only output would reach.
    """
    import glb_ops

    path = out.parent / f"{out.stem}-template-{template}-{body_type}.glb"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(glb_ops.save_glb(recon_templates.load(recon_templates.get(template), body_type)))
    return path


def run(photos: Path, url: str | None, key: str | None, out: Path, body_type: str, keep_glb: bool) -> dict:
    samples = sorted(p for p in photos.iterdir() if p.suffix.lower() in PHOTO_SUFFIXES)
    if not samples:
        raise EvalError(f"no photos in {photos} (looked for {', '.join(sorted(PHOTO_SUFFIXES))})")

    glb_dir = out.parent / f"{out.stem}-glb"
    if keep_glb:
        glb_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    failures: list[dict] = []

    with httpx.Client(follow_redirects=True) as client:
        health = client.get(f"{url}/health", timeout=30.0).json() if url else local_health()
        # Workers older than the template switch report no key: they ran Wolf3D.
        template = health.get("template", "wolf3d")
        floor_glb = template_floor_glb(template, body_type, out)
        uv_map = recon_templates.get(template).uv_map_path
        print(f"worker: {health.get('pipeline')}  template={template}  "
              f"geometry_morph={health.get('geometry_morph')}  "
              f"dense_fit={health.get('dense_fit')}  silhouette={health.get('dense_fit_silhouette')}")

        for i, photo in enumerate(samples, 1):
            print(f"[{i}/{len(samples)}] {photo.name} … ", end="", flush=True)
            try:
                dense = None
                if url:
                    glb_bytes = reconstruct(client, url, key, photo, body_type)
                else:
                    glb_bytes, dense = reconstruct_local(photo, body_type)
                glb_path = (glb_dir if keep_glb else out.parent) / f"{photo.stem}.glb"
                glb_path.parent.mkdir(parents=True, exist_ok=True)
                glb_path.write_bytes(glb_bytes)
                result = evaluate(photo, glb_path, floor_glb, uv_map)
                if not keep_glb:
                    glb_path.unlink()
                if dense is not None:
                    result["dense"] = dense
                results.append(result)
                print(f"ISE {result['ise']:.4f}  floor {result['template_floor']:.4f}"
                      + (f"  [dense {dense}]" if dense else ""))
            except (EvalError, httpx.HTTPError) as exc:
                failures.append({"selfie": photo.name, "error": str(exc)})
                print(f"FAILED — {exc}")

    floor_glb.unlink()
    if not results:
        raise EvalError("every sample failed — nothing to summarise")

    scores = [r["ise"] for r in results]
    regions = sorted({name for r in results for name in r["regions"]})
    report = {
        "url": url or "local",
        "template": template,
        "body_type": body_type,
        "pipeline": health.get("pipeline"),
        "geometry_morph": health.get("geometry_morph"),
        "dense_fit": health.get("dense_fit"),
        "dense_fit_silhouette": health.get("dense_fit_silhouette"),
        "samples": len(results),
        "failed": len(failures),
        "ise_mean": statistics.fmean(scores),
        "ise_median": statistics.median(scores),
        "ise_worst": max(scores),
        "template_floor_mean": statistics.fmean([r["template_floor"] for r in results]),
        "improvement_mean": statistics.fmean([r["improvement"] for r in results]),
        "region_mean": {
            name: statistics.fmean([r["regions"][name] for r in results if name in r["regions"]])
            for name in regions
        },
        "dense_refined": sum(1 for r in results if str(r.get("dense", "")).startswith("refined")),
        "results": results,
        "failures": failures,
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(f"\n{report['samples']} scored, {report['failed']} failed")
    print(f"  ISE mean   {report['ise_mean']:.4f}")
    print(f"  ISE median {report['ise_median']:.4f}")
    print(f"  ISE worst  {report['ise_worst']:.4f}")
    print(f"  template floor mean {report['template_floor_mean']:.4f}  "
          f"(morph closes {report['improvement_mean'] * 100:.1f}% of it)")
    print(f"  report → {out}")
    return report


def compare(before: Path, after: Path) -> int:
    a, b = json.loads(before.read_text()), json.loads(after.read_text())
    delta = b["ise_mean"] - a["ise_mean"]
    pct = (-delta / a["ise_mean"] * 100) if a["ise_mean"] else 0.0

    def label(r):
        dense = "" if r.get("dense_fit") is None else f", dense_fit={r['dense_fit']}"
        return f"{r.get('template', 'wolf3d')}, {r.get('pipeline')}{dense}"

    def floor(r):
        return f"  floor {r['template_floor_mean']:.4f}" if "template_floor_mean" in r else ""

    print(f"{before.name}  ({label(a)})  ISE {a['ise_mean']:.4f}{floor(a)}  n={a['samples']}")
    print(f"{after.name}   ({label(b)})  ISE {b['ise_mean']:.4f}{floor(b)}  n={b['samples']}")
    print(f"\n{'IMPROVED' if delta < 0 else 'REGRESSED'} {abs(pct):.1f}%")

    print("\nby region:")
    for name in sorted(set(a["region_mean"]) & set(b["region_mean"])):
        av, bv = a["region_mean"][name], b["region_mean"][name]
        arrow = "↓" if bv < av else "↑"
        print(f"  {name:8s} {av:.4f} → {bv:.4f}  {arrow}{abs(bv - av) / av * 100:5.1f}%")

    # Per-face movement catches a change that improves the mean while making
    # some faces materially worse — the failure mode a mean alone hides.
    by_name = {r["selfie"]: r["ise"] for r in a["results"]}
    regressions = [
        (r["selfie"], by_name[r["selfie"]], r["ise"])
        for r in b["results"]
        if r["selfie"] in by_name and r["ise"] > by_name[r["selfie"]] * 1.02
    ]
    if regressions:
        print(f"\n{len(regressions)} face(s) got worse:")
        for name, av, bv in sorted(regressions, key=lambda t: t[1] - t[2]):
            print(f"  {name:30s} {av:.4f} → {bv:.4f}")

    return 0 if delta < 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--photos", type=Path, help="directory of reference selfies")
    ap.add_argument("--url", help="worker base URL")
    ap.add_argument("--local", action="store_true",
                    help="run face_pipeline.process in this process instead of calling a worker")
    ap.add_argument("--key", default=os.environ.get("RECON_KEY"), help="worker API key (or $RECON_KEY)")
    ap.add_argument("--out", type=Path, default=Path("eval/reports/latest.json"))
    ap.add_argument("--body-type", default="neutral", choices=["male", "female", "neutral"])
    ap.add_argument("--keep-glb", action="store_true", help="keep the GLBs for visual inspection")
    ap.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"))
    args = ap.parse_args()

    if args.compare:
        return compare(*args.compare)

    if args.local:
        if not args.photos:
            ap.error("--photos is required")
    elif not (args.photos and args.url and args.key):
        ap.error("--photos and either --local or --url with --key (or $RECON_KEY) are required "
                 "unless --compare is used")

    try:
        run(args.photos, None if args.local else args.url.rstrip("/"),
            args.key, args.out, args.body_type, args.keep_glb)
    except EvalError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
