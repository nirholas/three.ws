// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import type { Request, Response, NextFunction } from "express"
import { serverLogger } from "../logger"

// ===== HTML Sanitization =====

const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#96;",
}

const HTML_TAG_RE = /[&<>"'`/]/g

/** Escape HTML entities to prevent XSS */
export function escapeHtml(str: string): string {
  return str.replace(HTML_TAG_RE, (char) => HTML_ENTITY_MAP[char] || char)
}

/** Strip all HTML tags from a string */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "")
}

/** Sanitize a chat message: strip tags, then escape remaining entities */
export function sanitizeMessage(text: string): string {
  if (typeof text !== "string") return ""
  return escapeHtml(stripHtml(text)).trim()
}

// ===== Request Body Size Limiting =====

/** Express middleware options for body size limits */
export const jsonBodyLimit = { limit: "1mb" }
export const urlencodedBodyLimit = { limit: "1mb", extended: true }

// ===== Production Error Handler =====

export function productionErrorHandler(
  err: Error & { status?: number; statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.status || err.statusCode || 500
  const isProduction = process.env.NODE_ENV === "production"

  if (statusCode >= 500) {
    serverLogger.error({ err: err.message, stack: isProduction ? undefined : err.stack }, "internal error")
  }

  if (isProduction) {
    res.status(statusCode).json({
      error: {
        code: statusCode === 429 ? "RATE_LIMITED" : "INTERNAL_ERROR",
        message: statusCode >= 500 ? "An unexpected error occurred" : err.message,
      },
    })
  } else {
    res.status(statusCode).json({
      error: {
        code: "INTERNAL_ERROR",
        message: err.message,
        stack: err.stack,
      },
    })
  }
}


