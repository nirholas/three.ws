# New SharePoint item to 3D model, posted in Teams

A design team keeps a SharePoint list of objects it needs. Every new item becomes a textured 3D model: the flow writes the viewer link back to the item and posts the model in a Teams channel, with links to the 3D viewer, AR on a phone, and the GLB download.

## What it does

1. **Trigger:** SharePoint "When an item is created" on the list you choose. It checks once a minute.
2. **three.ws "Generate a 3D model from text"** with the item title as the prompt and the quality you set.
3. If the first answer is `pending`, a **Do until** loop waits 20 seconds, then calls **three.ws "Get generation job"** with the returned job id. It repeats until the status is `done` or `error`, for at most 45 minutes. A draft or a cached prompt often finishes in the first call, so the loop is skipped.
4. When the status is `done`, SharePoint "Update item" writes `viewerUrl` into your link column and Teams "Post message in a chat or channel" shares the model. Otherwise it posts the error to the channel, so a failed item never disappears silently.

## Before you import

- A SharePoint list. Item titles are the prompts, so describe one object each, for example "a brass desk lamp with a green glass shade".
- A single line of text column on that list for the link (for example `ModelLink`). Use its internal name.
- A Teams team and channel the flow bot can post in.
- A three.ws connection. The generation actions need no plan or credits, and the sign-in is the same one every three.ws action uses.

## Parameters

| Parameter | What to enter |
|---|---|
| Site address | The SharePoint site URL that holds the list |
| List name | The list to watch |
| Model link column | The internal name of the link column |
| Team id, Channel id | Where the post goes (pick them in the Teams action to fill these in) |
| Quality | `draft`, `standard` (default) or `high` |

## Import

Import `workflow.json` as described in [the templates README](../README.md), then map the four connection references (three.ws, SharePoint, Teams) and fill in the parameters. Turn the flow on and add a list item to test it.
