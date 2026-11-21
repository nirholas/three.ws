# 360 footage to 3D: launch drafts

Drafts only. The owner posts them (order 347 owns the owner message). Do not post until the live checks in `prompts/finish/347-*.md` pass and a real result is attached. Replace each `[RESULT]` marker with a real splat flythrough produced by the lane, and never use stock or generated imagery.

Wording rules: Insta360 is named only to say which files work. No partnership claim, no logo. Say "any 360 camera" where it is camera-agnostic. Never disparage Spatial Capture. No coin or price talk.

## X thread

1. You can turn a 360 walkaround into a Gaussian splat you own. Upload the file, get a PLY and SPZ back, plus a flythrough video. Works with Insta360 X3, X4, X5 and X6 files, and any 360 camera. three.ws/insta360 [RESULT: flythrough mp4]
2. How it works: your 360 video is stitched, each frame is cut into perspective views, the camera path is solved, and a splat is trained on it. You see each stage as it runs.
3. What you get is files: PLY for splat tools and Blender add-ons, SPZ for the web, MP4 flythrough. No monthly scene cap. Older cameras and other brands work too.
4. The shooting rules that matter: walk slowly, camera on a stick above head height, loop back to the start, 30 seconds to 3 minutes, avoid mirrors, glass and crowds, overcast light, lock exposure, upload the raw file.
5. One photo instead of a walk? Drop a 360 photo on /pano-scene and stand inside it as a 3D room. Or use it as your avatar's world, or capture motion from a 360 clip.
6. Tutorial with troubleshooting for every error code: three.ws/tutorials/insta360-to-3d

## Reddit: r/Insta360

Read the subreddit rules on the day of posting (old.reddit.com/r/Insta360/about/rules) and quote the self-promotion rule here before posting: `[QUOTE RULE ON THE DAY]`. If the rule requires a mod pre-approval or a participation ratio, do that first. Do not post if it forbids tool links.

Title: I made a free way to turn 360 walkaround footage into a splat you can download (works with X3 to X6 files)

Body: I built this because I wanted the actual file, not just a view in an app. Upload a raw .insv or a stitched equirect video and you get a Gaussian splat as PLY and SPZ, plus a flythrough MP4. Shooting guide and error-code troubleshooting are in the tutorial: three.ws/tutorials/insta360-to-3d. I am the maker, and I would like to hear which cameras and clip lengths fail for you. [RESULT: flythrough gif or mp4]

## Reddit: r/GaussianSplatting

Read the rules on the day (old.reddit.com/r/GaussianSplatting/about/rules), quote the self-promotion rule here: `[QUOTE RULE ON THE DAY]`. Lead with the technical content, not the product.

Title: 360 walkaround to 3DGS without a rig: equirect to perspective views, SfM, training, with PLY and SPZ out

Body: Pipeline: equirect frames are cut into perspective views, a COLMAP-style solve gives the camera path, then a splat is trained and exported as standard PLY and SPZ. Loop closure matters, so the guide says to end where you start. I am the maker. Tutorial and the shooting rules: three.ws/tutorials/insta360-to-3d. Feedback on failure cases welcome. [RESULT: flythrough]

## Demo video script (45 seconds)

1. 0:00 to 0:05, on camera outdoors with a 360 camera on a stick: "One walk, one splat."
2. 0:05 to 0:15, screen recording of /capture: drop the file, trim, choose standard, submit. [RESULT: real recording]
3. 0:15 to 0:30, the stage list advancing, then the scene opening in /splat. [RESULT]
4. 0:30 to 0:40, download buttons: PLY, SPZ, MP4. Caption: "You get the files."
5. 0:40 to 0:45, end card: three.ws/insta360. Caption: "Works with Insta360 X3, X4, X5 and X6 files, and any 360 camera."
