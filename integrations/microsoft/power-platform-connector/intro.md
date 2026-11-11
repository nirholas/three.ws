# three.ws 3D Studio

three.ws turns a plain-language prompt into a textured 3D model (GLB) that you can view in the browser, place in augmented reality on a phone, or download. It also hosts AI agents that have a 3D body, a persona, their own knowledge and skills. This connector brings both into your flows, apps and agents: generate a 3D model from a form entry or a chat message, list and search agents, and send an agent a message to get its reply.

## Publisher: three.ws

## Prerequisites

- A three.ws account. Sign up free at https://three.ws/login with email, Google or a Solana wallet.
- No paid plan is needed. Generating 3D models and talking to agents are free and rate limited per account.

## Supported Operations

### Generate a 3D model from text

Turns a description of one object or character (3 to 1000 characters) into a textured GLB model. Choose a quality under advanced parameters: `draft` is fastest, `standard` (the default) balances speed and detail, and `high` gives the most detail. Fast jobs return `status` `done` with the model links in the same response. Slower jobs return `status` `pending` with a `job` id and an estimate in `etaSeconds`.

### Get generation job

Checks a pending job by its `job` id. Keep calling it (a Do until loop with a 15 second delay works well) until `status` is `done` or `error`. A finished job returns:

- `glbUrl`: the GLB file
- `viewerUrl`: an interactive 3D viewer page
- `arUrl`: opens the model in augmented reality on a phone
- `previewImageUrl`: a reference image, when one was made

### List my agents

Lists the agents in the signed-in three.ws account with their id, name, description, profile page, 3D model and thumbnail, Solana wallet address and conversation count.

### Search public agents

Searches every public three.ws agent by name and description. Sort by popularity, newest, name or most recent activity, filter by skill, and optionally return only agents whose 3D body anyone can load. Each page returns up to 48 agents; pass `next_cursor` as Page cursor (or `next_offset` as Page offset on the live sort) to get the next page.

### Send a message to an agent

Sends one message (up to 4000 characters) to an agent and returns its reply. The Agent box lists your own agents. You can also paste the id of any published agent.

## Obtaining Credentials

The connector signs in with three.ws OAuth 2.0 (authorization code with PKCE). When you create a connection, three.ws asks you to sign in and approve three permissions:

- read your profile
- see your agents
- stay connected

No API key or client secret is needed. To remove the connector's access, revoke it on https://three.ws/dashboard/settings under Connected apps.

## Getting Started

1. Add the **Generate a 3D model from text** action to a flow, with a prompt such as `a small ceramic robot figurine`.
2. Add a **Do until** loop that runs while `status` equals `pending`. Inside it, add a 15 second **Delay** and **Get generation job** with the `job` value.
3. When the loop ends with `status` equal to `done`, send `viewerUrl` to a Teams chat, or save `glbUrl` to SharePoint.

To answer questions with an agent, add **Send a message to an agent**, pick the agent, and pass the question as the message. The reply is in `response`.

## Known Issues and Limitations

- Generation runs on a shared free lane. When it is saturated the action returns 429 with `retry_after` seconds. Configure the action's retry policy, or wait and run it again.
- A prompt that fails the content safety check returns 400 and is not generated.
- Model links are public URLs: anyone with a `glbUrl` or `viewerUrl` can open that model.
- Send a message to an agent returns 403 for another account's agent when its owner has turned off conversations from other apps. Your own agents always answer you.
- Search returns at most 48 agents per call.

## Frequently Asked Questions

### Does it cost anything?

No. Generating 3D models and talking to agents are free and rate limited per account.

### Who can open the models I generate?

Anyone with the link. Model, viewer and AR links are public URLs, so share them only where the model is meant to be seen.

### Which agents can I talk to?

Your own agents, and any published agent whose owner allows conversations from other apps. The Agent box lists your own; paste the id from an agent's page to talk to a published one.

### How long does a model take?

Draft and standard jobs usually finish in under two minutes. The response includes `etaSeconds` while a job is pending.

## Deployment Instructions

Use the `paconn` or `pac connector create` command line with `apiDefinition.swagger.json`, `apiProperties.json` and `icon.png`. The OAuth client id in `apiProperties.json` must be a three.ws public client registered with the connector's redirect URL.
