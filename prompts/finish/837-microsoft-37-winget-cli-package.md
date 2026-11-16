# microsoft 37: install the three.ws agent CLI on Windows with `winget install`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3137.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The Windows Package Manager (winget) ships with every current Windows install, and its community repository (`microsoft/winget-pkgs`) is where Windows developers and IT admins look first. Today the agent CLI ([packages/agent-cli/](../../packages/agent-cli)) installs on Windows through `install.ps1`, which needs Node.js first. A self-contained `three-ws-agent.exe` published to winget installs in one command with no prerequisites, and it is a listing on a Microsoft-run catalog.

## Step 0: re-derive the current state

    cat packages/agent-cli/package.json | head -50
    sed -n 1,40p packages/agent-cli/install.ps1
    ls packages/agent-cli/bin packages/agent-cli/src | head -30
    grep -rn "release\|sea\|pkg\b" packages/agent-cli/package.json | head
    npm view three-ws-agent version 2>/dev/null || echo "not on npm under that name"

Read the current winget manifest schema (version, singleton versus multi-file manifests, `portable` and `zip` installer types, `NestedInstallerType`, `Commands`), the `winget-pkgs` contribution and validation rules (Defender scan, URL and hash rules, publisher naming), and Node's Single Executable Applications (SEA) docs for the Node version the CLI targets.

## Tasks

1. **Self-contained executable.** A build script `packages/agent-cli/scripts/build-windows.mjs` that bundles the CLI into one file (esbuild), generates a SEA blob, and injects it into the official Windows x64 and arm64 `node.exe` for the pinned Node version (downloaded from nodejs.org with SHASUMS256 verification) using `postject`. Output zips with the exe, LICENSE and a README.
2. **Release artifacts.** Upload the zips to the existing public GCS bucket (or attach to a GitHub release draft the owner publishes; find the release mechanism the repo already uses), with SHA256 recorded. Versioned URLs that never change once published.
3. **Manifests** in `distributions/winget/` (follow the existing `distributions/` layout): multi-file manifests for `ThreeWs.Agent` (verify the identifier convention), version, installer (both architectures, zip with nested portable exe and the `three-ws-agent` command alias) and default locale with real descriptions, license, publisher URLs and tags. Validated against the vendored winget JSON schemas in a test.
4. **Verify on Windows.** Create a short-lived GCE Windows Server VM (GCP is pre-approved), install winget there, run `winget validate` and `winget install --manifest <dir>` against the real artifacts, run `three-ws-agent --version` and one real read-only command against production, capture the output, then delete the VM. Script it in `scripts/verify-winget-on-gce.mjs` so it is repeatable.
5. **Update flow.** Document how each new CLI version regenerates the manifests (a script that bumps version, URLs and hashes) and the PR to `microsoft/winget-pkgs` the owner opens (or `wingetcreate` commands).
6. **Docs.** Windows install section in the CLI README and [docs/agent-cli.md](../../docs/agent-cli.md), `distributions/winget/README.md`, changelog entry, `npm run build:pages`.

## Definition of done

- [ ] Both exes run on the GCE Windows VM, installed via `winget install --manifest`; `winget validate` passes (output in the report); the VM is deleted.
- [ ] Manifest schema test passes; artifact hashes in the manifests match the published files.
- [ ] Docs and changelog landed; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Native modules block SEA | Replace or lazy-load them; if one is essential, ship the zip with the module beside the exe and document it. |
| winget not preinstalled on Windows Server | Install the App Installer bundle and its dependencies by script, as Microsoft documents for Server. |
| No code-signing certificate | Not required by winget; note SmartScreen behaviour and list signing as an owner follow-up. |
| Publishing to winget-pkgs | Owner step (outside PR); everything up to it is done and validated. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
