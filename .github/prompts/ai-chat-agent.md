---
mode: agent
description: "Upgrade the chat agent from pattern matching to real AI with LLM backend"
---

# AI-Powered Chat Agent

## Problem

`src/avaturn-agent.js` (NichAgent) uses hardcoded pattern matching with `if/else` chains — not actually AI-powered despite branding. It can answer ~15 predefined questions but falls apart on anything else.

## Implementation

### 1. LLM Backend (`api/chat.js`)

Create a server-side chat endpoint:

```
POST /api/chat
Body: { "message": "string", "context": { "model": "string", "validationReport": {} } }
Response: { "reply": "string", "actions": [] }
```

- Use OpenAI API (or compatible: Anthropic, Groq, local Ollama)
- System prompt includes:
  - 3D Agent capabilities and feature knowledge
  - Current loaded model info (name, stats, validation results)
  - Available actions the agent can trigger in the viewer
  - glTF format expertise for answering technical questions

### 2. Tool Use / Function Calling

The LLM can return structured actions that the frontend executes:

```json
{
    "reply": "I've enabled wireframe mode and set the background to dark blue.",
    "actions": [
        { "type": "setWireframe", "value": true },
        { "type": "setBgColor", "value": "#001133" },
        { "type": "setAutoRotate", "value": true }
    ]
}
```

Supported actions:
- `setWireframe`, `setSkeleton`, `setGrid` — display toggles
- `setBgColor`, `setTransparentBg` — background controls
- `setEnvironment` — change lighting environment
- `setAutoRotate` — toggle auto-rotation
- `takeScreenshot` — capture current view
- `loadModel` — load a model by URL
- `runValidation` — trigger validation
- `showMaterialEditor` — open editor panels

### 3. Context-Aware Responses

Pass model context to the LLM:
```js
const context = {
    modelName: viewer.content?.name,
    vertices: viewer.modelInfo?.vertices,
    triangles: viewer.modelInfo?.triangles,
    materials: viewer.modelInfo?.materials,
    animations: viewer.clips?.length,
    validationErrors: validator.report?.errors?.length,
    validationWarnings: validator.report?.warnings?.length,
    currentEnvironment: viewer.state.environment,
    currentSettings: { wireframe, skeleton, grid, autoRotate, bgColor }
};
```

### 4. Conversation Memory

- Maintain conversation history in the chat session
- Store recent messages in sessionStorage
- Clear on model change or explicit reset

### 5. Frontend Updates

Update `src/avaturn-agent.js`:
- Replace pattern matching with API calls to `/api/chat`
- Keep speech synthesis/recognition as optional interface
- Add typing indicator during API calls
- Execute returned actions on the viewer
- Fallback to pattern matching if API is unavailable (offline mode)

### 6. Streaming Responses

For better UX, stream LLM responses:
- Use SSE or ReadableStream from the API
- Display tokens as they arrive
- Execute actions after full response is received

### 7. Rate Limiting & Auth

- Require authentication for chat (logged-in users only)
- Rate limit: 20 messages/minute per user
- Token limit: 4096 tokens per request
- Cost tracking via `api/_lib/usage.js`

## Environment Variables

```
OPENAI_API_KEY=sk-...
CHAT_MODEL=gpt-4o-mini
CHAT_MAX_TOKENS=4096
```

## File Structure

```
api/
├── chat.js           # LLM chat endpoint with function calling
src/
├── avaturn-agent.js  # Updated with API integration + fallback
```

## Validation

- Ask "What model is loaded?" → replies with actual model name and stats
- Ask "Enable wireframe" → wireframe turns on in viewport
- Ask "What errors does this model have?" → summarizes validation report
- Ask complex 3D question → gets knowledgeable answer from LLM
- Offline → falls back to pattern matching gracefully
- Rate limiting works — excessive messages return appropriate error
