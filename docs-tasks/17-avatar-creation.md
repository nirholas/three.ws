# Agent Task: Write "Avatar Creation" Documentation

## Output file
`public/docs/avatar-creation.md`

## Target audience
Users who want to create a custom 3D avatar for their agent — either by taking a selfie to generate one, customizing in Character Studio, or using an existing GLB. Covers both non-technical and technical audiences.

## Word count
1500–2500 words

## What this document must cover

### 1. Ways to get an avatar
Three paths to a 3D avatar for your agent:

| Path | Time | Skill required | Result |
|------|------|----------------|--------|
| Selfie → AI generation | 2-3 min | None | Realistic avatar from photo |
| Character Studio | 10-20 min | None | Stylized, customizable avatar |
| Upload your own GLB | 1 min | 3D modeling | Any 3D model |

### 2. Path 1: Selfie-to-avatar (Avaturn integration)
The quickest way to get a personalized 3D avatar.

**How it works:**
1. Go to https://three.ws/create
2. Grant camera access
3. Take a selfie (or upload a photo)
4. Avaturn's AI generates a 3D avatar based on your face
5. Avatar is returned as a GLB with a compatible rig
6. GLB is saved to your account and linked to your agent

**Technical flow:**
- `selfie-capture.js` handles camera access and photo capture
- `selfie-pipeline.js` uploads the photo and calls the Avaturn API
- `avaturn-client.js` wraps the Avaturn SDK
- Returned GLB is processed and stored via `account.js` → `saveRemoteGlbToAccount()`

**What Avaturn provides:**
- A fully rigged humanoid avatar (VRM-compatible skeleton)
- Facial blend shapes for expressions
- Skin, hair, eye color matched to photo
- Clothing options during generation
- GLB format ready for three.ws

**Customization after generation:**
- Load the GLB in the three.ws editor
- Adjust materials (skin tone, clothing color)
- Add accessories
- The avatar rig is compatible with standard animation clips

### 3. Path 2: Character Studio
For users who want full creative control without a selfie.

**Access:** https://three.ws/studio

Character Studio is a React-based avatar builder:
- Choose body type, skin tone, hair, eyes
- Browse a library of clothing and accessories
- Mix and match components
- Preview in real-time 3D
- Export as GLB

**Technical implementation:**
- Located in `/character-studio/` — separate React SPA
- Built with Vite
- Exports a GLB that conforms to the three.ws avatar spec (compatible skeleton and blend shapes)

**Asset library:**
Character Studio includes a library of:
- Body meshes (multiple shapes)
- Hair options (styles, colors)
- Clothing (shirts, jackets, pants)
- Accessories (glasses, hats)
- Skin tone options

### 4. Path 3: Upload your own GLB
If you have a 3D model (from Blender, Maya, Mixamo, Ready Player Me, etc.):

1. Open the three.ws app: https://three.ws/app
2. Drag and drop your GLB file into the viewer
3. The model loads and validates automatically
4. Save to your account via the editor

**Compatibility requirements:**
- glTF 2.0 or GLB format
- Animations should be named descriptively ("idle", "wave", "dance", etc.)
- For facial expressions: include morph targets named:
  - `mouthSmile`, `mouthFrown`, `mouthOpen`
  - `browInnerUp`, `browOuterUp`
  - `eyeSquint`, `eyesClosed`
  - `cheekPuff`, `noseSneer`
- For head movement: skeleton should have `Head` and `Neck` bones

If your model doesn't have these, the emotion system gracefully degrades — no crash, just no facial animation.

**Converting from other formats:**
- **FBX → GLB:** Use `/scripts/convert-fbx-to-glb.py` or Blender's File > Import > FBX, then export as glTF
- **OBJ → GLB:** Import to Blender, rig if needed, export as glTF
- **VRM → GLB:** VRM files are already glTF — rename `.vrm` to `.glb`
- **Ready Player Me:** RPM avatars are fully compatible out of the box

### 5. Avatar requirements for full feature compatibility

| Feature | Requirement |
|---------|-------------|
| 3D display | Any valid GLB |
| Facial expressions | Morph targets (blend shapes) |
| Head tilt/lean | Head + Neck bones in skeleton |
| Gesture animations | Named animation clips |
| Emotion blending | Both morph targets AND Head bone |
| AR view | Any GLB (auto-converts) |

### 6. The regeneration panel
After an avatar is created, it can be regenerated:
- Change clothing choices
- Adjust sliders (hair, body type)
- Re-run Avaturn with a new photo
- Apply style presets

Accessed in the editor via the "Regenerate" button → `/src/editor/regenerate-panel.js`.

### 7. Accessories
Additional accessories can be layered onto an avatar:
- Glasses, hats, scarves, etc.
- Each accessory is a separate GLB merged into the scene
- Managed via `agent-accessories.js`
- Some accessories include animations (e.g., floating particles)

### 8. Naming your agent
After creating the avatar, set the agent's name:
- The name picker is at `agent-naming.js`
- Names are displayed in the identity card, embed headers, and OG metadata
- Choose something memorable and unique

### 9. Saving and publishing
Once your avatar is created:
1. **Save to account** — stores GLB and manifest to your three.ws account (free)
2. **Publish** — makes the agent publicly discoverable (optional)
3. **Register on-chain** — creates permanent ERC-8004 identity (optional, gas required)

The publish modal is at `/src/editor/publish-modal.js`.

### 10. Avatar spec for developers
If you're building tools that output avatars for three.ws, target this spec:
- **Format:** GLB (binary glTF 2.0)
- **Skeleton:** Humanoid rig (Mixamo or VRM-compatible naming)
- **Animations:** Named clips at the root level of the GLB
- **Blend shapes:** Listed above under "avatar requirements"
- **Textures:** PNG (with alpha if needed) or JPG; KTX2 recommended for production
- **Polygon count:** Under 100k polys for smooth mobile performance
- **File size:** Under 20MB for fast loading; under 5MB with Draco compression

## Tone
Accessible to non-technical users for the selfie/studio paths; technical for the upload and developer sections. Use the table to help users pick the right path quickly.

## Files to read for accuracy
- `/src/selfie-capture.js`
- `/src/selfie-pipeline.js`
- `/src/avaturn-client.js`
- `/src/avatar-creator.js`
- `/src/agent-accessories.js`
- `/src/agent-naming.js`
- `/src/editor/regenerate-panel.js`
- `/src/editor/publish-modal.js`
- `/src/account.js`
- `/docs/avaturn-docs.md`
- `/character-studio/` — review the README and main component structure
- `/src/agent-avatar.js` — to understand morph target and bone requirements
