"""Classify why an owner's public repos show failing CI on their latest commit.

Reads collect_wide.py output plus own_private.json, looks up the latest failed
Actions run per repo, and records whether the job failed in a step (a real code
problem) or never started (billing lock, spending limit, runner unavailable).

Usage: GH_TOKEN=... python3 -I ci_reasons.py OUT_DIR [--owner nirholas]
"""
import argparse, collections, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

TOK = os.environ["GH_TOKEN"]
H = {"Authorization": f"Bearer {TOK}", "User-Agent": "bench", "Accept": "application/vnd.github+json"}


def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request("https://api.github.com" + path, headers=H), timeout=20) as r:
            return json.load(r)
    except Exception:
        return None


def classify(repo):
    runs = (get(f"/repos/{repo}/actions/runs?per_page=1&status=failure") or {}).get("workflow_runs") or []
    if not runs:
        return {"repo": repo, "reason": "external-status", "detail": "no failed Actions run; failing status comes from another app", "date": None}
    run = runs[0]
    jobs = (get(f"/repos/{repo}/actions/runs/{run['id']}/jobs") or {}).get("jobs") or []
    for job in jobs:
        if job.get("conclusion") != "failure":
            continue
        if job.get("steps"):
            steps = [s["name"] for s in job["steps"] if s.get("conclusion") == "failure"]
            return {"repo": repo, "reason": "step-failed", "detail": f"{run['name']} / {job['name']}: {', '.join(steps)}", "date": run["created_at"][:10]}
        notes = " ".join(a.get("message", "") for a in (get(f"/repos/{repo}/check-runs/{job['id']}/annotations") or []))
        reason = "billing-lock" if "billing" in notes else "spending-limit" if "spending limit" in notes else "not-started"
        return {"repo": repo, "reason": reason, "detail": f"{run['name']} / {job['name']}: {notes[:160]}", "date": run["created_at"][:10]}
    return {"repo": repo, "reason": "unknown", "detail": run["name"], "date": run["created_at"][:10]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--owner", default="nirholas")
    a = ap.parse_args()
    private = set(json.load(open(os.path.join(a.out, "own_private.json"))))
    rows = [json.loads(l) for l in open(os.path.join(a.out, "repos.jsonl"))]
    own = [r for r in rows if r["repo"].lower().startswith(a.owner.lower() + "/") and r["repo"] not in private and not r["fork"] and not r["archived"]]
    failing = [r["repo"] for r in own if next((s for s in r["ci_states"] if s), None) in ("FAILURE", "ERROR")]
    print(f"public source repos {len(own)}, latest commit failing {len(failing)}", file=sys.stderr, flush=True)
    results = []
    with ThreadPoolExecutor(8) as ex:
        for i, res in enumerate(ex.map(classify, failing)):
            results.append(res)
            if i % 20 == 0:
                print(f"  {i}/{len(failing)}", file=sys.stderr, flush=True)
    json.dump({"public_source": len(own), "failing": len(failing), "results": results}, open(os.path.join(a.out, "ci_reasons.json"), "w"), indent=1)
    print(dict(collections.Counter(r["reason"] for r in results)), file=sys.stderr, flush=True)


main()
