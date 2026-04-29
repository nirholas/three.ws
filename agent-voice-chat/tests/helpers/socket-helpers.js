// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { io as ioClient } from "socket.io-client"

/**
 * Create a connected Socket.IO client for testing.
 * Buffers events received during connection so they aren't missed by waitForEvent.
 *
 * @param {number} port - Server port
 * @param {string} namespace - Socket.IO namespace (default: "/space")
 * @param {object} opts - Connection options
 * @returns {Promise<import("socket.io-client").Socket>}
 */
export function createConnectedClient(port, namespace = "/space", opts = {}) {
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://localhost:${port}${namespace}`, {
      transports: ["websocket"],
      forceNew: true,
      autoConnect: true,
      auth: opts.auth || {},
      ...opts
    })

    // Buffer events that arrive before waitForEvent is called
    const buffered = new Map()
    let buffering = true

    // Intercept events during connection to buffer them
    const eventsToBuffer = ["stateUpdate", "messageHistory"]
    const handlers = {}
    for (const event of eventsToBuffer) {
      handlers[event] = (data) => {
        if (!buffering) return
        if (!buffered.has(event)) {
          buffered.set(event, [])
        }
        buffered.get(event).push(data)
      }
      client.on(event, handlers[event])
    }

    function stopBuffering() {
      buffering = false
      for (const event of eventsToBuffer) {
        client.off(event, handlers[event])
      }
    }

    // Expose buffered events for waitForEvent
    client._buffered = buffered

    const timeout = setTimeout(() => {
      client.disconnect()
      reject(new Error("Socket connection timeout"))
    }, 5000)

    client.on("connect", () => {
      clearTimeout(timeout)
      // Give a brief window for initial events to arrive, then stop buffering
      setTimeout(() => {
        stopBuffering()
        resolve(client)
      }, 50)
    })

    client.on("connect_error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

/**
 * Wait for a specific event on a socket client.
 * Checks buffered events first (from events that arrived during connection).
 *
 * @param {import("socket.io-client").Socket} client
 * @param {string} event
 * @param {number} timeout
 * @returns {Promise<any>}
 */
export function waitForEvent(client, event, timeout = 5000) {
  // Check if the event was already buffered
  const buffered = client._buffered
  if (buffered && buffered.has(event) && buffered.get(event).length > 0) {
    return Promise.resolve(buffered.get(event).shift())
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`))
    }, timeout)

    client.once(event, (data) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

/**
 * Collect multiple occurrences of an event.
 * @param {import("socket.io-client").Socket} client
 * @param {string} event
 * @param {number} count
 * @param {number} timeout
 * @returns {Promise<any[]>}
 */
export function collectEvents(client, event, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const results = []
    const timer = setTimeout(() => {
      client.off(event, handler)
      reject(new Error(`Timeout: collected ${results.length}/${count} "${event}" events`))
    }, timeout)

    function handler(data) {
      results.push(data)
      if (results.length >= count) {
        clearTimeout(timer)
        client.off(event, handler)
        resolve(results)
      }
    }

    client.on(event, handler)
  })
}

/**
 * Disconnect a client and wait for disconnection.
 */
export function disconnectClient(client) {
  return new Promise((resolve) => {
    if (!client.connected) return resolve()
    client.on("disconnect", () => resolve())
    client.disconnect()
  })
}
