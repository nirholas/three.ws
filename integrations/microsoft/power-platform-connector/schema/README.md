# Vendored schemas

Validation runs offline against these files. Do not edit them by hand except as listed here.

| File | Source | License |
|---|---|---|
| `swagger-2.0.schema.json` | OAI/OpenAPI-Specification `_archive_/schemas/v2.0/schema.json` | Apache-2.0 |
| `microsoft-apiDefinition.swagger.schema.json` | microsoft/PowerPlatformConnectors `schemas/apiDefinition.swagger.schema.json` at commit `2ab73144c707c00b1f8b6ba062cc74a72e792113` (2025-11-28) | MIT |
| `microsoft-paconn-apiProperties.schema.json` | microsoft/PowerPlatformConnectors `schemas/paconn-apiProperties.schema.json` at the same commit | MIT |

## Changes from upstream

The two Microsoft files are the ones the PowerPlatformConnectors repository validates certified connectors against. Upstream they are JSON with comments. Each change below keeps validation meaning the same, except the last, which follows the current certification guidance:

- Normalized to strict JSON (comments and trailing commas removed) with the `json5` parser, so Ajv can load them.
- Two description strings that only held an upstream placeholder note were removed. Descriptions do not affect validation.
- `GlobalPerConnector` was added to the `redirectMode` enum in the properties schema. The upstream enum still lists only `Global` and `Direct`, but Microsoft now requires `GlobalPerConnector` for new certified connectors, and the connector uses it.

To refresh, download the two files from the repository's `schemas/` folder, normalize them with `json5`, and reapply the changes above.
