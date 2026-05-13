# Discord Community Setup Guide

This document covers exactly how to create and configure the Discord server for both **X Space Agent** and **agent-voice-chat**. Once set up, replace all `YOUR_SERVER_ID` and `YOUR_INVITE_CODE` placeholders in the READMEs with the real values.

---

## 1. Create the Server

1. Open Discord → click the **+** button in the left sidebar → **Create My Own**
2. Choose **For a club or community**
3. Name it: `X Space Agent & Voice Chat`
4. Upload the logo from `public/images/logo.svg` as the server icon

---

## 2. Channel Structure

Create the following categories and channels in order. For each channel, the indented bullet is the topic/description to set under **Edit Channel → Topic**.

### WELCOME
| Channel | Type | Topic |
|---------|------|-------|
| `#welcome` | Text | Welcome to the community! Read the pinned message for links to docs, GitHub, and getting started guides. |
| `#rules` | Text | Community guidelines — please read before participating. |
| `#introductions` | Text | Introduce yourself! Tell us what you're building. |

### XSPACE AGENT
| Channel | Type | Topic |
|---------|------|-------|
| `#general` | Text | General discussion about the xspace-agent SDK and X Spaces automation. |
| `#help` | Text | Ask questions about xspace-agent. Include your code and error message. |
| `#showcase` | Text | Share what you've built with xspace-agent. We love to see it! |
| `#providers` | Text | Discussion about LLM, STT, and TTS provider integrations. |

### AGENT VOICE CHAT
| Channel | Type | Topic |
|---------|------|-------|
| `#general` | Text | General discussion about agent-voice-chat. |
| `#help` | Text | Ask questions about agent-voice-chat. Include your config and error message. |
| `#showcase` | Text | Share your deployments, custom agents, and voice chat demos. |
| `#react-vue` | Text | Framework-specific questions for the React and Vue components. |

### DEVELOPMENT
| Channel | Type | Topic |
|---------|------|-------|
| `#contributing` | Text | For contributors and maintainers. PR discussions, design decisions, dev setup. |
| `#bugs` | Text | Report bugs here (or open a GitHub Issue for tracking). |
| `#feature-requests` | Text | Propose new features. Start with a one-liner: "I want to be able to…" |
| `#releases` | Text | Automated release announcements from GitHub. Read-only for members. |

---

## 3. Roles

Create the following roles under **Server Settings → Roles**:

| Role | Color | Description | How to get it |
|------|-------|-------------|---------------|
| `@maintainer` | `#e74c3c` (red) | Core team / repo owners | Assigned manually by admins |
| `@contributor` | `#f39c12` (orange) | Has merged a PR to either repo | Assigned manually after PR merge |
| `@xspace-user` | `#3498db` (blue) | Uses xspace-agent SDK | Self-assign via reaction roles (see §5) |
| `@voice-chat-user` | `#9b59b6` (purple) | Uses agent-voice-chat | Self-assign via reaction roles (see §5) |

**Role permissions:**
- `@maintainer` — Admin permissions
- `@contributor` — Can post in `#contributing`
- `@xspace-user` / `@voice-chat-user` — Standard member permissions

Make `#releases` **send-messages** permission to `@everyone: Deny` so only bots can post there.

---

## 4. Bots

### GitHub Bot (Automatic Release Announcements)

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. Use the Discord Server's webhook URL (from `#releases` → Edit Channel → Integrations → Create Webhook)
3. Set Payload URL to: `https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN/github`
4. Content type: `application/json`
5. Select **individual events** → check only **Releases**
6. Save

Alternatively, use the official [GitHub Discord App](https://discord.com/application-directory/discord-github) (slash commands in any channel).

### Welcome Bot (MEE6 or Carl-bot)

**Option A — MEE6 (recommended):**
1. Add MEE6 at [mee6.xyz](https://mee6.xyz)
2. Go to MEE6 Dashboard → your server → **Welcome**
3. Enable welcome messages → set channel to `#welcome`
4. Set the welcome message (see §5 below for the template)

**Option B — Carl-bot:**
1. Add Carl-bot at [carl.gg](https://carl.gg)
2. Go to Dashboard → **Welcome & Leave** → Welcome
3. Set channel to `#welcome`, paste the welcome template

### Reaction Roles (Carl-bot or MEE6)

Post a message in `#welcome` like:

```
React to get a role:
🤖 → @xspace-user
🎙️ → @voice-chat-user
```

Then set up reaction roles in your bot dashboard mapping those emoji to the roles.

---

## 5. Message Templates

### Welcome DM / #welcome Auto-Message

Paste this into your welcome bot's message field:

```
👋 Welcome to the X Space Agent & Voice Chat community, {user}!

Here's everything you need to get started:

📦 **xspace-agent** (AI agents for X/Twitter Spaces)
• npm: https://www.npmjs.com/package/xspace-agent
• Docs: https://github.com/xspace-agent/xspace-agent/tree/main/docs
• Quick start: `npx xspace-agent join <space-url>`

🎙️ **agent-voice-chat** (Voice AI widget for websites)
• npm: https://www.npmjs.com/package/agent-voice-chat
• Docs: https://github.com/nirholas/xspace-agent/tree/main/agent-voice-chat/docs
• Quick start: add one `<script>` tag to your site

📢 **Channels to know:**
• #help (xspace) or #avc-help — ask questions
• #showcase — share what you're building
• #releases — automated release updates
• #introductions — say hi!

🤝 **Contributing:**
Both projects are open source. See CONTRIBUTING.md in each repo.

React in #welcome with 🤖 for xspace-agent or 🎙️ for voice-chat to get a role!
```

### #rules Pinned Message

```
## Community Rules

1. **Be kind.** No harassment, hate speech, or personal attacks.
2. **Stay on topic.** Use the right channel for your message.
3. **No spam.** No unsolicited DMs, ads, or repeated messages.
4. **Search first.** Check existing threads before asking a question.
5. **Share context.** Include code snippets and error messages when asking for help.
6. **Give back.** If someone helped you, say thanks — and help others when you can.

Violations may result in a warning or ban at moderator discretion.
```

### #welcome Pinned Message

```
## Welcome! 👋

This is the community hub for:
• **xspace-agent** — AI agents that join and talk in X/Twitter Spaces
• **agent-voice-chat** — Embeddable multi-agent voice conversations for the web

🔗 **Quick Links**
• GitHub (xspace-agent): https://github.com/xspace-agent/xspace-agent
• GitHub (agent-voice-chat): https://github.com/nirholas/xspace-agent
• npm (xspace-agent): https://www.npmjs.com/package/xspace-agent
• npm (agent-voice-chat): https://www.npmjs.com/package/agent-voice-chat

React below to get a role:
🤖 → @xspace-user
🎙️ → @voice-chat-user
```

---

## 6. Get Your Server ID and Invite Link

### Server ID
1. Enable Developer Mode: **User Settings → Advanced → Developer Mode**
2. Right-click your server name → **Copy Server ID**
3. Replace `YOUR_SERVER_ID` in both READMEs with this value

### Permanent Invite Link
1. **Server Settings → Invites → Create Invite**
2. Set expiry to **Never**, max uses to **No limit**
3. Copy the invite code (the part after `discord.gg/`)
4. Replace `YOUR_INVITE_CODE` in both READMEs with this value

---

## 7. Update READMEs After Setup

Once the server is live, do a global find-and-replace:

```
YOUR_SERVER_ID  →  <your actual server ID, e.g. 1234567890123456789>
YOUR_INVITE_CODE  →  <your invite code, e.g. xspaceagent>
```

Files to update:
- `README.md`
- `agent-voice-chat/README.md`

---

## 8. GitHub Discussions

Enable Discussions on the repo for async, searchable Q&A:

1. Go to repo **Settings → Features** → check **Discussions**
2. Go to the **Discussions** tab → click **Edit categories**
3. Create these categories:
   - **Q&A** — Questions with accepted answers
   - **Show & Tell** — Share what you've built
   - **Ideas** — Feature proposals
   - **General** — Everything else
4. Pin a welcome post in General linking to Discord and docs

---

## 9. Verification Checklist

- [ ] Server created with correct name and icon
- [ ] All 14 channels created in the right categories
- [ ] Channel topics set
- [ ] 4 roles created with correct colors
- [ ] `#releases` is read-only for `@everyone`
- [ ] GitHub webhook connected to `#releases`
- [ ] Welcome bot configured and tested (send a test message)
- [ ] Reaction roles working in `#welcome`
- [ ] Permanent invite link created
- [ ] `README.md` updated with real Server ID and invite code
- [ ] `agent-voice-chat/README.md` updated with real Server ID and invite code
- [ ] GitHub Discussions enabled with 4 categories


