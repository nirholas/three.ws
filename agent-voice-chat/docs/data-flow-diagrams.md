# Data Flow Diagrams

## 1. X Space Agent — Full Audio Loop (Socket Provider)

```
┌─────────────────────────────────────────────────────────────────┐
│                        X SPACE (TWITTER)                         │
│                                                                  │
│   Human Speaker → WebRTC Audio → Bot's RTCPeerConnection        │
│                                                                  │
│   Bot's controlled MediaStream → WebRTC → Space (others hear)   │
└───────────────────────────┬────────────────▲─────────────────────┘
                            │                │
                    ┌───────▼───────┐  ┌─────┴──────┐
                    │ AUDIO CAPTURE │  │ AUDIO INJECT│
                    │ (audio-bridge)│  │(audio-bridge)│
                    │               │  │             │
                    │ RTCPeer hook  │  │ __inject... │
                    │ ScriptProc    │  │ AudioBuffer │
                    │ 16kHz PCM     │  │ 48kHz PCM   │
                    └───────┬───────┘  └─────▲──────┘
                            │                │
                    ┌───────▼───────┐  ┌─────┴──────┐
                    │ VAD + BUFFER  │  │ mp3ToPcm   │
                    │ (x-spaces/    │  │ Float32    │
                    │  index.js)    │  │ (ffmpeg)   │
                    │               │  │            │
                    │ 1.5s silence  │  │ Chunks to  │
                    │ → pcmToWav()  │  │ page.eval  │
                    └───────┬───────┘  └─────▲──────┘
                            │                │
                    ┌───────▼───────┐  ┌─────┴──────┐
                    │     STT       │  │     TTS     │
                    │  (Groq/OpenAI │  │ (ElevenLabs │
                    │   Whisper)    │  │  /OpenAI)   │
                    │               │  │             │
                    │  → text       │  │ text → MP3  │
                    └───────┬───────┘  └─────▲──────┘
                            │                │
                    ┌───────▼────────────────┴──────┐
                    │         LLM PROVIDER          │
                    │   (Claude/Groq/OpenAI Chat)   │
                    │                               │
                    │  system prompt + history       │
                    │  + user text → response text   │
                    └───────────────────────────────┘
```

## 2. X Space Agent — WebRTC Provider (OpenAI Realtime)

```
┌──────────────┐          ┌──────────────────┐         ┌──────────┐
│  X SPACE     │◄── RTC ──│  AGENT BROWSER   │── RTC ──►│ OPENAI   │
│  (Twitter)   │          │  (agent1.html)   │         │ REALTIME │
│              │          │                  │         │ API      │
│  Other       │          │ RTCPeer hook     │         │          │
│  speakers    │          │ captures audio   │         │ Processes│
│  audio → bot │          │ from X Space     │         │ audio    │
│              │          │                  │         │ directly │
│  Bot's       │          │ OpenAI audio     │         │          │
│  audio ←     │          │ → controlled     │         │ Returns  │
│  heard by    │          │   stream → X     │         │ audio +  │
│  all         │          │                  │         │ text     │
└──────────────┘          │ Socket.IO sends  │         └──────────┘
                          │ text events to   │
                          │ server for       │
                          │ dashboard display│
                          └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │  SERVER           │
                          │  (server.js)      │
                          │                   │
                          │  Only handles:    │
                          │  - Session tokens │
                          │  - Text display   │
                          │  - Turn mgmt      │
                          │  - Chat routing   │
                          └───────────────────┘
```

## 3. Admin Panel Control Flow

```
┌──────────────┐     Socket.IO /space     ┌──────────────┐
│  ADMIN PAGE  │◄────────────────────────►│   SERVER     │
│  admin.html  │                          │  server.js   │
│              │                          │              │
│ START BOT ──────► xspace:start ────────►│──► xSpaces.start()
│              │                          │    │ browser.launch()
│              │◄──── xSpacesStatus ◄─────│◄───┤ auth.login()
│ Status: ●    │     "logged-in"          │    └──────────────
│              │                          │
│ JOIN SPACE ─────► xspace:join ─────────►│──► xSpaces.joinSpace(url)
│ [url input]  │    {spaceUrl}            │    │ spaceUI.joinSpace()
│              │                          │    │ spaceUI.requestSpeaker()
│              │◄──── xSpacesStatus ◄─────│◄───┤ spaceUI.waitForSpeaker()
│ Status: ●●●  │     "speaking-in-space"  │    │ spaceUI.unmute()
│              │                          │    └──────────────
│              │                          │
│ [2FA shown]  │◄── xSpaces2faRequired ◄──│    (login needs 2FA)
│ [code input] │                          │
│ SUBMIT ──────────► xspace:2fa ─────────►│──► emitter.emit("2fa-code")
│              │    {code}                │
│              │                          │
│ LEAVE SPACE ─────► xspace:leave ───────►│──► xSpaces.leaveSpace()
│ STOP BOT ────────► xspace:stop ────────►│──► xSpaces.stop()
│              │                          │
│ Log: [...]   │◄── xSpacesStatus ◄──────│    (all state changes)
│              │◄── xSpacesError ◄───────│    (all errors)
└──────────────┘                          └──────────────┘
```

## 4. Turn Management System

```
Agent 0 requests turn          Agent 1 requests turn
        │                              │
        ▼                              ▼
  ┌─ currentTurn === null? ──┐   ┌─ currentTurn !== null ─┐
  │  YES → grant immediately │   │  → add to turnQueue    │
  │  currentTurn = 0         │   │  turnQueue = [1]       │
  │  isProcessing = true     │   └─────────────────────────┘
  └──────────┬───────────────┘
             │
      Agent 0 finishes
      releaseTurn(0)
             │
             ▼
  ┌─ turnQueue has items? ──┐
  │  YES → shift queue      │
  │  Wait 500ms             │
  │  currentTurn = 1        │
  │  emit turnGranted       │
  └─────────────────────────┘
```

## 5. Talky Show Event Loop (NOT for standalone)

```
                    ┌──────────────┐
                    │  EVENT       │
                    │  SOURCES     │
                    │              │
                    │ • 10s idle   │
                    │ • User chat  │
                    │ • PF chat    │
                    │ • Twitter    │
                    │ • Trade      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ EVENT QUEUE  │  (max 10, chat prioritized)
                    │              │
                    │ processTalky │
                    │ Queue()      │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼──────┐          ┌──────▼──────┐
       │ CHAT EVENT  │          │ OTHER EVENT │
       │             │          │             │
       │ Random cast │          │ "Director"  │
       │ member      │          │ AI picks    │
       │ responds    │          │ speaker +   │
       │ to user     │          │ target      │
       └──────┬──────┘          └──────┬──────┘
              │                         │
              └────────────┬────────────┘
                           │
                    ┌──────▼───────┐
                    │ GENERATE     │
                    │ RESPONSE     │
                    │ (talkyAI)    │
                    │ max 45 tokens│
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ TTS          │
                    │ (ElevenLabs) │
                    │ per-character│
                    │ voice        │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ BROADCAST    │
                    │ new_response │
                    │ + audio      │
                    │              │
                    │ Start 10s    │
                    │ countdown    │
                    └──────────────┘
```


