# Film brief: "Give your AI a body"

FILM
One sentence: three.ws turns a text prompt into a rigged 3D agent that lives on the web.
Audience: builders and crypto-native users who have only ever met AI as a text box.
Duration: 17 seconds.
Formats: 16:9 (1920x1080) and 9:16 (1080x1920), each composed separately from the same timeline. 1:1 is not needed for X.

ASSETS (approved, all real)
Logo: public/brand/three-ws-mark.png (the shipped cube mark).
Live product screens: assets/screens/forge.png and assets/screens/marketplace.png, captured from https://three.ws by scripts/capture-motion-studio-assets.mjs. Manifest: assets/screens/manifest.json.
3D body: public/avatars/michelle.glb (the featured community avatar shown on /marketplace), rendered live with three.js. Not a mock of an avatar, the actual file.
Brand type and colors: public/tokens.css and public/fonts (Space Grotesk, Inter, JetBrains Mono). Accent gradient is the one on the "Forge it" button of the home page.
Audio: synthesized in src/audio.mjs from the same timeline module that drives the picture.

VISUAL RULES
Keep: near-black stage, white ink, one warm-to-violet accent, generous negative space, large grotesk headlines, mono for system voice.
Avoid: centered gradient with fading text and a logo at the end, stock particles, glassmorphism card stacks, any element that exists only to move.
Never invent product screens or metrics. Every pixel of UI in the film is a screenshot of production. The only numbers on screen are the ones the page itself shows.

CLAIMS (every word of copy must be true today)
"Type a prompt. Get a textured 3D model." Forge page: "text or photos -> textured 3D model".
"Free. No sign-up." Forge page: "Free · no sign-up · yours to download".
"Rigged. Animated." Marketplace card for the avatar: "Realistic rigged dancer with a Mixamo-compatible skeleton and baked idle/dance clips".
"Embed it with two lines of HTML." Home page: "Embed it on any website with two lines of HTML".

DELIVERABLES
Storyboard (shotlist.md), contact sheets (reviews/), final videos and poster frames (out/), source (src/), a note on what still needs human review.
