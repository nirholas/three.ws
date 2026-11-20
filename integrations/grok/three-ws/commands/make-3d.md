---
description: Make a textured 3D model (GLB) from a sentence with three.ws, check it, and print paste-ready links and embed code
argument-hint: <what to model, e.g. a brass desk lamp>
---

# /make-3d

Make one 3D model from this description: $ARGUMENTS

If the description above is empty, ask the user what to model in one short line and stop.

1. **Try the free catalog first.** Call the three-ws `search_catalog` tool with `q` set to the two or three key nouns of the description and `limit` 3. If a result clearly matches what the user asked for (same object, not just the same category), show it as option A with its viewer link and ask whether to use it or generate a new one. Otherwise go straight to step 2 without asking.
2. **Generate.** Call `forge_free` with `prompt` set to the description (one object, its material and style; drop filler words) and `idempotency_key` set to a short unique string you choose now. Reuse the same key if you have to retry this call, so a retry never starts a second generation.
3. **Wait for it.** If the result says `status: "pending"`, call `get_job` with its `job_id`. Between calls, wait the `eta_seconds` it reports (15 seconds when it reports none). Tell the user the phase and progress once, not on every poll. Stop after 10 minutes and report the job id so the user can collect it later with `get_job`.
4. **Look at it.** Call `look_at_model` on the finished `glb_url` with views `three-quarter` and `back`. In one sentence, say what the render shows and whether it matches the request. If it is clearly wrong (missing part, fused shapes, wrong subject), say what is wrong and offer one `refine_model` pass; do not refine without the user's yes.
5. **Print the result** as a short block the user can copy:

   ```
   GLB:     <glb_url>
   Viewer:  <viewer_url>
   Poster:  <poster_png_url>
   ```

   Then print the `embed_html` the job returned in an `html` code block, unchanged.

## When something goes wrong

- `sign_in_required`: making a model needs a free three.ws account. Tell the user to type `/mcps`, select `three-ws` and press `i` to sign in (the page can create an account), then run `/make-3d` again. Catalog search works without signing in.
- `failed` from `get_job`: show the reason it gives and its suggested next step. Retry once with a new `idempotency_key` only if the reason says the failure was temporary.
- A rate-limit or quota answer: show the message as given, including when it resets. Do not loop.
