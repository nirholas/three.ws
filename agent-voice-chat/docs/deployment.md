# Deployment

agent-voice-chat is a Node.js server that needs a persistent process for WebSocket connections. It works with any platform that supports long-running Node.js processes.

## Requirements

- **Node.js 18+**
- **WebSocket support** — the hosting platform must support persistent WebSocket connections (not just HTTP)
- **HTTPS** — required for microphone access in browsers (except localhost)
- **Outbound HTTPS** — the server calls external APIs (OpenAI, Anthropic, Groq, ElevenLabs)

## Docker

### Using the Dockerfile

```bash
docker build -t agent-voice-chat .
docker run -p 3000:3000 --env-file .env agent-voice-chat
```

### Using Docker Compose

```bash
docker compose up
```

This starts the server on port 3000 with environment variables from `.env`.

### Production Docker Compose

```yaml
# docker-compose.prod.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/config"]
      interval: 30s
      timeout: 5s
      retries: 3
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Railway

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) and create a new project
3. Select "Deploy from GitHub repo"
4. Add environment variables in the Railway dashboard:
   - `AI_PROVIDER`
   - `OPENAI_API_KEY` (and/or other provider keys)
   - `STT_PROVIDER`, `TTS_PROVIDER`
5. Railway auto-detects the `npm start` script and deploys

Railway supports WebSockets out of the box.

## Render

1. Push your code to GitHub
2. Go to [render.com](https://render.com) and create a new **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter or higher
5. Add environment variables in the Render dashboard
6. Deploy

> Render's free tier spins down after inactivity, which drops WebSocket connections. Use a paid plan for production.

## Fly.io

Create a `fly.toml`:

```toml
app = "agent-voice-chat"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true

[env]
  PORT = "3000"
```

Deploy:

```bash
fly launch
fly secrets set OPENAI_API_KEY=sk-... AI_PROVIDER=openai
fly deploy
```

## VPS (Ubuntu/Debian)

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Clone and Install

```bash
git clone https://github.com/anthropics/agent-voice-chat.git
cd agent-voice-chat
npm install --production
cp .env.example .env
nano .env  # Add your API keys
```

### 3. Run with PM2

```bash
npm install -g pm2
pm2 start server.js --name agent-voice-chat
pm2 save
pm2 startup  # Auto-start on reboot
```

### 4. Set Up Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/voice-chat
server {
    listen 80;
    server_name voice.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # Required for WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and get SSL:

```bash
sudo ln -s /etc/nginx/sites-available/voice-chat /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d voice.yourdomain.com
```

## Environment Variables in Production

Never commit `.env` files. Use your platform's secrets/environment management:

| Platform | How to Set |
|----------|-----------|
| Docker | `--env-file .env` or `-e KEY=value` |
| Railway | Dashboard → Variables |
| Render | Dashboard → Environment |
| Fly.io | `fly secrets set KEY=value` |
| VPS | `.env` file (restrict permissions: `chmod 600 .env`) |

## Health Checks

The `GET /config` endpoint returns a 200 response and can be used as a health check. It doesn't require authentication and returns the server's configuration.

```bash
curl http://localhost:3000/config
```

## Scaling Considerations

- **WebSocket connections are stateful.** Horizontal scaling requires sticky sessions or a shared state backend (Redis).
- **Each active conversation** consumes one STT + one LLM + one TTS API call per user message. Plan your API quotas accordingly.
- **Room auto-cleanup** runs every 5 minutes and removes empty rooms past their TTL, so memory usage stays bounded.
- **Audio data** is not persisted by default. If you need conversation recordings, you'll need to add that separately.
