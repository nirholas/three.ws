---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, Technology, Security
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is written as plain paragraphs. Cover art: 640x360
  or that proportion, under 10 MB.
accuracy_notes: |
  Live figures (4,356 registered agents, 15,170 holders, pump.fun verification flag true)
  were read from https://three.ws/api/three-token/stats on 2026-10-08 and are labelled
  with that date. Every expected-attempt, median, and percentile figure for the 3ws
  prefix was computed on 2026-10-08 by running the repo's own exact Base58 model
  (src/solana/vanity/base58-distribution.js and validation.js: expectedAttempts,
  expectedAttemptsUniform, prefixProbability, caseVariants), then applying the geometric
  distribution. The 48,778 figure is presented only as the intuitive flat-model
  estimate that the exact model improves on. The 25,000 keypairs per second
  single-thread rate is the documented figure in docs/vanity.md, docs/mint-mark.md and
  src/solana/vanity/grinder-node.js, not a fresh benchmark; time estimates are derived
  from it. Leading-character bands and the 57,000 versus 3.3 million comparison come
  from docs/PROTOCOL-vanity.md section 4. Grinder mechanics (batch sizes, eight-worker
  default cap via DEFAULT_MAX_WORKERS, pause and resume, transferable secret buffer,
  45 second server budget via DEFAULT_TIME_BUDGET_MS, three-times feasibility margin)
  come from src/solana/vanity/grinder.js, grinder-worker.js, grinder-node.js and
  crates/vanity-grinder (src/lib.rs and README.md). Which surface grinds where was read
  from public/studio/launch-panel.js (mounted by /studio and src/avatar-page.js),
  src/pump/pump-modals.js, src/launch/launch-page.js (server-stamped),
  src/three-launchpad/page.js (server-stamped), src/agent-skills-pumpfun.js,
  api/pump/[action].js and api/native-launch/[action].js. Server-side launch reads use
  failoverConnection via solanaConnection in api/_lib/agent-pumpfun.js. Enforcement
  default, the mint_mark_stamped log line, the coin-buy feed event with its branded
  flag and the x402 launcher exemption come from docs/mint-mark.md and
  src/solana/vanity/brand.js. Launch-confirm checks come from docs/launchpad.md and
  docs/native-launchpad.md. Vanity tiers, prices, sealTo, the proof-of-grind
  certificate, inventory replenishment and delete-after-reveal come from docs/vanity.md;
  the commit-reveal protocol comes from docs/PROTOCOL-vanity.md. Partner designations
  are quoted exactly as docs/partners.md and docs/listings.md record them on
  2026-10-08: OpenAI Select Partner; IBM Business Partner (public /api/ibm tools are
  independent developer tools, and the article says so); AWS Partner with the
  Marketplace listing coming; member of Google Cloud for Web3 Startups; Alibaba Cloud
  International Marketplace listing live; NVIDIA Inception member; HackerNoon
  publishing partnership; accepted into the Quicknode Startup Program with approved
  free infrastructure credits. The pump.fun verification and the DEXTools surfaces on
  the /launch success screen, and the three DEXTools Social Boost wins (checked
  2026-09-18), come from docs/listings.md. No partner is presented as an
  endorser. Limitations recorded in the docs (the mark is a cheap prefix, enforcement
  can be switched off, which paths hold the mint secret server-side) are not narrated;
  the article describes the mark by what it provides and points to the launch records
  as the authoritative provenance, and it makes no claim that the mark alone proves
  origin. Page paths /launch, /launches, /three-launchpad, /studio, /vanity-wallet,
  /vanity/verify, /vanity/premium and /partners are all present in data/pages.json.
---

# CoinMarketCap article: the 3ws mint mark

Paste-ready for the CoinMarketCap form.

## Title (130 characters)

```
Why Every Coin Launched on three.ws Starts With 3ws: Inside the WebAssembly Grinder That Stamps a Brand Into a Solana Mint Address
```

## Meta description (178 characters)

```
Every three.ws coin mint begins with 3ws. See how a Rust and WebAssembly grinder finds that address in under a second, how it joins the launch, and how launch records confirm it.
```

## Body

---

Think about a personalised licence plate, or a phone number that spells a word. Most of the time the string of characters you are given is random. Once in a while, someone takes the trouble to pick one that means something, and suddenly you recognise it from across the street.

three.ws does that for every coin launched on the platform. Pull up any of those coins on a Solana explorer and look at the first three characters of its address. They spell 3ws. Sometimes it reads 3ws, sometimes 3WS, sometimes 3wS, but the mark is always there, right at the front.

Nobody typed it into a form, because on Solana you cannot simply choose an address. The mark is there because, just before every launch, a small and very fast piece of software tries thousands of brand new addresses, keeps the first one that starts with 3ws, and uses it for your coin. On most machines this takes well under a second, and creators do not have to do anything to get it.

This article explains the mark from both ends. The first part is for anyone curious: what the mark is, what you see when you launch a coin, and what it tells you when you spot one in the wild. The second part is for readers who enjoy the details: the byte-level structure of a Solana address, the probability math (which holds a pleasant surprise), the Rust engine compiled to WebAssembly, how the work is shared across processor cores, and how the chosen address flows into the launch transaction and the platform's records.

A quick introduction for anyone new. three.ws is an open-source platform for 3D AI agents: characters with a face, a voice, a personality, a wallet and a public page. Its coin is $THREE on Solana, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump. As of 2026-10-08 the public stats endpoint at three.ws/api/three-token/stats reports 4,356 registered agents, 15,170 holders, and a live pump.fun verification flag of true. Everything below is about the coins people launch on top of the platform, and every claim comes from the open-source code and docs.

## The mark in plain words

Every coin on Solana has an address, a long string of letters and numbers that identifies it, much like an account number identifies a bank account. Wallets, explorers, trading screens and launch feeds all use that address to tell one coin apart from another.

Normally the address is pure chance. It comes out of the same process that creates a new cryptographic key, and nobody can steer it. What you can do is make lots of keys, very quickly, and keep the one you like. That is called grinding, and it is how vanity addresses are made.

three.ws grinds an address that starts with 3ws for every coin launched through its branded flows. The result is a perfectly ordinary Solana address that happens to carry the platform's initials, the way a hand-made product carries the maker's stamp.

That small stamp gives everyone a useful shortcut. A creator gets a coin that looks like part of the three.ws family from day one. A trader scanning a busy feed can spot three.ws launches at a glance. And anyone who wants the full story can look the coin up in the platform's public launch records, which confirm exactly where and when it launched.

## What a creator sees

If you launch a coin from the Studio launch panel, the panel that also appears on an avatar's page, the stamp happens right in your browser. You fill in your coin's name, ticker, image and description and connect your wallet. As the launch begins, a short progress line appears with a live speed reading and an estimated time remaining. On most machines the stamp is finished before you have read the label.

The pump.fun launch modal on agent pages works the same way and tells you so in its copy. So does the launch skill an embedded agent runs inside a web page: it grinds the mark by default and accepts only marked mint addresses.

If you launch from the /launch page, from the native $THREE lane on /three-launchpad, or from an agent's own custodial wallet, the same engine runs on the three.ws server instead, so there is nothing for your device to do at all.

Either way there is nothing to configure, nothing to pay for the stamp and nothing to remember. Every branded launch comes out stamped.

## What a trader or explorer sees

The mark works anywhere a mint address is shown: block explorers, trading terminals, launch feeds, wallet screens. Because Solana addresses are otherwise indistinguishable strings, three characters at the front are enough to make three.ws coins easy to pick out in a long list, without fetching any metadata.

The platform's own surfaces use it as well. The live launch feed carries a branded flag on every confirmed launch, the shared bonding-curve views use the mark as a quick signal that a mainnet mint has a curve worth looking up, and the public feed at three.ws/launches lists every coin launched through the platform, each with its own page under three.ws/launches followed by its mint.

The mark and the records work as a pair. The mark is the instant visual cue; the launch records, written only after the server has read the confirmed transaction from the chain, are the authoritative answer to "did this coin launch through three.ws?". Native lane coins are listed in the directory on three.ws/three-launchpad.

All four capitalisations are equally genuine. Matching is deliberately case-insensitive, so a three.ws mint can begin 3ws, 3wS, 3Ws or 3WS, and each is just as authentic as the others.

From here on, the article goes under the hood.

## What a Solana mint address actually is

A Solana account address is an Ed25519 public key: 32 bytes. On an explorer you see those bytes written in Base58, an encoding with 58 symbols, the digits 1 to 9 plus upper and lower case Latin letters, with four easily confused characters left out: zero, capital O, capital I and lower case l. Leaving those four out is a small usability gift; it keeps addresses readable when copied by hand.

A token mint is an account like any other, and its address is the public key of a keypair generated for the occasion. That keypair has one job in a launch: it signs the transaction that creates the mint account. The three.ws launch code states this directly: the mint keypair must co-sign the transaction.

So a mint address is not assigned by a registry or chosen by a person. It is whatever public key comes out of the keypair the launcher generated, which is why controlling keypair generation is the way to shape the address.

## Searching, not choosing

An Ed25519 keypair starts from a 32 byte secret seed. The public key comes out of a fixed pipeline: hash the seed with SHA-512, take the first 32 bytes, clamp them into a valid scalar, multiply the curve's base point by that scalar, and compress the resulting point into 32 bytes. Those bytes are the public key, and their Base58 encoding is the address.

Every step is one-way by design, which is exactly what makes Ed25519 secure. There is no function that turns "an address starting with 3ws" into a seed. The way to get a particular prefix is to search: draw a random seed, derive the public key, encode it, check the first three characters, and repeat.

The result is a completely ordinary keypair. Its secret is as random as any other, and the only thing that sets it apart is that it was the first one to spell the right thing.

This also explains why the mark is tamper-evident. An address is fixed the moment its keypair exists, so the mark is baked into the coin's cryptographic identity from creation. In the words of the three.ws mint mark documentation, the mark is baked into the Ed25519 keypair itself and cannot be retroactively attached to an unbranded mint.

## The math of three characters

The intuitive estimate goes like this. Each Base58 character has 58 possibilities, so three specific characters take 58 cubed attempts, 195,112. Match case-insensitively and the w and the s can each be either case, which halves the work twice, giving 48,778.

The real number is much friendlier, and the reason is one of the more interesting facts about Solana addresses.

### Base58 is a numeral, not a row of dice

Base58 is a positional numeral, like decimal: the 32 byte key is treated as one enormous integer and written out in base 58. The last digits of a huge uniformly random integer are effectively uniform, so a suffix character really is 1 in 58. The first digit behaves differently.

The three.ws vanity protocol specification walks through the arithmetic. A 32 byte value encodes to 44 digits when it is at least 58 to the power 43, and to 43 digits otherwise. Two to the 256 divided by 58 to the 43 is about 17.05, so a 44 digit encoding can only ever lead with one of the first 17 symbols of the alphabet. Only the roughly 5.9 percent of keys small enough for 43 digits can lead with anything else.

That gives six bands for the leading character. A 1 appears exactly 1 time in 256, because a leading 1 means a leading zero byte. The digits 2 and 3 each lead about 5.804 percent of the time, 4 about 5.814 percent, and the symbols 5 through H about 5.904 percent each. J leads about 1.433 percent of the time. The 40 symbols from K through z each lead about 0.1 percent of the time. Per the spec, a three character prefix is about 57,000 attempts when it starts with a symbol from 2 to H and about 3.3 million when it starts with one from K to z.

The digit 3 sits in the easy band, roughly 3.37 times more likely to lead than a flat 1 in 58 would suggest. Choosing a mark that starts with 3 is part of what makes the stamp so fast.

### Case-insensitivity quadruples the targets

The mark is defined in one file, src/solana/vanity/brand.js, as the prefix 3ws with case-insensitive matching turned on. The comment beside it gives the reason: case-insensitivity keeps the grind sub-second.

That means four accepted spellings: 3ws, 3wS, 3Ws and 3WS. All four are valid Base58, since none of w, W, s or S is excluded, and the digit 3 has no case.

Running the repo's own exact model gives each spelling the same probability, 1 in 57,960. Summing all four gives a combined probability of about 0.0069 percent per attempt, or an expected 14,490 attempts per mark, a little under a third of the intuitive 48,778. The grinder's own progress estimates use this exact figure, because the validation module computes the true Base58 distribution.

### From probability to wall-clock time

Grinding is a sequence of independent trials, so the number of attempts until a hit follows a geometric distribution. With an expected value of 14,490, half of all grinds finish within about 10,044 attempts, 95 percent within about 43,408, and 99 percent within about 66,729.

The documented single-thread throughput of the WebAssembly engine is about 25,000 keypairs per second. At that rate the expected grind is a little over half a second on one core, and the 99th percentile is under three seconds. A browser shares the work across up to eight threads by default, so it is faster still. That is why the launch interfaces can show a live rate and an estimated time remaining that barely has time to count down.

## The engine: Rust compiled to WebAssembly

The hot loop is a small Rust crate at crates/vanity-grinder, compiled with wasm-pack. The compiled module and its JavaScript glue are checked in under src/solana/vanity/wasm, so the site builds without a Rust toolchain. The crate exposes one function, grind, which takes a prefix, a suffix, a case flag, a batch size and a 32 byte start seed, and returns either nothing or the 64 byte secret key plus the Base58 address.

The release profile is tuned for throughput: full link-time optimisation, one codegen unit, and an optimiser pass at the highest level with SIMD enabled. The crate's README sums up its purpose in one line: the grinder's value is throughput.

### Computing only what matching needs

A typical Ed25519 library hands you a full signing key object, precomputing everything you would need to sign messages. A grinder only needs the public key of each candidate, so the crate works one level down at the curve arithmetic and computes exactly what matching requires: SHA-512 of the seed, clamp, base point multiplication with precomputed tables, compress. The README states that this roughly doubles throughput in WebAssembly.

The crate proves the shortcut produces identical keys. Its native test suite derives 64 public keys both ways and asserts they are bit-for-bit identical to the standard constructor's output. A separate JavaScript test loads the compiled artifact the site actually ships and cross-checks it against an independent Ed25519 implementation. The returned secret key uses Solana's standard layout, the 32 byte seed followed by the 32 byte public key, which any Solana wallet library loads directly.

### Seeds, counters and batches

Fetching fresh randomness for every attempt would mean crossing from WebAssembly to the host tens of thousands of times a second. Instead, the JavaScript side draws one fresh 32 byte seed from the platform's cryptographically secure random source for each batch, and the Rust side treats the low four bytes as a counter, incrementing once per candidate.

Every batch starts from fresh secure randomness, the other 28 bytes of each candidate stay secret, and a test exercises the counter's wraparound. The crate documents the design clearly: keys are as unpredictable as the secure seed source behind them.

## Parallelism: one worker per core, first match wins

In the browser, the grinder is a pool of Web Workers. The main thread reads the machine's logical core count and starts that many workers, capped at eight by default so a page stays considerate of the rest of your computer.

Each worker loads the module once and loops: draw a fresh seed, run 5,000 candidates inside WebAssembly, check the result. The batch is sized so one call returns within roughly 200 milliseconds even on a modest CPU, which keeps every worker responsive to a stop message. Every 250 milliseconds each worker reports its count and rate, and the main thread sums them into one live rate and one time estimate.

The workers race independently, because each draws its own random seeds, so their rates simply add up. The first worker to find a match posts it back, and the main thread stops and closes the rest.

The pool supports pause and resume, and pausing really exits each worker's hot loop, freeing the cores while keeping the attempt totals. Backing out of a launch dialog closes the pool cleanly.

The worker hands the secret key back as a transferable buffer, which moves the memory to the main thread in a single step instead of copying it, so exactly one copy exists in the page.

## Two places the same engine runs

The same compiled module runs in two environments, and the launch surface decides which one stamps your mint.

In the browser: the Studio launch panel, which also appears on an avatar's page, grinds the mark on its connected-wallet path before it asks the server for anything. The pump.fun launch modal on agent pages does the same, and so does the launch skill an embedded agent runs inside a page.

On the server: a Node build runs the identical WebAssembly module single-threaded, in batches of 20,000, under a 45 second budget. It is used whenever a launch request arrives without a mint address: the /launch page's wallet flow, the native $THREE lane on /three-launchpad, and launches signed by an agent's own custodial wallet. This path is a convenience: the creator's device does no grinding at all, and the coin arrives stamped all the same.

The server grinder checks feasibility before it starts. It computes the exact expected attempts first and proceeds only when its budget covers at least three times that figure, a margin the code notes completes about 95 percent of the time. For the 3ws mark the budget affords roughly 1.1 million attempts against an expectation of 14,490, about 76 times the expected work, so the stamp is comfortably within reach on every launch.

## How each path handles the mint keypair

The mint keypair is the most important thing the grinder produces, and each path handles it in the way that best fits that path.

### The browser path

When the browser grinds, the mint keypair stays in the page. The launch helper sends the server the mint's public address and nothing else. The server builds the unsigned transaction around that address, the user's wallet signs, and the browser adds the mint keypair's signature locally before submitting. The server code says it plainly: when the mint is client-supplied, the client already holds the secret. The helper also checks the server's reply, and proceeds only when the prepared transaction names the exact mint it ground. Creators who like to keep every key on their own machine can launch from a connected wallet through the Studio launch panel.

### The server path

When the server grinds, it generates the keypair as part of the request. On the pump.fun lane it co-signs the transaction with the mint keypair before returning it, so the creator's wallet adds exactly one signature. On the native $THREE lane the server returns the mint keypair and the browser signs with both it and the user's wallet. The pending launch record the server writes holds the mint's public address and the launch parameters.

### The agent wallet path

When an agent launches from its custodial wallet, the server signs everything on the agent's behalf, which is what lets an agent launch a coin end to end without a human at the keyboard. If a caller supplies its own mint here, the server checks that the provided secret derives the supplied address and that the address carries the mark before using it.

## How the ground keypair enters the launch

The flow has four steps.

First, the client calls launch-prep for its lane, the pump.fun lane or the native $THREE lane, with the agent, the wallet, the coin's details and, on the browser path, the ground mint's address.

Second, the server applies the mark. With enforcement on, which is the default, a supplied mint is accepted when it begins with 3ws in any capitalisation, and a request with no mint gets one ground server-side. The check is one shared function in brand.js. No other file hardcodes the 3ws string or reimplements the test, so the browser, the server and every display surface agree on what counts as marked. A supplied mint without the mark is answered with a clear 400 coded unbranded_mint, so the client knows exactly how to proceed.

Third, the server builds the transaction around the mint, and the user's wallet signs as payer while the mint keypair signs as the new account, in whichever order the path calls for.

Fourth, after the transaction lands, the client calls launch-confirm with the signature, and the server reads the confirmed transaction from the chain itself. On the pump.fun lane it checks that the pump.fun program was invoked and the launch fee paid. On the native lane it checks that the prepped mint is in the transaction's account keys and that the bonding-curve program was invoked. Only then is the launch recorded. Server-side launch reads go through a failover Solana connection, so these checks have more than one RPC provider behind them.

## The launch record: provenance you can look up

Because a launch is recorded only after the server has read the confirmed transaction from the chain, the launch records are the platform's authoritative provenance. They drive the public feed at three.ws/launches and each coin's page under three.ws/launches followed by its mint, and native lane coins appear in the directory on three.ws/three-launchpad.

The mark and the records complement each other beautifully. The mark answers "does this look like a three.ws coin?" in a glance, with no lookup. The record answers "is this a three.ws coin, and when and how did it launch?" with the chain itself as the source. Together they give anyone a fast first impression and a dependable confirmation.

The mark is about provenance only. It describes where a coin was created, and leaves every other question about a coin, its community and its market to the coin's own story.

## Observability built in

Every server-side grind writes one structured log line, mint_mark_stamped, with the public key, the number of attempts and the duration in milliseconds. Operators watch it in Cloud Logging to confirm that the roughly 14,500 attempt average and the sub-second expectation hold, and a change in either number is an early, precise signal about engine performance.

Every confirmed launch emits a coin-buy event on the platform's feed bus with a branded field computed by the same shared hasThreeWsMark function. The FOMO ticker and any downstream consumer can tell branded launches apart without doing any string matching of their own.

Enforcement is governed by a single setting, THREE_WS_MARK_ENFORCE, and it is on by default. In that state a launch either goes out stamped or is not created, so the policy that every branded launch carries the mark lives in one place in code and applies everywhere.

## A launcher where the buyer chooses

three.ws also runs a generic pay-per-call pump.fun launcher for other agents, sold over x402. There, the buyer picks their own vanity prefix or suffix, or takes a random mint, and the platform respects that choice: the 3ws mark is reserved for launches three.ws initiates for its own users and agents, and the docs keep the generic launcher free of it on purpose. That launcher can also draw instantly from the same pre-ground vanity inventory described below, so a buyer who asks for a pattern that is already in stock skips the grind entirely.

## Vanity addresses for everyone

The engine behind the mark powers a family of vanity tools anyone can use.

### A free grinder in your browser

three.ws/vanity-wallet is a free in-browser grinder. Type a prefix or suffix, and the same Rust and WebAssembly pool described above searches on your own CPU cores, with a live rate and time estimate, and hands you the keypair right there in the page.

### Three paid tiers over x402

For agents and developers who would rather not run a grinder at all, three keyless endpoints deliver a branded Solana address in one paid call over x402, with no account and no API key.

The live grinder, /api/x402/vanity, first checks whether an address matching your pattern is already in stock and, if so, claims it atomically and delivers it instantly at the same price a live grind would cost. Otherwise it grinds a brand new keypair under a 45 second budget. Live grinding covers up to three Base58 characters, and four or five character patterns are served from inventory. Prices run from $0.01 to $0.50 for up to three characters and $2.50 to $10 for the four and five character band. It can also return a BIP-39 seed phrase whose standard derivation path lands on the vanity address, for patterns up to two characters. Settlement runs only after a successful claim or grind, and the response's source field says whether it came from inventory or was freshly ground.

The provably-fair grinder, /api/x402/vanity-verifiable, grinds under the three-vanity/v1 protocol and is priced from $0.02 to $0.40 for up to three characters.

The premium inventory, /api/x402/vanity-premium, lets anyone browse long four and five character addresses for free and buy a specific one for $1 to $50. Browsing is also available at three.ws/vanity/premium. The key is delivered exactly once and its stored ciphertext is destroyed on delivery.

### Confidential delivery and certificates

Any of these endpoints accepts an optional sealTo parameter: supply an X25519 public key, and the secret is sealed to it with ECIES (x25519, HKDF-SHA256 and AES-256-GCM), so the plaintext never appears in the response, a proxy log or a cache. On the live grinder, the secret is served once and is never stored, and the payment replay cache strips it from its stored copy.

Every live grinder response also carries a signed, offline-verifiable proof-of-grind certificate attesting the pattern, the address, the difficulty and a freshness nonce, with no secret inside. Anyone can verify it at three.ws/vanity/verify, and the attestation public key is published at three.ws/.well-known/three-vanity.json.

### The provably-fair protocol

The three-vanity/v1 protocol is designed for people buying a wallet address they intend to keep. Before it knows the buyer's pattern, the server commits to a random 32 byte seed by publishing its SHA-256 hash. It mixes that seed with the buyer's own entropy and a fresh request nonce through HKDF-SHA256 into a master seed, and derives each candidate deterministically with HMAC-SHA256. The receipt reveals the seeds and the winning index and is signed by the three.ws service key.

A buyer can then confirm, with open-source tooling, that the key was generated fresh from entropy committed in advance, that their own entropy went into the mix, that the address derives from the revealed seed and matches the pattern, that the difficulty claim follows the exact Base58 model (named base58-exact/v2 in the receipt), and that the receipt was signed by three.ws. Verification is available through the @three-ws/solana-agent SDK's verifyVanityReceipt, a command-line script in the repo, and the web verifier at three.ws/vanity/verify.

Because verification replays the exact candidate stream, this protocol uses a deterministic pure JavaScript Ed25519 derivation, while the launch grind uses the faster WebAssembly engine. Each is the right tool for its job: verifiability for wallets people keep, raw speed for a stamp that should be invisible to the creator.

### An inventory that restocks itself

The four and five character stock is ground ahead of time on batch CPU by a dedicated worker, workers/vanity-grinder, which runs as a Cloud Run Job. An hourly job checks available stock against a low-water mark of 25 by default and starts a new batch when it runs low, and the same job sweeps any ciphertext past its retention window. The live grinder, the premium tier and the generic pump.fun launcher all draw from that one warehouse.

## Our partners

three.ws is proud to take part in eight programmes with some of the best-known names in cloud, AI, hardware, infrastructure and media. Each is described here exactly as our partners page lists it, and three.ws remains an independent company throughout. Several connect directly to the launch and vanity stack in this article.

Google Cloud. three.ws is a member of Google Cloud for Web3 Startups, and production runs on Google Cloud. The server-side grinder runs inside the platform's Cloud Run service, where a stamp typically takes well under a second on the server's CPU. The premium vanity inventory is ground by a Cloud Run Job on batch CPU and restocked by an hourly scheduled job, and the stamp's log lines are read in Cloud Logging. Vertex AI provides the platform's Gemini and image lanes.

Quicknode. three.ws is accepted into the Quicknode Startup Program with approved free infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind agent wallets, settlement verification and live Solana market data. Server-side Solana calls run through a failover chain of providers, and Quicknode is a rung in that chain, which supports the chain reads that confirm every launch.

NVIDIA. three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. Every 3D generation lane runs on NVIDIA silicon, including text to 3D, photo to avatar, auto-rigging and motion capture, the lanes that give three.ws agents their 3D bodies.

OpenAI. three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free three.ws 3D Studio connector gives ChatGPT keyless 3D tools, including text to model and rigged avatars rendered inline in the conversation, with no account, payment or key.

IBM. three.ws is an IBM Business Partner. Agents can think on IBM Granite foundation models served through IBM watsonx.ai using the owner's own IBM Cloud credentials. The public Granite-backed tools on three.ws are an independent set of developer tools built on IBM's publicly available models, separate from the formal partnership work, which is being built on the IBM platform.

Amazon Web Services. three.ws is an AWS Partner. The AWS Marketplace SaaS integration is built and deployed, linking an AWS account to a three.ws account and issuing an x402 access key, with usage paid per call over x402. The Marketplace listing is coming.

Alibaba Cloud. three.ws is live on the Alibaba Cloud International Marketplace, with a product listing, a storefront and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in the platform's multi-model brain router.

HackerNoon. three.ws has a builder-focused publishing partnership with HackerNoon. Every three.ws announcement flows automatically from the platform's RSS feed into HackerNoon's drafts queue and, after editorial review, publishes with a canonical link back to three.ws.

Two listings round out the launch story. $THREE is a verified project on pump.fun, and the platform reads that flag live from pump.fun's public coin record on every stats request rather than hardcoding it. And with the next release, the /launch success screen adds a DEXTools button and a Social Boost card right after a coin goes live, so a new coin's community has a ready next step; $THREE itself has won DEXTools Social Boost three times.

You can see all eight partners on three.ws/partners, and partnership enquiries go to partners@three.ws.

## Why it matters

A three character prefix is a modest thing, a fraction of a second of compute per launch. It also shows how three.ws likes to build. The brand is not a logo in a metadata field. It rides on the cryptographic identity of every coin the platform creates, it is generated by open-source code anyone can read, it is applied at one shared checkpoint, and it is paired with launch records that read the chain itself. A creator gets recognition for free, a trader gets a quick visual cue, and anyone gets a dependable record to confirm it.

Everything described here is open source at github.com/nirholas/three.ws, from the Rust crate to the launch endpoints to the probability model. To see the mark on real coins, browse three.ws/launches. To launch a coin of your own, start at three.ws/launch or from the Studio at three.ws/studio. To watch the grinder work on your own machine, open three.ws/vanity-wallet and give it a prefix. To check a vanity certificate or receipt, use three.ws/vanity/verify. To meet the companies we work with, visit three.ws/partners.

Nothing here is financial advice.
