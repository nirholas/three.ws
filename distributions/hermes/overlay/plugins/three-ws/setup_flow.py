"""The `hermes three-ws` subcommands.

Every endpoint, server name and skill list comes from `three_ws.json`, which
three.ws generates from data/agent-frameworks.json. Nothing here hardcodes a
URL, so moving the platform to a new endpoint is a regenerate, not a code edit.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable

PLUGIN_DIR = Path(__file__).resolve().parent
CONFIG = json.loads((PLUGIN_DIR / "three_ws.json").read_text(encoding="utf-8"))

SERVER = CONFIG["server"]
FREE = CONFIG["free"]
KEY_ENV = CONFIG["apiKeyEnv"]
SKIN = CONFIG["skin"]
SKILL_CATEGORY = CONFIG["skillCategory"]


# --- environment ---------------------------------------------------------------------------


def hermes_home() -> Path:
    """The active profile's home. `hermes -p <name>` exports HERMES_HOME before plugins run."""
    try:
        from hermes_constants import get_hermes_home

        return Path(get_hermes_home())
    except ImportError:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def hermes_argv() -> list[str]:
    """Run Hermes with the interpreter that is running us, so venvs and profiles line up."""
    return [sys.executable, "-m", "hermes_cli.main"]


def run_hermes(args: Iterable[str], *, capture: bool = False, timeout: int | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [*hermes_argv(), *args],
        text=True,
        capture_output=capture,
        timeout=timeout,
        check=False,
    )


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


# --- output --------------------------------------------------------------------------------


def say(line: str = "") -> None:
    print(line, flush=True)


def ok(line: str) -> None:
    say(f"  ✓ {line}")


def warn(line: str) -> None:
    say(f"  ! {line}")


def fail(line: str) -> None:
    say(f"  ✗ {line}")


def mask(secret: str) -> str:
    return f"...{secret[-4:]}" if len(secret) > 4 else "****"


# --- config writes -------------------------------------------------------------------------


def config_set(key: str, value: str) -> None:
    result = run_hermes(["config", "set", key, value], capture=True)
    if result.returncode != 0:
        raise SetupError(f"hermes config set {key} failed: {(result.stderr or result.stdout).strip()}")


def config_unset(key: str) -> None:
    run_hermes(["config", "unset", key], capture=True)


def config_get(key: str) -> str:
    result = run_hermes(["config", "get", key], capture=True)
    return result.stdout.strip() if result.returncode == 0 else ""


class SetupError(RuntimeError):
    pass


def write_servers(mode: str) -> None:
    """Point both three.ws servers at the configured URLs. `mode` is `oauth` or `key`."""
    name = SERVER["name"]
    config_set(f"mcp_servers.{name}.url", SERVER["url"])
    if mode == "key":
        config_unset(f"mcp_servers.{name}.auth")
        config_set(f"mcp_servers.{name}.headers.Authorization", f"Bearer ${{{KEY_ENV}}}")
    else:
        config_unset(f"mcp_servers.{name}.headers")
        config_set(f"mcp_servers.{name}.auth", "oauth")
    config_set(f"mcp_servers.{FREE['name']}.url", FREE["url"])
    ok(f"MCP servers: {name} ({'API key' if mode == 'key' else 'OAuth'}) and {FREE['name']} (free, no sign-in)")


def env_path() -> Path:
    return hermes_home() / ".env"


def save_api_key(key: str) -> None:
    """Store the key in the profile .env (0600). Hermes resolves ${VAR} in headers at connect time."""
    path = env_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    lines = [line for line in lines if not line.startswith(f"{KEY_ENV}=")]
    lines.append(f"{KEY_ENV}={key}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    ok(f"Saved {KEY_ENV} ({mask(key)}) to {path}")


def install_skin(apply_default: bool) -> None:
    source = PLUGIN_DIR / "skins" / f"{SKIN}.yaml"
    target_dir = hermes_home() / "skins"
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target_dir / source.name)
    if apply_default:
        config_set("display.skin", SKIN)
        ok(f"Skin: {SKIN} (now the default; `/skin default` switches back)")
    else:
        ok(f"Skin: {SKIN} installed (`/skin {SKIN}` to use it)")


def install_skills() -> int:
    """Copy the bundled skills into the profile so they appear in the agent's skill index."""
    source_root = PLUGIN_DIR / "skills"
    target_root = hermes_home() / "skills" / SKILL_CATEGORY
    target_root.mkdir(parents=True, exist_ok=True)
    count = 0
    for child in sorted(source_root.iterdir()):
        if not (child / "SKILL.md").is_file():
            continue
        target = target_root / child.name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(child, target)
        count += 1
    ok(f"Skills: {count} three.ws skills in {target_root}")
    return count


def remove_skills() -> None:
    target_root = hermes_home() / "skills" / SKILL_CATEGORY
    if target_root.exists():
        shutil.rmtree(target_root)
        ok(f"Removed {target_root}")


# --- connection checks ---------------------------------------------------------------------


def test_server(name: str) -> tuple[bool, str]:
    try:
        result = run_hermes(["mcp", "test", name], capture=True, timeout=120)
    except subprocess.TimeoutExpired:
        return False, "timed out after 120s"
    output = (result.stdout or "") + (result.stderr or "")
    for line in output.splitlines():
        if "Tools discovered" in line:
            return True, line.strip().lstrip("✓ ").strip()
    reason = next((line.strip() for line in output.splitlines() if "✗" in line), "")
    return False, reason.lstrip("✗ ").strip() or "no tools discovered"


def report_connections() -> bool:
    all_ok = True
    for server in (FREE, SERVER):
        passed, detail = test_server(server["name"])
        (ok if passed else fail)(f"{server['name']}: {detail}")
        all_ok = all_ok and passed
    return all_ok


def oauth_login() -> bool:
    name = SERVER["name"]
    if not interactive():
        warn(f"Not a terminal, so sign-in was skipped. Run: hermes three-ws login")
        return False
    say(f"\n  Signing in to three.ws. A browser window opens; approve access and come back here.\n")
    result = run_hermes(["mcp", "login", name])
    if result.returncode != 0:
        fail(f"Sign-in did not finish. Retry with: hermes three-ws login  (or --api-key from {CONFIG['apiKeyPage']})")
        return False
    return True


# --- subcommands ---------------------------------------------------------------------------


def cmd_setup(args: argparse.Namespace) -> int:
    say(f"\n  three.ws setup for Hermes  ({CONFIG['homepage']})")
    say(f"  Profile home: {hermes_home()}\n")
    key = args.api_key or ("" if not args.use_env_key else os.environ.get(KEY_ENV, ""))
    try:
        mode = "key" if key else "oauth"
        if key:
            save_api_key(key)
        write_servers(mode)
        if not args.no_skills:
            install_skills()
        if not args.no_skin:
            install_skin(apply_default=not args.keep_skin)
    except SetupError as error:
        fail(str(error))
        return 1
    if mode == "oauth" and not args.no_login:
        oauth_login()
    say("\n  Checking the connection:")
    healthy = report_connections()
    say()
    if healthy:
        say(f"  Done. Start a chat with `hermes` and try:\n    {CONFIG['firstPrompt']}\n")
        return 0
    say(f"  The free server works without an account. For the rest, run `hermes three-ws login`.")
    say(f"  Docs: {CONFIG['docs']}\n")
    return 0 if mode == "oauth" and args.no_login else 1


def cmd_login(args: argparse.Namespace) -> int:
    try:
        if args.api_key:
            save_api_key(args.api_key)
            write_servers("key")
        else:
            write_servers("oauth")
            if not oauth_login():
                return 1
    except SetupError as error:
        fail(str(error))
        return 1
    passed, detail = test_server(SERVER["name"])
    (ok if passed else fail)(f"{SERVER['name']}: {detail}")
    return 0 if passed else 1


def cmd_status(_args: argparse.Namespace) -> int:
    say(f"\n  three.ws in {hermes_home()}")
    url = config_get(f"mcp_servers.{SERVER['name']}.url")
    auth = config_get(f"mcp_servers.{SERVER['name']}.auth")
    header = config_get(f"mcp_servers.{SERVER['name']}.headers.Authorization")
    if not url:
        fail(f"Not set up. Run: hermes three-ws setup")
        return 1
    say(f"  {SERVER['name']}: {url}  auth: {'API key (' + KEY_ENV + ')' if header else auth or 'none'}")
    free_url = config_get(f"mcp_servers.{FREE['name']}.url")
    say(f"  {FREE['name']}: {free_url or 'not configured'}")
    say(f"  skin: {config_get('display.skin') or 'default'}")
    skills_root = hermes_home() / "skills" / SKILL_CATEGORY
    count = sum(1 for p in skills_root.glob("*/SKILL.md")) if skills_root.exists() else 0
    say(f"  skills: {count} in {skills_root}\n")
    healthy = report_connections()
    say()
    return 0 if healthy else 1


def cmd_uninstall(args: argparse.Namespace) -> int:
    for name in (SERVER["name"], FREE["name"]):
        config_unset(f"mcp_servers.{name}")
    ok("Removed the three.ws MCP servers from this profile")
    remove_skills()
    if config_get("display.skin") == SKIN:
        config_set("display.skin", "default")
        ok("Skin reset to default")
    return 0


def build_parser(parser: argparse.ArgumentParser) -> None:
    subs = parser.add_subparsers(dest="three_ws_command", metavar="{setup,login,status,uninstall}")

    setup = subs.add_parser("setup", help="Wire three.ws into this profile and sign in")
    setup.add_argument("--api-key", help=f"Use an API key instead of OAuth (create one at {CONFIG['apiKeyPage']})")
    setup.add_argument("--use-env-key", action="store_true", help=f"Use ${KEY_ENV} from the environment as the API key")
    setup.add_argument("--no-login", action="store_true", help="Configure only; sign in later with `hermes three-ws login`")
    setup.add_argument("--no-skills", action="store_true", help="Do not copy the three.ws skills into the profile")
    setup.add_argument("--no-skin", action="store_true", help="Do not install the three.ws skin")
    setup.add_argument("--keep-skin", action="store_true", help="Install the skin but keep the current default")

    login = subs.add_parser("login", help="Sign in again (OAuth), or switch to an API key")
    login.add_argument("--api-key", help="Switch this profile to API-key auth with this key")

    subs.add_parser("status", help="Show what is configured and test both servers")
    subs.add_parser("uninstall", help="Remove the three.ws servers, skills and skin from this profile")
    parser.set_defaults(func=dispatch)


HANDLERS = {"setup": cmd_setup, "login": cmd_login, "status": cmd_status, "uninstall": cmd_uninstall}


def dispatch(args: argparse.Namespace) -> int:
    handler = HANDLERS.get(getattr(args, "three_ws_command", None) or "")
    if handler is None:
        say("Usage: hermes three-ws {setup,login,status,uninstall}   (hermes three-ws setup to begin)")
        return 2
    code = handler(args)
    if code:
        sys.exit(code)
    return code


def slash_status(_raw_args: str) -> str:
    url = config_get(f"mcp_servers.{SERVER['name']}.url")
    if not url:
        return "three.ws is not set up in this profile. Exit and run: hermes three-ws setup"
    lines = [f"three.ws: {url}"]
    for server in (FREE, SERVER):
        passed, detail = test_server(server["name"])
        lines.append(f"{'ok' if passed else 'failed'}  {server['name']}: {detail}")
    if not all(line.startswith("ok") for line in lines[1:]):
        lines.append("Sign in again from a terminal: hermes three-ws login")
    return "\n".join(lines)
