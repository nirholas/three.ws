# OpenAI Plugin Directory: every field, paste-ready

Each block is under the portal's silent limit. Do not edit them longer without re-running this script.

## MCP tab: tool justifications

### forge_free

**Read Only**  (182/200)
```
False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.
```

**Open World**  (195/200)
```
True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.
```

**Destructive**  (193/200)
```
False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.
```

### text_to_avatar

**Read Only**  (182/200)
```
False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.
```

**Open World**  (195/200)
```
True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.
```

**Destructive**  (193/200)
```
False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.
```

### mesh_forge

**Read Only**  (182/200)
```
False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.
```

**Open World**  (195/200)
```
True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.
```

**Destructive**  (193/200)
```
False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.
```

### rig_mesh

**Read Only**  (182/200)
```
False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.
```

**Open World**  (195/200)
```
True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.
```

**Destructive**  (193/200)
```
False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.
```

### forge_avatar

**Read Only**  (182/200)
```
False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.
```

**Open World**  (195/200)
```
True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.
```

**Destructive**  (193/200)
```
False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.
```

### refine_model

**Read Only**  (182/200)
```
False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.
```

**Open World**  (195/200)
```
True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.
```

**Destructive**  (193/200)
```
False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.
```

### check_job

**Read Only**  (125/200)
```
True because it only looks up an existing job by its id and reports that job's state. It creates nothing and changes nothing.
```

**Open World**  (180/200)
```
True because the job it reports on is running on external inference providers, so the status reflects third-party systems outside our control rather than a closed internal dataset.
```

**Destructive**  ( 91/200)
```
False because it reads job state only. Nothing is written, modified or removed by the call.
```

### look_at_model

**Read Only**  (141/200)
```
True because it renders views of a model that already exists and returns those frames as images. It stores no new asset and modifies nothing.
```

**Open World**  (150/200)
```
True because it accepts any public GLB URL, so it fetches from hosts outside our own domain and its result depends entirely on that external resource.
```

**Destructive**  (115/200)
```
False because it only reads the supplied model in order to render it. The source file is never modified or deleted.
```

### create_agent_persona

**Read Only**  (164/200)
```
False because it saves a new persona record and copies the model into durable storage so the body outlives the source URL. That stored record is a real side effect.
```

**Open World**  (146/200)
```
True because creating the persona calls external model and speech providers, and it accepts a model URL that may be hosted outside our own domain.
```

**Destructive**  ( 99/200)
```
False because it only creates. Existing personas and existing models are never modified or deleted.
```

### get_agent_persona

**Read Only**  (145/200)
```
True because it is a pure lookup. It reads an existing persona by its id and returns that persona's configuration. Nothing is created or changed.
```

**Open World**  (158/200)
```
False because it reads only persona records we store ourselves. No external provider is contacted, and the result is fully determined by data we already hold.
```

**Destructive**  ( 70/200)
```
False because it is a read-only lookup. Nothing is written or removed.
```

### persona_say

**Read Only**  (149/200)
```
False because it increments the persona's turn counter, which is a write to our stored state, alongside returning the render directive for this turn.
```

**Open World**  (134/200)
```
False because it acts only on a persona we already store and renders through our own embed. It does not reach outside our own systems.
```

**Destructive**  (127/200)
```
False because it appends a turn and updates a counter. It never deletes or overwrites the persona's configuration or its model.
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
forge_avatar, then check_job if the first response returns status "pending"
```

**Expected output**  (228/300)
```
A rigged GLB in the same inline viewer, with a humanoid skeleton and skin weights already applied, so an idle animation plays rather than the model standing in a bind pose. One call performs both the mesh generation and the rig.
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
refine_model
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

