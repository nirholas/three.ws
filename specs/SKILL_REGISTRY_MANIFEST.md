# Skill Registry Manifest v1

Status: stable. Schema id: `three.ws/skill-registry@1`.

A skill registry manifest lists `SKILL.md` skills that an importer may install, with an integrity pin for each. three.ws reads any manifest an owner adds at [/skills/import](https://three.ws/skills/import), and publishes its own users' skills as one at `https://three.ws/api/skill-imports/published/manifest.json`. The importer is described in [docs/skill-import.md](../docs/skill-import.md).

## Transport

- Served over `https` only. Any other scheme is refused.
- `Content-Type` should be `application/json`. At most 512 KB.
- The importer resolves the URL against the public internet only (no private, loopback or link-local addresses) and caches the parsed index for five minutes.
- The revision of a manifest is the sha256 of its exact bytes.

## Document

```json
{
  "schema": "three.ws/skill-registry@1",
  "name": "string, optional: display name of the registry",
  "homepage": "https URL, optional",
  "skills": [ Entry, ... ]
}
```

| Field | Required | Rule |
|---|---|---|
| `schema` | yes | Exactly `three.ws/skill-registry@1`. Anything else is refused as `invalid_manifest`. |
| `skills` | yes | Array. Only the first 200 entries are read. |
| `name`, `homepage` | no | Shown as the registry's label and link. |

## Entry

| Field | Required | Rule |
|---|---|---|
| `slug` | yes | Kebab case: `^[a-z0-9]+(-[a-z0-9]+)*$`. Unique within the manifest. |
| `url` | yes | Where the `SKILL.md` lives. Absolute or relative to the manifest URL; must resolve to `https`. |
| `sha256` | yes | Lowercase hex sha256 of the exact `SKILL.md` bytes served at `url`. A body that does not hash to it is refused as `integrity_mismatch`. |
| `license` | strongly recommended | An SPDX id (`MIT`, `Apache-2.0`, `GPL-3.0-only`, ...) or licence text. Entries without a recognisable open licence are listed as not offered, never installable. |
| `name`, `description` | recommended | Display name and the one-line description an agent uses to decide when the skill applies. |
| `author`, `version`, `tags`, `category` | no | `category` is one of `defi`, `intelligence`, `social`, `infrastructure`, `security`, `data`, `other`; when absent the importer infers one. `tags` is an array of strings (first 8 used). |
| `allowed-tools` | no | Tool names the skill expects, the same field as Agent Skills frontmatter. Used to show what the skill asks for and to decide whether it is gated. |
| `revision` | no | Free-form revision label (for example an ISO timestamp). |
| `commit`, `source_repo` | no | Upstream provenance when the skill came from a repository. Shown to the owner. |
| `bytes` | no | Size hint. Bodies over 64 KB are refused regardless. |

An entry missing `slug`, an https `url`, or a valid `sha256` is reported as unreadable with that reason and skipped; the rest of the manifest is still read.

## The SKILL.md

The body at `url` is a standard Agent Skills `SKILL.md`: YAML frontmatter between `---` lines with at least `name` and `description`, then markdown instructions. YAML aliases are refused. The importer installs only the instructions after the frontmatter; nothing is executed. The instructions must fit the agent's skill budget (24,000 characters and about 6,000 tokens).

## Pinning and updates

- An installed skill records the manifest URL, the entry `slug`, its `sha256` and the manifest revision.
- The installed copy never changes on its own. When the owner checks for an update, the importer re-reads the manifest; a different `sha256` produces a diff and a new scan the owner must approve.
- Publishers should treat a `sha256` as immutable for a given body. Change the body, change the hash.

## Example

```json
{
  "schema": "three.ws/skill-registry@1",
  "name": "Example skills",
  "homepage": "https://skills.example",
  "skills": [
    {
      "slug": "release-notes",
      "name": "Release notes",
      "description": "Turn merged changes into readable release notes.",
      "author": "Example",
      "version": "1.2.0",
      "license": "MIT",
      "category": "data",
      "tags": ["docs", "writing"],
      "url": "skills/release-notes/SKILL.md",
      "sha256": "3f1c0b8d6c1f1a2b9e7d5c4a3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a29180"
    }
  ]
}
```

Compute the pin with `sha256sum skills/release-notes/SKILL.md` (or `shasum -a 256`).

## Reference implementation

- Reader: `manifestDocIndex` and `fetchSkillBody` in `api/_lib/skill-import-sources.js`.
- Writer: `publishedManifest` and `renderPublishedSkill` in `api/_lib/skill-import-store.js`.
- Tests: `tests/skill-import.test.js` (`manifests`, `renderPublishedSkill`).
