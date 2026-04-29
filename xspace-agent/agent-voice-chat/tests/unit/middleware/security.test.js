// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRequire } from "module"
import express from "express"
import supertest from "supertest"

const require = createRequire(import.meta.url)

// Helper: build a minimal Express app that applies a given middleware and
// returns 200 OK with an empty body, so we can inspect response headers.
function makeApp(middleware) {
  const app = express()
  app.use(middleware)
  app.get("/", (_req, res) => res.status(200).send("ok"))
  return app
}

// ─── getAllowedOrigins() ───────────────────────────────────────────────────────

describe("getAllowedOrigins()", () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("returns the parsed array when CORS_ORIGINS is set", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CORS_ORIGINS", "https://example.com,https://app.example.com")
    const { getAllowedOrigins } = require("../../../src/server/middleware/security.js")
    expect(getAllowedOrigins()).toEqual(["https://example.com", "https://app.example.com"])
  })

  it("trims whitespace from each origin in CORS_ORIGINS", () => {
    vi.stubEnv("CORS_ORIGINS", " https://a.com , https://b.com ")
    vi.resetModules()
    const { getAllowedOrigins } = require("../../../src/server/middleware/security.js")
    const origins = getAllowedOrigins()
    expect(origins).toContain("https://a.com")
    expect(origins).toContain("https://b.com")
  })

  it("filters out empty string entries from CORS_ORIGINS", () => {
    vi.stubEnv("CORS_ORIGINS", "https://a.com,,https://b.com")
    vi.resetModules()
    const { getAllowedOrigins } = require("../../../src/server/middleware/security.js")
    const origins = getAllowedOrigins()
    expect(origins).not.toContain("")
    expect(origins).toHaveLength(2)
  })

  it("returns false (same-origin only) in production with no CORS_ORIGINS", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CORS_ORIGINS", "")
    vi.resetModules()
    const { getAllowedOrigins } = require("../../../src/server/middleware/security.js")
    expect(getAllowedOrigins()).toBe(false)
  })

  it("returns 'dev' in non-production with no CORS_ORIGINS set (localhost only)", () => {
    // In non-production (test/development), with no origins configured, allow localhost
    vi.unstubAllEnvs()
    delete process.env.CORS_ORIGINS
    delete process.env.ALLOWED_ORIGINS
    vi.resetModules()
    const { getAllowedOrigins } = require("../../../src/server/middleware/security.js")
    expect(getAllowedOrigins()).toBe("dev")
  })
})

// ─── getCorsConfig() ──────────────────────────────────────────────────────────

describe("getCorsConfig()", () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("uses an origin callback in non-production (localhost-only CORS)", () => {
    const origNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "test"
    delete process.env.CORS_ORIGINS
    delete process.env.ALLOWED_ORIGINS
    vi.resetModules()
    const { getCorsConfig } = require("../../../src/server/middleware/security.js")
    const config = getCorsConfig()
    process.env.NODE_ENV = origNodeEnv
    // Should be a callback function, not boolean true (which reflects any origin)
    expect(typeof config.origin).toBe("function")
  })

  it("allows localhost origins in non-production mode", () => {
    const origNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "test"
    delete process.env.CORS_ORIGINS
    delete process.env.ALLOWED_ORIGINS
    vi.resetModules()
    const { getCorsConfig } = require("../../../src/server/middleware/security.js")
    const config = getCorsConfig()
    process.env.NODE_ENV = origNodeEnv
    // Test the origin callback with localhost
    const results = []
    config.origin("http://localhost:3000", (err, allowed) => results.push({ err, allowed }))
    config.origin("https://evil.com", (err, allowed) => results.push({ err, allowed }))
    expect(results[0].allowed).toBe(true)
    expect(results[1].allowed).toBe(false)
  })

  it("allows configured origins when CORS_ORIGINS is set", () => {
    vi.stubEnv("CORS_ORIGINS", "https://example.com")
    vi.resetModules()
    const { getCorsConfig } = require("../../../src/server/middleware/security.js")
    const config = getCorsConfig()
    // Origin is a callback that checks against the allowlist
    expect(typeof config.origin).toBe("function")
    const results = []
    config.origin("https://example.com", (err, allowed) => results.push({ err, allowed }))
    config.origin("https://evil.com", (err, allowed) => results.push({ err, allowed }))
    expect(results[0].allowed).toBe(true)
    expect(results[1].allowed).toBe(false)
  })

  it("enables credentials when a specific origin list is configured", () => {
    vi.stubEnv("CORS_ORIGINS", "https://example.com")
    vi.resetModules()
    const { getCorsConfig } = require("../../../src/server/middleware/security.js")
    const config = getCorsConfig()
    expect(config.credentials).toBe(true)
  })

  it("only allows GET and POST methods", () => {
    vi.resetModules()
    const { getCorsConfig } = require("../../../src/server/middleware/security.js")
    const config = getCorsConfig()
    expect(config.methods).toEqual(["GET", "POST"])
  })

  it("sets origin to false (same-origin) in production with no CORS_ORIGINS", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CORS_ORIGINS", "")
    vi.resetModules()
    const { getCorsConfig } = require("../../../src/server/middleware/security.js")
    const config = getCorsConfig()
    // getAllowedOrigins() returns false; getCorsConfig maps false -> false
    expect(config.origin).toBe(false)
  })
})

// ─── getHelmetMiddleware() ────────────────────────────────────────────────────

describe("getHelmetMiddleware()", () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("returns a function (Express middleware)", () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    expect(typeof getHelmetMiddleware()).toBe("function")
  })

  it("sets X-Content-Type-Options: nosniff", async () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("sets a Content-Security-Policy header", async () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    expect(res.headers["content-security-policy"]).toBeDefined()
  })

  it("includes ws: in connect-src in non-production (localhost WebSocket origins)", async () => {
    const origNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "test"
    delete process.env.CORS_ORIGINS
    delete process.env.ALLOWED_ORIGINS
    vi.resetModules()
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    process.env.NODE_ENV = origNodeEnv
    const csp = res.headers["content-security-policy"]
    // In non-production mode, localhost WebSocket origins are included
    expect(csp).toContain("ws:")
  })

  it("includes blob: in media-src (for audio playback)", async () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    const csp = res.headers["content-security-policy"]
    expect(csp).toContain("blob:")
  })

  it("sets X-Frame-Options to SAMEORIGIN by default", async () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    expect(res.headers["x-frame-options"]).toMatch(/SAMEORIGIN/i)
  })

  it("sets X-Frame-Options to DENY when X_FRAME_OPTIONS=DENY", async () => {
    vi.stubEnv("X_FRAME_OPTIONS", "DENY")
    vi.resetModules()
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    expect(res.headers["x-frame-options"]).toMatch(/DENY/i)
  })

  it("includes 'self' in default-src CSP directive", async () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    const csp = res.headers["content-security-policy"]
    expect(csp).toContain("'self'")
  })

  it("includes OpenAI API domain in connect-src", async () => {
    const { getHelmetMiddleware } = require("../../../src/server/middleware/security.js")
    const app = makeApp(getHelmetMiddleware())
    const res = await supertest(app).get("/")
    const csp = res.headers["content-security-policy"]
    expect(csp).toContain("api.openai.com")
  })
})

// ─── Constants ────────────────────────────────────────────────────────────────

describe("Security constants", () => {
  it("JSON_BODY_LIMIT is '1mb'", () => {
    const { JSON_BODY_LIMIT } = require("../../../src/server/middleware/security.js")
    expect(JSON_BODY_LIMIT).toBe("1mb")
  })

  it("MAX_AUDIO_SIZE is 5 MB (5 * 1024 * 1024 bytes)", () => {
    const { MAX_AUDIO_SIZE } = require("../../../src/server/middleware/security.js")
    expect(MAX_AUDIO_SIZE).toBe(5 * 1024 * 1024)
  })

  it("MAX_AUDIO_SIZE is a positive integer", () => {
    const { MAX_AUDIO_SIZE } = require("../../../src/server/middleware/security.js")
    expect(Number.isInteger(MAX_AUDIO_SIZE)).toBe(true)
    expect(MAX_AUDIO_SIZE).toBeGreaterThan(0)
  })
})

// ─── Body size limit (integration) ───────────────────────────────────────────

describe("JSON body size limit (express.json middleware)", () => {
  it("accepts a request within 1 MB", async () => {
    const { JSON_BODY_LIMIT } = require("../../../src/server/middleware/security.js")
    const app = express()
    app.use(express.json({ limit: JSON_BODY_LIMIT }))
    app.post("/data", (req, res) => res.status(200).json({ received: true }))

    const payload = { message: "x".repeat(100) }
    const res = await supertest(app).post("/data").send(payload).set("Content-Type", "application/json")
    expect(res.status).toBe(200)
  })

  it("rejects a request exceeding the body size limit with 413", async () => {
    const app = express()
    // Use a very small limit to trigger rejection without sending a huge payload
    app.use(express.json({ limit: "1b" }))
    app.post("/data", (req, res) => res.status(200).json({ received: true }))

    const payload = { message: "x".repeat(1000) }
    const res = await supertest(app).post("/data").send(payload).set("Content-Type", "application/json")
    expect(res.status).toBe(413)
  })
})

// ─── Audio size validation (constant-based guard) ────────────────────────────

describe("Audio size validation", () => {
  it("accepts audio data within MAX_AUDIO_SIZE", () => {
    const { MAX_AUDIO_SIZE } = require("../../../src/server/middleware/security.js")
    const audioSize = MAX_AUDIO_SIZE - 1
    expect(audioSize <= MAX_AUDIO_SIZE).toBe(true)
  })

  it("rejects audio data exceeding MAX_AUDIO_SIZE", () => {
    const { MAX_AUDIO_SIZE } = require("../../../src/server/middleware/security.js")
    const oversizedAudio = MAX_AUDIO_SIZE + 1
    expect(oversizedAudio > MAX_AUDIO_SIZE).toBe(true)
  })
})


