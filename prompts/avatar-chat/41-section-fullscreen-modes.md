# 41 — Section and fullscreen mode layout compatibility

## Status
Gap — `mode="section"` and `mode="fullscreen"` are two additional layout modes beyond inline and floating. The new vertical chrome column must be verified in both.

## File
`src/element.js` — `BASE_STYLE`

## Section mode

Section mode is designed to be embedded in a page section (like a hero or sidebar). It has `width: 100%` and custom height. The vertical chrome column should work as-is.

Verify: With `mode="section"`, does the chrome column fill the element correctly? The avatar anchor should take the center portion.

If the section is very wide (desktop), the chat area could span the full width looking awkward. Add a max-width to the chat in section mode:
```css
:host([mode="section"]) .chat {
    max-width: 600px;
}
:host([mode="section"]) .input-row {
    max-width: 600px;
}
```

## Fullscreen mode

Fullscreen is `position: fixed; inset: 0; width: 100vw; height: 100vh`. The chrome column fills the entire screen, with the avatar anchor taking the bulk of the space.

On a large monitor (1440px wide), the avatar anchor is a large transparent area showing the Three.js canvas. The thought bubble will appear at `top: 12%` (or tracked position from prompt 13), which maps to roughly 130px from the top — should be approximately above the avatar's head for a fullscreen-framed model.

Verify: In fullscreen mode, are the chat, avatar, and input well-positioned? On large screens, add max-width centering:
```css
:host([mode="fullscreen"]) .chrome {
    max-width: 800px;
    margin: 0 auto;
    left: 0;
    right: 0;
    width: 800px;
}
```

## Verification
Test `mode="section"` embedded in a page section. Test `mode="fullscreen"`. Both should show the vertical chrome column with chat at top, avatar in middle, input at bottom.
