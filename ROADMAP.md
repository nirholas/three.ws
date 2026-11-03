# Roadmap

The destination: anyone can mint a 3D agent of themselves, own it onchain, and embed it anywhere on the internet. Phase-by-phase detail lives in the [full reference](docs/reference.md#roadmap). Shipped work is in the [changelog](CHANGELOG.md).


| Phase | Theme                                                                                  | Status                                                                                                         |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **0** | Platform foundations (viewer, runtime, ERC-8004 + Metaplex Core identity, embed layer) | -�� Shipped                                                                                                     |
| **1** | Selfie -�� Avatar engine (3-photo capture, hosted inference)                             | 🟡 In progress: capture, reconstruction backend, rigging, R2 storage and draft mint are wired end to end; likeness fidelity is the open track |
| **2** | Agent personalization + voice cloning                                                  | 🟡 In progress: voice clone, persona, memory seeds shipped behind `/demos`; main-flow integration next        |
| **3** | Onchain economy (agent tokens, reputation markets, royalties)                          | 🟡 In progress: bonding-curve sim, EAS-reputation viewer, 0xsplits + EAS SDKs landed; per-call skill royalties accrue on paid skill calls (`royalty_ledger`); contracts + audits next |
| **4** | Open inference network (decentralized GPU layer)                                       | 🟡 Live core: open node-operator client (CPU + CUDA images) + `/api/nodes` job queue with signed, server-recomputed receipts shipped; Livepeer federation behind a flag               |
| **5** | Native widgets (agent on your home screen and desktop)                                  | 🟡 In progress: Glance shipped the card endpoint (JSON, SVG, PNG, Adaptive Card), the Windows 11 widget (installs from the PWA manifest, no store), the `<agent-glance>` element, and the Android home screen widget (app 1.1.0, linked from `/glance` with its own revocable token); macOS and iOS next |


Want to help? Pick a [good first issue](https://github.com/nirholas/three.ws/labels/good%20first%20issue) or start a [discussion](https://github.com/nirholas/three.ws/discussions).
