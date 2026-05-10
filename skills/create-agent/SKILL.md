---
name: create-agent
description: Create, list, and update 3D AI agents on three.ws. Configure the agent name, system instructions, LLM brain, and 3D avatar body. Returns agent IDs you can drop straight into the <agent-3d> web component.
allowed-tools: Read, Edit, Write, Bash
---

# create-agent

Create and manage AI agents with 3D bodies via the three.ws REST API.

**Auth:** `Authorization: Bearer $THREEWS_API_KEY`

## Create an agent

```bash
curl -X POST https://three.ws/api/agents \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aria",
    "instructions": "You are Aria, a concise and friendly product assistant.",
    "brain": "claude-sonnet-4-6"
  }'
```

**Response:**
```json
{
  "id": "a_abc123",
  "name": "Aria",
  "brain": "claude-sonnet-4-6",
  "created_at": "2026-05-10T12:00:00Z",
  "embed_url": "https://three.ws/embed/a_abc123"
}
```

## Agent body (avatar)

Attach a 3D model by passing `avatar_id` (from the upload-model skill) or an IPFS/HTTPS URL:

```bash
curl -X POST https://three.ws/api/agents \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aria",
    "instructions": "You are Aria.",
    "brain": "claude-sonnet-4-6",
    "avatar_id": "av_xyz789"
  }'
```

## List your agents

```bash
curl https://three.ws/api/agents \
  -H "Authorization: Bearer $THREEWS_API_KEY"
```

```json
{
  "agents": [
    { "id": "a_abc123", "name": "Aria", "brain": "claude-sonnet-4-6" },
    { "id": "a_def456", "name": "Max",  "brain": "claude-haiku-4-5" }
  ]
}
```

## Get a single agent (public)

```bash
curl https://three.ws/api/agents/a_abc123
```

## Update an agent

```bash
curl -X PUT https://three.ws/api/agents/a_abc123 \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": "Updated system prompt.",
    "brain": "claude-opus-4-7"
  }'
```

Updatable fields:

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name (max 80 chars) |
| `instructions` | string | System prompt for the LLM brain |
| `brain` | string | Model ID — see brain options below |
| `avatar_id` | string | ID of an uploaded 3D model |
| `animations` | array | Named animation clips to attach |

## Brain options

| ID | Description |
|---|---|
| `claude-opus-4-7` | Most capable, best for complex reasoning |
| `claude-sonnet-4-6` | Balanced speed and quality (default) |
| `claude-haiku-4-5` | Fastest, lowest cost |

## Embed immediately after creation

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d agent-id="a_abc123" mode="floating" position="bottom-right"
          width="320px" height="480px"></agent-3d>
```

## Animations

Add named animation clips so the avatar can move on command:

```json
{
  "animations": [
    {
      "name": "idle",
      "url": "https://cdn.three.ws/anims/idle.glb",
      "loop": true,
      "source": "preset"
    },
    {
      "name": "wave",
      "url": "https://example.com/wave.glb",
      "loop": false,
      "source": "custom"
    }
  ]
}
```

Animation sources: `mixamo`, `preset`, `custom`

## Delete an agent

```bash
curl -X DELETE https://three.ws/api/agents/a_abc123 \
  -H "Authorization: Bearer $THREEWS_API_KEY"
```

Soft-deletes the agent. Memory and action history are also cleared.

## Full workflow example

```bash
# 1. Upload a model (see upload-model skill)
AVATAR=$(curl -s -X POST https://three.ws/api/avatars \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "storage_key": "u/uid/my-avatar.glb", "name": "My Avatar",
        "content_type": "model/gltf-binary", "size_bytes": 2048000 }' \
  | jq -r '.id')

# 2. Create the agent with that avatar
AGENT=$(curl -s -X POST https://three.ws/api/agents \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Aria\",
    \"instructions\": \"You are Aria. Be concise.\",
    \"brain\": \"claude-sonnet-4-6\",
    \"avatar_id\": \"$AVATAR\"
  }" | jq -r '.id')

echo "Agent $AGENT ready — embed with agent-id=\"$AGENT\""
```
