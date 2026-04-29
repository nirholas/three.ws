# Prompt: Agent Plugin / Tool System

## Problem
Agents can only generate text responses. They can't look up information, check prices, search the web, or perform actions. This limits their usefulness in live conversations.

## Goal
Give agents access to "tools" (function calling) so they can perform actions during conversations — web search, price lookups, tweet posting, etc.

## How It Works

### Tool Calling Flow
```
User says: "What's the current price of ETH?"
         │
         ▼
    STT: "What's the current price of ETH?"
         │
         ▼
    LLM (with tool definitions in system prompt)
    → decides to call: getPrice({ symbol: "ETH" })
         │
         ▼
    Tool executor runs getPrice
    → returns: { price: 3450.23, change24h: "+2.1%" }
         │
         ▼
    LLM generates response using tool result:
    "ETH is currently at $3,450, up 2.1% in the last 24 hours."
         │
         ▼
    TTS → speak in Space
```

### Plugin Structure
Each plugin is a self-contained module:

```
plugins/
├── index.js                    ← Plugin loader and registry
├── web-search/
│   ├── plugin.json             ← Plugin metadata and tool definitions
│   └── index.js                ← Implementation
├── crypto-prices/
│   ├── plugin.json
│   └── index.js
├── tweet/
│   ├── plugin.json
│   └── index.js
└── knowledge-base/
    ├── plugin.json
    └── index.js
```

### Plugin Definition (plugin.json)
```json
{
  "name": "crypto-prices",
  "description": "Look up cryptocurrency prices and market data",
  "version": "1.0.0",
  "enabled": true,
  "requiredEnvVars": ["COINGECKO_API_KEY"],
  "tools": [
    {
      "name": "getPrice",
      "description": "Get the current price of a cryptocurrency",
      "parameters": {
        "type": "object",
        "properties": {
          "symbol": { "type": "string", "description": "Token symbol (e.g. ETH, BTC, SOL)" }
        },
        "required": ["symbol"]
      }
    },
    {
      "name": "getMarketCap",
      "description": "Get the market cap of a cryptocurrency",
      "parameters": {
        "type": "object",
        "properties": {
          "symbol": { "type": "string", "description": "Token symbol" }
        },
        "required": ["symbol"]
      }
    }
  ]
}
```

### Plugin Implementation (index.js)
```js
module.exports = {
  async getPrice({ symbol }) {
    const res = await fetch(`https://api.coingecko.com/.../${symbol}`)
    const data = await res.json()
    return { price: data.price, change24h: data.change_24h }
  },

  async getMarketCap({ symbol }) {
    const res = await fetch(`https://api.coingecko.com/.../${symbol}`)
    return { marketCap: res.data.market_cap }
  }
}
```

### Plugin Registry
```js
class PluginRegistry {
  plugins = new Map()

  loadAll(pluginsDir)                    // Scan dir, load enabled plugins
  getToolDefinitions()                   // Return all tool schemas for LLM
  executeTool(toolName, args)            // Find and execute a tool
  enablePlugin(name)                     // Enable at runtime
  disablePlugin(name)                    // Disable at runtime
  getPluginStatus()                      // List plugins and their state
}
```

### LLM Integration

**For providers that support function calling (OpenAI, Claude):**
- Include tool definitions in the API call
- Parse tool_calls from response
- Execute tools, return results
- Let LLM generate final response

**For providers without function calling (Groq with some models):**
- Include tool descriptions in the system prompt as text
- Parse tool calls from generated text (regex or structured output)
- Execute tools, inject results back into conversation
- Generate final response

### Provider Changes
Each provider needs to handle the tool calling flow:

```js
// providers/openai-chat.js - modified
async function generateResponse(messages, tools) {
  const response = await openai.chat.completions.create({
    model,
    messages,
    tools: tools.map(t => ({ type: 'function', function: t })),
    tool_choice: 'auto'
  })

  // Check if model wants to call a tool
  if (response.choices[0].message.tool_calls) {
    const toolResults = await executeTools(response.choices[0].message.tool_calls)
    // Re-call with tool results
    messages.push(response.choices[0].message)
    messages.push(...toolResults)
    return generateResponse(messages, tools) // recursive
  }

  return response.choices[0].message.content
}
```

## Bundled Plugins

### 1. web-search
- Uses a search API (Brave, SerpAPI, or Tavily)
- Tool: `search({ query })` → returns top 3 results with snippets
- Env: `SEARCH_API_KEY`

### 2. crypto-prices
- Uses CoinGecko free API
- Tools: `getPrice`, `getMarketCap`, `getTrending`
- No API key needed for basic usage

### 3. tweet (experimental)
- Posts tweets from the logged-in X account
- Tool: `postTweet({ text })` → posts tweet, returns URL
- Uses the already-authenticated Puppeteer browser
- **Requires explicit enable** — disabled by default for safety

### 4. knowledge-base
- Searches a local knowledge base (markdown files in a directory)
- Tool: `searchKnowledge({ query })` → returns relevant passages
- For project-specific context that's too large for system prompt

## Admin UI — Plugin Manager
```
┌─ PLUGINS ─────────────────────────────────────┐
│                                                │
│  ┌─ crypto-prices ──────── ● Enabled ────────┐│
│  │ Tools: getPrice, getMarketCap, getTrending ││
│  │ Calls today: 47 | Avg latency: 120ms      ││
│  │ [Disable] [Configure]                      ││
│  └────────────────────────────────────────────┘│
│                                                │
│  ┌─ web-search ────────── ● Enabled ─────────┐│
│  │ Tools: search                               ││
│  │ Calls today: 12 | Avg latency: 890ms      ││
│  │ [Disable] [Configure]                      ││
│  └────────────────────────────────────────────┘│
│                                                │
│  ┌─ tweet ─────────────── ○ Disabled ────────┐│
│  │ Tools: postTweet                            ││
│  │ ⚠ Requires explicit enable                 ││
│  │ [Enable] [Configure]                       ││
│  └────────────────────────────────────────────┘│
└────────────────────────────────────────────────┘
```

## Implementation Steps
1. Create plugin loader and registry
2. Modify providers to support tool calling
3. Build crypto-prices plugin (simplest, no API key)
4. Build web-search plugin
5. Build knowledge-base plugin
6. Add plugin status to admin panel
7. (Optional) Build tweet plugin with safety guards

## Validation
- [ ] Plugins load from directory on startup
- [ ] Tool definitions are included in LLM calls
- [ ] Agent correctly calls tools when relevant
- [ ] Tool results are incorporated into responses
- [ ] Plugins can be enabled/disabled at runtime
- [ ] Missing env vars for a plugin gracefully disables it
- [ ] Plugin errors don't crash the agent


