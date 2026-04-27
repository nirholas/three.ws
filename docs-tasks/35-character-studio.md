# Agent Task: Write "Character Studio" Documentation

## Output file
`public/docs/character-studio.md`

## Target audience
Users who want to create custom 3D avatars using the Character Studio — a visual, no-code avatar builder. Also useful for developers who want to understand the Character Studio's technical structure.

## Word count
1200–1800 words

## What this document must cover

### 1. What is Character Studio?
Character Studio is a browser-based 3D avatar builder included with three.ws. It lets you create a fully customized humanoid avatar without any 3D modeling experience.

Access: https://three.ws/studio (avatar tab)

It's a separate React SPA (in `/character-studio/`) that outputs a GLB file compatible with all three.ws features — animations, emotion system, AR viewing, and embedding.

### 2. Getting started
1. Go to https://three.ws/studio
2. Click "Create Avatar"
3. Character Studio opens in a new panel
4. Start customizing

No account required to use the builder. An account is required to save and use your avatar with an agent.

### 3. The customization interface

**Body section:**
- Body type selector (body proportions, height)
- Skin tone slider (full range from light to dark)
- Skin texture options (smooth, freckles, etc.)

**Head section:**
- Face shape (round, oval, square, heart)
- Jaw line adjustment
- Forehead height

**Hair section:**
- Hair style gallery (20+ styles: short, long, curly, braided, bald, etc.)
- Hair color picker (solid colors + ombre options)
- Hair accessory options (clips, ties, etc.)

**Eyes section:**
- Eye shape (almond, round, hooded, etc.)
- Iris color picker
- Eyelash style and density

**Eyebrows section:**
- Brow shape (arched, straight, thick, thin)
- Brow color (matches hair or custom)

**Nose & Mouth section:**
- Nose shape presets
- Lip shape (thin, medium, full)
- Lip color (natural, custom)

**Clothing section:**
- Top: t-shirts, shirts, jackets, hoodies, tanks
- Bottom: pants, skirts, shorts, jeans
- Shoes: sneakers, boots, heels, sandals
- Colors and patterns for each piece

**Accessories section:**
- Glasses (multiple frame styles)
- Hats (baseball cap, beanie, beret, etc.)
- Earrings
- Necklaces
- Watches

### 4. Real-time 3D preview
The center panel shows your avatar in real time:
- Rotate by clicking and dragging
- Zoom with scroll wheel
- The avatar updates instantly with every customization change
- Preview in T-pose (neutral) or with an idle animation running

Switch the preview environment:
- Neutral studio (white background)
- Outdoor sunset
- Indoor office

### 5. Morph targets included
All Character Studio avatars include the full set of morph targets required for the emotion system:
- `mouthSmile`, `mouthFrown`, `mouthOpen`, `cheekPuff`
- `browInnerUp`, `browOuterUp`, `noseSneer`
- `eyeSquint`, `eyesClosed`

This means your Character Studio avatar will support full facial expression animation out of the box — no extra work required.

### 6. Animation compatibility
Character Studio avatars use a Mixamo-compatible skeleton:
- `Hips`, `Spine`, `Chest`, `Neck`, `Head`
- `LeftUpperArm`, `LeftLowerArm`, `LeftHand`
- `RightUpperArm`, `RightLowerArm`, `RightHand`
- `LeftUpperLeg`, `LeftLowerLeg`, `LeftFoot`
- `RightUpperLeg`, `RightLowerLeg`, `RightFoot`

This means:
- Mixamo animations work directly on Character Studio avatars
- The three.ws animation library is compatible
- You can download animations from Mixamo and attach them

### 7. Exporting your avatar
After customizing:
1. Click "Export" → "Download GLB"
2. The GLB downloads to your computer
3. Import it into the three.ws editor (drag-and-drop)
4. Or host it on your own CDN

Alternatively:
1. Click "Save to My Agents"
2. Sign in to your account
3. Avatar is saved to your account and linked to a new agent
4. You can edit the agent in the editor immediately

### 8. The asset library
Character Studio is built on a library of modular 3D assets:
- Located in `/character-studio/public/`
- Each clothing item, hair style, and accessory is a separate GLB
- Assets are combined at export time using `@gltf-transform` to produce one GLB

The library is open-source — community contributions welcome. To add a new asset:
1. Create the 3D asset in Blender using the Character Studio base mesh as reference
2. Export as GLB with proper vertex groups and UVs
3. Submit a PR to the `/character-studio/public/` directory

### 9. Technical architecture
For developers interested in the internals:

- **React + Vite** SPA in `/character-studio/`
- **three.js** for 3D preview rendering
- **@gltf-transform/core** for GLB manipulation and merging
- Asset manifest JSON lists all available items
- State managed in React context (current selections)
- Export: merge selected meshes, apply skin weights, bake morph targets → output GLB

The build output is hosted at `/character-studio/` route of the main app.

### 10. Limitations
- Character Studio creates humanoid avatars only — no animals, robots, or abstract shapes
- Clothing physics (cloth simulation) is not supported in real-time (static clothing only)
- The asset library is limited to the included collection — custom assets require code changes
- Very detailed customization (individual face feature morphing) is not yet available

For more advanced customization: use Blender or another 3D tool and import a custom GLB directly.

### 11. Integrating with Avaturn
Character Studio and the Avaturn selfie-to-avatar pipeline are complementary:
- **Avaturn**: photorealistic avatar from a selfie, less customization
- **Character Studio**: fully customizable but stylized, no selfie needed

You can also combine them: generate an Avaturn avatar, then modify it in the three.ws editor to change clothing, colors, and accessories.

## Tone
User-friendly guide — non-technical users are the primary audience. Walk through the UI clearly. The limitations section sets expectations honestly.

## Files to read for accuracy
- `/character-studio/` — review the directory structure, README, and main component files
- `/src/avatar-creator.js`
- `/src/selfie-pipeline.js`
- `/src/editor/regenerate-panel.js`
- `/docs/avaturn-docs.md`
