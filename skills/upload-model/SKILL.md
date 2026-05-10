---
name: upload-model
description: Upload a GLB or glTF 3D model to three.ws and get a hosted avatar ID. Three-step flow: get a presigned URL, PUT the file bytes, register the model. The returned avatar_id can be attached to any agent.
allowed-tools: Read, Bash
---

# upload-model

Upload a GLB or glTF file to three.ws storage and register it as a reusable avatar.

**Auth:** `Authorization: Bearer $THREEWS_API_KEY` with `avatars:write` scope.

## Three-step upload flow

### Step 1 — Get a presigned upload URL

```bash
PRESIGN=$(curl -s -X POST https://three.ws/api/avatars/presign \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content_type": "model/gltf-binary",
    "size_bytes": 2048000,
    "slug": "my-avatar"
  }')

UPLOAD_URL=$(echo $PRESIGN | jq -r '.upload_url')
STORAGE_KEY=$(echo $PRESIGN | jq -r '.storage_key')
```

**Presign request fields:**

| Field | Required | Description |
|---|---|---|
| `content_type` | yes | `model/gltf-binary` for GLB, `model/gltf+json` for glTF |
| `size_bytes` | yes | Exact file size in bytes |
| `slug` | no | URL-friendly name (auto-generated if omitted) |

**Presign response:**
```json
{
  "storage_key": "u/uid123/my-avatar.glb",
  "upload_url": "https://r2.cloudflarestorage.com/...",
  "method": "PUT",
  "headers": { "content-type": "model/gltf-binary" },
  "expires_in": 300
}
```

### Step 2 — Upload the file bytes

```bash
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: model/gltf-binary" \
  --data-binary @./my-avatar.glb
```

The URL expires in 5 minutes. Upload immediately after step 1.

### Step 3 — Register the model

```bash
curl -X POST https://three.ws/api/avatars \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"storage_key\": \"$STORAGE_KEY\",
    \"name\": \"My Avatar\",
    \"content_type\": \"model/gltf-binary\",
    \"size_bytes\": 2048000
  }"
```

**Response:**
```json
{
  "id": "av_xyz789",
  "name": "My Avatar",
  "url": "https://cdn.three.ws/u/uid123/my-avatar.glb",
  "created_at": "2026-05-10T12:00:00Z"
}
```

## Supported formats

| Format | `content_type` | Extension |
|---|---|---|
| Binary glTF | `model/gltf-binary` | `.glb` |
| glTF JSON | `model/gltf+json` | `.gltf` |

GLB is preferred — self-contained, no external texture dependencies.

## Full one-liner workflow

```bash
FILE=./character.glb
SIZE=$(wc -c < "$FILE")

# 1. Presign
PRESIGN=$(curl -s -X POST https://three.ws/api/avatars/presign \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content_type\":\"model/gltf-binary\",\"size_bytes\":$SIZE,\"slug\":\"character\"}")

UPLOAD_URL=$(echo $PRESIGN | jq -r '.upload_url')
STORAGE_KEY=$(echo $PRESIGN | jq -r '.storage_key')

# 2. Upload
curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: model/gltf-binary" \
  --data-binary @"$FILE"

# 3. Register
AVATAR_ID=$(curl -s -X POST https://three.ws/api/avatars \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"storage_key\":\"$STORAGE_KEY\",\"name\":\"Character\",
       \"content_type\":\"model/gltf-binary\",\"size_bytes\":$SIZE}" \
  | jq -r '.id')

echo "Avatar ID: $AVATAR_ID"
```

## List your models

```bash
curl https://three.ws/api/avatars \
  -H "Authorization: Bearer $THREEWS_API_KEY"
```

```json
{
  "avatars": [
    { "id": "av_xyz789", "name": "My Avatar", "url": "https://cdn.three.ws/..." },
    { "id": "av_def456", "name": "Character",  "url": "https://cdn.three.ws/..." }
  ]
}
```

## Use in the embed

Once you have an `avatar_id`, attach it to an agent (see create-agent skill) or reference it directly:

```html
<agent-3d body="https://cdn.three.ws/u/uid123/my-avatar.glb"
          camera-controls auto-rotate environment="neutral">
</agent-3d>
```

## Where to get 3D models

- **Ready Player Me** — [readyplayer.me](https://readyplayer.me) — free GLB avatars with morph targets for lip-sync
- **Avaturn** — [avaturn.me](https://avaturn.me) — photorealistic avatars from a photo
- **Mixamo** — [mixamo.com](https://mixamo.com) — characters + animation library
- **Sketchfab** — [sketchfab.com](https://sketchfab.com) — large creative commons model library
- **Poly Pizza** — [poly.pizza](https://poly.pizza) — low-poly models, free

Models with blend shapes (morph targets) on the face support automatic lip-sync and emotion blending.
