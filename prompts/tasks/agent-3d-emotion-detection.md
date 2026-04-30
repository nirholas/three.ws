# Task: Improve emotion detection for the 3D avatar

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` has a `detectEmotion()` function used to trigger expressions on the `agent-3d` floating avatar after each assistant message:

```js
function detectEmotion(text) {
    const t = text.toLowerCase();
    if (/\b(sorry|unfortunately|error|failed|can't|cannot|problem|issue|wrong)\b/.test(t)) return 'concern';
    if (/\b(great|excellent|perfect|congrats|amazing|wonderful|fantastic|awesome)\b/.test(t)) return 'celebration';
    if (/\b(interesting|fascinating|curious|wonder|actually|surprisingly)\b/.test(t)) return 'curiosity';
    if (/\b(understand|feel|must be|difficult|hard|tough|challenging)\b/.test(t)) return 'empathy';
    if (/\b(let me|one moment|working on|processing|calculating)\b/.test(t)) return 'patience';
    return null;
}
```

This is a simple keyword match. It fires on individual words out of context ("I can't wait to help you" → 'concern') and misses most emotional content.

## What to improve

### 1. Match on message-level sentiment, not word presence

The current regex fires if any matching word appears anywhere. Replace with a scoring approach that weighs multiple signals before returning an emotion:

```js
function detectEmotion(text) {
    const t = text.toLowerCase();
    const scores = {
        concern: 0,
        celebration: 0,
        curiosity: 0,
        empathy: 0,
        patience: 0,
    };

    // Negative/problem signals
    if (/\b(error|failed|can't|cannot|unable to|unfortunately|issue|problem|broken|doesn't work)\b/.test(t)) scores.concern += 2;
    if (/\b(sorry|apologize|my mistake|incorrect)\b/.test(t)) scores.concern += 1;

    // Positive/celebration signals
    if (/\b(great|excellent|perfect|congrats|congratulations|amazing|wonderful|fantastic|awesome|well done)\b/.test(t)) scores.celebration += 2;
    if (/\b(success|worked|solved|fixed|done|completed)\b/.test(t)) scores.celebration += 1;

    // Curiosity signals
    if (/\b(interesting|fascinating|curious|wonder|surprising|actually|notably|worth knowing)\b/.test(t)) scores.curiosity += 2;
    if (/\?/.test(text)) scores.curiosity += 1;

    // Empathy signals
    if (/\b(understand|i see|that makes sense|must be|difficult|hard|tough|challenging|frustrating)\b/.test(t)) scores.empathy += 2;
    if (/\b(feel|sounds like|i hear you)\b/.test(t)) scores.empathy += 1;

    // Patience/thinking signals
    if (/\b(let me|one moment|working on|processing|calculating|give me a|just a)\b/.test(t)) scores.patience += 2;

    // Counteract: "can't wait" should not be 'concern'
    if (/\bcan't wait\b/.test(t)) scores.concern -= 2;
    if (/\bno problem\b/.test(t)) scores.concern -= 2;

    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return top[1] >= 2 ? top[0] : null;
}
```

### 2. Apply to TalkingHead too

`speakLastMessage()` in `App.svelte` calls `detectEmotion()` for `agent-3d` but not for TalkingHead. After calling `talkingHead.speak()`, also call `talkingHead.setMood()` if an emotion is detected:

```js
} else if ($talkingHeadEnabled && agentVisible) {
    if (talkingHeadReady) {
        const mood = detectEmotion(last.content);
        if (mood) talkingHead.setMood(mood);
        talkingHead.speak({ text: last.content, mood: mood || 'neutral' });
    } else {
        pendingSpeak = last.content;
    }
}
```

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte` — replace `detectEmotion()`, update TalkingHead speak call

## Verification
- Send a message like "I apologize, I was unable to complete that task" → avatar should show concern
- Send "You solved it! That's fantastic!" → avatar should show celebration
- Send "I can't wait to help you with this!" → should NOT show concern (the counteract rule)
- Send a neutral message → no emotion triggered (returns null, no `expressEmotion` call)
