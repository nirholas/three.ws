# IBM Partner Plus kit

Assets and copy for three.ws as an **IBM Business Partner**, and the submission pack for
listing the three.ws 3D Studio MCP server in the **watsonx Orchestrate Agent Catalog**
through IBM Agent Connect.

This kit exists because IBM co-marketing kept being improvised per event while OpenAI,
NVIDIA, and QuickNode each had a standing pack. The benefits audit that produced it is
[`docs/partners/ibm-partner-plus.md`](../../docs/partners/ibm-partner-plus.md).

| File | What it is | Status |
| --- | --- | --- |
| [`agent-connect-listing.md`](agent-connect-listing.md) | The Agent Connect BYOL submission pack: every Concierge field filled in, the required use case, the QA credential plan | Ready to submit once IBM issues the `APP_ID` |
| [`badge-usage.md`](badge-usage.md) | What marks exist, what we may and may not claim, and the no-endorsement language that is mandatory | Ready |
| [`social-copy.md`](social-copy.md) | Paste-ready X, LinkedIn, and Telegram copy for the catalog listing going live | Hold until the listing is live |

## The listing icon

IBM's catalog icon spec is **SVG only, transparent background, under 200 KB**, and it must
read at 48x48. A PNG fails validation.

| Asset | Repo path | Public URL |
| --- | --- | --- |
| Catalog icon | `public/partners/ibm/three-ws-agent-connect-icon.svg` | `https://three.ws/partners/ibm/three-ws-agent-connect-icon.svg` |

It is the shipped 3D Studio mark (`public/three-ws-mcp-icon.svg`) with the dark rounded
background plate removed and the frame tightened to the cube, because that plate is exactly
what IBM's guidelines reject. Verified: 1,059 bytes, alpha 0 at the corner, legible at 48x48
on both white and `#161616`. Do not substitute the original; it will fail validation.

## Read this before writing any IBM-facing copy

Every framing rule in [`docs/ibm.md`](../../docs/ibm.md) applies to everything in this kit,
and [`badge-usage.md`](badge-usage.md) restates the ones that get broken most often. The
short version: three.ws is an IBM Business Partner, that is a designation and not an
endorsement, and the public `/api/ibm/*` showcase is never presented as partnership work.
