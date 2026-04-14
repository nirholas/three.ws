---
mode: agent
description: "Build a headless CLI tool for model validation and inspection in CI/CD"
---

# CLI Tool

## Context

The README roadmap lists **"CLI Tool — `npx 3d-agent inspect model.glb` for headless validation in CI/CD pipelines"**. This makes the validation engine usable in automated workflows without a browser.

## Implementation

### 1. CLI Entry Point (`cli/index.js`)

```bash
npx 3d-agent <command> [options] <file>
```

Commands:
- `validate` — Run glTF validation and output report
- `inspect` — Show model metadata and statistics
- `optimize` — Suggest or apply optimizations (requires glTF-Transform)

### 2. `validate` Command

```bash
npx 3d-agent validate model.glb [--format json|text|table] [--max-issues 100] [--severity error|warning|info|hint]
```

- Load GLB/glTF from local file path or URL
- Run `gltf-validator`
- Output report in requested format:
  - `json`: Full validation report as JSON (machine-readable)
  - `text`: Human-readable summary
  - `table`: Formatted table with colors (default for TTY)
- Exit code: 0 = pass, 1 = errors found, 2 = file not found

Example output (table format):
```
✓ model.glb — Valid glTF 2.0
  Generator: Blender 3.6
  Version: 2.0
  Meshes: 3  Materials: 2  Textures: 5
  Vertices: 14,556  Triangles: 46,356

  0 Errors  2 Warnings  1 Info
  ├─ WARNING: Unused texture (2×)
  └─ INFO: Non-power-of-two texture dimensions
```

### 3. `inspect` Command

```bash
npx 3d-agent inspect model.glb [--format json|text]
```

Output:
- File size
- glTF version, generator
- Extensions used / required
- Mesh count, material count, texture count
- Total vertices, triangles
- Animation count and duration
- Bounding box dimensions

### 4. `optimize` Command (with glTF-Transform)

```bash
npx 3d-agent optimize model.glb -o optimized.glb [--draco] [--texture-resize 2048] [--dedup] [--prune]
```

Using `@gltf-transform/cli` or programmatic API:
- `--draco`: Apply Draco mesh compression
- `--texture-resize N`: Downscale textures to max NxN
- `--dedup`: Remove duplicate accessors/textures
- `--prune`: Remove unused nodes/materials
- `--quantize`: Quantize accessors

If no `-o` flag, output suggestions only (dry run):
```
Suggestions for model.glb:
  • Draco compression would reduce geometry from 1.2 MB to ~450 KB
  • 2 textures are 4096×4096 — resize to 2048 to save ~12 MB
  • 1 unused material can be pruned
  Estimated savings: 67% (3.7 MB → 1.2 MB)
```

### 5. Package Configuration

In `package.json`:
```json
{
    "bin": {
        "3d-agent": "./cli/index.js"
    }
}
```

### 6. Dependencies

CLI-specific:
- `commander` or `yargs` for argument parsing
- `chalk` for colored terminal output
- `ora` for spinners
- `cli-table3` for table formatting

Reuse existing:
- `gltf-validator` (already installed)
- `@gltf-transform/core` (from Material Editor prompt)

### 7. CI/CD Integration Examples

GitHub Actions:
```yaml
- name: Validate 3D Models
  run: npx 3d-agent validate models/**/*.glb --format json > report.json

- name: Check for errors
  run: npx 3d-agent validate models/**/*.glb --severity error
```

## File Structure

```
cli/
├── index.js        # Entry point, commander setup
├── validate.js     # Validation command
├── inspect.js      # Inspection command
├── optimize.js     # Optimization command
└── format.js       # Output formatters (json, text, table)
```

## Validation

- `npx 3d-agent validate test.glb` → outputs report, exit code 0
- `npx 3d-agent validate broken.glb` → outputs errors, exit code 1
- `npx 3d-agent inspect test.glb --format json` → valid JSON output
- `npx 3d-agent optimize test.glb -o out.glb --draco` → produces smaller file
- Works in GitHub Actions CI pipeline
