# Dependency advisory sweep, 2026-11-25

Scope: every lockfile and requirements file in the repo (npm, bun, Cargo, Go,
PyPI), checked against GitHub Dependabot and the OSV.dev batch API. The sweep
started at 62 open Dependabot alerts and 36 OSV findings. After it, 9 OSV
findings remain. Each one is listed below with the reason it is accepted.

The fixes are pinned by `tests/dependency-pin-advisories.test.js` (the
"2026-11-25 sweep" block). It reads the committed lockfiles directly, so a
regenerated lock that loses an override fails `npm test` before the alert
reopens.

## Fixed

| Ecosystem | Where | Change |
| --- | --- | --- |
| PyPI | `workers/model-pano2splat/requirements.d/*` | Pillow 11.3.0 to 13.0.0 (61 Dependabot alerts) |
| PyPI | `workers/model-panodepth`, `workers/model-sam3d-objects` | pytest to 9.1.1 / `>=9.0.3,<10` |
| PyPI | `workers/model-panodepth` image | Ubuntu 24.04 + Python 3.12 venv, so Dependabot's Pillow 13.0.0 pin (needs Python >= 3.11) can install. 12.3.0 would reopen 60+ advisories |
| PyPI | `workers/avatar-reconstruction` | off legacy `mediapipe.solutions` onto the Tasks API, mediapipe 1.2.3, numpy 2.3+, rembg 2.0.86, trimesh 4.12.2 |
| npm | root and five sub-packages, vendored Solidity library | glob 10/11/13 to 14.0.6 (AbortSignal traversal) |
| npm | `infra` | aws-cdk-lib 2.278.0, whose bundled minimatch is 11.0.9 |
| npm, bun | `third_party/image-blaster` | vite 7.3.8, vitest 4.1.12, plugin-react 5.2, plus in-range bumps for postcss, nanoid, @babel/core, browserslist, colord, fflate and others. `package-lock.json` and `bun.lock` match |
| npm | `integrations/n8n`, `integrations/webflow` | zod override to 4.6.6+ (GHSA-mrhx-c7xc-m3w5). Unit tests, `n8n-node build`, and `webflow devlink bundle` pass on 4.6.7 |
| Cargo | five contract crates, `integrations/zed` | anyhow 1.0.105, ctutils 0.4.8, url 2.5.9. All six pass `cargo check --locked --all-targets` |
| Go | `chat/server` | golang.org/x/sys 0.44.0 (Go 1.25), plus the broken tools module path repaired |

## Accepted, with reasons

| Package | Where | Advisory | Why it stays |
| --- | --- | --- | --- |
| borsh 0.10.4 | four Anchor programs | GHSA-fjx5-qpf4-xjf2 | Unsound only when parsing zero-sized types that are not Copy/Clone. Our account and instruction structs have none. The fix is borsh 1.x, which needs anchor-lang 1.x. That means migrating four deployed Solana programs and redeploying them on-chain, which is out of scope for a dependency sweep. Revisit when the programs move to Anchor 1.x. |
| bincode 1.3.3 | contract crates | RUSTSEC-2025-0141 (unmaintained) | Pulled in by solana-account 4.x and anchor-lang 0.31. This is a maintenance notice, not a vulnerability. Clears with the Anchor 1.x migration. |
| ansi_term, derivative, paste, libsecp256k1 | `contracts/program-tests` only | unmaintained notices | Pulled in by litesvm and the ark/poseidon chain. Test harness only, never deployed. |
| crypto-bigint 0.5.5 | `contracts/program-tests` only | RUSTSEC-2026-0387 | Via k256 0.13 in litesvm. The fix (0.7.6) needs k256 0.14, which litesvm does not support yet. Test harness only. |
| @faker-js/faker 5.5.3 | root, dev only | GHSA-qxc2-j82w-r537 | Pinned exactly by postman-collection (latest still pins 5.5.3), used only by `scripts/build-postman-collection.mjs` on our own OpenAPI spec. A faker 10 override breaks it (`Cannot read properties of undefined (reading 'city')`). |
| basicsr 1.4.2 | `workers/model-hunyuan3d` | GHSA-86w8-vhw6-q9qq | No fixed release exists. The affected SLURM distributed-init path is never called by the worker. |

## Rerun

The scan reads every `package-lock.json`, `bun.lock`, `Cargo.lock`, `go.sum`
and `requirements*.txt` outside `node_modules` and posts them to
`https://api.osv.dev/v1/querybatch`. For npm trees, `npm audit` inside each
package directory gives the same GHSA view.
