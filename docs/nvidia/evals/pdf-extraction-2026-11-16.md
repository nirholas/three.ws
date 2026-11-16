# PDF extraction eval, 2026-11-16

How well an agent answers questions about a PDF its owner uploaded, before and after PDF knowledge moved to the NVIDIA NeMo Retriever page models (`nemotron-page-elements-v3`, `nemotron-table-structure-v1`, `nemotron-graphic-elements-v1`, `nemotron-ocr-v2`, with `nemotron-3.5-super-vl-120b-a12b` reading chart values). Feature doc: [docs/agent-knowledge.md](../../agent-knowledge.md#how-pdfs-are-read). Status: under evaluation until the `three-ws-api` deploy that ships it.

## Result

**Answer accuracy rose from 38.6% (17/44, MarkItDown, the extractor in production before) to 90.9% (40/44).** The exact printed value reached the answer model's prompt for every one of the 37 questions that have one (100%, against 56.8% before).

- **Born-digital tables:** 100% (22/22), against 77.3% for MarkItDown and 90.9% for the plain text layer. The baseline was already decent here. MarkItDown's five misses were values it dropped or shifted when it flattened a table into text: LLaMA 1 33B on TriviaQA and Phi-3-small on HumanEval were missing from the prompt, and it answered 74.5 for Italian HellaSwag (gold 70.9), 8.9 for Phi-3-medium MT Bench (8.91) and 14.35 for Mistral's harmful-content summarization rate (22.33).
- **Charts:** 75% (6/8), from 0%. Neither text extractor can see bar heights or line positions. The two misses are a chart reading (Mistral Figure 5: the effective-size arrow read as 34B instead of 23B) and one lowest-bar comparison on Phi-3 Figure 3.
- **A table pasted in as a screenshot:** 100% (3/3), from 0%. The first run scored 0/3 here: the detector boxed the LMSys leaderboard as a table, but its cells were read only from the text layer, which a picture does not have. The fix (OCR the crop when the text layer has no words inside a table box, commit `29406e396`, test `tests/pdf-extract-image-table.test.js`) was re-measured with `--docs mixtral --conditions nemotron`.
- **A scanned copy (every page an image):** 81.8% (9/11), from 0%: both text extractors return nothing at all, so before this change a scanned PDF was rejected as unreadable. Every value reached the prompt; the two misses (Italian HellaSwag in the multilingual table, GPT-4-Turbo MT-bench on the screenshot) are the answer model not finding the cell among the retrieved OCR rows.

## Method

- **Documents.** Three arXiv papers under CC BY 4.0, pinned by version and sha1 in [data/evals/pdf-extraction/set.json](../../../data/evals/pdf-extraction/set.json): Mistral 7B (2310.06825v1), Mixtral of Experts (2401.04088v1), Phi-3 Technical Report (2404.14219v1). The scanned copy is Mixtral rendered at 150 dpi into an image-only PDF by the eval script, with no text layer.
- **Gold answers.** Read off the rendered page images by a person, never from either extractor's output. Numbers pass within a tolerance (exact unless a chart estimate allows more); names pass on a regex.
- **Conditions.** `markitdown` is the production path before this change (MarkItDown, then the generic chunker). `text-layer` is pdf.js page text plus the same chunker, the fallback when the NVIDIA models are off. `nemotron` is the new path: `extractPage` per page, then the layout-aware chunker (`chunkPdfBlocks`).
- **Retrieval and answering mirror chat.** Each condition's chunks are embedded with the production embedder, the top 4 by cosine (pool 12, min score 0.2, 6000 characters) go into the prompt with their headings, and `nemotron-3.5-super-vl-120b-a12b` answers at temperature 0. One fixed answer model keeps the comparison about extraction, not about chat model choice.
- **Reproduce.** `NVIDIA_API_KEY=... npm run nvidia:pdf-eval`. Extraction is cached under `~/.cache/three-ws-pdf-eval`; `-- --report-only` rebuilds this section from `data/evals/pdf-extraction/runs/results-2026-11-16.json`.

## End to end on the dev server

`npm run knowledge:pdf-live-check` uploads the Mistral 7B paper through the real `/agent/:id/edit` page (isolated database, real NVIDIA models), watches the per-page progress and live table preview, opens "View tables", checks that the question retrieves the Table 2 chunk, and asks `/api/chat` (default NVIDIA chat model). A passing run answered "LLaMA 2 13B gets 34.3% on GSM8K. (source: Mistral-7B.pdf, Page 4)". The hosted query embedder answered in 6 to 40 seconds during these runs (20 timed calls, one over 40 s), so some runs lose the document context to the 30 s embed timeout; that is an embedding-lane latency issue, separate from extraction.

<!-- eval:begin -->
Run 2026-11-16: 44 questions over 4 documents (47 pages). Answer model `nvidia/nemotron-3.5-super-vl-120b-a12b` at temperature 0; embedder `nvidia/nemotron-3.5-embed-8b@2048`; reranker off.

### Answer accuracy

| Slice | n | markitdown (before) | text-layer | nemotron (after) |
|---|---:|---:|---:|---:|
| All questions | 44 | 38.6% (17/44) | 45.5% (20/44) | 90.9% (40/44) |
| Tables (born-digital) | 22 | 77.3% (17/22) | 90.9% (20/22) | 100.0% (22/22) |
| Charts (born-digital) | 8 | 0.0% (0/8) | 0.0% (0/8) | 75.0% (6/8) |
| Screenshot of a table (image, no text layer) | 3 | 0.0% (0/3) | 0.0% (0/3) | 100.0% (3/3) |
| Scanned copy (every page an image) | 11 | 0.0% (0/11) | 0.0% (0/11) | 81.8% (9/11) |

### Retrieval: the exact printed value reached the prompt

Tables and the screenshot only (a chart estimate has no exact value to look for). This separates "the extractor lost the number" from "the model misread it".

| Slice | markitdown | text-layer | nemotron |
|---|---:|---:|---:|
| All questions | 56.8% (21/37) | 62.2% (23/37) | 100.0% (37/37) |
| Tables (born-digital) | 90.9% (20/22) | 100.0% (22/22) | 100.0% (22/22) |
| Charts (born-digital) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) |
| Screenshot of a table (image, no text layer) | 0.0% (0/3) | 0.0% (0/3) | 100.0% (3/3) |
| Scanned copy (every page an image) | 0.0% (0/11) | 0.0% (0/11) | 100.0% (11/11) |

### Extraction

| Document | Pages | Condition | Chunks | Tables | Charts | Seconds per page (median / p90) | Wall time |
|---|---:|---|---:|---:|---:|---|---:|
| Mistral-7B.pdf | 9 | markitdown | 17 | n/a | n/a | n/a | 6.8s |
| Mistral-7B.pdf | 9 | text-layer | 18 | n/a | n/a | n/a | 1.0s |
| Mistral-7B.pdf | 9 | nemotron | 28 | 5 | 3 | 5.2 / 22.1 | 26.6s |
| Mixtral-of-Experts.pdf | 13 | markitdown | 22 | n/a | n/a | n/a | 12.6s |
| Mixtral-of-Experts.pdf | 13 | text-layer | 25 | n/a | n/a | n/a | 0.2s |
| Mixtral-of-Experts.pdf | 13 | nemotron | 42 | 8 | 6 | 4.8 / 9.2 | 22.1s |
| Phi-3-Technical-Report.pdf | 12 | markitdown | 22 | n/a | n/a | n/a | 2.1s |
| Phi-3-Technical-Report.pdf | 12 | text-layer | 20 | n/a | n/a | n/a | 0.2s |
| Phi-3-Technical-Report.pdf | 12 | nemotron | 28 | 3 | 4 | 1.7 / 6.4 | 11.3s |
| Mixtral-of-Experts-scanned.pdf | 13 | markitdown | 0 | n/a | n/a | n/a | 1.3s |
| Mixtral-of-Experts-scanned.pdf | 13 | text-layer | 0 | n/a | n/a | n/a | 0.0s |
| Mixtral-of-Experts-scanned.pdf | 13 | nemotron | 42 | 8 | 6 | 3.8 / 9.6 | 23.9s |

### Models called by the nemotron condition

| Model | Calls | Failed | Median latency |
|---|---:|---:|---:|
| `nvidia/nemotron-page-elements-v3` | 47 | 0 | 1.04s |
| `nvidia/nemotron-table-structure-v1` | 24 | 0 | 0.93s |
| `nvidia/nemotron-graphic-elements-v1` | 19 | 0 | 1.08s |
| `nvidia/nemotron-ocr-v2` | 38 | 0 | 0.95s |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | 20 | 1 | 3.92s |

### Every question

| Doc | Kind | Question | Gold | markitdown | text-layer | nemotron |
|---|---|---|---|---|---|---|
| mistral7b | table | What GSM8K score does LLaMA 2 13B get? | 34.3 | pass: 34.3% | pass: 34.3% | pass: 34.3% |
| mistral7b | table | What HumanEval score does Code-Llama 7B get? | 31.1 | pass: 31.1% | pass: 31.1% | pass: 31.1% |
| mistral7b | table | What MATH score does Mistral 7B reach? | 13.1 | pass: 13.1% | pass: 13.1% | pass: 13.1% |
| mistral7b | table | What MT Bench score does Llama 2 7B Chat get? | 6.27 | pass: 6.27 | pass: 6.27 | pass: 6.27 |
| mistral7b | table | What Chatbot Arena ELO rating does Vicuna 13B have? | 1041 | pass: 1041 | pass: 1041 | pass: 1041 |
| mistral7b | table | What MT Bench score does Mistral 7B get when the Llama 2 system prompt is used? | 6.38 | pass: 6.38±0.07 | pass: 6.38 ± 0.07 | pass: 6.38 |
| mistral7b | chart | In Figure 4, which model scores lowest on Math? | /llama\s*2\s*7b/ | fail: not found | fail: Code-Llama 7B | pass: LLaMA 2 7B |
| mistral7b | chart | In Figure 4, which model scores highest on BBH? | /llama\s*1\s*34b/ | fail: not found | fail: not found | pass: LLaMA 1 34B |
| mistral7b | chart | In Figure 5, what effective LLaMA 2 model size (in billions of parameters) does Mistral 7B match on MMLU? | 23 | fail: not found | fail: not found | fail: 34 |
| mistral7b | chart | In Figure 5, roughly what reading comprehension score (percent) does LLaMA 2 13B reach? | 63.3 ±1 | fail: not found | fail: not found | pass: 63 |
| mixtral | table | What TriviaQA score does LLaMA 1 33B get? | 68.5 | fail: not found | fail: not found | pass: 68.5% |
| mixtral | table | What Math score does Mixtral 8x7B get? | 28.4 | pass: 28.4% | pass: 28.4% | pass: 28.4% |
| mixtral | table | What GSM-8K score does GPT-3.5 get? | 57.1 | pass: 57.1% | pass: 57.1% | pass: 57.1% |
| mixtral | table | What MT Bench score does LLaMA 2 70B get? | 6.86 | pass: 6.86 | pass: 6.86 | pass: 6.86 |
| mixtral | table | What Arc-c score does Mixtral 8x7B get in German? | 54.3 | pass: 54.3% | pass: 54.3% | pass: 54.3% |
| mixtral | table | What HellaSwag score does LLaMA 2 70B get in Italian? | 70.9 | fail: 74.5% | fail: 74.5% | pass: 70.9% |
| mixtral | table | What average BOLD sentiment score does Llama 2 70B get for religious_ideology? | 0.188 | pass: 0.188±0.133 | pass: 0.188 | pass: 0.188 |
| mixtral | table | In Table 5, what share of tokens on Github get the same expert as first or second choice at Layer 0? | 49.9 | pass: 49.9% | pass: 49.9% | pass: 49.9% |
| mixtral | image | On the LMSys leaderboard screenshot (Figure 6), what Arena Elo rating does GPT-4-0613 have? | 1158 | fail: not found | fail: not found | pass: 1158 |
| mixtral | image | On the LMSys leaderboard screenshot (Figure 6), what MT-bench score does GPT-4-Turbo have? | 9.32 | fail: not found | fail: not found | pass: 9.32 |
| mixtral | image | On the LMSys leaderboard screenshot (Figure 6), what Arena Elo rating does Claude-1 have? | 1149 | fail: not found | fail: not found | pass: 1149 |
| phi3 | table | What MedQA score does Gemma 7b get? | 50 | pass: 50.0 | pass: 50.0 | pass: 50.0 |
| phi3 | table | What HumanEval score does Phi-3-small get? | 59.1 | fail: not found | pass: 59.1 | pass: 59.1 |
| phi3 | table | What TriviaQA score does Mixtral 8x7b get? | 82.2 | pass: 82.2 | pass: 82.2 | pass: 82.2 |
| phi3 | table | What GSM-8K score does Llama-3-Instruct 8b get? | 77.4 | pass: 77.4 | pass: 77.4 | pass: 77.4 |
| phi3 | table | What MT Bench score does Phi-3-medium get? | 8.91 | fail: 8.9 | pass: 8.91 | pass: 8.91 |
| phi3 | table | What BigBench-Hard score does Phi-2 get? | 59.4 | pass: 59.4 | pass: 59.4 | pass: 59.4 |
| phi3 | table | In Table 1, what Intellectual Property DR-1 defect rate does Gemma have? | 38.33 | pass: 38.33% | pass: 38.33% | pass: 38.33% |
| phi3 | table | In Table 1, what Harmful Content Summarization defect rate does Mistral have? | 22.33 | fail: 14.35% | pass: 22.33% | pass: 22.33% |
| phi3 | chart | In Figure 3, which harm category had the highest score before safety post-training? | /political/ | fail: not found | fail: not found | pass: political_misinfo |
| phi3 | chart | In Figure 3, which harm category had the lowest score after safety post-training? | /model[\s_-]*identity/ | fail: not found | fail: not found | fail: hate_speech |
| phi3 | chart | In Figure 3, roughly what was the model_identity score before safety post-training? | 21 ±3 | fail: not found | fail: not found | pass: 21 |
| phi3 | chart | In Figure 3, roughly what was the cyber score before safety post-training? | 44 ±3 | fail: not found | fail: not found | pass: 44 |
| mixtral-scan | table | What TriviaQA score does LLaMA 1 33B get? | 68.5 | fail: not found | fail: not found | pass: 68.5% |
| mixtral-scan | table | What Math score does Mixtral 8x7B get? | 28.4 | fail: not found | fail: not found | pass: 28.4% |
| mixtral-scan | table | What GSM-8K score does GPT-3.5 get? | 57.1 | fail: not found | fail: not found | pass: 57.1% |
| mixtral-scan | table | What MT Bench score does LLaMA 2 70B get? | 6.86 | fail: not found | fail: not found | pass: 6.86 |
| mixtral-scan | table | What Arc-c score does Mixtral 8x7B get in German? | 54.3 | fail: not found | fail: not found | pass: 54.3% |
| mixtral-scan | table | What HellaSwag score does LLaMA 2 70B get in Italian? | 70.9 | fail: not found | fail: not found | fail: not found |
| mixtral-scan | table | What average BOLD sentiment score does Llama 2 70B get for religious_ideology? | 0.188 | fail: not found | fail: not found | pass: 0.188 |
| mixtral-scan | table | In Table 5, what share of tokens on Github get the same expert as first or second choice at Layer 0? | 49.9 | fail: not found | fail: not found | pass: 49.9% |
| mixtral-scan | image | On the LMSys leaderboard screenshot (Figure 6), what Arena Elo rating does GPT-4-0613 have? | 1158 | fail: not found | fail: not found | pass: 1158 |
| mixtral-scan | image | On the LMSys leaderboard screenshot (Figure 6), what MT-bench score does GPT-4-Turbo have? | 9.32 | fail: not found | fail: not found | fail: not found |
| mixtral-scan | image | On the LMSys leaderboard screenshot (Figure 6), what Arena Elo rating does Claude-1 have? | 1149 | fail: not found | fail: not found | pass: 1149 |
<!-- eval:end -->
