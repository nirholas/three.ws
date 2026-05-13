# Discord Bridge Example

A Discord bot that lets server admins **control the X Space agent from Discord** — join Spaces, speak, and view live transcriptions, all from a Discord channel.

## Prerequisites

- A Discord bot with **Message Content Intent** enabled
- Bot invited to your server with `Send Messages` and `Read Messages` permissions

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Run the bridge:
   ```bash
   npm start
   ```

## Discord Commands

| Command | Description |
|---------|-------------|
| `!join <url>` | Join an X Space |
| `!leave` | Leave the current Space |
| `!say <text>` | Speak text in the Space |
| `!mute` | Mute the agent |
| `!unmute` | Unmute the agent |
| `!status` | Show agent status |
| `!help` | List all commands |

Only users with the **Administrator** permission can use these commands.

## Features

- Live transcription forwarding from X Space to Discord
- Agent responses posted to the Discord channel
- Error reporting in Discord
- Permission-gated commands (admin only)


