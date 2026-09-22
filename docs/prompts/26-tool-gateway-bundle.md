# 26. The tool gateway: search, browser, image, video, speech and transcription under one credit balance

Read `docs/prompts/README.md` first.

## The problem

Generation exists in pieces: 3D and image forge lanes, vision, assistant speech, announcement voice. There is no single set of general-purpose tools an agent gets by default and pays for with the same credits: web search, page fetch and browser automation, image generation, video generation, text to speech, speech to text, and document parsing. Competing platforms bundle all of these under one subscription so a developer does not collect five vendor keys.

## Build

- Tools on the unified endpoint under a `gateway` group: `web_search`, `web_fetch` (readable extraction), `browser` (Playwright on Cloud Run with session persistence, screenshot and act), `image_generate` (the existing forge lanes, GCP Imagen first), `video_generate` (Veo on Vertex), `tts`, `transcribe`, `parse_document` (PDF, DOCX, spreadsheets). Each backed by GCP where GCP has the capability; the existing lanes and failover chains reused; no new paid vendor without approval (list any gap as the missing var).
- Metering per call in credits through `api/_lib/llm-metering-rule.js` or a sibling, with prices on `/pricing` and in the model catalog response.
- Default on for every agent at the read tier; results are untrusted data.
- The local runtime (prompt 20) and the SDK (prompt 06) expose them.
- Docs: `docs/tool-gateway.md` linked from `docs/start-here.md`; changelog entry tagged `feature`.

## Acceptance

- An agent asked to research a token, screenshot its site, and summarize it uses `web_search`, `browser` and the model, and the run shows the cost per step.
- `tts` and `transcribe` round-trip a sentence.
- `npm test` green.
