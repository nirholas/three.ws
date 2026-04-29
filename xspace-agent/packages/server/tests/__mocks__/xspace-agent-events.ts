// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// Stub mock for xspace-agent/dist/events sub-path
export class EventBuffer {
  push() {}
  flush() { return [] }
}
export class ConnectionManager {
  add() {}
  remove() {}
}
export type EventSubscriber = any
export type EventFilter = any
export type EventEnvelope = any


