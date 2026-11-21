"""GPU verification harness: the whole pipeline, in-process, over the real fixtures.

Runs the same ``run_pipeline`` the service runs (no HTTP) for every entry of
gs://<FIXTURE_BUCKET>/insta360/MANIFEST.json that has ``"verify": true``, uploads
the outputs and a ``verify-report.json`` to gs://<RESULT_BUCKET>/verify-<date>/.
A stage package that is not in the image is reported as missing, never faked.

Manifest entry fields used here (everything else in an entry is documentation):
  id            unique slug, names the output folder
  objects       object keys inside FIXTURE_BUCKET (several for a split-pair .insv or a photo set);
                gcs_uri / gcs_uris (full gs:// URIs) are accepted instead
  source_kind   equirect_video | equirect_images | insv | insp
  verify        true to include the entry
  task          optional, "splat" (default) or "stitch"
  quality       optional preset for this entry

Environment: FIXTURE_BUCKET (three-ws-capture-fixtures), RESULT_BUCKET
(three-ws-pano-captures), VERIFY_QUALITY (standard), VERIFY_ONLY (comma separated ids),
VERIFY_RUN_ID (verify-<utc date>).

Exit code: 0 when every fixture that could run succeeded, 1 when one failed for a reason
other than a missing stage package, 2 when no fixture was selected.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import health
import stages
from pipeline import PipelineError, PipelineRequest, run_pipeline
from results import content_type_for
from source_fetch import MAX_SOURCE_BYTES, ByteBudget, SourceError, sniff
from stages import Cancelled, StageRunner

FIXTURE_BUCKET = os.environ.get("FIXTURE_BUCKET", "three-ws-capture-fixtures")
RESULT_BUCKET = os.environ.get("RESULT_BUCKET", "three-ws-pano-captures")
MANIFEST_KEY = "insta360/MANIFEST.json"


def log(msg: str, **fields) -> None:
    print(json.dumps({"verify": msg, **fields}), flush=True)


def load_manifest(client) -> list[dict]:
    blob = client.bucket(FIXTURE_BUCKET).blob(MANIFEST_KEY)
    if not blob.exists():
        return []
    data = json.loads(blob.download_as_bytes())
    if isinstance(data, dict):
        for key in ("fixtures", "entries", "items"):
            if isinstance(data.get(key), list):
                return data[key]
        return []
    return data if isinstance(data, list) else []


def split_gs(uri: str) -> tuple[str, str]:
    assert uri.startswith("gs://"), uri
    bucket, _, key = uri[5:].partition("/")
    return bucket, key


def gcs_fetcher(client):
    """A ``download_source`` stand-in that reads gs:// objects, with the same sniffing."""

    def fetch(uri: str, dest_stem: Path, source_kind: str, budget: ByteBudget, **_kw) -> Path:
        bucket, key = split_gs(uri)
        blob = client.bucket(bucket).blob(key)
        tmp = dest_stem.with_name(dest_stem.name + ".part")
        blob.download_to_filename(str(tmp))
        budget.take(tmp.stat().st_size)
        with open(tmp, "rb") as fh:
            ext = sniff(fh.read(16), source_kind)
        if ext is None:
            tmp.unlink()
            raise SourceError("unsupported_input", f"{uri} is not valid for source_kind {source_kind}.")
        final = dest_stem.with_name(dest_stem.name + ext)
        tmp.rename(final)
        return final

    return fetch


def nvenc_probe(work: Path) -> dict:
    """Does NVENC encode and NVDEC decode actually work on this instance's GPU?"""
    clip = work / "nvenc-probe.mp4"
    enc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30",
         "-t", "2", "-c:v", "h264_nvenc", str(clip)],
        capture_output=True, text=True,
    )
    dec = None
    if enc.returncode == 0:
        dec = subprocess.run(
            ["ffmpeg", "-hide_banner", "-y", "-hwaccel", "cuda", "-i", str(clip), "-f", "null", "-"],
            capture_output=True, text=True,
        )
    return {
        "nvenc_encode_ok": enc.returncode == 0,
        "nvdec_decode_ok": bool(dec and dec.returncode == 0),
        "nvenc_error": None if enc.returncode == 0 else enc.stderr.strip().splitlines()[-1:],
    }


def run_fixture(entry: dict, client, out_prefix: str, quality_default: str) -> dict:
    fid = entry["id"]
    uris = entry.get("gcs_uris") or ([entry["gcs_uri"]] if entry.get("gcs_uri") else [f"gs://{FIXTURE_BUCKET}/{o}" for o in entry["objects"]])
    kind = entry["source_kind"]
    quality = entry.get("quality") or quality_default
    req = PipelineRequest(
        task=entry.get("task", "splat"),
        source_kind=kind,
        urls=list(uris),
        quality=quality,
        trim_start_s=entry.get("trim_start_s"),
        trim_end_s=entry.get("trim_end_s"),
    )
    record: dict = {"id": fid, "source_kind": kind, "task": req.task, "quality": quality, "uris": uris}
    work = Path(tempfile.mkdtemp(prefix=f"verify-{fid}-"))
    t0 = time.monotonic()
    last = {"stage": None}

    def report(stage: str, progress: float) -> None:
        if stage != last["stage"]:
            last["stage"] = stage
            log("stage", fixture=fid, stage=stage, progress=progress)

    try:
        out = run_pipeline(req, work, report, StageRunner(), ByteBudget(MAX_SOURCE_BYTES), fetch=gcs_fetcher(client))
        record["status"] = "ok"
        record["stats"] = out.stats
        record["timings_s"] = out.timings_s
        record["outputs"] = {}
        bucket = client.bucket(RESULT_BUCKET)
        for name, path in out.files.items():
            key = f"{out_prefix}/{fid}/{path.name}"
            bucket.blob(key).upload_from_filename(str(path), content_type=content_type_for(key))
            record["outputs"][name] = {"uri": f"gs://{RESULT_BUCKET}/{key}", "bytes": path.stat().st_size}
    except PipelineError as exc:
        record["status"] = "stage_missing" if exc.code == "stage_missing" else "failed"
        record["error"] = {"code": exc.code, "message": exc.message}
    except Cancelled:
        record["status"] = "failed"
        record["error"] = {"code": "cancelled", "message": "cancelled"}
    except Exception as exc:  # noqa: BLE001 - one broken fixture must not hide the others
        record["status"] = "failed"
        record["error"] = {"code": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
    finally:
        record["wall_s"] = round(time.monotonic() - t0, 1)
        shutil.rmtree(work, ignore_errors=True)
    log("fixture done", fixture=fid, status=record["status"], wall_s=record["wall_s"], error=record.get("error"))
    return record


def main() -> int:
    from google.cloud import storage

    client = storage.Client()
    run_id = os.environ.get("VERIFY_RUN_ID") or f"verify-{datetime.now(timezone.utc):%Y-%m-%d}"
    quality = os.environ.get("VERIFY_QUALITY", "standard")
    only = {s for s in os.environ.get("VERIFY_ONLY", "").split(",") if s}

    entries = [e for e in load_manifest(client) if e.get("verify") is True]
    if only:
        entries = [e for e in entries if e.get("id") in only]

    scratch = Path(tempfile.mkdtemp(prefix="verify-env-"))
    env_report = {
        "gpu_available": health.gpu_available(),
        "nvidia_smi": (subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                                      capture_output=True, text=True).stdout.strip() if shutil.which("nvidia-smi") else None),
        "colmap_version": health.colmap_version(),
        "gsplat_version": health.gsplat_version(),
        "ffmpeg": health.ffmpeg_info(),
        "stages": health.stage_status(),
        "stages_dir": str(stages.STAGES_DIR),
    }
    env_report.update(nvenc_probe(scratch))
    shutil.rmtree(scratch, ignore_errors=True)
    log("environment", **env_report)

    results = [run_fixture(e, client, run_id, quality) for e in entries]
    report = {
        "run_id": run_id,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "environment": env_report,
        "fixtures_selected": len(entries),
        "fixtures": results,
        "summary": {s: sum(1 for r in results if r["status"] == s) for s in ("ok", "failed", "stage_missing")},
    }
    key = f"{run_id}/verify-report.json"
    client.bucket(RESULT_BUCKET).blob(key).upload_from_string(json.dumps(report, indent=2), content_type="application/json")
    log("report", uri=f"gs://{RESULT_BUCKET}/{key}", summary=report["summary"])
    if not entries:
        return 2
    return 1 if report["summary"]["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
