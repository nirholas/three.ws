"""Summarize a trending_snapshot.py run into comparison tables (markdown on stdout).

Groups: each overall window (daily, weekly, monthly), their union, the wider set that adds
every per-language list, and the owner's top repos by stars. When the 2026-11-03 wide scan
is present (data/wide/targets.json), also reports which overall-list repos are still trending.

Usage: python3 -I analyze_trending.py OUT_DIR [--prev data/wide/targets.json]
"""
import argparse, json, os, re, statistics as st, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from categorize import bucket  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--prev", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data/wide/targets.json"))
a = ap.parse_args()

lists = json.load(open(os.path.join(a.out, "lists.json")))
rows = {}
for line in open(os.path.join(a.out, "repos.jsonl")):
    r = json.loads(line)
    rows[r["repo"].lower()] = r
TAKEN = datetime.fromisoformat(lists["taken_at"])
days = lambda iso: (TAKEN - datetime.fromisoformat(iso.replace("Z", "+00:00"))).days if iso else None


def pick(names):
    out, seen = [], set()
    for n in names:
        k = n.lower()
        if k in rows and k not in seen and not rows[k]["fork"]:
            seen.add(k)
            out.append(rows[k])
    return out


overall = {w: [x["repo"] for x in lists["overall"].get(w, [])] for w in ("daily", "weekly", "monthly")}
union = [n for w in overall.values() for n in w]
wide = union + [x["repo"] for v in lists["by_language"].values() for x in v]
G = {
    "Daily": pick(overall["daily"]),
    "Weekly": pick(overall["weekly"]),
    "Monthly": pick(overall["monthly"]),
    "All three overall lists": pick(union),
    "Every language list": pick(wide),
    "nirholas top 40": pick(lists["own_top"]),
}

NUM_RE = re.compile(r"\b\d[\d,.]*\s*(%|x\b|k\b|m\b|ms\b|tokens?|stars?|languages?|skills?|agents?|models?|tools?|times|faster|fewer|lines?|loc\b|files?|commands?|providers?)", re.I)
INSTALL_RE = re.compile(r"(npm i(nstall)? |npx |pnpm (add|dlx) |bunx |pip install |pipx |uv (tool |pip )?install|uvx |cargo install|brew install|go install|curl [^\n]*\| *(ba)?sh|irm [^\n]*\| *iex|docker run|/plugin (install|marketplace add)|claude mcp add|winget install)", re.I)
HARNESS = ("Claude Code", "Codex", "Cursor", "Gemini CLI", "OpenCode", "Windsurf", "Copilot", "Cline", "Kiro", "Amp", "Hermes", "OpenClaw")


def first_screen_flags(r):
    fs = r.get("readme_first_screen") or ""
    return {
        "fs_centered_hero": bool(re.search(r'align=["\']?center', fs, re.I)),
        "fs_logo_or_banner": bool(re.search(r"<img |!\[", fs)) and bool(re.search(r"logo|banner|hero|header|cover|social|\.svg", fs, re.I)),
        "fs_image": bool(re.search(r"<img |!\[|<picture", fs)),
        "fs_gif_video": bool(re.search(r"\.gif\b|\.mp4|\.webm|user-attachments/assets|youtube\.com|youtu\.be", fs, re.I)),
        "fs_badges": len(re.findall(r"shields\.io|badge\.svg|/badge/|trendshift", fs)) >= 2,
        "fs_install": bool(INSTALL_RE.search(fs)),
        "fs_harness_names": sum(h in fs for h in HARNESS) >= 2,
        "fs_language_switcher": bool(re.search(r"README[._-]?(zh|cn|ja|ko|es|fr|de|pt|ru)|简体中文|日本語|한국어", fs, re.I)),
        "fs_number": bool(NUM_RE.search(fs)),
        "desc_number": bool(NUM_RE.search(r.get("description_text") or "")),
    }


def derived(r):
    names = {e.lower() for e in r.get("root_entries", [])}
    rel = r.get("release_dates") or []
    gaps = []
    for x, y in zip(rel, rel[1:]):
        gaps.append((datetime.fromisoformat(y.replace("Z", "+00:00")) - datetime.fromisoformat(x.replace("Z", "+00:00"))).total_seconds() / 86400)
    d = {
        "age_days": days(r["created"]),
        "made_2026": r["created"].startswith("2026"),
        "made_last_60d": (days(r["created"]) or 10**6) <= 60,
        "released_30d": (days(r.get("latest_release")) if r.get("latest_release") else 10**6) <= 30,
        "release_gap_days": st.median(gaps) if gaps else None,
        "desc_len": len(r.get("description_text") or ""),
        "has_skill_md": "skill.md" in names,
        "has_claude_plugin": ".claude-plugin" in names,
        "has_agents_md": "agents.md" in names,
        "has_claude_md": "claude.md" in names,
        "has_llms_txt": "llms.txt" in names,
        "harness_dirs": sum(x in names for x in (".codex", ".cursor", ".opencode", ".agents", ".gemini", ".claude", ".github/copilot-instructions.md")) >= 1,
        "ci_green_latest": (r["ci_states"] or [None])[0] == "SUCCESS",
        "category": bucket(" ".join([r.get("description_text") or "", " ".join(t.replace("-", " ") for t in r.get("topic_names", [])), r["repo"].split("/")[1].replace("-", " ")])),
    }
    d.update(first_screen_flags(r))
    return d


for g in G.values():
    for r in g:
        r.update(derived(r))


def pct(L, k):
    return f"{round(100 * sum(bool(r.get(k)) for r in L) / len(L))}%" if L else "-"


def med(L, k):
    v = [r[k] for r in L if r.get(k) is not None]
    return f"{st.median(v):,.0f}" if v else "-"


def table(title, spec):
    keys = list(G)
    print(f"\n### {title}\n")
    print("| Signal | " + " | ".join(f"{k} (n={len(G[k])})" for k in keys) + " |")
    print("|---|" + "---|" * len(keys))
    for label, kind, k in spec:
        f = pct if kind == "pct" else med
        print(f"| {label} | " + " | ".join(f(G[g], k) for g in keys) + " |")


print(f"# Trending snapshot {TAKEN.date()}\n")
print(f"Overall list sizes: " + ", ".join(f"{w} {len(v)}" for w, v in overall.items()) + f"; unique across the three: {len(G['All three overall lists'])}; with every language list: {len(G['Every language list'])}.")

table("Who is trending", [
    ("Stars (median)", "med", "stars"), ("Age in days (median)", "med", "age_days"),
    ("Created in 2026", "pct", "made_2026"), ("Created in the last 60 days", "pct", "made_last_60d"),
    ("Contributors proxy: merged PRs (median)", "med", "merged_prs"), ("Commits to default branch, last 30 days (median)", "med", "commits_30d"),
])
table("First screen of the README (first 40 non-blank lines)", [
    ("Centered hero block", "pct", "fs_centered_hero"), ("Logo or banner image", "pct", "fs_logo_or_banner"),
    ("Any image", "pct", "fs_image"), ("GIF or video", "pct", "fs_gif_video"), ("2+ badges", "pct", "fs_badges"),
    ("Copy-paste install command", "pct", "fs_install"), ("Names 2+ coding-agent hosts", "pct", "fs_harness_names"),
    ("Language switcher", "pct", "fs_language_switcher"), ("A concrete number", "pct", "fs_number"),
])
table("Whole README", [
    ("Lines (median)", "med", "readme_lines"), ("Headings (median)", "med", "headings"), ("Images (median)", "med", "images"),
    ("Code blocks (median)", "med", "code_blocks"), ("Dark/light picture art", "pct", "picture_dark_light"),
    ("Translations", "pct", "translations"), ("Install steps for 3+ agent hosts", "pct", "multi_client_install"),
    ("Discord link", "pct", "discord_link"), ("Docs site link", "pct", "docs_site_link"), ("Star-history chart", "pct", "star_history"),
    ("Comparison or benchmark section", "pct", "sec_benchmark"), ("FAQ section", "pct", "sec_faq"),
])
table("Repo metadata and shipping", [
    ("Description length, chars (median)", "med", "desc_len"), ("Number in the description", "pct", "desc_number"),
    ("Topics (median)", "med", "topics"), ("Homepage set", "pct", "homepage"), ("Custom social preview", "pct", "custom_social_preview"),
    ("License", "pct", "license"), ("Publishes releases", "pct", "releases"), ("Released in the last 30 days", "pct", "released_30d"),
    ("Days between recent releases (median)", "med", "release_gap_days"), ("Latest commit CI green", "pct", "ci_green_latest"),
    ("Top-level entries (median)", "med", "root_file_count"),
])
table("Files in the tree", [
    ("docs/ directory", "pct", "docs_dir"), ("tests directory", "pct", "tests_dir"), ("examples directory", "pct", "examples_dir"),
    ("CONTRIBUTING", "pct", "contributing"), ("Issue templates", "pct", "issue_template"), ("CHANGELOG", "pct", "changelog"),
    ("SKILL.md at the root", "pct", "has_skill_md"), ("skills/ or plugins/ or .claude-plugin/", "pct", "skills_dir"),
    (".claude-plugin/ marketplace manifest", "pct", "has_claude_plugin"), ("AGENTS.md", "pct", "has_agents_md"), ("CLAUDE.md", "pct", "has_claude_md"),
    ("llms.txt", "pct", "has_llms_txt"), ("Per-harness config dir", "pct", "harness_dirs"), ("Dockerfile or compose", "pct", "docker"),
])

for label in ("All three overall lists", "Every language list", "nirholas top 40"):
    c = {}
    for r in G[label]:
        c[r["category"]] = c.get(r["category"], 0) + 1
    n = len(G[label])
    print(f"\n**Categories, {label} (n={n}):** " + "; ".join(f"{k} {v} ({round(100 * v / n)}%)" for k, v in sorted(c.items(), key=lambda x: -x[1])))

print("\n### The overall lists, ranked\n")
for w in ("daily", "weekly", "monthly"):
    print(f"\n**{w.title()}**\n")
    print("| # | Repo | Stars | Gained | Age (days) | Category | Description |")
    print("|---|---|---|---|---|---|---|")
    for x in lists["overall"].get(w, []):
        r = rows.get(x["repo"].lower(), {})
        desc = (r.get("description_text") or x["description"]).replace("|", "/")[:110]
        print(f"| {x['rank']} | {x['repo']} | {r.get('stars', 0):,} | {x['gained'] or 0:,} | {r.get('age_days', '-')} | {r.get('category', '-')} | {desc} |")

in_all = [n for n in overall["daily"] if n in overall["weekly"] and n in overall["monthly"]]
print(f"\n**On all three lists ({len(in_all)}):** " + ", ".join(in_all))
if os.path.exists(a.prev):
    prev = {k for k, v in json.load(open(a.prev))["trending"].items() if v.startswith("all:")}
    now = set(union)
    stayed = sorted(prev & now)
    print(f"\n**Still on an overall list since 2026-11-03 ({len(stayed)} of {len(prev)}):** " + ", ".join(stayed))
    print(f"\n**New since 2026-11-03 ({len(now - prev)}):** " + ", ".join(sorted(now - prev)))
