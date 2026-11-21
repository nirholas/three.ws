# Video to Motion: turn any video into an animation file

**Page:** [/video-to-motion](https://three.ws/video-to-motion) · **API:** reuses `POST /api/motion-swap` for capture, `POST /api/avatar/presign-glb` + `POST /api/forge-remesh` for FBX export · **Worker:** `workers/model-video2motion`

Upload a video of someone moving and get the motion itself back, not a
composited video: a GLB, a BVH, and an FBX if your browser can build one.
Built for animators, VTubers, and anyone whose online markerless mocap
service closed and who still has footage to turn into a usable clip. If you
want a video with your avatar performing the motion instead, see
[/motion-swap](https://three.ws/motion-swap).

## How to use it

1. Open [/video-to-motion](https://three.ws/video-to-motion) and drop in a
   video (MP4, MOV, or WebM, up to 256 MB; the first 90 seconds are
   processed). One person, full body in frame, tracks best.
2. Wait for capture (about two minutes for a 30-second clip; the same
   worker and timing as Motion Swap). The server tracks pose in every frame.
3. Preview the motion on a stock avatar, or load your own rigged humanoid
   GLB by URL or file upload. The clip retargets onto whatever rig is
   loaded, right in your browser.
4. Trim the in/out points with the two sliders under the preview.
5. Download: **GLB** carries the clip baked onto the avatar you previewed
   on. **BVH** carries it on the platform's own canonical-skeleton
   proportions, the standard shape to re-retarget in a DCC tool (Blender,
   MotionBuilder, Unreal's IK Retargeter). **FBX** is a server-side
   conversion that preserves the rig; it can take up to a minute.
6. Signed in? **Save clip** attaches it to one of your agents' animation
   libraries, the same store [/animations](https://three.ws/animations)
   reads from.

## How it works

1. **Capture (server, shared with Motion Swap).** MediaPipe
   PoseLandmarker, HandLandmarker, and ImageSegmenter track the subject and
   solve the landmarks onto the canonical Wolf3D skeleton
   (`workers/model-video2motion/pose_solver.py`), emitting a standard
   three.js `AnimationClip.toJSON()` document: the same clip format the
   [animation library](https://three.ws/animations) and Motion Swap use.
2. **Preview and trim (browser).** [src/animation-retarget.js](../src/animation-retarget.js)
   binds the clip onto whichever avatar is loaded (`retargetClipToObject`),
   renaming non-canonical bone names first via
   [src/glb-canonicalize.js](../src/glb-canonicalize.js) so Mixamo, Avaturn,
   VRM, Daz, and MakeHuman rigs all work. Trimming (`trimClip`) re-samples
   track boundaries through each track's own interpolant, so a cut between
   keyframes still starts and ends on the right pose.
3. **Export (browser + one server hop for FBX).** GLB is written with
   three.js's own `GLTFExporter` against the previewed avatar's scene
   graph. BVH is written by [src/animation-bvh-export.js](../src/animation-bvh-export.js)
   directly from the canonical-skeleton clip, independent of whichever
   avatar is on screen, using the same rest offsets
   [src/animation-retarget.js](../src/animation-retarget.js) binds clips
   against. FBX has no browser-side writer available under a permissive
   license, so the exported GLB is uploaded under the signed-in account through
   `POST /api/avatar/presign-glb` (an anonymous visitor is asked to sign in first) (a public URL is required because the
   converter fetches the source itself, SSRF-guarded) and converted
   server-side by the Blender-based exporter behind
   `POST /api/forge-remesh` (`operation: "convert"`,
   `output_format: "fbx"`), the same converter the Forge export menu uses.

## 360 clips: click the person

Both [/video-to-motion](https://three.ws/video-to-motion) and
[/motion-swap](https://three.ws/motion-swap) accept a stitched 360 clip from any
360 camera (Insta360, Ricoh Theta, GoPro Max, and so on). Drop an equirectangular
MP4, MOV, or WebM and the page reads the container's track size without decoding
it. A 2:1 frame switches the page into 360 mode with a **360 clip** badge.
Not a 360 clip after all? **This is a regular video** hands the file back to the
normal capture path.

1. A sphere preview opens. Drag to look around (arrow keys when it has focus),
   scrub the clip, then click the person to follow. A ring marks the spot and the
   readout names the yaw and pitch it sends.
2. **Track the person I picked** sends the pick. **Pick for me** sends no subject
   and the worker chooses.
3. When the worker also returns a `reframe_url`, a **What the tracker followed**
   panel plays that flat view beside the avatar, synced to the same timeline. A
   worker that does not return one just leaves the panel hidden.

Raw `.insv`, `.insp`, and `.lrv` files are not stitched, so motion cannot read
them. The page says so and points to exporting a 360 MP4 from Insta360 Studio or
the camera app. For a 3D scene from raw files use [/capture](https://three.ws/capture).

### Request fields

On `POST /api/motion-swap` (the job request) the pages add:

```json
{ "projection": "equirect", "subject": { "yaw_deg": 34.5, "pitch_deg": -28.1, "t_s": 0 } }
```

- `yaw_deg` is -180 to 180. 0 is the frame centre and it grows to the right.
- `pitch_deg` is -90 to 90. 0 is the horizon and it grows upward.
- Pixel mapping: `yaw = (x / W - 0.5) * 360`, `pitch = (0.5 - y / H) * 180`.
  This is the same convention as ffmpeg's `v360` filter, so
  `v360=e:flat:yaw=<yaw>:pitch=<pitch>` centres the clicked person.
- `t_s` is the clip time of the click, so a person picked at a scrubbed position
  is found at that time. Workers that do not know it ignore it.
- `subject` is omitted for **Pick for me**. A regular video sends neither field.

The result may carry `reframe_url` and `subject_track`. A failure with
`error_code` `subject_lost` or `subject_not_found` shows **We lost track of the
person** with the worker's own message and a one-click way back to the picker.

### Limits

Uploads are capped at 256 MB on both pages, the same as the worker's
`MAX_VIDEO_BYTES`. A 3840 x 1920 export is plenty for tracking a person; a
longer or higher-resolution clip should be trimmed or exported smaller. The
logic lives in [src/motion-360.js](../src/motion-360.js) and is covered by
[tests/motion-360.test.js](../tests/motion-360.test.js).

## Why BVH is on the canonical skeleton, not the previewed avatar

A BVH carries no mesh, only a skeleton and its motion. Mixamo's own BVH
downloads use Mixamo's fixed skeleton proportions regardless of which
character you previewed the clip on, because a BVH is meant to be
re-retargeted in your own DCC tool rather than played back as-is. This page
follows the same convention: the BVH always uses the platform's canonical
rest pose, so it stays stable across avatar choices and matches what every
other BVH-producing pipeline on three.ws already does.

## Related

- [/motion-swap](https://three.ws/motion-swap): the same capture, composited back into the source video instead of exported as a file
- [/animations](https://three.ws/animations): the clip library a saved capture lands in
- [/mocap-studio](https://three.ws/mocap-studio): live face and body mocap, not from a video file
- [docs/motion-swap.md](motion-swap.md) · [docs/animations.md](animations.md)
