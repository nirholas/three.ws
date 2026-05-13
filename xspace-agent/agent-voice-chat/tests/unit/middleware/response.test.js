// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { responseHelpers } from "../../../src/server/middleware/response"

describe("responseHelpers middleware", () => {
  function createMocks() {
    return {
      req: {},
      res: {
        json: vi.fn(),
        status: vi.fn().mockReturnThis()
      },
      next: vi.fn()
    }
  }

  it("should add success() and fail() to res", () => {
    const { req, res, next } = createMocks()
    responseHelpers(req, res, next)
    expect(typeof res.success).toBe("function")
    expect(typeof res.fail).toBe("function")
    expect(next).toHaveBeenCalled()
  })

  it("res.success() should wrap data with meta timestamp", () => {
    const { req, res, next } = createMocks()
    responseHelpers(req, res, next)

    res.success({ items: [1, 2, 3] })

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { items: [1, 2, 3] },
        meta: expect.objectContaining({
          timestamp: expect.any(String)
        })
      })
    )
  })

  it("res.success() should merge custom meta", () => {
    const { req, res, next } = createMocks()
    responseHelpers(req, res, next)

    res.success({ ok: true }, { page: 1 })

    const body = res.json.mock.calls[0][0]
    expect(body.meta.page).toBe(1)
    expect(body.meta.timestamp).toBeDefined()
  })

  it("res.fail() should return error with status code", () => {
    const { req, res, next } = createMocks()
    responseHelpers(req, res, next)

    res.fail("NOT_FOUND", "Resource not found", 404)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "NOT_FOUND", message: "Resource not found" }
    })
  })

  it("res.fail() should default to status 400", () => {
    const { req, res, next } = createMocks()
    responseHelpers(req, res, next)

    res.fail("BAD_REQUEST", "Invalid input")

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("res.fail() should include details when provided", () => {
    const { req, res, next } = createMocks()
    responseHelpers(req, res, next)

    res.fail("VALIDATION_ERROR", "Invalid", 400, [{ field: "name" }])

    const body = res.json.mock.calls[0][0]
    expect(body.error.details).toEqual([{ field: "name" }])
  })
})


