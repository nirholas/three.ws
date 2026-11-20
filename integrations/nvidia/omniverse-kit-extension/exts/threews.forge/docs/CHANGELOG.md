# Changelog

## [Unreleased]

### Changed

- Every lane needs a three.ws API key, because making a model on three.ws now
  needs an account. The panel asks for a key before it sends or uploads
  anything, sends it on every three.ws API call (never to the CDN or a storage
  URL), and explains a `sign_in_required` answer. Draft and Standard stay free.

## [1.0.0] - 2026-11-16

### Added

- Forge panel (Window > three.ws Forge): text prompt or reference image (local
  file or public URL), Draft, Standard and High lanes, live job progress and
  cancel, without blocking Kit.
- Import into the open stage at the world origin, the selected prim, or in front
  of the camera, with the glTF Y-up meter axes corrected for the stage's
  `upAxis` and `metersPerUnit`.
- GLB through the Kit asset converter; library models stored as USDZ are
  referenced directly.
- Local decoding of web-optimized GLBs (EXT_meshopt_compression,
  KHR_mesh_quantization, EXT_texture_webp) so saved models import.
- My models browser with paging and one-click import.
- API key in Kit persistent settings or `THREEWS_API_KEY`, masked and never
  logged, with specific messages for a missing, invalid, under-scoped or
  under-funded key.
- Retries with exponential backoff on network errors and 429/502/503/504.
- `omni.kit.test` suite: headless unit and import tests, panel tests on a GPU
  node, and live end-to-end tests against the real API.
