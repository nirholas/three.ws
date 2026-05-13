// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import express from 'express'
import { createServer } from 'http'
import { XSpaceAgent } from 'xspace-agent'
import { createAgentServer } from 'xspace-agent/server'

const app = express()
app.use(express.json())

// ---------------------------------------------------------------------------
// Your existing application routes
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.send(`
    <h1>My App</h1>
    <ul>
      <li><a href="/api/users">Users API</a></li>
      <li><a href="/agent/admin">Agent Admin Panel</a></li>
      <li><a href="/agent/api/status">Agent Status</a></li>
    </ul>
  `)
})

app.get('/api/users', (_req, res) => {
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ])
})

// ---------------------------------------------------------------------------
// Mount the X Space agent at /agent
// ---------------------------------------------------------------------------
const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a helpful AI assistant in an X Space.'
  }
})

const { router, io } = createAgentServer({
  agent,
  basePath: '/agent'
})

// Mount the agent router — provides:
//   /agent/admin    → Admin panel UI
//   /agent/api/status → Agent status JSON
//   /agent/api/join   → POST to join a Space
//   /agent/api/leave  → POST to leave a Space
//   /agent/api/say    → POST to speak text
app.use('/agent', router)

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10)
const server = createServer(app)

// Socket.IO shares the same HTTP server for real-time transcription streaming
io.attach(server)

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`  App:         http://localhost:${PORT}/`)
  console.log(`  Agent Admin: http://localhost:${PORT}/agent/admin`)
  console.log(`  Agent API:   http://localhost:${PORT}/agent/api/status`)
})

// Forward agent events to console
agent.on('transcription', ({ speaker, text }) => console.log(`[Space] ${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`[Agent] ${text}`))


