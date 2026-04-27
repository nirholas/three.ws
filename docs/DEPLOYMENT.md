# Deployment Guide

This guide covers building and deploying three.ws to production.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Build](#build)
- [Deploy to Vercel](#deploy-to-vercel)
- [Vercel Configuration](#vercel-configuration)
- [CORS Configuration](#cors-configuration)
- [Custom Domain](#custom-domain)
- [Embedding](#embedding)
- [Self-Hosting](#self-hosting)
- [CDN and Caching](#cdn-and-caching)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** (included with Node.js)
- **Vercel CLI** (installed globally or via npx): `npm i -g vercel`
- **Vercel account** linked via `vercel login`

---

## Build

```bash
# Production build
npm run build
```

This runs `vite build`, which:

1. Bundles all JavaScript from `src/` into optimized chunks
2. Processes CSS
3. Outputs to `dist/`

To inspect the build output:

```bash
ls -la dist/
```

To clean previous builds:

```bash
npm run clean    # Removes dist/
```

---

## Deploy to Vercel

The one-command deploy:

```bash
npm run deploy
```

This runs `npm run build` followed by `vercel --local-config vercel.json --prod`.

### Manual deployment steps:

```bash
# 1. Build
npm run build

# 2. Deploy to preview
vercel

# 3. Deploy to production
vercel --prod
```

---

## Vercel Configuration

**File:** `vercel.json`

```json
{
	"public": true,
	"routes": [
		{
			"src": "/assets/(.*)",
			"headers": { "cache-control": "max-age=604800, public" },
			"dest": "/assets/$1"
		},
		{
			"src": "/(.*)",
			"dest": "/public/$1"
		}
	]
}
```

### Route Breakdown

| Route       | Behavior                                                |
| ----------- | ------------------------------------------------------- |
| `/assets/*` | Static assets served with 7-day cache (604,800 seconds) |
| `/*`        | Everything else rewrites to `/public/*`                 |

The `public: true` flag allows listing of the deployment.

---

## CORS Configuration

**File:** `cors.json`

```json
[
	{
		"method": ["GET"],
		"origin": [
			"https://three.ws/",
			"https://*.three.ws",
			"https://chat.sperax.io",
			"https://sperax-jam2emun9-moomsi.vercel.app",
			"https://sperax-iota.vercel.app",
			"http://localhost:*",
			"https://localhost:*"
		],
		"responseHeader": ["Content-Type"],
		"maxAgeSeconds": 3600
	}
]
```

This allows:

- The production domain and all subdomains
- Partner domains (Sperax)
- Local development on any port
- Only GET requests
- 1-hour CORS preflight cache

### Adding a New Origin

To allow a new domain to embed three.ws:

1. Add the origin to the `origin` array in `cors.json`
2. Redeploy

---

## Custom Domain

The production deployment uses `three.ws`. To use a custom domain:

1. Add the domain in the Vercel dashboard under **Settings → Domains**
2. Configure DNS:
    - **A record:** `76.76.21.21`
    - **CNAME:** `cname.vercel-dns.com`
3. Vercel automatically provisions an SSL certificate

---

## Embedding

three.ws supports embedding via `<iframe>` with kiosk mode for a clean, UI-free experience:

```html
<iframe
	src="https://three.ws/#model=https://your-cdn.com/model.glb&kiosk=true"
	width="100%"
	height="600"
	frameborder="0"
	allow="autoplay; fullscreen"
	style="border: none;"
></iframe>
```

### Kiosk Mode

Add `kiosk=true` to the hash to:

- Hide the top header bar
- Auto-close the dat.gui panel
- Hide the validation toggle

### CORS Requirement

The model URL **must** allow cross-origin requests from the embedding page. If the model is on a different domain:

- Configure the CDN/server to include `Access-Control-Allow-Origin` headers
- Or serve the model from the same domain as three.ws

### Custom Camera Position

Set the initial viewpoint for an embed:

```
#model=URL&kiosk=true&cameraPosition=0,1.5,3
```

The coordinates are in Three.js world space (x, y, z).

---

## Self-Hosting

To host three.ws on your own infrastructure:

### With a Static File Server

```bash
# Build
npm run build

# Serve the dist/ directory
npx serve dist

# Or with nginx, Apache, Caddy, etc.
```

### Nginx Example

```nginx
server {
    listen 80;
    server_name 3d.yourdomain.com;
    root /var/www/3d-agent/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # CORS for model loading
    add_header Access-Control-Allow-Origin "*";
    add_header Access-Control-Allow-Methods "GET";
}
```

### Docker

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

```bash
docker build -t 3d-agent .
docker run -p 8080:80 3d-agent
```

---

## CDN and Caching

### External CDN Dependencies

The app loads decoder libraries from unpkg at runtime:

| Library               | CDN URL Pattern                                                        |
| --------------------- | ---------------------------------------------------------------------- |
| Draco decoder         | `https://unpkg.com/three@0.{REVISION}.x/examples/jsm/libs/draco/gltf/` |
| KTX2/Basis transcoder | `https://unpkg.com/three@0.{REVISION}.x/examples/jsm/libs/basis/`      |

These are versioned to the installed three.js revision, so they automatically match.

### HDR Environment Maps

Environment maps are loaded from Google Cloud Storage:

| Map             | URL                                                                       |
| --------------- | ------------------------------------------------------------------------- |
| Venice Sunset   | `https://storage.googleapis.com/donmccurdy-static/venice_sunset_1k.exr`   |
| Footprint Court | `https://storage.googleapis.com/donmccurdy-static/footprint_court_2k.exr` |

For self-hosting, download these files and update the paths in `src/environments.js`.

### Caching Strategy

| Resource                  | Cache Duration            |
| ------------------------- | ------------------------- |
| `/assets/*`               | 7 days (`max-age=604800`) |
| Decoder libraries (unpkg) | CDN-controlled            |
| HDR maps (GCS)            | CDN-controlled            |
| Application bundles       | Content-hashed by Vite    |

---

## Environment Variables

three.ws does not require any environment variables. All configuration is done via:

- URL hash parameters (runtime)
- `src/environments.js` (build-time)
- `vercel.json` (deployment)
- `cors.json` (CORS)

---

## Troubleshooting

### Build fails with "out of memory"

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

### Model doesn't load (CORS error)

Check the browser console for CORS errors. The model URL must either:

- Be on the same domain as the app
- Include proper `Access-Control-Allow-Origin` headers

### Blank page after deploy

Verify that `vercel.json` routing is correct. The `/(.*) → /public/$1` rewrite must match your build output structure.

### Draco models fail to load

Draco decoders are loaded from unpkg. If the CDN is down or blocked:

1. Download the Draco decoder files
2. Serve them locally
3. Update the `DRACO_LOADER.setDecoderPath()` call in `src/viewer.js`

### Environment maps don't appear

EXR files are large. Check:

- Network tab for failed requests
- Console for `EXRLoader` errors
- That the GCS URLs are accessible from your deployment

### Version management

```bash
# Bump version (patch/minor/major)
npm version patch

# This triggers postversion: git push && git push --tags
```
