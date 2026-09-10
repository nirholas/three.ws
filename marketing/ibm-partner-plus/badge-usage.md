# IBM marks and claims: what we may say

Unlike the OpenAI pack, this one starts with a warning rather than a badge, because the
asset situation is different and easy to get wrong.

## We do not hold an IBM Business Partner badge in this repo

There is no IBM-supplied partner mark checked in. The file that looks like one is not one:

| File | What it actually is |
| --- | --- |
| `public/ibm-partner-logo.png` | **Ours, not IBM's.** The three.ws cube plus wordmark, 462x132, prepared at a size suited to IBM's surfaces. It contains no IBM mark. |

The IBM Partner Plus mark for Business Partners is distributed through IBM's partner
portal under IBM's own trademark guidelines. If a deck or a page needs it, get it from the
portal and follow the terms attached to it there. **Do not redraw the IBM 8-bar logo, do
not pull it off a web page, and do not generate an approximation of it.** The 8-bar is one
of the most tightly governed marks in the industry.

The one existing co-branded asset is `docs/media/ibm-x-threews-lockup.png`, produced for
the community blog post it is referenced from. Treat it as scoped to that use.

## The claims, ranked from safe to forbidden

**Safe, and verifiable today:**

- "three.ws is an IBM Business Partner."
- "three.ws agents can run on IBM Granite foundation models, served through IBM watsonx.ai."
- "three.ws runs a user group on IBM Community."

**Safe once the catalog listing is actually live, and not one day before:**

- "The three.ws 3D Studio MCP server is available in the IBM watsonx Orchestrate Agent Catalog."

**Forbidden, always:**

- Any phrasing that implies IBM endorses, certifies, recommends, or validates three.ws.
  Business Partner is a designation, not an endorsement.
- Presenting the public `/api/ibm/*` showcase as an IBM product or a partnership
  deliverable. It is an independent set of developer tools built on IBM's publicly
  available Granite models.
- Describing the `@three-ws/ibm-watsonx-mcp` npm connector as an IBM release. It is
  community-built; IBM neither operates nor endorses it.
- Referring to the dedicated three.ws page on the IBM domain, or linking it, until IBM
  ships it. As of the last update to [`docs/ibm.md`](../../docs/ibm.md) it is not live.
- "Strategic partnership" as a technical claim. It appears in syndicated press coverage,
  and a headline does not upgrade the framing on our own surfaces.

## The independence line

Any asset that places a three.ws mark near an IBM mark carries this, or wording that says
the same thing:

> three.ws is an IBM Business Partner. IBM does not endorse three.ws, and three.ws is not
> an IBM product.

## Where the rules come from

[`docs/ibm.md`](../../docs/ibm.md) is the source of truth and wins any conflict with this
file. It keeps three things deliberately distinct, and no asset in this kit may blur them:
the public showcase, the hosted watsonx.ai integration, and the open-source connector.
