---
name: avatar-manifest-cli
description: Scaffold, validate, hash and preview three.ws on-chain avatar manifests with the three-ws-avatar CLI. Use when the user has a GLB, GLTF or VRM avatar and needs a spec-compliant manifest or an embed snippet.
---

# three-ws-avatar CLI

Package `@three-ws/avatar-cli`, binary `three-ws-avatar`. Runs offline against `@three-ws/avatar-schema`. No account or API key.

Run without installing: `npx @three-ws/avatar-cli --help`. Or `npm install -g @three-ws/avatar-cli`.

## Commands

- `init`: scaffold a manifest, validated before output.
  `three-ws-avatar init --owner <caip10|0xaddr> --name <string> --mesh <path> [--skeleton avaturn|mixamo|rpm|vrm-humanoid|custom] [--mesh-uri <https:// or ipfs://>] [--id <override>] [--out manifest.json]`
  - `--owner` is a CAIP-10 (`eip155:1:0x...`) or a bare `0x...` address (assumed `eip155:1`).
  - `--mesh` is a `.glb`, `.gltf` or `.vrm` file. SHA-256, size and format are computed.
  - `--skeleton` defaults to `avaturn`.
  - Without `--mesh-uri` the manifest points at a local `file://` path. Pass a public URL before sharing.
  - Without `--out` the JSON is printed to stdout.
- `validate <path>`: checks a manifest against the schema. Exit code 0 valid, 1 invalid. `--json` gives `{"valid":true,"path":"..."}` or an `errors` array.
- `hash <path>`: SHA-256 of any file as lowercase hex. `--json` gives `{path, sha256, bytes}`.
- `preview <path>`: prints the resolver URL (`https://three.ws/a/{id}`), an `<agent-3d>` snippet with its loader script, and an `<iframe>` snippet. `--viewer http://localhost:3000` targets a local viewer. `--json` gives `{id, resolverUrl, loader, element, iframe, meshUri, meshIsLocal, schemaVersion}`. It warns instead of printing a snippet when the mesh is still a local `file://` path.
- `--version`, `--help` / `-h`.

## Worked example

```bash
three-ws-avatar init --owner 0x742d35Cc6634C0532925a3b844Bc454e4438f44e \
  --name "Nicholas" --mesh ./avatar.glb --skeleton mixamo \
  --mesh-uri https://example.com/avatar.glb --out manifest.json
three-ws-avatar validate manifest.json
three-ws-avatar preview manifest.json
```

In CI, run `three-ws-avatar validate manifest.json` and fail the build on a non-zero exit.
