# nvidia 08: agents understand PDF tables, charts and scanned pages through NVIDIA NeMo Retriever extraction

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3258.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Agents learn from uploaded documents, but plain text extraction drops what matters most in business PDFs: tables, charts and scanned pages. NVIDIA's NeMo Retriever extraction models (page elements, table structure, graphic elements, OCR) are hosted on the same API surface and built for exactly this. An agent that can answer "what was Q3 revenue in the table on page 12" is a visible quality jump and a strong NVIDIA retrieval story.

## Step 0: re-derive the current state

    grep -rln "knowledge" api/_lib | xargs grep -ln -i "pdf\|extract" | head
    ls workers/markitdown 2>/dev/null && sed -n 1,40p workers/markitdown/README.md
    grep -rn "application/pdf" api --include=*.js | head

Read NVIDIA's current docs for the NeMo Retriever extraction models available on build.nvidia.com (model ids, request shapes, limits) and probe each with a real page image.

## Tasks

1. **Extraction pipeline**: PDF to page images (an open-source renderer), page-element detection, tables to markdown via table structure plus OCR, charts to descriptive text via graphic elements, text regions via existing extraction or OCR for scanned pages. Runs off the request path (worker or job) with progress.
2. **Chunking** that keeps tables whole, carries page numbers and element type, and links each chunk back to its page.
3. **Integration** as the PDF extractor for agent knowledge with fallback to the current extractor on any failure. Behind a setting until the eval passes, then default.
4. **Eval** on licence-clean real PDFs (for example CC-BY papers and public filings) with questions answerable only from tables or charts; answer accuracy before and after. Report in `docs/nvidia/evals/pdf-extraction-<date>.md`.
5. **UI**: the knowledge upload shows per-page progress and a preview of extracted tables, with loading, error and empty states.
6. **Tests**, docs (knowledge docs and [docs/nvidia-models.md](../../docs/nvidia-models.md), anchored edit last), changelog entry.

## Definition of done

- [ ] Eval shows the before and after accuracy (report path).
- [ ] A real PDF uploaded on the dev server produces table chunks an agent answers from correctly (output in the report).
- [ ] Tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A NeMo Retriever model is not hosted for our key | Use the ones that are; for a missing step use an open-source equivalent and say which. |
| Large PDFs | Page-level batching with a cursor; cap pages per upload by plan with a clear message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
