# PDF extraction eval, 2026-11-16

<!-- eval:begin -->
Run 2026-11-16: 44 questions over 4 documents (47 pages). Answer model `nvidia/nemotron-3.5-super-vl-120b-a12b` at temperature 0; embedder `nvidia/nemotron-3.5-embed-8b@2048`; reranker off.

### Answer accuracy

| Slice | n | markitdown (before) | text-layer | nemotron (after) |
|---|---:|---:|---:|---:|
| All questions | 44 | 38.6% (17/44) | 45.5% (20/44) | 84.1% (37/44) |
| Tables (born-digital) | 22 | 77.3% (17/22) | 90.9% (20/22) | 100.0% (22/22) |
| Charts (born-digital) | 8 | 0.0% (0/8) | 0.0% (0/8) | 75.0% (6/8) |
| Screenshot of a table (image, no text layer) | 3 | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |
| Scanned copy (every page an image) | 11 | 0.0% (0/11) | 0.0% (0/11) | 81.8% (9/11) |

### Retrieval: the exact printed value reached the prompt

Tables and the screenshot only (a chart estimate has no exact value to look for). This separates "the extractor lost the number" from "the model misread it".

| Slice | markitdown | text-layer | nemotron |
|---|---:|---:|---:|
| All questions | 56.8% (21/37) | 62.2% (23/37) | 91.9% (34/37) |
| Tables (born-digital) | 90.9% (20/22) | 100.0% (22/22) | 100.0% (22/22) |
| Charts (born-digital) | 100.0% (1/1) | 100.0% (1/1) | 100.0% (1/1) |
| Screenshot of a table (image, no text layer) | 0.0% (0/3) | 0.0% (0/3) | 0.0% (0/3) |
| Scanned copy (every page an image) | 0.0% (0/11) | 0.0% (0/11) | 100.0% (11/11) |

### Extraction

| Document | Pages | Condition | Chunks | Tables | Charts | Seconds per page (median / p90) | Wall time |
|---|---:|---|---:|---:|---:|---|---:|
| Mistral-7B.pdf | 9 | markitdown | 17 | n/a | n/a | n/a | 6.8s |
| Mistral-7B.pdf | 9 | text-layer | 18 | n/a | n/a | n/a | 1.0s |
| Mistral-7B.pdf | 9 | nemotron | 28 | 5 | 3 | 5.2 / 22.1 | 26.6s |
| Mixtral-of-Experts.pdf | 13 | markitdown | 22 | n/a | n/a | n/a | 12.6s |
| Mixtral-of-Experts.pdf | 13 | text-layer | 25 | n/a | n/a | n/a | 0.2s |
| Mixtral-of-Experts.pdf | 13 | nemotron | 39 | 8 | 6 | 2.5 / 10.0 | 23.1s |
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
| `nvidia/nemotron-graphic-elements-v1` | 19 | 0 | 0.97s |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | 20 | 1 | 4.13s |
| `nvidia/nemotron-ocr-v2` | 36 | 0 | 0.78s |

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
| mixtral | image | On the LMSys leaderboard screenshot (Figure 6), what Arena Elo rating does GPT-4-0613 have? | 1158 | fail: not found | fail: not found | fail: not found |
| mixtral | image | On the LMSys leaderboard screenshot (Figure 6), what MT-bench score does GPT-4-Turbo have? | 9.32 | fail: not found | fail: not found | fail: not found |
| mixtral | image | On the LMSys leaderboard screenshot (Figure 6), what Arena Elo rating does Claude-1 have? | 1149 | fail: not found | fail: not found | fail: not found |
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
