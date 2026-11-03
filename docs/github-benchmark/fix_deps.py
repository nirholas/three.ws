"""Prepare dependency security fixes for an owner's repos, locally, without pushing.

For each repo: clone it (public, no credentials in the remote), group its open
Dependabot alerts by the lockfile that owns them, apply the package manager's own
safe fix, then add range-scoped overrides for transitive packages that a parent
pins, re-audit, run build and tests (re-running on the original lockfile when one
fails, to separate pre-existing failures from regressions), and commit to a local
branch. Results go to OUT_DIR/dep_fixes.json. Pushing is a separate, explicit step
(push_fixes.sh).

Usage: GH_TOKEN=... python3 -I fix_deps.py OUT_DIR CLONE_DIR repo [repo ...]
"""
import json, os, re, shutil, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

TOK = os.environ["GH_TOKEN"]
OUT, WORK = sys.argv[1], sys.argv[2]
REPOS = sys.argv[3:]
BRANCH = "fix/security-overrides"
ENV = dict(os.environ, CI="true", npm_config_fund="false", npm_config_update_notifier="false",
           PATH=os.path.expanduser("~/.cargo/bin") + os.pathsep + os.environ["PATH"])
ENV.pop("GH_TOKEN", None)
LOCKS = (("package-lock.json", "npm"), ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("Cargo.lock", "cargo"))


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
        log.write(p.stdout[-6000:] + p.stderr[-6000:])
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        log.write("TIMEOUT\n")
        return 124, "", "timeout"


def npm_range(r):
    """Dependabot range ('>= 9.0.0, < 9.0.6') to a semver range ('>=9.0.0 <9.0.6')."""
    return " ".join(p.replace(" ", "") for p in r.split(","))


def audit_count(kind, d, log):
    if kind == "npm":
        _, out, _ = sh("npm audit --package-lock-only --json", d, log, 300)
        try:
            return json.loads(out)["metadata"]["vulnerabilities"]["total"]
        except Exception:
            return None
    if kind == "pnpm":
        _, out, _ = sh("pnpm audit --json", d, log, 300)
        try:
            v = json.loads(out)["metadata"]["vulnerabilities"]
            return sum(v.values())
        except Exception:
            return None
    if kind == "yarn":
        _, out, _ = sh("yarn audit --json --groups dependencies devDependencies", d, log, 300)
        for line in out.splitlines()[::-1]:
            try:
                j = json.loads(line)
                if j.get("type") == "auditSummary":
                    return sum(j["data"]["vulnerabilities"].values())
            except Exception:
                pass
        return None
    return None


def overrides_for(alerts):
    o = {}
    for a in alerts:
        if a["patched"] and a["eco"] == "npm":
            o[f'{a["pkg"]}@{npm_range(a["range"])}'] = f'^{a["patched"]}'
    return o


def direct_deps(pkg):
    names = set()
    for k in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        names |= set((pkg.get(k) or {}).keys())
    return names


def fix_npm(d, alerts, log):
    sh("npm audit fix --package-lock-only --ignore-scripts", d, log)
    pj = os.path.join(d, "package.json")
    pkg = json.load(open(pj))
    remaining = set()
    _, out, _ = sh("npm audit --package-lock-only --json", d, log, 300)
    try:
        remaining = set(json.loads(out).get("vulnerabilities", {}).keys())
    except Exception:
        pass
    ov = {k: v for k, v in overrides_for(alerts).items() if k.split("@")[0] in remaining or k.startswith("@") and "@".join(k.split("@")[:2]) in remaining}
    direct = direct_deps(pkg)
    for key in list(ov):
        name = key.rsplit("@", 1)[0] if not key.startswith("@") else "@" + key[1:].split("@")[0]
        if name in direct:
            for section in ("dependencies", "devDependencies", "optionalDependencies"):
                if name in (pkg.get(section) or {}):
                    pkg[section][name] = ov[key]
            del ov[key]
    if ov:
        pkg["overrides"] = {**(pkg.get("overrides") or {}), **ov}
    json.dump(pkg, open(pj, "w"), indent=2)
    open(pj, "a").write("\n")
    code, _, err = sh("npm install --package-lock-only --ignore-scripts", d, log)
    if code != 0 and "EOVERRIDE" in err:
        bad = set(re.findall(r"Override for (\S+?)@", err))
        pkg["overrides"] = {k: v for k, v in pkg.get("overrides", {}).items() if not any(k.startswith(b + "@") for b in bad)}
        json.dump(pkg, open(pj, "w"), indent=2)
        open(pj, "a").write("\n")
        code, _, err = sh("npm install --package-lock-only --ignore-scripts", d, log)
    return code == 0


def fix_pnpm(d, alerts, log):
    ov = overrides_for(alerts)
    ws = os.path.join(d, "pnpm-workspace.yaml")
    pj = os.path.join(d, "package.json")
    pkg = json.load(open(pj))
    pkg.setdefault("pnpm", {})
    pkg["pnpm"]["overrides"] = {**(pkg["pnpm"].get("overrides") or {}), **ov}
    json.dump(pkg, open(pj, "w"), indent=2)
    open(pj, "a").write("\n")
    pm = pkg.get("packageManager", "")
    runner = f"npx -y {pm.split('+')[0]}" if pm.startswith("pnpm@") else "pnpm"
    code, _, err = sh(f"{runner} install --lockfile-only --ignore-scripts", d, log)
    if code != 0 and os.path.exists(ws):
        log.write("retrying with overrides in pnpm-workspace.yaml\n")
        del pkg["pnpm"]["overrides"]
        if not pkg["pnpm"]:
            del pkg["pnpm"]
        json.dump(pkg, open(pj, "w"), indent=2)
        open(pj, "a").write("\n")
        text = open(ws).read()
        if "\noverrides:" not in "\n" + text:
            text = text.rstrip("\n") + "\noverrides:\n" + "".join(f'  "{k}": "{v}"\n' for k, v in ov.items())
            open(ws, "w").write(text)
        code, _, err = sh(f"{runner} install --lockfile-only --ignore-scripts", d, log)
    return code == 0


def fix_yarn(d, alerts, log):
    per = {}
    for a in alerts:
        if a["patched"]:
            per.setdefault(a["pkg"], set()).add(a["patched"])
    pj = os.path.join(d, "package.json")
    pkg = json.load(open(pj))
    res = pkg.get("resolutions") or {}
    for name, versions in per.items():
        majors = {v.split(".")[0] for v in versions}
        if len(majors) == 1:
            res[f"**/{name}"] = "^" + max(versions, key=lambda v: [int(x) if x.isdigit() else 0 for x in re.split(r"[.-]", v)])
    pkg["resolutions"] = res
    json.dump(pkg, open(pj, "w"), indent=2)
    open(pj, "a").write("\n")
    code, _, _ = sh("yarn install --ignore-scripts --non-interactive", d, log, 1500)
    return code == 0


def fix_cargo(d, alerts, log):
    ok = True
    for name in sorted({a["pkg"] for a in alerts if a["eco"] == "rust"}):
        code, _, _ = sh(f"cargo update -p {name}", d, log, 600)
        ok = ok and code == 0
    return ok


def verify(kind, d, log):
    """Install and run build + test. Returns dict step -> exit code (None when absent)."""
    if kind == "cargo":
        code, _, _ = sh("cargo check --locked --all-targets", d, log, 1800)
        return {"check": code}
    pkg = json.load(open(os.path.join(d, "package.json")))
    scripts = pkg.get("scripts") or {}
    install = {"npm": "npm ci --no-audit", "pnpm": "pnpm install --frozen-lockfile", "yarn": "yarn install --frozen-lockfile --non-interactive"}[kind]
    runner = {"npm": "npm run", "pnpm": "pnpm run", "yarn": "yarn run"}[kind]
    res = {"install": sh(install, d, log, 1800)[0]}
    if res["install"] != 0:
        return res
    for step in ("build", "test"):
        if step in scripts and "no test specified" not in scripts[step]:
            res[step] = sh(f"{runner} {step}", d, log, 1200)[0]
    return res


def process(full):
    name = full.split("/")[1]
    d = os.path.join(WORK, name)
    os.makedirs(os.path.join(OUT, "dep_logs"), exist_ok=True)
    log = open(os.path.join(OUT, "dep_logs", f"{name}.log"), "w")
    result = {"repo": full, "groups": [], "unhandled": []}
    try:
        if os.path.exists(d):
            shutil.rmtree(d)
        if sh(f"git clone --depth 1 https://github.com/{full}.git {d}", WORK, log, 900)[0] != 0:
            result["error"] = "clone failed"
            return result
        base = sh("git rev-parse --abbrev-ref HEAD", d, log)[1].strip()
        result["base"] = base
        sh(f"git checkout -b {BRANCH}", d, log)
        alerts = [{"pkg": x["dependency"]["package"]["name"], "eco": x["dependency"]["package"]["ecosystem"],
                   "manifest": x["dependency"]["manifest_path"],
                   "patched": (x["security_vulnerability"].get("first_patched_version") or {}).get("identifier"),
                   "range": x["security_vulnerability"]["vulnerable_version_range"], "sev": x["security_advisory"]["severity"]}
                  for x in api(f"/repos/{full}/dependabot/alerts?state=open&per_page=100")]
        result["alerts"] = len(alerts)
        groups = {}
        for a in alerts:
            p = os.path.dirname(a["manifest"])
            while True:
                hit = next(((f, k) for f, k in LOCKS if os.path.exists(os.path.join(d, p, f))), None)
                if hit or not p:
                    break
                p = os.path.dirname(p)
            if hit and ((hit[1] == "cargo") == (a["eco"] == "rust")):
                groups.setdefault((p, hit[1]), []).append(a)
            else:
                result["unhandled"].append(f'{a["eco"]}:{a["pkg"]} in {a["manifest"]}')
        for (p, kind), group_alerts in sorted(groups.items()):
            gd = os.path.join(d, p)
            if kind == "cargo" and not shutil.which("cargo", path=ENV["PATH"]):
                result["unhandled"] += [f'rust:{a["pkg"]} in {a["manifest"]} (cargo unavailable)' for a in group_alerts]
                continue
            g = {"dir": p or ".", "kind": kind, "alerts": len(group_alerts), "before": audit_count(kind, gd, log)}
            g["applied"] = {"npm": fix_npm, "pnpm": fix_pnpm, "yarn": fix_yarn, "cargo": fix_cargo}[kind](gd, group_alerts, log)
            g["after"] = audit_count(kind, gd, log)
            g["verify"] = verify(kind, gd, log)
            failed = [k for k, v in g["verify"].items() if v not in (0, None)]
            if failed:
                sh("git stash push --include-untracked", d, log)
                sh("git clean -fdx -e node_modules", d, log)
                g["baseline"] = verify(kind, gd, log)
                sh("git checkout -- . && git stash pop", d, log)
                g["regressions"] = [k for k in failed if g["baseline"].get(k) == 0]
            else:
                g["regressions"] = []
            result["groups"].append(g)
        sh("git clean -fdX -e '!.env*'", d, log)
        changed = sh("git status --porcelain", d, log)[1].strip()
        if changed:
            regress = [f'{g["dir"]}:{",".join(g["regressions"])}' for g in result["groups"] if g["regressions"]]
            fixed = sum((g["before"] or 0) - (g["after"] or 0) for g in result["groups"])
            msg = (f"fix(deps): resolve {fixed} audited vulnerabilities with patched versions and scoped overrides\n\n"
                   + "\n".join(f'- {g["dir"]} ({g["kind"]}): {g["before"]} -> {g["after"]} vulnerabilities' for g in result["groups"])
                   + ("\n\nBuild/test regressions to review: " + "; ".join(regress) if regress else ""))
            sh("git add -A", d, log)
            sh(f"git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com commit -q -F -  <<'EOF'\n{msg}\nEOF", d, log)
            result["commit"] = sh("git rev-parse --short HEAD", d, log)[1].strip()
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    finally:
        log.close()
        print(json.dumps({k: result.get(k) for k in ("repo", "alerts", "commit", "error")}), flush=True)
    return result


os.makedirs(WORK, exist_ok=True)
with ThreadPoolExecutor(4) as ex:
    results = list(ex.map(process, REPOS))
path = os.path.join(OUT, "dep_fixes.json")
prev = {r["repo"]: r for r in json.load(open(path))} if os.path.exists(path) else {}
prev.update({r["repo"]: r for r in results})
json.dump(list(prev.values()), open(path, "w"), indent=1)
