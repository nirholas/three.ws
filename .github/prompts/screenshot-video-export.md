---
mode: agent
description: "Add screenshot/video export with PNG capture and animated WebM recording"
---

# Screenshot & Video Export

## Context

The README roadmap lists **"Screenshot / Video Export — capture PNGs or record animated WebM walkthroughs"**. The viewer already has a basic `takeScreenshot()` method that captures a single PNG. This prompt expands it into a full export system.

## Current State

`src/viewer.js` has `takeScreenshot()` bound to the `P` key and a GUI button. It works but is minimal.

## Implementation

### 1. Enhanced Screenshot (`src/export.js`)

Improve the existing screenshot:
- **Resolution multiplier**: Capture at 2x, 4x native resolution for print-quality exports
- **Transparent background**: When `transparentBg` is enabled, export PNG with alpha channel
- **Custom dimensions**: Let user specify exact pixel dimensions (e.g., 1920×1080, 4096×4096)
- **Format options**: PNG (lossless + alpha), JPEG (smaller, configurable quality), WebP
- **Filename**: Auto-generate as `{modelName}_{timestamp}.{ext}`

### 2. Turntable Capture

Automated 360° turntable sequence:
- User clicks "Turntable" → auto-rotate enabled, captures N frames (e.g., 36 frames = 10° per frame)
- Exports as individual PNGs or animated GIF
- Progress bar during capture

### 3. Video Recording

Record the viewport as a video:
- Use `MediaRecorder` API with `canvas.captureStream()`
- Controls: Record / Stop / Pause
- Output format: WebM (VP9) — native browser support, no dependencies
- Configurable FPS (24, 30, 60)
- Configurable duration or manual stop
- Auto-download on stop

### 4. Animated GIF Export

For short clips and turntables:
- Use a lightweight GIF encoder (e.g., `gif.js` or manual LZW)
- Capture N frames → encode → download
- Configurable dimensions (downscale for file size)
- Useful for sharing on platforms that don't support video

### 5. GUI Integration

Add an "Export" folder to dat.gui:

```
▸ Export
  Screenshot [P]     (button)
  Resolution         (dropdown: 1x, 2x, 4x)
  Format             (dropdown: PNG, JPEG, WebP)
  Background         (dropdown: Current, Transparent, White)
  ─────────────────
  Record Video        (button — toggles to Stop)
  Video FPS           (dropdown: 24, 30, 60)
  ─────────────────
  Turntable (36 frames) (button)
  Turntable Speed       (slider)
```

### 6. Sharing

After capture, show a toast/notification:
- "Screenshot saved: model_2026-04-14.png"
- Option to copy to clipboard (for screenshots, using `navigator.clipboard.write()`)

## File Structure

```
src/
├── export.js  # Screenshot, video recording, turntable, GIF
```

## Validation

- Screenshot at 4x resolution → produces sharp, high-res PNG
- Screenshot with transparent bg → PNG has alpha channel (verify in image editor)
- Record 5-second video → produces playable WebM file
- Turntable 36 frames → produces 36 PNGs or one animated sequence
- Works on Chrome, Firefox, Edge (MediaRecorder support varies)
