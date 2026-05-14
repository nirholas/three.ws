# Add a greeting & first speech line

A silent agent on a page is half an agent. The avatar appears, animates, looks ready — but a visitor lands, glances at it, and isn't sure whether to engage. They look for a chat input. They wonder if the thing is for them.

A spoken greeting fixes all of that in one sentence. The agent says hi the moment it's ready. Visitors hear who it is and what it's for. They know it's interactive. They know it's responsive. They speak back.

This tutorial covers the `data-greeting` attribute end to end: how to write a good greeting, when it fires, how the browser's autoplay rules affect it, and how to make it accessible to visitors who have audio off or have a disability that requires text alternatives.

**What you'll build:**
- An agent that greets every visitor by voice the moment it's ready
- A greeting that works on Chrome, Safari, Firefox, mobile browsers — every common surface
- A subtitle / caption so the greeting is readable, not just audible
- A reusable pattern for scripted greetings versus LLM-generated dynamic ones
- A clear understanding of browser autoplay rules and how to work with them

**Prerequisites:** A page with the embed working from [Embed in 30 seconds](/tutorials/embed-in-30-seconds). Your agent should already be saved with a brain configured.

---

## Step 1 — The one-attribute version

The minimum-effort greeting is one attribute on the embed script tag:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-greeting="Hi, I'm Iris. Click me if you have a question."
></script>
```

When the agent is fully loaded (animations bound, scene ready, voice initialised), it speaks the greeting using its configured TTS voice. A speech bubble shows the same text on screen, fading out a few seconds after the line finishes.

This works. Most embed installations should ship with a greeting attribute. The rest of this tutorial is about doing it well rather than doing it at all.

---

## Step 2 — When the greeting fires

The embed dispatches a `agent:ready` event on the script element once the avatar is loaded, the camera is positioned, the lighting is set, and the voice subsystem is initialised. The greeting fires on that event automatically when the `data-greeting` attribute is set.

In rough terms, the timing on a typical broadband connection is:

1. **0 ms** — Page HTML is parsed; the script tag is encountered.
2. **0–500 ms** — `agent-3d.js` is fetched from the CDN and starts running.
3. **500–1500 ms** — The agent's manifest is fetched from the platform API.
4. **1500–3500 ms** — The GLB body is downloaded and parsed.
5. **3500–4000 ms** — The avatar appears, the scene renders, the `agent:ready` event fires.
6. **4000–4500 ms** — The greeting starts speaking. The speech bubble appears.

On a fast connection with the bundle cached, this collapses to about two seconds total. On a slow mobile connection, it can stretch to six or seven seconds; the agent fades in gracefully and the greeting fires when ready, so visitors never see a half-loaded character.

If you want to control the timing precisely — say, wait for an extra moment before greeting so the visitor has a chance to focus — you can use the JS API and skip `data-greeting`:

```html
<script
  id="agent-script"
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
></script>

<script>
  const agent = document.getElementById('agent-script');

  agent.addEventListener('agent:ready', async () => {
    // Wait two seconds after the agent is visible before speaking
    await new Promise(r => setTimeout(r, 2000));
    agent.speak('Hi, I\'m Iris. Take your time looking around.');
  });
</script>
```

Both approaches produce the same audible result. Use the attribute for simple cases; use the JS API when you need timing control or want the greeting to depend on something else on the page.

---

## Step 3 — What voice the agent uses

The voice is set in the agent's configuration at [https://three.ws/create](https://three.ws/create), not on the embed snippet. Open the editor, open your agent, open the **Voice** panel.

You have a few options:

- **Platform voices** — A selection of pre-tuned voices in different languages, accents, and timbres. These work everywhere and need no extra configuration. They are produced by a high-quality cloud TTS engine.
- **Browser voice (fallback)** — Uses the browser's built-in `SpeechSynthesis` API. Available everywhere with no cost, but quality varies — Chrome on macOS sounds quite good, while Chrome on a fresh Ubuntu machine can sound mechanical. Use this for projects where you can't pay for cloud TTS but you want speech to "just work".
- **ElevenLabs voice** — If your agent is configured with an ElevenLabs voice ID, the platform calls ElevenLabs for TTS. This is the highest quality option, and it's the only way to use a voice clone of your own voice. There is a per-character cost. Best for hero embeds where voice quality is part of the experience.

Whichever voice you pick at the brain level, the greeting uses it. You don't configure voice per greeting — one agent has one voice.

If you want different voices for different embeds, the cleanest pattern is to maintain two agents (with the same personality, different voice configs) and embed each on the relevant pages. See [Pick and swap an avatar in Studio](/tutorials/swap-avatar-in-studio) for the broader principle of cloning agents.

---

## Step 4 — Browser autoplay restrictions

Here is the most important practical point in this tutorial. Modern browsers do not let websites play audio automatically. The reasons are good: spammy auto-playing video ads, suddenly loud pages that ambush users, accidental playback when a tab loads in the background. But the rules apply to your agent's greeting too.

The exact policy varies by browser and platform, but the rough rules are:

- **Chrome / Edge desktop** — Audio may play automatically if the user has interacted with your domain before (a click, a keypress, a scroll counts in some cases). On first visit, audio is blocked until the user interacts.
- **Safari desktop** — Stricter. Audio is blocked until the user interacts, every visit.
- **Firefox desktop** — Permissive by default, but users can tighten the policy and many do.
- **iOS Safari** — Strictest. Audio is blocked until the user taps the page. No exceptions.
- **Android Chrome** — Similar to desktop Chrome. Mostly works after first interaction, sometimes works on first load.

The embed handles this for you, but it's important to understand what "handles" means:

### What the embed does automatically

When the greeting fires:

1. The embed attempts to play the audio.
2. If the browser allows it, the audio plays normally and the speech bubble shows the spoken text.
3. If the browser blocks it, the embed silently catches the rejection, *still shows the speech bubble* with the greeting text, and *queues* the audio to play the moment the user interacts with the page (any click, tap, key press, or scroll).

So in the blocked case, the visitor sees a speech bubble that says "Hi, I'm Iris. Click me if you have a question." even if no sound played. When they tap anywhere — including tapping the agent to start a chat — the buffered greeting plays at that moment.

This is the right default. The greeting is still effective on the worst-case browsers (because the text is visible), and the visitor isn't surprised by audio on a fresh page load.

### What you can do to improve the rate of autoplay success

A few practical tricks that bump the autoplay-success rate without working around the rules:

- **Encourage a small interaction before the greeting fires.** If your page has a "Skip intro" button or a "Welcome" splash, audio is unlocked the moment it's dismissed. Then the greeting plays normally.
- **Set the audio output level appropriately.** A quieter greeting (configured at the brain level) feels less ambushing if it does play automatically, which makes users less likely to mute the tab.
- **Don't compete with other audio.** If your page has a background video that autoplays muted, that's fine. If it has a hero video with sound, the greeting will sound chaotic — turn the hero off.

### What you should not do

A few patterns to avoid, even though you'll see them on other sites:

- Don't fake the autoplay by attaching invisible click handlers that "auto-click" on page load. Browsers detect these and the page gets penalised in autoplay quotas.
- Don't fall back to a louder beep or notification sound if the greeting fails. The user is in control; respect it.
- Don't write a "click to enable audio" gate as the first thing on the page. The agent's speech bubble already serves this purpose more naturally.

---

## Step 5 — Make the greeting accessible

A spoken greeting is wonderful for the majority of visitors. But some visitors:

- Have audio off, by choice or by default
- Are using a screen reader and don't want speech bubbles popping in
- Have a hearing impairment
- Are deaf
- Are in a quiet environment (a library, a meeting, a sleeping baby's room) and won't enable audio

The embed handles this automatically — the speech bubble shows the greeting text, so visitors who can't hear it can still read it. But you should write your greeting with the assumption that someone might read it before they hear it.

This means:

- Make the greeting useful as text. "Hi, I'm Iris. Click me if you have a question." reads as well as it sounds. "Hi!" alone reads as a stub.
- Avoid relying on pronunciation. "He's pronounced like the letter J in Japanese" works in audio but is weird in writing.
- Avoid pause cues that don't translate. "Hi. (pause) I'm Iris" works in audio but looks broken as text.

For visitors using a screen reader, the speech bubble is rendered with appropriate ARIA roles. Screen readers announce it as "the agent says: <greeting text>" rather than just blasting the text without context. You don't need to do anything to enable this; the embed handles it.

If you want a heavier-handed accessibility setup — for instance, a permanent transcript pane next to the agent — you can listen to the speech events from JS:

```html
<div id="transcript" aria-live="polite" style="margin-top: 12px; color:#666; font-size: 0.9rem;">
  <strong>Agent says:</strong> <span id="transcript-text">…</span>
</div>

<script
  id="agent-script"
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-greeting="Welcome. I'm here to help you find the right product."
></script>

<script>
  const agent = document.getElementById('agent-script');
  const out = document.getElementById('transcript-text');

  agent.addEventListener('speak', (event) => {
    out.textContent = event.detail.text;
  });
</script>
```

The `speak` event fires every time the agent says anything — greeting included — with the text in `event.detail.text`. Pipe it into an `aria-live="polite"` region and screen readers announce it. Sighted visitors with audio off see the transcript in real time.

---

## Step 6 — Scripted greetings versus dynamic ones

`data-greeting` is a static string. Whatever you put in the attribute is exactly what the agent says, every visitor, every page load. This is right for most embeds — the greeting should feel reliable.

But there are cases where you want the greeting to adapt to the visitor:

- A returning visitor should be greeted differently from a first-time visitor
- A visitor coming from a particular ad campaign should hear a relevant greeting
- A visitor whose preferred language is detectable should hear the greeting in that language

For dynamic greetings, skip `data-greeting` and use the JS API:

```html
<script
  id="agent-script"
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
></script>

<script>
  const agent = document.getElementById('agent-script');

  function pickGreeting() {
    const params = new URLSearchParams(location.search);
    const utm = params.get('utm_campaign');
    const returning = localStorage.getItem('hasVisited') === 'yes';
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    if (returning) {
      return 'Welcome back. Anything you wanted to ask last time?';
    }
    if (utm === 'launch-2026') {
      return 'Hi there. You\'re here from the launch announcement — let me show you what\'s new.';
    }
    return `Good ${timeOfDay}. I\'m Iris. Click me to ask anything about our service.`;
  }

  agent.addEventListener('agent:ready', () => {
    agent.speak(pickGreeting());
    localStorage.setItem('hasVisited', 'yes');
  });
</script>
```

The pattern is: skip the attribute, listen for `agent:ready`, choose a greeting in JS, call `speak()`. The visitor always gets a greeting, and the greeting is tailored to what you know about them at page-load time.

### Going further: LLM-generated greetings

You can also have the agent generate its own greeting using its configured brain. This is heavier — it requires a round-trip to the LLM before the agent speaks — but it's powerful when the greeting really should be personalised.

The cleanest way is to use a system-prompt convention. In the editor at [https://three.ws/create](https://three.ws/create), open the personality panel and add this rule near the bottom of your system prompt:

```
When you receive the message "__greet", introduce yourself in one or two sentences. Mention your name. Invite the visitor to ask anything. Match the visitor's apparent context — if it's morning, say good morning; if it's late at night, be gentle.
```

Then, in your page:

```js
const agent = document.getElementById('agent-script');
agent.addEventListener('agent:ready', () => {
  // The agent will process this through its brain and the response will be spoken
  agent.speak('__greet');
});
```

The `__greet` token is intercepted by the agent's brain (because you taught it the convention in the system prompt). The LLM generates a greeting that fits your prompt rules, the agent speaks it, and the visitor hears something that feels written for them. This is the highest-effort option but the most flexible, and it composes with the rest of your prompt design.

---

## Step 7 — Writing a good greeting

Here is what makes a greeting effective, distilled from watching first-time visitors interact with embeds across many sites.

### Lead with the name

Visitors form an opinion in the first three seconds. "Hi, I'm Iris" is doing two things at once: it establishes that the agent is a named entity (not a generic chatbot), and it gives the visitor a handle to use ("Iris, can you…"). Both matter.

### State the agent's role

The visitor doesn't know what the agent is for. Tell them.

- "I'm Iris. I can help you pick the right plan."
- "I'm Pip. I'll show you around the games."
- "I'm Chef Olive. Ask me about any recipe."

Specificity beats vagueness. "I can help you" is weaker than "I can help you pick the right plan", which is weaker still than "I can help you decide between Lumen Pro and Lumen Team".

### Invite action

End with an instruction or invitation. Visitors who don't know what to do next, won't.

- "Click me if you have a question."
- "Just type anything below."
- "Try asking 'what's new this month?'"

### Keep it to one or two sentences

A long greeting feels like a sales pitch. Two short sentences feel like a person.

### A complete example

For a hypothetical online wine merchant called "Bottle Lane", a good greeting might be:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-name="Vincent"
  data-greeting="Hi, I'm Vincent. I can recommend a bottle for any occasion — just tell me what you're celebrating."
></script>
```

Twenty words. Names the agent. States the value. Invites the visitor to be specific. Reads well aloud and reads well silent.

### A complete example for a developer tool

For a hypothetical CI/CD tool called "Pipeline", a different tone:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-name="Otto"
  data-greeting="Hey. I'm Otto. Ask me how to set up a build, or paste me a config and I'll review it."
></script>
```

Same structure — name, role, invitation — but the tone fits the audience. Calmer, slightly informal, direct.

---

## Step 8 — Debugging a silent greeting

If you set `data-greeting` and the agent isn't speaking, work through this checklist in order.

1. **Does the speech bubble appear?** If yes, the greeting is firing correctly and the audio is being blocked or muted. Skip to step 4. If no, the greeting isn't firing — go to step 2.

2. **Is the agent fully loaded?** Open the browser console. You should see no errors, and the network tab should show the GLB and manifest loaded with 200 status. If the agent isn't ready, the greeting won't fire. Common cause: the agent ID is wrong; double-check it on [https://three.ws/my-agents](https://three.ws/my-agents).

3. **Is the `data-greeting` attribute spelled correctly?** The loader silently ignores unknown attributes. `data-greting` will do nothing. Re-read the attribute name in your HTML.

4. **Is the tab muted?** Right-click the browser tab. Some browsers show "Unmute tab" in the context menu. Click it.

5. **Has the user interacted with the page yet?** On strict-autoplay browsers (Safari, iOS Safari), the agent will not speak until the visitor has clicked, tapped, or pressed a key on the page. The speech bubble appears regardless. If you tap and audio still doesn't play, move to step 6.

6. **Is the agent's voice configured?** Open the editor at [https://three.ws/create](https://three.ws/create), open your agent, open the Voice panel. Make sure a voice is selected and saved. An unconfigured voice falls back to silent (the speech bubble still appears).

7. **Is the system volume up?** Genuinely worth checking. The greeting plays at the system audio output level; if the OS volume is at zero, you won't hear it.

In practice, problems are almost always step 5 (autoplay rules) or step 6 (voice not configured). The embed is conservative on purpose — better to show a silent speech bubble than to surprise a visitor with unexpected audio.

---

## What you learned

- `data-greeting` is the simplest way to give your agent a spoken first line
- The greeting fires on the `agent:ready` event, automatically and reliably
- Browser autoplay rules can suppress the audio on first page load; the embed handles this gracefully by always showing the speech bubble and queuing audio for the user's first interaction
- A spoken greeting is also a readable greeting — write it to work both ways
- The accessibility tooling is built in (ARIA live regions, automatic announcements) but you can layer your own transcript on top using the `speak` event
- Dynamic greetings come in two flavours: scripted (chosen in JS based on context) and LLM-generated (driven by a `__greet` convention in the system prompt)
- A good greeting names the agent, states its role, invites action, and stays under two sentences

A working greeting moves the embed from "decoration" to "interaction", which is the single biggest win you can ship after the basic embed is live.

---

## Next steps

- [Embed in 30 seconds](/tutorials/embed-in-30-seconds) — the foundation embed, if you skipped it
- [Customize size, position and background](/tutorials/customize-appearance) — make the embed match your brand visually
- [Pick and swap an avatar in Studio](/tutorials/swap-avatar-in-studio) — change the agent's body without changing the snippet
- [Share your agent](/tutorials/share-your-agent) — generate a public URL, QR code, and social previews for the agent itself
- [Build your first agent](/tutorials/first-agent) — drop into the manifest and skills layer for personality work
- [Embed on a website](/tutorials/embed-on-website) — the full embed reference for production sites
