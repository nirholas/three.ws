# Production Deployment Checklist

## Prerequisites

- Docker 24+ and Docker Compose v2+
- A domain name with DNS pointing to your server
- SSL certificate (Let's Encrypt recommended via Certbot or cert-manager)
- At minimum one AI provider API key

---

## Environment Variables Reference

Copy `.env.example` to `.env` and fill in the values below.

### Required

| Variable | Description |
|---|---|
| `AI_PROVIDER` | LLM backend: `openai`, `openai-chat`, `claude`, `groq` |
| `OPENAI_API_KEY` | Required when `AI_PROVIDER=openai`, `openai-chat`, `STT_PROVIDER=openai`, or `TTS_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | Required when `AI_PROVIDER=claude` |
| `GROQ_API_KEY` | Required when `AI_PROVIDER=groq` or `STT_PROVIDER=groq` |

### Security (Strongly Recommended in Production)

| Variable | Description | Default |
|---|---|---|
| `API_KEY` | Bearer token required on all `/api/*` routes | _(unprotected)_ |
| `CORS_ORIGINS` | Comma-separated allowed origins | `*` (dev) / same-origin (prod) |
| `NODE_ENV` | Set to `production` for JSON logs, strict defaults | `development` |

### Optional

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP listen port inside container | `3000` |
| `PROJECT_NAME` | Display name in UI | `AI Agents` |
| `INPUT_CHAT` | Enable text input in UI (`true`/`false`) | `true` |
| `AVATAR_URL_1` | Avatar image URL for agent 1 | _(none)_ |
| `AVATAR_URL_2` | Avatar image URL for agent 2 | _(none)_ |
| `STT_PROVIDER` | Speech-to-text: `groq`, `openai` | `groq` |
| `TTS_PROVIDER` | Text-to-speech: `openai`, `elevenlabs`, `chatterbox`, `piper`, `browser` | `openai` |
| `ELEVENLABS_API_KEY` | Required when `TTS_PROVIDER=elevenlabs` | _(none)_ |
| `ELEVENLABS_VOICE_0` | ElevenLabs voice ID for agent 1 | _(default)_ |
| `ELEVENLABS_VOICE_1` | ElevenLabs voice ID for agent 2 | _(default)_ |
| `CHATTERBOX_API_URL` | Chatterbox server URL | `http://localhost:8150` |
| `PIPER_API_URL` | Piper TTS server URL | `http://localhost:5000` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `RATE_LIMIT_MESSAGE` | Messages/min per IP | `20` |
| `RATE_LIMIT_SESSION` | Sessions/min per IP | `5` |
| `RATE_LIMIT_GENERAL` | General requests/min per IP | `100` |
| `MEMORY_ENABLED` | Enable conversation memory/RAG | `true` |
| `MEMORY_MAX_MEMORIES` | Max stored memories | `1000` |

---

## Deployment Steps

### 1. Prepare the server

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Clone and configure

```bash
git clone <your-repo-url> agent-voice-chat
cd agent-voice-chat
cp .env.example .env
# Edit .env with your API keys and production settings
nano .env
```

### 3. Obtain SSL certificate (Let's Encrypt)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com
# Certificates will be at: /etc/letsencrypt/live/yourdomain.com/
```

### 4. Configure nginx

Edit `deploy/nginx.conf` and replace `yourdomain.com` with your actual domain.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/agent-voice-chat
sudo ln -s /etc/nginx/sites-available/agent-voice-chat /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Start the application

```bash
cd agent-voice-chat
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d
```

### 6. Verify health

```bash
# Check container is healthy
docker compose ps

# Check logs
docker compose logs -f app

# Test health endpoint
curl https://yourdomain.com/api/health
```

---

## Security Checklist

- [ ] `API_KEY` is set to a strong random value (`openssl rand -hex 32`)
- [ ] `CORS_ORIGINS` is set to your frontend domain only
- [ ] `NODE_ENV=production` is set
- [ ] All API keys are rotated from any dev/staging environments
- [ ] SSL certificate is valid and auto-renewing
- [ ] Firewall allows only ports 80, 443 (and 22 for SSH)
- [ ] Container runs as non-root user (enforced by Dockerfile)
- [ ] Memory and knowledge volumes are backed up regularly

---

## Backup and Restore

### Backup conversation memory and knowledge base

```bash
docker run --rm \
  -v agent-voice-chat_memory-data:/data/memory \
  -v agent-voice-chat_knowledge-data:/data/knowledge \
  -v $(pwd)/backups:/backup \
  node:20-slim tar czf /backup/data-$(date +%Y%m%d).tar.gz -C /data .
```

### Restore

```bash
docker run --rm \
  -v agent-voice-chat_memory-data:/data/memory \
  -v agent-voice-chat_knowledge-data:/data/knowledge \
  -v $(pwd)/backups:/backup \
  node:20-slim tar xzf /backup/data-YYYYMMDD.tar.gz -C /data
```

---

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d
```

---

## Security Scanning

Scan the image for known vulnerabilities before deploying:

```bash
# Using Docker Scout (requires Docker Hub login)
docker scout cves agent-voice-chat-app

# Using Trivy (no account needed)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image agent-voice-chat-app:latest
```
