"""Wide GitHub benchmark collector.

Builds a target set (top repos by stars, fastest-rising new repos, github.com/trending
across languages and windows, and one owner's repos), then pulls the same signals for
every repo via batched GraphQL. Output is JSONL so an interrupted run resumes.

Usage: GH_TOKEN=... python3 -I collect_wide.py OUT_DIR [--top 3000] [--owner nirholas]
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

TOK = os.environ["GH_TOKEN"]
GQL = "https://api.github.com/graphql"
NOW = datetime.now(timezone.utc)
LANGS = ["", "python", "typescript", "javascript", "rust", "go", "java", "c++", "c", "c%23", "swift",
         "kotlin", "ruby", "php", "shell", "zig", "dart", "lua", "jupyter-notebook", "html", "vue",
         "scala", "elixir", "haskell", "nix", "r", "julia", "mdx", "cuda", "svelte", "solidity"]


def gql(query, variables=None, tries=5):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    for i in range(tries):
        req = urllib.request.Request(GQL, data=body, headers={"Authorization": f"Bearer {TOK}", "User-Agent": "bench"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("retry-after") or 0) or 5 * (i + 1)
            print(f"  http {e.code}, retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
        except Exception as e:
            print(f"  {type(e).__name__}, retry", file=sys.stderr)
            time.sleep(5 * (i + 1))
    return {}


def search(q, limit):
    out, after = [], None
    while len(out) < limit:
        d = gql("""query($q:String!,$a:String){search(query:$q,type:REPOSITORY,first:100,after:$a){
          pageInfo{hasNextPage endCursor} nodes{... on Repository{nameWithOwner stargazerCount}}}}""", {"q": q, "a": after})
        s = (d.get("data") or {}).get("search")
        if not s:
            break
        out += [n for n in s["nodes"] if n]
        if not s["pageInfo"]["hasNextPage"]:
            break
        after = s["pageInfo"]["endCursor"]
    return out[:limit]


def top_by_stars(n):
    seen, q = {}, "stars:>1000 sort:stars"
    while len(seen) < n:
        batch = search(q, 1000)
        new = [r for r in batch if r["nameWithOwner"] not in seen]
        if not new:
            break
        for r in batch:
            seen[r["nameWithOwner"]] = r["stargazerCount"]
        q = f"stars:<={min(r['stargazerCount'] for r in batch)} sort:stars"
        print(f"  top-stars: {len(seen)}", file=sys.stderr)
    return sorted(seen, key=lambda k: -seen[k])[:n]


def trending():
    found = {}
    for lang in LANGS:
        for since in ("daily", "weekly", "monthly"):
            url = f"https://github.com/trending/{lang}?since={since}"
            try:
                html = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode()
            except Exception:
                time.sleep(10)
                continue
            for m in re.finditer(r'<h2 class="h3 lh-condensed">\s*<a[^>]*href="/([^"/]+/[^"/]+)"', html):
                found.setdefault(m.group(1), f"{lang or 'all'}:{since}")
            time.sleep(1.5)
        print(f"  trending {lang or 'all'}: {len(found)}", file=sys.stderr)
    return found


FIELDS = """
nameWithOwner stargazerCount forkCount createdAt pushedAt isFork isArchived description homepageUrl
primaryLanguage{name} repositoryTopics(first:1){totalCount} licenseInfo{spdxId}
hasDiscussionsEnabled isSecurityPolicyEnabled codeOfConduct{key} fundingLinks{platform}
releases{totalCount} latestRelease{publishedAt} tags:refs(refPrefix:"refs/tags/",first:1){totalCount}
openIssues:issues(states:OPEN){totalCount} mergedPRs:pullRequests(states:MERGED){totalCount}
root:object(expression:"HEAD:"){... on Tree{entries{name type}}}
gh:object(expression:"HEAD:.github"){... on Tree{entries{name type}}}
wf:object(expression:"HEAD:.github/workflows"){... on Tree{entries{name}}}
r1:object(expression:"HEAD:README.md"){... on Blob{text byteSize}}
r2:object(expression:"HEAD:readme.md"){... on Blob{text byteSize}}
r3:object(expression:"HEAD:Readme.md"){... on Blob{text byteSize}}
r4:object(expression:"HEAD:README.rst"){... on Blob{text byteSize}}
r5:object(expression:"HEAD:README"){... on Blob{text byteSize}}
defaultBranchRef{target{... on Commit{
  recent:history(since:$since){totalCount}
  history(first:10){nodes{statusCheckRollup{state}}}}}}
"""


def intro_words(text):
    t = re.sub(r"<!--.*?-->|<[^>]+>|\[!\[.*?\)\]\(.*?\)|!\[[^\]]*\]\([^)]*\)", "", text, flags=re.S)
    for para in re.split(r"\n\s*\n", t):
        lines = [l for l in para.strip().splitlines() if l.strip() and not l.lstrip().startswith(("#", "=", "-" * 3, "|", "```"))]
        words = " ".join(lines).split()
        if len(words) >= 4:
            return len(words)
    return 0


def readme_stats(text):
    text = text or ""
    heads = [l.strip("# ").strip().lower() for l in text.splitlines() if re.match(r"^#{1,3} ", l)]
    heads += [h.lower() for h in re.findall(r"<h[1-3][^>]*>(.*?)</h[1-3]>", text, re.S)]
    has = lambda *k: any(any(x in h for x in k) for h in heads)
    return {
        "readme_len": len(text), "headings": len(heads),
        "badges": len(re.findall(r"shields\.io|badge\.svg|badgen\.net|/badge/|/badges?/", text)),
        "images": len(re.findall(r"!\[[^\]]*\]\(|<img ", text)),
        "gif_or_video": bool(re.search(r"\.gif\b|\.mp4|\.webm|user-attachments/assets|youtube\.com|youtu\.be|asciinema", text, re.I)),
        "picture_dark_light": "prefers-color-scheme" in text,
        "code_blocks": text.count("```") // 2,
        "sec_install": has("install", "getting started", "quick start", "quickstart", "setup", "usage"),
        "sec_features": has("feature", "why", "highlight"),
        "sec_contrib": has("contribut"), "sec_license": has("license"),
        "sec_toc": has("table of contents", "contents"), "sec_faq": has("faq"),
        "sec_benchmark": has("benchmark", "performance", "comparison"),
        "sec_sponsor": has("sponsor", "backers", "support"),
        "star_history": "star-history" in text or "starchart" in text,
        "contributors_img": "contrib.rocks" in text or "all-contributors" in text.lower(),
        "translations": bool(re.search(r"README[._-](zh|cn|ja|ko|es|fr|de|pt|ru|ar)", text, re.I)) or "简体中文" in text,
        "trendshift": "trendshift.io" in text,
        "discord_link": "discord.gg" in text or "discord.com/invite" in text,
        "docs_site_link": bool(re.search(r"https?://[^)\s\"]*(docs\.|readthedocs|\.dev/|gitbook|/docs)", text)),
        "one_line_install": bool(re.search(r"(npm i(nstall)? |npx |pip install |pipx |uv (tool |pip )?install|cargo install|brew install|go install|curl [^\n]*\| *(ba)?sh|docker run|/plugin install|claude mcp add)", text)),
        "mcp_marker": "mcp-name:" in text,
        "multi_client_install": sum(k in text for k in ("Claude Code", "Cursor", "Codex", "Gemini CLI", "Windsurf", "VS Code", "Claude Desktop", "OpenCode")) >= 3,
        "intro_words": intro_words(text),
    }


def flatten(r):
    root = {e["name"].lower() for e in ((r.get("root") or {}).get("entries") or [])}
    gh = {e["name"].lower() for e in ((r.get("gh") or {}).get("entries") or [])}
    wf = (r.get("wf") or {}).get("entries") or []
    anyof = lambda *n: any(x in root or x in gh for x in n)
    blob = next((r[k] for k in ("r1", "r2", "r3", "r4", "r5") if r.get(k) and r[k].get("text")), None)
    commit = ((r.get("defaultBranchRef") or {}).get("target") or {})
    states = [((n or {}).get("statusCheckRollup") or {}).get("state") for n in ((commit.get("history") or {}).get("nodes") or [])]
    d = {
        "repo": r["nameWithOwner"], "stars": r["stargazerCount"], "forks": r["forkCount"],
        "created": r["createdAt"], "pushed": r["pushedAt"], "fork": r["isFork"], "archived": r["isArchived"],
        "lang": (r.get("primaryLanguage") or {}).get("name"),
        "description": bool(r.get("description")), "homepage": bool(r.get("homepageUrl")),
        "topics": r["repositoryTopics"]["totalCount"], "license": (r.get("licenseInfo") or {}).get("spdxId"),
        "discussions": r["hasDiscussionsEnabled"], "security_policy": r["isSecurityPolicyEnabled"],
        "code_of_conduct": bool(r.get("codeOfConduct")), "funding": bool(r.get("fundingLinks")),
        "releases": r["releases"]["totalCount"], "tags": r["tags"]["totalCount"],
        "latest_release": (r.get("latestRelease") or {}).get("publishedAt"),
        "open_issues": r["openIssues"]["totalCount"], "merged_prs": r["mergedPRs"]["totalCount"],
        "commits_30d": (commit.get("recent") or {}).get("totalCount", 0),
        "ci_states": states, "workflows": len(wf),
        "contributing": anyof("contributing.md", "contributing.rst", "contributing"),
        "issue_template": anyof("issue_template", "issue_template.md"),
        "pr_template": anyof("pull_request_template.md"),
        "changelog": anyof("changelog.md", "changes.md", "history.md", "changelog", "news.md", "releases.md"),
        "dependabot_or_renovate": "dependabot.yml" in gh or anyof("renovate.json", ".renovaterc", ".renovaterc.json", "renovate.json5"),
        "codeowners": anyof("codeowners"), "devcontainer": anyof(".devcontainer"),
        "docker": anyof("dockerfile", "docker-compose.yml", "compose.yml", "compose.yaml", "docker"),
        "tests_dir": anyof("tests", "test", "__tests__", "spec", "testing"),
        "docs_dir": anyof("docs", "documentation", "website", "doc"),
        "examples_dir": anyof("examples", "example", "demo", "demos", "cookbook"),
        "agents_md": anyof("agents.md", "claude.md", ".cursorrules", "llms.txt", ".claude", ".cursor"),
        "citation": anyof("citation.cff"), "editorconfig": anyof(".editorconfig"),
        "lint_config": any(n.startswith((".eslintrc", "eslint.config", ".prettierrc", "biome.json", "ruff.toml", ".pre-commit-config", ".golangci", "rustfmt.toml", ".rubocop", ".clang-format")) for n in root),
        "package_manifest": anyof("package.json", "pyproject.toml", "setup.py", "cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "gemfile", "composer.json", "package.swift"),
        "makefile_or_justfile": anyof("makefile", "justfile", "taskfile.yml"),
        "skills_dir": anyof("skills", ".claude-plugin", "plugins"),
        "root_file_count": len(root),
    }
    d.update(readme_stats(blob["text"] if blob else ""))
    return d


def fetch_batch(names):
    parts = []
    for i, full in enumerate(names):
        o, n = full.split("/", 1)
        parts.append(f'r{i}:repository(owner:{json.dumps(o)},name:{json.dumps(n)}){{{FIELDS}}}')
    q = "query($since:GitTimestamp!){" + " ".join(parts) + " rateLimit{remaining resetAt}}"
    d = gql(q, {"since": (NOW - timedelta(days=30)).isoformat()})
    data = d.get("data") or {}
    rl = data.get("rateLimit") or {}
    out = []
    for i in range(len(names)):
        r = data.get(f"r{i}")
        if r:
            try:
                out.append(flatten(r))
            except Exception as e:
                print(f"  flatten {names[i]}: {e}", file=sys.stderr)
    return out, rl.get("remaining")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--top", type=int, default=3000)
    ap.add_argument("--owner", default="nirholas")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    tpath = os.path.join(a.out, "targets.json")
    if os.path.exists(tpath):
        targets = json.load(open(tpath))
    else:
        targets = {"top": top_by_stars(a.top)}
        d1 = (NOW - timedelta(days=30)).date().isoformat()
        d6 = (NOW - timedelta(days=182)).date().isoformat()
        targets["rising_1mo"] = [r["nameWithOwner"] for r in search(f"created:>{d1} sort:stars", 1000)]
        targets["rising_6mo"] = [r["nameWithOwner"] for r in search(f"created:>{d6} sort:stars", 1000)]
        targets["trending"] = trending()
        targets["own"] = [r["nameWithOwner"] for r in search(f"user:{a.owner} fork:false sort:stars", 1000)]
        json.dump(targets, open(tpath, "w"))
    names = []
    for k in ("trending", "rising_1mo", "rising_6mo", "top", "own"):
        for n in targets[k]:
            if n not in names:
                names.append(n)
    rpath = os.path.join(a.out, "repos.jsonl")
    done = set()
    if os.path.exists(rpath):
        done = {json.loads(l)["repo"].lower() for l in open(rpath)}
    todo = [n for n in names if n.lower() not in done]
    print(f"targets {len(names)}, todo {len(todo)}", file=sys.stderr)
    batches = [todo[i:i + 10] for i in range(0, len(todo), 10)]
    with open(rpath, "a") as f, ThreadPoolExecutor(3) as ex:
        for i, (rows, remaining) in enumerate(ex.map(fetch_batch, batches)):
            for row in rows:
                f.write(json.dumps(row) + "\n")
            f.flush()
            if i % 20 == 0:
                print(f"  batch {i}/{len(batches)} gql remaining {remaining}", file=sys.stderr)


main()
