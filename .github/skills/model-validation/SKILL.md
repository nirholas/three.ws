---
name: model-validation
description: 'glTF model validation and reporting features. Use when: modifying validation logic, customizing validation reports, changing severity handling, adding new validation checks, fixing validator UI, or working with gltf-validator integration.'
argument-hint: 'Describe the validation change or feature'
---

# Model Validation

## When to Use

- Modifying how glTF models are validated
- Changing validation report display or formatting
- Adding/removing severity levels or message grouping
- Fixing validator toggle or report lightbox UI
- Extending metadata extraction from validated models
- Working with the `gltf-validator` library

## Architecture

```
src/validator.js                    → Validator class: runs validation, processes reports
src/components/validator-toggle.jsx → Status badge (error/warning/info/hint counts)
src/components/validator-report.jsx → Full report lightbox with metadata + issue tables
src/components/validator-table.jsx  → Individual issue severity table rendering
```

## Validation Flow

1. **App** calls `validator.validate(rootFile, rootPath, assetMap, response)` after model loads
2. **Validator** fetches the model bytes via `fetch()` → `ArrayBuffer`
3. Calls `validateBytes()` from `gltf-validator` with external resource resolver
4. Processes the report: groups messages, extracts metadata, computes max severity
5. Renders `ValidatorToggle` — a clickable badge showing issue counts
6. On click → renders `ValidatorReport` in a lightbox overlay

## Severity Levels

| Index | Level    | CSS Class                 |
| ----- | -------- | ------------------------- |
| 0     | Errors   | `report-toggle--errors`   |
| 1     | Warnings | `report-toggle--warnings` |
| 2     | Infos    | `report-toggle--infos`    |
| 3     | Hints    | `report-toggle--hints`    |

Messages are grouped by `code` and `message` text. Grouped messages show a count badge.

## Key Methods

| Method                          | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `validate()`                    | Entry point — fetches model, runs validator, sets report             |
| `resolveExternalResource()`     | Resolves URIs for multi-file glTF validation                         |
| `setReport()`                   | Processes raw validator output, groups messages, updates UI          |
| `setResponse()`                 | Extracts metadata (generator, title, author, license) from glTF JSON |
| `showToggle()` / `hideToggle()` | Controls visibility of the validation badge                          |

## Components (vhtml JSX)

Components are **pure functions** returning HTML strings via `vhtml`:

- **ValidatorToggle(report)** — Badge with severity icon + counts
- **ValidatorReport(report)** — Full report: metadata table + issue tables per severity
- **ValidatorTable(messages)** — Table rows for a single severity group

## Procedure

1. Validation logic changes → edit `src/validator.js`
2. Report display changes → edit the relevant component in `src/components/`
3. Styling → edit `.report-toggle`, `.report` classes in `style.css`
4. Test by dropping a glTF/GLB file and clicking the validation badge
5. Use [glTF Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/) for testing
