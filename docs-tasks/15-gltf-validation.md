# Agent Task: Write "glTF Validation" Documentation

## Output file
`public/docs/validation.md`

## Target audience
3D artists, developers, and technical users who want to validate their GLB/glTF files. Also useful for understanding the on-chain validation attestation system.

## Word count
1500–2000 words

## What this document must cover

### 1. What is glTF validation?
The validator checks a GLB or glTF 2.0 file against the official Khronos specification. It reports:
- **Errors** — files that violate the spec (will fail to load in some viewers)
- **Warnings** — non-conformant but likely to load
- **Hints** — best practice suggestions
- **Info** — informational messages (not problems)

three.ws integrates `gltf-validator@2.0.0-dev.3.10` (the official Khronos CLI tool compiled to WASM).

### 2. Running validation
**In the viewer (UI):**
1. Load your GLB in the viewer
2. Click "Validate" in the toolbar or annotation panel
3. Results appear in the validation panel with counts by severity

**As an agent skill:**
Ask the agent: "Validate this model" or "Are there any issues with this GLB?"
The agent runs validation and reports issues conversationally.

**Via the API:**
```js
POST /api/validate
Content-Type: multipart/form-data

Body: { file: <glb binary> }
```
Response:
```json
{
  "issues": {
    "numErrors": 0,
    "numWarnings": 2,
    "numHints": 5,
    "numInfos": 1,
    "messages": [
      {
        "severity": 1,
        "pointer": "/meshes/0/primitives/0",
        "message": "Unused attribute: TEXCOORD_1",
        "type": "UNUSED_OBJECT"
      }
    ]
  },
  "info": {
    "version": "2.0",
    "generator": "Blender 4.1",
    "hasAnimations": true,
    "animationCount": 3,
    "meshCount": 12,
    "materialCount": 4,
    "textureCount": 8
  },
  "uri": "model.glb"
}
```

**Programmatically (JavaScript):**
```js
import { validateGLB } from '@3dagent/sdk';
const report = await validateGLB(glbArrayBuffer);
console.log(report.issues.numErrors); // 0 = clean
```

### 3. Reading the validation report
**Severity levels:**
| Level | Number | Description |
|-------|--------|-------------|
| Error | 0 | Spec violation — fix before publishing |
| Warning | 1 | Non-conformant, may cause issues in some renderers |
| Hint | 2 | Best practice suggestion |
| Info | 3 | Informational only |

**Message format:**
- `pointer` — JSON pointer to the offending node (e.g., `/meshes/0/primitives/0`)
- `message` — human-readable description
- `type` — machine-readable issue code

**Common errors and fixes:**

| Error | Cause | Fix |
|-------|-------|-----|
| `ACCESSOR_INDEX_TRIANGLE_DEGENERATE` | Triangle with zero area | Remove degenerate triangles in your 3D editor |
| `ACCESSOR_NON_UNIT` | Normal vectors not normalized | Re-export with "Normalize Normals" checked |
| `MESH_PRIMITIVE_TANGENT_SPACE_INVALID` | Bad tangent vectors | Regenerate normals/tangents in Blender |
| `UNUSED_OBJECT` | Asset contains unused data | Remove unused materials, textures, animations |
| `BUFFER_VIEW_TOO_SHORT` | Corrupt file | Re-export from your 3D editor |
| `TEXTURE_INVALID_IMAGE` | Embedded texture won't decode | Re-export with valid PNG/JPG textures |

**Common warnings:**
- `NODE_SKINNED_MESH_NON_ROOT` — skinned mesh not at scene root
- `MESH_PRIMITIVE_JOINTS_WEIGHTS_MISMATCH` — joint/weight count mismatch

### 4. Model info reported alongside validation
The validator also extracts model metadata (via `model-info.js`):
- File size (bytes)
- Mesh count, vertex count, face count
- Material count, texture count
- Animation count and names
- Generator (e.g., "Blender 4.1", "Unity 2022")
- glTF version

This information is displayed in the model info panel and used by the agent's `present-model` skill.

### 5. On-chain validation attestation
After validating a registered agent's model, the result can be attested on-chain:

1. Validation runs → structured report generated
2. Report serialized and hashed (SHA-256)
3. Hash submitted to `ValidationRegistry.recordValidation(agentId, reportHash, passed)`
4. Transaction confirmed on-chain

Anyone can verify:
1. Re-run the validator on the same GLB → get the same report
2. Hash the report → same hash
3. Check the hash against on-chain record → matches = attestation valid

```js
import { recordValidation } from '@3dagent/sdk/erc8004';
const { txHash } = await recordValidation({
  chainId: 8453,
  agentId: 42,
  report: validationReport,
  wallet: connectedWallet
});
```

### 6. Validation UI components
Two components handle validation display:

**validator-report.jsx** — Full report with categorized messages
**validator-table.jsx** — Tabular view of all messages with filtering by severity
**validator-toggle.jsx** — Toggle to show/hide the validation overlay

The validation result also triggers agent emotion:
- Clean model (0 errors) → `celebration` emotion
- Errors found → `concern` + `empathy` emotions
- The agent will conversationally explain major issues

### 7. CI/CD integration
Validate GLBs in your build pipeline:
```bash
# Install the CLI
npm install -g @3dagent/cli

# Validate a file
3dagent validate ./output/avatar.glb --strict

# Fail build on errors
3dagent validate ./output/avatar.glb --max-errors 0
```

Or use the Node.js API:
```js
import { validateGLBFile } from '@3dagent/sdk/node';
const report = await validateGLBFile('./output/avatar.glb');
if (report.issues.numErrors > 0) process.exit(1);
```

### 8. Best practices for clean GLBs
- **Export from Blender:** Use glTF 2.0 export, check "Apply Modifiers", enable "Normals"
- **Compress:** Use Draco for mesh compression (reduces size 5-10x)
- **Textures:** PNG for albedo with transparency, JPG for opaque maps; use KTX2 for GPU compression
- **Animations:** Name clips descriptively ("idle", "wave", "run") — agents use names to find clips
- **Clean up:** Remove unused materials, textures, shape keys before exporting
- **Test in multiple viewers:** model-viewer.dev, Babylon.js sandbox, and three.ws

## Tone
Technical but accessible to 3D artists who may not be coders. Clear error table with actionable fixes. The on-chain section can be more technical.

## Files to read for accuracy
- `/src/validator.js` (6657 bytes)
- `/src/validation-ui.js`
- `/src/model-info.js`
- `/src/erc8004/validation-recorder.js`
- `/src/attestations/gltf.js`
- `/src/components/validator-report.jsx`
- `/src/components/validator-table.jsx`
- `/src/components/validator-toggle.jsx`
- `/specs/VALIDATORS.md`
- `/docs/VALIDATION_DEPLOY.md`
- `/api/validate.js` (if it exists)
- `/tests/api/validate.test.js`
- `/tests/src/validator.test.js`
