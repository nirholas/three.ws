# Agent memory benchmark results

Scores for the agent memory layer on two public long-term-memory benchmarks, measured before and after temporal validity and provenance landed (`valid_from`, `valid_to`, `source_ref`, `superseded_by`; see `docs/agent-memory.md`).

## What is measured

- **LoCoMo** (snap-research/locomo, `data/locomo10.json`): 10 long conversations. Categories 1 to 4 are scored (multi-hop, temporal, open-domain, single-hop). Category 5 (adversarial, no ground-truth answer) is excluded, as published LoCoMo results conventionally do.
- **LongMemEval-S** (xiaowu0162/longmemeval-cleaned, `longmemeval_s_cleaned.json`): 500 questions over about 115k-token chat histories, six question types plus abstention. Licensed for research use; the harness downloads it at run time and does not redistribute it.
- **baseline** is recall as it worked before the change: BM25 top-k memories in relevance order, with no dates, validity or provenance in the context.
- **temporal** uses the same top-k, then stamps each memory with its `valid_from` and source, lets a later memory close the interval of the earlier one it replaces (the SDK `supersede()`), renders the facts oldest to newest labeled current or superseded, and answers as of the question date.
- Both modes share the retriever, the answer model and the grader, so the only difference is what the memory layer knows about time.

## Caveats

- The answer model and the grader are the platform model chain (`api/_lib/llm.js`), not GPT-4o. Scores compare runs of this harness; they are not comparable with published GPT-4o-judged numbers.
- Subsets are small and stratified by question type with a fixed seed, so the per-type rows are noisy. Treat differences of a few questions as noise.
- Reproduce a run: `node --env-file=.env scripts/memory-bench.mjs --subset 50` (add `--write-doc` to append the result here).
