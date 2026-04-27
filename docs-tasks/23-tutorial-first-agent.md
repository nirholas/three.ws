# Agent Task: Write Tutorial — "Build Your First three.ws"

## Output file
`public/docs/tutorials/first-agent.md`

## Target audience
Complete beginners to three.ws. They have basic web development knowledge (HTML, JS). They want to end up with a live, talking three.ws on a page they control. Step-by-step tutorial, not a reference doc.

## Word count
2000–3000 words

## What this tutorial must cover

### Learning objectives
By the end, the reader will have:
- A 3D avatar loading in the browser
- An agent with a name and personality
- The agent responding to text messages using Claude
- The page hosted somewhere they can share

### Structure: complete walkthrough

**Step 1: Pick a 3D avatar**
Three options ranked by effort:
1. Use the provided sample avatar (zero effort)
2. Get a free avatar from Mixamo (account required, ~10 min)
3. Generate one from a selfie at https://three.ws/create (5 min)

Show the Mixamo path briefly: go to mixamo.com → Characters → pick one → Download → select "FBX for Unity" → convert to GLB using the provided script.

For beginners: just use the sample avatar URL and come back to this later.

**Step 2: Create the HTML file**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My three.ws</title>
  <style>
    body { margin: 0; background: #0a0a0a; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    agent-3d { width: 400px; height: 600px; border-radius: 16px; overflow: hidden; }
  </style>
</head>
<body>
  <script type="module" src="https://cdn.three.wsagent-3d.js"></script>
  <agent-3d
    model="https://cdn.three.wsmodels/sample-avatar.glb"
    style="width:400px;height:600px"
  ></agent-3d>
</body>
</html>
```

Open in browser → model should appear. If it doesn't, troubleshoot: check console for errors, verify HTTPS for camera/mic.

**Step 3: Create an agent manifest**
Create `agent.json` in the same folder:
```json
{
  "name": "Aria",
  "description": "A helpful AI guide",
  "avatar": {
    "url": "./sample-avatar.glb"
  },
  "personality": {
    "prompt": "You are Aria, a friendly and enthusiastic AI guide. You love helping people explore the 3D world. Be concise, warm, and occasionally playful. When someone loads a model, compliment it enthusiastically.",
    "tone": "friendly",
    "voice": "female"
  },
  "memory": {
    "mode": "local"
  },
  "skills": [
    { "url": "https://cdn.three.wsskills/wave.json" },
    { "url": "https://cdn.three.wsskills/validate-model.json" }
  ]
}
```

**Step 4: Add the brain**
Update the HTML to load the manifest and enable the LLM:
```html
<agent-3d
  model="https://cdn.three.wsmodels/sample-avatar.glb"
  brain
  style="width:400px;height:600px"
>
  <script type="application/json" slot="manifest">
    {
      "name": "Aria",
      "personality": {
        "prompt": "You are Aria, a friendly AI guide. Be warm, helpful, and enthusiastic about 3D content."
      },
      "skills": [
        { "url": "https://cdn.three.wsskills/wave.json" }
      ]
    }
  </script>
</agent-3d>
```

Note: The `brain` attribute enables the LLM. You'll need an Anthropic API key. The platform's free tier provides limited credits without a key.

**Step 5: Add a chat interface**
Add a text input below the agent:
```html
<div style="text-align:center;margin-top:16px">
  <input id="msg" type="text" placeholder="Ask Aria something..." style="width:300px;padding:8px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:white">
  <button onclick="send()" style="padding:8px 16px;margin-left:8px;border-radius:8px;background:#6366f1;color:white;border:none;cursor:pointer">Send</button>
</div>

<script>
  const agent = document.querySelector('agent-3d');
  const input = document.getElementById('msg');

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await agent.sendMessage(text);
  }

  input.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });

  agent.addEventListener('agent-speak', e => {
    console.log('Aria said:', e.detail.text);
  });
</script>
```

Test: type "wave for me" → agent should wave and respond.

**Step 6: Make Aria greet on load**
```js
agent.addEventListener('ready', async () => {
  // Auto-greet after a short delay
  setTimeout(async () => {
    await agent.sendMessage('__auto-greet');  // internal trigger
  }, 1500);
});
```

Or set the greeting in the personality prompt: "When you first load, introduce yourself with a wave."

**Step 7: Add voice input (optional)**
Add a mic button:
```html
<button id="mic" onclick="startListening()">🎤</button>
<script>
  function startListening() {
    const agent = document.querySelector('agent-3d');
    agent.startListening(); // activates browser SpeechRecognition
  }
</script>
```

Note: requires HTTPS and browser permission for microphone.

**Step 8: Host it**
Three easy hosting options:
- **GitHub Pages** (free): push to repo → Settings → Pages → deploy from branch
- **Vercel** (free): `npx vercel` in the folder → done in 30 seconds
- **Netlify** (free): drag the folder onto netlify.com → deployed instantly

Show the Vercel path as the primary:
```bash
npx vercel
# Follow prompts → get a live URL like aria-agent.vercel.app
```

**Step 9: Upload your custom GLB**
Replace the sample model with your own:
1. Go to https://three.ws/app
2. Drag your GLB into the viewer
3. Click "Save to Account" (requires free account)
4. Copy the GLB URL from the editor
5. Replace `model=` attribute with your URL

**Step 10: Next steps**
- Register your agent on-chain (ERC-8004) for permanent identity
- Add more skills (weather, web search, product catalog)
- Publish as a widget and embed on your portfolio/website
- Connect a wallet to give Aria a blockchain identity

Link to: Embedding Guide, Skills documentation, ERC-8004 registration.

## Tone
Friendly and encouraging. This is a beginner tutorial — don't assume anything, but don't talk down either. Every step should produce a visible result. When things can go wrong, preemptively mention why and how to fix it.

## Files to read for accuracy
- `/examples/minimal.html` — starting example
- `/examples/web-component.html` — complete example
- `/examples/coach-leo/` — full agent example
- `/src/element.js` — web component API
- `/docs/SETUP.md`
- `/docs/how-it-works.md`
