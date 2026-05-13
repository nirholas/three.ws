// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import 'dotenv/config'

export { createServer } from './create-server'
export type { ServerOptions, XSpaceServer } from './create-server'

// Re-export schemas for client-side reuse
export * from './schemas'

// Re-export error response types and helpers
export { buildErrorResponse } from './middleware/error-handler'
export type { ApiErrorResponse, ApiErrorDetail } from './middleware/error-handler'
export { validate } from './middleware/validation'

// When run directly (node dist/index.js), auto-start the server
const isDirectRun =
  require.main === module ||
  process.argv[1]?.endsWith('/server/dist/index.js') ||
  process.argv[1]?.endsWith('/server/src/index.ts')

if (isDirectRun) {
  const { createServer } = require('./create-server')
  const server = createServer()
  server.start().then(() => {
    process.on('SIGTERM', () => server.stop().then(() => process.exit(0)))
    process.on('SIGINT', () => server.stop().then(() => process.exit(0)))
  })
}


