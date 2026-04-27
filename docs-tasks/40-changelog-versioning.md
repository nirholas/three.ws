# Agent Task: Write "Changelog & Versioning" Documentation

## Output file
`public/docs/changelog.md`

## Target audience
Developers who want to know what changed between versions, how to migrate, and how the project is versioned.

## Word count
1200–2000 words

## What this document must cover

### 1. Versioning policy
three.ws uses Semantic Versioning (semver):
- **Major** (X.0.0) — breaking changes to the web component API, agent manifest format, or SDK
- **Minor** (1.X.0) — new features, backwards-compatible
- **Patch** (1.5.X) — bug fixes, no API changes

Current version: **1.5.1** (read from `/package.json`).

### 2. Breaking changes policy
Before making breaking changes:
- Deprecation notice in the previous minor version
- Migration guide published before the breaking release
- Old behavior supported for at least one minor version after deprecation

What counts as a breaking change:
- Removing or renaming web component attributes
- Changing the agent manifest schema in a non-backwards-compatible way
- Changing API endpoint behavior or response format
- Removing public SDK exports

### 3. The changelog
Generate a detailed changelog by reading git history carefully with `git log --oneline` and the commit messages. Organize by version.

For each version entry, include:
- Version number and release date
- Category labels: `feat`, `fix`, `perf`, `docs`, `breaking`
- One-line description of each change
- Migration notes for any breaking changes

Structure:
```
## [1.5.1] — 2026-04-27
### Fixed
- ...

### Changed
- ...

## [1.5.0] — 2026-04-15
### Added
- ...

## [1.4.0] — ...
```

Read the git log to generate real entries — don't invent version history.

### 4. SDK versioning
The SDK (`@3dagent/sdk`) is versioned separately from the platform:
- SDK version in `/sdk/CHANGELOG.md`
- Platform releases may not always bump the SDK version (if no public API changed)
- The CDN URL includes the version: `https://cdn.three.wsagent-3d@1.5.1.js`
- The unversioned URL `https://cdn.three.wsagent-3d.js` always points to latest stable

Using versioned CDN URLs is recommended for production:
```html
<!-- Pinned to 1.5.1 — won't break if 2.0.0 releases -->
<script type="module" src="https://cdn.three.wsagent-3d@1.5.1.js"></script>

<!-- Always latest — convenient for dev, risky for production -->
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
```

### 5. Smart contract versioning
The ERC-8004 smart contracts are immutable once deployed:
- Contract code never changes after deployment
- New features require deploying new contracts
- Old contract addresses continue to work indefinitely
- The platform always uses the latest contract for new registrations
- Existing registrations on older contracts remain valid

When new contracts are deployed:
- New addresses added to `REGISTRY_DEPLOYMENTS` in the SDK
- Old addresses remain in `REGISTRY_DEPLOYMENTS` (not removed)
- A migration path is provided if agent owners want to re-register

### 6. Manifest format versioning
Agent manifests include a `$schema` field:
```json
{ "$schema": "https://three.ws/schemas/agent-manifest-v1.json" }
```

Current: v1. Rules:
- v1 manifests will always be loadable
- New fields can be added to v1 (backwards compatible)
- Breaking changes (field removals, renames) require v2
- The manifest loader handles both v1 and v2 simultaneously

### 7. How to upgrade

**Upgrading npm package:**
```bash
npm update @3dagent/sdk
# or pin to specific version:
npm install @3dagent/sdk@1.5.1
```

**Upgrading CDN embed:**
Change the version in the script tag URL. Check the migration notes for the target version before upgrading.

**Checking current version:**
```js
import { version } from '@3dagent/sdk';
console.log(version); // "1.5.1"

// Or from the API
const { version } = await fetch('/api/config').then(r => r.json());
```

### 8. Deprecation notices
List any currently deprecated features:
- Check the codebase for `@deprecated` JSDoc comments
- Check open issues labeled `deprecation`
- Note target removal versions

### 9. Release process (for maintainers)
Brief overview for contributors who want to understand how releases happen:
1. Changes merged to `main` branch
2. Version bumped in `package.json` and `sdk/package.json`
3. `CHANGELOG.md` updated
4. Tag created: `git tag v1.5.1`
5. GitHub Release created from tag
6. `npm run publish-lib` uploads to CDN
7. Vercel auto-deploys from `main`

### 10. Getting notified of releases
- Watch the GitHub repository (Releases only)
- Follow @3dagent on relevant social platforms (link in README)
- `npm install` notifications: set `npm outdated` in your CI pipeline

## Tone
Reference documentation. The changelog section should be genuinely useful — read git history to generate real entries, not placeholder text. Developers use changelogs to make upgrade decisions.

## Files to read for accuracy
- `/package.json` — current version
- `/sdk/CHANGELOG.md` — SDK changelog
- `/sdk/README.md` — SDK versioning
- Run `git log --oneline -50` to get recent commits for the changelog
- Run `git tag -l` to see all versions
- `/scripts/publish-lib.mjs` — release process
