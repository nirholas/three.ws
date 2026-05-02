# Task: Add voice input (speech-to-text) to the chat composer

## Context

`/workspaces/3D-Agent/chat/src` is a Svelte chat app. The chat already has TTS output (speaking responses aloud) but no voice input — users can only type messages.

The composer/input area is in `/workspaces/3D-Agent/chat/src/three-ui/Composer.svelte` or within `App.svelte` (search for the textarea where user messages are typed).

The browser has a native `SpeechRecognition` API (Chrome/Edge) that requires no API key. This is the simplest path.

## What to build

### 1. Find the composer textarea

In `App.svelte` or `Composer.svelte`, find the `<textarea>` or `<input>` where the user types their message. Note what variable it's bound to (likely `userInput` or similar).

### 2. Add a microphone button next to the composer

Add a mic button that starts/stops recording:

```svelte
<script>
    let recording = false;
    let recognition = null;

    function toggleVoiceInput(onResult) {
        if (recording) {
            recognition?.stop();
            recording = false;
            return;
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            alert('Speech recognition is not supported in this browser. Try Chrome or Edge.');
            return;
        }
        recognition = new SR();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            onResult(transcript);
        };
        recognition.onerror = () => { recording = false; };
        recognition.onend = () => { recording = false; };
        recognition.start();
        recording = true;
    }
</script>

<button
    type="button"
    title={recording ? 'Stop recording' : 'Speak a message'}
    on:click={() => toggleVoiceInput((t) => { userInput = t; })}
    class="flex h-8 w-8 items-center justify-center rounded-full transition
        {recording ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-slate-600'}"
>
    <!-- mic icon SVG or Icon component -->
</button>
```

Replace `userInput` with whatever variable the textarea is bound to. Use the existing `Icon` component with `feMic` if that icon exists in `feather.js`, or inline a simple SVG mic icon.

### 3. Check feather.js for a mic icon

Run: `grep -n "mic\|Mic" /workspaces/3D-Agent/chat/src/feather.js`

If `feMic` exists, import and use it. If not, add a simple inline SVG:
```svelte
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
</svg>
```

### 4. Auto-submit option

Optionally, after `onResult` sets the transcript, auto-submit if the message is non-empty:
```js
onResult = (t) => {
    userInput = t;
    // Auto-submit:
    if (t.trim()) submitMessage();
}
```

Only add auto-submit if you find a `submitMessage` or equivalent function that's safe to call directly.

## Files to edit
- `/workspaces/3D-Agent/chat/src/three-ui/Composer.svelte` or `App.svelte` — wherever the composer textarea lives

## Verification
- Open the chat in Chrome or Edge
- Click the mic button — browser should ask for microphone permission
- Speak a sentence — it should appear in the text input
- Click mic again or finish speaking — recording stops (button returns to grey)
- In Firefox or Safari, clicking mic should show a friendly error message (not crash)
- Pulsing red animation visible while recording
