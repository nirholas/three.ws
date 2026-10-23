# parity 10: remaining owner step for external community skills

Trimmed 2026-10-23. Built and committed in `dd69b9b4b`: operator-pinned external GitHub skill sources (`api/_lib/community-skill-sources.js`), the API, the CLI import path, and the labelled section on /skills-community. Never auto-enabled; installs go through the existing scan and approval flow. Tests and a browser pass are green.

## Remaining (owner)

1. Approve the source list (each entry is `{repo, ref, path, license}` with `ref` a 40-hex commit sha and a permissive license). The proposed list is in the session report.
2. Set it on Cloud Run with `gcloud run services update three-ws-api --region us-central1 --update-env-vars COMMUNITY_SKILL_SOURCES='[...]'` (never `--set-env-vars`).
3. Verify `GET /api/skills/community` returns an `external` object, then add the changelog entry and run `npm run build:pages`.

Close out: when done, `git rm` this file in its own commit.
