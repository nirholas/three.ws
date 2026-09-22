"""three.ws for Hermes Agent.

Registers `hermes three-ws setup | login | status | uninstall`, an in-session
`/three-ws` status command, and the bundled three.ws skills.

Everything the plugin changes goes through Hermes' own public commands
(`hermes config set`, `hermes mcp login`, `hermes mcp test`), so it keeps
working as Hermes evolves and always targets the active profile.
"""

from __future__ import annotations

from pathlib import Path

from . import setup_flow


def register(ctx):
    ctx.register_cli_command(
        name="three-ws",
        help="Connect Hermes to three.ws: MCP servers, skills, sign-in and skin",
        description=(
            "Wire the three.ws MCP servers and skills into the active Hermes profile, "
            "sign in with OAuth or an API key, and check the connection."
        ),
        setup_fn=setup_flow.build_parser,
        handler_fn=setup_flow.dispatch,
    )
    ctx.register_command(
        "three-ws",
        handler=setup_flow.slash_status,
        description="Show the three.ws connection for this profile",
    )
    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.is_dir():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.is_file():
                ctx.register_skill(child.name, skill_md)
