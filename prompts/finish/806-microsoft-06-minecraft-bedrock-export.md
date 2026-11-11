# microsoft 06: export any Forge model as a Minecraft: Bedrock Edition structure pack

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3106.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

"Type a prompt, get it built in your Minecraft world" is the most shareable thing a 3D generator can do for a young audience, and Minecraft is Microsoft's. Bedrock Edition runs on Windows, Xbox, mobile and consoles and loads add-on packs by double-click. A voxelized export that drops a generated dragon, castle or statue into a world through a structure block is a viral loop with a Microsoft ecosystem story, built entirely on our own code.

## Step 0: re-derive the current state

    grep -rn -i "voxel\|minecraft\|mcstructure\|schem" src api packages workers --include=*.js --include=*.py | head
    grep -rn -i "export" src/forge*.js | grep -i -E "glb|usdz|fbx|stl" | head -20
    ls packages/glb-tools/src 2>/dev/null

Read the current Bedrock documentation on learn.microsoft.com for the `.mcstructure` format (little-endian NBT: `format_version`, `size`, `structure.block_indices`, `palette.default.block_palette`, `structure_world_origin`), behavior pack layout (`manifest.json` with UUIDs and `min_engine_version`), and `.mcpack`/`.mcaddon` packaging. Read the Minecraft Usage Guidelines and follow them: nominative use only, never "Minecraft" in a three.ws product name, and the required "not an official Minecraft product" notice.

## Tasks

1. **Voxelizer.** Given a GLB and a target height in blocks (16 to 128), produce a solid or shell voxel grid: surface voxelization with a scanline or parity fill for the interior, colour sampled from the base colour texture at each voxel's surface point. Runs server-side in a worker or API handler with a size and time cap.
2. **Palette match.** A data table of Bedrock block ids with representative RGB values for solid full-cube blocks only (concrete, wool, terracotta and glazed variants, planks, stone family and similar), authored as plain facts (id plus colour), never copied texture files. Match in a perceptual colour space (CIELAB) with optional dithering. Let the user restrict the palette (for example "concrete only").
3. **Writer.** A little-endian NBT writer (your own, or a permissively licensed library after checking its LICENSE) producing a valid `.mcstructure`, wrapped in a behavior pack with a generated `manifest.json` and packaged as `.mcpack`. Loading instructions: place a structure block, load `threews:<name>`.
4. **Preview and button.** A "Minecraft: Bedrock" item in the Forge export menu opens a panel with a live voxel preview (instanced cubes in the existing three.js viewer), height slider, palette choice, block count, and the download. Loading, empty and error states designed.
5. **Docs.** `docs/minecraft-export.md` with the how-to, limits and the usage-guidelines notice; STRUCTURE.md row; changelog entry.

## Definition of done

- [ ] Test-first unit tests: NBT writer round-trips through an independent parser (for example `prismarine-nbt`, MIT, as a dev dependency) with correct types and little-endian layout; voxelizer fills a closed test mesh correctly; palette matching picks expected blocks for known colours.
- [ ] Three real production creations (a prop, a character, a building) export to `.mcpack` files that parse back with the expected size, palette and block counts; paths listed in the report.
- [ ] The preview panel works in a browser on port 3106 with no console errors; every control has hover, active and focus states.
- [ ] Docs, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Minecraft install to test loading | Verify by independent parse, then put "import the attached .mcpack and load the structure" in the owner message with the file paths. |
| Large models exceed structure limits | Enforce Bedrock's structure size limit from the docs and split into tiles with a note, or cap the height. |
| Texture missing on a model | Fall back to vertex colours, then material base colour; say which in the panel. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
