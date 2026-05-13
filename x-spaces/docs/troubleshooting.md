# x-spaces — Troubleshooting

## "Session error: The Realtime Beta API is no longer supported"

Your `server/index.js` still has the old Beta API shape. The version in this repo is already on GA. If you've forked an older copy, run `automation/patch-realtime.py` against your `index.js` and `public/agent1.html` / `agent2.html`.

## "Failed to execute 'setRemoteDescription': Failed to parse SessionDescription"

The frontend is POSTing the SDP to the old `/v1/realtime` endpoint. The GA endpoint is `/v1/realtime/calls`. Fix:

```bash
sed -i 's|https://api.openai.com/v1/realtime?model=|https://api.openai.com/v1/realtime/calls?model=|g' server/public/agent1.html
```

## "Could not find request-to-speak button"

X's UI changed labels, or the page is on the pre-join "peek" view (not yet inside the Space). The automation tries multiple labels (`request`, `request to speak`). If still failing, add the new label to the `NEEDLES` arrays in `automation/x-join-only.js` and `automation/unmute-only.js`.

To inspect what buttons are currently on the X tab:

```bash
sudo -u agent bash -c "cd /home/agent/automation && node -e \"
const p = require('puppeteer-core');
(async () => {
  const b = await p.connect({browserURL:'http://127.0.0.1:9223'});
  const pg = (await b.pages())[0];
  console.log(await pg.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role=button]')).map(b => ({
      a: b.getAttribute('aria-label'),
      t: (b.textContent||'').trim().slice(0,40)
    }))));
  b.disconnect();
})();
\""
```

## The X tab navigates to `/home` instead of staying on the Space

X sometimes bumps the page to the home timeline after a join click. Two possibilities:

1. **The Space ended** — verify on your phone. If yes, restart with a fresh URL.
2. **The same-account collision** — you cannot use the host's cookies on the VM. The VM's X account must be **different** from the account hosting the Space; X redirects you to `/home` if it sees you're already the host on the same account elsewhere.

The persistent mini-player at the bottom-right of the X UI usually keeps the Space audio session alive even when the visible page drifts. The unmute button often appears on this mini-player.

## "0 audio bytes" / agent connects but no one hears anything

Check the PulseAudio routing:

```bash
sudo -u agent pactl list short sinks         # should show agent_speakers and x_speakers
sudo -u agent pactl list short sources       # should show x_mic and agent_mic
sudo -u agent pactl list sink-inputs         # while Chrome is playing, should show chrome sink-inputs
```

If Chrome's sink-input is connected to a different sink than expected, the `PULSE_SINK` env var didn't take effect. Verify the launch.sh export order — `PULSE_SINK=...` must be on the same command line as the Chrome invocation, not exported separately.

## Phone shows the agent as a speaker, but you don't hear anything

The agent is muted on its side. Run:

```bash
sudo -u agent bash -c "cd /home/agent/automation && node unmute-only.js"
```

If `unmute-only.js` can't find the button, X may have put you on `/home` with the mini-player. Check the mini-player at the bottom of the X tab in a screenshot:

```bash
sudo -u agent bash -c "cd /home/agent/automation && node -e \"
const p = require('puppeteer-core');
(async () => {
  const b = await p.connect({browserURL:'http://127.0.0.1:9223'});
  const pg = (await b.pages())[0];
  await pg.screenshot({path:'/tmp/x-state.png', fullPage:true});
  b.disconnect();
})();
\""
sudo -u agent ls -la /tmp/x-state.png
# scp or gcloud compute scp the file off the VM to look at it
```

## Agent never greets after Connect

Check the agent tab's log in the browser. The `dc.onopen` handler should fire and you should see "Sent greet trigger" in the page log. If not:

- The data channel never opened — usually means ICE didn't connect. Check `chrome-agent.log` for ICE errors.
- The session is still using the old API shape — check `agent1.html` is on GA (see API drift table in `architecture.md`).

## Realtime API returns 401 / quota errors

```bash
curl -s http://localhost:3000/session/0
```

Look at the response. If 401: your `OPENAI_API_KEY` is wrong. If `insufficient_quota`: top up. If `model_not_found`: your account doesn't have access to `gpt-realtime` yet (request access in OpenAI dashboard).

## Chrome dies on launch

The most common cause on a fresh VM is missing shared libraries. Re-run `setup.sh`, which `apt install`s the full set (libnss3, libgbm, libasound, libgtk-3, etc.). If you customized the VM image and stripped packages, you may need to add them back.

Verify with:

```bash
ldd $(which google-chrome) | grep "not found"
```

## How to start over cleanly

```bash
sudo systemctl stop swarm-server.service
sudo pkill -9 -f "chrome.*user-data-dir=/tmp/chrome-"
sudo pkill -9 Xvfb
sudo -u agent pulseaudio --kill
rm -rf /tmp/chrome-agent /tmp/chrome-x
sudo -u agent /home/agent/launch.sh https://x.com/i/spaces/SPACE_ID
```
