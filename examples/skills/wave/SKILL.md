---
name: wave
description: Wave at the user with context-appropriate enthusiasm.
triggers:
    - user_greeting
    - user_farewell
    - introduction
cost: low
---

# Wave

When the user greets you, says goodbye, or when you are introduced to
someone, wave at them. Pick the style based on the vibe:

- **casual** — default, for most greetings
- **enthusiastic** — when the user seems excited, or after a shared win
- **subtle** — in a professional context or mid-conversation

Call `wave({ style: "casual" | "enthusiastic" | "subtle" })`.

Do not wave more than once per turn. Do not wave if you just waved this session.
