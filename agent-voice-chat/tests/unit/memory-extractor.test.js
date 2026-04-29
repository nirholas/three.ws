// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { isExtractable } from "../../lib/memory-extractor"

describe("memory-extractor", () => {
  describe("isExtractable", () => {
    it("returns false for null/empty input", () => {
      expect(isExtractable(null)).toBe(false)
      expect(isExtractable("")).toBe(false)
      expect(isExtractable(undefined)).toBe(false)
    })

    it("returns false for very short messages", () => {
      expect(isExtractable("hi")).toBe(false)
      expect(isExtractable("hello")).toBe(false)
      expect(isExtractable("yo what up")).toBe(false)
    })

    it("returns false for common greetings", () => {
      expect(isExtractable("hey everyone in the chat")).toBe(false)
      expect(isExtractable("hello there friends")).toBe(false)
      expect(isExtractable("lol that was great work")).toBe(false)
      expect(isExtractable("ok sounds good to me")).toBe(false)
    })

    it("returns true for substantive messages", () => {
      expect(isExtractable("I'm building a DEX on Solana using Anchor framework")).toBe(true)
      expect(isExtractable("We should migrate our auth system to OAuth2")).toBe(true)
      expect(isExtractable("The tokenomics model uses a 1 billion token supply")).toBe(true)
    })

    it("strips chat format prefix before checking", () => {
      // "[CHAT - user]: hi" -> "hi" -> too short
      expect(isExtractable("[CHAT - user]: hi")).toBe(false)
      // "[CHAT - user]: I'm building a DEX on Solana" -> substantive
      expect(isExtractable("[CHAT - user]: I'm building a DEX on Solana using Anchor")).toBe(true)
    })

    it("returns false for single-word filler", () => {
      expect(isExtractable("sure that sounds nice")).toBe(false)
      expect(isExtractable("thanks for the help")).toBe(false)
    })
  })
})
