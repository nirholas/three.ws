The Voice Lab on three.ws puts more than 300 voices in one grid, and you can hear any of them before you choose, without signing in. Drive puts an agent on a car screen, where speaking is the main way in, and the phrases a driver uses to control it ("repeat that", "stop talking", "louder", "night mode") are answered by the page itself before anything is sent to a server.

The two pages solve opposite halves of the same problem: how an agent should sound, and what it should not wait on a network to do.

## One grid across three lanes

The grid merges three synthesis lanes that work signed out: Microsoft Edge, Google Gemini and NVIDIA Magpie. The Edge list is fetched live from Microsoft and cached for six hours, so it is not a hardcoded snapshot, and it covers more than 100 locales. Gemini adds 30 prebuilt voices that take a written direction, such as "warm and unhurried". Magpie adds 11 personas built for the real-time avatar lane. Two more lanes, OpenAI and ElevenLabs, appear in the same grid and need an account.

Search matches a voice's name, id, locale and labels, and the language filter is built from the locales actually in the list, so it offers no language the grid cannot play. Each card names the lane it runs on.

![The Voice Lab grid searched for "warm": five voice cards, Sulafat on Google Gemini, Andrew and AndrewMultilingual and Xiaoxiao on Microsoft Edge, and Ash on NVIDIA Magpie, each with its labels and a Preview and a Use this voice button](/x-media/voice-article/voice-grid.png)

## Hear it before you choose it

Preview plays a voice's own sample clip when it has one, and otherwise renders one short line through the synthesis endpoint. Use this voice moves the pick into the playground, where you type up to 1,000 characters, set the speed and press Speak.

Each clip is cached against a hash of the whole request: lane, voice, text, model, direction, speed and settings. Ask for the same line twice and the second answer comes back from storage with no new synthesis. The playground says which happened. In the capture below the line had already been spoken once, so Speak returned it from the cache.

![The Text-to-Speech Playground with the Microsoft Edge voice Andrew selected, the line "Take the next exit. There is a charger two minutes past the bridge." typed in, and the status beside Speak reading 23 KB, cached, with the clip playing](/x-media/voice-article/playground.png)

## Drive: the agent on a car screen

[Drive](https://three.ws/drive) starts in Driving mode with the keyboard hidden and four controls: Hands free, Repeat, Stop and Type. Hold Talk and speak. The agent is told to reply in one or two short sentences that sound right out loud, and never to ask the driver to read anything, tap through a list or look at the screen. The reply is clamped to two lines on screen and spoken in full. Night is the default palette, because a bright panel at speed is glare.

If the browser reports a real ground speed, moving above walking pace locks the keyboard again, and the Parked switch will not unlock it while the wheels are turning. Behind the screen is the platform's existing talk loop: microphone into speech recognition on NVIDIA Riva, with the browser recognizer as the fallback lane, transcript into the chat model, the reply into speech, and the audio into lip sync on a rigged avatar.

![Drive parked at night with the avatar Michelle. Asked how long to drive before taking a break, the agent's answer is clamped to two lines on screen while it is spoken, with Hands free, Repeat, Stop, Type and Talk along the bottom](/x-media/voice-article/drive-reply.png)

## The phrases the page answers itself

Some things a driver says are control, not conversation. Sending "louder" to a language model costs a round trip and can come back wrong, so Drive keeps a small phrase table and checks each final transcript against it before the network is touched. There are eight commands, each with its own set of phrasings: repeat, stop, louder, quieter, night, day, parked and driving.

```js
const PHRASES = [
	['repeat', ['repeat', 'repeat that', 'say that again', 'again', 'what did you say', 'come again', 'one more time']],
	['hush', ['stop', 'stop talking', 'be quiet', 'quiet', 'hush', 'never mind', 'nevermind', 'cancel', 'shut up']],
	['louder', ['louder', 'speak up', 'turn it up', 'volume up', 'i can not hear you', "i can't hear you"]],
	['night', ['night mode', 'dark mode', 'go dark', 'dim the screen']],
	// quieter, day, parked and driving follow the same shape
];

export function matchDriveCommand(transcript) {
	const phrase = normalize(transcript);
	if (!phrase || phrase.length > 40) return null;
	return LOOKUP.get(phrase) || null;
}
```

The match is against the whole utterance, not a word inside it. Before comparing, the page lowercases the transcript, strips punctuation, drops "hey", "ok", "please" or "can you" from the start and "please", "now" or "for me" from the end, and gives up on anything longer than 40 characters. That is how "stop" ends a reply while "stop at the next charger" still reaches the agent. "Louder" and "quieter" move the volume by 20%. A handled command never reaches the chat model.

Typed text takes the same path as speech. Parked, typing "Day mode, please" switches the palette to day on the spot, with no request to a server.

![Drive in the day palette after "Day mode, please" was typed while parked: the heard line shows the command above the previous answer, and the palette button now reads Day](/x-media/voice-article/drive-day-mode.png)

## What it does not do yet

Gemini voices can be listed and still fail. As of this writing the provider is refusing this deployment's credentials, so a Gemini preview answers with an error that names the lanes still working. A lane the provider refuses is then marked unavailable for a few minutes and its voices leave the picker, which is why the grid's count moves between 327 and 357. Edge and Magpie are unaffected.

A voice picked in the Voice Lab reaches an agent once it is assigned in the agent editor. Drive answers on a head unit browser or a phone in a cradle today. The native CarPlay version is written and waits on Apple's entitlement grant, and there is no wake word, by design, because Apple's voice category does not allow one. A spoken answer waits on the chat model, and under heavy load that wait has run long enough to time out.

The Voice Lab is at [three.ws/voice](https://three.ws/voice) and Drive at [three.ws/drive](https://three.ws/drive). Both work without an account.
