# Console Sweep: 2026-09-07

Headless Chromium (Playwright) over 788 HTML routes from `data/pages.json` at desktop 1440×900 and mobile 390×844. Each route: `domcontentloaded` → scroll → 3000ms settle. Environment noise (Vite HMR-proxy wss handshake, third-party telemetry, auth-gated `/api` 4xx, dev-origin CDN CORS) is filtered.

**Result:** ❌ 9 route(s) with errors. 28 total error(s).

Routes that failed in the parallel pass are re-run once, serially, and the second reading is the one reported: desktop 779/788 cleared on the retry, mobile 1/4 cleared on the retry. A route that cleared was losing its settle window to load on a shared box, not failing.

## Per-route

| Route | Section | desktop err | desktop warn | mobile err | mobile warn |
|---|---|---|---|---|---|
| `/` | main | 1 | 0 | 0 | 0 |
| `/3d` | learn | 0 | 0 | 0 | 0 |
| `/activity` | crypto | 0 | 1 | 0 | 0 |
| `/agenc/embodied` | main | 0 | 0 | 0 | 0 |
| `/agenc/room` | main | 0 | 0 | 0 | 0 |
| `/agent-economy` | crypto | 0 | 0 | 0 | 0 |
| `/agent-economy-volume` | crypto | 0 | 1 | 0 | 0 |
| `/agent-exchange` | crypto | 0 | 0 | 0 | 0 |
| `/agent-identities` | agent-tools | 0 | 0 | 0 | 0 |
| `/agent-screen` | build | 0 | 0 | 0 | 0 |
| `/agent-studio` | build | 0 | 0 | 0 | 0 |
| `/agent-trade` | crypto | 0 | 0 | 0 | 0 |
| `/agent-wallet` | crypto | 0 | 1 | 0 | 0 |
| `/agents` | agent-tools | 0 | 1 | 0 | 0 |
| `/agents-live` | build | 0 | 0 | 0 | 0 |
| `/agi` | crypto | 0 | 1 | 0 | 0 |
| `/agora` | build | 0 | 0 | 0 | 0 |
| `/airdrops` | crypto | 0 | 1 | 0 | 1 |
| `/alpha-copilot` | main | 1 | 0 | 1 | 1 |
| `/animations` | main | 0 | 0 | 0 | 0 |
| `/app` | build | 0 | 0 | 0 | 0 |
| `/ar` | labs | 0 | 0 | 0 | 0 |
| `/ar/studio` | labs | 0 | 0 | 0 | 0 |
| `/ar/view` | labs | 0 | 0 | 0 | 0 |
| `/arbitrage` | crypto | 0 | 1 | 0 | 1 |
| `/arena` | crypto | 0 | 1 | 0 | 0 |
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
| `/avatar-sdk` | build | 0 | 1 | 0 | 0 |
| `/avatar-studio` | build | 0 | 0 | 0 | 0 |
| `/avatar-wallet-chat` | crypto | 0 | 0 | 0 | 0 |
| `/aws` | learn | 0 | 0 | 0 | 0 |
| `/bazaar` | crypto | 0 | 1 | 0 | 1 |
| `/blog` | blog | 0 | 1 | 0 | 1 |
| `/blog/2500-new-animations` | blog | 0 | 0 | 0 | 1 |
| `/blog/3d-ai-crypto-convergence` | blog | 0 | 1 | 0 | 1 |
| `/blog/agent-3d-web-component` | blog | 0 | 0 | 0 | 1 |
| `/blog/agent-builder-studio-launch` | blog | 0 | 1 | 0 | 1 |
| `/blog/animation-emotion-control` | blog | 0 | 1 | 0 | 1 |
| `/blog/autonomous-trading-experiment` | blog | 0 | 1 | 0 | 1 |
| `/blog/concierge-3d-chat-widget` | blog | 0 | 1 | 0 | 1 |
| `/blog/first-autonomous-trade` | blog | 0 | 1 | 0 | 1 |
| `/blog/how-to-embed-3d-onchain-agents` | blog | 0 | 1 | 0 | 1 |
| `/blog/ibm-user-group-first-in-world-meetup-recap` | blog | 0 | 1 | 0 | 0 |
| `/blog/image-to-3d-on-nvidia-l4-and-blackwell` | blog | 0 | 1 | 0 | 0 |
| `/blog/inside-the-forge` | blog | 0 | 1 | 0 | 1 |
| `/blog/monetize-mcp-server-x402-paid-tools` | blog | 0 | 1 | 0 | 0 |
| `/blog/pumpfun-agent-payments-sdk` | blog | 0 | 1 | 0 | 1 |
| `/blog/real-time-voice-interaction` | blog | 0 | 1 | 0 | 1 |
| `/blog/see-your-3d-in-ar` | blog | 0 | 1 | 0 | 1 |
| `/blog/solana-wallet-integration` | blog | 0 | 1 | 0 | 1 |
| `/blog/text-to-3d-is-live` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-token-listings` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-alibaba-cloud-partnership` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-aws-partner` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-dextools-social-boost-buyback` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-featured-on-alibaba-cloud-marketplace-blog` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-google-cloud-partnership` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-hackernoon-partnership` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-ibm-business-partner` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-ibm-collaboration` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-on-alibaba-cloud-marketplace` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-on-anthropic-mcp-registry` | blog | 0 | 1 | 0 | 0 |
| `/blog/three-ws-on-aws-marketplace` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-on-bnb-chain-dappbay` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-on-coinmarketcap` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-openai-select-partner` | blog | 0 | 1 | 0 | 0 |
| `/blog/three-ws-play-coin-communities` | blog | 0 | 0 | 0 | 0 |
| `/blog/three-ws-quicknode-startup-program` | blog | 0 | 1 | 0 | 1 |
| `/blog/three-ws-speraxusd-integration` | blog | 0 | 0 | 0 | 1 |
| `/blog/three-ws-x402-bazaar` | blog | 0 | 1 | 0 | 1 |
| `/blog/x402-stripe-for-agent-payments` | blog | 0 | 1 | 0 | 1 |
| `/bnb` | crypto | 0 | 1 | 0 | 1 |
| `/bnb-latency` | crypto | 0 | 1 | 0 | 1 |
| `/brain` | labs | 0 | 1 | 0 | 0 |
| `/brownout` | learn | 0 | 1 | 0 | 1 |
| `/bundles` | build | 0 | 1 | 0 | 0 |
| `/ca2x402` | build | 0 | 0 | 0 | 0 |
| `/capture` | build | 0 | 0 | 0 | 0 |
| `/categories` | crypto | 0 | 1 | 0 | 1 |
| `/cert` | crypto | 0 | 1 | 0 | 0 |
| `/chains` | crypto | 0 | 1 | 0 | 1 |
| `/changelog` | learn | 0 | 1 | 0 | 0 |
| `/character-library` | main | 0 | 0 | 0 | 0 |
| `/characters` | main | 0 | 0 | 0 | 0 |
| `/chat` | agent-tools | 0 | 0 | 0 | 0 |
| `/choreograph` | main | 0 | 0 | 0 | 0 |
| `/claim-wallet` | crypto | 0 | 1 | 0 | 0 |
| `/clash` | crypto | 0 | 2 | 0 | 2 |
| `/clip-director` | crypto | 0 | 1 | 0 | 0 |
| `/club` | crypto | 0 | 0 | 0 | 0 |
| `/coin-intel` | crypto | 0 | 1 | 0 | 1 |
| `/coin3d` | crypto | 0 | 0 | 0 | 0 |
| `/coins` | crypto | 0 | 1 | 0 | 0 |
| `/collection` | main | 0 | 0 | 0 | 0 |
| `/communities` | crypto | 0 | 0 | 0 | 0 |
| `/community` | main | 0 | 0 | 0 | 0 |
| `/companion` | main | 0 | 0 | 0 | 0 |
| `/compare` | crypto | 0 | 1 | 0 | 1 |
| `/compose` | build | 0 | 0 | 0 | 0 |
| `/concierge` | main | 0 | 0 | 0 | 0 |
| `/constellation` | crypto | 0 | 0 | 0 | 0 |
| `/conversions` | main | 0 | 0 | 0 | 0 |
| `/converter` | crypto | 0 | 1 | 0 | 1 |
| `/cookbook` | learn | 0 | 1 | 0 | 1 |
| `/cookbook/asset-quality-gate` | learn | 0 | 1 | 0 | 1 |
| `/cookbook/mcp-3d-tool` | learn | 0 | 1 | 0 | 1 |
| `/cookbook/parallel-asset-pack` | learn | 0 | 1 | 0 | 1 |
| `/cookbook/self-correcting-3d` | learn | 0 | 0 | 0 | 0 |
| `/cookbook/text-to-3d-cli` | learn | 0 | 1 | 0 | 1 |
| `/cosmos` | build | 0 | 0 | 0 | 0 |
| `/create` | build | 0 | 0 | 0 | 0 |
| `/create-agent` | build | 0 | 0 | 0 | 0 |
| `/create/prompt` | build | 0 | 0 | 0 | 0 |
| `/create/selfie` | build | 0 | 0 | 0 | 0 |
| `/create/video` | main | 0 | 0 | 0 | 0 |
| `/creations` | crypto | 0 | 1 | 0 | 0 |
| `/credits` | account | 0 | 1 | 0 | 0 |
| `/crews` | main | 0 | 0 | 0 | 0 |
| `/crypto` | learn | 0 | 1 | 0 | 0 |
| `/crypto-api` | learn | 0 | 1 | 0 | 0 |
| `/cz` | labs | 0 | 1 | 0 | 0 |
| `/dad` | build | 0 | 0 | 0 | 0 |
| `/daily` | labs | 0 | 0 | 0 | 0 |
| `/daily-match` | labs | 0 | 1 | 0 | 0 |
| `/dashboard` | account | 0 | 1 | 0 | 0 |
| `/dashboard/account` | account | 0 | 1 | 0 | 0 |
| `/dashboard/billing` | account | 0 | 1 | 0 | 0 |
| `/dashboard/capabilities` | crypto | 0 | 1 | 0 | 0 |
| `/dashboard/data-api` | account | 0 | 1 | 0 | 0 |
| `/dashboard/settings` | account | 0 | 1 | 0 | 0 |
| `/defi` | crypto | 0 | 1 | 0 | 1 |
| `/demo` | crypto | 0 | 0 | 0 | 0 |
| `/demos` | main | 0 | 0 | 0 | 0 |
| `/demos/agents` | main | 0 | 0 | 0 | 0 |
| `/deploy-onchain` | crypto | 0 | 1 | 0 | 1 |
| `/deployments` | crypto | 0 | 1 | 0 | 1 |
| `/derivatives` | crypto | 0 | 1 | 0 | 1 |
| `/dex-volumes` | crypto | 0 | 1 | 0 | 1 |
| `/diff` | build | 0 | 1 | 0 | 0 |
| `/diorama` | main | 0 | 0 | 0 | 0 |
| `/discover` | main | 1 | 0 | 0 | 0 |
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
| `/docs/walk` | learn | 0 | 1 | 0 | 0 |
| `/docs/walk-leaderboard` | learn | 0 | 0 | 0 | 0 |
| `/docs/web-component` | learn | 0 | 0 | 0 | 0 |
| `/docs/widget-api` | learn | 0 | 0 | 0 | 0 |
| `/docs/widget-studio` | learn | 0 | 0 | 0 | 0 |
| `/docs/widgets` | learn | 0 | 1 | 0 | 1 |
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
| `/drops` | crypto | 0 | 1 | 0 | 0 |
| `/economy` | crypto | 0 | 1 | 0 | 1 |
| `/economy-lab` | labs | 0 | 1 | 0 | 0 |
| `/embed-doctor` | build | 0 | 0 | 0 | 0 |
| `/eth-vanity` | crypto | 0 | 1 | 0 | 0 |
| `/event` | crypto | 0 | 1 | 0 | 0 |
| `/events/build-3d-agents-live` | learn | 0 | 1 | 0 | 1 |
| `/evm-wallet` | crypto | 0 | 1 | 0 | 0 |
| `/examples` | learn | 0 | 1 | 0 | 0 |
| `/exchanges` | crypto | 0 | 1 | 0 | 1 |
| `/exit-lab` | crypto | 0 | 1 | 0 | 0 |
| `/fact-check` | crypto | 0 | 1 | 0 | 1 |
| `/fact-checker` | crypto | 0 | 0 | 0 | 0 |
| `/fear-greed` | crypto | 0 | 1 | 0 | 1 |
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
| `/fees` | crypto | 0 | 1 | 0 | 1 |
| `/fits` | crypto | 0 | 1 | 0 | 0 |
| `/flow` | crypto | 0 | 0 | 0 | 0 |
| `/forever` | crypto | 0 | 1 | 0 | 0 |
| `/forge` | build | 0 | 0 | 0 | 0 |
| `/forge-max` | build | 0 | 0 | 0 | 0 |
| `/forge-nim` | build | 0 | 0 | 0 | 0 |
| `/forge-spark` | build | 0 | 0 | 0 | 0 |
| `/forge-studio` | build | 0 | 0 | 0 | 0 |
| `/forged` | main | 0 | 0 | 0 | 0 |
| `/forgot-password` | account | 0 | 0 | 0 | 0 |
| `/galaxy` | labs | 0 | 1 | 0 | 1 |
| `/gallery` | main | 0 | 0 | 0 | 0 |
| `/gas` | crypto | 0 | 1 | 0 | 1 |
| `/genesis` | build | 0 | 0 | 0 | 0 |
| `/genome` | build | 0 | 0 | 0 | 0 |
| `/gestures` | main | 0 | 0 | 0 | 0 |
| `/ghost-copy` | crypto | 0 | 1 | 0 | 1 |
| `/glance` | build | 0 | 0 | 0 | 0 |
| `/glossary` | learn | 0 | 1 | 0 | 0 |
| `/gmgn` | crypto | 0 | 1 | 0 | 1 |
| `/go` | crypto | 0 | 0 | 0 | 0 |
| `/guardian` | crypto | 0 | 1 | 0 | 1 |
| `/guards` | learn | 0 | 1 | 0 | 1 |
| `/hacks` | crypto | 0 | 1 | 0 | 1 |
| `/heatmap` | crypto | 0 | 1 | 0 | 1 |
| `/herald` | main | 0 | 0 | 0 | 0 |
| `/hero-demo` | crypto | 0 | 0 | 0 | 0 |
| `/holo` | labs | 0 | 1 | 0 | 0 |
| `/hydrate` | build | 0 | 0 | 0 | 0 |
| `/ibm/hello` | crypto | 4 | 0 | 4 | 0 |
| `/ibm/x402-demo` | crypto | 0 | 0 | 0 | 0 |
| `/image-to-3d` | build | 0 | 0 | 0 | 0 |
| `/import/rpm` | build | 0 | 0 | 0 | 0 |
| `/inspect` | build | 0 | 0 | 0 | 0 |
| `/integrations` | build | 0 | 0 | 0 | 0 |
| `/irl` | main | 0 | 0 | 0 | 0 |
| `/irl-privacy` | main | 0 | 0 | 0 | 0 |
| `/irl/sign` | main | 1 | 0 | 0 | 0 |
| `/knock` | main | 0 | 0 | 0 | 0 |
| `/labor-market` | crypto | 0 | 1 | 0 | 0 |
| `/labs` | labs | 0 | 0 | 0 | 0 |
| `/launch` | crypto | 0 | 1 | 0 | 0 |
| `/launch-studio` | crypto | 0 | 1 | 0 | 0 |
| `/launcher` | crypto | 0 | 0 | 0 | 0 |
| `/launches` | crypto | 0 | 0 | 0 | 0 |
| `/launchpad` | labs | 0 | 0 | 0 | 0 |
| `/leaderboard` | crypto | 0 | 1 | 0 | 0 |
| `/ledger` | agent-tools | 0 | 1 | 0 | 0 |
| `/legal` | legal | 0 | 1 | 0 | 0 |
| `/legal/content-policy` | legal | 0 | 1 | 0 | 1 |
| `/legal/eula` | legal | 0 | 1 | 0 | 1 |
| `/legal/nvidia-ngc-eula` | legal | 0 | 1 | 0 | 1 |
| `/legal/privacy` | legal | 0 | 1 | 0 | 1 |
| `/legal/risk` | legal | 0 | 1 | 0 | 1 |
| `/legal/tos` | legal | 0 | 1 | 0 | 0 |
| `/lipsync` | labs | 0 | 1 | 0 | 1 |
| `/lipsync/mic` | labs | 0 | 1 | 0 | 0 |
| `/live` | crypto | 0 | 0 | 0 | 0 |
| `/login` | account | 0 | 1 | 0 | 0 |
| `/lookup` | crypto | 0 | 1 | 0 | 1 |
| `/marketplace` | main | 0 | 0 | 0 | 0 |
| `/marketplace/analytics` | main | 0 | 0 | 0 | 0 |
| `/markets` | crypto | 0 | 1 | 0 | 0 |
| `/markets/archive` | crypto | 0 | 1 | 0 | 0 |
| `/markets/digest` | crypto | 0 | 1 | 0 | 0 |
| `/markets/news` | crypto | 1 | 1 | 0 | 0 |
| `/markets/news/article` | crypto | 0 | 1 | 0 | 0 |
| `/markets/robinhood` | crypto | 0 | 1 | 0 | 0 |
| `/markets/trending` | crypto | 0 | 1 | 0 | 1 |
| `/materialize` | build | 0 | 0 | 0 | 0 |
| `/mcp-tools` | learn | 0 | 1 | 0 | 1 |
| `/meta-allocator` | crypto | 0 | 1 | 0 | 0 |
| `/minted` | crypto | 0 | 1 | 0 | 1 |
| `/mirror` | crypto | 0 | 1 | 0 | 0 |
| `/mocap-studio` | main | 0 | 0 | 0 | 0 |
| `/monitor` | build | 0 | 0 | 0 | 0 |
| `/motion-swap` | build | 0 | 0 | 0 | 0 |
| `/my-agents` | agent-tools | 0 | 1 | 0 | 0 |
| `/news` | learn | 0 | 0 | 0 | 0 |
| `/nim-forge` | build | 0 | 0 | 0 | 0 |
| `/notifications` | main | 0 | 0 | 0 | 0 |
| `/nvidia` | main | 0 | 0 | 0 | 0 |
| `/objects` | main | 0 | 0 | 0 | 0 |
| `/openai` | main | 0 | 0 | 0 | 0 |
| `/oracle` | crypto | 0 | 1 | 0 | 0 |
| `/oracle-lab` | crypto | 0 | 0 | 0 | 0 |
| `/oracle/arm` | crypto | 0 | 1 | 0 | 1 |
| `/oracle/docs` | crypto | 0 | 1 | 0 | 0 |
| `/partners` | main | 0 | 0 | 0 | 0 |
| `/pay` | crypto | 0 | 1 | 0 | 0 |
| `/pay/simulator` | account | 0 | 1 | 0 | 0 |
| `/payments` | account | 0 | 1 | 0 | 0 |
| `/pill` | crypto | 0 | 1 | 0 | 0 |
| `/pipeline` | crypto | 0 | 1 | 0 | 0 |
| `/pitch` | main | 0 | 0 | 0 | 0 |
| `/play` | crypto | 0 | 0 | 0 | 0 |
| `/play/agent-wallet` | crypto | 0 | 0 | 0 | 0 |
| `/play/arena` | crypto | 0 | 0 | 0 | 0 |
| `/play/economy` | crypto | 0 | 0 | 0 | 0 |
| `/play/solver` | crypto | 0 | 0 | 0 | 0 |
| `/play/ufo` | crypto | 0 | 0 | 0 | 0 |
| `/play/war` | crypto | 0 | 0 | 0 | 0 |
| `/playground` | labs | 0 | 0 | 0 | 0 |
| `/pocket` | labs | 0 | 1 | 0 | 0 |
| `/portal` | main | 0 | 0 | 0 | 0 |
| `/portfolio` | crypto | 0 | 1 | 0 | 1 |
| `/pose` | build | 0 | 0 | 0 | 0 |
| `/preflight` | agent-tools | 0 | 1 | 0 | 0 |
| `/press` | main | 0 | 0 | 0 | 0 |
| `/pricing` | main | 0 | 0 | 0 | 0 |
| `/profile` | account | 0 | 1 | 0 | 0 |
| `/proof` | crypto | 0 | 1 | 0 | 0 |
| `/providers` | crypto | 0 | 1 | 0 | 1 |
| `/pulse` | crypto | 0 | 1 | 0 | 1 |
| `/pump-dashboard` | crypto | 0 | 0 | 0 | 1 |
| `/pump-live` | crypto | 0 | 0 | 0 | 0 |
| `/pump-visualizer` | crypto | 0 | 1 | 0 | 0 |
| `/pumpfun` | crypto | 0 | 1 | 0 | 0 |
| `/radar` | crypto | 0 | 0 | 0 | 0 |
| `/rankings` | labs | 0 | 1 | 0 | 1 |
| `/receipts` | crypto | 0 | 1 | 0 | 0 |
| `/recurring` | crypto | 0 | 1 | 0 | 1 |
| `/register` | account | 0 | 0 | 0 | 0 |
| `/render-lab` | build | 0 | 1 | 0 | 1 |
| `/reputation` | agent-tools | 0 | 1 | 0 | 0 |
| `/reputation/market` | agent-tools | 0 | 1 | 0 | 0 |
| `/restyle` | build | 0 | 0 | 0 | 0 |
| `/rig-doctor` | build | 0 | 1 | 0 | 0 |
| `/scene` | build | 0 | 0 | 0 | 0 |
| `/screener` | crypto | 0 | 1 | 0 | 1 |
| `/search` | main | 0 | 0 | 0 | 0 |
| `/seeker` | build | 0 | 0 | 0 | 0 |
| `/settings` | account | 0 | 1 | 0 | 0 |
| `/ship` | learn | 0 | 1 | 0 | 1 |
| `/shopper` | crypto | 0 | 0 | 0 | 0 |
| `/showcase` | main | 0 | 0 | 0 | 0 |
| `/sign-language` | main | 0 | 0 | 0 | 0 |
| `/sign-mirror` | main | 0 | 0 | 0 | 0 |
| `/signals` | crypto | 0 | 1 | 0 | 1 |
| `/sitemap` | main | 0 | 0 | 0 | 0 |
| `/skills` | main | 0 | 0 | 0 | 0 |
| `/smart-home` | build | 0 | 0 | 0 | 0 |
| `/smart-home/join` | build | 0 | 0 | 0 | 0 |
| `/smart-home/plan` | build | 0 | 0 | 0 | 0 |
| `/smart-home/privacy` | build | 0 | 0 | 0 | 0 |
| `/smart-home/satellite` | build | 0 | 0 | 0 | 0 |
| `/smart-money` | crypto | 0 | 1 | 0 | 1 |
| `/sniper/experiments` | crypto | 0 | 1 | 0 | 0 |
| `/spatial-mcp` | labs | 1 | 0 | 1 | 0 |
| `/sperax` | crypto | 0 | 1 | 0 | 0 |
| `/splat` | build | 0 | 0 | 0 | 0 |
| `/spotlight` | agent-tools | 2 | 1 | 0 | 0 |
| `/stablecoins` | crypto | 0 | 1 | 0 | 1 |
| `/stage` | crypto | 0 | 0 | 0 | 0 |
| `/start` | build | 0 | 0 | 0 | 0 |
| `/status` | learn | 0 | 1 | 0 | 0 |
| `/strategies` | crypto | 0 | 1 | 0 | 0 |
| `/strategy-lab` | crypto | 0 | 1 | 0 | 1 |
| `/stream` | build | 0 | 1 | 0 | 1 |
| `/studio` | build | 0 | 0 | 0 | 0 |
| `/support` | learn | 0 | 0 | 0 | 0 |
| `/swarms` | crypto | 0 | 1 | 0 | 0 |
| `/symphony` | labs | 0 | 1 | 0 | 1 |
| `/temporary` | main | 10 | 0 | 0 | 0 |
| `/terminal` | crypto | 0 | 0 | 0 | 0 |
| `/theater` | crypto | 0 | 0 | 0 | 0 |
| `/three` | crypto | 0 | 1 | 0 | 1 |
| `/three-live` | crypto | 0 | 1 | 0 | 1 |
| `/three-token` | crypto | 0 | 0 | 0 | 0 |
| `/threews/claim` | build | 0 | 0 | 0 | 0 |
| `/timeline` | main | 0 | 0 | 0 | 0 |
| `/tour` | main | 0 | 0 | 0 | 0 |
| `/tour-builder` | learn | 0 | 0 | 0 | 0 |
| `/tour/atlas` | main | 0 | 0 | 0 | 0 |
| `/tracker` | crypto | 0 | 1 | 0 | 0 |
| `/trades` | crypto | 0 | 1 | 0 | 1 |
| `/trading` | crypto | 0 | 1 | 0 | 0 |
| `/trending` | crypto | 0 | 1 | 0 | 1 |
| `/tty` | build | 0 | 1 | 0 | 1 |
| `/tutor` | crypto | 0 | 1 | 0 | 1 |
| `/tutorials` | learn | 0 | 1 | 0 | 1 |
| `/tutorials/add-a-3d-assistant` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/agent-personality` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/agent-reputation` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/agent-spending-envelope` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/animate-your-agent` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/animate-your-avatar` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/arm-an-agent-sniper` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/build-a-3d-asset-pipeline` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/build-a-scene` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/build-a-site-concierge` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/character-library-to-embed` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/claim-threews-name` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/connect-ai-brain` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/connect-your-home` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/create-and-edit-memory` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/custom-skill` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/customize-appearance` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/deploy-to-vercel-custom-domain` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/earn-and-spend-in-play` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/embed-in-30-seconds` | learn | 0 | 0 | 0 | 1 |
| `/tutorials/embed-on-website` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/emotion-from-data` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/explore-docs-world` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/find-a-better-exit-policy` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/first-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/first-prompt-to-3d` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/generate-3d-api` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/getting-started` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/greeting-and-first-speech` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/image-to-3d` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/import-avatar-url` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/js-api-events` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/mcp-server-for-your-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/mine-vanity-address` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/mint-pumpfun-token` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/monetize-mcp-server` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/multi-agent-coordination` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/nvidia-3d-free` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/nvidia-nim-self-host` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/paid-x402-endpoint` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/pay-for-x402-service` | learn | 0 | 1 | 0 | 1 |
| `/tutorials/personal-ai-site` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/place-agent-irl` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/prompts-for-3d` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/read-the-trading-fleet` | learn | 0 | 1 | 0 | 1 |
| `/tutorials/register-onchain` | learn | 0 | 1 | 0 | 1 |
| `/tutorials/render-avatar-images` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/self-host-agent-backend` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/selfie-to-avatar` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/sell-a-skill-with-a-trial` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/share-your-agent` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/ship-an-avatar-manifest` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/shopify-shopping-assistant` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/shopify-store-guide` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/shopify-store-guide-advanced` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/sign-with-your-avatar` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/skill-with-database-auth` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/solana-agent-reputation` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/sperax-tour` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/swap-avatar-in-studio` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/text-to-3d` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/trigger-from-page-events` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/upload-custom-glb` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/view-in-ar` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/voice-and-lipsync` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/walk-companion` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/wallet-sign-in` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/web-component-end-to-end` | learn | 0 | 1 | 0 | 0 |
| `/tutorials/write-a-guard` | learn | 0 | 0 | 0 | 0 |
| `/tutorials/x402-server-sdk` | learn | 0 | 1 | 0 | 0 |
| `/unstoppable` | crypto | 0 | 0 | 0 | 0 |
| `/validation` | build | 0 | 0 | 0 | 0 |
| `/vanity-wallet` | crypto | 0 | 1 | 0 | 1 |
| `/vanity/bounties` | crypto | 0 | 1 | 0 | 1 |
| `/vanity/gallery` | crypto | 0 | 1 | 0 | 1 |
| `/vanity/premium` | crypto | 0 | 1 | 0 | 1 |
| `/vanity/verify` | crypto | 0 | 1 | 0 | 1 |
| `/vault` | crypto | 0 | 1 | 0 | 1 |
| `/vaults` | crypto | 0 | 1 | 0 | 0 |
| `/viability` | crypto | 0 | 1 | 0 | 0 |
| `/viewer` | labs | 0 | 0 | 0 | 0 |
| `/voice` | build | 0 | 0 | 0 | 0 |
| `/voice/home` | build | 0 | 0 | 0 | 0 |
| `/walk` | main | 0 | 0 | 0 | 0 |
| `/walk-leaderboard` | labs | 0 | 1 | 0 | 0 |
| `/walkthroughs` | learn | 0 | 1 | 0 | 1 |
| `/walkthroughs/build-your-first-agent` | learn | 0 | 1 | 0 | 0 |
| `/walkthroughs/embed-a-3d-avatar` | learn | 0 | 1 | 0 | 0 |
| `/walkthroughs/find-an-agent-worth-using` | learn | 0 | 1 | 0 | 0 |
| `/walkthroughs/forge-your-first-3d-model` | learn | 0 | 1 | 0 | 1 |
| `/wallet` | crypto | 0 | 1 | 0 | 0 |
| `/wardrobe` | main | 0 | 0 | 0 | 0 |
| `/watch` | labs | 0 | 0 | 0 | 0 |
| `/watchlist` | crypto | 0 | 0 | 0 | 1 |
| `/what-is` | main | 0 | 0 | 0 | 0 |
| `/widgets` | build | 0 | 0 | 0 | 0 |
| `/world-lines` | main | 0 | 0 | 0 | 0 |
| `/wrapped` | crypto | 0 | 1 | 0 | 0 |
| `/x402` | crypto | 0 | 0 | 0 | 0 |
| `/x402/studio` | crypto | 0 | 0 | 0 | 0 |
| `/yields` | crypto | 0 | 1 | 0 | 1 |

## Failures (detail)

### `/` (main)
- **desktop**
  - nav: navigation failed: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:43521/
Call log:
  - navigating to "http://localhost:43521/", waiting until "domcontentloaded"


### `/discover` (main)
- **desktop**
  - nav: navigation failed: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:43521/discover
Call log:
  - navigating to "http://localhost:43521/discover", waiting until "domcontentloaded"


### `/temporary` (main)
- **desktop**
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
  - console: Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin

### `/irl/sign` (main)
- **desktop**
  - nav: navigation failed: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "http://localhost:43521/irl/sign", waiting until "domcontentloaded"


### `/alpha-copilot` (main)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)
- **mobile**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/spatial-mcp` (labs)
- **desktop**
  - console: $l: fetch for "https://three.ws/cdn/forge/anon/eddcea57-a278-474a-a632-99ca99861755.glb" responded with 502: 
    at https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js:17:507206
- **mobile**
  - console: $l: fetch for "https://three.ws/cdn/forge/anon/eddcea57-a278-474a-a632-99ca99861755.glb" responded with 502: 
    at https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js:17:507206

### `/ibm/hello` (crypto)
- **desktop**
  - console: Access to script at 'https://three.ws/ios-bridge.72176eee.js' from origin 'http://localhost:43521' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED
  - console: Access to script at 'https://three.ws/atlas.js' from origin 'http://localhost:43521' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED
- **mobile**
  - console: Access to script at 'https://three.ws/ios-bridge.72176eee.js' from origin 'http://localhost:43521' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED
  - console: Access to script at 'https://three.ws/atlas.js' from origin 'http://localhost:43521' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - console: Failed to load resource: net::ERR_FAILED

### `/markets/news` (crypto)
- **desktop**
  - console: Failed to load resource: the server responded with a status of 404 (Not Found)

### `/spotlight` (agent-tools)
- **desktop**
  - console: Failed to load resource: net::ERR_FAILED
  - console: [agent-3d] boot failed TypeError: Failed to fetch
    at witnessFetch (http://localhost:43521/packages/witness/src/recorder.js:271:33)
    at eu.load (https://three.ws/agent-3d/latest/agent-3d.js:5:28780)
    at i3.load (https://three.ws/agent-3d/latest/agent-3d.js:4104:61420)
    at https://three.ws/agent-3d/latest/agent-3d.js:4526:18235


## Warnings (detail)

### `/alpha-copilot` (main)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/avatar-sdk` (build)
- RGBELoader has been deprecated. Please use HDRLoader instead.

### `/render-lab` (build)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/diff` (build)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/rig-doctor` (build)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/bundles` (build)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tty` (build)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/stream` (build)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/brain` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/lipsync` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/lipsync/mic` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/rankings` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/daily-match` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/walk-leaderboard` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/galaxy` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/symphony` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/economy-lab` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/holo` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cz` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pocket` (labs)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/sperax` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/agi` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/oracle` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/oracle/docs` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/oracle/arm` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/activity` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pipeline` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/guardian` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/launch` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/launch-studio` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/drops` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/minted` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cert` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/creations` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pulse` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/fits` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/receipts` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/viability` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/deployments` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/deploy-onchain` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/portfolio` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/airdrops` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/clash` (crypto)
- clash: CoinCommunities unconfigured, polling stopped Error: CoinCommunities is not configured
    at apiFetch (http://localhost:43521/src/clash.js:94:33)
    at async poll (http://localhost:43521/src/clash.js:301:16)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/leaderboard` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tracker` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/proof` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/labor-market` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vaults` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/signals` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dashboard/capabilities` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/arena` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/trending` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/trades` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/claim-wallet` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/ghost-copy` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/wrapped` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/meta-allocator` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/clip-director` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pay` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/sniper/experiments` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/smart-money` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pumpfun` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/watchlist` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pump-dashboard` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/strategy-lab` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/recurring` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/strategies` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vanity-wallet` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/fact-check` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vanity/verify` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vanity/gallery` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vanity/premium` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vanity/bounties` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/eth-vanity` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pump-visualizer` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/coin-intel` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/coins` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/heatmap` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/fear-greed` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/gas` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/compare` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/screener` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/categories` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/exchanges` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/derivatives` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/converter` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/defi` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/chains` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/stablecoins` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/yields` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/fees` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dex-volumes` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/hacks` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets/trending` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/bnb` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/bnb-latency` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/vault` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/bazaar` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/lookup` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/arbitrage` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/providers` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/gmgn` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/three` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/three-live` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutor` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/forever` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/economy` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/agent-economy-volume` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/evm-wallet` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets/robinhood` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets/news` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets/news/article` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets/archive` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/markets/digest` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/event` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/mirror` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/swarms` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/agent-wallet` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/wallet` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/trading` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/exit-lab` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pill` (crypto)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/agents` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/spotlight` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/ledger` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/my-agents` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/reputation` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/reputation/market` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/preflight` (agent-tools)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/credits` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/payments` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/pay/simulator` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/login` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dashboard` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dashboard/account` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dashboard/data-api` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dashboard/billing` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/dashboard/settings` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/settings` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/profile` (account)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/crypto` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/crypto-api` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/docs/walk` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/docs/widgets` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/walkthroughs` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/walkthroughs/forge-your-first-3d-model` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/walkthroughs/build-your-first-agent` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/walkthroughs/embed-a-3d-avatar` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/walkthroughs/find-an-agent-worth-using` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/examples` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/text-to-3d` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/build-a-3d-asset-pipeline` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/add-a-3d-assistant` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/image-to-3d` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/prompts-for-3d` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/generate-3d-api` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/nvidia-3d-free` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/nvidia-nim-self-host` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/first-prompt-to-3d` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/agent-reputation` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/solana-agent-reputation` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/shopify-shopping-assistant` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/shopify-store-guide` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/shopify-store-guide-advanced` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/status` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/glossary` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/events/build-3d-agents-live` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/changelog` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/ship` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/sign-with-your-avatar` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/build-a-scene` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/arm-an-agent-sniper` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cookbook` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cookbook/text-to-3d-cli` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cookbook/parallel-asset-pack` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cookbook/mcp-3d-tool` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/cookbook/asset-quality-gate` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/wallet-sign-in` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/character-library-to-embed` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/sell-a-skill-with-a-trial` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/find-a-better-exit-policy` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/read-the-trading-fleet` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/mcp-tools` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/embed-in-30-seconds` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/swap-avatar-in-studio` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/selfie-to-avatar` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/import-avatar-url` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/walk-companion` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/sperax-tour` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/embed-on-website` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/personal-ai-site` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/js-api-events` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/web-component-end-to-end` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/build-a-site-concierge` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/upload-custom-glb` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/create-and-edit-memory` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/place-agent-irl` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/pay-for-x402-service` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/emotion-from-data` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/register-onchain` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/mint-pumpfun-token` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/paid-x402-endpoint` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/monetize-mcp-server` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/x402-server-sdk` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/self-host-agent-backend` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/multi-agent-coordination` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/skill-with-database-auth` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/claim-threews-name` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/mine-vanity-address` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/guards` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/brownout` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/earn-and-spend-in-play` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/animate-your-agent` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/tutorials/connect-your-home` (learn)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/ibm-user-group-first-in-world-meetup-recap` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/image-to-3d-on-nvidia-l4-and-blackwell` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/monetize-mcp-server-x402-paid-tools` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-openai-select-partner` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/autonomous-trading-experiment` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/first-autonomous-trade` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/concierge-3d-chat-widget` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/inside-the-forge` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-quicknode-startup-program` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-alibaba-cloud-partnership` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/x402-stripe-for-agent-payments` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/see-your-3d-in-ar` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/text-to-3d-is-live` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/3d-ai-crypto-convergence` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-dextools-social-boost-buyback` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-featured-on-alibaba-cloud-marketplace-blog` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-ibm-collaboration` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-on-aws-marketplace` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/agent-3d-web-component` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/2500-new-animations` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-x402-bazaar` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/real-time-voice-interaction` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-on-alibaba-cloud-marketplace` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-on-bnb-chain-dappbay` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-hackernoon-partnership` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-on-coinmarketcap` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/how-to-embed-3d-onchain-agents` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/pumpfun-agent-payments-sdk` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-speraxusd-integration` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/agent-builder-studio-launch` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/animation-emotion-control` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-ibm-business-partner` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-token-listings` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/solana-wallet-integration` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-google-cloud-partnership` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/blog/three-ws-on-anthropic-mcp-registry` (blog)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal/privacy` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal/eula` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal/nvidia-ngc-eula` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal/tos` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal/risk` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

### `/legal/content-policy` (legal)
- [walk] avatar "81a076b6-55ff-49a2-b007-1d88e7dce2aa" failed to load - falling back to "robot" fetch for "http://localhost:43521/api/avatars/81a076b6-55ff-49a2-b007-1d88e7dce2aa/glb" responded with 502: Bad Gateway

