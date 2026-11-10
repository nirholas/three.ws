---
name: tty-avatar
description: Show a live 3D avatar in the terminal, print one rendered frame of any GLB, and change the avatar's mood or caption from scripts or Claude Code hooks. Use when the user wants to preview a GLB or three.ws avatar in a terminal or give a coding agent a visible face.
---

# tty-avatar

`@three-ws/tty-avatar` renders a GLB with a software rasterizer (no GPU, no browser) to truecolor half-blocks, braille or plain ASCII. Needs Node 18 or newer.

    npx @three-ws/tty-avatar <source> [options]

## Sources

A local `./model.glb`, a GLB URL, a three.ws avatar id, `agent:<agent id>` (its 3D body), or a `https://three.ws/avatars/<id>` page URL. Id lookups use `--origin` or `THREE_WS_ORIGIN` (default `https://three.ws`).

## Commands

    tty-avatar <source>                      run the live viewer
    tty-avatar snapshot <source> [opts]      print one frame and exit
    tty-avatar mood <name> [--say text] [--ttl ms]   change the running viewer's mood
    tty-avatar say <text>                    change the caption
    tty-avatar hook                          read a hook payload on stdin, hand it to the viewer
    tty-avatar install-hooks [--write] [--json]      Claude Code hooks to this viewer
    tty-avatar moods                         list moods

Moods: idle, spin, think, work, talk, happy, attention, error, sleep.

Useful flags: `--mode blocks|braille|ascii` (ascii is the default when stdout is not a TTY), `--mood`, `--fps`, `--columns`, `--rows`, `--yaw`, `--pitch`, `--zoom`, `--frames <n>` (exit after n frames), `--no-caption`, `--no-alt`, `--max-triangles`, `--state-dir` (or `TTY_AVATAR_DIR`), `--no-state`, `--plain` (snapshot without colour).

## Recipes

Check a model without opening a viewer (works in a non-interactive shell):

    npx @three-ws/tty-avatar snapshot ./hero.glb --mode ascii --columns 80 --rows 40 --yaw 30

Give a coding agent a face:

1. Run `npx @three-ws/tty-avatar install-hooks` to print the settings fragment, or add `--write` to merge it into `~/.claude/settings.json`. Only write to the user's settings file when the user asked for it.
2. The user runs a viewer in a split pane: `npx @three-ws/tty-avatar <avatar id>`.
3. The viewer polls `~/.three-ws/tty-avatar/event.json` and maps Claude Code events to moods (UserPromptSubmit think, PreToolUse work, Stop happy, SessionEnd sleep).

Signal progress from a script:

    tty-avatar mood happy --say "deploy landed" --ttl 5000

## Library

    import { resolveSource, parseGlb, TtyAvatar, snapshot } from '@three-ws/tty-avatar';
    const { bytes } = await resolveSource('./hero.glb');
    const mesh = await parseGlb(bytes);
    console.log(snapshot(mesh, { mode: 'ascii', columns: 60, rows: 30 }));
