# Getting started with three.ws

A guided tour of the hosted product, in five minutes. No code, no install. By the end you'll have an agent with a body, a personality, and a shareable URL.

> Want to self-host or write code instead? See [Build your first agent](/docs/tutorials/first-agent).

## Before you begin

Open [three.ws](https://three.ws/) in another tab and sign in. Sign-in uses your wallet (Coinbase Smart Wallet via Privy by default) — there's no email or password to remember.

If you've never used three.ws before, it helps to know the [two core concepts](/docs/agents-vs-avatars):

- **Agent** = the mind (name, skills, memory, wallet)
- **Avatar** = the body (a 3D model)

You pair an avatar with an agent. That's the whole product.

---

## Step 1 — Pick a body

Go to the [Marketplace](/marketplace). You'll see a gallery of avatars. Each tile is a 3D body someone has made available.

Click any avatar to open its profile. You're now on a page like `/avatars/<id>`. Look for the cyan **`Avatar · 3D Body`** pill at the top — that confirms what you're looking at.

You can:
- **Rotate the model** by clicking and dragging.
- **Read the description** under the name.
- **Chat with it** in the Chat tab — but note: the avatar has no agent attached yet, so this uses a default personality.
- **Click `Start an agent`** to use this body for a new agent.

When you find one you like, click **Start an agent**.

---

## Step 2 — Name your agent

After clicking `Start an agent`, you land on `/agent/<id>` — the agent profile page. Look for the gold **`Agent`** pill at the top.

This page is now yours. The agent already has:
- A name (placeholder — change it next)
- A wallet (Solana + EVM, auto-generated)
- A set of default skills (greet, remember, think)
- The avatar you just picked, attached as its body

Click **Open in editor** (visible because you own the agent) to set the name, write a one-line description, and pick a personality. Hit save and return.

---

## Step 3 — Talk to it

On the agent page, scroll to the agent card. There's a chat input. Type anything and the agent will respond using its configured model.

Voice works too — click the microphone icon. The agent's mouth and gestures sync to its speech.

If the agent doesn't have a body, the page will say **"This agent doesn't have a body yet"** and offer a `Pick a body →` button. Click it to go back to the marketplace and pair one.

---

## Step 4 — Share or embed

Two ways to share an agent:

**Share a link.** Click **Copy share link** under the 3D viewer. The link looks like `https://three.ws/agent/<id>`. Anyone who opens it sees your agent and can chat with it.

**Embed on your own site.** Scroll to the **Share & embed** section. You get three formats:

- `iframe` — paste-and-go HTML for any page.
- `link` — just the URL.
- `<agent-3d>` — a real web component for sites where you control the markup.

Copy any of them and drop it into your blog, portfolio, or product page.

---

## Step 5 — Find it again later

Your agents always appear on `/dashboard`. The dashboard groups them by status (draft, on-chain, with a launched token, etc.).

You can also visit `/agent` (no id) to see "My Agents" — the same list, rendered as a grid.

---

## What to learn next

- **More personality** → [Agent system](/docs/agent-system)
- **More abilities** → [Skills](/docs/skills) and [Create a custom skill](/docs/tutorials/custom-skill)
- **Make money from it** → [Solana pump.fun signals](/docs/solana-pumpfun) and [Register on-chain](/docs/tutorials/register-onchain)
- **Build your own avatar** → [Avatar creation](/docs/avatar-creation) and [Avaturn integration](/docs/avaturn)
- **Put it on your site** → [Embedding](/docs/embedding) and [Embed on a website](/docs/tutorials/embed-on-website)

## Stuck?

- Open [three.ws](https://three.ws/) and look for the small `?` next to any type pill — it links to context for that page.
- The [Troubleshooting](/docs/troubleshooting) page lists common errors.
- Open an issue on [GitHub](https://github.com/nirholas/three.ws/issues).
