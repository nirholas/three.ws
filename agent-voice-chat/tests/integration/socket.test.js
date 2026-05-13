// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { createTestServer } from "../helpers/create-test-server.js"
import { createConnectedClient, waitForEvent, disconnectClient } from "../helpers/socket-helpers.js"

describe("Socket.IO events", () => {
  let ctx, port

  beforeEach(async () => {
    ctx = await createTestServer()
    port = ctx.port
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  it("client connects and receives stateUpdate", async () => {
    const client = await createConnectedClient(port)
    try {
      const state = await waitForEvent(client, "stateUpdate")
      expect(state).toHaveProperty("agents")
      expect(state).toHaveProperty("currentTurn")
      expect(state).toHaveProperty("turnQueue")
    } finally {
      await disconnectClient(client)
    }
  })

  it("client receives messageHistory on connect", async () => {
    const client = await createConnectedClient(port)
    try {
      const history = await waitForEvent(client, "messageHistory")
      expect(Array.isArray(history)).toBe(true)
    } finally {
      await disconnectClient(client)
    }
  })

  it("agentConnect updates agent status", async () => {
    const client = await createConnectedClient(port)
    try {
      // Wait for initial state
      await waitForEvent(client, "stateUpdate")

      // Connect as agent "bob"
      const statePromise = waitForEvent(client, "stateUpdate")
      client.emit("agentConnect", { agentId: "bob" })
      const state = await statePromise

      expect(state.agents.bob.connected).toBe(true)
      expect(state.agents.bob.status).toBe("idle")
    } finally {
      await disconnectClient(client)
    }
  })

  it("agentDisconnect updates agent status", async () => {
    const client = await createConnectedClient(port)
    try {
      await waitForEvent(client, "stateUpdate")

      // Connect then disconnect agent
      let statePromise = waitForEvent(client, "stateUpdate")
      client.emit("agentConnect", { agentId: "bob" })
      await statePromise

      statePromise = waitForEvent(client, "stateUpdate")
      client.emit("agentDisconnect", { agentId: "bob" })
      const state = await statePromise

      expect(state.agents.bob.connected).toBe(false)
      expect(state.agents.bob.status).toBe("offline")
    } finally {
      await disconnectClient(client)
    }
  })

  it("requestTurn grants turn when no one has it", async () => {
    const client = await createConnectedClient(port)
    try {
      await waitForEvent(client, "stateUpdate")

      const turnPromise = waitForEvent(client, "turnResponse")
      client.emit("requestTurn", { agentId: "bob" })
      const response = await turnPromise

      expect(response.granted).toBe(true)
      expect(response.currentTurn).toBe("bob")
    } finally {
      await disconnectClient(client)
    }
  })

  it("requestTurn queues when someone has turn", async () => {
    const client = await createConnectedClient(port)
    try {
      await waitForEvent(client, "stateUpdate")

      // Bob gets turn
      let turnPromise = waitForEvent(client, "turnResponse")
      client.emit("requestTurn", { agentId: "bob" })
      await turnPromise

      // Alice tries to get turn -> queued
      turnPromise = waitForEvent(client, "turnResponse")
      client.emit("requestTurn", { agentId: "alice" })
      const response = await turnPromise

      expect(response.granted).toBe(false)
    } finally {
      await disconnectClient(client)
    }
  })

  it("releaseTurn grants to next in queue", async () => {
    const client = await createConnectedClient(port)
    try {
      await waitForEvent(client, "stateUpdate")

      // Bob gets turn
      let turnPromise = waitForEvent(client, "turnResponse")
      client.emit("requestTurn", { agentId: "bob" })
      await turnPromise

      // Alice queues
      turnPromise = waitForEvent(client, "turnResponse")
      client.emit("requestTurn", { agentId: "alice" })
      await turnPromise

      // Bob releases -> Alice should get turnGranted
      const grantedPromise = waitForEvent(client, "turnGranted")
      client.emit("releaseTurn", { agentId: "bob" })
      const granted = await grantedPromise

      expect(granted.agentId).toBe("alice")
    } finally {
      await disconnectClient(client)
    }
  })

  it("userMessage triggers LLM response and broadcasts textComplete", async () => {
    const client = await createConnectedClient(port)
    try {
      await waitForEvent(client, "stateUpdate")

      // Send a user message
      const completePromise = waitForEvent(client, "textComplete")
      client.emit("userMessage", { text: "Hello agent!", from: "TestUser" })

      // Should get user's textComplete first
      const userMsg = await completePromise

      expect(userMsg.text).toBe("Hello agent!")
      expect(userMsg.isUser).toBe(true)

      // Then the agent response textComplete
      const agentMsg = await waitForEvent(client, "textComplete")
      expect(agentMsg.agentId).toBe("bob")
      expect(agentMsg.text).toContain("Hello")
    } finally {
      await disconnectClient(client)
    }
  })

  it("textDelta events are broadcast during LLM streaming", async () => {
    const client = await createConnectedClient(port)
    try {
      await waitForEvent(client, "stateUpdate")

      const deltaPromise = waitForEvent(client, "textDelta")
      client.emit("userMessage", { text: "Hi!", from: "Tester" })

      // Wait for first textComplete (user message)
      await waitForEvent(client, "textComplete")

      // Should receive textDelta events from the streaming response
      const delta = await deltaPromise
      expect(delta).toHaveProperty("agentId")
      expect(delta).toHaveProperty("delta")
      expect(delta).toHaveProperty("name")
    } finally {
      await disconnectClient(client)
    }
  })

  it("disconnect cleans up agent state", async () => {
    const client1 = await createConnectedClient(port)
    const client2 = await createConnectedClient(port)

    try {
      // Client1: connect as bob
      await waitForEvent(client1, "stateUpdate")
      await waitForEvent(client2, "stateUpdate")

      let statePromise = waitForEvent(client2, "stateUpdate")
      client1.emit("agentConnect", { agentId: "bob" })
      let state = await statePromise
      expect(state.agents.bob.connected).toBe(true)

      // Client1 disconnects -> bob should go offline
      statePromise = waitForEvent(client2, "stateUpdate")
      await disconnectClient(client1)
      state = await statePromise

      expect(state.agents.bob.connected).toBe(false)
      expect(state.agents.bob.status).toBe("offline")
    } finally {
      await disconnectClient(client2)
    }
  })
})
