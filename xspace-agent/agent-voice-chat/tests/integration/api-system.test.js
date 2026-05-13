// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import request from "supertest"
import { beforeEach, describe, it, expect } from "vitest"
import createSystemRoutes from "../../src/server/routes/system.js"
import { createTestApp } from "../helpers/create-test-app.js"
import { CircuitBreaker } from "../../src/server/circuit-breaker.js"
import { setCircuitBreakers } from "../../src/server/health.js"

describe("System API routes", () => {
  let app, breakers

  beforeEach(() => {
    const ctx = createTestApp()
    app = ctx.app

    breakers = {
      llm: new CircuitBreaker("llm"),
      stt: new CircuitBreaker("stt"),
      tts: new CircuitBreaker("tts")
    }

    // Register breakers with health module
    setCircuitBreakers(breakers)

    const systemRouter = createSystemRoutes({
      provider: ctx.provider,
      AI_PROVIDER: ctx.AI_PROVIDER,
      tts: ctx.tts,
      registry: ctx.registry,
      spaceState: {},
      metrics: null,
      breakers
    })
    app.use("/api", systemRouter)
  })

  describe("GET /api/health", () => {
    it("should return health status", async () => {
      const res = await request(app).get("/api/health")
      expect([200, 503]).toContain(res.status)
      expect(res.body).toHaveProperty("status")
      expect(res.body).toHaveProperty("provider")
      expect(res.body.provider.name).toBe("openai-chat")
      expect(res.body.provider.type).toBe("socket")
    })

    it("should return shallow health for load balancers", async () => {
      const res = await request(app).get("/api/health?depth=shallow")
      expect(res.status).toBe(200)
      expect(res.body.status).toBe("ok")
      expect(res.body.uptime).toBeTypeOf("number")
      expect(res.body).not.toHaveProperty("provider")
    })

    it("should include providers in default response", async () => {
      const res = await request(app).get("/api/health")
      expect(res.body).toHaveProperty("providers")
      expect(res.body.providers).toHaveProperty("llm")
      expect(res.body.providers).toHaveProperty("stt")
      expect(res.body.providers).toHaveProperty("tts")
      expect(res.body.providers.llm).toHaveProperty("circuitBreaker")
      expect(res.body.providers.llm.circuitBreaker).toBe("CLOSED")
    })

    it("should accept depth=deep parameter", async () => {
      const res = await request(app).get("/api/health?depth=deep")
      expect([200, 503]).toContain(res.status)
      expect(res.body).toHaveProperty("providers")
    })
  })

  describe("GET /api/health/providers", () => {
    it("should return per-provider health with circuit breaker state", async () => {
      const res = await request(app).get("/api/health/providers")
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("llm")
      expect(res.body).toHaveProperty("stt")
      expect(res.body).toHaveProperty("tts")
      expect(res.body.llm.circuitBreaker).toBe("CLOSED")
      expect(res.body.llm.successRate).toBe(1.0)
      expect(res.body.llm).toHaveProperty("failureCount")
      expect(res.body.llm).toHaveProperty("lastSuccess")
      expect(res.body.llm).toHaveProperty("lastFailure")
      expect(res.body.llm).toHaveProperty("avgLatencyMs")
    })

    it("should reflect OPEN circuit breaker state after failures", async () => {
      // Trip the LLM breaker
      for (let i = 0; i < 5; i++) {
        try { await breakers.llm.execute(() => Promise.reject(new Error("fail"))) } catch {}
      }
      const res = await request(app).get("/api/health/providers")
      expect(res.body.llm.circuitBreaker).toBe("OPEN")
      expect(res.body.llm.failureCount).toBe(5)
    })
  })

  describe("POST /api/health/providers/check", () => {
    it("should run on-demand provider health check", async () => {
      const res = await request(app).post("/api/health/providers/check")
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("llm")
      expect(res.body).toHaveProperty("stt")
      expect(res.body).toHaveProperty("tts")
      expect(res.body.llm).toHaveProperty("provider")
      expect(res.body.llm).toHaveProperty("connectivity")
      expect(res.body.llm).toHaveProperty("circuitBreaker")
    })
  })

  describe("GET /api/health/live", () => {
    it("should always return 200 with alive status", async () => {
      const res = await request(app).get("/api/health/live")
      expect(res.status).toBe(200)
      expect(res.body.status).toBe("alive")
      expect(res.body.uptime).toBeTypeOf("number")
    })
  })

  describe("GET /api/health/ready", () => {
    it("should return 503 when providers are unconfigured", async () => {
      // Without API keys, providers are unconfigured → not ready
      const res = await request(app).get("/api/health/ready")
      expect(res.status).toBe(503)
      expect(res.body.status).toBe("not_ready")
      expect(res.body).toHaveProperty("providers")
    })

    it("should include provider details in readiness response", async () => {
      const res = await request(app).get("/api/health/ready")
      expect(res.body.providers).toHaveProperty("llm")
      expect(res.body.providers).toHaveProperty("stt")
      expect(res.body.providers).toHaveProperty("tts")
    })
  })

  describe("GET /api/config", () => {
    it("should return system config", async () => {
      const res = await request(app).get("/api/config")
      expect(res.status).toBe(200)
      expect(res.body.provider).toBe("openai-chat")
      expect(res.body.providerType).toBe("socket")
      expect(res.body.tts).toBe("browser")
      expect(res.body.features).toHaveProperty("voiceChat")
      expect(res.body.features).toHaveProperty("textChat")
      expect(res.body.agents).toBeInstanceOf(Array)
    })
  })

  describe("GET /api/providers", () => {
    it("should return available providers", async () => {
      const res = await request(app).get("/api/providers")
      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(4)
      const names = res.body.map(p => p.name)
      expect(names).toContain("openai")
      expect(names).toContain("claude")
      expect(names).toContain("groq")
    })
  })
})


