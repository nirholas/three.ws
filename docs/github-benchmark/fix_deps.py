"""Prepare dependency security fixes for an owner's repos, locally, without pushing.

For each repo: clone it (public, no credentials in the remote), group its open
Dependabot alerts by the lockfile that owns them, refresh the vulnerable packages
inside their declared ranges, then pin what is left to the highest patched release
in the same major (dep_plan.mjs) via npm overrides, pnpm overrides, yarn resolutions
or cargo update. Alerts are counted open while any locked version sits in a
vulnerable range. Build and tests run after the change; a failing step is rerun on
the original lockfile to separate pre-existing failures from regressions. Repos with
fewer open alerts get a commit on a local branch. Pushing is a separate, owner-run
step (push_fixes.sh).

Usage: GH_TOKEN=... python3 -I fix_deps.py OUT_DIR CLONE_DIR repo [repo ...]
"""
import json, os, re, shutil, subprocess, sys, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

TOK = os.environ["GH_TOKEN"]
OUT, WORK = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
REPOS = sys.argv[3:]
HERE = os.path.dirname(os.path.abspath(__file__))
BRANCH = "fix/security-overrides"
ENV = dict(os.environ, CI="true", npm_config_fund="false", npm_config_update_notifier="false",
           npm_config_audit="false", COREPACK_ENABLE_DOWNLOAD_PROMPT="0",
           PATH=os.path.expanduser("~/.cargo/bin") + os.pathsep + os.environ["PATH"])
ENV.pop("GH_TOKEN", None)
LOCKS = (("package-lock.json", "npm"), ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("Cargo.lock", "cargo"))
ECO = {"npm": "npm", "pnpm": "npm", "yarn": "npm", "cargo": "rust"}


def api(path):
    out, url = [], "https://api.github.com" + path
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOK}", "User-Agent": "fix-deps", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out += json.load(r)
            m = re.search(r'<([^>]+)>;\s*rel="next"', r.headers.get("Link") or "")
            url = m.group(1) if m else None
    return out


def sh(cmd, cwd, log, timeout=900):
    log.write(f"\n$ {cmd}  (in {cwd})\n")
    log.flush()
    try:
        p = subprocess.run(cmd, cwd=cwd, shell=True, env=ENV, capture_output=True, text=True, timeout=timeout)
        log.write(p.stdout[-5000:] + p.stderr[-5000:])
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        log.write("TIMEOUT\n")
        return 124, "", "timeout"


def plan(mode, d, kind, alerts, log):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(alerts, f)
    try:
        code, out, err = sh(f"node {HERE}/dep_plan.mjs {mode} . {kind} {f.name}", d, log, 600)
        return json.loads(out.strip().splitlines()[-1]) if code == 0 else {"error": err[-300:]}
    finally:
        os.unlink(f.name)


def read_pkg(d):
    return json.load(open(os.path.join(d, "package.json")))


def write_pkg(d, pkg):
    with open(os.path.join(d, "package.json"), "w") as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write("\n")


def yarn_cmd(d):
    lock = open(os.path.join(d, "yarn.lock")).read(4000)
    return "corepack yarn" if "__metadata" in lock else "yarn"


def pnpm_cmd(d):
    pm = read_pkg(d).get("packageManager", "")
    return f"npx -y {pm.split('+')[0]}" if pm.startswith("pnpm@") else "pnpm"


def in_group(spec, group):
    m = re.search(r"(\d+)(?:\.(\d+))?", spec)
    if not m:
        return False
    if group.startswith("0."):
        return m.group(1) == "0" and f"0.{m.group(2) or 0}" == group
    return m.group(1) == group


def bump_direct(pkg, overrides):
    """Direct deps inside an overridden major get the same spec (npm rejects a mismatch)."""
    for key, val in overrides.items():
        name, group = key.rsplit("@", 1)
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            spec = (pkg.get(section) or {}).get(name)
            if spec and in_group(spec, group):
                pkg[section][name] = val


def apply(kind, d, alerts, log):
    names = " ".join(sorted({a["pkg"] for a in alerts}))
    if kind == "npm":
        sh(f"npm update {names} --package-lock-only --ignore-scripts", d, log)
    elif kind == "pnpm":
        sh(f"{pnpm_cmd(d)} update {names} --recursive --depth Infinity --lockfile-only --ignore-scripts", d, log)
    elif kind == "cargo":
        p = plan("plan", d, kind, alerts, log)
        for crate, versions in (p.get("vulnerableVersions") or {}).items():
            for v in versions:
                sh(f"cargo update -p {crate}@{v}", d, log, 900)
        return plan("plan", d, kind, alerts, log)

    p = plan("plan", d, kind, alerts, log)
    ov = p.get("overrides") or {}
    if not ov:
        return p
    pkg = read_pkg(d)
    if kind == "npm":
        bump_direct(pkg, ov)
        pkg["overrides"] = {**(pkg.get("overrides") or {}), **ov}
        write_pkg(d, pkg)
        code, _, err = sh("npm install --package-lock-only --ignore-scripts", d, log)
        if code != 0 and "EOVERRIDE" in err:
            bad = set(re.findall(r"Override for (\S+?)@\S+ conflicts", err))
            pkg["overrides"] = {k: v for k, v in pkg["overrides"].items() if k.rsplit("@", 1)[0] not in bad}
            write_pkg(d, pkg)
            sh("npm install --package-lock-only --ignore-scripts", d, log)
    elif kind == "pnpm":
        ws = os.path.join(d, "pnpm-workspace.yaml")
        text = open(ws).read() if os.path.exists(ws) else ""
        if re.search(r"^overrides:", text, re.M):
            lines = "".join(f"  '{k}': '{v}'\n" for k, v in ov.items())
            text = re.sub(r"^overrides:[ \t]*\n", lambda m: m.group(0) + lines, text, count=1, flags=re.M)
            open(ws, "w").write(text)
        else:
            bump_direct(pkg, ov)
            pkg.setdefault("pnpm", {})
            pkg["pnpm"]["overrides"] = {**(pkg["pnpm"].get("overrides") or {}), **ov}
            write_pkg(d, pkg)
        sh(f"{pnpm_cmd(d)} install --lockfile-only --ignore-scripts", d, log)
    elif kind == "yarn":
        before = dict(pkg.get("resolutions") or {})
        res = dict(before)
        for key, val in ov.items():
            name = key.rsplit("@", 1)[0]
            if p["installedGroups"].get(name) == 1:
                res[f"**/{name}"] = val
        if res != before:
            pkg["resolutions"] = res
            write_pkg(d, pkg)
            y = yarn_cmd(d)
            sh(f"{y} install --mode=update-lockfile" if y.startswith("corepack") else "yarn install --ignore-scripts --non-interactive", d, log, 1500)
    return plan("plan", d, kind, alerts, log)


def verify(kind, d, log):
    """Install and run build + test. Returns step -> exit code."""
    if kind == "cargo":
        return {"check": sh("cargo check --locked --all-targets", d, log, 2400)[0]}
    scripts = read_pkg(d).get("scripts") or {}
    if kind == "npm":
        install, runner = "npm ci", "npm run"
    elif kind == "pnpm":
        install, runner = f"{pnpm_cmd(d)} install --frozen-lockfile", f"{pnpm_cmd(d)} run"
    else:
        y = yarn_cmd(d)
        install = f"{y} install --immutable" if y.startswith("corepack") else "yarn install --frozen-lockfile --non-interactive"
        runner = f"{y} run"
    res = {"install": sh(install, d, log, 1800)[0]}
    if res["install"] == 0:
        for step in ("build", "test"):
            if step in scripts and "no test specified" not in scripts[step]:
                res[step] = sh(f"{runner} {step}", d, log, 1200)[0]
    return res


def fetch_alerts(full):
    alerts = []
    for x in api(f"/repos/{full}/dependabot/alerts?state=open&per_page=100"):
        pk = x["dependency"]["package"]
        ranges = [v["vulnerable_version_range"] for v in x["security_advisory"]["vulnerabilities"]
                  if v["package"]["name"] == pk["name"] and v["package"]["ecosystem"] == pk["ecosystem"]]
        alerts.append({"id": x["number"], "pkg": pk["name"], "eco": pk["ecosystem"], "manifest": x["dependency"]["manifest_path"],
                       "ranges": ranges or [x["security_vulnerability"]["vulnerable_version_range"]], "sev": x["security_advisory"]["severity"]})
    return alerts


def commit_message(touched, groups):
    closed = sum(g["before"] - g["after"] for g in touched)
    total = sum(g["before"] or 0 for g in groups)
    lines = []
    for g in touched:
        steps = ", ".join(f"{k} {'ok' if v == 0 else 'failed'}" for k, v in g["verify"].items())
        pre = [k for k, v in (g.get("baseline") or {}).items() if v != 0]
        lines.append(f'- {g["dir"]} ({g["kind"]}): {g["before"]} -> {g["after"]} open alerts; {steps}'
                     + (f' (also failing before this change: {", ".join(pre)})' if pre else ""))
    left = sorted({u for g in groups for u in g.get("unfixable", [])})
    return (f"fix(deps): close {closed} of {total} Dependabot alerts with patched releases in the same major\n\n"
            "Each vulnerable package moves to the highest patched release inside the major it is already on,\n"
            "so no dependent gets an API it was not built against.\n\n" + "\n".join(lines)
            + ("\n\nStill open (needs a parent upgrade):\n" + "\n".join(f"- {u}" for u in left) if left else "")
            + "\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n"), closed


def process(full):
    name = full.split("/")[1]
    d = os.path.join(WORK, name)
    log = open(os.path.join(OUT, "dep_logs", f"{name}.log"), "w")
    result = {"repo": full, "groups": [], "unhandled": []}
    try:
        if os.path.exists(d):
            shutil.rmtree(d)
        if sh(f"git clone --depth 1 https://github.com/{full}.git {d}", WORK, log, 900)[0] != 0:
            result["error"] = "clone failed"
            return result
        result["base"] = sh("git rev-parse --abbrev-ref HEAD", d, log)[1].strip()
        sh(f"git checkout -b {BRANCH}", d, log)
        alerts = fetch_alerts(full)
        result["alerts"] = len(alerts)
        groups = {}
        for a in alerts:
            p, hit = os.path.dirname(a["manifest"]), None
            while True:
                hit = next(((f, k) for f, k in LOCKS if os.path.exists(os.path.join(d, p, f)) and ECO[k] == a["eco"]), None)
                if hit or not p:
                    break
                p = os.path.dirname(p)
            if hit:
                groups.setdefault((p, hit[1]), []).append(a)
            else:
                result["unhandled"].append(f'{a["eco"]}:{a["pkg"]} in {a["manifest"]}')
        for (p, kind), ga in sorted(groups.items()):
            gd = os.path.join(d, p)
            g = {"dir": p or ".", "kind": kind, "alerts": len(ga), "before": plan("check", gd, kind, ga, log).get("open"),
                 "unfixable": [], "regressions": []}
            result["groups"].append(g)
            if not g["before"]:
                g.update(after=g["before"], note="locked versions already outside every vulnerable range")
                continue
            after = apply(kind, gd, ga, log)
            g["after"], g["unfixable"] = after.get("open"), after.get("unfixable", [])
            if after.get("error"):
                g["error"] = after["error"]
            g["changed"] = bool(sh("git status --porcelain -- .", gd, log)[1].strip())
            if not g["changed"]:
                continue
            g["verify"] = verify(kind, gd, log)
            failed = [k for k, v in g["verify"].items() if v != 0]
            if failed:
                sh("git stash push --include-untracked -- .", gd, log)
                g["baseline"] = verify(kind, gd, log)
                sh("git checkout -- . && git stash pop", gd, log)
                g["regressions"] = [k for k in failed if g["baseline"].get(k) == 0]
        sh("git clean -fdX -e '!.env*'", d, log)
        touched = [g for g in result["groups"] if g.get("changed") and g["after"] is not None and g["after"] < g["before"]]
        for g in result["groups"]:
            if g.get("changed") and g not in touched:
                sh(f"git checkout -- {g['dir']}", d, log)
        if touched:
            msg, result["closed"] = commit_message(touched, result["groups"])
            msgfile = os.path.join(OUT, "dep_logs", f"{name}.msg")
            open(msgfile, "w").write(msg)
            sh("git add -A", d, log)
            sh(f"git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com commit -q -F {msgfile}", d, log)
            result["commit"] = sh("git rev-parse --short HEAD", d, log)[1].strip()
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    finally:
        log.close()
        print(json.dumps({k: result.get(k) for k in ("repo", "alerts", "closed", "commit", "error")}), flush=True)
    return result


os.makedirs(WORK, exist_ok=True)
os.makedirs(os.path.join(OUT, "dep_logs"), exist_ok=True)
with ThreadPoolExecutor(4) as ex:
    results = list(ex.map(process, REPOS))
path = os.path.join(OUT, "dep_fixes.json")
prev = {r["repo"]: r for r in json.load(open(path))} if os.path.exists(path) else {}
prev.update({r["repo"]: r for r in results})
json.dump(list(prev.values()), open(path, "w"), indent=1)
