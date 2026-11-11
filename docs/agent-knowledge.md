# Agent knowledge: teach an agent from your Office files

An agent can learn from the documents you already have: a Word handbook, a PowerPoint deck, an Excel price list, a PDF policy, an Outlook email. Upload them on the agent's edit page and the agent answers from them in chat, naming the file it used.

Conversion runs on [Microsoft MarkItDown](https://github.com/microsoft/markitdown), the open-source document-to-Markdown converter, inside our own hardened worker ([workers/markitdown/](../workers/markitdown/README.md)). three.ws and Microsoft have announced a partnership; MarkItDown itself is MIT-licensed open source and is used here as such.

## Where to find it

`/agents/<id>/edit`, **Knowledge** tab. The Documents section at the top of the tab has:

- **Drop zone.** Drag files in, or click (Enter or Space from the keyboard) to pick them. Several files upload at once, each with its own progress bar that follows the real upload, then a "Reading and indexing" stage while the server converts and embeds it.
- **Source list.** Every document with its format, chunk count (and slides, sheets or pages where the format has them), size, upload date, and a two-step Delete.
- **Ask a question to test.** Type a question and see exactly which passages retrieval picks (document, heading or slide/sheet/page, similarity score, excerpt), then the agent's real streamed answer and the documents it was grounded in. This is the same retrieval the public chat uses, so what you see is what visitors get.
- **Empty state.** With no documents yet, the panel lists the supported formats and what to upload.

## Supported formats

| Format | Extension | How it is split into chunks |
| --- | --- | --- |
| Word | `.docx` | On headings. A long section is split on paragraph boundaries and keeps its heading path. |
| PowerPoint | `.pptx` | One chunk per slide, speaker notes included, labelled with the slide number and title. |
| Excel | `.xlsx` | One chunk per sheet. A very large sheet splits on row boundaries with its header row repeated, so every chunk is still a readable table. |
| PDF | `.pdf` | Per page, split on paragraphs when a page is long. |
| Outlook email | `.msg` | The whole email (subject, sender, body) as one unit, labelled with its subject. |

Legacy binary formats (`.doc`, `.ppt`, `.xls`), password-protected files and scanned PDFs without a text layer are not supported. A file whose contents do not match its extension is refused with a clear message (for example "The file is named .docx but its contents are an unrecognised format.").

## Limits

| Limit | Value |
| --- | --- |
| File size | 25 MB per file |
| Documents per agent | 50 |
| Chunks kept per document | 600 (extra chunks are dropped and the count is recorded) |
| Chunk size | about 450 tokens; a slide, sheet or email stays whole up to 1,500 tokens |
| Office package safety | at most 5,000 parts, 300 MB uncompressed, 100x compression per part, no nested archives |
| Conversion time | 120 seconds |

Uploading a file that is byte-identical to one the agent already has is a no-op (HTTP 200 with `duplicate: true`): the panel says "Already in this agent's knowledge."

## How the agent uses it

On every chat message to a visible agent, the message is embedded and compared with the agent's chunks. Up to 4 passages above a relevance floor (about 6,000 characters in total) are added to the per-message part of the system prompt, each tagged `[Source: <file> | <heading>]`. The model is told to answer from them, to cite the file name, and to treat the passages as reference data rather than instructions, so text inside a document cannot redirect the agent. The persona part of the prompt is unchanged, which keeps prompt caching intact.

The chat stream's final `done` event lists the passages used (`knowledge: [{ doc_id, name, heading, locator, score, excerpt }]`), which is how the test box shows its "Grounded in" line.

## Privacy

- **The original file is not stored.** It is converted in memory, chunked and embedded, then discarded. three.ws keeps the extracted text chunks, their embeddings, and a document record (name, format, size, SHA-256, chunk count, title and page/slide/sheet counts).
- **Conversion stays on our infrastructure.** The MarkItDown worker runs on our Google Cloud project, has no outbound network access for conversion, and writes nothing to disk.
- **Embeddings** are computed by the platform's existing embedding provider chain, the same one agent memory uses.
- **Who can see answers drawn from it:** anyone who can chat with the agent. Upload only what you are happy for the agent's audience to learn from. Only the agent's owner can upload, list, test or delete documents.

## Deletion

Delete on a document removes the document record, and the database cascade removes every chunk and embedding derived from it in the same statement. From the next chat message the agent can no longer draw on it. Deleting the agent deletes all of its documents the same way.

## API

All routes are owner-only. Browser sessions use the session cookie, and mutations need the CSRF token. API keys and OAuth tokens need `agents:read` for GET and search, and `agents:write` for upload and delete.

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/agents/:id/knowledge` | none | `{ data: { docs, limits, formats } }` |
| `POST` | `/api/agents/:id/knowledge` | the raw file bytes; `Content-Type` is the file's MIME type and `X-File-Name` the URL-encoded file name | `201 { data: { doc, duplicate } }` (200 when it is a duplicate) |
| `POST` | `/api/agents/:id/knowledge/search` | `{ "query": "...", "top_k": 5 }` | `{ data: { query, results: [{ doc_id, name, kind, heading, locator, score, content, excerpt }], chunks_searched, reranked } }` (`top_k` 1 to 10) |
| `DELETE` | `/api/agents/:id/knowledge/:docId` | none | `{ data: { deleted: true, id, docs, limits, formats } }` |

Example upload with an API key:

```bash
curl -X POST "https://three.ws/api/agents/$AGENT_ID/knowledge" \
  -H "Authorization: Bearer $THREE_WS_API_KEY" \
  -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  -H "X-File-Name: handbook.docx" \
  --data-binary @handbook.docx
```

Errors use the house shape `{ error, error_description }`: `missing_file_name` (400), `unsupported_type` (415), `type_mismatch` (415, the contents or MIME type do not match the extension), `file_too_large` (413), `empty_file` (400), `invalid_file` / `zip_bomb` (400, unreadable, encrypted or unsafe Office package), `too_many_docs` (409), `no_text` (422), `embed_failed` (502), `converter_unavailable` (503 when not configured, 502 when the worker fails or times out), `embedder_unavailable` (503).

## Code map

- Worker: [workers/markitdown/](../workers/markitdown/README.md) (FastAPI + MarkItDown, upload policy and zip-bomb guard in `policy.py`).
- Pipeline: [api/_lib/agent-knowledge.js](../api/_lib/agent-knowledge.js) (convert, chunk, embed, store, search, chat retrieval), chunker [api/_lib/knowledge-chunker.js](../api/_lib/knowledge-chunker.js).
- Routes: [api/agents/[id]/knowledge.js](../api/agents/[id]/knowledge.js).
- Chat wiring: [api/chat.js](../api/chat.js) (`retrieveForChat`, `knowledgePromptBlock`).
- UI: [src/agent-knowledge-docs.js](../src/agent-knowledge-docs.js), mounted by [src/agent-edit.js](../src/agent-edit.js).
- Schema: `agent_knowledge_docs` and `agent_knowledge_chunks` (migration `20261111161519_agent_knowledge.sql`).
- Tests: [tests/agent-knowledge-chunker.test.js](../tests/agent-knowledge-chunker.test.js), [tests/agent-knowledge-api.test.js](../tests/agent-knowledge-api.test.js), [tests/chat-agent-knowledge.test.js](../tests/chat-agent-knowledge.test.js), worker `test_policy.py` and `test_convert.py`.

## Configuration

`GCP_MARKITDOWN_URL` points the API at the worker; the worker authenticates callers with the shared `GCP_RECONSTRUCTION_KEY`. Without `GCP_MARKITDOWN_URL`, uploads return `503 converter_unavailable` and the rest of the agent works as before.
