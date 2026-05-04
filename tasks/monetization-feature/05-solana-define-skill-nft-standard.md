---
status: not-started
---

# Prompt 5: Solana - Define Skill NFT Standard

**Status:** Not Started

## Objective
Define a clear and comprehensive metadata standard for NFTs that represent ownership of an agent's skill.

## Explanation
To represent skills as unique, tradable assets on the Solana blockchain, we need a robust metadata structure. This standard will ensure that all skill NFTs on the platform are consistent, making them easy to display in wallets and on secondary marketplaces. We will use the Metaplex Token Metadata standard as our base.

## Instructions
1.  **Define Core Metadata Fields:**
    -   `name`: The name of the skill (e.g., "Super-Resolution Image Generator"). Should be concise and clear.
    -   `symbol`: A short symbol for the skill NFT (e.g., "SR-IMG").
    -   `description`: A detailed explanation of what the skill does, its inputs, and its outputs.
    -   `image`: A URL to an icon or banner image representing the skill.
    -   `external_url`: A URL pointing to the agent's detail page on the three.ws marketplace (e.g., `https://three.ws/marketplace/agents/AGENT_ID`).

2.  **Define Custom Attributes (Metaplex `attributes` array):**
    -   Create a list of `trait_type` and `value` pairs to store skill-specific information. This is crucial for filtering and discovery.
    -   **`trait_type: "Skill Name"`**: `value: "text-to-image"` (The machine-readable name of the skill).
    -   **`trait_type: "Agent ID"`**: `value: "AGENT_ID"` (The ID of the agent that this skill belongs to).
    -   **`trait_type: "Agent Name"`**: `value: "Creator's Agent"` (The human-readable name of the agent).
    -   **`trait_type: "Version"`**: `value: "1.0.0"` (The version of the skill).
    -   **`trait_type: "Category"`**: `value: "Image Generation"` (To help with organization).

## Code Example (JSON Metadata)

This is an example of the JSON file that would be uploaded to a decentralized storage service like Arweave and linked in the NFT's metadata.

```json
{
  "name": "Super-Res Image Generator",
  "symbol": "SR-IMG",
  "description": "This skill allows the agent to take a low-resolution image and generate a high-resolution version using advanced AI models. Outputs a 4x upscaled image.",
  "image": "https://arweave.net/path-to-skill-icon.png",
  "external_url": "https://three.ws/marketplace/agents/AGENT_ID",
  "attributes": [
    {
      "trait_type": "Skill Name",
      "value": "super-resolution-image-generator"
    },
    {
      "trait_type": "Agent ID",
      "value": "f8a4e12d-6b3a-4f3e-8b1a-9c2d7e5f4a1b"
    },
    {
      "trait_type": "Agent Name",
      "value": "PixelPerfect"
    },
    {
      "trait_type": "Version",
      "value": "1.0.0"
    },
    {
      "trait_type": "Category",
      "value": "Image Generation"
    }
  ],
  "properties": {
    "files": [
      {
        "uri": "https://arweave.net/path-to-skill-icon.png",
        "type": "image/png"
      }
    ],
    "category": "image"
  }
}
```

## Definition of Done
- The NFT metadata standard is finalized and documented in this file.
- The standard includes all necessary fields for discovery, display, and verification.
- The team agrees on this structure before proceeding to the implementation prompts.
