# apps/

Standalone desktop, in-car and headquarters applications. Each one is its own package with its own `package.json`, build and README; none is part of the root Vite bundle.

| Directory | What it is |
|---|---|
| [desktop/](desktop/README.md) | The three.ws agent console for macOS, Windows and Linux (Electron): chat with agents, follow runs, approve spend, keep the 3D companion on the desktop. |
| [forge-desktop/](forge-desktop/README.md) | three.ws Forge: local and cloud image-to-3D generation, node workflows and publishing. |
| [head-unit/](head-unit/README.md) | Open head unit: a projected CarPlay or Android Auto session beside the `/drive` agent on a Raspberry Pi or any Linux box with a Carlinkit CPC200 dongle. |
| [hq/](hq/README.md) | three.ws HQ: a real-time DeFi and crypto market intelligence dashboard (3D globe, live data panels, AI analysis) that runs as a web app or PWA. |

Each app installs and builds on its own. Run commands from inside the app directory (`npm install`, then the scripts listed in its `package.json`).
