# 34. Localization: docs, READMEs and the product in the languages our users speak

Read `docs/prompts/README.md` first.

## The problem

Every README and doc is English only. Competing open agents ship READMEs in Chinese, Spanish and Urdu at minimum, and their communities grow where the docs are readable. The product UI has no locale switch.

## Build

- **Docs:** translated `README.zh-CN.md`, `README.es.md`, `README.ur.md`, `README.pt-BR.md`, `README.ja.md`, `README.ko.md` at the root and for the top packages (`sdk/`, `packages/agents-sdk/`, `packages/three-ws-cli/`, `packages/agent-cli/`), `SECURITY.md` and `CONTRIBUTING.md` in the same set, and the `docs/start-here.md` path translated under `docs/i18n/<locale>/`. Translation by the LLM chain with a glossary in `data/i18n-glossary.json`, reviewed by a second pass, and a freshness check that flags a translation older than its source (extend `docs:freshness`).
- **Product:** a locale switch in the shell, string extraction for the highest-traffic pages (home, create, agents, wallet, marketplace, pricing) with a well-adopted i18n library, right-to-left support for Urdu and Arabic, locale-aware number and date formatting, and `hreflang` in `data/pages.json` output.
- **Changelog:** community Telegram push offers a translated summary per configured locale channel.
- Docs: `docs/localization.md`; changelog entry tagged `docs, improvement`.

## Acceptance

- Each translated README renders on GitHub with working links.
- The home page in Chinese and in Urdu (RTL) passes the page audit.
- `docs:freshness` reports a stale translation when the source changes.
- `npm test` green.
