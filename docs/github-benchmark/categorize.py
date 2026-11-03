"""Bucket trending and rising repos by what they are, from description + topics.

Usage: GH_TOKEN=... python3 -I categorize.py OUT_DIR
"""
import json, os, re, sys, urllib.request

TOK = os.environ["GH_TOKEN"]
D = sys.argv[1]
targets = json.load(open(os.path.join(D, "targets.json")))

BUCKETS = [
    ("Coding-agent skills, plugins, rules", r"\bskills?\b|claude code|claude-code|\bplugins? for\b|cursor rules|agents\.md|codex|subagent|slash command|opencode|vibe.?cod"),
    ("MCP servers and tooling", r"\bmcp\b|model context protocol"),
    ("Agent frameworks and autonomous agents", r"\bagents?\b|agentic|autonomous|multi-agent|workflow automation"),
    ("Agent memory, context and RAG", r"\bmemory\b|context (window|engineering)|\brag\b|retrieval|knowledge (base|graph)|embedding"),
    ("LLM apps, chat UIs, gateways", r"\bllms?\b|chatgpt|openai|gemini|claude|ollama|deepseek|qwen|\bgpt\b|chat ?ui|gateway|proxy"),
    ("Models, training, inference", r"\bmodel(s)?\b|fine-?tun|training|inference|diffusion|transformer|weights|lora|quantiz|vllm|gguf"),
    ("Voice, image, video generation", r"\btts\b|text.to.speech|speech|voice|image gen|video gen|text-to-video|avatar|comfyui"),
    ("Dev tools, CLIs, terminals, editors", r"\bcli\b|terminal|editor|\bide\b|git\b|worktree|devtool|debugger|compiler|build tool|linter"),
    ("Web, UI and design", r"\bui\b|design|react|component|frontend|css|tailwind|landing|website"),
    ("Security and reverse engineering", r"security|pentest|vulnerab|exploit|reverse engineer|malware|ctf|osint"),
    ("Scraping, browser automation", r"scrap|crawl|browser automation|playwright|puppeteer|headless"),
    ("Finance and trading", r"trading|stock|finance|quant|portfolio|market data"),
    ("Self-hosted apps and infra", r"self-?host|homelab|kubernetes|docker|database|server|infra|observab"),
    ("Learning resources and lists", r"awesome|curated|tutorial|course|roadmap|interview|learn|guide|book|cheat ?sheet"),
]


def gql(q):
    req = urllib.request.Request("https://api.github.com/graphql", data=json.dumps({"query": q}).encode(),
                                 headers={"Authorization": f"Bearer {TOK}", "User-Agent": "bench"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def meta(names):
    out = {}
    for i in range(0, len(names), 50):
        chunk = names[i:i + 50]
        parts = [f'r{j}:repository(owner:{json.dumps(n.split("/")[0])},name:{json.dumps(n.split("/", 1)[1])}){{nameWithOwner description stargazerCount repositoryTopics(first:20){{nodes{{topic{{name}}}}}}}}'
                 for j, n in enumerate(chunk)]
        data = (gql("{" + " ".join(parts) + "}").get("data") or {})
        for v in data.values():
            if v:
                out[v["nameWithOwner"]] = (v["description"] or "") + " " + " ".join(t["topic"]["name"].replace("-", " ") for t in v["repositoryTopics"]["nodes"]) + " " + v["nameWithOwner"].split("/")[1].replace("-", " ")
    return out


def bucket(text):
    t = text.lower()
    for name, rx in BUCKETS:
        if re.search(rx, t):
            return name
    return "Other"


for label, names in (("Trending (all langs)", list(targets["trending"])), ("Rising, made last 30d", targets["rising_1mo"]), ("Rising, made last 6mo", targets["rising_6mo"])):
    m = meta(names)
    counts = {}
    for text in m.values():
        b = bucket(text)
        counts[b] = counts.get(b, 0) + 1
    tot = sum(counts.values())
    print(f"\n{label} (n={tot}): " + "; ".join(f"{k} {round(100 * v / tot)}%" for k, v in sorted(counts.items(), key=lambda x: -x[1])))
