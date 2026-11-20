# vendor/

Patched copies of npm packages, wired in with `file:vendor/<name>` overrides in `package.json` (root, `chat/`, `multiplayer/`, and per-package copies such as `apps/*/vendor`).

They exist to carry security fixes the upstream line does not ship for the major we depend on. For example, `minimatch` is 10.2.6 with the 11.0.1 CVE fix backported, because 11.x drops the API that glob and typedoc rely on.

Rules:

- Do not edit a vendored copy casually. Each package's `package.json` `description` states what was patched and why.
- Copies are intentionally duplicated per package so each one installs standalone. Keep every copy of a package identical when patching it.
- Drop a copy once upstream ships the fix on a compatible major.
