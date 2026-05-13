# Chromium Setup & Testing (Ubuntu 24.04)

## Step 1: Install Chromium libraries

```bash
sudo apt-get install -y libxkbcommon0
```

## Step 2: Test selectors against a live Space

```bash
npx tsx scripts/test-selectors.ts "https://x.com/i/spaces/1mxPaLwgRPdKN?s=20L"
```

## Step 3: Full DOM probe (if selectors fail)

```bash
npx tsx scripts/probe-space-dom.ts "https://x.com/i/spaces/LIVE_SPACE_URL"
```

Output goes to `/tmp/xspace-probe-*` (screenshots, buttons JSON, accessibility tree, raw HTML).

## What the test checks

| Phase | Selectors tested |
|-------|-----------------|
| Before join | `Start listening`, `SpaceJoinButton`, `Listen`, `Join` |
| After join | `SpaceDockExpanded`, `Request to speak`, `Unmute`, `Mute`, `Leave`, `Manage Space`, `React`, `Collapse`, `Picture-in-Picture` |
| Text fallback | `Start listening`, `Request to speak`, `Leave`, `Unmute`, `Mute` |

## All Chromium deps (if starting from scratch)

```bash
sudo apt-get update -qq
sudo apt-get install -y \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
  libgbm1 libgtk-3-0t64 libasound2t64 libnspr4 libnss3 \
  libxcomposite1 libxdamage1 libxrandr2 libxkbcommon0 \
  fonts-liberation xdg-utils
```





