The revenue ledger, reconcile cron, reinvest rules, the /earnings console and the public /agents/:id/earnings page are built, documented (docs/revenue-ledger.md) and committed. Backend tests pass (tests/revenue-ledger.test.js) and the /api/revenue routes answer on a local server. What remains:

1. Browser check (agent can do once a Vite build works): run `npm run dev`, open /earnings signed in and /agents/<id>/earnings with the toggle on, and confirm no console errors, the chart tooltip and table view, the how-calculated drawer, export links, and the rule form, preview and confirmation table. The pages were syntax-checked but not exercised in a browser because node_modules was mid-install by another agent.
2. Deploy and cron sync (owner approval, gate 2): `npm run deploy:gcp:full` ships the pages and the `revenue-ledger-reconcile` and `revenue-reinvest` schedules.
3. First live reinvest rule (owner, gate 1): create a rule on /earnings, read the confirmation table (recipient, asset, chain, amount) and confirm it in the browser. Transfers over the spend policy land in /approvals and wait for a yes.

Delete this file once 1 is verified and 2 is done.
