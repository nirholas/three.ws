# Prompt Recipes for 3D Generation

A copy-paste cookbook for the [Forge](/forge). Every recipe here follows the same skeleton — learn the skeleton once and you can write your own recipes forever:

```
[style] [object with specifics], [material], [finish]
```

For example:

```
a low-poly red fox, sitting
a vintage film camera, black leather and chrome
a sci-fi combat helmet, brushed metal
```

If you haven't generated your first model yet, do the five-minute [text-to-3D tutorial](/tutorials/text-to-3d) first, then come back here for ideas.

[![The Forge page showing text and image to 3D generation options](/docs/img/forge-hero.webp)](/forge)

*The Forge accepts a sentence or an image and returns a textured GLB.*

---

## The four rules

**1. One object.** The generator builds *a thing*, not a scene. "A wizard tower" works; "a wizard tower on a cliff at sunset" puts the cliff in your model.

**2. Materials are magic words.** The single highest-leverage improvement to any prompt is naming what the object is made of: *glazed ceramic, brushed metal, worn leather, matte plastic, polished wood, cast iron, frosted glass*.

**3. Style words set the whole look.** Lead with one: *low-poly* (game-ready, faceted), *realistic*, *cartoon* (chunky, exaggerated), *stylized* (hand-crafted look), *voxel* (Minecraft-like).

**4. Shape beats adjectives.** "Beautiful" and "amazing" do nothing. "Tall", "rounded", "four-legged", "wide-brimmed" change geometry.

---

## Recipes by category

Copy any of these straight into the Forge. Swap the nouns to make them yours.

### Game props

```
a low-poly treasure chest, iron-banded wood, closed
a health potion bottle, red liquid, cork stopper, glass
a medieval shield, round, painted wood with steel rim
a sci-fi supply crate, olive green, hard plastic with handles
```

Low-poly + Draft tier is the fastest loop for props — generate five, keep two.

### Furniture and product mockups

```
a worn leather armchair, studio lighting, plain background
a minimalist desk lamp, matte black metal, hinged arm
a mid-century walnut sideboard, brass legs
a stoneware coffee mug, speckled glaze, large handle
```

Use **High** tier for product shots — the PBR materials (metal, roughness) make renders look real.

### Characters and creatures

```
a cartoon robot, round body, friendly, white and orange plastic
a low-poly knight, full plate armor, idle pose
a chibi dragon, green scales, small wings, standing
a friendly ghost, simple smooth shape, slight smile
```

Add a pose word — *standing, sitting, idle pose, T-pose* — so the model comes out predictable. Generated characters are static meshes; if you want one that talks and moves, use it as a body in [your first agent](/tutorials/first-agent).

### Vehicles and machines

```
a cartoon delivery van, rounded edges, cream and red
a low-poly biplane, canvas wings, single propeller
a steampunk submarine, riveted brass, round portholes
a lunar rover, six wheels, gold foil and white panels
```

### Food (great for icons)

```
a glazed donut, pink frosting, rainbow sprinkles
a slice of layer cake, three layers, cherry on top
a cartoon taco, overflowing, cheese and lettuce
a soft pretzel, golden brown, salt crystals
```

### Architecture and dioramas

```
a tiny fantasy cottage, thatched roof, stone chimney
a low-poly lighthouse, red and white stripes, on a rock base
a japanese torii gate, weathered red wood
a market stall, striped awning, wooden crates
```

"Tiny" and "diorama-style" keep buildings object-like instead of sprawling into scenes.

---

## Before and after

Real fixes, the kind you'll actually make:

| Weak prompt | Why it struggles | Strong prompt |
|-------------|------------------|---------------|
| `a chair` | Underspecified — thousands of chairs qualify | `a four-legged wooden dining chair, tall ladder back` |
| `an epic awesome sword` | Adjectives without geometry | `a broadsword, straight crossguard, leather-wrapped grip` |
| `a cozy room with a fireplace and bookshelves` | A scene, not an object | `a stone fireplace, arched opening, wooden mantel` |
| `a shiny thing for my game` | No object at all | `a low-poly gold coin, embossed star, game prop` |
| `a photorealistic cat in a garden chasing butterflies` | Scene + action — geometry can't "chase" | `a realistic sitting cat, short gray fur` |

---

## Matching tier to intent

- **Exploring shapes?** Draft tier, short prompts, generate freely.
- **Found the right prompt?** Re-run it on **Standard** or **High** — same words, more geometry budget.
- **Need real materials** (metalness, roughness, normal maps)? Only **High** tier produces PBR textures.

The tiers are explained in detail in [the text-to-3D tutorial](/tutorials/text-to-3d).

---

## What's next

- [Turn a Text Prompt into a 3D Model](/tutorials/text-to-3d) — the full Forge walkthrough.
- [Turn Photos into a 3D Model](/tutorials/image-to-3d) — these recipes also work as the guidance text for photo reconstruction.
- [Generate 3D Models from Code](/tutorials/generate-3d-api) — run a whole prompt list through the API and batch-generate an asset pack.
