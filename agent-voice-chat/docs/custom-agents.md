# Custom Agents

Agents are AI personalities with distinct voices, styles, and visual themes. You can have as many agents as you want in a single deployment.

## Agent Configuration

Agents are defined in `agents.config.json` in the project root:

```json
{
  "agents": [
    {
      "id": "bob",
      "name": "Bob",
      "personality": "You're Bob. Energetic and quick-witted...",
      "voice": "verse",
      "avatar": "/assets/bob.png",
      "theme": {
        "primary": "#818cf8",
        "gradient": ["#667eea", "#764ba2"],
        "background": ["#1a1a2e", "#16213e"]
      }
    }
  ],
  "basePrompt": "Shared instructions for all agents...",
  "defaults": {
    "voice": "alloy",
    "maxHistoryLength": 50
  }
}
```

## Creating an Agent

### 1. Choose a Personality

The `personality` field is appended to the `basePrompt` to form the agent's full system prompt. Write it in second person ("You're...") and keep it focused:

```json
{
  "id": "tutor",
  "name": "Professor Ada",
  "personality": "You're Professor Ada, a patient and encouraging computer science tutor. You explain concepts using simple analogies. When a student is confused, you break things down further instead of repeating yourself. You celebrate small wins."
}
```

### 2. Pick a Voice

Available voices depend on your TTS provider:

**OpenAI TTS voices:**
| Voice | Style |
|-------|-------|
| `alloy` | Neutral, balanced |
| `echo` | Warm, conversational |
| `fable` | Expressive, storytelling |
| `onyx` | Deep, authoritative |
| `nova` | Friendly, upbeat |
| `shimmer` | Clear, professional |
| `verse` | Versatile, natural |
| `sage` | Calm, measured |

**ElevenLabs:** Use voice IDs from the [ElevenLabs Voice Library](https://elevenlabs.io/voice-library), configured via `ELEVENLABS_VOICE_0`, `ELEVENLABS_VOICE_1`, etc.

**Browser TTS:** Uses the system's default voice. No configuration needed.

### 3. Set a Theme (Optional)

Themes control the agent's UI appearance:

```json
{
  "theme": {
    "primary": "#10b981",
    "gradient": ["#059669", "#34d399"],
    "background": ["#064e3b", "#022c22"]
  }
}
```

- `primary` — Accent color for buttons and highlights
- `gradient` — Two colors for the agent card gradient
- `background` — Two colors for the page background gradient

## Example Agents

### Customer Support Bot

```json
{
  "id": "support",
  "name": "Alex",
  "personality": "You're Alex, a friendly customer support agent for an e-commerce store. You help with orders, returns, and product questions. You're helpful but concise — get to the answer quickly. If you don't know something, say so and offer to escalate. Never make up order statuses or policies.",
  "voice": "nova"
}
```

### Language Tutor

```json
{
  "id": "tutor-es",
  "name": "Maria",
  "personality": "You're Maria, a Spanish language tutor. Speak mostly in Spanish but switch to English when the student is struggling. Correct pronunciation gently. Use everyday conversation topics to practice. Keep it fun and encouraging. Start each session by asking what the student wants to practice today.",
  "voice": "shimmer"
}
```

### Podcast Co-Host

```json
{
  "id": "cohost",
  "name": "Jake",
  "personality": "You're Jake, a podcast co-host discussing tech news. You have strong opinions but back them up. You love debating but keep it friendly. You reference recent tech events and trends. Keep responses under 3 sentences — this is a conversation, not a monologue.",
  "voice": "echo"
}
```

### Game Master

```json
{
  "id": "gm",
  "name": "The Narrator",
  "personality": "You're a tabletop RPG game master running a fantasy adventure. Describe scenes vividly but briefly. Present choices to the player. Track what happened in the conversation. React to player choices with consequences. Use a dramatic but not over-the-top tone.",
  "voice": "onyx",
  "theme": {
    "primary": "#a855f7",
    "gradient": ["#7c3aed", "#c084fc"],
    "background": ["#1e1b4b", "#312e81"]
  }
}
```

## The Base Prompt

The `basePrompt` in `agents.config.json` is shared across all agents. Use it for universal behavior rules:

```json
{
  "basePrompt": "Keep your responses under 3 sentences — you're in a voice conversation, not writing an essay. Be natural and conversational. Match the user's language."
}
```

The final prompt sent to the LLM is: `basePrompt + "\n\n" + agent.personality`

## Managing Agents via API

You can add, update, and remove agents at runtime using the REST API:

### Add an Agent

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "new-agent",
    "name": "New Agent",
    "personality": "You are a helpful assistant.",
    "voice": "alloy"
  }'
```

### Update an Agent

```bash
curl -X PUT http://localhost:3000/api/agents/new-agent \
  -H "Content-Type: application/json" \
  -d '{
    "personality": "Updated personality text."
  }'
```

### Remove an Agent

```bash
curl -X DELETE http://localhost:3000/api/agents/new-agent
```

### List All Agents

```bash
curl http://localhost:3000/api/agents
```

## Tips for Good Agent Personalities

1. **Be specific.** "You're sarcastic" is vague. "You respond to obvious questions with dry humor, like a tired barista" is vivid.
2. **Keep it short.** Voice responses should be 1–3 sentences. Tell the agent this explicitly.
3. **Define boundaries.** What should the agent refuse to do? What topics are off-limits?
4. **Match voice to personality.** A calm advisor should use `sage` or `shimmer`, not an energetic voice.
5. **Test with voice.** Text that reads well can sound awkward when spoken aloud. Iterate by listening, not just reading.
