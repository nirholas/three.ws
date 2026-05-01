# Feature: Push Notifications via Avatar

## Goal
Instead of a toast or browser notification, the avatar walks into frame, delivers a short message, and retreats. Works for async events: a background skill completing, a watched value changing, a reminder firing. Makes notifications feel personal rather than system-generated.

## Context

**`src/element.js`** — `<agent-3d>` custom element. Controls the avatar's lifecycle. Has `IntersectionObserver` for lazy boot. This is where "avatar enters/exits frame" would be orchestrated.

**`src/agent-protocol.js`** — the event bus. A new `ACTION_TYPES.NOTIFY` would trigger the notification flow.

**`src/agent-avatar.js`** — `_triggerOneShot(slot, duration)` plays clips. The `SPEAK` event already drives TTS. Relevant slots: `wave`, `nod`, `think`.

**`src/runtime/data-reactive.js`** — `startDataReactive({ protocol, source, bindings, signal })` wires live SSE/WS/poll sources to the protocol bus via `{ match, emit }` bindings. This is the right trigger source for data-driven notifications.

**CSS/positioning:** The `<agent-3d>` element is typically embedded in a fixed position or inline. "Walking into frame" means animating from off-screen (transform: translateX) into a visible docked position.

## What to build

### 1. Add `ACTION_TYPES.NOTIFY` to `src/agent-protocol.js`

```js
NOTIFY: 'notify',
```

Payload: `{ message: string, priority: 'low'|'normal'|'high', duration?: number }`

### 2. Create `src/agent-notifier.js`

This class manages the notification queue and the avatar enter/exit animation. It operates on the `<agent-3d>` host element.

```js
export class AgentNotifier {
    /**
     * @param {HTMLElement} hostEl — the <agent-3d> element
     * @param {import('./agent-protocol.js').AgentProtocol} protocol
     */
    constructor(hostEl, protocol) {
        this._host = hostEl;
        this._protocol = protocol;
        this._queue = [];
        this._busy = false;
        this._originalStyles = null;
    }

    attach() {
        this._protocol.on(ACTION_TYPES.NOTIFY, this._onNotify.bind(this));
    }

    detach() {
        this._protocol.off(ACTION_TYPES.NOTIFY, this._onNotify.bind(this));
    }

    _onNotify(action) {
        this._queue.push(action.payload);
        if (!this._busy) this._processNext();
    }

    async _processNext() {
        if (!this._queue.length) { this._busy = false; return; }
        this._busy = true;
        const { message, duration = 6000 } = this._queue.shift();
        await this._enterFrame();
        this._protocol.emit(ACTION_TYPES.SPEAK, { text: message });
        await this._wait(duration);
        await this._exitFrame();
        this._processNext();
    }
}
```

### 3. Enter / exit frame animations

The enter/exit should use CSS transitions on the host element — no JS animation loop needed.

```js
async _enterFrame() {
    // Save current position/visibility state
    this._originalStyles = {
        transform: this._host.style.transform,
        opacity: this._host.style.opacity,
        visibility: this._host.style.visibility,
    };

    // Snap to off-screen start position
    this._host.style.transition = 'none';
    this._host.style.transform = 'translateX(120%)';
    this._host.style.visibility = 'visible';
    this._host.style.opacity = '0';

    // Force reflow
    void this._host.offsetWidth;

    // Slide in
    this._host.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease';
    this._host.style.transform = 'translateX(0)';
    this._host.style.opacity = '1';

    await this._wait(450);
}

async _exitFrame() {
    this._host.style.transition = 'transform 0.35s ease-in, opacity 0.25s ease';
    this._host.style.transform = 'translateX(120%)';
    this._host.style.opacity = '0';
    await this._wait(380);

    // Restore original state
    Object.assign(this._host.style, this._originalStyles);
    this._host.style.transition = '';
}

_wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}
```

### 4. Docked position CSS

When the notifier is active, the avatar should render in a fixed docked corner (bottom-right, for example). Add a class that the notifier applies during the notification:

```css
/* In the element's shadow DOM or a global style */
agent-3d.notifying {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 200px;
    height: 300px;
    z-index: 9999;
}
```

The notifier adds/removes the `notifying` class around `_enterFrame` / `_exitFrame`.

### 5. Wire to `element.js`

In `<agent-3d>` element's boot sequence, after protocol is initialized:

```js
this._notifier = new AgentNotifier(this, this.agent_protocol);
this._notifier.attach();
```

In `disconnectedCallback`:
```js
this._notifier?.detach();
```

### 6. Public API for external triggers

Expose a method on the element:

```js
notify(message, { priority = 'normal', duration = 6000 } = {}) {
    this.agent_protocol.emit(ACTION_TYPES.NOTIFY, { message, priority, duration });
}
```

Usage from outside:
```js
document.querySelector('agent-3d').notify("Your file finished processing.");
```

### 7. Data-reactive integration (optional)

A data-reactive binding can automatically fire notifications when a watched value changes:

```js
ctx.dataReactive.start({
    source: { type: 'poll', url: '/api/job-status', intervalMs: 5000 },
    bindings: [
        {
            match: (data) => data.status === 'complete',
            emit: {
                type: ACTION_TYPES.NOTIFY,
                payload: { message: 'Your job finished!', priority: 'high' },
            }
        }
    ],
    signal: abortController.signal,
});
```

## Testing
- Call `document.querySelector('agent-3d').notify("Hello, test notification")` from the browser console
- Avatar should slide in from the right, speak the message, then slide out
- Queue two notifications back-to-back — second should wait for first to complete
- Test that the original element position is restored after exit

## Conventions
- ESM only, tabs 4-wide
- Don't use `setTimeout` chains for sequencing — use async/await with the `_wait()` helper
- The notifier must restore original element styles completely — don't leave the element in a broken position if detached mid-notification
- Update the event vocabulary table in `src/CLAUDE.md` with the `notify` type
