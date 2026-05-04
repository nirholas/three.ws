# Character Studio

Character Studio is a browser-based 3D avatar builder built into three.ws. It lets you design a fully customized humanoid avatar — body, hair, face, clothing, and accessories — using a point-and-click interface with no 3D modeling experience required.

The result is a GLB/VRM file that works with every three.ws feature: animations, the emotion system, AR viewing, and web embedding.

**Access:** [https://three.ws/studio](https://three.ws/studio) → Avatar tab

Character Studio is open-source (MIT license) and built on the [M3-org CharacterStudio](https://github.com/M3-org/CharacterStudio) project.

---

## Getting Started

1. Go to [https://three.ws/studio](https://three.ws/studio)
2. Click **Avatar** in the top navigation
3. Click **Create Avatar** — Character Studio opens in a new panel
4. Start customizing using the sections in the left panel

**Account:** No account is needed to build and export an avatar. An account is required to save your avatar to an agent and use it on the platform.

---

## The Customization Interface

The left panel is organized into sections. Every change you make is reflected immediately in the 3D preview in the center.

### Body

- **Body type** — proportions and height presets
- **Skin tone** — continuous slider from light to dark
- **Skin texture** — smooth, freckles, and other surface variations

### Head

- **Face shape** — round, oval, square, heart
- **Jaw line** — narrow to wide
- **Forehead height** — adjustment slider

### Hair

- **Style gallery** — 20+ styles including short, long, curly, braided, and bald options
- **Color picker** — solid colors and ombre combinations
- **Accessories** — clips, ties, and similar items

### Eyes

- **Shape** — almond, round, hooded, and others
- **Iris color** — full color picker
- **Eyelashes** — style and density options

### Eyebrows

- **Shape** — arched, straight, thick, thin
- **Color** — matches hair color automatically, or set independently

### Nose & Mouth

- **Nose shape** — selection of presets
- **Lip shape** — thin, medium, full
- **Lip color** — natural tones or custom color

### Clothing

- **Top** — t-shirts, shirts, jackets, hoodies, tanks
- **Bottom** — pants, skirts, shorts, jeans
- **Shoes** — sneakers, boots, heels, sandals
- Colors and patterns available for each item

### Accessories

- Glasses (multiple frame styles)
- Hats (baseball cap, beanie, beret, and others)
- Earrings, necklaces, and watches

---

## The 3D Preview

The center panel shows your avatar in real time using a Three.js WebGL renderer.

- **Rotate** — click and drag
- **Zoom** — scroll wheel
- **Animation preview** — toggle between T-pose (neutral) and an idle animation loop

Switch the background environment using the environment selector:

- Neutral studio (white background)
- Outdoor sunset
- Indoor office

Every customization change updates the preview instantly — no waiting for assets to reload.

---

## Exporting Your Avatar

### Download as GLB

1. Click **Export** → **Download GLB**
2. The file downloads to your computer
3. Drag and drop it into the three.ws editor, or host it on your own CDN

### Save to Your Account

1. Click **Save to My Agents**
2. Sign in (or create an account)
3. The avatar is saved to your account and linked to a new agent
4. You can open the agent in the editor immediately

The exported GLB is a single self-contained file — all textures and meshes are baked in and optimized for real-time use.

### One-Click Optimization

Before exporting, click **Optimize** to:

- Merge all skinned meshes into a single draw call
- Generate a texture atlas from individual textures
- Automatically cull hidden geometry (faces underneath clothing layers)

Optimized avatars render faster and use less GPU memory, which matters in scenes with multiple agents or AR contexts.

---

## Morph Targets and the Emotion System

Every avatar created in Character Studio includes the full set of morph targets required by the three.ws emotion system. These are baked into the exported file automatically — you don't need to add them manually.

The included morph targets are:

| Morph target | Used for |
|---|---|
| `mouthSmile` | Celebration, positive sentiment |
| `mouthFrown` | Concern, negative sentiment |
| `mouthOpen` | Speech, excitement |
| `cheekPuff` | Celebration |
| `browInnerUp` | Concern, empathy |
| `browOuterUp` | Curiosity |
| `noseSneer` | Concern |
| `eyeSquint` | Empathy |
| `eyesClosed` | Patience (subtle) |

The agent runtime blends these continuously based on emotional state — no per-avatar configuration needed.

---

## Animation Compatibility

Character Studio avatars use a VRM-compliant skeleton with Mixamo-compatible bone names:

```
Hips → Spine → Chest → Neck → Head
LeftUpperArm → LeftLowerArm → LeftHand
RightUpperArm → RightLowerArm → RightHand
LeftUpperLeg → LeftLowerLeg → LeftFoot
RightUpperLeg → RightLowerLeg → RightFoot
```

This means:

- **Mixamo animations work directly** — download any animation from Mixamo and attach it
- **The three.ws animation library is fully compatible** — all built-in clips (idle, wave, gesture, walk) work out of the box
- **Retargeting** is handled automatically by the animation manager

---

## The Asset Library

Character Studio uses a manifest-driven asset system. Each clothing item, hair style, and accessory is a separate GLB file stored in `/character-studio/public/`. The `manifest.json` file lists what is available and how items attach to the base skeleton.

At export time, the selected assets are merged into a single GLB using `@gltf-transform/core` — texture atlasing and mesh merging happen at this stage.

### Contributing New Assets

The asset library is open-source and welcomes contributions:

1. Create your 3D asset in Blender using the Character Studio base mesh as reference
2. Follow the vertex group and UV conventions documented in the [CharacterStudio docs](https://m3-org.github.io/characterstudio-docs/)
3. Export as GLB with correct bone weights
4. Submit a pull request adding the asset and its manifest entry to `/character-studio/public/`

---

## Technical Architecture

For developers who want to understand the internals or self-host:

| Component | Technology |
|---|---|
| Frontend framework | React 18 + Vite |
| 3D rendering | Three.js (WebGL) |
| VRM model support | @pixiv/three-vrm |
| State management | Zustand |
| GLB manipulation | @gltf-transform/core |
| Optimization | Texture atlasing, mesh merging, face culling |

The core of the system is `CharacterManager` in `character-studio/src/library/characterManager.js`. It orchestrates trait loading, mesh combining, animation playback, and VRM export. The UI layer communicates with it through React context (`SceneContext`, `ViewContext`).

**Integration with the main app:** The `AvatarCreator` class in `src/avatar-creator.js` opens Character Studio in an iframe and listens for a `postMessage` export event. When the user clicks Export inside Character Studio, the GLB blob is passed back to the parent app.

**Build:** `npm run dev` inside `/character-studio/` starts the dev server. `npm run build` outputs to `./build/` for GitHub Pages deployment. Run `npm run get-assets` first to clone the required loot-assets into the public directory.

---

## Character Studio vs. Avaturn

three.ws supports two avatar creation paths. They're complementary, not competing:

| | Character Studio | Avaturn |
|---|---|---|
| Input | Point-and-click UI | 3 photos (selfie pipeline) |
| Style | Stylized / illustrated | Photorealistic |
| Customization | Full control over every feature | Limited post-generation edits |
| Account needed to start | No | Yes |

**Using both together:** Generate an Avaturn avatar from a selfie to get a photorealistic starting point, import the resulting GLB into the three.ws editor, then adjust clothing colors and accessories manually.

---

## Limitations

- **Humanoid avatars only.** Character Studio is designed for bipedal human characters. It does not support animals, robots, or abstract shapes.
- **No clothing physics.** Cloth simulation is not available — clothing is static. Skirts and loose fabric won't move with the character.
- **Asset library scope.** Customization is limited to items in the included asset library. Adding entirely new clothing shapes requires creating a 3D asset and submitting it to the library.
- **Granular face morphing.** Individual face feature morphing (e.g., nose width, cheekbone height via sliders) is not yet available — face customization is preset-based.

For cases that need more control than Character Studio provides, create your avatar in Blender or another 3D tool and import the GLB directly into the three.ws editor.
