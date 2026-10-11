# Run receipts: X reply and thread

Drafts responding to the reply on our X Article: "Dev. prioritize higher-quality and more trustworthy product. system writes down exactly what went wrong and what was expected.." (https://x.com/sumanKese/status/2109063467848356262).

Nothing here is posted or queued. The long form is the X Article at [data/x-content/articles/run-receipts-article.md](../data/x-content/articles/run-receipts-article.md). The signed proof receipts are in [data/x-content/runs/run-receipts-article.json](../data/x-content/runs/run-receipts-article.json). Every link to `/runs` needs the next production deploy before it resolves.

## Direct reply (single post)

> You were right, so we built it. Every 3D Studio run now writes a signed receipt: per stage, what was expected, what happened, and why. On day one it caught our prompt director falling back on 8 of 10 runs. Fixed same day. Proof: [article link]

## Thread

1/
A reader told us: "system writes down exactly what went wrong and what was expected."

Fair. So every generation on the free three.ws 3D Studio now writes a run receipt, signed with ed25519. Here is what it found on its first day, with proof you can verify yourself.

2/
A receipt has a row per stage: input, subject check, brief, mesh, geometry, visual check, rig, delivery.

Each row records expected, observed, a verdict (met, recovered, missed, skipped, pending) and the cause whenever it is not a clean pass. A skip is never counted as a pass.

3/
The rig row is read back from the delivered file, not copied from the rigger's report.

Example, rr_81qbfUbiZNqSTD6rVmjCoA: a cartoon astronaut in 77.6s. 52 of 52 joints mapped, visual score 85, 7,755 triangles. Summary: "Delivered as expected. 1 carried by a fallback (Brief)."

4/
Then we checked the 7-day stats. Every run delivered. But the Brief stage was recovered on 8 of its first 10 runs. Our prompt director was barely getting a word in, and nobody outside could have seen it.

5/
Two bugs, both ours:
- briefs ran 1,071 to 1,421 characters against a 1,000 cap (models ignore character budgets)
- a correctly formed brief ending "... no second subject" failed our completeness check for lacking a full stop

6/
The fix, test first:
- a 90-word budget, which models respect
- the guard accepts the mandated ending, but still rejects a reply clipped inside it
- the receipt now names the exact reason a brief was set aside, instead of a vague "timed out"

7/
Same prompt, before and after: "a vintage red rotary telephone".

Before, rr_6LFRktJgzxFnv29MyZuDwz: brief recovered, 15,787 triangles.
After, rr_TFhcAi4mAkHsmBz3oveqJ4: brief met, 16,150 triangles, score 0.948.

Live sampling went from 0 usable briefs to about 7 in 12.

8/
Receipts cover the edges too.

"a wooden chair" sent to the avatar tool: refused in 4 ms, before any GPU time.

A lamp sent to the rigger: rig met, but the subject check is marked skipped, because a lamp still receives a humanoid skeleton. The summary says so.

9/
Signed, so you don't have to trust us. We edited one line of a receipt to "Delivered perfectly." The verifier failed both hash and signature, exit 1:

node scripts/run-receipt-verify.mjs rr_81qbfUbiZNqSTD6rVmjCoA --signer Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH

10/
Browse every run and the 7-day stage stats at three.ws/runs. The contract is at three.ws/docs/run-receipts.

Thank you for the push. It found a real problem on its first day. Full article: [article link]
