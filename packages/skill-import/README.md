# @three-ws/skill-import

Turn an OpenAPI spec or a GitHub repository into a three.ws skill bundle
([`specs/SKILL_SPEC.md`](../../specs/SKILL_SPEC.md)): a `manifest.json`, a
`SKILL.md`, a `tools.json` with JSON Schema generated from the spec's
operations, and a `handlers.js` whose exported functions call `ctx.fetch`.

A repository that ships no OpenAPI/Swagger spec falls back to a declarative
bundle built from its README: a `SKILL.md` and `manifest.json` with no
`tools.json` and no `handlers.js` (see "Declarative-only skills" in the spec).

## Usage

```js
import { importFromUrl } from '@three-ws/skill-import';

const bundle = await importFromUrl('https://petstore3.swagger.io/api/v3/openapi.json', {
	fetchUrl: fetch, // supply an SSRF-guarded fetch in production, see api/skills/import.js
});

bundle.manifest; // manifest.json
bundle.skillMd; // SKILL.md text
bundle.tools; // tools.json, or null for a declarative bundle
bundle.handlersSrc; // handlers.js source text, or null for a declarative bundle
```

`fetchUrl` is always caller-supplied: this package never calls the bare
global `fetch`. In `api/skills/import.js` it is wired to
`fetchSafePublicUrlPinned` from `api/_lib/ssrf-guard.js` so a spec URL can
never be used to reach an internal address.

## Solana Anchor IDL

```js
import { generateAnchorBundle, importFromAnchorIdl } from '@three-ws/skill-import';

const bundle = generateAnchorBundle(idlJson, { sourceUrl });
// or: await importFromAnchorIdl({ program_id, cluster: 'devnet' }, { fetchUrl, rpcUrl });
```

Produces `read_<account>`, `preview_<ix>` and `send_<ix>` tools. `send_*` is `destructiveHint: true` and only returns an unsigned instruction with `status: "confirmation_required"`; nothing in the generated handlers signs. The risk panel (`manifest.risk`, and the table in `SKILL.md`) flags token movement, SOL spend, account closure and authority changes. `src/anchor-runtime.js` is the self-contained Borsh codec appended to the generated `handlers.js`.

## Auth

Operations that declare an OpenAPI security requirement get a generated
`applyAuth` call reading `ctx.secrets[secretName]` at call time: the secret
name is never baked into the handler, only declared in
`manifest.json#requires.secrets`. The host (the skill runtime, or whatever
backs the agent's skill install) is responsible for populating
`ctx.secrets` from wherever it stores that agent's credentials. Nothing is
ever hardcoded into the generated handler source.

## Modules

| Module | Responsibility |
| --- | --- |
| `openapi.js` | Parse OpenAPI 3.x JSON/YAML; convert Swagger 2.0 via `swagger2openapi`. |
| `operations.js` | Dereference `$ref`s and flatten `paths` into a normalized operation list. |
| `generate-tools.js` | Operations -> `tools.json`. |
| `generate-handlers.js` | Operations -> `handlers.js` source (one generic executor, per-op data embedded as JSON). |
| `generate-manifest.js` | Spec metadata -> `manifest.json`. |
| `generate-skillmd.js` | Spec + operations -> `SKILL.md`. |
| `declarative.js` | README-only repos -> a declarative bundle (Task 2). |
| `github.js` | GitHub repo -> spec discovery or README fallback, via the GitHub REST API. |
| `validate.js` | Structural + no-other-coin validation before a bundle is ever saved. |
| `index.js` | `importFromUrl(url, opts)`, the single entry point. |

## Testing

```
npm test --workspace packages/skill-import
```

`tests/skill-import.test.js` serves a synthetic OpenAPI fixture from a local
HTTP server, generates a bundle, validates it, and loads it into
`src/skills/index.js`'s `SkillRegistry` to call a generated tool end to end.
