# SimReady assets (NVIDIA)

NVIDIA's [SimReady assets](https://huggingface.co/datasets/nvidia/simready-assets) are a few thousand simulation-ready props (industrial, hospital, residential, lighting, OEM equipment) published as OpenUSD under **CC BY 4.0**. three.ws converts every asset to a web GLB and serves them from the [object library](./object-library.md) and the asset catalog (`GET /api/catalog`, `search_catalog`, `npx @three-ws/assets add`), with the credit line attached to every entry.

## Licensing

CC BY 4.0: free for commercial use with attribution. Each entry in the catalog carries `license: "CC-BY-4.0"` and `attribution: "NVIDIA SimReady Assets, CC BY 4.0, https://huggingface.co/datasets/nvidia/simready-assets"`. Show that line wherever you use the model. The GLBs are modified derivatives (converted from USD, textures downsized, geometry decimated to at most 80,000 triangles); CC BY requires saying so, and the originals are linked from the credit.

## How an asset is converted

1. [scripts/ingest-simready.py](../scripts/ingest-simready.py) lists the dataset through the Hugging Face API and, per asset, downloads only the USD layers and the textures the materials reference (never the `.thumbs` or `source_assets` copies, which would triple the transfer).
2. [scripts/simready-to-glb.py](../scripts/simready-to-glb.py) opens the root USD with instance proxies, bakes every visible mesh into world space (Z-up to Y-up, meters), triangulates, splits face-varying normals and UVs into glTF vertices, maps each material to glTF PBR (albedo, ORM packed as occlusion + metallic-roughness, tangent-space normal), bakes the `UsdTransform2d` tiling into the UVs, and writes 1024px JPEG textures.
3. [scripts/slim-glb.mjs](../scripts/slim-glb.mjs) brings the GLB under a triangle budget (default 80,000) with meshopt simplification. The output stays plain glTF 2.0, so a bare `GLTFLoader` or `<model-viewer>` loads it.
4. The dataset's own thumbnail becomes a 512px WebP poster.
5. The entry lands in `public/objects/simready/catalog.json` (same schema as the Poly Haven catalog, plus `triangles`, `materials`, `size_m`, `attribution`). The run is resumable: finished assets are skipped, `--retry-failed` retries the rest.

```bash
pip install usd-core numpy Pillow pygltflib
python3 scripts/ingest-simready.py --workers 12          # GLBs and posters into ~/simready-out
node scripts/publish-simready.mjs --dry-run              # then without --dry-run to upload to R2
node scripts/build-object-library.mjs                    # publish the manifest the API serves
```

Physics payloads (PhysX, MuJoCo, Newton variants) are not carried into the GLB; it is a visual asset. Use the original USD from the dataset for simulation.

## Related

- [Object library](./object-library.md)
- [3D asset pipeline](./3d-asset-pipeline.md)
