// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const axios = require("axios")
const { logger } = require("../src/server/logger")

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const EXTRACTION_MODEL = process.env.MEMORY_EXTRACTION_MODEL || "gpt-4o-mini"

const EXTRACTION_PROMPT = `You extract factual information worth remembering from conversation exchanges.

Focus on:
- Personal details about the speaker (name, role, location, expertise)
- Projects they mention (what they're building, technologies used)
- Preferences and opinions (likes, dislikes, communication style)
- Plans and goals (what they want to achieve)
- Relationships (who they know, who they work with)

Rules:
- Only extract concrete, specific facts — not vague observations
- Each fact should be a single, self-contained statement
- Include the speaker's identity in each fact for context
- Return a JSON array of strings. Return an empty array [] if nothing memorable.
- Do NOT extract generic conversational filler or greetings

Examples of GOOD facts:
- "User @cryptodude is building a DEX on Solana"
- "@alice has 5 years of experience with Rust"
- "@bob prefers morning Spaces over evening ones"

Examples of BAD facts (do not extract these):
- "The user said hello"
- "They had a conversation about crypto"
- "The user seems nice"`

/**
 * Extract memorable facts from a conversation exchange.
 * @param {object} exchange
 * @param {string} exchange.speaker - Who said it (username/identifier)
 * @param {string} exchange.text - What the user said
 * @param {string} exchange.response - What the agent responded
 * @returns {Promise<string[]>} Array of extracted facts
 */
async function extractFacts(exchange) {
  if (!OPENAI_API_KEY) {
    logger.warn("No OPENAI_API_KEY set, skipping memory extraction")
    return []
  }

  const userContent = `Speaker ${exchange.speaker} said: "${exchange.text}"\nAgent responded: "${exchange.response}"`

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: EXTRACTION_MODEL,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: userContent }
        ],
        max_tokens: 500,
        temperature: 0.1,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )

    const content = response.data.choices?.[0]?.message?.content
    if (!content) return []

    const parsed = JSON.parse(content)
    // Handle both { facts: [...] } and plain [...]
    const facts = Array.isArray(parsed) ? parsed : (parsed.facts || parsed.results || [])
    return facts.filter(f => typeof f === "string" && f.length > 0)
  } catch (err) {
    logger.error({ err: err.message, model: EXTRACTION_MODEL }, "Memory extraction failed")
    return []
  }
}

/**
 * Determine if an exchange is worth extracting memories from.
 * Filters out very short or generic messages.
 * @param {string} text - The user's message
 * @returns {boolean}
 */
function isExtractable(text) {
  if (!text) return false
  const clean = text.replace(/\[CHAT - [^\]]+\]:\s*/, "").trim()
  // Skip very short messages or common greetings
  if (clean.length < 15) return false
  const skipPatterns = [
    /^(hi|hey|hello|yo|sup|what'?s up|lol|lmao|ok|okay|sure|yes|no|nah|bye|later|thanks|thx|ty)\b/i
  ]
  return !skipPatterns.some(p => p.test(clean))
}

/**
 * Batch extract facts from an entire conversation.
 * More efficient than per-message extraction — reduces LLM calls.
 * @param {Array<{speaker: string, text: string}>} messages - Conversation messages
 * @returns {Promise<string[]>} Array of extracted facts
 */
async function extractFactsBatch(messages) {
  if (!OPENAI_API_KEY) {
    logger.warn("No OPENAI_API_KEY set, skipping batch memory extraction")
    return []
  }

  // Filter to only extractable messages
  const extractable = messages.filter(m => isExtractable(m.text))
  if (extractable.length === 0) return []

  const combined = extractable.map(m => `${m.speaker}: ${m.text}`).join("\n")

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: EXTRACTION_MODEL,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Extract facts from this conversation:\n\n${combined}` }
        ],
        max_tokens: 1000,
        temperature: 0.1,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )

    const content = response.data.choices?.[0]?.message?.content
    if (!content) return []

    const parsed = JSON.parse(content)
    const facts = Array.isArray(parsed) ? parsed : (parsed.facts || parsed.results || [])
    return facts.filter(f => typeof f === "string" && f.length > 0)
  } catch (err) {
    logger.error({ err: err.message, model: EXTRACTION_MODEL }, "Batch memory extraction failed")
    return []
  }
}

module.exports = { extractFacts, extractFactsBatch, isExtractable }


