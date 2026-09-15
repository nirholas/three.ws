# Growth satellite export and publication

The agent starter and GLB Quality Gate are intentionally small public front doors. Their
canonical source stays in this monorepo under [`satellites/`](../../satellites), and a one-way
export creates standalone Git histories ready for their own repositories.

## Build and verify

```bash
npm run export:growth-satellites
```

The exporter:

1. replaces only `dist/growth-satellites/`;
2. copies each curated source plus the root Apache-2.0 license and notice;
3. installs locked dependencies;
4. runs each satellite's real tests;
5. builds the committed JavaScript Action bundle;
6. creates a clean, single-commit `main` history for each repository;
7. writes `manifest.json` with the exact commit and file count.

For a structural export without network-dependent installs:

```bash
npm run export:growth-satellites -- --offline
```

Build only one tree with `--target agent-starter` or `--target glb-quality-gate`. A custom
`--out` is allowed only beneath this repository's `dist/` directory.

## Publish

The destination repositories are:

- `https://github.com/nirholas/threews-agent-starter`
- `https://github.com/nirholas/glb-quality-gate`

Create each as a public, empty repository. The exporter prints the exact `remote add` and
`push` commands for the generated tree. Never pull, fetch, or merge a satellite into the
monorepo; rebuild it from source for every release.

After publishing the starter, mark it as a template repository in GitHub settings and verify
that a fresh Codespace opens port 4173 with the live agent visible.

After publishing the Action:

1. create annotated tag `v1.0.0`;
2. point major tag `v1` at the same commit;
3. create a GitHub release;
4. open `action.yml` on GitHub and choose **Publish this Action to the GitHub Marketplace**;
5. accept the Marketplace terms and select the continuous-integration category;
6. install `nirholas/glb-quality-gate@v1` in a real repository containing a changed GLB.

Marketplace publication requires a separate public repository with one root action metadata
file. The release tag is the install contract, so move `v1` only after the exported tests and
bundle pass.

## Update the monorepo after publication

- Replace planned repository links in `marketing/growth/opportunities.csv` with live URLs.
- Record the template and Marketplace release in `data/changelog.json`.
- Add dedicated campaign IDs before linking from a directory submission or announcement.
- Record template uses, Codespaces starts, Action installations, weekly runs, and referred
  sessions in the marketing scorecard.
