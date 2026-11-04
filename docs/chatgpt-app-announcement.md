# Announcement: three.ws in ChatGPT

Ready-to-post copy for the launch of [three.ws/chatgpt](https://three.ws/chatgpt), the page that walks anyone through adding the free three.ws 3D Studio to their own ChatGPT. Every claim below is checked against the live server (`/api/mcp-chatgpt`, eight free tools, no authentication).

Link to use everywhere: `https://three.ws/chatgpt`

## X (single post)

> three.ws now works inside ChatGPT.
>
> Ask for a dragon, a chair, or an avatar of you, and an interactive 3D model appears right in the chat. Spin it, download the GLB, rig it, put it in your room in AR.
>
> Free. No account. About a minute to add:
> three.ws/chatgpt

## X (thread)

1. > three.ws now works inside ChatGPT. Text or a photo in, an interactive, textured 3D model out, rendered right in the conversation. Free, no account, no key. Setup takes about a minute: three.ws/chatgpt
2. > How to add it:
   > 1. ChatGPT Settings, Apps & Connectors, Advanced settings: turn on Developer mode
   > 2. Create an app, paste https://three.ws/api/mcp-chatgpt, choose No authentication
   > 3. In a chat: + menu, Developer mode, tick three.ws 3D Studio
3. > What you can ask for:
   > - "Make a 3D model of a red vintage scooter"
   > - "Make a rigged, animation-ready avatar of a friendly astronaut"
   > - "Turn this photo into a 3D model"
   > - "Make it metallic gold, then check it from a few angles"
4. > Every result is a real GLB you can download and use, plus a viewer link and an AR link. ChatGPT can even look at what it made and fix it. Full guide, live server check and starter prompts: three.ws/chatgpt

## Telegram / Discord

> **three.ws is now in ChatGPT.** Add the free 3D Studio to your own ChatGPT and turn any prompt or photo into an interactive 3D model or a rigged avatar, right in the chat. No account, no key, about a minute to set up.
>
> Step-by-step (with copy buttons for every field): https://three.ws/chatgpt
>
> Server URL, if you already know the drill: `https://three.ws/api/mcp-chatgpt` (No authentication)

## Short blurb (newsletter, partner updates, README badges)

> Add three.ws to ChatGPT: free text-to-3D and rigged avatars, rendered inline in the conversation. Setup in about a minute at three.ws/chatgpt.

## Notes for whoever posts

- The setup path needs ChatGPT Plus, Pro, Business, Enterprise or Edu on the web. Mention it if someone asks why they cannot see Developer mode; the page's FAQ covers it.
- ChatGPT renames its settings menus from time to time. If the labels drift, update `pages/chatgpt.html` and this file together.
- Lead with the result (a 3D model inside the chat), not the protocol. Say "MCP" only to developers.
