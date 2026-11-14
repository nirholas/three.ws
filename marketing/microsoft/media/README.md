# Microsoft listing media kit

Every image and video the Microsoft listings upload, captured from the live product by one command. The kit covers Microsoft Marketplace, the Microsoft Teams Store, the Microsoft Store (Windows app), Microsoft Edge Add-ons and the Visual Studio Marketplace.

```bash
npm run media:microsoft
```

Output:

| Path | What it is |
| --- | --- |
| `marketplace/`, `teams/`, `msstore/`, `edge/` | Store images at each slot's exact size, committed. |
| `video/three-ws-demo.en.srt`, `.vtt` | Captions for the demo video (SRT for YouTube and Vimeo, WebVTT for the Microsoft Store). |
| `video/narration.txt` | The voice-over script, line by line, timed to the captions. |
| `manifest.json` | Every asset with its size, bytes and sha256, plus the video's public URL, size and sha256. |

The video itself is not committed. It is uploaded to `gs://three-ws-desktop-releases/marketing/microsoft/<date>/` and played from its public `storage.googleapis.com` URL, which the manifest records. The run downloads that URL again, checks the sha256 and probes the stream before it writes the manifest.

The run also rewrites a generated block in each submission file, so every listing names its exact files:

- `marketing/growth/submissions/programs/microsoft-listing-media.md` (all stores)
- `marketing/growth/submissions/programs/microsoft-edge-and-store.md` (Edge, Microsoft Store)
- `marketing/growth/submissions/programs/microsoft-marketplace-professional-services.md` (Marketplace)
- `marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md` (Teams)

Never edit inside the `media:microsoft` markers. The next run overwrites them.

## What it captures

Playwright drives the production site (`--base` to point it elsewhere) in headless Chromium with software WebGL. No GPU is needed.

| Scene | How |
| --- | --- |
| `forge-composer` | `/forge` with the free NVIDIA lane selected and the prompt typed. |
| `forge-result` | The same page after a real generation. The run waits for the real result however long the free lane is queued, and records the time it took. |
| `viewer` | `/viewer` with the GLB that generation produced. |
| `agent` | The public page of the showcase agent. |
| `teams-tab` | `/microsoft/teams-tab`, the page the Teams app loads, showing the same agent. |
| `adaptive-card` | The agent's real card from `/api/glance/card?format=adaptive`, rendered by the Adaptive Cards SDK (3.0.4) with the official Microsoft Teams dark host config from the Adaptive Cards Designer. No Teams client chrome is drawn. |

Each scene is captured once as a master at 1280 x 720 CSS pixels and device scale 2 (2560 x 1440), then downscaled to every slot it fills. Every store image is therefore retina quality.

Rules every capture follows:

- **Showcase agent.** The listing-safe public agent with the most chats. Listing-safe means it has a 3D body, a real name (no "My First Agent", no probes), no crypto vocabulary in its name, description or skills, and is not styled on a character from someone else's film, show or game. The rule is `listingSafeAgent` in `scripts/lib/microsoft-listing-media.mjs`.
- **Teams tab directory.** In the capture, the tab's directory response is the real `/api/agents/public` response with non-listing-safe agents removed. Nothing is added or changed.
- **Overlays.** Floating UI that is not part of the screen being shown is hidden: the walk companion, onboarding chips, toasts and the sign-in bar. On forge, the token-holder note and tier lock are hidden, and the one-time first-creation confetti is skipped. On the agent page, the wallet row, the save prompt, the wallet presence card and the coin earnings section are hidden. In the video, overlays are hidden again on every motion frame, because the walk companion mounts after load.
- **Visible-text gate.** The visible text of every master, and of the first and last frame of every video segment, is checked against `BANNED_VISIBLE_TEXT`: $THREE, crypto vocabulary, onboarding counters, sign-in prompts and dev hosts. A match fails the run.
- **Still 3D.** Model viewers are frozen at a fixed camera before capture, so the shot is the same on every run.

Logos come from `public/pwa-512x512.png` (Marketplace and Microsoft Store tile) and `public/pwa-icon.svg` (Edge, matching the extension icon), flattened onto the brand background. The Edge promotional tiles are rendered from HTML with the real extension screenshot.

## The video

The video runs exactly 60 seconds at 1920 x 1080 and 30 fps: the Microsoft Store recommends 60 seconds or less for a trailer, and the same cut serves every listing. The end card holds for whatever time brings the cut to 60 seconds; if the segments before it run past 57 seconds the run stops and says which to shorten.

It is encoded to the Store's MP4 trailer spec (`TRAILER` and `trailerEncodeArgs` in `scripts/lib/microsoft-listing-media.mjs`):

- H.264 High, progressive, 4:2:0, CABAC
- 2 consecutive B-frames and a closed GOP of 15 frames (half the frame rate), with scene-cut keyframes off
- AAC-LC stereo at 48 kHz, 384 kbps nominal, and faststart

The audio track is silent, so the measured audio rate is a few kbps whatever the setting: silence leaves the encoder nothing to spend bits on.

After encoding, `trailerProblems` checks both cuts and the downloaded public copy against that spec. It reads the stream with ffprobe, reads the settings x264 writes into the stream, and lists every keyframe.

It is stepped frame by frame, not screen-recorded. Each motion frame is a screenshot taken after the camera, the animation clock or the typed prompt has advanced exactly 1/30 s. The motion is therefore smooth and identical on any machine.

Segments, in order:

1. Title card
2. Typing the prompt on forge
3. The real generate step, captioned with the measured time
4. Orbit of the result
5. The viewer
6. The agent page
7. The Teams tab
8. The Adaptive Card
9. The VS Code extension, from `packages/vscode-3d/images`
10. End card

Captions are written from the same timeline, so SRT, WebVTT, the burned-in variant and the narration script always agree. Two files are uploaded:

- `three-ws-demo-<sha>.mp4`: clean, for hosts that take caption files.
- `three-ws-demo-captioned-<sha>.mp4`: captions burned in.

No voice is recorded, because this workspace has no text-to-speech lane. To add a voice, record `narration.txt` against the clean cut.

The end card uses only the approved claim "three.ws is live on Microsoft Marketplace". No listing image or caption mentions a partner tier, a certification, $THREE or crypto.

## Requirements and sources

Read on 2026-11-11. The script copy is `STORES` in `scripts/lib/microsoft-listing-media.mjs`. Change a size there and rerun.

| Store | Requirement | Source |
| --- | --- | --- |
| Microsoft Marketplace (SaaS offer) | Screenshots: 1 to 5, PNG, 1280 x 720. Large logo: PNG, 216 to 350 px square. Videos: YouTube or Vimeo links, each with a 1280 x 720 PNG thumbnail. | <https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-listing> |
| Microsoft Teams Store | Screenshots: up to 5, PNG, JPEG or GIF, 1366 x 768, 1,024 KB maximum each. Video: YouTube or Vimeo link. Icons ship in the app package. | <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/submission-checklist> |
| Microsoft Store (Windows app) | Desktop screenshots: 1 to 10, PNG, 1366 x 768 up to 3840 x 2160, 50 MB maximum. 1:1 tile icon: 300 x 300. Trailer: MP4, H.264 and AAC, 1920 x 1080, under 2 GB, 60 s or less recommended, with a 1920 x 1080 thumbnail and optional WebVTT. | <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images> |
| Microsoft Edge Add-ons | Logo: 300 x 300 recommended, 128 x 128 minimum. Small tile 440 x 280. Large tile 1400 x 560. Screenshots: up to 6, 640 x 480 or 1280 x 800. Optional YouTube video. | <https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension> |
| Visual Studio Marketplace | Icon: PNG, 128 px or larger, not SVG. README images: https and not SVG. | <https://code.visualstudio.com/api/working-with-extensions/publishing-extension> |

Two image sets are produced by their own pipelines. The kit checks them against their slots and lists them in the manifest, without capturing them again:

- Edge screenshots, from `scripts/extension-screenshots.mjs` (the real extension on live sites)
- VS Code images, from `packages/vscode-3d/scripts/screenshots.mjs` (a real VS Code)

The run fails if any image misses its size, format, alpha rule or byte cap, or if any cut (clean, captioned or the public download) misses the trailer spec above or is not 60 seconds long.

## Flags

| Flag | Effect |
| --- | --- |
| `--base <url>` | Capture another deployment (default `https://three.ws`). |
| `--prompt <text>` | The forge prompt (default "a brass ship compass on a walnut stand"). |
| `--work <dir>` | Put the masters and video frames (several GB) in `<dir>` instead of `dist/microsoft-media/`, for a machine whose repository disk is short of space. |
| `--reuse` | Reuse the masters and video frames in the work directory from the last run. Use it to re-cut artwork or captions without driving the site. |
| `--skip-video` | Images only. The manifest keeps the earlier video. |
| `--skip-upload` | Build the video but keep the earlier upload. Fails if the new cut differs from it. |

Tooling:

- ffmpeg and ffprobe: from `PATH`, `~/.local/bin`, or the `FFMPEG` and `FFPROBE` variables. A static build from <https://johnvansickle.com/ffmpeg/> works.
- The upload uses `gcloud storage` with the active account.
- A full run takes about 30 to 60 minutes with software WebGL. Most of that is the roughly 800 stepped 3D frames.

## When to refresh

- After any visible change to forge, the viewer, agent pages or the Teams tab.
- When a store changes a requirement. Update `STORES` and the slot list first.
- When the showcase agent changes, which the run picks on its own.
- Before each listing submission or resubmission, so the screenshots match what reviewers will see.
- At least once a quarter.

After a run, review the images and commit `marketing/microsoft/media/` together with the updated submission files.
