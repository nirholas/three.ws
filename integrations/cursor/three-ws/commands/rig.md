---
name: rig
description: Auto-rig a humanoid GLB into an animation-ready model with three.ws and print the rigged GLB and pose-studio links
---

# Rig a model

Rig the model at the URL the user typed after this command, so it can be posed and
animated.

1. **Check the input.** It must be one public `https://` URL ending in `.glb` (a query
   string after it is fine). If it is missing or is not such a URL, ask the user for the
   GLB URL in one short line and stop. A local file path will not work: the model has to
   be reachable on the web, for example a URL `/make-3d` returned.
2. **Check it is a humanoid.** Call the three-ws `look_at_model` tool on the URL with
   `views` `["front", "side"]`. Rigging adds a humanoid skeleton, so if the render shows
   something without a head, two arms and two legs (a chair, a car, a quadruped), tell
   the user rigging will not give a usable result and stop unless they confirm. If
   `look_at_model` cannot load the URL, show its message and stop.
3. **Rig it.** Call `rig_mesh` with `glb_url` set to the URL and `idempotency_key` set to
   a short unique string you choose now. Reuse the key on any retry.
4. **Wait for it.** If the result is `status: "pending"`, call `get_job` with its
   `job_id`, waiting the `eta_seconds` it reports (15 seconds when none) between calls.
   Stop after 10 minutes and give the user the job id.
5. **Print the result** as a short block the user can copy:

   ```
   Rigged GLB:   <glb_url>
   Pose studio:  https://three.ws/pose?src=<glb_url, URL-encoded>
   Viewer:       <viewer_url>
   ```

   Then print the `embed_html` the job returned in an `html` code block, unchanged, and
   mention that `/embed <rigged GLB>` gives an animated `<agent-3d>` embed.

## When something goes wrong

- `sign_in_required`: rigging needs a free three.ws account. Tell the user to open
  **Customize** in the Cursor sidebar, find the `three-ws` server and sign in, then run
  the command again.
- `failed`: show the reason and the next step the job gives. The most common cause is a
  mesh that is not a single standing humanoid.
