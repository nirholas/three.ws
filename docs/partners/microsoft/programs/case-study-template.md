# Customer story template

Use this to write the first customer story for Microsoft channels (the Grow stage listing assets, a Tech Community post, slide 8 of [deck.pptx](../deck.pptx)). It is a frame, not a story: every field is filled from what the customer told us and measured, and nothing is published until the customer approves the final text in writing.

## Rules

- **Every result is the customer's number.** If they cannot measure it, leave the line out. Never estimate, round up or extrapolate.
- **The customer approves the exact wording**, their name, their logo and every quote, in writing, before anything is posted. Keep the approval email with the draft.
- **Microsoft wording** stays on the two approved claims: "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace". Do not describe the customer as a Microsoft customer unless they say so in their approval.
- **Name the Microsoft surface they used** (Teams app, Power Platform connector, PowerPoint add-in, Power BI visual, Copilot Studio over MCP, or the Marketplace SaaS offer) so the story is useful to the Microsoft team that owns that surface.
- Run `node scripts/microsoft-pack/check-wording.mjs <file>` on the finished story.

## Interview questions

1. What were you trying to do before three.ws, and what did it cost you (time, money, people)?
2. What else did you try?
3. Which three.ws surface did you start with, and who set it up?
4. How long from first sign-in to the first thing your users saw?
5. What changed, and how did you measure it? (Ask for the number and how it was counted.)
6. Which Microsoft tools sit around it (Teams, Copilot Studio, Power Automate, PowerPoint, Power BI)?
7. What would you tell a team like yours that is considering it?

## Story (about 400 words)

**Title:** `<Customer>` uses three.ws `<surface>` to `<outcome in their words>`

**Customer:** name, industry, size, country (as they approve it).

**Challenge** (2 to 3 sentences): the job they needed done and why it was hard. From question 1 and 2.

**Solution** (3 to 4 sentences): what they built, on which surface, who built it and how long it took. From questions 3, 4 and 6.

**Results** (2 to 4 bullets): each bullet is one measured number with what was counted and over what period. From question 5.

**Quote** (1 to 2 sentences): from question 7, attributed with name and role as approved.

**What's next** (1 sentence): what they plan to do next with it, if they shared it.

**Links:** their public page if any, three.ws/microsoft, the Marketplace listing.

## Evidence file

Keep beside the draft, not in the published text:

| Item | Where it is |
|---|---|
| Written approval of final text, name, logo and quote | Email thread, date |
| Source of each result | Their dashboard, report or message, date |
| three.ws side numbers (if any) | The query or endpoint, recorded in [sources.md](../sources.md) |
