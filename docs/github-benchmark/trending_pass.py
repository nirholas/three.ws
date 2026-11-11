"""Apply the 2026-11-10 trending plan (trending-2026-11-10.md) to every public nirholas repo,
fewest stars first.

  list            Enumerate public, non-fork, non-archived, non-empty repos into data/pass/repos.json.
  prep NAME       Shallow-clone NAME to $PASS_DIR/NAME on branch trending-pass, ready to edit.
  check NAME      Validate the prepared clone and its meta file without touching GitHub.
  ship NAME       Push the branch, open and squash-merge a PR, set description and topics,
                  cut a first release when the repo has none, log to data/pass/shipped.jsonl
                  and delete the clone.
  status          Counts of listed, prepared and shipped repos, and the next unshipped names.
  audit [NAME..]  Re-check every shipped plugin on its live default branch with all gates.
  migrate NAME    Move a shipped plugin in the prepared clone into the plugins/<name>/ layout and commit.

Set FOLLOWUP=1 to ship a fix to a repo that was already shipped.

Per-repo edits are made in the clone and committed on trending-pass. README files are out of
scope: the pass adds Claude Code plugin packaging (.claude-plugin/, skills/, .mcp.json) where a
repo has something an agent can run, and fixes metadata and releases everywhere. The description and
topics go in $PASS_DIR/NAME.meta.json: {"description": "...", "topics": ["...", ...]}.

Usage: GH_TOKEN=$(gh auth token) python3 -I trending_pass.py <command> [NAME]
"""
import glob, json, os, re, subprocess, sys, shutil, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MONO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data", "pass")
PASS_DIR = os.environ.get("PASS_DIR", "/home/user/repo-pass")
OWNER = os.environ.get("OWNER", "nirholas")
BRANCH = "trending-pass"
TOPIC_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,49}$")
BANNED = ("\u2014", "\u2013")
PUBLISH_RE = re.compile(r"npm publish|pnpm publish|yarn npm publish|changeset publish|semantic-release|pypa/gh-action-pypi-publish|twine upload|cargo publish|docker/build-push-action|docker push|vsce publish|ovsx publish", re.I)
TRIGGER_RE = re.compile(r"^\s*(release|tags)\s*:|^\s*-\s*['\"]?v?\*", re.M)


def sh(*cmd, cwd=None, check=True, quiet=False):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and p.returncode:
        raise SystemExit(f"{' '.join(cmd[:4])}... failed ({p.returncode}): {(p.stderr or p.stdout).strip()[:800]}")
    return p.stdout.strip() if not quiet else p


def gh_api(*args, check=True):
    return sh("gh", "api", *args, check=check)


def git(*args, cwd, check=True):
    return sh("git", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", *args, cwd=cwd, check=check)


def load_repos():
    return json.load(open(os.path.join(DATA, "repos.json")))


def shipped():
    p = os.path.join(DATA, "shipped.jsonl")
    return {json.loads(l)["name"] for l in open(p)} if os.path.exists(p) else set()


def cmd_list():
    q = """query($login:String!,$after:String){user(login:$login){repositories(first:40,after:$after,privacy:PUBLIC,ownerAffiliations:OWNER,isFork:false){
      pageInfo{hasNextPage endCursor}
      nodes{name stargazerCount isArchived isEmpty description homepageUrl primaryLanguage{name}
        defaultBranchRef{name} releases{totalCount} repositoryTopics(first:30){nodes{topic{name}}}
        root:object(expression:"HEAD:"){... on Tree{entries{name}}}}}}}"""
    out, after = [], None
    while True:
        args = ["graphql", "-f", f"query={q}", "-f", f"login={OWNER}"] + (["-f", f"after={after}"] if after else [])
        for attempt in range(4):
            p = sh("gh", "api", *args, check=False, quiet=True)
            if p.returncode == 0:
                break
            time.sleep(5 * (attempt + 1))
        else:
            raise SystemExit(f"repo listing failed: {p.stderr.strip()[:300]}")
        page = json.loads(p.stdout)["data"]["user"]["repositories"]
        for n in page["nodes"]:
            if n["isArchived"] or n["isEmpty"] or not n["defaultBranchRef"]:
                continue
            out.append({
                "name": n["name"], "stars": n["stargazerCount"], "description": n["description"] or "",
                "homepage": n["homepageUrl"] or "", "language": (n["primaryLanguage"] or {}).get("name"),
                "branch": n["defaultBranchRef"]["name"], "releases": n["releases"]["totalCount"],
                "topics": [t["topic"]["name"] for t in n["repositoryTopics"]["nodes"]],
                "root": sorted(e["name"] for e in ((n["root"] or {}).get("entries") or [])),
            })
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
    mirrors = {m["repo"]: m for m in json.load(open(os.path.join(MONO, "data", "standalone-mirrors.json")))["mirrors"] if m.get("repo")}
    for r in out:
        m = mirrors.get(r["name"])
        if m and m["direction"] == "out" and m["exporter"] in ("skill-repos", "awesome", "examples"):
            r["kind"], r["path"] = "generated", m["path"]
        elif m and m["direction"] == "out":
            r["kind"], r["path"] = "mirror", m["path"]
        else:
            r["kind"], r["path"] = "standalone", None
    out.sort(key=lambda r: (r["stars"], r["name"].lower()))
    os.makedirs(DATA, exist_ok=True)
    json.dump(out, open(os.path.join(DATA, "repos.json"), "w"), indent=1)
    print(f"{len(out)} repos, {out[0]['stars']} to {out[-1]['stars']} stars")


def repo(name):
    for r in load_repos():
        if r["name"] == name:
            return r
    raise SystemExit(f"{name} is not in data/pass/repos.json")


def cmd_prep(name):
    r = repo(name)
    d = os.path.join(PASS_DIR, name)
    if os.path.isdir(os.path.join(d, ".git")):
        print(d)
        return
    os.makedirs(PASS_DIR, exist_ok=True)
    git("clone", "--depth", "1", "--branch", r["branch"], f"https://github.com/{OWNER}/{name}.git", d, cwd=PASS_DIR)
    git("switch", "-c", BRANCH, cwd=d)
    print(d)


def release_blocked(d):
    """True when cutting a release would trigger a publish workflow (npm, PyPI, crates, Docker...)."""
    wf = os.path.join(d, ".github", "workflows")
    if not os.path.isdir(wf):
        return False
    for f in os.listdir(wf):
        try:
            t = open(os.path.join(wf, f), errors="replace").read()
        except OSError:
            continue
        if TRIGGER_RE.search(t) and PUBLISH_RE.search(t):
            return True
    return False


def first_version(d):
    for path, rx in (("package.json", r'"version"\s*:\s*"(\d+\.\d+\.\d+)"'), ("pyproject.toml", r'^version\s*=\s*"(\d+\.\d+\.\d+)"'),
                     ("Cargo.toml", r'^version\s*=\s*"(\d+\.\d+\.\d+)"')):
        p = os.path.join(d, path)
        if os.path.exists(p):
            m = re.search(rx, open(p, errors="replace").read(), re.M)
            if m and m.group(1) != "0.0.0":
                return "v" + m.group(1)
    return "v0.1.0"


RESERVED = ("claude-", "anthropic-", "anthropics-", "cc-plugin-")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
# Paths a mirror may add, rename or delete: plugin packaging only, never the package the monorepo owns.
PLUGIN_PATH_RE = re.compile(r"^(\.claude-plugin/|plugins?/|skills/|\.mcp\.json$)")
ICONS = {"three-ws": os.path.join(DATA, "three-ws-icon.png"), "nirholas": os.path.join(DATA, "nirholas-icon.png")}
APACHE = os.path.join(DATA, "LICENSE-Apache-2.0")


def load_json(p):
    return json.load(open(p)) if os.path.exists(p) else None


def plugin_dirs(d):
    """[(entry, abs plugin dir)] for every local plugin the repo's marketplace lists."""
    market = load_json(os.path.join(d, ".claude-plugin", "marketplace.json")) or {}
    out = []
    for e in market.get("plugins") or []:
        src = e.get("source")
        if isinstance(src, str) and src.startswith("./"):
            out.append((e, os.path.normpath(os.path.join(d, src))))
    return out


def has_plugin(d):
    return os.path.isdir(os.path.join(d, ".claude-plugin"))


def layout_problems(name, d):
    """The one layout every repo uses: a root marketplace named after the repo that lists
    plugins kept in plugins/<plugin-name>/ (so the repo's own CLAUDE.md, sources and tests stay
    out of the installed plugin)."""
    out = []
    root = os.path.join(d, ".claude-plugin")
    try:
        market = load_json(os.path.join(root, "marketplace.json"))
    except ValueError as e:
        return [f"marketplace.json is not valid JSON: {e}"]
    if market is None:
        return [".claude-plugin/ needs a marketplace.json (root layout: marketplace only, plugins under plugins/<name>/)"]
    extra = sorted(set(os.listdir(root)) - {"marketplace.json"})
    if extra:
        out.append(f"root .claude-plugin/ may hold only marketplace.json; move {extra} into plugins/<name>/.claude-plugin/")
    if market.get("name") != slug(name):
        out.append(f"marketplace.json name must be the repo slug {slug(name)!r} (got {market.get('name')!r})")
    if not (market.get("owner") or {}).get("name") or not market.get("description") or not market.get("plugins"):
        out.append("marketplace.json needs owner.name, description and plugins")
    for e in market.get("plugins") or []:
        n, src = e.get("name", ""), e.get("source")
        if not NAME_RE.match(n) or n.startswith(RESERVED) or n in ("claude", "anthropic", "claude-code", "claude-mods"):
            out.append(f"plugin name {n!r} is missing, not kebab-case, or reserved")
        if not e.get("description"):
            out.append(f"marketplace entry {n!r} needs a description")
        if isinstance(src, str) and src != f"./plugins/{n}":
            out.append(f"marketplace entry {n!r} source must be ./plugins/{n} (got {src!r})")
        if isinstance(src, str):
            pj = load_json(os.path.join(d, "plugins", n, ".claude-plugin", "plugin.json"))
            if pj is None:
                out.append(f"plugins/{n}/.claude-plugin/plugin.json is missing")
            elif pj.get("name") != n:
                out.append(f"plugins/{n}/.claude-plugin/plugin.json name must be {n!r} (got {pj.get('name')!r})")
    return out


def plugin_problems(d):
    """Per-plugin content rules for every plugin dir: skills frontmatter, plugin.json paths, live MCP launchers."""
    out = []
    for e, pd in plugin_dirs(d):
        rel = os.path.relpath(pd, d)
        try:
            plugin = load_json(os.path.join(pd, ".claude-plugin", "plugin.json")) or {}
        except ValueError as err:
            out.append(f"{rel}/.claude-plugin/plugin.json is not valid JSON: {err}")
            continue
        for k in ("version", "description", "author", "repository"):
            if not plugin.get(k):
                out.append(f"{rel}/.claude-plugin/plugin.json needs {k}")
        skills = os.path.join(pd, "skills")
        if os.path.isdir(skills):
            for sd in sorted(os.listdir(skills)):
                f = os.path.join(skills, sd, "SKILL.md")
                if not os.path.isdir(os.path.join(skills, sd)):
                    continue
                text = open(f, errors="replace").read() if os.path.exists(f) else ""
                fm = re.match(r"^---\n(.*?)\n---\n", text, re.S)
                if not fm or not re.search(r"^description:\s*\S", fm.group(1), re.M):
                    out.append(f"{rel}/skills/{sd}/SKILL.md is missing or has no description frontmatter")
                elif not re.search(rf"^name:\s*{re.escape(sd)}\s*$", fm.group(1), re.M):
                    out.append(f"{rel}/skills/{sd}/SKILL.md frontmatter name must be {sd!r}")
        if "skills" in plugin:
            for sp in [plugin["skills"]] if isinstance(plugin["skills"], str) else plugin["skills"]:
                if not isinstance(sp, str) or not sp.startswith("./") or not os.path.exists(os.path.join(pd, sp)):
                    out.append(f"{rel}/.claude-plugin/plugin.json skills path {sp!r} must be an existing ./path")
        if not os.path.isdir(skills) and not os.path.exists(os.path.join(pd, ".mcp.json")) and "skills" not in plugin:
            out.append(f"{rel} has no skills/ and no .mcp.json, so it gives an agent nothing")
        mcp = os.path.join(pd, ".mcp.json")
        if os.path.exists(mcp):
            try:
                servers = (json.load(open(mcp)).get("mcpServers") or {})
            except ValueError as err:
                out.append(f"{rel}/.mcp.json is not valid JSON: {err}")
                continue
            if not servers:
                out.append(f"{rel}/.mcp.json has no mcpServers")
            for key, cfg in servers.items():
                # Servers inherit the user's shell env, and an unset ${VAR} reaches them as the
                # literal text "${VAR}", so values are references only and signers never appear.
                for var, val in {**(cfg.get("env") or {}), **(cfg.get("headers") or {})}.items():
                    if re.search(r"PRIVATE_KEY|SECRET_KEY|MNEMONIC|SEED_PHRASE|KEYPAIR", var):
                        out.append(f"{rel}/.mcp.json server {key}: never list the signer {var} in env; the server inherits it from the user's shell, so the skill says to export it")
                    elif var in (cfg.get("env") or {}) and not re.fullmatch(r"\$\{[A-Z][A-Z0-9_]*:-[^}]*\}", str(val)):
                        out.append(f"{rel}/.mcp.json server {key}: env {var} must be ${{{var}:-}}; an unset ${{VAR}} reaches the server as that literal text")
                if cfg.get("command") == "npx":
                    pkg = next((a for a in cfg.get("args", []) if not a.startswith("-")), "")
                    bare = re.sub(r"(?<=.)@[^/@]*$", "", pkg)
                    if not bare or sh("npm", "view", bare, "name", check=False, quiet=True).returncode:
                        out.append(f"{rel}/.mcp.json server {key}: npm package {pkg!r} is not published")
                    else:
                        err = npx_bin_problem(cfg.get("args", []))
                        if err:
                            out.append(f"{rel}/.mcp.json server {key}: {err}")
                elif cfg.get("command") == "uvx":
                    pkg = next((a for a in cfg.get("args", []) if not a.startswith("-")), "")
                    if not pkg or sh("curl", "-sf", "-o", "/dev/null", f"https://pypi.org/pypi/{re.split(r'[=<>@\[]', pkg)[0]}/json", check=False, quiet=True).returncode:
                        out.append(f"{rel}/.mcp.json server {key}: PyPI package {pkg!r} is not published")
                elif cfg.get("type") == "http" or cfg.get("url"):
                    err = mcp_http_problem(cfg.get("url", ""))
                    if err:
                        out.append(f"{rel}/.mcp.json server {key}: {err}")
                elif not cfg.get("command"):
                    out.append(f"{rel}/.mcp.json server {key} needs a command or a url")
                else:
                    out.append(f"{rel}/.mcp.json server {key}: command {cfg.get('command')!r} is not a published launcher (use npx, uvx or a hosted url)")
    return out


VALIDATOR = os.environ.get("CLAUDE_BIN", "/home/user/.local/claude-cli/node_modules/.bin/claude")


def validator_report(target, *flags):
    p = sh(VALIDATOR, "plugin", "validate", *flags, "--json", target, check=False, quiet=True)
    try:
        return json.loads(p.stdout), None
    except ValueError:
        return None, (p.stderr or p.stdout).strip()[:300]


def validator_problems(d):
    """The official validator (claude plugin validate): the marketplace and every plugin at --strict,
    and every plugin under the plugin-directory profile with zero findings (warnings included)."""
    out = []
    targets = [(".claude-plugin/marketplace.json", os.path.join(d, ".claude-plugin", "marketplace.json"))]
    targets += [(os.path.relpath(pd, d), pd) for _, pd in plugin_dirs(d) if os.path.isdir(pd)]
    for label, target in targets:
        if not os.path.exists(target):
            continue
        rep, err = validator_report(target, "--strict")
        if rep is None:
            out.append(f"claude plugin validate {label}: {err}")
            continue
        if not rep.get("success"):
            msgs = [m.get("message", str(m)) if isinstance(m, dict) else str(m)
                    for part in [rep.get("manifest") or {}] + (rep.get("contents") or [])
                    for m in (part.get("errors") or []) + (part.get("warnings") or [])]
            out.append(f"claude plugin validate --strict {label}: " + ("; ".join(msgs)[:600] or "failed"))
        if target.endswith(".json"):
            continue
        rep, err = validator_report(target, "--profile", "directory")
        if rep is None:
            out.append(f"claude plugin validate --profile directory {label}: {err}")
            continue
        dirrep = rep.get("directory") or {}
        for f in dirrep.get("findings") or []:
            if f.get("code") == "PRIVACY_URL_MISSING" and remote_hosts(target) and remote_hosts(target) <= no_policy_hosts():
                continue
            out.append(f"{label}: plugin directory {f.get('severity')} {f.get('code')}: {f.get('message', '')[:200]} Fix: {f.get('fix', '')[:200]}")
        if dirrep.get("incomplete"):
            out.append(f"{label}: plugin directory checks did not complete")
    return out


def remote_hosts(pd):
    try:
        servers = (load_json(os.path.join(pd, ".mcp.json")) or {}).get("mcpServers") or {}
    except ValueError:
        return set()
    return {re.sub(r"^https?://([^/:]+).*$", r"\1", c["url"]) for c in servers.values() if c.get("url")}


def no_policy_hosts():
    """Hosts whose operator publishes no privacy policy yet (data/pass/no-privacy-policy.json). Their
    plugins may omit privacyPolicyUrl; every other remote MCP plugin must declare a real one."""
    return set((load_json(os.path.join(DATA, "no-privacy-policy.json")) or {}).get("hosts") or [])


def mcp_http_problem(url):
    """A remote MCP server must answer an initialize handshake with a JSON-RPC result."""
    if not url.startswith("https://"):
        return f"remote url {url!r} must be https"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "repo-pass-check", "version": "1"}}})
    p = sh("curl", "-s", "-m", "25", "-X", "POST", url, "-H", "content-type: application/json",
           "-H", "accept: application/json, text/event-stream", "-d", body, check=False, quiet=True)
    text = p.stdout
    payloads = [l[5:].strip() for l in text.splitlines() if l.startswith("data:")] or [text]
    for t in payloads:
        try:
            if "result" in json.loads(t) and "serverInfo" in json.loads(t)["result"]:
                return None
        except (ValueError, TypeError):
            continue
    return f"{url} did not answer an MCP initialize handshake ({text[:120]!r})"


def npx_bin_problem(args):
    """npx -y PKG runs the bin named after the package (or its only bin); -p PKG BIN must name a real bin."""
    rest = [a for a in args if a != "-y" and a != "--yes"]
    if rest[:1] in (["-p"], ["--package"]):
        pkg, binname = (rest[1:3] + ["", ""])[:2]
    else:
        pkg, binname = (rest[:1] or [""])[0], None
    bare = re.sub(r"(?<=.)@[^/@]*$", "", pkg)
    p = sh("npm", "view", pkg, "bin", "--json", check=False, quiet=True)
    try:
        bins = json.loads(p.stdout or "{}") or {}
    except ValueError:
        bins = {}
    if isinstance(bins, str):
        bins = {bare.split("/")[-1]: bins}
    if not bins:
        return f"npm package {pkg!r} has no bin, so npx cannot launch it"
    if binname is not None:
        return None if binname in bins else f"{pkg!r} has no bin {binname!r} (bins: {sorted(bins)})"
    if len(bins) == 1 or bare.split("/")[-1] in bins:
        return None
    return f"{pkg!r} has several bins {sorted(bins)}; use -p {pkg} <bin>"


def slug(repo_name):
    s = re.sub(r"[^a-z0-9]+", "-", repo_name.lower()).strip("-")
    for pre in RESERVED:
        if s.startswith(pre):
            s = s[len(pre):]
    return s


def plugin_names(d):
    return [e.get("name") for e in ((load_json(os.path.join(d, ".claude-plugin", "marketplace.json")) or {}).get("plugins") or []) if e.get("name")]


def registry():
    """Plugin names already claimed, by repo: shipped ones plus other in-progress clones."""
    reg = {}
    p = os.path.join(DATA, "plugin-names.json")
    if os.path.exists(p):
        reg.update(json.load(open(p)))
    if os.path.isdir(PASS_DIR):
        for other in sorted(os.listdir(PASS_DIR)):
            if other.startswith("_") or not os.path.isdir(os.path.join(PASS_DIR, other, ".git")):
                continue
            try:
                for n in plugin_names(os.path.join(PASS_DIR, other)):
                    reg.setdefault(f"plugin:{n}", other)
            except ValueError:
                continue
    return reg


def three_ws_family(name, d):
    try:
        pkg = json.load(open(os.path.join(d, "package.json"))).get("name", "")
    except (OSError, ValueError):
        pkg = ""
    return repo(name)["kind"] == "mirror" or name.lower().startswith("three-ws") or pkg.startswith("@three-ws/")


def same_file(a, b):
    try:
        return open(a, "rb").read() == open(b, "rb").read()
    except OSError:
        return False


def naming_problems(name, d, reg=None):
    """Unique plugin names across all repos, and the brand icon on every three.ws plugin."""
    out = []
    reg = registry() if reg is None else reg
    family = three_ws_family(name, d)
    for e, pd in plugin_dirs(d):
        n = e.get("name")
        owner = reg.get(f"plugin:{n}")
        if owner and owner != name:
            out.append(f"plugin name {n!r} is already used by {owner}; pick a name unique across all {OWNER} repos")
        icon = os.path.join(pd, ".claude-plugin", "icon.png")
        if family and not same_file(icon, ICONS["three-ws"]):
            out.append(f"three.ws plugin {n} needs the brand icon: cp {ICONS['three-ws']} {os.path.relpath(icon, d)}")
    return out


def plugin_gate(name, d, reg=None):
    """Every plugin rule, in order: layout, content, the official validator, naming and icons."""
    if not has_plugin(d):
        return []
    # A generated repo's layout and install name are owned by its monorepo generator (a root skills/
    # that `npx skills add` also reads, and a documented plugin@marketplace line); every other gate applies.
    out = [] if repo(name)["kind"] == "generated" else layout_problems(name, d)
    if any("not valid JSON" in x for x in out):
        return out
    out += plugin_problems(d)
    if any("not valid JSON" in x for x in out):
        return out
    return out + validator_problems(d) + naming_problems(name, d, reg) + license_problems(d)


LICENSE_FILES = ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING")
LICENSE_TEXT_RE = [
    ("MIT", r"Permission is hereby granted, free of charge"),
    ("Apache-2.0", r"Apache License,?\s+Version 2\.0"),
    ("GPL-3.0", r"GNU GENERAL PUBLIC LICENSE\s+Version 3"),
    ("AGPL-3.0", r"GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3"),
    ("MPL-2.0", r"Mozilla Public License,?\s+(Version|v\.)\s*2\.0"),
    ("ISC", r"Permission to use, copy, modify, and/or distribute this software"),
    ("BSD-3-Clause", r"Neither the name of .{0,120} nor the names of"),
    ("Unlicense", r"This is free and unencumbered software released into the public domain"),
]


def file_license(d):
    """The license the repo's own LICENSE file grants: an SPDX id, "PROPRIETARY" for an
    all-rights-reserved file with no grant, or None when there is no file or it is not recognised."""
    f = next((os.path.join(d, x) for x in LICENSE_FILES if os.path.exists(os.path.join(d, x))), None)
    if not f:
        return None
    text = open(f, errors="replace").read()
    for spdx, pat in LICENSE_TEXT_RE:
        if re.search(pat, text, re.I | re.S):
            return spdx
    return "PROPRIETARY" if re.search(r"all rights reserved", text, re.I) else None


def declared_license(d):
    """What the repo licenses its code under: its LICENSE file first (the legal text), then the SPDX
    id its package manifest declares. None when neither says."""
    lic = file_license(d)
    if lic:
        return lic
    pj = load_json(os.path.join(d, "package.json")) or {}
    lic = pj.get("license")
    if isinstance(lic, dict):
        lic = lic.get("type")
    if not lic and os.path.exists(os.path.join(d, "pyproject.toml")):
        m = re.search(r'(?m)^license\s*=\s*(?:"([^"]+)"|\{\s*text\s*=\s*"([^"]+)")', open(os.path.join(d, "pyproject.toml")).read())
        lic = m and (m.group(1) or m.group(2))
    if not lic or lic.upper() == "UNLICENSED" or lic.upper().startswith("SEE LICENSE"):
        return None
    return lic.strip()


def license_problems(d):
    """A plugin must not relicense: its license key and any plugin LICENSE agree with the repo's own."""
    want = declared_license(d)
    out = []
    if not want:
        return out
    for pd in sorted(glob.glob(os.path.join(d, "plugins", "*"))):
        rel = f"plugins/{os.path.basename(pd)}"
        got = (load_json(os.path.join(pd, ".claude-plugin", "plugin.json")) or {}).get("license")
        if want == "PROPRIETARY":
            if got:
                out.append(f"{rel} says license {got} but the repo LICENSE is all rights reserved; remove the license key")
            if any(os.path.exists(os.path.join(pd, x)) for x in LICENSE_FILES):
                out.append(f"{rel} has its own LICENSE but the repo LICENSE is all rights reserved; remove it")
        elif got and got != want:
            text = os.path.join(DATA, f"LICENSE-{want}")
            hint = f" and copy {text} to {rel}/LICENSE" if os.path.exists(text) and not file_license(d) else ""
            out.append(f"{rel} says license {got} but the repo is licensed {want}; set \"license\": \"{want}\"{hint}")
    return out


def pass_owned(name):
    """Files earlier pass runs added to this mirror (from shipped.jsonl backports and held patches)."""
    owned = set()
    p = os.path.join(DATA, "shipped.jsonl")
    if os.path.exists(p):
        for l in open(p):
            j = json.loads(l)
            if j["name"] == name:
                owned.update((j.get("backport") or {}).get("files") or [])
    held = os.path.join(DATA, "held", f"{name}.patch")
    if os.path.exists(held):
        owned.update(re.findall(r"^\+\+\+ b/(.+)$", open(held, errors="replace").read(), re.M))
    return owned


def cmd_check(name, quiet=False):
    r = repo(name)
    d = os.path.join(PASS_DIR, name)
    problems = []
    meta_p = os.path.join(PASS_DIR, f"{name}.meta.json")
    if not os.path.exists(meta_p) and os.environ.get("FOLLOWUP") == "1":
        live = json.loads(gh_api(f"repos/{OWNER}/{name}", "--jq", "{description: (.description // \"\"), topics: .topics}"))
        json.dump(live, open(meta_p, "w"))
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else None
    if not meta:
        problems.append("no meta file")
    else:
        desc, topics = meta.get("description", ""), meta.get("topics", [])
        if not desc or len(desc) > 120 or "\n" in desc:
            problems.append(f"description must be one line of 1-120 chars (got {len(desc)})")
        if not 5 <= len(topics) <= 8 and len(topics) != len(r["topics"]):
            problems.append(f"topics must be 5 to 8 (got {len(topics)})")
        bad = [t for t in topics if not TOPIC_RE.match(t)]
        if bad:
            problems.append(f"invalid topics {bad}")
        if any(b in desc for b in BANNED):
            problems.append("dash glyph in description")
    if os.path.isdir(os.path.join(d, ".git")):
        added = git("diff", f"origin/{r['branch']}...HEAD", "--unified=0", cwd=d)
        plus = [l for l in added.splitlines() if l.startswith("+") and not l.startswith("+++")]
        if any(b in l for l in plus for b in BANNED):
            problems.append("dash glyph in added lines")
        if re.search(r"(gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})", "\n".join(plus)):
            problems.append("credential-looking string in added lines")
        changed = [l.split("\t") for l in git("diff", "--name-status", "-M", f"origin/{r['branch']}...HEAD", cwd=d).splitlines()]
        if r["kind"] == "generated" and changed:
            problems.append("generated repo: files are rebuilt from the monorepo, change only the meta file")
        if r["kind"] == "mirror":
            owned = pass_owned(name)
            bad = [c[1] for c in changed if c[0] != "A" and not (PLUGIN_PATH_RE.match(c[1]) and c[1] in owned and PLUGIN_PATH_RE.match(c[-1]))]
            if bad:
                problems.append(f"mirror repo: only add files, or move/delete plugin files an earlier pass added; the monorepo owns {bad}")
        gone = [c[1] for c in changed if c[0][0] in "DR" and c[1] in ("CLAUDE.md", "AGENTS.md")]
        if gone:
            problems.append(f"never delete or move the repo's own {gone}; the plugins/<name>/ layout keeps them out of the plugin")
        # A README inside the plugin folders is plugin packaging, not the repo's README.
        plugin_dirs = ("plugins/", ".claude-plugin/")
        readmes = [c[-1] for c in changed if re.match(r"(?i)^readme", os.path.basename(c[-1]))
                   and not all(p.startswith(plugin_dirs) for p in c[1:])]
        if readmes:
            problems.append(f"README files are out of scope for this pass (changed {readmes})")
        problems += plugin_gate(name, d)
        status = git("status", "--porcelain", cwd=d)
        if status:
            problems.append("uncommitted changes in clone")
        # The gates above read the working tree; a .gitignore rule (a bare `skills/` is common) can
        # keep plugin files out of the commit while every gate still passes on disk.
        ignored = [l[3:] for l in git("status", "--porcelain", "--ignored", "--untracked-files=all", "--",
                                      "plugins", ".claude-plugin", cwd=d).splitlines() if l.startswith("!!")]
        if ignored:
            problems.append(f"plugin files are git-ignored and would not ship: {ignored}; add them with git add -f")
    else:
        problems.append("no clone")
    if not quiet:
        print("ok" if not problems else "\n".join(problems))
    return problems


# Another coin or token named in a monorepo diff needs the owner's yes before it is committed (CLAUDE.md commit gate).
OTHER_COIN_RE = re.compile(r"bitcoin|\bbtc\b|ethereum|\beth\b|binance|\bbnb\b|bsc\b|usdc|usdt|tether|pump\.?fun|pumpswap|cardano|\bton\b|doge|\bshib|memecoin|polygon|\bpol\b|avalanche|arbitrum|optimism|hyperliquid|jupiter|raydium|meteora|bonk|\bwif\b|coinbase|\bbase (chain|mainnet|sepolia)|x layer|okx|robinhood chain|\$(?!THREE\b)[A-Z]{2,10}\b", re.I)


def is_text(p):
    try:
        data = open(p, "rb").read()
        data.decode("utf-8")
        return b"\0" not in data
    except (OSError, UnicodeDecodeError):
        return False


def backport(r, d):
    """Mirror the plugin changes (adds, moves, deletes) into the monorepo path so the next sync keeps them."""
    rng = f"origin/{r['branch']}...HEAD"
    rows = [l.split("\t") for l in git("diff", "--name-status", "-M", rng, cwd=d).splitlines()]
    put = [c[-1] for c in rows if c[0][0] in "AMR"]
    drop = [c[1] for c in rows if c[0][0] in "DR"]
    texts = "\n".join(open(os.path.join(d, f), errors="replace").read() for f in put if is_text(os.path.join(d, f)))
    hit = sorted({m.group(0).lower() for m in OTHER_COIN_RE.finditer(texts)})
    if hit:
        held = os.path.join(DATA, "held")
        os.makedirs(held, exist_ok=True)
        patch = git("diff", "--binary", rng, cwd=d)
        with open(os.path.join(held, f"{r['name']}.patch"), "w") as f:
            f.write(f"# monorepo path: {r['path']}\n# names: {', '.join(hit)}\n" + patch + "\n")
        return {"held": hit, "files": put, "deleted": drop}
    for f in drop:
        dst = os.path.join(MONO, r["path"], f)
        if os.path.exists(dst):
            os.remove(dst)
            parent = os.path.dirname(dst)
            while parent != os.path.join(MONO, r["path"]) and os.path.isdir(parent) and not os.listdir(parent):
                os.rmdir(parent)
                parent = os.path.dirname(parent)
    for f in put:
        dst = os.path.join(MONO, r["path"], f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(d, f), dst)
    return {"path": r["path"], "files": put, "deleted": drop}


def record_names(name, d):
    p = os.path.join(DATA, "plugin-names.json")
    reg = json.load(open(p)) if os.path.exists(p) else {}
    for k in [k for k, v in reg.items() if v == name]:
        del reg[k]
    for n in plugin_names(d):
        reg[f"plugin:{n}"] = name
    if has_plugin(d):
        reg[f"marketplace:{slug(name)}"] = name
    tmp = p + f".{os.getpid()}"
    json.dump(reg, open(tmp, "w"), indent=1, sort_keys=True)
    os.replace(tmp, p)


def cmd_ship(name):
    r = repo(name)
    d = os.path.join(PASS_DIR, name)
    followup = os.environ.get("FOLLOWUP") == "1"
    if name in shipped() and not followup:
        print(f"{name} already shipped (set FOLLOWUP=1 to ship a follow-up fix)")
        return
    problems = cmd_check(name, quiet=True)
    if problems:
        raise SystemExit(f"{name} not shipped: " + "; ".join(problems))
    meta = json.load(open(os.path.join(PASS_DIR, f"{name}.meta.json")))
    full = f"{OWNER}/{name}"
    log = {"name": name, "stars": r["stars"], "at": datetime.now(timezone.utc).isoformat()}

    ahead = int(git("rev-list", "--count", f"origin/{r['branch']}..HEAD", cwd=d))
    if ahead:
        git("push", "--force-with-lease", "origin", f"HEAD:refs/heads/{BRANCH}", cwd=d)
        subjects = git("log", "--format=%s", f"origin/{r['branch']}..HEAD", cwd=d).splitlines()
        body = git("log", "--format=- %s%n%n%b", f"origin/{r['branch']}..HEAD", cwd=d)
        title = subjects[-1] if len(subjects) == 1 else "feat: package the repo as a Claude Code plugin with skills"
        existing = sh("gh", "pr", "list", "--repo", full, "--head", BRANCH, "--state", "open", "--json", "number", "--jq", ".[0].number")
        if existing:
            pr = existing
        else:
            url = sh("gh", "pr", "create", "--repo", full, "--base", r["branch"], "--head", BRANCH, "--title", title,
                     "--body", body + "\n\nPart of the repo pass from three.ws docs/github-benchmark/trending-2026-11-10.md.\n\n\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)")
            pr = url.rstrip("/").split("/")[-1]
        sh("gh", "pr", "merge", pr, "--repo", full, "--squash", "--delete-branch")
        log["pr"] = int(pr)

    live = json.loads(gh_api(f"repos/{full}", "--jq", "{description: (.description // \"\"), topics: .topics}"))
    desc = meta["description"]
    if desc != live["description"]:
        gh_api("-X", "PATCH", f"repos/{full}", "-f", f"description={desc}")
        log["description"] = desc
    topics = meta["topics"]
    if sorted(topics) != sorted(live["topics"]):
        args = ["-X", "PUT", f"repos/{full}/topics", "-H", "Accept: application/vnd.github+json"]
        for t in topics:
            args += ["-f", f"names[]={t}"]
        gh_api(*args)
        log["topics"] = topics

    has_release = gh_api(f"repos/{full}/releases?per_page=1", "--jq", "length") != "0"
    if not has_release:
        if release_blocked(d):
            log["release"] = "skipped: a release or tag would trigger a publish workflow"
        else:
            tags = gh_api(f"repos/{full}/tags", "--jq", ".[].name").splitlines()
            tag = tags[0] if tags else first_version(d)
            sh("gh", "release", "create", tag, "--repo", full, "--target", r["branch"], "--title", tag, "--generate-notes", "--latest")
            log["release"] = tag

    if has_plugin(d):
        log["plugin"] = ",".join(plugin_names(d))
    record_names(name, d)

    if r["kind"] == "mirror" and ahead:
        log["backport"] = backport(r, d)

    if followup:
        log["followup"] = True
    with open(os.path.join(DATA, "shipped.jsonl"), "a") as f:
        f.write(json.dumps(log) + "\n")
    shutil.rmtree(d, ignore_errors=True)
    print(json.dumps(log))


def cmd_audit(*only_names):
    """Re-check every shipped repo's plugin on its live default branch with every gate; writes
    data/pass/audit.json and rebuilds data/pass/plugin-names.json (the first repo to ship a name keeps it)."""
    from concurrent.futures import ThreadPoolExecutor
    order = []
    for l in open(os.path.join(DATA, "shipped.jsonl")):
        n = json.loads(l)["name"]
        if n not in order:
            order.append(n)
    only = set(only_names)
    base = os.path.join(PASS_DIR, "_audit")
    os.makedirs(base, exist_ok=True)

    def one(name):
        r = repo(name)
        if sh("gh", "api", f"repos/{OWNER}/{name}/contents/.claude-plugin", check=False, quiet=True).returncode:
            return name, None, []
        d = os.path.join(base, name)
        shutil.rmtree(d, ignore_errors=True)
        git("clone", "-q", "--depth", "1", "--branch", r["branch"], f"https://github.com/{OWNER}/{name}.git", d, cwd=base)
        try:
            names = plugin_names(d)
        except ValueError:
            names = []
        probs = plugin_gate(name, d, reg={})
        if not os.path.exists(os.path.join(d, "CLAUDE.md")) and name in claude_md_removed():
            probs.append("an earlier pass removed or moved the repo's root CLAUDE.md; restore it")
        shutil.rmtree(d, ignore_errors=True)
        return name, names, probs

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(one, [n for n in order if not only or n in only]))
    regp, auditp = os.path.join(DATA, "plugin-names.json"), os.path.join(DATA, "audit.json")
    reg = {} if not only else {k: v for k, v in (load_json(regp) or {}).items() if v not in only}
    report = {} if not only else {k: v for k, v in (load_json(auditp) or {}).items() if k not in only}
    for name, names, probs in results:
        if names is None:
            continue
        for pn in names:
            if f"plugin:{pn}" in reg and reg[f"plugin:{pn}"] != name:
                probs.append(f"plugin name {pn!r} is already used by {reg[f'plugin:{pn}']}")
            else:
                reg[f"plugin:{pn}"] = name
        reg[f"marketplace:{slug(name)}"] = name
        report[name] = {"plugins": names, "problems": probs}
    if os.environ.get("AUDIT_KEEP_REGISTRY") != "1":  # set while ships run, so their names are not lost
        json.dump(reg, open(regp, "w"), indent=1, sort_keys=True)
    json.dump(report, open(auditp, "w"), indent=1)
    bad = {k: v for k, v in report.items() if v["problems"]}
    print(f"plugins audited {len(report)}, with problems {len(bad)}")
    for k, v in bad.items():
        print(f"- {k} ({','.join(v['plugins'])}): " + " | ".join(v["problems"]))


def claude_md_removed():
    p = os.path.join(DATA, "claude-md-removed.json")
    return set(load_json(p) or [])


def pass_added(name, d):
    """Files the pass added to the repo: its merged PRs (numbers in shipped.jsonl) plus unshipped local commits."""
    prs = []
    for l in open(os.path.join(DATA, "shipped.jsonl")):
        j = json.loads(l)
        if j["name"] == name and j.get("pr"):
            prs.append(j["pr"])
    added, removed = set(), {}
    for pr in prs:
        rows = json.loads(gh_api(f"repos/{OWNER}/{name}/pulls/{pr}/files?per_page=100", "--jq",
                                 "[.[] | {f: .filename, s: .status, p: .previous_filename}]"))
        base = json.loads(gh_api(f"repos/{OWNER}/{name}/pulls/{pr}", "--jq", "{b: .base.sha}"))["b"]
        for x in rows:
            if x["s"] in ("added", "renamed", "modified"):
                added.add(x["f"])
            if x["s"] == "removed" or x["s"] == "renamed":
                removed.setdefault(x["p"] or x["f"], base)
    for row in git("diff", "--name-status", f"origin/{repo(name)['branch']}...HEAD", cwd=d).splitlines():
        c = row.split("\t")
        if c[0][0] in "AR":
            added.add(c[-1])
    return added, removed


def cmd_migrate(name):
    """Move a shipped plugin into the uniform layout in the prepared clone, restore anything an
    earlier pass removed, and commit. Judgment calls (names, dead endpoints, logos) stay with check."""
    r = repo(name)
    if r["kind"] == "generated":
        raise SystemExit(f"{name}: generated repo, fix its plugin in the monorepo generator instead")
    d = os.path.join(PASS_DIR, name)
    added, removed = pass_added(name, d)
    # 1. Restore root files an earlier pass deleted or moved (CLAUDE.md, AGENTS.md).
    for f, base in removed.items():
        if f in ("CLAUDE.md", "AGENTS.md") and not os.path.exists(os.path.join(d, f)):
            content = sh("gh", "api", f"repos/{OWNER}/{name}/contents/{f}?ref={base}", "-H", "Accept: application/vnd.github.raw")
            open(os.path.join(d, f), "w").write(content + "\n")
            git("add", f, cwd=d)
    for f in [x for x in added if x.startswith(".claude/") and os.path.basename(x) in ("CLAUDE.md", "AGENTS.md")]:
        if os.path.exists(os.path.join(d, f)):
            git("rm", "-q", f, cwd=d)
    # 2. Find the plugin as shipped: root .claude-plugin/plugin.json or a marketplace source dir.
    root = os.path.join(d, ".claude-plugin")
    market = load_json(os.path.join(root, "marketplace.json")) or {}
    entries = market.get("plugins") or []
    if os.path.exists(os.path.join(root, "plugin.json")):
        src_dir = d
    elif len(entries) == 1 and isinstance(entries[0].get("source"), str):
        src_dir = os.path.normpath(os.path.join(d, entries[0]["source"]))
    else:
        raise SystemExit(f"{name}: no single plugin to migrate (entries: {[e.get('name') for e in entries]})")
    plugin = load_json(os.path.join(src_dir, ".claude-plugin", "plugin.json"))
    pname = plugin["name"]
    pd = os.path.join(d, "plugins", pname)
    rel_src = os.path.relpath(src_dir, d)

    def mv(a, b):
        os.makedirs(os.path.dirname(os.path.join(d, b)), exist_ok=True)
        git("mv", a, b, cwd=d)

    if os.path.normpath(src_dir) != os.path.normpath(pd):
        if src_dir == d:
            mv(".claude-plugin/plugin.json", f"plugins/{pname}/.claude-plugin/plugin.json")
            if os.path.exists(os.path.join(root, "icon.png")):
                mv(".claude-plugin/icon.png", f"plugins/{pname}/.claude-plugin/icon.png")
            moved = set()
            for f in sorted(added):
                if f.startswith("skills/") or f == ".mcp.json":
                    if os.path.exists(os.path.join(d, f)):
                        mv(f, f"plugins/{pname}/{f}")
                        moved.add(f)
            leftover = [f for f in added if f.startswith("skills/") and f not in moved and os.path.exists(os.path.join(d, f))]
            if leftover:
                raise SystemExit(f"{name}: pass-added skills not moved: {leftover}")
        else:
            for f in sorted(git("ls-files", rel_src, cwd=d).splitlines()):
                mv(f, f"plugins/{pname}/{os.path.relpath(f, rel_src)}")
    # 3. Rewrite the marketplace: repo slug, one entry pointing at plugins/<name>.
    entry = dict(entries[0]) if entries else {}
    entry.update({"name": pname, "source": f"./plugins/{pname}", "description": entry.get("description") or plugin.get("description")})
    entry.setdefault("category", "development")
    new_market = {"name": slug(name), "owner": {"name": OWNER}, "description": market.get("description") or plugin.get("description"),
                  "plugins": [{k: entry[k] for k in ("name", "source", "description", "category", "tags") if k in entry}]}
    json.dump(new_market, open(os.path.join(root, "marketplace.json"), "w"), indent=2)
    open(os.path.join(root, "marketplace.json"), "a").write("\n")
    git("add", ".claude-plugin/marketplace.json", cwd=d)
    # 4. plugin.json essentials: homepage, license, privacy policy for three.ws remote servers.
    ppath = os.path.join(pd, ".claude-plugin", "plugin.json")
    plugin = load_json(ppath)
    plugin.setdefault("homepage", r.get("homepage") or f"https://github.com/{OWNER}/{name}")
    has_license = any(os.path.exists(os.path.join(d, f)) for f in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"))
    if not has_license and not plugin.get("license"):
        shutil.copyfile(APACHE, os.path.join(pd, "LICENSE"))
        plugin["license"] = "Apache-2.0"
    hosts = remote_hosts(pd)
    if hosts and all(h == "three.ws" or h.endswith(".three.ws") for h in hosts):
        plugin["privacyPolicyUrl"] = "https://three.ws/legal/privacy"
    order = ["name", "version", "description", "author", "repository", "homepage", "license", "privacyPolicyUrl", "keywords"]
    plugin = {k: plugin[k] for k in order + [k for k in plugin if k not in order] if k in plugin}
    json.dump(plugin, open(ppath, "w"), indent=2)
    open(ppath, "a").write("\n")
    # 5. Icon: the three.ws mark for the family, the owner's mark for the rest when none is set.
    icon = os.path.join(pd, ".claude-plugin", "icon.png")
    if three_ws_family(name, d):
        shutil.copyfile(ICONS["three-ws"], icon)
    elif not os.path.exists(icon):
        shutil.copyfile(ICONS["nirholas"], icon)
    git("add", "-A", "plugins", ".claude-plugin", cwd=d)
    if git("status", "--porcelain", cwd=d):
        git("-c", f"user.name={OWNER}", "-c", "user.email=22895867+nirholas@users.noreply.github.com", "commit", "-q",
            "-m", f"refactor(plugin): move the {pname} plugin into plugins/{pname} under a {slug(name)} marketplace",
            "-m", "Keeps the repo's own CLAUDE.md, sources and tests out of the installed plugin, so it passes claude plugin validate --strict and the plugin-directory checks. Adds the plugin icon, homepage and license fields.",
            "-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", cwd=d)
    print(f"{name}: migrated {pname}")


def cmd_status():
    rs, done = load_repos(), shipped()
    prepared = [r["name"] for r in rs if os.path.isdir(os.path.join(PASS_DIR, r["name"]))]
    todo = [r["name"] for r in rs if r["name"] not in done]
    print(f"listed {len(rs)}, shipped {len(done)}, prepared {len(prepared)}, remaining {len(todo)}")
    print("next: " + ", ".join(todo[:20]))


def cmd_drop(name, canonical, reason=""):
    """Remove a duplicate plugin from a standalone copy of a package whose canonical plugin ships from
    another repo: delete the plugin files the pass's PRs added, restore files they changed, commit."""
    r = repo(name)
    if r["kind"] != "standalone":
        raise SystemExit(f"{name}: only standalone repos drop their plugin; {r['kind']} repos keep it")
    d = os.path.join(PASS_DIR, name)
    prs = [json.loads(l)["pr"] for l in open(os.path.join(DATA, "shipped.jsonl"))
           if json.loads(l)["name"] == name and json.loads(l).get("pr")]
    touched = {}
    for pr in prs:
        base = json.loads(gh_api(f"repos/{OWNER}/{name}/pulls/{pr}", "--jq", "{b: .base.sha}"))["b"]
        rows = json.loads(gh_api(f"repos/{OWNER}/{name}/pulls/{pr}/files?per_page=100", "--jq",
                                 "[.[] | {f: .filename, s: .status, p: .previous_filename}]"))
        for x in rows:
            if x["s"] == "renamed" and x["p"]:
                touched.setdefault(x["p"], ("modified", base))
            touched.setdefault(x["f"], ("added" if x["s"] in ("added", "renamed") else "modified", base))
    for f, (status, base) in sorted(touched.items()):
        if not PLUGIN_PATH_RE.match(f) and not f.startswith("plugins/"):
            continue
        full = os.path.join(d, f)
        existed = subprocess.run(["git", "cat-file", "-e", f"{base}:{f}"], cwd=d, capture_output=True).returncode == 0
        if existed:
            git("checkout", base, "--", f, cwd=d)
        elif os.path.exists(full):
            git("rm", "-q", "-f", f, cwd=d)
    for top in ("plugins", "plugin", ".claude-plugin", "skills"):
        for root, dirs, files in os.walk(os.path.join(d, top), topdown=False):
            if not os.listdir(root):
                os.rmdir(root)
    meta_p = os.path.join(PASS_DIR, f"{name}.meta.json")
    if not os.path.exists(meta_p):
        live = json.loads(gh_api(f"repos/{OWNER}/{name}", "--jq", "{description: (.description // \"\"), topics: .topics}"))
        json.dump(live, open(meta_p, "w"), indent=2)
    if os.path.exists(meta_p):
        meta = json.load(open(meta_p))
        meta["topics"] = [t for t in meta.get("topics", []) if t != "claude-code-plugin"]
        json.dump(meta, open(meta_p, "w"), indent=2)
    git("-c", f"user.name={OWNER}", "-c", f"user.email=22895867+{OWNER}@users.noreply.github.com", "commit", "-q",
        "-m", f"refactor(plugin): drop the duplicate plugin; the canonical one ships from {OWNER}/{canonical}",
        "-m", reason or (f"This repo is a standalone copy of the package {OWNER}/{canonical} publishes, and two "
                         "identical plugins under different names would be duplicate directory listings."),
        "-m", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", cwd=d)
    print(f"{name}: dropped the plugin in favour of {canonical}")


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else "status"
    fn = {"list": cmd_list, "prep": cmd_prep, "check": cmd_check, "ship": cmd_ship, "status": cmd_status, "audit": cmd_audit, "migrate": cmd_migrate, "drop": cmd_drop}[c]
    fn(*sys.argv[2:])
