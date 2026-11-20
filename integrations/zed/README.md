# three.ws for Zed

A Zed extension that adds the three.ws MCP context server to the Agent Panel. The Agent can then generate textured 3D models (GLB) on the free Forge lane, search the asset catalog, inspect avatars and read three.ws docs. Making or rigging a model needs a three.ws account (free): paste an API key from [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) into the `api_key` setting. Search and docs work without one.

The extension installs `@three-ws/mcp-server` from npm into the extension's own directory and runs it with Zed's bundled Node. It does not run anything on your machine except that server.

## Install (development)

1. Install Rust through rustup (Zed requires it to build dev extensions).
2. In Zed open the command palette, run `zed: install dev extension`, and pick this `integrations/zed` folder.
3. Open the Agent Panel settings, find "three.ws 3D Agent" under context servers, paste your three.ws API key into `api_key`, and enable it.
4. Ask the Agent: "Make a 3D model of a small wooden chair."

## Settings

```json
{
  "context_servers": {
    "three-ws": {
      "settings": {
        "api_key": "",
        "base_url": "",
        "payment_address": ""
      }
    }
  }
}
```

| Setting | Meaning |
| --- | --- |
| `api_key` | Your three.ws API key. Needed to make or rig a model. Becomes `THREE_WS_API_KEY`. |
| `base_url` | Optional. Use a self-hosted three.ws API instead of https://three.ws. Becomes `THREEWS_BASE_URL`. |
| `payment_address` | Optional. A Solana USDC address that receives payment if you operate the server for others. Becomes `MCP_SVM_PAYMENT_ADDRESS`. |

## Build

```bash
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
```

The build must finish with no error. Zed produces the final `extension.wasm` itself when you install the dev extension.

License: Apache-2.0.
