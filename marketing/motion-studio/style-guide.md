# Style guide

Written from the product itself (public/tokens.css, the home page, the Forge page), not from a competitor's film.

PALETTE
Stage: #0a0a0b. Panels: #111113 with a 1px #26262a stroke. Ink: #ffffff, secondary #9a9aa3, faint #5c5c66.
Accent: linear-gradient(100deg, #ff9a56, #ff5fa2 55%, #8b6cff), the "Forge it" gradient. Used only on the one word or element the eye should land on in a beat.

TYPE
Headlines: Space Grotesk 700, tight tracking (-0.035em), 1.0 line height. 16:9 scale 132px, 9:16 scale 148px.
System voice: JetBrains Mono 500, uppercase tracking for chips, normal case for the typed line.
Body: Inter 500.

COMPOSITION
One focal element per beat. 16:9 splits left (words) and right (subject). 9:16 stacks subject over words. 9:16 keeps all text inside the vertical safe band (top 190px and bottom 300px stay clear of X chrome).

PACING
A meaningful change at least every 1.1 seconds, never more than two things moving at once. Holds are at least 0.9 seconds so a headline can be read at phone size.

MOTION RULES BY OBJECT CLASS
Micro (chips, carets): quick, one small overshoot, 0.28 s.
Panels (product screens): critically damped settle, 0.9 s, entering with a 14 degree turn that resolves to 4.
Camera (3D body): continuous slow orbit, no easing, never faster than 22 degrees a second.
Headlines: strong ease-out-expo entrance, 0.55 s, then perfectly still.
Body (3D avatar): its own baked clip, driven by the film clock, never real time.

TEXTURE
A 64px grid at 3.5% white and a soft accent bloom behind the subject. No grain, no glass.

BANNED DEFAULTS
Everything fades in from nothing at the same speed. A gradient behind centered text. Logo-last as the only brand moment (the mark is on screen at second 0 as a small corner stamp). Stock "particles". Springs on everything.

DETERMINISM CONTRACT
frame = render(t). No Date.now, no requestAnimationFrame clock, no unseeded Math.random. The page exposes window.__seek(t) and nothing else advances it. Frame 240 renders without frames 0 to 239.
