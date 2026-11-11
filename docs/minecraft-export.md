# Minecraft: Bedrock export

Turn any Forge model into blocks and download it as a Minecraft: Bedrock Edition structure pack (`.mcpack`). The pack loads in any Bedrock world through a structure block or a single `/function` command.

> NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
>
> Minecraft is a trademark of Mojang Synergies AB. three.ws uses the name only to say which game the file works with, per the [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines).

## Export from the Forge

1. Generate or open a model on [/forge](/forge).
2. Open the download menu (the caret next to **Download**) and choose the **.mcpack** row labelled **Minecraft: Bedrock**.
3. Adjust the build while the preview updates:
   - **Height in blocks**: 16 to 128. Width and depth follow the model's proportions.
   - **Blocks to use**: all solid blocks, or only concrete, wool, terracotta, builder blocks (planks and stone), or colorful blocks (concrete, wool and terracotta).
   - **Inside**: solid fills the model; hollow shell keeps only the outer layer (far fewer blocks, faster to load).
   - **Dither colors**: mixes the two nearest blocks in a fixed pattern for smoother gradients.
   - **Auto brightness**: on by default. See [Colors](#colors).
4. Press **Download .mcpack**.

The panel shows the block count, the size in blocks, how many block types were used, and the most used blocks with their counts.

## Load it in Bedrock

1. Open the `.mcpack` file. Bedrock imports it as a behavior pack.
2. Create or edit a world, turn on **cheats**, and add the pack under **Behavior Packs**.
3. Place the build, either way:
   - **Structure block**: `/give @s structure_block`, place it, switch it to **Load**, enter `threews:<name>` (the panel shows the exact id), and press **Load**.
   - **Function**: stand where the build should go and run `/function threews/<name>`.

Builds wider than one structure block ship as tiles (`threews:<name>_0_0`, `threews:<name>_1_0`, ...). For those, use the function: it places every tile at the right offset in one command.

Each export gets its own id: the model's prompt when it is known, otherwise `forge_` plus the start of the model id. Two packs in one world never overwrite each other's structures.

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| Height | 16 to 128 blocks | Below 16 most models lose their shape; above 128 the voxel count gets slow to place. |
| Width and depth | at most 192 blocks | The height is reduced (the panel says so) when a wide model would exceed this. |
| One structure | 64 x 257 x 64 blocks | The structure block's own maximum ([Microsoft Learn: Introduction to Structure Blocks](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontostructureblocks)). Larger builds are tiled. |
| Model file | 60 MB, 1.5 million triangles | Keeps one export inside the request deadline. |
| Time | 25 seconds per request | A timeout returns a clear error; a smaller height always fits. |
| Requests | 60 per 5 minutes per IP | Enough to drag the slider and download several packs. |

Only saved models export: the voxelizer runs on the server and needs a stored GLB. An unsaved edit in the current tab (a local file or an in-browser change) has to be saved first.

## Colors

Each block's color is sampled from the model's base-color texture at the exact surface point the block covers, so painted details survive. Models without a texture use their vertex colors, then their flat material color. The panel says which source it used.

Colors are matched to blocks in CIELAB, which follows how people perceive color difference rather than raw RGB distance. Inside blocks (solid fill) reuse the color of the nearest surface block in the same column; nobody sees them, but they still come from the model.

**Auto brightness.** Forge textures are often authored dark (metals and weathered materials average around RGB 20 to 45) because the viewer's lighting brightens them on screen. Blocks carry no such lighting, so a faithful match turns a steel knight into coal. When the brightest tenth of the surface is darker than CIE L\* 70, every color is scaled in linear light until it reaches it, capped at 4x. Hue and contrast are preserved. The panel shows the factor applied; turn the toggle off to keep the raw colors.

The block table lives in `api/_lib/minecraft/bedrock-palette.js`: full-cube, non-gravity, non-transparent blocks only, with their average top-face colors. Glazed terracotta is left out on purpose; its patterns read as noise at block scale.

## API

`POST /api/minecraft-export`

```json
{
  "creationId": "79cb2866-cd3f-4a25-ac69-71df9f016802",
  "glbUrl": "https://three.ws/cdn/forge/anon/79cb2866-cd3f-4a25-ac69-71df9f016802.glb",
  "height": 64,
  "palette": "all",
  "fill": "solid",
  "dither": false,
  "levels": "auto",
  "name": "knight",
  "format": "preview"
}
```

Pass `creationId` (a public Forge creation), `glbUrl` (any public https GLB), or both; a creation that is not public falls back to the URL.

- `format: "preview"` returns JSON: `name`, `structureId` (null when tiled), `functionName`, `stats` (`dims`, `blockCount`, `surfaceBlocks`, `interiorBlocks`, `tiles`, `colorSource`, `brightness`, `clamped`), the preview voxels (base64, 4 bytes each: x, y, z, block index into `preview.palette`), and the palette presets.
- `format: "mcpack"` returns the pack as `application/octet-stream` with `x-structure-ids` and `x-block-count` headers.

Errors use the standard `{ error, error_description }` shape: `validation_error` and `invalid_palette` (400), `creation_not_found` (404), `too_large` / `too_complex` (413), `invalid_model` / `no_geometry` / `empty_build` (422), `fetch_failed` (502), `timeout` (503), and 429 when rate limited.

## CLI

```sh
node scripts/minecraft-export.mjs <glb-url-or-path> --height 64 --palette all --name knight --out ./packs
```

Options: `--fill solid|shell`, `--dither`, `--no-levels`. The script writes the `.mcpack`, unzips it, parses every structure with [prismarine-nbt](https://github.com/PrismarineJS/prismarine-nbt) (an independent reader), and exits non-zero unless the parsed block counts and palette match what was built.

## Samples

Three real Forge creations exported and verified with the CLI live in [docs/minecraft-export/samples](minecraft-export/samples):

| File | Source | Height | Size (x, y, z) | Blocks | Structures |
| --- | --- | --- | --- | --- | --- |
| `go_kart.mcpack` | prop, creation 36643bd7 | 48 | 102 x 48 x 105 | 37,395 | 4 tiles, `/function threews/go_kart` |
| `knight.mcpack` | character, creation 79cb2866 | 64 | 56 x 64 x 29 | 12,817 | `threews:knight` |
| `windmill.mcpack` | building, creation 329d94a8 | 64 | 54 x 64 x 61 | 17,335 | `threews:windmill` |

## How it works

| Step | File |
| --- | --- |
| Load the GLB, decode textures, keep UVs per vertex | `api/_lib/print/mesh-io.js` (`surface: true`) |
| Voxelize: dense surface sampling, outside flood fill, interior fill | `api/_lib/minecraft/voxelize.js` |
| Auto brightness, block matching, stats, preview payload | `api/_lib/minecraft/export.js`, `bedrock-palette.js` |
| Little-endian NBT | `api/_lib/minecraft/nbt-le.js` |
| `.mcstructure`, tiling, manifest, function, zip | `api/_lib/minecraft/mcstructure.js` |
| HTTP endpoint | `api/minecraft-export.js` |
| Forge panel with the instanced-cube preview | `src/forge-minecraft.js` |

The voxelizer samples every triangle on a lattice no coarser than half a block, which marks a watertight surface shell. It then flood-fills the empty space from the grid border; whatever the fill cannot reach is inside the model. Open meshes (a missing face) leak, so they come out hollow rather than wrongly filled.

Tests: `tests/minecraft-export.test.js` (NBT round trip through prismarine-nbt, closed-mesh fill, palette picks, texture sampling from a real GLB, tiling, auto brightness).
