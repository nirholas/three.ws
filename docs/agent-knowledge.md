# Agent knowledge: teach an agent from your Office files

An agent can learn from the documents you already have: a Word handbook, a PowerPoint deck, an Excel price list, a PDF policy, an Outlook email. Upload them on the agent's edit page and the agent answers from them in chat, naming the file it used.

PDFs are read as layout, not just as text: tables keep their rows and columns, charts are read into values, and scanned pages are read with OCR (see [How PDFs are read](#how-pdfs-are-read)). Office files and emails are converted with [Microsoft MarkItDown](https://github.com/microsoft/markitdown), the open-source document-to-Markdown converter, inside our own hardened worker ([workers/markitdown/](../workers/markitdown/README.md)). three.ws and Microsoft have announced a partnership; MarkItDown itself is MIT-licensed open source and is used here as such.

## Where to find it

`/agents/<id>/edit`, **Knowledge** tab. The Documents section at the top of the tab has:

- **Drop zone.** Drag files in, or click (Enter or Space from the keyboard) to pick them. Several files upload at once, each with its own progress bar that follows the real upload, then a "Reading and indexing" stage while the server converts and embeds it.
- **PDF progress and table preview.** A PDF shows "Read page 3 of 12" as each page is read, and a "2 tables found so far · preview" button that opens the tables already extracted, before the document finishes.
- **Source list.** Every document with its format, chunk count (and slides, sheets or pages where the format has them), size, upload date, and a two-step Delete. A PDF with tables has **View tables**, which renders every table it extracted with its page number and caption, so you can check what the agent learned.
- **Ask a question to test.** Type a question and see exactly which passages retrieval picks (document, heading or slide/sheet/page, similarity score, excerpt), then the agent's real streamed answer and the documents it was grounded in. This is the same retrieval the public chat uses, so what you see is what visitors get.
- **Empty state.** With no documents yet, the panel lists the supported formats and what to upload.

## Supported formats

| Format | Extension | How it is split into chunks |
| --- | --- | --- |
| Word | `.docx` | On headings. A long section is split on paragraph boundaries and keeps its heading path. |
| PowerPoint | `.pptx` | One chunk per slide, speaker notes included, labelled with the slide number and title. |
| Excel | `.xlsx` | One chunk per sheet. A very large sheet splits on row boundaries with its header row repeated, so every chunk is still a readable table. |
| PDF | `.pdf` | By layout: every table is its own chunk (Markdown, caption attached), every chart is a chunk with its labels and plotted values, and prose is split on paragraphs within the page. Scanned pages are read with OCR. |
| Outlook email | `.msg` | The whole email (subject, sender, body) as one unit, labelled with its subject. |

Legacy binary formats (`.doc`, `.ppt`, `.xls`) and password-protected files are not supported. A file whose contents do not match its extension is refused with a clear message (for example "The file is named .docx but its contents are an unrecognised format.").

## Limits

| Limit | Value |
| --- | --- |
| File size | 25 MB per file |
| Documents per agent | 50 |
| Chunks kept per document | 600 (extra chunks are dropped and the count is recorded) |
| Chunk size | about 450 tokens; a slide, sheet or email stays whole up to 1,500 tokens |
| Office package safety | at most 5,000 parts, 300 MB uncompressed, 100x compression per part, no nested archives |
| Conversion time | 120 seconds (Office files and email) |
| PDF pages per upload | 60 on the free plan, 300 on Pro and Team, 1,000 on Enterprise. A longer PDF is refused up front with `413 too_many_pages` and a message saying how to split it. |

Uploading a file that is byte-identical to one the agent already has is a no-op (HTTP 200 with `duplicate: true`): the panel says "Already in this agent's knowledge."

## How PDFs are read

A PDF upload becomes a job that reads the file page by page with NVIDIA NeMo Retriever extraction models (hosted on NVIDIA's API; three.ws is a member of the NVIDIA Inception program):

1. Each page is rendered to an image and `nemotron-page-elements-v3` finds its tables, charts, titles, paragraphs and captions.
2. **Tables:** `nemotron-table-structure-v1` finds the row and column grid; the words in each cell come from the PDF's own text layer, or from `nemotron-ocr-v2` on a scanned page. The result is a Markdown table with its caption ("Table 2: ...").
3. **Charts:** `nemotron-graphic-elements-v1` finds the title, axis labels, categories and legend, then `nemotron-3.5-super-vl` reads the plotted values against those labels, marking estimates read from bar heights with "about".
4. **Text:** the text layer in reading order (columns are followed, page headers and footers dropped), or OCR when the page has no text layer.

Then the blocks are chunked. A table is one chunk; a table too big to embed whole is embedded by a digest of its caption, header row and row labels, so a question about any row still finds it, while the whole table is what the agent reads. On the eval set this lifts answer accuracy on chart and scanned-page questions sharply and keeps born-digital tables at least as good as before ([docs/nvidia/evals/pdf-extraction-2026-11-16.md](nvidia/evals/pdf-extraction-2026-11-16.md)).

**Fallback.** If the layout models fail for a document (a model retired, the API down, a page timing out), the whole document is read with the previous extractor instead: MarkItDown when the worker is configured, otherwise the PDF's text layer. The upload still succeeds, and the source list notes "Read as plain text". A scanned PDF needs the layout path; if it is unavailable the upload fails with `422 no_text` and asks you to try again later.

**Progress without hanging requests.** The upload answers `202` with a job right away. The panel advances the job by calling its `step` route (about 20 seconds of reading per call) and shows each page as it lands. If you close the tab, the `knowledge-pdf-jobs` cron picks the job up within a minute or two and finishes it.

## How the agent uses it

On every chat message to a visible agent, the message is embedded and compared with the agent's chunks. Up to 4 passages above a relevance floor (about 6,000 characters in total) are added to the per-message part of the system prompt, each tagged `[Source: <file> | <heading>]`. The model is told to answer from them, to cite the file name, and to treat the passages as reference data rather than instructions, so text inside a document cannot redirect the agent. The persona part of the prompt is unchanged, which keeps prompt caching intact.

The chat stream's final `done` event lists the passages used (`knowledge: [{ doc_id, name, heading, locator, score, excerpt }]`), which is how the test box shows its "Grounded in" line.

## Privacy

- **The original file is not stored.** It is converted in memory, chunked and embedded, then discarded. A PDF is held in the job's database row only while its pages are read, and the bytes are deleted the moment the job finishes or fails. three.ws keeps the extracted text chunks, their embeddings, and a document record (name, format, size, SHA-256, chunk count, title and page/slide/sheet counts).
- **Where conversion runs.** Office files and email are converted by the MarkItDown worker on our Google Cloud project, which has no outbound network access for conversion and writes nothing to disk. PDF page images (and crops of their tables and charts) are sent to NVIDIA's hosted API to be read; nothing else about the upload is sent. Set `KNOWLEDGE_PDF_EXTRACTOR=text` to keep PDFs on the text-only path.
- **Embeddings** are computed by the platform's existing embedding provider chain, the same one agent memory uses.
- **Who can see answers drawn from it:** anyone who can chat with the agent. Upload only what you are happy for the agent's audience to learn from. Only the agent's owner can upload, list, test or delete documents.

## Deletion

Delete on a document removes the document record, and the database cascade removes every chunk and embedding derived from it in the same statement. From the next chat message the agent can no longer draw on it. Deleting the agent deletes all of its documents the same way.

## API

All routes are owner-only. Browser sessions use the session cookie, and mutations need the CSRF token. API keys and OAuth tokens need `agents:read` for GET and search, and `agents:write` for upload and delete.

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/agents/:id/knowledge` | none | `{ data: { docs, limits, formats } }` |
| `POST` | `/api/agents/:id/knowledge` | the raw file bytes; `Content-Type` is the file's MIME type and `X-File-Name` the URL-encoded file name | `201 { data: { doc, duplicate } }` (200 when it is a duplicate). A PDF answers `202 { data: { job } }` instead |
| `GET` | `/api/agents/:id/knowledge/jobs` | none | `{ data: { jobs } }`: PDF jobs in flight, and today's failures |
| `GET` | `/api/agents/:id/knowledge/jobs/:jobId` | none | `{ data: { job } }` |
| `POST` | `/api/agents/:id/knowledge/jobs/:jobId/step` | none | `{ data: { job } }` after about 20 seconds of page reading; call again until `job.status` is `done` or `failed` |
| `GET` | `/api/agents/:id/knowledge/:docId/tables` | none | `{ data: { tables: [{ page, caption, markdown }] } }` for a PDF read by layout |
| `POST` | `/api/agents/:id/knowledge/search` | `{ "query": "...", "top_k": 5 }` | `{ data: { query, results: [{ doc_id, name, kind, heading, locator, score, content, excerpt }], chunks_searched, reranked } }` (`top_k` 1 to 10) |
| `DELETE` | `/api/agents/:id/knowledge/:docId` | none | `{ data: { deleted: true, id, docs, limits, formats } }` |

A job is `{ id, name, status, page_count, pages_done, tables: [{ page, caption, markdown, truncated }], stats: { tables, charts, scanned_pages }, extractor, fallback_reason, error, doc_id, doc }`. `status` moves `queued` → `extracting` → `indexing` → `done` (or `failed`, with `error: { code, message }`). The table previews in a running job are capped at 24 tables of 4,000 characters each; the stored document keeps every table whole.

Example upload with an API key:

```bash
curl -X POST "https://three.ws/api/agents/$AGENT_ID/knowledge" \
  -H "Authorization: Bearer $THREE_WS_API_KEY" \
  -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  -H "X-File-Name: handbook.docx" \
  --data-binary @handbook.docx
```

Errors use the house shape `{ error, error_description }`: `missing_file_name` (400), `unsupported_type` (415), `type_mismatch` (415, the contents or MIME type do not match the extension), `file_too_large` (413), `empty_file` (400), `invalid_file` / `zip_bomb` (400, unreadable, encrypted or unsafe Office package), `too_many_docs` (409), `too_many_pages` (413, with `page_count` and `page_limit`), `encrypted_pdf` / `unreadable_pdf` (422), `no_text` (422), `embed_failed` (502), `converter_unavailable` (Office files and email only: 503 when not configured, 502 when the worker fails or times out), `embedder_unavailable` (503).

## Code map

- Worker: [workers/markitdown/](../workers/markitdown/README.md) (FastAPI + MarkItDown, upload policy and zip-bomb guard in `policy.py`).
- Pipeline: [api/_lib/agent-knowledge.js](../api/_lib/agent-knowledge.js) (convert, chunk, embed, store, search, chat retrieval), chunker [api/_lib/knowledge-chunker.js](../api/_lib/knowledge-chunker.js).
- PDF layout path: [api/_lib/knowledge-pdf-jobs.js](../api/_lib/knowledge-pdf-jobs.js) (jobs, steps, fallback), [api/_lib/pdf-extract.js](../api/_lib/pdf-extract.js) (one page into blocks), [api/_lib/pdf-layout.js](../api/_lib/pdf-layout.js) (geometry: cells, captions, reading order), [api/_lib/pdf-render.js](../api/_lib/pdf-render.js) (pdf.js render and text layer), [api/_lib/nvidia-doc-extract.js](../api/_lib/nvidia-doc-extract.js) (the NVIDIA model calls), `chunkPdfBlocks` in the chunker, and the cron [api/cron/knowledge-pdf-jobs.js](../api/cron/knowledge-pdf-jobs.js).
- Routes: [api/agents/[id]/knowledge.js](../api/agents/[id]/knowledge.js).
- Chat wiring: [api/chat.js](../api/chat.js) (`retrieveForChat`, `knowledgePromptBlock`).
- UI: [src/agent-knowledge-docs.js](../src/agent-knowledge-docs.js), mounted by [src/agent-edit.js](../src/agent-edit.js).
- Schema: `agent_knowledge_docs` and `agent_knowledge_chunks` (migration `20261111161519_agent_knowledge.sql`), `agent_knowledge_jobs` (migration `20261116182500_agent_knowledge_pdf_jobs.sql`).
- Eval and live check: `npm run nvidia:pdf-eval` ([scripts/nvidia-pdf-extraction-eval.mjs](../scripts/nvidia-pdf-extraction-eval.mjs), set in `data/evals/pdf-extraction/`), `npm run knowledge:pdf-live-check` ([scripts/knowledge-pdf-live-check.mjs](../scripts/knowledge-pdf-live-check.mjs): upload in a real browser against an isolated database, then ask the agent).
- Tests: [tests/knowledge-pdf-jobs.test.js](../tests/knowledge-pdf-jobs.test.js), [tests/knowledge-pdf-chunker.test.js](../tests/knowledge-pdf-chunker.test.js), [tests/pdf-layout.test.js](../tests/pdf-layout.test.js), [tests/knowledge-markdown-table.test.js](../tests/knowledge-markdown-table.test.js), [tests/agent-knowledge-chunker.test.js](../tests/agent-knowledge-chunker.test.js), [tests/agent-knowledge-api.test.js](../tests/agent-knowledge-api.test.js), [tests/chat-agent-knowledge.test.js](../tests/chat-agent-knowledge.test.js), worker `test_policy.py` and `test_convert.py`.

## Configuration

`GCP_MARKITDOWN_URL` points the API at the worker; the worker authenticates callers with the shared `GCP_RECONSTRUCTION_KEY`. Without `GCP_MARKITDOWN_URL`, Office and email uploads return `503 converter_unavailable` and the rest of the agent works as before; PDFs still upload.

PDFs use the layout path whenever `NVIDIA_API_KEY` is set. `KNOWLEDGE_PDF_EXTRACTOR=text` forces the text path (MarkItDown when configured, else the PDF text layer) for every upload.
