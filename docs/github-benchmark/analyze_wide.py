"""Summarize collect_wide.py output into comparison tables (markdown on stdout).

Usage: python3 -I analyze_wide.py OUT_DIR
"""
import json, os, statistics as st, sys
from datetime import datetime, timezone

D = sys.argv[1]
NOW = datetime.now(timezone.utc)
targets = json.load(open(os.path.join(D, "targets.json")))
rows = {}
for line in open(os.path.join(D, "repos.jsonl")):
    r = json.loads(line)
    rows[r["repo"].lower()] = r


PRIVATE = set()
if os.path.exists(os.path.join(D, "own_private.json")):
    PRIVATE = {n.lower() for n in json.load(open(os.path.join(D, "own_private.json")))}
CI_REASON = {}
if os.path.exists(os.path.join(D, "ci_reasons.json")):
    CI_REASON = {r["repo"].lower(): r for r in json.load(open(os.path.join(D, "ci_reasons.json")))["results"]}


def group(names):
    return [rows[n.lower()] for n in names if n.lower() in rows and n.lower() not in PRIVATE]


days = lambda iso: (NOW - datetime.fromisoformat(iso.replace("Z", "+00:00"))).days if iso else 10**6
src = lambda L: [r for r in L if not r["fork"] and not r["archived"]]

G = {
    "Top 500 all-time": src(group(targets["top"][:500])),
    "Top 4000 all-time": src(group(targets["top"])),
    "Trending (all langs)": src(group(list(targets["trending"]))),
    "Rising, made last 30d": src(group(targets["rising_1mo"])),
    "Rising, made last 6mo": src(group(targets["rising_6mo"])),
    "nirholas, all (public)": src(group(targets["own"])),
}
own = sorted(G["nirholas, all (public)"], key=lambda r: -r["stars"])
G["nirholas, top 40"] = own[:40]


def ci(r):
    s = [x for x in r["ci_states"] if x]
    if not s:
        return None
    return sum(x in ("FAILURE", "ERROR") for x in s) / len(s)


BOOL = [
    ("Has any CI status on recent commits", lambda r: ci(r) is not None),
    ("Latest commit CI green", lambda r: next((x for x in r["ci_states"] if x), None) == "SUCCESS"),
    ("Has 1+ GitHub releases", lambda r: r["releases"] > 0),
    ("Released in last 90 days", lambda r: days(r["latest_release"]) <= 90),
    ("Has git tags", lambda r: r["tags"] > 0),
    ("Tests directory", lambda r: r["tests_dir"]),
    ("Package manifest at root", lambda r: r["package_manifest"]),
    ("One-line install in README", lambda r: r["one_line_install"]),
    ("Install/usage section", lambda r: r["sec_install"]),
    ("GIF/video demo", lambda r: r["gif_or_video"]),
    ("Dark/light <picture> art", lambda r: r["picture_dark_light"]),
    ("Docs site link", lambda r: r["docs_site_link"]),
    ("Discord link", lambda r: r["discord_link"]),
    ("Translated READMEs", lambda r: r["translations"]),
    ("Benchmark/comparison section", lambda r: r["sec_benchmark"]),
    ("Multi-client install (3+ agent hosts)", lambda r: r["multi_client_install"]),
    ("Skills/plugins dir", lambda r: r["skills_dir"]),
    ("Agent files (AGENTS/CLAUDE/llms.txt)", lambda r: r["agents_md"]),
    ("Examples dir", lambda r: r["examples_dir"]),
    ("Docs dir", lambda r: r["docs_dir"]),
    ("Docker", lambda r: r["docker"]),
    ("Makefile/justfile", lambda r: r["makefile_or_justfile"]),
    ("Dependabot/Renovate config", lambda r: r["dependabot_or_renovate"]),
    ("Lint/format config", lambda r: r["lint_config"]),
    ("CHANGELOG file", lambda r: r["changelog"]),
    ("CONTRIBUTING", lambda r: r["contributing"]),
    ("Issue templates", lambda r: r["issue_template"]),
    ("PR template", lambda r: r["pr_template"]),
    ("Code of conduct", lambda r: r["code_of_conduct"]),
    ("Security policy", lambda r: r["security_policy"]),
    ("FUNDING", lambda r: r["funding"]),
    ("CODEOWNERS", lambda r: r["codeowners"]),
    ("CITATION.cff", lambda r: r["citation"]),
    ("Star-history chart", lambda r: r["star_history"]),
    ("Contributors image", lambda r: r["contributors_img"]),
    ("Table of contents", lambda r: r["sec_toc"]),
    ("Homepage URL set", lambda r: r["homepage"]),
    ("Discussions on", lambda r: r["discussions"]),
    ("License", lambda r: bool(r["license"])),
]
NUM = [
    ("CI failure share, last 10 commits (repos with CI)", lambda r: ci(r), True),
    ("Commits to default branch, last 30d", lambda r: r["commits_30d"], False),
    ("Merged PRs (lifetime)", lambda r: r["merged_prs"], False),
    ("Workflows", lambda r: r["workflows"], False),
    ("Topics", lambda r: r["topics"], False),
    ("README length (chars)", lambda r: r["readme_len"], False),
    ("README headings", lambda r: r["headings"], False),
    ("README images", lambda r: r["images"], False),
    ("Badges", lambda r: r["badges"], False),
    ("Code blocks", lambda r: r["code_blocks"], False),
    ("Intro paragraph words", lambda r: r["intro_words"], False),
    ("Root files/dirs", lambda r: r["root_file_count"], False),
    ("Stars", lambda r: r["stars"], False),
]


def pct(L, f):
    return f"{round(100 * sum(1 for r in L if f(r)) / len(L))}%" if L else "-"


def med(L, f, mean=False):
    v = [x for x in (f(r) for r in L) if x is not None]
    if not v:
        return "-"
    m = st.mean(v) if mean else st.median(v)
    return f"{round(100 * m)}%" if mean else (f"{m:,.0f}" if m >= 10 else f"{m:g}")


cols = list(G)
print("Sample sizes: " + ", ".join(f"{k} = {len(v)}" for k, v in G.items()) + "\n")
print("| Signal | " + " | ".join(cols) + " |")
print("|---|" + "---|" * len(cols))
for name, f in BOOL:
    print(f"| {name} | " + " | ".join(pct(G[c], f) for c in cols) + " |")
print("\n| Median | " + " | ".join(cols) + " |")
print("|---|" + "---|" * len(cols))
for name, f, mean in NUM:
    print(f"| {name}{' (mean)' if mean else ''} | " + " | ".join(med(G[c], f, mean) for c in cols) + " |")

# Breakout analysis: among repos created in the last 6 months, top vs bottom quartile by stars.
R = sorted(G["Rising, made last 6mo"], key=lambda r: -r["stars"])
q = len(R) // 4
top, bot = R[:q], R[-q:]
print(f"\nBreakout lift (repos made in last 6 months): top quartile ({top[-1]['stars']:,}+ stars, n={q}) vs bottom quartile (<= {bot[0]['stars']:,}, n={q})\n")
print("| Signal | Top quartile | Bottom quartile | Gap (pts) | nirholas top 40 |")
print("|---|---|---|---|---|")
lifts = []
for name, f in BOOL:
    a = 100 * sum(1 for r in top if f(r)) / q
    b = 100 * sum(1 for r in bot if f(r)) / q
    lifts.append((a - b, name, a, b, f))
for gap, name, a, b, f in sorted(lifts, key=lambda x: -abs(x[0])):
    print(f"| {name} | {a:.0f}% | {b:.0f}% | {gap:+.0f} | {pct(G['nirholas, top 40'], f)} |")
for name, f, mean in NUM[:-1]:
    print(f"| median {name} | {med(top, f, mean)} | {med(bot, f, mean)} | | {med(G['nirholas, top 40'], f, mean)} |")

# Language mix
for gname in ("Trending (all langs)", "Rising, made last 6mo"):
    c = {}
    for r in G[gname]:
        c[r["lang"] or "none"] = c.get(r["lang"] or "none", 0) + 1
    print(f"\n{gname} languages: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items(), key=lambda x: -x[1])[:12]))

# Own repos worst CI
print("\nnirholas repos with CI failing on 8+ of last 10 commits:")
bad = sorted([r for r in G["nirholas, all (public)"] if ci(r) is not None and ci(r) >= 0.8], key=lambda r: -r["stars"])
print(f"{len(bad)} repos: " + ", ".join(f"{r['repo'].split('/')[1]} ({r['stars']})" for r in bad))
with_ci = [r for r in G["nirholas, all (public)"] if ci(r) is not None]
print(f"nirholas: {len(with_ci)} of {len(G['nirholas, all (public)'])} source repos report CI; {sum(1 for r in G['nirholas, all (public)'] if r['releases'] > 0)} have a release")

# Per-repo action list for the owner's repos, least to most stars.
CHECKS = [
    ("CI blocked by billing lock", lambda r: CI_REASON.get(r["repo"].lower(), {}).get("reason") == "billing-lock", "jobs never start until the account billing issue is cleared"),
    ("Dependabot update failing", lambda r: CI_REASON.get(r["repo"].lower(), {}).get("reason") == "step-failed" and "Dependabot" in CI_REASON[r["repo"].lower()]["detail"], "a parent package pins the vulnerable version: upgrade the parent or add an overrides entry"),
    ("CI failing", lambda r: ci(r) is not None and ci(r) >= 0.5 and CI_REASON.get(r["repo"].lower(), {}).get("reason") not in ("billing-lock",) and not ("Dependabot" in CI_REASON.get(r["repo"].lower(), {}).get("detail", "")), "fix the failing workflow or delete it"),
    ("no CI", lambda r: ci(r) is None and r["package_manifest"], "add a ci.yml that installs, lints, tests and builds"),
    ("no release", lambda r: r["releases"] == 0 and r["package_manifest"], "tag a version and publish a GitHub release"),
    ("no tests", lambda r: not r["tests_dir"] and r["package_manifest"], "add a smoke test that imports and runs the entry point"),
    ("README over 30k chars", lambda r: r["readme_len"] > 30000, "move detail into docs/ and keep the README to pitch, demo, install, example"),
    ("no one-line install", lambda r: not r["one_line_install"] and r["package_manifest"], "add a single copy-paste install command near the top"),
    ("no demo media", lambda r: not r["gif_or_video"] and r["images"] == 0, "add a GIF or screenshot above the fold"),
    ("over 10 topics", lambda r: r["topics"] > 10, "trim topics to the 5 to 8 most accurate"),
    ("no dependency-update config", lambda r: not r["dependabot_or_renovate"] and r["package_manifest"], "add .github/dependabot.yml with grouped weekly updates"),
    ("stale (no push in 180d)", lambda r: days(r["pushed"]) > 180, "update it or archive it"),
]
out = ["# nirholas repo fix list", "", "Generated by `analyze_wide.py` from the same scan as the benchmark. Ordered from least to most stars. Each line names the gap and the fix.", ""]
counts = {c[0]: 0 for c in CHECKS}
for r in sorted(G["nirholas, all (public)"], key=lambda r: (r["stars"], r["repo"].lower())):
    gaps = [(n, fix) for n, f, fix in CHECKS if f(r)]
    for n, _ in gaps:
        counts[n] += 1
    name = r["repo"].split("/")[1]
    if gaps:
        out.append(f"- **{name}** ({r['stars']} stars, {r['lang'] or 'no language'}): " + "; ".join(f"{n}: {fix}" for n, fix in gaps))
    else:
        out.append(f"- **{name}** ({r['stars']} stars): no gaps found")
summary = ["## Totals", "", "| Gap | Repos |", "|---|---|"] + [f"| {k} | {v} |" for k, v in sorted(counts.items(), key=lambda x: -x[1])] + ["", "## Repos", ""]
out[4:4] = summary
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "own-repos.md"), "w").write("\n".join(out) + "\n")
print("\nwrote own-repos.md")
