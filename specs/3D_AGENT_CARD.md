# three.ws Card v1

A strict superset of the [ERC-8004 registration card](https://eips.ethereum.org/EIPS/eip-8004#registration-v1) for agents whose primary embodiment is a 3D model. This is the JSON document the ERC-721 `tokenURI` resolves to on the Identity Registry.

- **Type URI:** `https://three.ws/specs/3d-agent-card-v1`
- **JSON Schema:** [/.well-known/3d-agent-card.schema.json](../public/.well-known/3d-agent-card.schema.json)
- **Base spec:** ERC-8004 registration v1
- **Companion specs:** [AGENT_MANIFEST.md](AGENT_MANIFEST.md) (rich off-chain bundle), [REPORT_FORMAT.md](../public/validation/REPORT_FORMAT.md) (validation reports)

## Why

ERC-8004 is format-agnostic — the agent card can describe anything. That works for text/LLM agents but says nothing about 3D. Without a shared schema, every three.ws registry and viewer reinvents the same fields (model URI, hash, bounding box, license) incompatibly. v1 pins those fields so any 3D-aware consumer can:

1. Render the agent without parsing vendor-specific JSON.
2. Verify the model bytes match the card (`sha256`).
3. Surface a trust badge from a signed validation report.
4. Walk a provenance chain across versions.

## Required fields beyond ERC-8004

Only `model` is new and required. The block is intentionally small:

```json
"model": {
	"uri": "ipfs://bafy.../body.glb",
	"format": "gltf-binary",
	"sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

| Field          | Required | Notes                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `uri`          | ✓        | SHOULD be `ipfs://` — mutable URIs disqualify "trustless" claims.      |
| `format`       | ✓        | `gltf-binary` \| `gltf` \| `vrm`.                                      |
| `sha256`       | ✓        | Lowercase hex of the model bytes. Lets consumers verify independently. |
| `sizeBytes`    | —        | For load-time budgeting.                                               |
| `polygonCount` | —        | For perf/quality discovery.                                            |
| `boundingBox`  | —        | `{min:[x,y,z], max:[x,y,z]}` in meters. Lets viewers normalize scale.  |
| `license`      | —        | SPDX identifier or URL.                                                |

## Optional extension blocks

- **`manifest`** — pointer to a full [AGENT_MANIFEST](AGENT_MANIFEST.md) bundle when the agent has a brain/voice/skills.
- **`validation`** — pointer to a signed [validation report](../public/validation/REPORT_FORMAT.md).
- **`previousVersion`** — URI of the prior card. Forms a provenance chain across model updates.

## Conformance

A document conforms to three.ws Card v1 if:

1. It validates against the JSON Schema linked above.
2. Its `type` field includes both:
    - `https://eips.ethereum.org/EIPS/eip-8004#registration-v1`
    - `https://three.ws/specs/3d-agent-card-v1`
3. The bytes at `model.uri` hash to `model.sha256`.

Consumers MUST treat any document missing point 3 as unverified, regardless of validation reports.

## Minimal example

```json
{
	"type": [
		"https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
		"https://three.ws/specs/3d-agent-card-v1"
	],
	"name": "Coach Leo",
	"description": "A football coach who reviews your form.",
	"image": "ipfs://bafy.../poster.webp",
	"model": {
		"uri": "ipfs://bafy.../body.glb",
		"format": "gltf-binary",
		"sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
		"polygonCount": 48211,
		"boundingBox": { "min": [-0.4, 0, -0.3], "max": [0.4, 1.78, 0.3] },
		"license": "CC-BY-4.0"
	},
	"registrations": [
		{ "agentId": 1, "agentRegistry": "eip155:8453:0x8004A818BFB912233c491871b3d84c89A494BD9e" }
	],
	"supportedTrust": ["reputation", "validation"]
}
```
