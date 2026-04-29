// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Observability – Public Exports
// =============================================================================

export {
  createLogger,
  childLogger,
  getAppLogger,
  setAppLogger,
  type LoggerConfig,
} from './logger'

export {
  MetricsCollector,
  getMetrics,
  startProcessMetrics,
  stopProcessMetrics,
} from './metrics'

export {
  SocketLogTransport,
  createStreamingLogger,
} from './log-transport'


