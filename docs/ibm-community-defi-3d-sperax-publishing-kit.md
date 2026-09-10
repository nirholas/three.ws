# Publishing kit: the Sperax integration post on IBM Community

Everything the **Post to Blog** form asks for, in the order it asks. The article
itself is [ibm-community-defi-3d-sperax.md](./ibm-community-defi-3d-sperax.md);
these are only the form values and the sequence that puts it live cleanly.

Rebuild the three output files after any edit to the draft:

```bash
node scripts/build-ibm-community-post.mjs
```

---

## 1. Title of Your Blog Entry

```
Sperax, three.ws, and IBM Granite: giving a DeFi agent a body, a brain, and a reason to trust it
```

## 2. Permalink

IBM allows letters, numbers, and dashes, and truncates long slugs (the group's
existing posts show cuts around 49 characters). This one is 38, so it survives
whole and carries all three names:

```
sperax-three-ws-ibm-granite-defi-agent
```

Full URL it produces:
`https://community.ibm.com/community/user/blogs/jessica-swanson/2026/09/10/sperax-three-ws-ibm-granite-defi-agent`

## 3. Category

`Blog Post` (the form's default, no change needed).

## 4. Body

**Use the editor's `HTML` button, do not paste rendered text.** Pasting from a
browser carries local image paths that resolve for nobody, and the editor
silently drops the stylesheet that formats the code blocks.

There are two fragments. Pick one.

### Option A: `-post-ibm.html` (works today, five manual uploads)

Images are left as labelled placeholder lines you replace by hand with the
editor's image button. Nothing has to be deployed first. This is the safe path.

### Option B: `-post-ibm-hosted.html` (one paste, zero uploads, needs a deploy)

Every figure points at its public three.ws URL under
`https://three.ws/ibm-sperax/`, and section 2 carries a **live** avatar
panel framed from `https://three.ws/sperax/iframe`, the same URL SperaxOS itself
frames. Not a screenshot: the actual plugin panel, running in the post.

That is possible because three.ws already serves
`frame-ancestors 'self' https://ibm.com https://*.ibm.com`, so community.ibm.com
is allowlisted to frame it.

Two prerequisites, both real:

1. **The images must be deployed.** They are staged in
   `public/ibm-sperax/` but a production deploy has to land before those URLs
   resolve. Paste this fragment before that and every figure is a broken image.
2. **The editor's sanitizer has to allow `<iframe>`.** three.ws permits the frame;
   whether IBM's editor keeps the tag is not something that can be tested without
   posting. Paste, save, and look at the preview. If the frame is gone, delete the
   surrounding block and fall back to Option A for that one spot; the rest of the
   fragment is unaffected.

1. Open your chosen fragment ([Option A](./ibm-community-defi-3d-sperax-post-ibm.html) or [Option B](./ibm-community-defi-3d-sperax-post-ibm-hosted.html)) in a text editor.
2. Select all, copy.
3. In the blog form, click **HTML** in the second toolbar row.
4. Paste, then save/close the HTML view.

That fragment is built for this editor specifically: no document shell, no `<h1>`
(the Title field above is the headline), no byline (the post shows its own author
and group), and every style that matters inlined on the element, so code blocks,
the comparison table, and the pull quote survive.

### 5 images to place (Option A only)

The fragment leaves five blue dashed placeholder lines, each naming the file to
upload at that spot. For each one: click the line, use the **image** button in
the toolbar to upload the named file from `docs/media/`, then delete the
placeholder line.

| Placeholder | File | Where it lands |
| --- | --- | --- |
| HEADER IMAGE | `ibm-sperax-featured.png` | Very top, above section 0 |
| FIGURE 1 | `ibm-sperax-integration-paths.png` | Section 3, above the "Figure 1." caption |
| FIGURE 2 | `ibm-sperax-tool-call-halves.png` | Section 4 |
| FIGURE 3 | `ibm-sperax-empathy-decay.png` | Section 6 |
| FIGURE 4 | `ibm-sperax-code-exchange.png` | Section 10 |

The italic caption under each figure is already in the body. Leave it there.

## 4b. Featured image

Use `docs/media/ibm-sperax-featured.png` (2400x1200): the three partner logos on
white, nothing else.

It is built for IBM's stated guidance on that field. Landscape and well over the
1200x600 minimum. No text beyond the logos themselves, since IBM warns that the
card crops differently across the community and text does not survive it. The row
is centred with even margins on all four sides (roughly 210px left and right, 516px
top and bottom), so a tighter crop loses only white space.

Do **not** use the older `ibm-x-threews-lockup.png` here. It carries only IBM and
three.ws, and this post is about three parties.

Regenerate with `node scripts/render-ibm-sperax-featured.mjs`. It crops the IBM
mark out of the existing lockup and reads the other two logos from the three.ws
brand folder and the SperaxOS checkout, so no trademark asset is duplicated into
this repo.

## 5. Search Engine Optimization (click **Show**)

Meta description, 156 characters:

```
The best material on automated-decision integrity I read this year came from two crypto Business Partners. Sperax, three.ws, IBM Granite, and one DeFi agent.
```

Keywords, if the field is offered:

```
embodied AI agents, 3D avatars, DeFi agents, decentralized finance, agent interfaces, web components, watsonx.ai, IBM Granite, MCP, agent governance, decision integrity
```

## 6. Association and visibility

| Field | Value | Note |
| --- | --- | --- |
| Associate this post with a group | Three.ws User Group | Already selected. |
| Who can read your blog entry? | **Reconsider "Selected Group"** | The screenshot shows `Selected Group`, which limits the post to group members. Every earlier post in this group is publicly readable, which is what earns it search traffic and lets non-members find the group. Switch to the public/all-members option unless the intent is a members-only piece. |
| Who can make comments on this? | Members Only | Fine as set. |

---

## Before publishing

- **Confirm the partner-status line.** The post opens by stating that Sperax is
  also an IBM Business Partner. That came from the three.ws side and is not
  independently evidenced here. It is written in the plainest possible form, with
  no tier, program name, or date attached, so a correction is a one-word edit.
  Confirm the wording Sperax uses for its own status first.
- **Do not let section 0 become "why IBM partnered with these companies."** Jessica is
  making a personal, professional case as a decision-management practitioner. She does
  not own IBM's partnership strategy and must not appear to narrate it. This is the
  riskiest edit anyone could make to the draft.
- **Keep the "Being precise about who did what" subsection.** Section 0 opens on a
  triangle of three real relationships (three.ws with Sperax, both with IBM, and the
  runtime on Granite through watsonx.ai), and that subsection is what stops a reader
  collapsing it into "IBM built this." The sentence beginning "IBM did not commission,
  sponsor, review, endorse, or co-build" is the load-bearing one. It is the first
  thing an editor would cut for flow and the one thing that must stay.
- **Check the five figures rendered** in the preview before hitting publish. A
  leftover placeholder line is the most likely thing to slip through.
