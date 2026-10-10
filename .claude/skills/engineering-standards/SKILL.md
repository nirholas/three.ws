---
name: engineering-standards
description: three.ws engineering excellence checklist: architecture, open-source-first search order, UI/UX standards, innovation standard.
when_to_use: When designing or building any non-trivial feature or UI, before writing code.
---

# Engineering excellence

### Architecture
- **Read before you write.** Before adding code, understand the existing patterns. Use the same naming conventions, file organization, and abstractions already established. Consistency compounds.
- **Think in systems, not files.** A feature touches routing, data fetching, state management, UI rendering, and error handling. Trace the full path before you start. Wire every connection.
- **Eliminate dead paths.** If a button exists, it must work. If a link exists, it must go somewhere. If a state exists, there must be a way to reach it. Audit your own work for unreachable or broken paths.
- **Design data flow first.** Where does the data come from? How does it transform? Where does it render? Solve this before writing UI code.
- **Small functions, clear boundaries.** Each function does one thing. If you need a comment to explain what a block does, extract it into a named function.
- **Delete aggressively.** Dead code, unused imports, vestigial features: remove them. Less code is better code.
- **Performance by default.** Lazy-load heavy modules. Debounce user input handlers. Paginate large lists. Use `will-change` and `transform` for animations. Don't ship jank.

### Open source first

Before writing a single line of new code for any non-trivial capability, search for an existing solution. The open-source ecosystem is vast, battle-tested, and maintained by people who have already solved most problems you will encounter. Using it is not laziness, it is engineering judgment. Reinventing what already exists is waste; building on what exists multiplies it.

**The search order:**
1. **NPM** for any JavaScript/Node utility, parser, client library, codec, or algorithm. `npm search`, `npmjs.com`, or a web search scoped to `site:npmjs.com`. Evaluate weekly downloads, last publish date, open issues, and license before adopting.
2. **GitHub** for tools, CLIs, APIs, demos, reference implementations, and anything npm doesn't cover. Search by topic, language, and stars. Read the README and the issue tracker, not just the star count.
3. **Existing workspace dependencies**: check `package.json` first. We may already have a package installed that solves the problem. Never add a dependency that duplicates one already present.

**How to decide:**
- A well-maintained OSS package with >1 k weekly downloads and an active maintainer beats a from-scratch implementation 9 times out of 10. Use it.
- A package with known CVEs, no updates in 2+ years, or a license incompatible with the project (GPL in a commercial product, etc.) does not qualify. Document why and build the thin wrapper or alternative yourself.
- For one-line utilities (e.g. `clamp(n, min, max)`), write it inline. Don't pull a dependency for three statements.
- When adopting an OSS package, pin a semver range (`^x.y.0`), not a commit hash or `latest`. Log the rationale in the commit message if the choice is non-obvious.

**The ecosystem mindset:**
We are not consumers extracting value from open source, we are participants growing it. When an OSS package solves 90% of the problem but misses the last 10%, prefer contributing upstream (open an issue, submit a PR) over forking or working around it in-house. When we build something genuinely reusable, extract it into a publishable package. The rising tide lifts all boats. The more we give back, the more the ecosystem has to offer the next time we go looking.

**Never reinvent:** HTTP clients, date/time parsing, cryptographic primitives, schema validation, markdown rendering, diff algorithms, color manipulation, UUID generation, deep equality checks, path resolution, MIME detection, or any other solved problem with a well-adopted library. Writing your own is a liability, not a feature.

### UI/UX standards
- **Every state is designed.** Loading, empty, error, populated, overflow: all of them. A page with no data should tell the user what to do next, not show a blank void.
- **Transitions matter.** Elements should enter and exit with intention. No jarring pops. CSS transitions on opacity and transform at minimum.
- **Responsive by default.** Test at 320px, 768px, and 1440px mentally. Use relative units. Flex/grid over fixed widths.
- **Accessibility is not optional.** Semantic HTML. ARIA labels on interactive elements. Keyboard navigation. Sufficient color contrast. Focus indicators.
- **Microinteractions signal quality.** Hover states, active states, focus rings, subtle animations on state change. These are not polish, they are the product.
- **Consistent spacing and typography.** Use the existing design tokens / CSS variables. If none exist, establish them and use them everywhere.

### Innovation standard
- **Don't just implement the feature. Improve the platform.** If you're adding a list view and notice the existing list views lack sorting, add sorting to yours and note the gap. Think about what features *should* exist adjacent to what you're building.
- **Cross-pollinate.** When building feature A, consider: does this data/capability unlock something in feature B? Wire the connection. The best platforms feel like everything is linked.
- **Surprise with quality.** Add the keyboard shortcut. Add the tooltip. Add the empty state illustration. Add the subtle gradient. The accumulation of small quality decisions is what separates great products from adequate ones.

---
