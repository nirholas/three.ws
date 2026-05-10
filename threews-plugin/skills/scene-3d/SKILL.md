---
name: scene-3d
description: >
  Use the three.ws scene manipulation skills to create and modify 3D objects
  in the live Three.js scene via natural language. Covers scene-create-object,
  scene-find-object, and scene-update-object — all MCP-exposed skills that
  the agent can call in response to user requests.
metadata:
  author: three.ws
  version: "1.0"
---

# 3D Scene Manipulation

The three.ws runtime gives agents direct access to the Three.js scene through three built-in skills. Users can ask the agent to create, find, or modify objects in the 3D scene by name, and the agent executes the operations immediately.

These skills are MCP-exposed — they appear as tools the LLM can call during a conversation.

## Skills

### `scene-create-object`

Creates a new primitive mesh in the scene.

**Input schema:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `shape` | string | yes | `box`, `sphere`, `cone`, or `cylinder` |
| `color` | string | no | Any CSS color: `"red"`, `"#ff0000"`, `"hsl(120,100%,50%)"` |
| `position` | `{ x, y, z }` | no | World-space position in meters. Default: `{ x:0, y:1, z:0 }` |
| `scale` | `{ x, y, z }` | no | Scale multiplier. Default: `{ x:1, y:1, z:1 }` |

The created object is named `<shape>_<timestamp>` (e.g., `box_1715300000000`). Use this name with `scene-find-object` or `scene-update-object` to target it later.

Animation hint: `gesture-magic` (agent does a magic hand movement while creating).

**Examples:**

> "Put a red sphere above the agent's head"
```json
{ "shape": "sphere", "color": "red", "position": { "x": 0, "y": 2.5, "z": 0 } }
```

> "Create a tall blue cylinder to the left"
```json
{ "shape": "cylinder", "color": "#0055ff", "position": { "x": -1.5, "y": 0.5, "z": 0 }, "scale": { "x": 0.4, "y": 2, "z": 0.4 } }
```

> "Add a flat green platform"
```json
{ "shape": "box", "color": "#22cc44", "position": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 4, "y": 0.1, "z": 4 } }
```

---

### `scene-find-object`

Looks up an object in the scene by name. Returns whether the object exists.

**Input schema:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Exact name of the object (case-sensitive) |

**Use case:** Verify an object exists before updating it, or query the scene state.

**Example:**
> "Is there a sphere in the scene called 'sphere_1715300000000'?"

---

### `scene-update-object`

Modifies position, rotation, scale, or color of a named object in the scene.

**Input schema:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Name of the object to modify |
| `color` | string | no | New CSS color |
| `position` | `{ x, y, z }` | no | New world-space position |
| `rotation` | `{ x, y, z }` | no | Euler angles in **radians** |
| `scale` | `{ x, y, z }` | no | New scale multiplier |

Animation hint: `gesture-manipulate` (agent makes a manipulation gesture while updating).

**Examples:**

> "Move the box to the right and make it yellow"
```json
{ "name": "box_1715300000000", "position": { "x": 2, "y": 1, "z": 0 }, "color": "yellow" }
```

> "Rotate the cone 45 degrees around Y"
```json
{ "name": "cone_1715300001000", "rotation": { "x": 0, "y": 0.785, "z": 0 } }
```

---

## Enabling scene skills

Scene skills are available in the runtime by default if the agent has `scene-create-object`, `scene-find-object`, and `scene-update-object` in its `skills` array.

### Via API (create or update an agent)

```json
{
  "skills": ["greet", "present-model", "remember", "think", "scene-create-object", "scene-find-object", "scene-update-object"]
}
```

### Via attribute

```html
<agent-3d
  src="agent://base/42"
  skills="scene-create-object,scene-find-object,scene-update-object"
></agent-3d>
```

### In the manifest

```json
{
  "skills": [
    { "uri": "skills/scene-3d/" }
  ]
}
```

---

## Coordinate system

Three.ws uses Three.js world coordinates:
- **Y up** — positive Y is up
- **Units are meters** — a typical standing agent is about 1.7–1.8 units tall
- **Origin** — the agent stands near `{ x:0, y:0, z:0 }`

Useful positions:
| Location | Approximate coordinates |
|----------|------------------------|
| Floor level | `y: 0` |
| Waist height | `y: 1` |
| Above head | `y: 2.2 – 2.5` |
| Left of agent | `x: -1.5` |
| Right of agent | `x: 1.5` |
| Behind agent | `z: -1` |
| In front of agent | `z: 1` |

---

## Animation hints reference

When writing custom skills that manipulate the scene, use these `animationHint` values to drive the avatar:

| Hint | When to use |
|------|------------|
| `gesture-magic` | Creating something from nothing |
| `gesture-manipulate` | Physically adjusting an object |
| `gesture` | Generic pointing or indicating |
| `present` | Showcasing or narrating an object |
| `inspect` | Examining something closely |
| `celebrate` | Completing a task successfully |
| `wave` | Greeting or saying goodbye |
| `nod` | Confirming or acknowledging |
| `think` | Deliberating before acting |
| `concern` | Something went wrong |

---

## Example conversation flow

```
User: "Add a spinning golden trophy in the center of the scene"

Agent calls scene-create-object:
  { "shape": "cone", "color": "gold", "position": { "x": 0, "y": 0.5, "z": 0 }, "scale": { "x": 0.5, "y": 1.5, "z": 0.5 } }
→ "I've created a golden trophy shape in the center."

User: "Make it bigger"

Agent calls scene-update-object:
  { "name": "cone_<timestamp>", "scale": { "x": 1, "y": 3, "z": 1 } }
→ "Done — it's now three times taller."

User: "Move it to the left side"

Agent calls scene-update-object:
  { "name": "cone_<timestamp>", "position": { "x": -1.5, "y": 0.5, "z": 0 } }
→ "Moved it to your left."
```

---

## Writing custom scene skills

To register a new scene skill in JavaScript (e.g., inside a custom skill bundle):

```js
// In your SKILL.md handler or a JS module loaded by the runtime:
agentSkills.register({
  name: 'scene-draw-path',
  description: 'Draw a line between two points in the scene.',
  animationHint: 'gesture-magic',
  mcpExposed: true,
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'object', properties: { x: {type:'number'}, y: {type:'number'}, z: {type:'number'} } },
      to:   { type: 'object', properties: { x: {type:'number'}, y: {type:'number'}, z: {type:'number'} } },
      color: { type: 'string' },
    },
    required: ['from', 'to'],
  },
  handler: async (args, ctx) => {
    const { from, to, color = 'white' } = args;
    // ctx.viewer is the Viewer instance
    const points = [
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    ctx.viewer.scene.add(line);
    ctx.viewer.render();
    return { success: true, output: `Drew a line from (${from.x},${from.y},${from.z}) to (${to.x},${to.y},${to.z}).` };
  },
});
```
