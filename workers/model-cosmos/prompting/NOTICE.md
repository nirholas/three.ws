# Vendored Cosmos 3 prompting materials

These files come from NVIDIA's `cosmos-framework` repository (commit
`e40831fa068fd171894b6cfb269308b441e80a85`) and are distributed under the
OpenMDW License Agreement, version 1.1. A copy of that agreement sits next to
them in `LICENSE-OpenMDW-1.1.txt`.

Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

| File here | Upstream path |
| --- | --- |
| `t2v_i2v_video_prompt.txt` | `cosmos_framework/inference/prompting_templates/external_api/t2v_i2v_video_prompt.txt` |
| `t2v_i2v_video_json_schema.json` | `cosmos_framework/inference/prompting_templates/external_api/t2v_i2v_video_json_schema.json` |
| `negative_video.json` | `cosmos_framework/inference/defaults/neg_prompts.json` |
| `negative_transfer.json` | `.agents/skills/cosmos3-inference-transfer/assets/negative_prompt.json` |

They are used unmodified. `upsampler.py` fills the prompt template the same
way upstream's `prompt_upsampling.build_t2v_prompt_text` does.
