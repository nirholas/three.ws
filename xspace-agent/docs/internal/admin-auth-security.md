> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Admin Authentication & Security

## Problem
The admin panel at `/admin` has **zero authentication**. Anyone who knows the URL can start/stop the bot, join/leave Spaces, and control agents. This is a critical issue for a public-facing server.

## Current State
- `server.js` serves `/admin` as a static HTML file with no middleware
- Socket.IO `/space` namespace accepts all connections — no auth check
- No CORS restrictions on admin endpoints
- `/config` and `/state` endpoints expose internal state to anyone

## Task: Add Authentication Layer

### Option A: Simple Token Auth (Recommended for MVP)

**How it works:**
- Admin sets `ADMIN_TOKEN` in `.env`
- Admin page shows a login form that stores the token in localStorage
- All Socket.IO connections and API requests include the token
- Server middleware validates token on protected routes/events

**Implementation:**

1. **Environment variable:**
```env
ADMIN_TOKEN=your-secret-token-here
```

2. **Express middleware for protected routes:**
```js
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// Apply to sensitive routes
app.get('/admin', requireAuth, (req, res) => res.sendFile('admin.html'))
app.get('/state', requireAuth, (req, res) => { ... })
app.get('/config', requireAuth, (req, res) => { ... })
```

3. **Socket.IO auth middleware:**
```js
io.of('/space').use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (!process.env.ADMIN_TOKEN) return next() // no token = no auth required
  if (token === process.env.ADMIN_TOKEN) return next()
  // Allow viewer connections (dashboard) but restrict admin commands
  socket.isAdmin = (token === process.env.ADMIN_TOKEN)
  next()
})
```

4. **Protect admin Socket.IO events:**
```js
// Only admin sockets can emit these
const adminEvents = ['xspace:start', 'xspace:stop', 'xspace:join', 'xspace:leave', 'xspace:2fa']
adminEvents.forEach(event => {
  socket.on(event, (data) => {
    if (!socket.isAdmin) return socket.emit('xSpacesError', 'Unauthorized')
    // ... existing handler
  })
})
```

5. **Admin page login UI:**
- On load: check localStorage for token
- If no token: show login form (single password field)
- On submit: store token, attempt Socket.IO connection with auth
- If connection fails: clear token, show login again
- Show "Logout" button that clears token

### Option B: Session-Based Auth (More Robust)
- Express session with cookie-based auth
- Login endpoint validates username/password from env vars
- Session middleware protects routes
- More complex but supports multiple admin users

### Additional Security Measures

**Rate limiting on public endpoints:**
```js
// Use express-rate-limit
const rateLimit = require('express-rate-limit')

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per window
})

app.use('/session/', apiLimiter)
```

**CORS configuration:**
```js
const cors = require('cors')
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}))
```

**Helmet for security headers:**
```js
const helmet = require('helmet')
app.use(helmet({
  contentSecurityPolicy: false // needed for inline scripts in admin.html
}))
```

**Environment variable validation on startup:**
```js
const required = ['OPENAI_API_KEY'] // minimum required vars
const missing = required.filter(v => !process.env[v])
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}
```

## New Dependencies
```json
"express-rate-limit": "^7.0.0",
"helmet": "^7.0.0"
```

## Validation
- [ ] Accessing `/admin` without token shows login page
- [ ] Socket.IO admin events rejected without valid token
- [ ] Dashboard (index.html) works without auth (viewer-only)
- [ ] `/state` and `/config` require auth
- [ ] Rate limiting prevents brute force on auth
- [ ] Bot still functions normally with auth enabled
- [ ] When ADMIN_TOKEN is not set, auth is disabled (backwards compatible)


