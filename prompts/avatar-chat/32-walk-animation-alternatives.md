# 32 — Walk animation review: is strafe-left the right clip?

## Status
Design question — the current walk clip is "Walk Strafe Left.fbx" which is a lateral strafe movement (sliding sideways). On screen, with the avatar facing the camera, this makes the avatar appear to shimmy sideways. For the "walking in place while talking" effect, a forward walk or in-place bob may look more natural.

## What to evaluate

### Current clip
- Source: `Walk Strafe Left.fbx` → `walk.json`
- Motion: lateral strafe (avatar moves sideways relative to their facing direction)
- On-screen look: since the avatar faces the camera, strafe = horizontal body sway

### Alternative clips to consider building

From the available FBX files in `/workspaces/3D-Agent/public/animations/`:
- Check if there's a forward walk FBX (there currently isn't in the directory listing)
- `Stepping Backward.fbx` — walking backward, might look like awkward retreat
- `Cover To Stand.fbx` — a tactical crouch-to-stand, probably not right

### Recommendation

The strafe walk actually works well for "in-place walking while talking" because:
1. The avatar doesn't move forward into or away from the camera
2. The upper body sway and leg movement read as "active" and "thinking"
3. It's self-contained — the avatar doesn't drift in space

**However**, test it visually with the actual avatar model in the inline layout before finalizing. If the strafe creates an odd visual (avatar appears to shuffle awkwardly), consider two alternatives:

**Alternative A — Use the idle animation with empathy layer**
The idle animation already has breathing and weight-shift. Instead of walking, just let the empathy layer's `patience` weight increase (which adds hip sway and subtle bobbing). This is "free" — no animation change needed.

**Alternative B — Download a proper in-place walk**
Add a Mixamo "Walking In Place" animation (different from strafe walk). If Mixamo has it, download the FBX, add to `animations.config.json` as `name: "walk_inplace"`, and rebuild with `npm run build:animations`.

## Action required

1. Load the app, send a message, observe the avatar walking.
2. If strafe walk looks fine → no action needed, mark resolved.
3. If it looks awkward → implement Alternative A (simplest) or Alternative B.

Document the decision here and close this prompt.
