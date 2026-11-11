# microsoft 07: agents learn from Word, PowerPoint, Excel and Outlook files (MarkItDown)

Status 2026-11-11: built and verified locally (worker, ingestion API, chat retrieval with citations, Knowledge panel, docs). Waiting on the owner to deploy workers/markitdown, set GCP_MARKITDOWN_URL on three-ws-api, push and deploy. See the 807 entry in _context/microsoft-PROGRESS.md.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3107.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

An enterprise buyer from Microsoft Marketplace wants a brand agent that knows their product. Their knowledge lives in `.docx` handbooks, `.pptx` decks, `.xlsx` price sheets, PDFs and `.msg` emails. Microsoft's MarkItDown (open source, MIT) converts all of those to clean Markdown that LLMs read well. Wiring it into agent knowledge turns "upload your Office files, your agent knows them" into a one-step setup that reads as Microsoft-native to every enterprise evaluator.

## Step 0: re-derive the current state

    grep -rln -i "knowledge" api src packages/agent-memory packages/agent-runtime --include=*.js | head -20
    grep -rn -i "embedding\|pgvector\|vector(" api/_lib --include=*.js --include=*.sql | head -20
    grep -rn -i "upload" api/agents -l | head
    ls workers | head -60
    sed -n 1,60p docs/ops/gcp-model-workers.md

Find how agents hold knowledge today (memory tables, embeddings, retrieval in `api/chat.js` or the runtime). Read MarkItDown's README and LICENSE for supported formats, optional dependencies and the security notes it publishes.

## Tasks

1. **Conversion service.** `workers/markitdown/`: a small Python service (Dockerfile, pinned MarkItDown version, only the format extras needed: docx, pptx, xlsx, pdf, outlook) exposing `POST /convert` that accepts a file and returns Markdown plus metadata (title, page or slide count). Hardening: size cap, MIME and magic-number checks, zip-bomb guard for OOXML (uncompressed size and entry count caps), no network access from conversion, no plugins, a per-request timeout. Built and verified through Cloud Build per [the long-run memory pattern](../../../docs/ops/gcp-model-workers.md); deploying the new service is in the owner message unless the owner already approved it.
2. **Ingestion API.** An authenticated endpoint on the agent (follow the existing `api/agents/...` pattern) that sends the file to the service, chunks the Markdown on headings (slides and sheets stay intact as units), embeds with the embedding path the repo already uses, and stores chunks with a source document record (name, type, size, uploaded by, chunk count) so it can be listed and deleted. Delete removes chunks.
3. **Retrieval.** The agent's chat path retrieves the top chunks for a question and cites the source document name in the answer when it used one. Reuse existing retrieval if present; otherwise add it with a test.
4. **UI.** A "Knowledge" section in the agent editor: drag and drop Office files, per-file progress from the real request, the list of sources with chunk counts, delete, and an "Ask a question to test" box that shows which chunks were used. Empty state explains which file types work.
5. **Docs.** `docs/agent-knowledge.md` (formats, limits, privacy: where files and chunks are stored and how to delete them), README in `workers/markitdown/`, STRUCTURE.md row, changelog entry.

## Definition of done

- [ ] Test-first tests for chunking (headings, slides, sheets), the zip-bomb guard, and the ingestion handler's auth and size checks.
- [ ] Real public-domain or self-authored `.docx`, `.pptx`, `.xlsx`, `.pdf` and `.msg` files convert through the built container and an agent answers a question from each with the source cited (transcript in the report).
- [ ] The editor UI works on port 3107 with real uploads; loading, empty and error states verified; no console errors.
- [ ] Docs, worker README, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No existing embedding path | Use Vertex AI text embeddings (GCP, pre-approved) behind the repo's existing Vertex client. |
| Deploying the new Cloud Run service | Verify the image with a Cloud Build or Cloud Run job run; put the deploy command in the owner message. Locally, run the container with Docker for the end-to-end test. |
| Vertex returns 403 | Check the GCP billing memory first (`gcp-vertex-billing-403`); it may be billing, not auth. Name it in the owner message and finish with a local embedding fallback only if one already exists in the repo. |
| Missing credential or env var | `node scripts/read-service-env.mjs`; if absent everywhere, wire behind the variable and name it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
