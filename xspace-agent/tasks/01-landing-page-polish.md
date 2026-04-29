# Task 01: Landing Page Polish

## Context
There is a landing page at `public/landing.html` modeled after fomo.family's design. It has the structure and scroll behavior but needs polish to be production-ready.

## Requirements

### Visual Polish
- Add a real favicon (SVG preferred, with PNG fallback) using the xspace logo mark
- Add Open Graph meta tags (og:title, og:description, og:image, og:url, twitter:card)
- Create an og:image (1200x630) — can be a simple gradient with the logo and tagline rendered via an HTML template or canvas
- Ensure the loader transitions smoothly on slow connections (don't flash if page loads fast)
- Add a subtle noise/grain texture overlay on the dark background sections (CSS `background-image` with a tiny base64 noise PNG) for depth
- The hero orb should have a very subtle mouse-follow parallax effect (move 1-2% based on cursor position)

### Content
- Replace all `href="https://github.com"` placeholder links with `https://github.com/your-org/xspace-agent` (use a single constant so it's easy to change)
- Add a "Trusted by" / "Built with" logo bar below the ticker showing: OpenAI, Anthropic, Groq, ElevenLabs, Puppeteer, Socket.IO — use simple white SVG logos or text wordmarks at 50% opacity
- Add a "What developers are saying" testimonial section between features and code sections — use 3 glassmorphic quote cards with placeholder names/handles (these can be filled in later)
- The CTA section should include an email signup input (just the UI — `<form>` that posts to a placeholder endpoint) for "Get notified of updates"

### Interactions
- Add a mobile navigation drawer that slides in from the right when hamburger is tapped, with backdrop blur overlay
- The `npm install` copy button should show a brief checkmark icon animation on successful copy, not just text change
- Add keyboard navigation support: Tab through all interactive elements, Enter/Space to activate
- Smooth scroll offset should account for the fixed header height (currently links scroll behind the header)

### Performance
- Inline the critical CSS (above-the-fold) and defer the rest
- Add `loading="lazy"` to any images below the fold
- Add `<link rel="preconnect">` for Google Fonts (already there) and any CDN resources
- Minify the inline CSS and JS for production (or set up a simple build step)
- Ensure Lighthouse score is 90+ on Performance, Accessibility, Best Practices, SEO

### Responsive
- Test and fix all breakpoints: 1440px, 1024px, 768px, 480px, 375px (iPhone SE)
- The ticker should pause on hover (desktop) and be swipeable on mobile
- Code block should have horizontal scroll on mobile without breaking layout
- Footer columns should stack cleanly on mobile

## Files to Modify
- `public/landing.html` — main file
- Create `public/assets/favicon.svg` if needed
- Create `public/assets/og-image.html` template if needed

## Acceptance Criteria
- [ ] Page loads in under 2 seconds on 3G throttle
- [ ] Lighthouse scores: Performance 90+, Accessibility 95+, Best Practices 95+, SEO 100
- [ ] All links point to real destinations (or clearly marked as `#placeholder`)
- [ ] Mobile nav works on iOS Safari and Android Chrome
- [ ] No horizontal scroll on any viewport width
- [ ] Copy button works and provides visual feedback
- [ ] Keyboard-only navigation works for all interactive elements


