# OpenAI Showcase submission: Self-Correcting 3D Collection Builder

Submission form: <https://openai.com/form/showcase-submission/>

This packet is ready to paste into the form. The public demo, notebook, and cover image all return HTTP 200. The final two attestations must be completed by a person authorized to accept the Showcase Gallery Program Agreement for three.ws.

## About you

| Field | Value |
| --- | --- |
| First name | Nicholas |
| Last name | Resendez |
| Email | support@three.ws |
| Website | https://three.ws |

## About the project

**What type of project is this?**

Interactive 3D demo

**Did you use Codex to build this?**

Yes

**Did you use another coding agent?**

Yes: Claude Code

**Tech stack**

Python, Jupyter, OpenAI Python SDK, Responses API, Requests, Pillow, model-viewer, and the three.ws REST API

**Use cases**: 128/255 characters

Creative tools, 3D asset generation, game and scene prototyping, automated visual quality assurance, and bounded agentic repair.

**Which capability is showcased?**: 442/1000 characters

An OpenAI model turns one creative brief into structured art direction, emits several function calls in one turn to build a coordinated asset set in parallel, and reviews standardized renders with vision. Structured Outputs convert the visual review into per-asset pass/fail decisions and specific repair prompts. A bounded retry loop regenerates only failed assets, producing a themed set of downloadable GLB files with interactive previews.

**Which OpenAI models and APIs?**: 135/500 characters

gpt-5-mini through the Responses API, using function calling with parallel tool calls, image inputs for vision, and Structured Outputs.

**Other models and APIs**: 105/255 characters

Microsoft TRELLIS through NVIDIA NIM for text-to-3D generation, plus the free three.ws GLB rendering API.

**Building process and use of coding agents**: 340/500 characters

Claude Code supported the original project work. Codex audited the implementation, updated it against the current OpenAI Cookbook, resolved merge conflicts, ran every notebook cell, and verified a live end-to-end generation. The demo uses a bounded plan -> generate -> inspect -> repair loop so model decisions remain visible and reproducible.

## Project details

| Field | Value |
| --- | --- |
| Public GitHub URL | https://github.com/nirholas/openai-cookbook/blob/add-text-to-3d-function-calling-cookbook/examples/third_party/text_to_3d_with_function_calling.ipynb |
| Hosted URL | https://three.ws/cookbook/self-correcting-3d/ |
| Author display names | Nicholas Resendez / three.ws |
| Public cover image | https://three.ws/cookbook/houseplant-set.png |

**Setup steps**: 329/500 characters

Open the hosted tutorial for a read-only walkthrough. To run it, clone nirholas/openai-cookbook, check out add-text-to-3d-function-calling-cookbook, install openai, requests, Pillow, and ipython, set OPENAI_API_KEY, change RUN_LIVE to True, and run all notebook cells. The three.ws generation and rendering endpoints need no key.

**Project title**: 37/255 characters

Self-Correcting 3D Collection Builder

**Tagline**: 125/255 characters

Turn one creative brief into a coordinated set of downloadable 3D models, then automatically inspect and repair weak results.

**Description**: 762/1000 characters

Self-Correcting 3D Collection Builder turns a short theme into a coordinated set of textured 3D props. The model acts as an art director, creates a structured plan, and launches multiple text-to-3D function calls in parallel. Each result is a standard GLB that can be previewed in the browser or downloaded for Blender, Unity, Unreal, or a glTF workflow.

The same workflow renders every model from consistent angles and uses vision to evaluate shape, materials, coherence, and usability. Structured verdicts identify weak assets and generate targeted repair prompts, while a bounded retry loop rebuilds only the failures. The public notebook exposes each decision and includes a keyless mode so readers can inspect the full flow before running paid model calls.

## Final human attestations

- Confirm that three.ws owns or has permission to use the cover image and all submitted content.
- Review and accept the Showcase Gallery Program Agreement as an authorized representative of three.ws.
- Confirm that the submitted information is accurate.

These attestations are intentionally not pre-accepted in the JSON because they create legal representations to OpenAI.
