// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { ConversationHistory } from "../../providers/conversation-history"

describe("ConversationHistory", () => {
  let history
  const ROOM = "default"

  beforeEach(() => {
    history = new ConversationHistory()
  })

  it("should start with empty history for an agent", () => {
    expect(history.get(ROOM, "bob")).toEqual([])
  })

  it("should add messages to agent history", () => {
    history.add(ROOM, "bob", "user", "Hello")
    history.add(ROOM, "bob", "assistant", "Hi there!")

    expect(history.get(ROOM, "bob")).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" }
    ])
  })

  it("should keep histories separate per agent", () => {
    history.add(ROOM, "bob", "user", "Hello Bob")
    history.add(ROOM, "alice", "user", "Hello Alice")

    expect(history.get(ROOM, "bob")).toHaveLength(1)
    expect(history.get(ROOM, "alice")).toHaveLength(1)
    expect(history.get(ROOM, "bob")[0].content).toBe("Hello Bob")
    expect(history.get(ROOM, "alice")[0].content).toBe("Hello Alice")
  })

  it("should enforce maxHistory limit (default 20)", () => {
    for (let i = 0; i < 30; i++) {
      history.add(ROOM, "bob", "user", `msg ${i}`)
    }

    const messages = history.get(ROOM, "bob")
    expect(messages).toHaveLength(20)
    expect(messages[0].content).toBe("msg 10")
    expect(messages[19].content).toBe("msg 29")
  })

  it("should respect custom maxHistory", () => {
    history = new ConversationHistory(5)

    for (let i = 0; i < 10; i++) {
      history.add(ROOM, "bob", "user", `msg ${i}`)
    }

    const messages = history.get(ROOM, "bob")
    expect(messages).toHaveLength(5)
    expect(messages[0].content).toBe("msg 5")
  })

  it("should clear history for a specific agent", () => {
    history.add(ROOM, "bob", "user", "Hello")
    history.add(ROOM, "alice", "user", "Hi")

    history.clear("bob", ROOM)

    expect(history.get(ROOM, "bob")).toEqual([])
    expect(history.get(ROOM, "alice")).toHaveLength(1)
  })

  it("should isolate history across rooms", () => {
    history.add("room1", "bob", "user", "In room 1")
    history.add("room2", "bob", "user", "In room 2")

    expect(history.get("room1", "bob")).toHaveLength(1)
    expect(history.get("room2", "bob")).toHaveLength(1)
    expect(history.get("room1", "bob")[0].content).toBe("In room 1")
    expect(history.get("room2", "bob")[0].content).toBe("In room 2")
  })

  it("should clear all history for a room", () => {
    history.add("room1", "bob", "user", "Hello")
    history.add("room1", "alice", "user", "Hi")
    history.add("room2", "bob", "user", "Other room")

    history.clearRoom("room1")

    expect(history.get("room1", "bob")).toEqual([])
    expect(history.get("room1", "alice")).toEqual([])
    expect(history.get("room2", "bob")).toHaveLength(1)
  })
})
