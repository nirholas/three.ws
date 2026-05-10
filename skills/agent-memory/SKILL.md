---
name: agent-memory
description: Read and write persistent memory entries for a three.ws agent. Memory entries survive across sessions and are injected into the agent's context window at runtime. Use to store facts, preferences, and long-term state.
allowed-tools: Read, Edit, Write, Bash
---

# agent-memory

Persistent key/value memory for three.ws agents. Entries are injected into the LLM's context at the start of each conversation, so the agent "remembers" across sessions.

**Auth:** `Authorization: Bearer $THREEWS_API_KEY`

## Write a memory entry

```bash
curl -X POST https://three.ws/api/agent-memory \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "a_abc123",
    "key": "user_name",
    "value": "Alex",
    "type": "fact"
  }'
```

**Request fields:**

| Field | Required | Description |
|---|---|---|
| `agentId` | yes | Agent ID from create-agent |
| `key` | yes | Unique key for this memory (max 120 chars) |
| `value` | yes | The content to remember (string or JSON) |
| `type` | no | `fact`, `preference`, `instruction`, `context` (default: `fact`) |

**Response:**
```json
{
  "id": "mem_r7x2k",
  "agentId": "a_abc123",
  "key": "user_name",
  "value": "Alex",
  "type": "fact",
  "created_at": "2026-05-10T12:00:00Z"
}
```

Upserts by `key` — calling again with the same key updates the value in place.

## Read all memories for an agent

```bash
curl "https://three.ws/api/agent-memory?agentId=a_abc123" \
  -H "Authorization: Bearer $THREEWS_API_KEY"
```

```json
{
  "entries": [
    { "id": "mem_r7x2k", "key": "user_name", "value": "Alex", "type": "fact" },
    { "id": "mem_t9q1m", "key": "preferred_language", "value": "Spanish", "type": "preference" },
    { "id": "mem_p3w8n", "key": "project_context", "value": "Building a crypto dashboard", "type": "context" }
  ]
}
```

**Query parameters:**

| Param | Description |
|---|---|
| `agentId` | Required. Filter to one agent. |
| `type` | Optional. Filter by memory type. |
| `since` | Optional. Unix ms timestamp — only return entries updated after this time. |
| `limit` | Optional. Max entries (default 200, max 500). |

## Forget a memory

```bash
curl -X DELETE https://three.ws/api/agent-memory/mem_r7x2k \
  -H "Authorization: Bearer $THREEWS_API_KEY"
```

## Memory types

| Type | How the agent uses it |
|---|---|
| `fact` | Injected as a stated fact ("The user's name is Alex") |
| `preference` | Shapes behavior ("User prefers responses in Spanish") |
| `instruction` | Adds to system prompt ("Always greet the user by name") |
| `context` | Background context ("User is building a crypto dashboard") |

## Common patterns

### Remember user preferences after a conversation

```bash
# Store what the user told the agent
curl -X POST https://three.ws/api/agent-memory \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "a_abc123",
    "key": "prefers_short_answers",
    "value": "true",
    "type": "preference"
  }'
```

### Store structured data as JSON

```bash
curl -X POST https://three.ws/api/agent-memory \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "a_abc123",
    "key": "portfolio",
    "value": "{\"tokens\":[\"SOL\",\"ETH\"],\"risk\":\"medium\"}",
    "type": "context"
  }'
```

### Sync memories from another system

```bash
# Bulk-write from a local JSON file
cat memories.json | jq -c '.[]' | while read entry; do
  curl -s -X POST https://three.ws/api/agent-memory \
    -H "Authorization: Bearer $THREEWS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$entry"
done
```

### Clear all memories for an agent

```bash
# Fetch all IDs, then delete each
curl -s "https://three.ws/api/agent-memory?agentId=a_abc123" \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  | jq -r '.entries[].id' \
  | while read id; do
      curl -s -X DELETE "https://three.ws/api/agent-memory/$id" \
        -H "Authorization: Bearer $THREEWS_API_KEY"
    done
```

## How memory affects the avatar

At the start of each conversation the three.ws runtime fetches all memories for the agent and prepends them to the system prompt. The avatar will naturally incorporate them — no extra wiring needed.

Example injection:
```
[Agent memory]
- user_name: Alex (fact)
- preferred_language: Spanish (preference)
- project_context: Building a crypto dashboard (context)
```
