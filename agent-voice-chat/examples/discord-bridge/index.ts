// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { Client, GatewayIntentBits, TextChannel } from 'discord.js'
import { XSpaceAgent } from 'xspace-agent'

const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a helpful AI assistant in an X Space. Keep responses concise.'
  }
})

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

function getChannel(): TextChannel | null {
  const ch = discord.channels.cache.get(DISCORD_CHANNEL_ID)
  return ch instanceof TextChannel ? ch : null
}

discord.on('ready', () => {
  console.log(`Discord bot logged in as ${discord.user?.tag}`)
})

discord.on('messageCreate', async (msg) => {
  if (msg.author.bot) return
  if (msg.channelId !== DISCORD_CHANNEL_ID) return
  if (!msg.member?.permissions.has('Administrator')) return

  const content = msg.content.trim()

  if (content.startsWith('!join ')) {
    const url = content.split(' ')[1]
    try {
      await agent.join(url)
      await msg.reply(`Joined Space: ${url}`)
    } catch (err) {
      await msg.reply(`Failed to join: ${(err as Error).message}`)
    }
    return
  }

  if (content === '!leave') {
    await agent.destroy()
    await msg.reply('Left Space')
    return
  }

  if (content.startsWith('!say ')) {
    const text = content.slice(5)
    await agent.say(text)
    await msg.reply(`Said: "${text}"`)
    return
  }

  if (content === '!status') {
    const status = agent.getStatus()
    await msg.reply(`Status: ${status.state} | Speakers: ${status.speakerCount} | Uptime: ${status.uptime}`)
    return
  }

  if (content === '!mute') {
    await agent.mute()
    await msg.reply('Agent muted')
    return
  }

  if (content === '!unmute') {
    await agent.unmute()
    await msg.reply('Agent unmuted')
    return
  }

  if (content === '!help') {
    await msg.reply([
      '**X Space Agent Commands**',
      '`!join <url>` — Join an X Space',
      '`!leave` — Leave the current Space',
      '`!say <text>` — Speak text in the Space',
      '`!mute` / `!unmute` — Toggle agent audio',
      '`!status` — Show agent status'
    ].join('\n'))
  }
})

// Forward Space transcriptions to the Discord channel
agent.on('transcription', ({ speaker, text }) => {
  const channel = getChannel()
  channel?.send(`**${speaker}**: ${text}`)
})

agent.on('response', ({ text }) => {
  const channel = getChannel()
  channel?.send(`**Agent**: ${text}`)
})

agent.on('error', (err) => {
  const channel = getChannel()
  channel?.send(`Error: ${err.message}`)
})

await discord.login(process.env.DISCORD_TOKEN)
console.log('Discord bridge running. Use !help in Discord for commands.')


