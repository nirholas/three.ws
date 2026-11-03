import json, os, re, sys, base64, concurrent.futures as cf, urllib.request, urllib.error

TOK = os.environ["GH_TOKEN"]
OUT = sys.argv[1]
H = {"Authorization": f"Bearer {TOK}", "Accept": "application/vnd.github+json", "User-Agent": "bench"}


def get(url, raw=False):
    req = urllib.request.Request(url if url.startswith("http") else "https://api.github.com" + url, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read()
            return b.decode("utf-8", "replace") if raw else json.loads(b)
    except urllib.error.HTTPError as e:
        return None
    except Exception:
        return None


def trending():
    names = []
    for since in ("daily", "weekly", "monthly"):
        req = urllib.request.Request(f"https://github.com/trending?since={since}", headers={"User-Agent": "Mozilla/5.0"})
        html = urllib.request.urlopen(req, timeout=30).read().decode()
        for m in re.finditer(r'<h2 class="h3 lh-condensed">\s*<a[^>]*href="/([^"/]+/[^"/]+)"', html):
            if m.group(1) not in names:
                names.append(m.group(1))
    return names


def readme_stats(text):
    if not text:
        return {}
    lines = text.splitlines()
    heads = [l.strip("# ").strip().lower() for l in lines if re.match(r"^#{1,3} ", l)]
    def has(*k):
        return any(any(x in h for x in k) for h in heads)
    return {
        "readme_len": len(text),
        "badges": len(re.findall(r"shields\.io|badge\.svg|badgen\.net|/badge/", text)),
        "images": len(re.findall(r"!\[[^\]]*\]\(|<img ", text)),
        "gif_or_video": bool(re.search(r"\.gif|\.mp4|\.webm|user-attachments/assets|youtube\.com|youtu\.be", text, re.I)),
        "code_blocks": text.count("```") // 2,
        "sec_install": has("install", "getting started", "quick start", "quickstart", "setup", "usage"),
        "sec_features": has("feature", "why", "highlights"),
        "sec_contrib": has("contribut"),
        "sec_license": has("license"),
        "sec_toc": has("table of contents", "contents"),
        "star_history": "star-history" in text or "starchart" in text,
        "contributors_img": "contrib.rocks" in text or "contributors-img" in text or "all-contributors" in text.lower(),
        "headings": len(heads),
    }


def deep(full):
    r = get(f"/repos/{full}")
    if not r or r.get("message"):
        return None
    cp = get(f"/repos/{full}/community/profile") or {}
    root = get(f"/repos/{full}/contents") or []
    gh = get(f"/repos/{full}/contents/.github") or []
    wf = get(f"/repos/{full}/actions/workflows?per_page=1") or {}
    rel = get(f"/repos/{full}/releases?per_page=1") or []
    tags = get(f"/repos/{full}/tags?per_page=1") or []
    rd = get(f"/repos/{full}/readme")
    text = base64.b64decode(rd["content"]).decode("utf-8", "replace") if rd and rd.get("content") else ""
    rootn = {x["name"].lower() for x in root} if isinstance(root, list) else set()
    ghn = {x["name"].lower() for x in gh} if isinstance(gh, list) else set()
    files = cp.get("files") or {}
    anyof = lambda *n: any(x in rootn or x in ghn for x in n)
    d = {
        "repo": full, "stars": r["stargazers_count"], "forks": r["forks_count"], "lang": r.get("language"),
        "created": r["created_at"], "pushed": r["pushed_at"], "archived": r["archived"], "fork": r["fork"],
        "description": bool(r.get("description")), "homepage": bool(r.get("homepage")),
        "topics": len(r.get("topics") or []), "license": (r.get("license") or {}).get("spdx_id"),
        "discussions": r.get("has_discussions"), "issues_on": r.get("has_issues"), "wiki": r.get("has_wiki"),
        "open_issues": r.get("open_issues_count"),
        "health": cp.get("health_percentage"),
        "code_of_conduct": bool(files.get("code_of_conduct") or files.get("code_of_conduct_file")),
        "contributing": bool(files.get("contributing")),
        "issue_template": bool(files.get("issue_template")) or "issue_template" in ghn,
        "pr_template": bool(files.get("pull_request_template")),
        "security_md": anyof("security.md"),
        "changelog": anyof("changelog.md", "changes.md", "history.md", "changelog"),
        "funding": "funding.yml" in ghn,
        "dependabot_or_renovate": "dependabot.yml" in ghn or anyof("renovate.json", ".renovaterc", ".renovaterc.json"),
        "codeowners": anyof("codeowners"),
        "ci_workflows": wf.get("total_count", 0),
        "releases": bool(rel), "tags": bool(tags),
        "devcontainer": anyof(".devcontainer"),
        "docker": anyof("dockerfile", "docker-compose.yml", "compose.yml", "compose.yaml"),
        "tests_dir": anyof("tests", "test", "__tests__", "spec"),
        "docs_dir": anyof("docs", "documentation", "website"),
        "examples_dir": anyof("examples", "example", "demo", "demos"),
        "agents_md": anyof("agents.md", "claude.md", ".cursorrules", "llms.txt"),
        "citation": anyof("citation.cff"),
        "editorconfig": anyof(".editorconfig"),
        "lint_config": any(n.startswith((".eslintrc", "eslint.config", ".prettierrc", "biome.json", "ruff.toml", ".pre-commit-config", ".golangci")) for n in rootn),
    }
    d.update(readme_stats(text))
    return d


def all_own():
    out, page = [], 1
    while True:
        b = get(f"/users/nirholas/repos?per_page=100&page={page}&type=owner")
        if not b:
            break
        out += b
        page += 1
    return out


trend = trending()
print("trending", len(trend), file=sys.stderr)
own = all_own()
print("own", len(own), file=sys.stderr)
own_src = sorted([r for r in own if not r["fork"] and not r["archived"]], key=lambda r: -r["stargazers_count"])
own_top = [r["full_name"] for r in own_src[:40]]
with cf.ThreadPoolExecutor(8) as ex:
    td = [x for x in ex.map(deep, trend) if x]
    od = [x for x in ex.map(deep, own_top) if x]
shallow = [{
    "repo": r["full_name"], "stars": r["stargazers_count"], "fork": r["fork"], "archived": r["archived"],
    "description": bool(r.get("description")), "homepage": bool(r.get("homepage")),
    "topics": len(r.get("topics") or []), "license": (r.get("license") or {}).get("spdx_id"),
    "pushed": r["pushed_at"], "lang": r.get("language"), "discussions": r.get("has_discussions"),
} for r in own]
json.dump({"trending": td, "own_top": od, "own_all": shallow}, open(OUT, "w"), indent=1)
print("done", len(td), len(od), len(shallow), file=sys.stderr)
