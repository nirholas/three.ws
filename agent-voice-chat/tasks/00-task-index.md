# xspace-agent — Enterprise Completion Tasks

Run each `.md` file as a prompt to an AI coding agent. Tasks are ordered by dependency — complete them roughly in sequence, though many can be parallelized.

## Phase 1: Foundation (do first)
| # | File | What it does |
|---|------|-------------|
| 01 | `01-landing-page-polish.md` | Finish the landing page to production quality |
| 02 | `02-design-system.md` | Extract a shared design system (tokens, components) |
| 03 | `03-docs-site.md` | Build a VitePress docs site from existing markdown |
| 04 | `04-readme-overhaul.md` | Rewrite the GitHub README for virality |

## Phase 2: Core Product UI
| # | File | What it does |
|---|------|-------------|
| 05 | `05-onboarding-flow.md` | First-run setup wizard for new users |
| 06 | `06-admin-dashboard-v2.md` | Rebuild admin panel with real data, charts, empty states |
| 07 | `07-agent-builder-finish.md` | Complete the visual agent builder with working templates |
| 08 | `08-live-chat-polish.md` | Polish the main chat UI (index.html) |

## Phase 3: Backend Hardening
| # | File | What it does |
|---|------|-------------|
| 09 | `09-api-validation-errors.md` | Zod validation on every endpoint, standardized error responses |
| 10 | `10-auth-system.md` | API key auth + optional OAuth for admin panel |
| 11 | `11-rate-limiting-security.md` | Rate limiting, CORS, helmet, CSP headers |
| 12 | `12-structured-logging.md` | Replace console.log with pino structured logging |
| 13 | `13-health-readiness.md` | /health, /ready, /metrics endpoints for production |

## Phase 4: Testing & Quality
| # | File | What it does |
|---|------|-------------|
| 14 | `14-unit-test-coverage.md` | Get packages/core to 90%+ coverage |
| 15 | `15-integration-tests.md` | Server API integration tests |
| 16 | `16-e2e-test-suite.md` | Playwright E2E tests for all UIs |
| 17 | `17-ci-pipeline-harden.md` | Harden CI: caching, matrix, size checks, changelog |

## Phase 5: DevEx & Community
| # | File | What it does |
|---|------|-------------|
| 18 | `18-cli-polish.md` | Polish CLI with better prompts, colors, error messages |
| 19 | `19-examples-audit.md` | Verify all 10 examples run, add READMEs to each |
| 20 | `20-contributing-guide.md` | CONTRIBUTING.md, issue templates, PR template |
| 21 | `21-changelog-releases.md` | Automated changelog with changesets, GitHub releases |

## Phase 6: Production & Scale
| # | File | What it does |
|---|------|-------------|
| 22 | `22-docker-production.md` | Harden Docker: non-root, secrets, multi-arch, compose profiles |
| 23 | `23-monitoring-dashboards.md` | Grafana dashboards, Prometheus alerts, cost tracking UI |
| 24 | `24-performance-optimization.md` | Audio pipeline latency, bundle size, memory leaks |
| 25 | `25-accessibility-audit.md` | WCAG 2.1 AA compliance across all UIs |

## Phase 7: Polish & Ship
| # | File | What it does |
|---|------|-------------|
| 26 | `26-seo-metadata.md` | OG tags, structured data, sitemap, robots.txt |
| 27 | `27-error-pages.md` | Custom 404, 500, offline pages |
| 28 | `28-analytics-telemetry.md` | Optional anonymous usage telemetry with opt-out |
| 29 | `29-npm-publish-ready.md` | Package.json polish, exports map, provenance, size limits |
| 30 | `30-final-qa-sweep.md` | Final review: dead code, TODOs, console.logs, broken links |


