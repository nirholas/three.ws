# OpenAI Plugin Directory: every field, paste-ready

Each block is under the portal's silent limit. Do not edit them longer without re-running this script.

## MCP tab: tool justifications

### forge_free

**Read Only**  (101/200)
```
Runs a 3D generation and writes a new GLB file into our object storage, then returns that file's URL.
```

**Open World**  (136/200)
```
Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.
```

**Destructive**  (117/200)
```
Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.
```

### text_to_avatar

**Read Only**  (101/200)
```
Runs a 3D generation and writes a new GLB file into our object storage, then returns that file's URL.
```

**Open World**  (136/200)
```
Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.
```

**Destructive**  (117/200)
```
Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.
```

### mesh_forge

**Read Only**  (101/200)
```
Runs a 3D generation and writes a new GLB file into our object storage, then returns that file's URL.
```

**Open World**  (136/200)
```
Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.
```

**Destructive**  (117/200)
```
Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.
```

### rig_mesh

**Read Only**  (101/200)
```
Runs a 3D generation and writes a new GLB file into our object storage, then returns that file's URL.
```

**Open World**  (136/200)
```
Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.
```

**Destructive**  (117/200)
```
Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.
```

### forge_avatar

**Read Only**  (101/200)
```
Runs a 3D generation and writes a new GLB file into our object storage, then returns that file's URL.
```

**Open World**  (136/200)
```
Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.
```

**Destructive**  (117/200)
```
Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.
```

### refine_model

**Read Only**  (101/200)
```
Runs a 3D generation and writes a new GLB file into our object storage, then returns that file's URL.
```

**Open World**  (136/200)
```
Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.
```

**Destructive**  (117/200)
```
Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.
```

### check_job

**Read Only**  (144/200)
```
The first check that finds a job finished copies the model into our storage and records the creation, so the call writes rather than only reads.
```

**Open World**  (129/200)
```
Collects work from third-party inference providers and publishes the finished GLB at a public URL anyone with the link can fetch.
```

**Destructive**  ( 76/200)
```
Only adds the finished model and never deletes or overwrites an earlier one.
```

### look_at_model

**Read Only**  (127/200)
```
Renders a model that already exists from several angles and returns the frames as images, storing nothing and changing nothing.
```

**Open World**  ( 92/200)
```
Fetches an arbitrary public GLB URL, so it reaches third-party hosts outside our own domain.
```

**Destructive**  ( 99/200)
```
Only reads the supplied model in order to render it, and never modifies or deletes the source file.
```

### create_agent_persona

**Read Only**  (109/200)
```
Saves a new persona record and copies the model into our durable storage so the body outlives the source URL.
```

**Open World**  (136/200)
```
Fetches the GLB from a public URL outside our domain and republishes it from our storage at a public URL anyone with the link can fetch.
```

**Destructive**  ( 86/200)
```
Only creates a new persona and never modifies or deletes an existing persona or model.
```

### get_agent_persona

**Read Only**  (115/200)
```
Looks up a stored persona by its id and returns that persona's configuration without creating or changing anything.
```

**Open World**  ( 89/200)
```
Reads only persona records held in our own private store and contacts no external system.
```

**Destructive**  ( 65/200)
```
Only reads a persona record and never writes or removes anything.
```

### persona_say

**Read Only**  (106/200)
```
Increments the persona's turn counter in our own store while returning the render directive for this turn.
```

**Open World**  (111/200)
```
Acts only on a persona in our own private store and renders through our own embed, reaching no external system.
```

**Destructive**  (110/200)
```
Only appends a turn and updates a counter, never deleting or overwriting the persona's configuration or model.
```

## MCP tab: Frame Domains  (199/200)

```
The persona tools render a live WebGL avatar that lip-syncs its reply. It is framed from https://three.ws, our verified domain and the same origin as this connector. No third-party content is framed.
```

## Testing tab: test cases

### Test Case 1

**Scenario**
```
Generate a 3D prop from a text description
```

**User prompt**
```
Make a 3D model of a friendly round robot mascot, glossy white plastic.
```

**Tool triggered**
```
forge_free, then check_job if the first response returns status "pending"
```

**Expected output**  (268/300)
```
An inline interactive 3D viewer with the textured model, plus Download, Spin, Recenter and Open in three.ws. It auto-rotates until dragged. Free, no account. Takes one to four minutes; past the inline wait it returns a job_id and check_job collects the finished model.
```

### Test Case 2

**Scenario**
```
Generate a rigged, animation-ready character
```

**User prompt**
```
Make a rigged, animation-ready knight character I can pose.
```

**Tool triggered**
```
forge_avatar, then check_job if it returns status "pending", then rig_mesh if the finished job was only the mesh
```

**Expected output**  (257/300)
```
A GLB in the inline viewer with a humanoid skeleton and skin weights applied, so it can be posed. One call normally does mesh and rig; if it times out at the mesh stage the pending result says to finish with rig_mesh. A humanoid rig also plays an idle clip.
```

### Test Case 3

**Scenario**
```
Iterate on a model by describing the change in words
```

**User prompt**
```
Now make that robot's shell matte instead of glossy.
```

**Tool triggered**
```
refine_model, then check_job if it returns status "pending"
```

**Expected output**  (256/300)
```
Run immediately after test case 1, in the same conversation. Returns a new version anchored to the previous model rather than an unrelated regeneration, and replaces the GLB in the viewer. The earlier version stays reachable, so the change can be reverted.
```

### Test Case 4

**Scenario**
```
Let the assistant see a 3D model and report on it
```

**User prompt**
```
Look at this 3D model and tell me what it is and whether it has any obvious defects: https://three.ws/cdn/objects/polyhaven/glb/ArmChair_01.glb
```

**Tool triggered**
```
look_at_model
```

**Expected output**  (272/300)
```
Frames from several angles returned as MCP image content blocks, which the client renders into the conversation, plus geometry stats. The assistant describes the armchair from images it can actually see. Free, seconds not minutes. The URL is ours and needs no credentials.
```

### Test Case 5

**Scenario**
```
Turn a generated model into a persistent agent body that speaks
```

**User prompt**
```
Save that knight as a persistent agent body called Sir Gareth, then have him introduce himself.
```

**Tool triggered**
```
create_agent_persona, then persona_say
```

**Expected output**  (258/300)
```
Run after test case 2, in the same conversation. An inline living-body widget framed from https://three.ws, in which the avatar lip-syncs the line with a matching expression and gesture. Returns a persona_id that get_agent_persona reloads in a fresh session.
```

## Testing tab: negative cases

### Negative Test Case 1

**Scenario**  (178/200)
```
The user wants a 2D image, not a 3D model. The wording nearly matches our main generation prompt, but this plugin only returns 3D GLB files, so image generation should handle it.
```

**User prompt**
```
Draw a cartoon robot mascot for my startup's landing page.
```

### Negative Test Case 2

**Scenario**  (145/200)
```
"Model" is a verb here, meaning a financial projection. Nothing 3D is involved, and no tool in this plugin operates on spreadsheets or forecasts.
```

**User prompt**
```
Model out our Q3 revenue if we raise prices 20%.
```

### Negative Test Case 3

**Scenario**  (194/200)
```
The user asks how to do something in other software, not for work on a file. It says "rig" and "character", but rig_mesh needs the URL of an existing GLB and would return nothing they asked for.
```

**User prompt**
```
How do I rig a humanoid character in Blender?
```

