# Environment Variables — Complete Reference

## Core Server
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `PORT` | `3000` | server.js | HTTP server port |

## Project Info (shared branding)
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `PROJECT_NAME` | `"AI Agents"` | Both systems | Project display name |
| `CONTRACT` / `CONTRACT_ADDRESS` | `""` | Both | Solana token contract address |
| `TOKEN_CHAIN` | `"Solana"` | Both | Blockchain name |
| `WEBSITE` / `WEBSITE_LINK` | `""` | Both | Project website URL |
| `TEAM` | `""` | Both | Team X/Twitter link |
| `BUY_LINK` | `""` | Both | Token purchase base URL |
| `X_COMMUNITY_LINK` / `X_LINK` | `"https://x.com"` | Both | X community link |
| `GITHUB_LINK` | `"https://github.com"` | Both | GitHub repo link |
| `AVATAR_URL_1` | `""` | X Space | Agent 0 avatar URL |
| `AVATAR_URL_2` | `""` | X Space | Agent 1 avatar URL |

## Feature Flags
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `INPUT_CHAT` | `true` | X Space | Enable web chat input |
| `LIVE_CHAT` | `false` | Both | Enable pump.fun live chat |
| `LIVE_TRADE` | `false` | Talky | Enable live trade ticker |
| `LIVE_MC` | `false` | Talky | Enable market cap display |
| `TWEET_CHECK` | `false` | Talky | Enable Twitter reply monitoring |
| `VOICE_STATUS` | `false` | Talky | Enable ElevenLabs TTS for Talky |
| `SPAM_SECONDS` | `30` | Talky | Chat message cooldown (seconds) |

## AI Provider (X Space Agents)
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `AI_PROVIDER` | `"openai"` | providers/index.js | LLM provider selection |
| `OPENAI_API_KEY` | — | openai-realtime, openai-chat, stt, tts | OpenAI API key |
| `OPENAI_REALTIME_MODEL` | `"gpt-4o-realtime-preview-2024-12-17"` | openai-realtime.js | Realtime API model |
| `OPENAI_MODEL` | `"gpt-4o-mini"` | openai-chat.js | Chat completions model |
| `GROQ_API_KEY` | — | groq.js, stt.js | Groq API key |
| `GROQ_MODEL` | `"llama-3.3-70b-versatile"` | groq.js | Groq model name |
| `ANTHROPIC_API_KEY` | — | claude.js | Anthropic API key |
| `CLAUDE_MODEL` | `"claude-sonnet-4-20250514"` | claude.js | Claude model name |

## Speech Services
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `STT_PROVIDER` | `"groq"` | stt.js | STT backend (groq or openai) |
| `TTS_PROVIDER` | auto-detected | tts.js | TTS backend (elevenlabs, openai, browser) |
| `ELEVENLABS_API_KEY` | — | tts.js | ElevenLabs API key |
| `ELEVENLABS_VOICE_0` | `"VR6AewLTigWG4xSOukaG"` | tts.js | Agent 0 ElevenLabs voice ID |
| `ELEVENLABS_VOICE_1` | `"TxGEqnHWrfWFTfGW9XjX"` | tts.js | Agent 1 ElevenLabs voice ID |

## X Spaces Bot
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `X_SPACES_ENABLED` | `false` | server.js | Enable X Spaces Puppeteer bot |
| `X_USERNAME` | — | auth.js | X/Twitter username for form login |
| `X_PASSWORD` | — | auth.js | X/Twitter password |
| `X_EMAIL` | `""` | auth.js | Email for X verification step |
| `X_AUTH_TOKEN` | `""` | auth.js | X auth_token cookie (preferred login) |
| `X_CT0` | `""` | auth.js | X ct0 CSRF cookie |
| `X_SPACE_URL` | — | x-spaces/index.js | Auto-join this Space URL on startup |

## Talky Show (NOT for standalone)
| Variable | Default | Used By | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | — | server.js | OpenRouter API key for Talky AI |
| `BIRDEYE_API_KEY` | — | birdeyeClient.js | Birdeye API for price data |
| `PUMPORTAL_API_KEY` | — | pumpPortalClient.js | PumpPortal API for trade data |
| `VOICE_API_KEY` | — | server.js | ElevenLabs API for Talky voices |
| `VOICE_GROK/GPT/DEEPSEEK/CLAUDE/GEMINI` | — | server.js | Per-character voice IDs |
| `APIFY_TOKEN` | — | twitterClient.js | Apify API token for Twitter scraping |
| `TARGET_TWEET` | — | twitterClient.js | Tweet URL to monitor replies |
| `RETWEET_READ_INTERVAL` | `10` | twitterClient.js | Seconds between Twitter checks |
| `LAUNCH_PLATFORM` | derived from BUY_LINK | server.js | Exchange platform hostname |


