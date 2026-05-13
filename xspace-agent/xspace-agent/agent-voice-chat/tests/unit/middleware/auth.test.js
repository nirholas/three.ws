// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

describe("apiKeyAuth middleware", () => {
  let req, res, next

  beforeEach(() => {
    req = { headers: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }
    next = vi.fn()
    // Reset module cache to pick up different env values
    vi.resetModules()
  })

  it("should call next() when no API_KEY is configured", async () => {
    vi.stubEnv("API_KEY", "")
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    apiKeyAuth(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it("should return 401 when API_KEY is set but no auth header provided", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    apiKeyAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it("should return 401 when auth header has wrong format", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Basic wrong-format"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    apiKeyAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it("should return 401 when API key is incorrect", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Bearer wrong-key"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    apiKeyAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "UNAUTHORIZED" })
      })
    )
  })

  it("should call next() when API key is correct", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Bearer secret-key"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    apiKeyAuth(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it("handles very long tokens without crashing", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Bearer " + "x".repeat(100_000)
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    expect(() => apiKeyAuth(req, res, next)).not.toThrow()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it("handles tokens with special characters", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Bearer <script>alert(1)</script>"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    expect(() => apiKeyAuth(req, res, next)).not.toThrow()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it("handles tokens with null-byte injection without crashing", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Bearer secret-key\0injected"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    expect(() => apiKeyAuth(req, res, next)).not.toThrow()
    // Null-byte variant must NOT be accepted as the real key
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it("returns 401 for wrong token regardless of token length (timing safety)", async () => {
    // Verifies correct rejection for both short and very long wrong tokens.
    // NOTE: the current implementation uses === which is not timing-safe;
    // a production-hardened version should use crypto.timingSafeEqual.
    vi.stubEnv("API_KEY", "secret-key")
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")

    req.headers.authorization = "Bearer x"
    apiKeyAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)

    // Reset mocks and try with a long wrong token
    res.status.mockClear()
    res.json.mockClear()
    next.mockClear()
    req.headers.authorization = "Bearer " + "wrong".repeat(200)
    apiKeyAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it("handles missing Authorization header gracefully (returns 401, does not crash)", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers = {} // no authorization header at all
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    expect(() => apiKeyAuth(req, res, next)).not.toThrow()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it("handles malformed Bearer token format (no space after Bearer)", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = "Bearersecret-key"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    apiKeyAuth(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it("handles Authorization header with leading/trailing whitespace in scheme", async () => {
    vi.stubEnv("API_KEY", "secret-key")
    req.headers.authorization = " Bearer secret-key"
    const { apiKeyAuth } = await import("../../../src/server/middleware/auth.js")
    // The middleware checks startsWith("Bearer "); a leading space fails that check
    expect(() => apiKeyAuth(req, res, next)).not.toThrow()
    expect(res.status).toHaveBeenCalledWith(401)
  })
})


