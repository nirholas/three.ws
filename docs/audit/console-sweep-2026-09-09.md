# Console Sweep: 2026-09-09

Headless Chromium (Playwright) over 798 HTML routes from `data/pages.json` at desktop 1440×900 and mobile 390×844. Each route: `domcontentloaded` → scroll → 3000ms settle. Environment noise (Vite HMR-proxy wss handshake, third-party telemetry, auth-gated `/api` 4xx, dev-origin CDN CORS) is filtered.

**Result:** ❌ 31 route(s) with errors. 70 total error(s).

Routes that failed in the parallel pass are re-run once, serially, and the second reading is the one reported: desktop 220/251 cleared on the retry, mobile 0/3 cleared on the retry. A route that cleared was losing its settle window to load on a shared box, not failing.

## Per-route

| Route | Section | desktop err | desktop warn | mobile err | mobile warn |
|---|---|---|---|---|---|
| `/` | main | 0 | 0 | 0 | 0 |
| `/3d` | learn | 0 | 0 | 0 | 0 |
| `/activity` | crypto | 0 | 0 | 0 | 0 |
| `/agenc/embodied` | main | 0 | 0 | 0 | 0 |
| `/agenc/room` | main | 0 | 0 | 0 | 0 |
| `/agent-economy` | crypto | 0 | 0 | 0 | 0 |
| `/agent-economy-volume` | crypto | 0 | 0 | 0 | 0 |
| `/agent-exchange` | crypto | 0 | 0 | 0 | 0 |
| `/agent-identities` | agent-tools | 0 | 0 | 0 | 0 |
| `/agent-screen` | build | 0 | 0 | 0 | 0 |
| `/agent-studio` | build | 0 | 0 | 0 | 0 |
| `/agent-trade` | crypto | 0 | 0 | 0 | 0 |
| `/agent-wallet` | crypto | 2 | 0 | 0 | 0 |
| `/agents` | agent-tools | 2 | 0 | 0 | 0 |
| `/agents-live` | build | 0 | 0 | 0 | 0 |
| `/agi` | crypto | 0 | 0 | 0 | 0 |
| `/agora` | build | 0 | 0 | 0 | 0 |
| `/airdrops` | crypto | 0 | 0 | 0 | 0 |
| `/alpha-copilot` | main | 0 | 0 | 0 | 0 |
| `/animations` | main | 0 | 0 | 0 | 0 |
| `/app` | build | 0 | 0 | 0 | 0 |
| `/ar` | labs | 0 | 0 | 0 | 0 |
| `/ar/studio` | labs | 0 | 0 | 0 | 0 |
| `/ar/view` | labs | 0 | 0 | 0 | 0 |
| `/arbitrage` | crypto | 0 | 0 | 0 | 0 |
| `/arena` | crypto | 0 | 0 | 0 | 0 |
| `/artifact` | build | 0 | 0 | 0 | 0 |
| `/asl-alphabet` | main | 0 | 0 | 0 | 0 |
| `/assembly` | labs | 0 | 0 | 0 | 0 |
| `/assistant` | build | 0 | 0 | 0 | 0 |
| `/atlas` | main | 0 | 0 | 0 | 0 |
| `/autopilot` | main | 0 | 0 | 0 | 0 |
| `/autopilot-activity` | crypto | 0 | 0 | 0 | 0 |
| `/avatar-artifact` | labs | 0 | 0 | 0 | 0 |
| `/avatar-cli` | build | 0 | 0 | 0 | 0 |
| `/avatar-engines` | build | 0 | 0 | 0 | 0 |
| `/avatar-sdk` | build | 0 | 0 | 0 | 0 |
| `/avatar-studio` | build | 0 | 0 | 0 | 0 |
| `/avatar-wallet-chat` | crypto | 0 | 0 | 0 | 0 |
| `/awesome` | learn | 0 | 0 | 0 | 0 |
| `/aws` | learn | 0 | 0 | 0 | 0 |
| `/bazaar` | crypto | 0 | 0 | 0 | 0 |
| `/blog` | blog | 0 | 0 | 0 | 0 |
| `/blog/2500-new-animations` | blog | 0 | 0 | 0 | 0 |
| `/blog/3d-ai-crypto-convergence` | blog | 0 | 0 | 0 | 0 |
| `/blog/agent-3d-web-component` | blog | 0 | 0 | 0 | 0 |
| `/blog/agent-builder-studio-launch` | blog | 0 | 0 | 0 | 0 |
| `/blog/animation-emotion-control` | blog | 0 | 0 | 0 | 0 |
| `/blog/autonomous-trading-experiment` | blog | 0 | 0 | 0 | 0 |
| `/blog/concierge-3d-chat-widget` | blog | 0 | 0 | 0 | 0 |
| `/blog/first-autonomous-trade` | blog | 0 | 0 | 0 | 0 |
| `/blog/how-to-embed-3d-onchain-agents` | blog | 0 | 0 | 0 | 0 |
| `/blog/ibm-user-group-first-in-world-meetup-recap` | blog | 0 | 0 | 0 | 0 |
| `/blog/image-to-3d-on-nvidia-l4-and-blackwell` | blog | 0 | 0 | 0 | 0 |
| `/blog/inside-the-forge` | blog | 0 | 0 | 0 | 0 |
| `/blog/monetize-mcp-server-x402-paid-tools` | blog | 0 | 0 | 0 | 0 |
| `/blog/pumpfun-agent-payments-sdk` | blog | 0 | 0 | 0 | 0 |
| `/blog/real-time-voice-interaction` | blog | 0 | 0 | 0 | 0 |
| `/blog/see-your-3d-in-ar` | blog | 0 | 0 | 0 | 0 |
| `/blog/solana-wallet-integration` | blog | 0 | 0 | 0 | 0 |
| `/blog/text-to-3d-is-live` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-token-listings` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-alibaba-cloud-partnership` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-aws-partner` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-dextools-social-boost-buyback` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-featured-on-alibaba-cloud-marketplace-blog` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-google-cloud-partnership` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-hackernoon-partnership` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-ibm-business-partner` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-ibm-collaboration` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-on-alibaba-cloud-marketplace` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-on-anthropic-mcp-registry` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-on-aws-marketplace` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-on-bnb-chain-dappbay` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-on-coinmarketcap` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-openai-select-partner` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-play-coin-communities` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-quicknode-startup-program` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-speraxusd-integration` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-x402-bazaar` | blog | 0 | 0 | 0 | 0 |
| `/blog/x402-stripe-for-agent-payments` | blog | 0 | 0 | 0 | 0 |
| `/bnb` | crypto | 0 | 0 | 0 | 0 |
| `/bnb-latency` | crypto | 0 | 0 | 0 | 0 |
| `/brain` | labs | 0 | 0 | 0 | 0 |
| `/brownout` | learn | 0 | 0 | 0 | 0 |
| `/bundles` | build | 0 | 0 | 0 | 0 |
| `/ca2x402` | build | 0 | 0 | 0 | 0 |
| `/capture` | build | 0 | 0 | 0 | 0 |
| `/categories` | crypto | 0 | 0 | 0 | 0 |
| `/cert` | crypto | 0 | 0 | 0 | 0 |
| `/chains` | crypto | 0 | 0 | 0 | 0 |
| `/changelog` | learn | 0 | 0 | 0 | 0 |
| `/character-library` | main | 0 | 0 | 0 | 0 |
| `/characters` | main | 0 | 0 | 0 | 0 |
| `/chat` | agent-tools | 0 | 0 | 0 | 0 |
| `/choreograph` | main | 0 | 0 | 0 | 0 |
| `/claim-wallet` | crypto | 0 | 0 | 0 | 0 |
| `/clash` | crypto | 0 | 1 | 0 | 1 |
| `/clip-director` | crypto | 0 | 0 | 0 | 0 |
| `/club` | crypto | 0 | 0 | 0 | 0 |
| `/coin-intel` | crypto | 0 | 0 | 0 | 0 |
| `/coin3d` | crypto | 0 | 0 | 0 | 0 |
| `/coins` | crypto | 0 | 0 | 0 | 0 |
| `/collection` | main | 0 | 0 | 0 | 0 |
| `/communities` | crypto | 0 | 0 | 0 | 0 |
| `/community` | main | 0 | 0 | 0 | 0 |
| `/companion` | main | 0 | 0 | 0 | 0 |
| `/compare` | crypto | 0 | 0 | 0 | 0 |
| `/compose` | build | 0 | 0 | 0 | 0 |
| `/concierge` | main | 0 | 0 | 0 | 0 |
| `/constellation` | crypto | 0 | 0 | 0 | 0 |
| `/conversions` | main | 0 | 0 | 0 | 0 |
| `/converter` | crypto | 0 | 0 | 0 | 0 |
| `/cookbook` | learn | 0 | 0 | 0 | 0 |
| `/cookbook/asset-quality-gate` | learn | 0 | 0 | 0 | 0 |
| `/cookbook/mcp-3d-tool` | learn | 0 | 0 | 0 | 0 |
| `/cookbook/parallel-asset-pack` | learn | 0 | 0 | 0 | 0 |
| `/cookbook/self-correcting-3d` | learn | 0 | 0 | 0 | 0 |
| `/cookbook/text-to-3d-cli` | learn | 0 | 0 | 0 | 0 |
| `/cosmos` | build | 0 | 0 | 0 | 0 |
| `/create` | build | 0 | 0 | 0 | 0 |
| `/create-agent` | build | 0 | 0 | 0 | 0 |
| `/create/prompt` | build | 0 | 0 | 0 | 0 |
| `/create/selfie` | build | 0 | 0 | 0 | 0 |
| `/create/video` | main | 0 | 0 | 0 | 0 |
| `/creations` | crypto | 0 | 0 | 0 | 0 |
| `/credits` | account | 2 | 0 | 0 | 0 |
| `/crews` | main | 0 | 0 | 0 | 0 |
| `/crypto` | learn | 0 | 0 | 0 | 0 |
| `/crypto-api` | learn | 0 | 0 | 0 | 0 |
| `/cz` | labs | 0 | 0 | 0 | 0 |
| `/dad` | build | 0 | 0 | 0 | 0 |
| `/daily` | labs | 0 | 0 | 0 | 0 |
| `/daily-match` | labs | 0 | 0 | 0 | 0 |
| `/dashboard` | account | 2 | 0 | 0 | 0 |
| `/dashboard/account` | account | 2 | 0 | 0 | 0 |
| `/dashboard/billing` | account | 2 | 0 | 0 | 0 |
| `/dashboard/capabilities` | crypto | 0 | 0 | 0 | 0 |
| `/dashboard/data-api` | account | 2 | 0 | 0 | 0 |
| `/dashboard/settings` | account | 2 | 0 | 0 | 0 |
| `/defi` | crypto | 0 | 0 | 0 | 0 |
| `/demo` | crypto | 0 | 0 | 0 | 0 |
| `/demos` | main | 0 | 0 | 0 | 0 |
| `/demos/agents` | main | 0 | 0 | 0 | 0 |
| `/deploy-onchain` | crypto | 0 | 0 | 0 | 0 |
| `/deployments` | crypto | 0 | 0 | 0 | 0 |
| `/derivatives` | crypto | 0 | 0 | 0 | 0 |
| `/dex-volumes` | crypto | 0 | 0 | 0 | 0 |
| `/diff` | build | 0 | 0 | 0 | 0 |
| `/diorama` | main | 0 | 0 | 0 | 0 |
| `/discover` | main | 0 | 0 | 0 | 0 |
| `/docs` | learn | 0 | 0 | 0 | 0 |
| `/docs/3d-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/3d-asset-pipeline` | learn | 0 | 0 | 0 | 0 |
| `/docs/3d-pipeline` | learn | 0 | 0 | 0 | 0 |
| `/docs/3d-vision` | learn | 0 | 0 | 0 | 0 |
| `/docs/a2a-payments` | learn | 0 | 0 | 0 | 0 |
| `/docs/agenc` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-abilities` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-economy-volume` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-identities` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-index` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-manifest` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-reputation` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-runtime` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-screen-control` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-shell` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-skills` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-sniper` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-symphony` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-system` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-tokens` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-vitals` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-wallet-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/agent-wallets` | learn | 0 | 0 | 0 | 0 |
| `/docs/agents-vs-avatars` | learn | 0 | 0 | 0 | 0 |
| `/docs/agi` | learn | 0 | 0 | 0 | 0 |
| `/docs/airdrops` | learn | 0 | 0 | 0 | 0 |
| `/docs/alpha-copilot` | learn | 0 | 0 | 0 | 0 |
| `/docs/alpha-drip` | learn | 0 | 0 | 0 | 0 |
| `/docs/analytics-retention` | learn | 0 | 0 | 0 | 0 |
| `/docs/animation-seeding` | build | 0 | 0 | 0 | 0 |
| `/docs/animation-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/animations` | learn | 0 | 0 | 0 | 0 |
| `/docs/api-reference` | learn | 0 | 0 | 0 | 0 |
| `/docs/ar` | learn | 0 | 0 | 0 | 0 |
| `/docs/ar-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/architecture` | learn | 0 | 0 | 0 | 0 |
| `/docs/assistant-widget` | learn | 0 | 0 | 0 | 0 |
| `/docs/atlas` | learn | 0 | 0 | 0 | 0 |
| `/docs/authentication` | learn | 0 | 0 | 0 | 0 |
| `/docs/autonomous-economy` | learn | 0 | 0 | 0 | 0 |
| `/docs/autonomous-x402` | learn | 0 | 0 | 0 | 0 |
| `/docs/autopilot` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-artifact` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-cli` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-creation` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-engines` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-inspector` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-pipeline` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-reconstruction` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-thumbnails` | learn | 0 | 0 | 0 | 0 |
| `/docs/avatar-wardrobe` | learn | 0 | 0 | 0 | 0 |
| `/docs/aws-builder-center` | learn | 0 | 0 | 0 | 0 |
| `/docs/aws-builder-center-agent-payment-sessions` | learn | 0 | 0 | 0 | 0 |
| `/docs/aws-builder-center-marketplace-x402` | learn | 0 | 0 | 0 | 0 |
| `/docs/aws-builder-center-mcp-agents` | learn | 0 | 0 | 0 | 0 |
| `/docs/aws-marketplace` | learn | 0 | 0 | 0 | 0 |
| `/docs/aws-partner-spotlight` | learn | 0 | 0 | 0 | 0 |
| `/docs/blender-mcp` | learn | 0 | 0 | 0 | 0 |
| `/docs/bnb-payments` | learn | 0 | 0 | 0 | 0 |
| `/docs/brain` | learn | 0 | 0 | 0 | 0 |
| `/docs/brownout` | build | 0 | 0 | 0 | 0 |
| `/docs/ca2x402` | learn | 0 | 0 | 0 | 0 |
| `/docs/capture` | learn | 0 | 0 | 0 | 0 |
| `/docs/carplay` | learn | 0 | 0 | 0 | 0 |
| `/docs/changelog` | learn | 0 | 0 | 0 | 0 |
| `/docs/character-library` | learn | 0 | 0 | 0 | 0 |
| `/docs/character-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/chatgpt-3d-studio-gpt` | learn | 0 | 0 | 0 | 0 |
| `/docs/chatgpt-ar` | learn | 0 | 0 | 0 | 0 |
| `/docs/checkout-companion` | learn | 0 | 0 | 0 | 0 |
| `/docs/choreography` | learn | 0 | 0 | 0 | 0 |
| `/docs/circulation-engine` | learn | 0 | 0 | 0 | 0 |
| `/docs/clash` | learn | 0 | 0 | 0 | 0 |
| `/docs/coin-wars` | learn | 0 | 0 | 0 | 0 |
| `/docs/community` | learn | 0 | 0 | 0 | 0 |
| `/docs/companion` | learn | 0 | 0 | 0 | 0 |
| `/docs/compose` | learn | 0 | 0 | 0 | 0 |
| `/docs/concierge` | learn | 0 | 0 | 0 | 0 |
| `/docs/configuration` | learn | 0 | 0 | 0 | 0 |
| `/docs/contributing` | learn | 0 | 0 | 0 | 0 |
| `/docs/copy-trading` | learn | 0 | 0 | 0 | 0 |
| `/docs/cosmos` | learn | 0 | 0 | 0 | 0 |
| `/docs/create-agent` | build | 0 | 0 | 0 | 0 |
| `/docs/creator-portfolio` | learn | 0 | 0 | 0 | 0 |
| `/docs/crews` | learn | 0 | 0 | 0 | 0 |
| `/docs/crypto-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/custody` | learn | 0 | 0 | 0 | 0 |
| `/docs/daily-forge` | learn | 0 | 0 | 0 | 0 |
| `/docs/daily-match` | learn | 0 | 0 | 0 | 0 |
| `/docs/deployment` | learn | 0 | 0 | 0 | 0 |
| `/docs/deployments` | learn | 0 | 0 | 0 | 0 |
| `/docs/DESIGN-TOKENS` | learn | 0 | 0 | 0 | 0 |
| `/docs/developer-platform` | learn | 0 | 0 | 0 | 0 |
| `/docs/diorama` | learn | 0 | 0 | 0 | 0 |
| `/docs/do-i-need-crypto` | learn | 0 | 0 | 0 | 0 |
| `/docs/docs-world` | learn | 0 | 0 | 0 | 0 |
| `/docs/draft-agent-mint` | learn | 0 | 0 | 0 | 0 |
| `/docs/drops` | learn | 0 | 0 | 0 | 0 |
| `/docs/economy-solver` | learn | 0 | 0 | 0 | 0 |
| `/docs/editor` | learn | 0 | 0 | 0 | 0 |
| `/docs/embedding` | learn | 0 | 0 | 0 | 0 |
| `/docs/embody` | learn | 0 | 0 | 0 | 0 |
| `/docs/erc8004` | learn | 0 | 0 | 0 | 0 |
| `/docs/event-souvenirs` | learn | 0 | 0 | 0 | 0 |
| `/docs/examples` | learn | 0 | 0 | 0 | 0 |
| `/docs/exit-lab` | learn | 0 | 0 | 0 | 0 |
| `/docs/fact-check` | learn | 0 | 0 | 0 | 0 |
| `/docs/farcaster-memory-seeding` | learn | 0 | 0 | 0 | 0 |
| `/docs/feedback` | learn | 0 | 0 | 0 | 0 |
| `/docs/first-contribution` | learn | 0 | 0 | 0 | 0 |
| `/docs/forge` | learn | 0 | 0 | 0 | 0 |
| `/docs/forge-background-generation` | learn | 0 | 0 | 0 | 0 |
| `/docs/forge-off` | learn | 0 | 0 | 0 | 0 |
| `/docs/forge-pipeline` | learn | 0 | 0 | 0 | 0 |
| `/docs/forged` | learn | 0 | 0 | 0 | 0 |
| `/docs/fork-trade` | learn | 0 | 0 | 0 | 0 |
| `/docs/free-llm-providers` | learn | 0 | 0 | 0 | 0 |
| `/docs/freshness` | learn | 0 | 0 | 0 | 0 |
| `/docs/galaxy` | learn | 0 | 0 | 0 | 0 |
| `/docs/generation-watch` | learn | 0 | 0 | 0 | 0 |
| `/docs/genesis` | learn | 0 | 0 | 0 | 0 |
| `/docs/genome` | learn | 0 | 0 | 0 | 0 |
| `/docs/ghost-copy` | learn | 0 | 0 | 0 | 0 |
| `/docs/github-memory-seeding` | learn | 0 | 0 | 0 | 0 |
| `/docs/glance` | build | 0 | 0 | 0 | 0 |
| `/docs/globe` | learn | 0 | 0 | 0 | 0 |
| `/docs/guardian` | learn | 0 | 0 | 0 | 0 |
| `/docs/guards` | learn | 0 | 0 | 0 | 0 |
| `/docs/herald` | learn | 0 | 0 | 0 | 0 |
| `/docs/hold-to-access` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-households` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-plans` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-privacy` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-relay` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-relay-threat-model` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-satellite` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-scene` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-security` | learn | 0 | 0 | 0 | 0 |
| `/docs/home-voice` | learn | 0 | 0 | 0 | 0 |
| `/docs/how-forge-works` | learn | 0 | 0 | 0 | 0 |
| `/docs/how-it-works` | learn | 0 | 0 | 0 | 0 |
| `/docs/huggingface` | learn | 0 | 0 | 0 | 0 |
| `/docs/i18n` | learn | 0 | 0 | 0 | 0 |
| `/docs/ibm` | learn | 0 | 0 | 0 | 0 |
| `/docs/ibm-community` | learn | 0 | 0 | 0 | 0 |
| `/docs/ibm-x402-mcp` | learn | 0 | 0 | 0 | 0 |
| `/docs/image-to-3d` | learn | 0 | 0 | 0 | 0 |
| `/docs/in-game-economy` | learn | 0 | 0 | 0 | 0 |
| `/docs/inference-node-operator` | learn | 0 | 0 | 0 | 0 |
| `/docs/integrations` | learn | 0 | 0 | 0 | 0 |
| `/docs/introduction` | learn | 0 | 0 | 0 | 0 |
| `/docs/ios-app` | learn | 0 | 0 | 0 | 0 |
| `/docs/irl` | learn | 0 | 0 | 0 | 0 |
| `/docs/js-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/knock` | learn | 0 | 0 | 0 | 0 |
| `/docs/kol-tracker` | learn | 0 | 0 | 0 | 0 |
| `/docs/labor-market` | learn | 0 | 0 | 0 | 0 |
| `/docs/layers` | learn | 0 | 0 | 0 | 0 |
| `/docs/likeness-eval` | learn | 0 | 0 | 0 | 0 |
| `/docs/lipsync` | learn | 0 | 0 | 0 | 0 |
| `/docs/liquid-glass` | learn | 0 | 0 | 0 | 0 |
| `/docs/listings` | learn | 0 | 0 | 0 | 0 |
| `/docs/live-docs` | learn | 0 | 0 | 0 | 0 |
| `/docs/live-steps` | learn | 0 | 0 | 0 | 0 |
| `/docs/make-your-agent` | learn | 0 | 0 | 0 | 0 |
| `/docs/market-data-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/marketplace` | learn | 0 | 0 | 0 | 0 |
| `/docs/materialize` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-3d-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-agent` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-intel` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-marketplace` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-naming` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-safety` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-scenes` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-tools` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-vanity` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-x402` | learn | 0 | 0 | 0 | 0 |
| `/docs/mcp-x402-bazaar` | learn | 0 | 0 | 0 | 0 |
| `/docs/media-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/memory` | learn | 0 | 0 | 0 | 0 |
| `/docs/mint-mark` | learn | 0 | 0 | 0 | 0 |
| `/docs/minted` | learn | 0 | 0 | 0 | 0 |
| `/docs/mocap-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/model-diff` | learn | 0 | 0 | 0 | 0 |
| `/docs/money-feed` | learn | 0 | 0 | 0 | 0 |
| `/docs/money-flow-map` | learn | 0 | 0 | 0 | 0 |
| `/docs/monitor` | learn | 0 | 0 | 0 | 0 |
| `/docs/motion-swap` | learn | 0 | 0 | 0 | 0 |
| `/docs/multi-agent` | learn | 0 | 0 | 0 | 0 |
| `/docs/native-widgets` | build | 0 | 0 | 0 | 0 |
| `/docs/news-rights` | learn | 0 | 0 | 0 | 0 |
| `/docs/notifications` | learn | 0 | 0 | 0 | 0 |
| `/docs/nvidia-inception` | learn | 0 | 0 | 0 | 0 |
| `/docs/nvidia-inception/index.html` | learn | 0 | 0 | 0 | 0 |
| `/docs/nvidia-models` | learn | 0 | 0 | 0 | 0 |
| `/docs/nvidia-nemotron-spotlight` | learn | 0 | 0 | 0 | 0 |
| `/docs/object-library` | learn | 0 | 0 | 0 | 0 |
| `/docs/okx-marketplace` | learn | 0 | 0 | 0 | 0 |
| `/docs/onboarding-tier` | learn | 0 | 0 | 0 | 0 |
| `/docs/onchain-agents` | learn | 0 | 0 | 0 | 0 |
| `/docs/open-source-ecosystem` | learn | 0 | 0 | 0 | 0 |
| `/docs/open-source-footprint` | learn | 0 | 0 | 0 | 0 |
| `/docs/oracle` | learn | 0 | 0 | 0 | 0 |
| `/docs/oracle-model` | learn | 0 | 0 | 0 | 0 |
| `/docs/overlay-audit` | learn | 0 | 0 | 0 | 0 |
| `/docs/package-extraction` | learn | 0 | 0 | 0 | 0 |
| `/docs/page-performance` | learn | 0 | 0 | 0 | 0 |
| `/docs/partners` | learn | 0 | 0 | 0 | 0 |
| `/docs/payment-sessions` | learn | 0 | 0 | 0 | 0 |
| `/docs/permissions` | learn | 0 | 0 | 0 | 0 |
| `/docs/persona-hub` | learn | 0 | 0 | 0 | 0 |
| `/docs/pill-mascot` | learn | 0 | 0 | 0 | 0 |
| `/docs/plan-checkout` | learn | 0 | 0 | 0 | 0 |
| `/docs/play-forge-in-world` | learn | 0 | 0 | 0 | 0 |
| `/docs/play-hardening` | learn | 0 | 0 | 0 | 0 |
| `/docs/play-live-events` | learn | 0 | 0 | 0 | 0 |
| `/docs/play-vehicles` | learn | 0 | 0 | 0 | 0 |
| `/docs/pocket` | learn | 0 | 0 | 0 | 0 |
| `/docs/portal` | build | 0 | 0 | 0 | 0 |
| `/docs/portfolio` | learn | 0 | 0 | 0 | 0 |
| `/docs/premium` | learn | 0 | 0 | 0 | 0 |
| `/docs/press-kit` | learn | 0 | 0 | 0 | 0 |
| `/docs/procedural-animation` | learn | 0 | 0 | 0 | 0 |
| `/docs/product-demo` | learn | 0 | 0 | 0 | 0 |
| `/docs/PROTOCOL-vanity` | learn | 0 | 0 | 0 | 0 |
| `/docs/provenance` | learn | 0 | 0 | 0 | 0 |
| `/docs/pump-claims-channel` | learn | 0 | 0 | 0 | 0 |
| `/docs/pump-launcher` | learn | 0 | 0 | 0 | 0 |
| `/docs/quick-start` | learn | 0 | 0 | 0 | 0 |
| `/docs/radar` | learn | 0 | 0 | 0 | 0 |
| `/docs/reasoning-ledger` | learn | 0 | 0 | 0 | 0 |
| `/docs/recurring-payments` | learn | 0 | 0 | 0 | 0 |
| `/docs/remix` | learn | 0 | 0 | 0 | 0 |
| `/docs/reputation` | learn | 0 | 0 | 0 | 0 |
| `/docs/reputation-staking-market` | learn | 0 | 0 | 0 | 0 |
| `/docs/resilience` | learn | 0 | 0 | 0 | 0 |
| `/docs/restyle` | learn | 0 | 0 | 0 | 0 |
| `/docs/rig-doctor` | learn | 0 | 0 | 0 | 0 |
| `/docs/risk-acknowledgment` | learn | 0 | 0 | 0 | 0 |
| `/docs/robinhood-portfolios` | build | 0 | 0 | 0 | 0 |
| `/docs/sas-attestations` | learn | 0 | 0 | 0 | 0 |
| `/docs/scene-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/sdk` | learn | 0 | 0 | 0 | 0 |
| `/docs/security` | learn | 0 | 0 | 0 | 0 |
| `/docs/seed-quality` | learn | 0 | 0 | 0 | 0 |
| `/docs/seeker-app` | learn | 0 | 0 | 0 | 0 |
| `/docs/seeker-publishing` | learn | 0 | 0 | 0 | 0 |
| `/docs/seeker-submission-day` | learn | 0 | 0 | 0 | 0 |
| `/docs/seeker-video` | learn | 0 | 0 | 0 | 0 |
| `/docs/selfie-to-avatar` | learn | 0 | 0 | 0 | 0 |
| `/docs/seo` | learn | 0 | 0 | 0 | 0 |
| `/docs/share-and-embed` | learn | 0 | 0 | 0 | 0 |
| `/docs/shared-utilities` | learn | 0 | 0 | 0 | 0 |
| `/docs/shipfeed` | learn | 0 | 0 | 0 | 0 |
| `/docs/showcase` | learn | 0 | 0 | 0 | 0 |
| `/docs/sign-language` | learn | 0 | 0 | 0 | 0 |
| `/docs/signals` | learn | 0 | 0 | 0 | 0 |
| `/docs/sim-readiness` | learn | 0 | 0 | 0 | 0 |
| `/docs/site-performance` | learn | 0 | 0 | 0 | 0 |
| `/docs/sketchfab` | learn | 0 | 0 | 0 | 0 |
| `/docs/skill-bundles` | learn | 0 | 0 | 0 | 0 |
| `/docs/skill-royalties` | learn | 0 | 0 | 0 | 0 |
| `/docs/skills` | learn | 0 | 0 | 0 | 0 |
| `/docs/smart-contracts` | learn | 0 | 0 | 0 | 0 |
| `/docs/smart-home` | learn | 0 | 0 | 0 | 0 |
| `/docs/smart-money` | learn | 0 | 0 | 0 | 0 |
| `/docs/sniper-autonomy` | learn | 0 | 0 | 0 | 0 |
| `/docs/social-layer` | learn | 0 | 0 | 0 | 0 |
| `/docs/solana` | learn | 0 | 0 | 0 | 0 |
| `/docs/solana-reputation` | learn | 0 | 0 | 0 | 0 |
| `/docs/spatial-mcp` | learn | 0 | 0 | 0 | 0 |
| `/docs/splat` | learn | 0 | 0 | 0 | 0 |
| `/docs/spotlight` | learn | 0 | 0 | 0 | 0 |
| `/docs/stage` | learn | 0 | 0 | 0 | 0 |
| `/docs/start-here` | learn | 0 | 0 | 0 | 0 |
| `/docs/strategy-objects` | learn | 0 | 0 | 0 | 0 |
| `/docs/swarms` | learn | 0 | 0 | 0 | 0 |
| `/docs/talking-avatar-video` | learn | 0 | 0 | 0 | 0 |
| `/docs/terminal` | learn | 0 | 0 | 0 | 0 |
| `/docs/the-first-19-weeks` | learn | 0 | 0 | 0 | 0 |
| `/docs/three-microbuy` | learn | 0 | 0 | 0 | 0 |
| `/docs/three-thesis` | learn | 0 | 0 | 0 | 0 |
| `/docs/timeline` | learn | 0 | 0 | 0 | 0 |
| `/docs/token-gated-3d-embeds` | learn | 0 | 0 | 0 | 0 |
| `/docs/tokens-xyz` | learn | 0 | 0 | 0 | 0 |
| `/docs/trader-card` | learn | 0 | 0 | 0 | 0 |
| `/docs/trader-passport` | learn | 0 | 0 | 0 | 0 |
| `/docs/trader-wrapped` | learn | 0 | 0 | 0 | 0 |
| `/docs/trading-arenas` | learn | 0 | 0 | 0 | 0 |
| `/docs/trading-copilot` | learn | 0 | 0 | 0 | 0 |
| `/docs/trading-experiment` | learn | 0 | 0 | 0 | 0 |
| `/docs/trading-hub` | learn | 0 | 0 | 0 | 0 |
| `/docs/trading-surfaces` | learn | 0 | 0 | 0 | 0 |
| `/docs/triage` | learn | 0 | 0 | 0 | 0 |
| `/docs/troubleshooting` | learn | 0 | 0 | 0 | 0 |
| `/docs/trust-primitives` | learn | 0 | 0 | 0 | 0 |
| `/docs/tty` | learn | 0 | 0 | 0 | 0 |
| `/docs/tty-avatar` | learn | 0 | 0 | 0 | 0 |
| `/docs/tutorials/earn-and-spend-in-play` | learn | 0 | 0 | 0 | 0 |
| `/docs/tutorials/write-a-guard` | learn | 0 | 0 | 0 | 0 |
| `/docs/ui-juice` | learn | 0 | 0 | 0 | 0 |
| `/docs/user-wallet` | learn | 0 | 0 | 0 | 0 |
| `/docs/validation` | learn | 0 | 0 | 0 | 0 |
| `/docs/vanity` | learn | 0 | 0 | 0 | 0 |
| `/docs/vaults` | learn | 0 | 0 | 0 | 0 |
| `/docs/viability` | learn | 0 | 0 | 0 | 0 |
| `/docs/viewer` | learn | 0 | 0 | 0 | 0 |
| `/docs/voice-lab` | learn | 0 | 0 | 0 | 0 |
| `/docs/vscode` | learn | 0 | 0 | 0 | 0 |
| `/docs/walk` | learn | 0 | 0 | 0 | 0 |
| `/docs/walk-leaderboard` | learn | 0 | 0 | 0 | 0 |
| `/docs/web-component` | learn | 0 | 0 | 0 | 0 |
| `/docs/widget-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/widget-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/widgets` | learn | 0 | 0 | 0 | 0 |
| `/docs/witness` | learn | 0 | 0 | 0 | 0 |
| `/docs/world` | learn | 0 | 0 | 0 | 0 |
| `/docs/world-lines` | learn | 0 | 0 | 0 | 0 |
| `/docs/x-memory-seeding` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-buyer` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-dev-tools` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-distribution` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-endpoints` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-preflight` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-ring-economy` | learn | 0 | 0 | 0 | 0 |
| `/docs/x402-studio` | learn | 0 | 0 | 0 | 0 |
| `/drive` | main | 0 | 0 | 0 | 0 |
| `/drops` | crypto | 0 | 0 | 0 | 0 |
| `/economy` | crypto | 0 | 0 | 0 | 0 |
| `/economy-lab` | labs | 0 | 0 | 0 | 0 |
| `/embed-doctor` | build | 0 | 0 | 0 | 0 |
| `/eth-vanity` | crypto | 0 | 0 | 0 | 0 |
| `/event` | crypto | 2 | 0 | 0 | 0 |
| `/events/build-3d-agents-live` | learn | 0 | 0 | 0 | 0 |
| `/evm-wallet` | crypto | 0 | 0 | 0 | 0 |
| `/examples` | learn | 0 | 0 | 0 | 0 |
| `/exchanges` | crypto | 0 | 0 | 0 | 0 |
| `/exit-lab` | crypto | 2 | 0 | 0 | 0 |
| `/fact-check` | crypto | 0 | 0 | 0 | 0 |
| `/fact-checker` | crypto | 0 | 0 | 0 | 0 |
| `/fear-greed` | crypto | 0 | 0 | 0 | 0 |
| `/features` | build | 0 | 0 | 0 | 0 |
| `/features/agent-exchange` | build | 0 | 0 | 0 | 0 |
| `/features/ar` | build | 0 | 0 | 0 | 0 |
| `/features/deploy` | build | 0 | 0 | 0 | 0 |
| `/features/forge` | build | 0 | 0 | 0 | 0 |
| `/features/marketplace` | build | 0 | 0 | 0 | 0 |
| `/features/play` | build | 0 | 0 | 0 | 0 |
| `/features/scan` | build | 0 | 0 | 0 | 0 |
| `/features/studio` | build | 0 | 0 | 0 | 0 |
| `/features/walk` | build | 0 | 0 | 0 | 0 |
| `/feed` | main | 0 | 0 | 0 | 0 |
| `/fees` | crypto | 0 | 0 | 0 | 0 |
| `/fits` | crypto | 0 | 0 | 0 | 0 |
| `/flow` | crypto | 0 | 0 | 0 | 0 |
| `/forever` | crypto | 0 | 0 | 0 | 0 |
| `/forge` | build | 0 | 0 | 0 | 0 |
| `/forge-max` | build | 0 | 0 | 0 | 0 |
| `/forge-nim` | build | 0 | 0 | 0 | 0 |
| `/forge-spark` | build | 0 | 0 | 0 | 0 |
| `/forge-studio` | build | 0 | 0 | 0 | 0 |
| `/forged` | main | 0 | 0 | 0 | 0 |
| `/forgot-password` | account | 0 | 0 | 0 | 0 |
| `/galaxy` | labs | 0 | 0 | 0 | 0 |
| `/gallery` | main | 0 | 0 | 0 | 0 |
| `/gas` | crypto | 0 | 0 | 0 | 0 |
| `/genesis` | build | 0 | 0 | 0 | 0 |
| `/genome` | build | 0 | 0 | 0 | 0 |
| `/gestures` | main | 0 | 0 | 0 | 0 |
| `/ghost-copy` | crypto | 0 | 0 | 0 | 0 |
| `/glance` | build | 0 | 0 | 0 | 0 |
| `/globe` | labs | 1 | 0 | 1 | 0 |
| `/glossary` | learn | 0 | 0 | 0 | 0 |
| `/gmgn` | crypto | 0 | 0 | 0 | 0 |
| `/go` | crypto | 0 | 0 | 0 | 0 |
| `/guardian` | crypto | 0 | 0 | 0 | 0 |
| `/guards` | learn | 0 | 0 | 0 | 0 |
| `/hacks` | crypto | 0 | 0 | 0 | 0 |
| `/heatmap` | crypto | 0 | 0 | 0 | 0 |
| `/herald` | main | 0 | 0 | 0 | 0 |
| `/hero-demo` | crypto | 0 | 0 | 0 | 0 |
| `/holo` | labs | 0 | 0 | 0 | 0 |
| `/hydrate` | build | 0 | 0 | 0 | 0 |
| `/ibm/hello` | crypto | 4 | 0 | 4 | 0 |
| `/ibm/x402-demo` | crypto | 0 | 0 | 0 | 0 |
| `/image-to-3d` | build | 0 | 0 | 0 | 0 |
| `/import/rpm` | build | 0 | 0 | 0 | 0 |
| `/inspect` | build | 0 | 0 | 0 | 0 |
| `/integrations` | build | 0 | 0 | 0 | 0 |
| `/irl` | main | 0 | 0 | 0 | 0 |
| `/irl-privacy` | main | 0 | 0 | 0 | 0 |
| `/irl/sign` | main | 0 | 0 | 0 | 0 |
| `/knock` | main | 0 | 0 | 0 | 0 |
| `/labor-market` | crypto | 0 | 0 | 0 | 0 |
| `/labs` | labs | 0 | 0 | 0 | 0 |
| `/launch` | crypto | 0 | 0 | 0 | 0 |
| `/launch-studio` | crypto | 0 | 0 | 0 | 0 |
| `/launcher` | crypto | 0 | 0 | 0 | 0 |
| `/launches` | crypto | 0 | 0 | 0 | 0 |
| `/launchpad` | labs | 0 | 0 | 0 | 0 |
| `/leaderboard` | crypto | 0 | 0 | 0 | 0 |
| `/ledger` | agent-tools | 2 | 0 | 0 | 0 |
| `/legal` | legal | 0 | 0 | 0 | 0 |
| `/legal/content-policy` | legal | 0 | 0 | 0 | 0 |
| `/legal/eula` | legal | 0 | 0 | 0 | 0 |
| `/legal/nvidia-ngc-eula` | legal | 0 | 0 | 0 | 0 |
| `/legal/privacy` | legal | 0 | 0 | 0 | 0 |
| `/legal/risk` | legal | 0 | 0 | 0 | 0 |
| `/legal/tos` | legal | 0 | 0 | 0 | 0 |
| `/lipsync` | labs | 0 | 0 | 0 | 0 |
| `/lipsync/mic` | labs | 0 | 0 | 0 | 0 |
| `/live` | crypto | 0 | 0 | 0 | 0 |
| `/login` | account | 2 | 0 | 0 | 0 |
| `/lookup` | crypto | 0 | 0 | 0 | 0 |
| `/marketplace` | main | 0 | 0 | 0 | 0 |
| `/marketplace/analytics` | main | 0 | 0 | 0 | 0 |
| `/markets` | crypto | 2 | 0 | 0 | 0 |
| `/markets/archive` | crypto | 0 | 0 | 0 | 0 |
| `/markets/digest` | crypto | 0 | 0 | 0 | 0 |
| `/markets/news` | crypto | 2 | 0 | 0 | 0 |
| `/markets/news/article` | crypto | 0 | 0 | 0 | 0 |
| `/markets/robinhood` | crypto | 0 | 0 | 0 | 0 |
| `/markets/robinhood/desk` | crypto | 1 | 0 | 0 | 0 |
| `/markets/robinhood/portfolios` | crypto | 2 | 1 | 0 | 0 |
| `/markets/robinhood/portfolios/universe` | crypto | 1 | 0 | 0 | 0 |
| `/markets/trending` | crypto | 0 | 0 | 0 | 0 |
| `/materialize` | build | 0 | 0 | 0 | 0 |
| `/mcp-tools` | learn | 0 | 0 | 0 | 0 |
| `/meta-allocator` | crypto | 0 | 0 | 0 | 0 |
| `/mine` | account | 0 | 0 | 0 | 0 |
| `/minted` | crypto | 0 | 0 | 0 | 0 |
| `/mirror` | crypto | 0 | 0 | 0 | 0 |
| `/mocap-studio` | main | 0 | 0 | 0 | 0 |
| `/monitor` | build | 0 | 0 | 0 | 0 |
| `/motion-swap` | build | 0 | 0 | 0 | 0 |
| `/my-agents` | agent-tools | 2 | 0 | 0 | 0 |
| `/news` | learn | 0 | 0 | 0 | 0 |
| `/nim-forge` | build | 0 | 0 | 0 | 0 |
| `/notifications` | main | 0 | 0 | 0 | 0 |
| `/nvidia` | main | 0 | 0 | 0 | 0 |
| `/objects` | main | 0 | 0 | 0 | 0 |
| `/openai` | main | 0 | 0 | 0 | 0 |
| `/oracle` | crypto | 0 | 0 | 0 | 0 |
| `/oracle-lab` | crypto | 0 | 0 | 0 | 0 |
| `/oracle/arm` | crypto | 0 | 0 | 0 | 0 |
| `/oracle/docs` | crypto | 0 | 0 | 0 | 0 |
| `/partners` | main | 0 | 0 | 0 | 0 |
| `/pay` | crypto | 0 | 0 | 0 | 0 |
| `/pay/simulator` | account | 2 | 0 | 0 | 0 |
| `/payments` | account | 2 | 0 | 0 | 0 |
| `/pill` | crypto | 2 | 0 | 0 | 0 |
| `/pipeline` | crypto | 0 | 0 | 0 | 0 |
| `/pitch` | main | 0 | 0 | 0 | 0 |
| `/play` | crypto | 0 | 0 | 0 | 0 |
| `/play/agent-wallet` | crypto | 0 | 0 | 0 | 0 |
| `/play/arena` | crypto | 0 | 0 | 0 | 0 |
| `/play/economy` | crypto | 0 | 0 | 0 | 0 |
| `/play/solver` | crypto | 0 | 0 | 0 | 0 |
| `/play/ufo` | crypto | 0 | 0 | 0 | 0 |
| `/play/war` | crypto | 0 | 0 | 0 | 0 |
| `/playground` | labs | 0 | 0 | 0 | 0 |
| `/pocket` | labs | 0 | 0 | 0 | 0 |
| `/portal` | main | 0 | 0 | 0 | 0 |
| `/portfolio` | crypto | 0 | 0 | 0 | 0 |
| `/pose` | build | 0 | 0 | 0 | 0 |
| `/preflight` | agent-tools | 2 | 0 | 0 | 0 |
| `/press` | main | 0 | 0 | 0 | 0 |
| `/pricing` | main | 0 | 0 | 0 | 0 |
| `/profile` | account | 0 | 0 | 0 | 0 |
| `/proof` | crypto | 0 | 0 | 0 | 0 |
| `/providers` | crypto | 0 | 0 | 0 | 0 |
| `/pulse` | crypto | 0 | 0 | 0 | 0 |
| `/pump-dashboard` | crypto | 0 | 0 | 0 | 0 |
| `/pump-live` | crypto | 0 | 0 | 0 | 0 |
| `/pump-visualizer` | crypto | 0 | 0 | 0 | 0 |
| `/pumpfun` | crypto | 0 | 0 | 0 | 0 |
| `/radar` | crypto | 0 | 0 | 0 | 0 |
| `/rankings` | labs | 0 | 0 | 0 | 0 |
| `/receipts` | crypto | 0 | 0 | 0 | 0 |
| `/recurring` | crypto | 0 | 0 | 0 | 0 |
| `/register` | account | 0 | 0 | 0 | 0 |
| `/render-lab` | build | 0 | 0 | 0 | 0 |
| `/reputation` | agent-tools | 2 | 0 | 0 | 0 |
| `/reputation/market` | agent-tools | 2 | 0 | 0 | 0 |
| `/restyle` | build | 0 | 0 | 0 | 0 |
| `/rig-doctor` | build | 0 | 0 | 0 | 0 |
| `/scene` | build | 0 | 0 | 0 | 0 |
| `/screener` | crypto | 0 | 0 | 0 | 0 |
| `/search` | main | 0 | 0 | 0 | 0 |
| `/seeker` | build | 0 | 0 | 0 | 0 |
| `/settings` | account | 2 | 0 | 0 | 0 |
| `/ship` | learn | 0 | 0 | 0 | 0 |
| `/shopper` | crypto | 0 | 0 | 0 | 0 |
| `/showcase` | main | 0 | 0 | 0 | 0 |
| `/sign-language` | main | 0 | 0 | 0 | 0 |
| `/sign-mirror` | main | 0 | 0 | 0 | 0 |
| `/signals` | crypto | 0 | 0 | 0 | 0 |
| `/sitemap` | main | 0 | 0 | 0 | 0 |
| `/skills` | main | 0 | 0 | 0 | 0 |
| `/smart-home` | build | 0 | 0 | 0 | 0 |
| `/smart-home/join` | build | 0 | 0 | 0 | 0 |
| `/smart-home/plan` | build | 0 | 0 | 0 | 0 |
| `/smart-home/privacy` | build | 0 | 0 | 0 | 0 |
| `/smart-home/satellite` | build | 0 | 0 | 0 | 0 |
| `/smart-money` | crypto | 0 | 0 | 0 | 0 |
| `/sniper/experiments` | crypto | 0 | 0 | 0 | 0 |
| `/spatial-mcp` | labs | 0 | 0 | 0 | 0 |
| `/sperax` | crypto | 0 | 0 | 0 | 0 |
| `/splat` | build | 0 | 0 | 0 | 0 |
| `/spotlight` | agent-tools | 4 | 0 | 2 | 0 |
| `/stablecoins` | crypto | 0 | 0 | 0 | 0 |
| `/stage` | crypto | 0 | 0 | 0 | 0 |
| `/start` | build | 0 | 0 | 0 | 0 |
| `/status` | learn | 0 | 0 | 0 | 0 |
| `/strategies` | crypto | 0 | 0 | 0 | 0 |
| `/strategy-lab` | crypto | 0 | 0 | 0 | 0 |
| `/stream` | build | 0 | 0 | 0 | 0 |
| `/studio` | build | 0 | 0 | 0 | 0 |
| `/support` | learn | 0 | 0 | 0 | 0 |
| `/swarms` | crypto | 2 | 0 | 0 | 0 |
| `/symphony` | labs | 0 | 0 | 0 | 0 |
| `/temporary` | main | 0 | 0 | 0 | 0 |
| `/terminal` | crypto | 0 | 0 | 0 | 0 |
| `/theater` | crypto | 0 | 0 | 0 | 0 |
| `/three` | crypto | 0 | 0 | 0 | 0 |
| `/three-live` | crypto | 0 | 0 | 0 | 0 |
| `/three-token` | crypto | 0 | 0 | 0 | 0 |
| `/threews/claim` | build | 0 | 0 | 0 | 0 |
| `/timeline` | main | 0 | 0 | 0 | 0 |
| `/tour` | main | 0 | 0 | 0 | 0 |
| `/tour-builder` | learn | 0 | 0 | 0 | 0 |
| `/tour/atlas` | main | 0 | 0 | 0 | 0 |
| `/tracker` | crypto | 0 | 0 | 0 | 0 |
| `/trades` | crypto | 0 | 0 | 0 | 0 |
| `/trading` | crypto | 2 | 0 | 0 | 0 |
| `/trending` | crypto | 0 | 0 | 0 | 0 |
| `/tty` | build | 0 | 0 | 0 | 0 |
| `/tutor` | crypto | 0 | 0 | 0 | 0 |
| `/tutorials` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/add-a-3d-assistant` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/agent-personality` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/agent-reputation` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/agent-spending-envelope` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/animate-your-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/animate-your-avatar` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/arm-an-agent-sniper` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/build-a-3d-asset-pipeline` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/build-a-scene` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/build-a-site-concierge` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/character-library-to-embed` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/claim-threews-name` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/connect-ai-brain` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/connect-your-home` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/create-and-edit-memory` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/custom-skill` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/customize-appearance` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/deploy-to-vercel-custom-domain` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/earn-and-spend-in-play` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/embed-in-30-seconds` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/embed-on-website` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/emotion-from-data` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/explore-docs-world` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/find-a-better-exit-policy` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/first-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/first-prompt-to-3d` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/generate-3d-api` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/getting-started` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/greeting-and-first-speech` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/image-to-3d` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/import-avatar-url` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/js-api-events` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/mcp-server-for-your-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/mine-vanity-address` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/mint-pumpfun-token` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/monetize-mcp-server` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/multi-agent-coordination` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/nvidia-3d-free` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/nvidia-nim-self-host` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/paid-x402-endpoint` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/pay-for-x402-service` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/personal-ai-site` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/place-agent-irl` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/prompts-for-3d` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/read-the-trading-fleet` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/register-onchain` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/render-avatar-images` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/self-host-agent-backend` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/selfie-to-avatar` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/sell-a-skill-with-a-trial` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/share-your-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/ship-an-avatar-manifest` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/shopify-shopping-assistant` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/shopify-store-guide` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/shopify-store-guide-advanced` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/sign-with-your-avatar` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/skill-with-database-auth` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/solana-agent-reputation` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/sperax-tour` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/swap-avatar-in-studio` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/text-to-3d` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/trigger-from-page-events` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/upload-custom-glb` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/view-in-ar` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/voice-and-lipsync` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/walk-companion` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/wallet-sign-in` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/web-component-end-to-end` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/write-a-guard` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/x402-server-sdk` | learn | 0 | 0 | 0 | 0 |
| `/unstoppable` | crypto | 0 | 0 | 0 | 0 |
| `/validation` | build | 0 | 0 | 0 | 0 |
| `/vanity-wallet` | crypto | 0 | 0 | 0 | 0 |
| `/vanity/bounties` | crypto | 0 | 0 | 0 | 0 |
| `/vanity/gallery` | crypto | 0 | 0 | 0 | 0 |
| `/vanity/premium` | crypto | 0 | 0 | 0 | 0 |
| `/vanity/verify` | crypto | 0 | 0 | 0 | 0 |
| `/vault` | crypto | 0 | 0 | 0 | 0 |
| `/vaults` | crypto | 0 | 0 | 0 | 0 |
| `/viability` | crypto | 0 | 0 | 0 | 0 |
| `/viewer` | labs | 0 | 0 | 0 | 0 |
| `/voice` | build | 0 | 0 | 0 | 0 |
| `/voice/home` | build | 0 | 0 | 0 | 0 |
| `/walk` | main | 0 | 0 | 0 | 0 |
| `/walk-leaderboard` | labs | 0 | 0 | 0 | 0 |
| `/walkthroughs` | learn | 0 | 0 | 0 | 0 |
| `/walkthroughs/build-your-first-agent` | learn | 0 | 0 | 0 | 0 |
| `/walkthroughs/embed-a-3d-avatar` | learn | 0 | 0 | 0 | 0 |
| `/walkthroughs/find-an-agent-worth-using` | learn | 0 | 0 | 0 | 0 |
| `/walkthroughs/forge-your-first-3d-model` | learn | 0 | 0 | 0 | 0 |
| `/wallet` | crypto | 2 | 0 | 0 | 0 |
| `/wardrobe` | main | 0 | 0 | 0 | 0 |
| `/watch` | labs | 0 | 0 | 0 | 0 |
| `/watchlist` | crypto | 0 | 0 | 0 | 0 |
| `/what-is` | main | 0 | 0 | 0 | 0 |
| `/widgets` | build | 0 | 0 | 0 | 0 |
| `/world-lines` | main | 0 | 0 | 0 | 0 |
| `/wrapped` | crypto | 0 | 0 | 0 | 0 |
| `/x402` | crypto | 0 | 0 | 0 | 0 |
| `/x402/studio` | crypto | 0 | 0 | 0 | 0 |
| `/yields` | crypto | 0 | 0 | 0 | 0 |

## Failures (detail)

### `/globe` (labs)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)
- **mobile**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/ibm/hello` (crypto)
- **desktop**
  - console: Access to script at 'https://three.ws/ios-bridge.72176eee.js' from origin 'http://localhost:41353' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED
  - console: Access to script at 'https://three.ws/atlas/score.js' from origin 'http://localhost:41353' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED
- **mobile**
  - console: Access to script at 'https://three.ws/ios-bridge.72176eee.js' from origin 'http://localhost:41353' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED
  - console: Access to script at 'https://three.ws/atlas/score.js' from origin 'http://localhost:41353' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED

### `/markets` (crypto)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/markets/robinhood/desk` (crypto)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/markets/robinhood/portfolios` (crypto)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/markets/robinhood/portfolios/universe` (crypto)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/markets/news` (crypto)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/event` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/32890cab-ab35-4bef-bcfa-c55e3605140d
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/159dbb14-3398-4c79-b7fd-b17be7b81687

### `/swarms` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/74c94648-694c-4060-8b1d-a05f5311a51c
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/45ad207a-5741-4fbb-bdd2-baef6cd0dbba

### `/agent-wallet` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/157d3aeb-4ce1-46c1-8c32-55afde727b97
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/c6ebf2f6-b99f-46cd-87cc-42b21b00c1e7

### `/wallet` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/662e1cf0-5017-400d-8d7b-9ae6436d8a2f
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/f218e2e7-ef3c-4346-86c4-33cd9e22398e

### `/trading` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/bb6bca22-a20e-4efa-be62-59caba1fd3a2
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/87df92a8-3ae6-4952-855c-e12d6f2e1abd

### `/exit-lab` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/f57a2edd-2d0c-46f3-9311-eef2627774e1
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/1dc182ff-60d4-43ae-a8de-7ea9893f83a8

### `/pill` (crypto)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/b9817b92-a221-4ce5-a574-9659d272a8e9
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/675a445c-dc82-4cae-a66e-1a671c4e44df

### `/agents` (agent-tools)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/95622d49-737e-47a5-b19f-7a4d2742d637
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/365844f4-851a-4569-9af9-61c9465495a8

### `/spotlight` (agent-tools)
- **desktop**
  - console: Failed to load resource: net::ERR_FAILED
  - console: [agent-3d] boot failed TypeError: Failed to fetch
    at witnessFetch (http://localhost:41353/packages/witness/src/recorder.js:306:33)
    at eu.load (https://three.ws/agent-3d/latest/agent-3d.js:5:28780)
    at i3.load (https://three.ws/agent-3d/latest/agent-3d.js:4104:61420)
    at https://three.ws/agent-3d/latest/agent-3d.js:4526:18235
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/53583641-ebac-42f6-8a49-2bdeaf3f1385
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/bdee3817-4885-4056-9b3b-69b12b64a0c3
- **mobile**
  - console: Failed to load resource: net::ERR_FAILED
  - console: [agent-3d] boot failed TypeError: Failed to fetch
    at witnessFetch (http://localhost:41353/packages/witness/src/recorder.js:306:33)
    at eu.load (https://three.ws/agent-3d/latest/agent-3d.js:5:28780)
    at i3.load (https://three.ws/agent-3d/latest/agent-3d.js:4104:61420)
    at https://three.ws/agent-3d/latest/agent-3d.js:4526:18235

### `/ledger` (agent-tools)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/e0ff2e82-9ed1-47ba-83e2-f54f8e9b443f
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/c3ae9ffe-c06f-499c-8c73-cd08cb7638e6

### `/my-agents` (agent-tools)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/918e716e-532b-4c38-856a-51a5be5378e8
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/19c49d2e-d6cf-4c94-964a-9bf4dee7176c

### `/reputation` (agent-tools)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/dbfe7ea0-9b87-4818-89a5-771c5e893410
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/c924d1ff-2231-4abd-9405-1b13f2fbbf82

### `/reputation/market` (agent-tools)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/d60dec18-aedb-42cc-9f3b-7c3db829cfed
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/86543853-9336-4340-96f9-b3393828e41e

### `/preflight` (agent-tools)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/8f518db3-a96a-4ef6-ab81-0d44a1649eec
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/afb09a82-61ac-49b8-8287-87f6dc7941b3

### `/credits` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/8f0d76ee-1ce9-45c1-b6b9-d676625f1724
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/d3b3ffe3-5619-4a07-8243-16568e233afa

### `/payments` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/cc6198bc-4466-4665-b819-a6dafdd2861d
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/869fb4f9-5bf0-4141-a37f-4ee5a65fba9e

### `/pay/simulator` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/65565d0a-1d71-47a8-a862-e46fe5b1c368
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/a7a7c5a8-076d-44ed-938d-5917dda29f2c

### `/login` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/4d221ce7-b6a8-4ac7-a98b-fb87d9e74b56
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/d3135edc-05d3-4c71-81e7-1a9de1eb0d80

### `/dashboard` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/c9bf737d-08e2-4d0e-92a6-635ed9f03462
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/664eba40-1f4a-42dd-9fda-2f5ec00ab44f

### `/dashboard/account` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/972d9f64-afd7-4419-9ed1-d318ec24e43a
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/5a4cde71-1485-49b9-80af-f3f7c4072ea3

### `/dashboard/data-api` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/98e6df87-da95-4198-bbbb-92dab26fb4ff
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/76e99855-79ff-45a8-9fa7-a07cfedc3a58

### `/dashboard/billing` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/1cff3171-97b6-4300-ba15-eb3e54bd268f
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/862e9e28-6512-4de9-93ed-7096350aa028

### `/dashboard/settings` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/09ae23bc-adf6-472f-babe-f88091640bc5
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/0e8e5ff3-554f-47ba-8514-35807e1503a3

### `/settings` (account)
- **desktop**
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/23f88924-ad85-45c1-b25c-0006b27c8b9c
  - console: THREE.GLTFLoader: Couldn't load texture blob:http://localhost:41353/97c81c4a-119a-4e68-ab91-6fe011f3a0c2


## Warnings (detail)

### `/clash` (crypto)
- clash: CoinCommunities unconfigured, polling stopped Error: CoinCommunities is not configured
    at apiFetch (http://localhost:41353/src/clash.js:94:33)
    at async poll (http://localhost:41353/src/clash.js:301:16)

### `/markets/robinhood/portfolios` (crypto)
- [portfolios] stats unavailable: not_found


---

# Second pass, 2026-09-09 afternoon

The morning sweep above ran on a box carrying another agent's build (load 80 to
100 throughout). Every one of its 31 failing routes was re-measured serially
against a dedicated dev server, and the picture changed: **29 of the 31 are
clean, one was a real defect now fixed, and the two that remain are unshipped
commits rather than page code.**

Production at the time of this pass served `880bdcef8` (revision
`three-ws-api-00420`), which is well ahead of every fix the earlier work order
was waiting on. Confirmed live: `/api/healthz` 200, `/api/status` 200,
`/api/home` 401 signed out (as designed), `/api/oracle/model` 200,
`/api/img?...&fallback=none` 204, and `access-control-allow-origin: *` on
`/x402.js`, `/i18n.js` and `/ibm/hello.live`. The four deploy-lag rows that
order tracked have all cleared.

## Re-measured

| Routes | Morning reading | Second pass |
|---|---|---|
| 22 routes reporting `THREE.GLTFLoader: Couldn't load texture blob:` (`/agents`, `/wallet`, `/trading`, `/pill`, `/exit-lab`, `/swarms`, `/event`, `/reputation`, `/reputation/market`, `/preflight`, `/ledger`, `/my-agents`, `/spotlight`, `/credits`, `/payments`, `/pay/simulator`, `/login`, `/settings`, `/dashboard`, `/dashboard/account`, `/dashboard/data-api`, `/dashboard/billing`, `/dashboard/settings`) | 2 errors each | **Clean.** Every one of them passed on a quiet box. The footer avatar these pages share (`src/footer-bot.js` loading `/animations/robotexpressive.glb`) carries no textures at all, so no texture in that asset can fail; the failures were a contended box losing texture fetches, which the serial retry could not clear because the retry ran while the same build was still going. |
| `/spotlight` `[agent-3d] boot failed TypeError: Failed to fetch` | 1 error | **Clean.** The `<agent-3d>` bundle is loaded from `https://three.ws` and its fetch was refused under the same contention. |
| `/markets`, `/markets/news`, `/markets/robinhood/desk`, `/markets/robinhood/portfolios`, `/markets/robinhood/portfolios/universe` | 404s | **Real defect, fixed** (see below). |
| `/globe` | 404 | **Unshipped, not a defect.** The whole `/globe` surface landed in `855a33ad3` at 22:43 on 2026-09-08; production was built at 18:57 the same day. `/api/globe/intel?range=7d` answers 404 in production and 200 against this tree. |
| `/ibm/hello` | 2 CORS errors | **Unshipped, not a defect.** `f49cd1a04` (07:17 today) grants `/atlas/(.+)\.js` open CORS. This tree answers `access-control-allow-origin: *` on `/atlas/score.js`; production answers no such header. |
| `/clash` warning | CoinCommunities unconfigured | **Still open, and still the owner's.** `CC_API_KEY` is in neither `.env` nor `.env.local`, and production `/api/clash/state` answers `503`. The page is fully wired behind the var and degrades as designed. A direct read of the service env was not possible this pass: `gcloud` needs an interactive reauth here. |

## The one real defect: a live news card cached as a dead 404

`/markets` and `/markets/news` logged 404s from `/api/news/image`. About a fifth
of the feed ships text-only, so those cards render a source-initials tile and
upgrade in place once the resolver finds the publisher's `og:image`
(`src/shared/news-render.js`). Reproduced against production: of the nine
imageless articles in a 20-article feed page, eight resolved and one answered
404, stably, for as long as the answer stayed cached.

Root cause: `findArticle` fanned out over all 197 registry feeds and raced them
against `REFRESH_DEADLINE_MS` (2.5s). On an instance whose cache was still cold
the straggler was dropped mid-refresh, so an article the feed had served seconds
earlier came back unknown. The card degraded correctly, but the browser logs the
404 before any handler runs, and the answer carried `s-maxage=600`, so one cold
instance pinned a console 404 on every reader for ten minutes. Adding a
cache-buster to the same URL returned `302` immediately, which is what proved it
was a cache-amplified transient rather than a genuine miss.

Measured on a cold process against the live feed, same article:

```
link  -> FOUND in 1730ms     (narrow path: refresh the one publisher)
id    -> MISS  in 2549ms     (broad path: the whole registry, deadline-truncated)
```

Fixed in `cbdd48fa2`. `findArticle` now asks the one feed that could hold a link
first, with the full timeout `getNews` already gives a narrow query, and only
then falls back to the broad scan; `sourceKeyForLink` maps a publisher host to
its source key off an index built from the registry's own feed URLs. A miss on a
host that IS one of ours is cached for 30s rather than the full window, because
it means the lookup could not confirm a card we almost certainly served.
Verified: `/markets`, `/markets/news` and `/markets/news/article` all clean with
the dev proxy pointed at this tree's own API server.

## Reading a sweep on a shared box

The serial retry (`c9deecba3`) clears a route that lost its settle window to a
momentary spike. It does not clear a route swept while a multi-minute build is
running, because the retry runs under the same load. Before trusting a failure
list, check the load and, if it is high, re-run the failures against a dev
server you started yourself once the box is quiet. Twenty-nine of the
thirty-one findings above were the box, not the code.
