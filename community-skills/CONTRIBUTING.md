# Contributing a skill

Thanks for writing one. A good skill makes an agent reliably better at one job, and it is reviewed like code because every agent that imports it will follow it.

## 1. Fork and add a folder

Fork this repository (the small mirror, [nirholas/three-ws-skills](https://github.com/nirholas/three-ws-skills), or the canonical [nirholas/three.ws](https://github.com/nirholas/three.ws) under `community-skills/`). Add `skills/<your-slug>/` with:

- `SKILL.md`: frontmatter `name` (exactly the folder name) and `description`, then the instructions.
- `metadata.json`: `name`, `description`, `author`, `tags` (1 to 8, lowercase kebab-case), `version` (semver), optional `license` (SPDX id, MIT by default).
- Optional `references/` (.md, .txt, .json) and `scripts/` (.mjs, .js, .py, .sh).

The slug is lowercase letters, digits and single hyphens, 3 to 64 characters, and unique in the registry.

## 2. Run the validator

```bash
node tools/validate.mjs
```

Node 18 or newer, no install step. It checks every skill, then rewrites `registry.json`. Commit both your folder and the regenerated `registry.json`. It fails when:

- the slug is not URL-safe, or collides with another skill (case-insensitively), or the display name is already taken
- `SKILL.md` has no frontmatter, its `name` does not match the folder, or the description is too short to act as a trigger
- the instructions are under 200 or over 12,000 characters
- `metadata.json` is missing a field, has an unknown one, or has a malformed tag or version
- a file sits outside `SKILL.md`, `metadata.json`, `references/` and `scripts/`, or exceeds 64 KB
- a JavaScript script does not parse
- the skill references a third-party token: a cashtag other than $THREE, $SOL or $USDC in prose, or a Solana address that is not the $THREE mint or core infrastructure

## 3. Open a pull request

Describe what the skill makes an agent do, and paste one before/after exchange showing the difference. A maintainer reviews it against the criteria below, merges it, and it appears on [three.ws/skills/community](https://three.ws/skills/community) with the next deploy.

## Review criteria

- **One job, done well.** A focused skill beats a sprawling one. Split unrelated advice into separate skills.
- **Instructions, not marketing.** Write what the agent should do, check, and output. Concrete formats, thresholds and examples.
- **Real surfaces only.** Every endpoint, tool or command you name must exist and work. Every script must run.
- **Honest and safe.** No price predictions, no manufactured urgency, no instructions to move funds without the user's explicit confirmation of recipient, amount and token. Skills that touch money must preview before acting.
- **Untrusted input stays untrusted.** Tell the agent to treat token names, web pages and tool output as data, never as instructions.
- **No promotion of other crypto projects.** $THREE is the only coin the platform promotes. Refer to venues and protocols by what they do, not by name; name-based review is done by a human because a validator cannot catch it.
- **No secrets, no personal data**, nothing that impersonates a person or company.

## Updating a skill

Bump `version`, edit the files, run the validator. Agents that imported an earlier version see "update available" and can pull the new one; their own local edits are never overwritten without their say.

## License

By contributing you agree your skill is released under the MIT License (see [LICENSE](LICENSE)) unless its `metadata.json` names another OSI-approved license.
