# 360 Footage to 3D: Shoot, Upload, Own the Files

Turn footage from a 360 camera into 3D you keep: a Gaussian splat scene from a walkaround, a depth scene from one 360 photo, your own panorama as the light around an avatar, and an animation from a 360 clip of a person. This tutorial covers how to shoot so it works, which lane to use for which file, and what each error means.

It works with files from Insta360 X3, X4, X5 and X6 cameras, and with a stitched 360 export from any 360 camera. Insta360 is a trademark of its owner; three.ws is not affiliated with or endorsed by Insta360.

**What you'll do:**
- Shoot a walkaround that reconstructs cleanly
- Pick the right lane for the file you have
- Get a splat scene, a depth scene, an environment, or an animation
- Fix the common failures

**Prerequisites:** A 360 camera and its files. A free three.ws account for the upload lanes. A desktop browser is easiest for large files.

**Status:** the 360 lanes are rolling out one at a time. The [landing page](/insta360) marks each lane as live or rolling out, and its file checker tells you today which lane a file belongs to.

---

## Step 1: Check what you have

Drop your file into **Check your file** on [/insta360](/insta360). It reads the file on your device (nothing is uploaded) and tells you what it is:

| File | What it is | Lane |
|---|---|---|
| `.insv` | Raw, unstitched 360 video from the camera | Splat scene, or motion capture |
| `.insp` | Raw 360 photo | Depth scene, or environment |
| `.lrv` | Low-resolution proxy the camera writes beside each `.insv` | Use the `.insv` instead |
| 2:1 MP4 or MOV (for example 5760 x 2880, 7680 x 3840) | Stitched 360 video from Insta360 Studio, the phone app, or any 360 camera | Splat scene, or motion capture |
| 2:1 JPEG or PNG | Stitched 360 photo | Depth scene, or environment |
| `.exr` | HDR panorama | Environment |
| Any other aspect ratio | A regular flat video or photo | [Scene Capture](/capture), [Video to Motion](/video-to-motion), [Image to 3D](/image-to-3d) |

You do not need to stitch raw files first. If you already exported a stitched file, that works too.

X3 and older models write one `.insv` per lens, named with `_00_` and `_10_`. Add both files of the pair together.

---

## Step 2: Shoot so it works

These matter most for the splat lane, where the scene is rebuilt from many viewpoints.

1. **Walk slowly.** A slow, even pace keeps neighbouring frames overlapping and sharp.
2. **Hold the camera above your head on a stick.** You take up less of the frame, and the view clears tables and chairs.
3. **Loop back to where you started.** A closed path lets the scene line up end to end.
4. **Record 30 seconds to 3 minutes.** Shorter clips see too little; longer clips take longer to process without adding much.
5. **Avoid mirrors, glass and moving crowds.** Reflections, see-through surfaces and people walking past confuse the reconstruction.
6. **Pick soft, even light.** Overcast daylight or diffuse indoor light beats hard sun and deep shadows.
7. **Lock exposure in the camera app.** Brightness that shifts as you turn reads as a changing scene.
8. **Shoot at the highest resolution.** More pixels per view means a sharper splat.
9. **Keep the raw `.insv`.** It carries the lens calibration and the motion data. Upload the original file, not a re-encode or a social-media export.

---

## Step 3: Walk around, get a splat

1. Open [Scene Capture](/capture) and switch to its 360 mode.
2. Add your `.insv` (both files for a split pair) or a stitched 360 MP4. Large files upload in resumable parts; you can trim the start and end before you send.
3. Pick a quality. Preview is fastest; standard and high train longer for more detail.
4. While it runs you see each stage: download, stitch, frames, camera solve, training, export.
5. When it finishes, the scene opens in the [splat viewer](/splat). Download it as **PLY** (the standard Gaussian splat file most tools read) or **SPZ** (a compressed splat, much smaller), plus an **MP4** flythrough and a poster frame.

What happens underneath: each 360 frame is split into overlapping perspective views, the camera path is solved across all of them, and a Gaussian splat is trained on a GPU.

---

## Step 4: Step inside one photo

1. Open [Pano Scene](/pano-scene).
2. Add a raw `.insp` or a stitched 360 JPEG.
3. Depth is estimated across the whole sphere, in metres, and the photo becomes a shell around you with the seams closed.
4. Look around, then download the **GLB** (a textured mesh) or the **PLY** (a point cloud).

---

## Step 5: Your 360 photo as your avatar's world

1. Open a model in the [viewer](/app), or a splat in the [splat viewer](/splat).
2. In the environment control, choose your own 360 photo (a JPEG, PNG or EXR).
3. The model is lit by your panorama and reflects it, so it sits in the place you shot.

An EXR (HDR) panorama gives the most realistic light. A JPEG works as a backdrop and gives softer lighting.

---

## Step 6: 360 motion capture

A 360 camera films you from every side, so you never step out of frame.

1. Open [Video to Motion](/video-to-motion) and switch to its 360 mode.
2. Add a stitched 360 clip of the person. If several people are in the shot, click the one to follow.
3. The person is tracked across the sphere and reframed into a normal view, and the pose is read from that view.
4. Download the motion as **GLB**, **BVH** or **FBX**, preview it on your own avatar, or use it in [Motion Swap](/motion-swap).

---

## Step 7: From your editor, an agent, or a script

- **Blender:** the three.ws extension is in review on Blender Extensions. Install it from source with the steps in [integrations/blender](https://github.com/nirholas/three.ws/tree/main/integrations/blender#install-from-source); the 360 capture panel and splat import are being added.
- **Premiere Pro:** a panel that sends a timeline clip to the splat lane is in progress in [integrations/premiere-uxp](https://github.com/nirholas/three.ws/tree/main/integrations/premiere-uxp).
- **Agents:** the same lanes are tools on the three.ws MCP server. See the [MCP docs](/docs/mcp).
- **Scripts:** the three-ws CLI calls the same lanes from a terminal. See the [CLI docs](/docs/cli).

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `too_few_registered` | The camera path could only be solved for too few of the views (under 60 percent). The footage did not overlap enough. | Reshoot slower, keep the camera above your head, loop back to the start, and avoid long stretches of blank walls, glass or mirrors. |
| `unsupported_camera` | The raw file came from a camera model whose lens layout is not read yet. | Export a stitched 360 MP4 or JPEG from your camera's desktop or phone app and upload that instead. Stitched files from any camera work. |
| Quality failure (the scene trained but scored below the quality floor) | The splat could not reproduce the views it held back for checking, usually because of motion blur, changing exposure or moving people. | Lock exposure, shoot in soft light, walk slower, and pick a time with fewer people. Then try again at standard or high quality. |
| The file checker says "size unreadable here" | Your browser cannot decode the codec (often H.265). This affects only the check. | Upload anyway, or confirm in your camera app that the export is 2:1. |
| A player shows only one lens of your `.insv` | Raw files hold the two lenses as separate tracks. | Expected. Upload the file as it is; it is stitched on three.ws. |
| An upload stopped partway | A large file lost its connection. | Add the same file again: uploads resume from the last finished part. |

---

## Camera support

"Should work" means the format is supported by design but that camera's real footage has not yet been run end to end. Rows move to "Verified" as each one is.

| Camera | Stitched 360 export (MP4, JPG) | Raw files (`.insv`, `.insp`) |
|---|---|---|
| Insta360 X6 | Should work, not yet verified | Should work, not yet verified |
| Insta360 X5 | Should work, not yet verified | Should work, not yet verified |
| Insta360 X4 | Should work, not yet verified | Should work, not yet verified |
| Insta360 X3 | Should work, not yet verified | Should work, not yet verified (two files per clip: add both) |
| Older Insta360 360 models | Should work, not yet verified | Not yet verified: export a stitched file to be safe |
| Any other 360 camera | Should work, not yet verified | Use the stitched export |
| Action cams (flat video) | Regular video: use [Scene Capture](/capture) and [Video to Motion](/video-to-motion) as they are | Not applicable |

---

## What you get, and how it differs from the camera app

Insta360's own app builds scenes on the phone with its Spatial Capture feature. three.ws is a second path for the same footage:

- You download the files: **PLY**, **SPZ**, **GLB** and an **MP4** flythrough.
- There is no per-app monthly limit on how many scenes you make.
- It accepts raw files from X3 to X6 and a stitched export from any 360 camera.
- A scene can become a place on three.ws: open it in the splat viewer, light an avatar with it, or build it into a world.

**Next:** [Turn 360 footage into 3D you own](/insta360) · [Splat viewer](/splat) · [Video to Motion](/video-to-motion)
