---
mode: agent
description: "Build AI model analysis that describes meshes, materials, and suggests optimizations"
---

# AI Model Analysis

## Context

The README roadmap lists **"AI Model Analysis — describe meshes, materials, and suggest optimizations"**. This feature uses AI to provide intelligent feedback about loaded 3D models.

## Implementation

### 1. Analysis Engine (`src/model-analysis.js`)

After a model loads, automatically analyze:

#### Geometry Analysis
- Identify over-tessellated flat surfaces (high tri count, low curvature)
- Detect degenerate triangles (zero area)
- Find disconnected geometry (floating vertices)
- Check for non-manifold edges
- Estimate appropriate LOD levels

#### Material Analysis
- Identify materials with identical properties (can be merged)
- Detect textures larger than necessary (4K on small objects)
- Find unused materials (not assigned to any mesh)
- Check if transparency is used but `transparent` flag is off
- Identify missing normal maps on high-detail surfaces

#### Performance Analysis
- Total draw calls estimate
- GPU memory usage estimate (geometry + textures)
- Suggest texture compression (KTX2/Basis)
- Suggest mesh compression (Draco/Meshopt)
- Identify performance bottlenecks

### 2. AI-Enhanced Descriptions

Send model metadata to the LLM for natural language analysis:

```
POST /api/analyze
Body: {
    "modelStats": { vertices, triangles, materials, textures, animations, ... },
    "validationReport": { errors, warnings, ... },
    "materialDetails": [ { name, textures, properties }, ... ]
}
```

LLM returns:
```json
{
    "summary": "This is a high-detail character model with PBR materials...",
    "optimizations": [
        {
            "priority": "high",
            "category": "textures",
            "suggestion": "Resize 4096×4096 normal map to 2048×2048 — minimal visual impact, saves 12MB GPU memory",
            "estimatedSaving": "60%"
        }
    ],
    "quality": {
        "score": 85,
        "notes": "Well-optimized geometry, good UV layout, textures could be compressed"
    }
}
```

### 3. Analysis Panel UI

Display results in a panel (side panel or overlay):
- **Summary**: Natural language description of the model
- **Score**: Quality/optimization score (0-100) with color badge
- **Optimizations**: Prioritized list with estimated savings
- **Details**: Expandable sections for geometry, materials, textures, performance

### 4. One-Click Optimizations

For each suggestion, provide an "Apply" button that uses glTF-Transform:
- "Resize textures" → applies texture resize and re-exports
- "Enable Draco compression" → applies Draco and re-exports
- "Merge duplicate materials" → deduplicates and re-exports
- "Remove unused nodes" → prunes and re-exports

### 5. Integration

- Auto-analyze on model load (lightweight client-side analysis)
- "Deep Analysis" button for AI-enhanced analysis (requires API)
- Results cached per model (don't re-analyze on settings change)
- Export analysis as JSON or PDF report

## File Structure

```
src/
├── model-analysis.js   # Client-side analysis engine
api/
├── analyze.js          # AI-enhanced analysis endpoint
```

## Validation

- Load DamagedHelmet.glb → analysis panel shows stats and suggestions
- Suggestions are actionable and accurate
- "Apply" buttons produce correctly optimized GLB exports
- AI descriptions are relevant and technically accurate
- Works without AI backend (client-side analysis only)
