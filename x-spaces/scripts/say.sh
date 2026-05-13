#!/usr/bin/env bash
# Synthesize text via OpenAI TTS and play through the agent_speakers cable
# so it reaches the X tab as @swarminged's microphone input.
set -e
TEXT="${*:-Hello from the test bench}"
TTS_VOICE="verse"
KEY="$(grep -m1 OPENAI_API_KEY /home/agent/ai-agents-x-space/.env | cut -d= -f2)"
JSON=$(python3 -c "import json,sys; print(json.dumps({\"model\":\"gpt-4o-mini-tts\",\"voice\":\"$TTS_VOICE\",\"input\":sys.argv[1],\"response_format\":\"wav\"}))" "$TEXT")
echo "[say] synthesizing: $TEXT"
curl -s -X POST https://api.openai.com/v1/audio/speech \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$JSON" --output /tmp/say.wav
SIZE=$(stat -c%s /tmp/say.wav 2>/dev/null || echo 0)
echo "[say] wav bytes: $SIZE"
if [ "$SIZE" -lt 1000 ]; then
  echo "[say] TTS failed; response was:"
  cat /tmp/say.wav
  exit 1
fi
echo "[say] playing to agent_speakers"
PULSE_SINK=agent_speakers paplay /tmp/say.wav
echo "[say] done"
