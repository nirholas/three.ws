# three.ws 3D Studio

**Author:** three-ws
**Version:** 0.1.0
**Type:** tool
**Source:** <https://github.com/nirholas/three.ws/tree/main/integrations/dify/three_ws>

Free text-to-3D for Dify agents and workflows. Describe an object or a
character and get back a real, downloadable GLB file plus a browser viewer link.
No API key, no account, and no payment.

## Tools

| Tool | What it does |
| --- | --- |
| **Generate 3D Model** | Text to a textured 3D model (GLB). Draft, standard or high quality. |
| **Create 3D Avatar** | Text or a reference image to a rigged, animation-ready humanoid character. |
| **Rig 3D Model** | Adds a humanoid skeleton and skin weights to a GLB you already have. |
| **Search 3D Assets** | Searches thousands of free CC0 props, rigged characters and motion clips. |

Each generation tool returns:

- a text summary with the GLB URL and viewer link (for chat apps),
- a JSON object with `status`, `glb_url`, `viewer_url`, `ar_url`,
  `poster_png_url` and `embed_html` (for workflow variables),
- optionally the GLB itself as a file output (turn on **Attach GLB file**).

## Setup

1. Install the plugin from the Dify Marketplace.
2. Add any of the four tools to an agent or a workflow. There is nothing to
   configure: the service is anonymous.

## Usage notes

- A draft model usually takes about a minute; standard, high and avatars take a
  few minutes. If a generation is still running after nine minutes, the tool
  returns `status: "pending"` with a viewer link that opens the model by itself
  the moment it is ready.
- Search the catalog first: a ready-made CC0 asset is instant.
- The free service caps generations per IP per hour. When the cap is reached,
  the tool says when to try again.
- Generated GLB files are public at unguessable URLs. Do not put private details
  in a prompt.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Contact

- Issues: <https://github.com/nirholas/three.ws/issues>
- Website: <https://three.ws>
- Docs: <https://three.ws/docs>
