"""Snapshot github.com/trending (daily, weekly, monthly) and pull the same per-repo signals
as collect_wide.py, plus what only the trending lists carry: rank, stars gained in the
window, the README's first screen, topic names, social preview and release cadence.

The overall lists are the headline set. The per-language lists (same LANGS as
collect_wide.py) widen the sample so pattern counts are not decided by a dozen repos.

Usage: GH_TOKEN=... python3 -I trending_snapshot.py OUT_DIR [--owner nirholas] [--own-top 40]
Writes OUT_DIR/lists.json (who trended where), OUT_DIR/repos.jsonl (signals per repo).
"""
import argparse, html, json, os, re, sys, time, urllib.request
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect_wide import FIELDS, LANGS, NOW, flatten, gql, search  # noqa: E402

WINDOWS = ("daily", "weekly", "monthly")
EXTRA = """
description homepageUrl openGraphImageUrl usesCustomOpenGraphImage
topicNames:repositoryTopics(first:20){nodes{topic{name}}}
recentReleases:releases(last:8,orderBy:{field:CREATED_AT,direction:ASC}){nodes{publishedAt tagName}}
watchers{totalCount}
"""


def scrape(lang, since):
    url = f"https://github.com/trending/{lang}?since={since}"
    for attempt in range(3):
        try:
            page = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode()
            break
        except Exception as e:
            print(f"  {url}: {type(e).__name__}, retry", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    else:
        return None
    rows = []
    for rank, block in enumerate(page.split('<article class="Box-row">')[1:], 1):
        m = re.search(r'<h2 class="h3 lh-condensed">\s*<a[^>]*href="/([^"/]+/[^"/]+)"', block)
        if not m:
            continue
        gained = re.search(r"([\d,]+)\s+stars?\s+(today|this week|this month)", block)
        desc = re.search(r'<p class="col-9[^"]*">\s*(.*?)\s*</p>', block, re.S)
        lang_m = re.search(r'itemprop="programmingLanguage">([^<]+)<', block)
        rows.append({
            "repo": m.group(1), "rank": rank,
            "gained": int(gained.group(1).replace(",", "")) if gained else None,
            "description": html.unescape(re.sub(r"<[^>]+>", "", desc.group(1))).strip() if desc else "",
            "lang": lang_m.group(1).strip() if lang_m else None,
        })
    return rows


def first_screen(text, lines=40):
    """The README as a visitor sees it before scrolling: the first ~40 non-blank lines."""
    out = [l for l in (text or "").splitlines() if l.strip()]
    return "\n".join(out[:lines])


def fetch(names):
    rows = []
    for i in range(0, len(names), 8):
        chunk = names[i:i + 8]
        parts = []
        for j, full in enumerate(chunk):
            o, n = full.split("/", 1)
            parts.append(f"r{j}:repository(owner:{json.dumps(o)},name:{json.dumps(n)}){{{FIELDS} {EXTRA}}}")
        d = gql("query($since:GitTimestamp!){" + " ".join(parts) + "}", {"since": (NOW - timedelta(days=30)).isoformat()})
        data = d.get("data") or {}
        for j, full in enumerate(chunk):
            r = data.get(f"r{j}")
            if not r:
                print(f"  missing {full}", file=sys.stderr)
                continue
            row = flatten(r)
            blob = next((r[k] for k in ("r1", "r2", "r3", "r4", "r5") if r.get(k) and r[k].get("text")), None)
            row.update({
                "description_text": r.get("description") or "",
                "homepage_url": r.get("homepageUrl") or "",
                "custom_social_preview": r.get("usesCustomOpenGraphImage"),
                "topic_names": [n["topic"]["name"] for n in r["topicNames"]["nodes"]],
                "release_dates": [n["publishedAt"] for n in r["recentReleases"]["nodes"] if n.get("publishedAt")],
                "watchers": r["watchers"]["totalCount"],
                "root_entries": sorted(e["name"] for e in ((r.get("root") or {}).get("entries") or [])),
                "readme_first_screen": first_screen(blob["text"] if blob else ""),
                "readme_lines": len((blob["text"] if blob else "").splitlines()),
            })
            rows.append(row)
        print(f"  fetched {min(i + 8, len(names))}/{len(names)}", file=sys.stderr)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--owner", default="nirholas")
    ap.add_argument("--own-top", type=int, default=40)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    lpath = os.path.join(a.out, "lists.json")
    if os.path.exists(lpath):
        lists = json.load(open(lpath))
    else:
        lists = {"taken_at": NOW.isoformat(), "overall": {}, "by_language": {}}
        for lang in LANGS:
            for since in WINDOWS:
                rows = scrape(lang, since)
                if rows is None:
                    continue
                if lang:
                    lists["by_language"][f"{lang}:{since}"] = rows
                else:
                    lists["overall"][since] = rows
                time.sleep(1.5)
            print(f"  trending {lang or 'overall'} done", file=sys.stderr)
        lists["own_top"] = [r["nameWithOwner"] for r in search(f"user:{a.owner} fork:false sort:stars", a.own_top)]
        json.dump(lists, open(lpath, "w"), indent=1)
    names = []
    for rows in list(lists["overall"].values()) + list(lists["by_language"].values()):
        for row in rows:
            if row["repo"] not in names:
                names.append(row["repo"])
    names += [n for n in lists["own_top"] if n not in names]
    rpath = os.path.join(a.out, "repos.jsonl")
    done = {json.loads(l)["repo"].lower() for l in open(rpath)} if os.path.exists(rpath) else set()
    todo = [n for n in names if n.lower() not in done]
    print(f"repos {len(names)}, to fetch {len(todo)}", file=sys.stderr)
    with open(rpath, "a") as f:
        for row in fetch(todo):
            f.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
