#!/usr/bin/env python3
"""Patch ai-agents-x-space to use OpenAI Realtime GA API (was Beta)."""
import re

# 1. Patch index.js
p = "/home/agent/ai-agents-x-space/index.js"
s = open(p).read()
s = s.replace("gpt-4o-realtime-preview-2024-12-17", "gpt-realtime")
s = s.replace(
    "https://api.openai.com/v1/realtime/sessions",
    "https://api.openai.com/v1/realtime/client_secrets",
)
old_body = """      {
        model: MODEL,
        modalities: ["audio", "text"],
        voice: voices[agentId],
        instructions: prompts[agentId]
      },"""
new_body = """      {
        session: {
          type: "realtime",
          model: MODEL,
          voice: voices[agentId],
          instructions: prompts[agentId]
        }
      },"""
if old_body in s:
    s = s.replace(old_body, new_body)
    print("[ok] index.js: body shape updated")
elif "session: {" in s:
    print("[skip] index.js: already patched")
else:
    print("[WARN] index.js: body pattern not found; manual edit may be needed")
open(p, "w").write(s)

# 2. Patch agent1.html
p = "/home/agent/ai-agents-x-space/public/agent1.html"
s = open(p).read()
s = s.replace("gpt-4o-realtime-preview-2024-12-17", "gpt-realtime")
s = s.replace("data.client_secret.value", "data.value")
open(p, "w").write(s)
print("[ok] agent1.html: model + ephemeral key path updated")

# 3. Same for agent2.html (just in case)
p = "/home/agent/ai-agents-x-space/public/agent2.html"
try:
    s = open(p).read()
    s = s.replace("gpt-4o-realtime-preview-2024-12-17", "gpt-realtime")
    s = s.replace("data.client_secret.value", "data.value")
    open(p, "w").write(s)
    print("[ok] agent2.html patched")
except FileNotFoundError:
    pass
