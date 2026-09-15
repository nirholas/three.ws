# NVIDIA Inception response, 2026-09-14

Private operating record for NVIDIA's reply to the three.ws catalog, Showcase,
co-marketing, ACE, and GTC request. This file is under `docs/ops/`, so it is excluded from
the public docs build and `docs/ALL.md`.

## Correspondence record

| Field             | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Received          | 2026-09-14, 11:39 AM (mail-client display; timezone not shown)                 |
| From              | NVIDIA Inception program inbox                                                 |
| Recipients        | three.ws support and founder inboxes                                           |
| Subject           | `Re: three.ws (Inception member): catalog listing, Showcase, and co-marketing` |
| Source evidence   | Root-workspace screenshot `Screenshot 2026-09-14 at 10.50.16 PM.png`           |
| Original outbound | Sent 2026-09-04; recorded in `docs/nvidia-apps-catalog-request.md`             |

Do not commit the screenshot. Root screenshots are ignored by `.gitignore`, and this one
contains personal correspondence metadata. This record preserves the operational facts
without publishing inbox details or treating a private email as marketing collateral.

## What NVIDIA said

This is a structured summary, not a verbatim publication of the email.

### Accelerated Application Catalog

NVIDIA gave four conditions/signals for catalog consideration:

1. The product or service uses NVIDIA technologies **at runtime**.
2. Its Development Stage in the Inception portal is **Shipping**.
3. The Product page accurately answers both technology questions: what is currently used
   and what is being considered. Supporting evidence belongs in both **Product
   Description** and **Technical Details**.
4. The record includes a **product logo** and **brand color**.

Qualifying product records are reviewed periodically. NVIDIA did not provide a separate
catalog form, submission ID, review date, or guarantee of inclusion. The completed portal
record is therefore the active catalog application.

### Co-marketing assets

The Marketing Assets page is available again. The route NVIDIA supplied is:

`Inception portal > Benefits > Co-Branded Marketing Assets`

The program brand site contains customizable social media kits, digital badges, event
content, social tips, and brand guidance. Downloading and reviewing the current package is
an authenticated owner action. Do that before publishing the prepared announcement copy.

### Technical resources

NVIDIA pointed three.ws to the portal's personalized **Recommendations** tab, the NVIDIA
Developer Forums, NVIDIA On-Demand, the NVIDIA SDK glossary, NGC Catalog, and the Inception
FAQ. These are resources rather than application routes. three.ws already has two live
Developer Forum posts, two additional drafts, a complete NVIDIA model map, and a prepared
NGC candidate.

### GTC Startup Pavilion

The Pavilion is **exclusive and invite-only**. NVIDIA said the selection signal is the
member database, and advised members to:

- keep company and product profiles current, including NVIDIA software in use or under
  consideration;
- build demos that clearly show how NVIDIA technology accelerates the solution; and
- work with NVIDIA contacts while developing the product and business.

There is no Pavilion application or promised decision date to chase. Our controllable work
is a complete portal record, a reliable NVIDIA-specific demo, and an ongoing technical
relationship. The public GTC call for submissions is a separate speaking/poster route and
can still be watched when NVIDIA opens the next cycle.

### Not answered

The reply did not directly answer two asks from the 2026-09-04 email:

1. whether there is a separate nomination path for the **Inception Startup Showcase**; and
2. whether the program team can introduce three.ws to the **ACE / digital-human team**.

A focused reply for those two points is drafted below. Do not repeat the catalog,
co-marketing, or Pavilion questions NVIDIA already answered.

## Decision record

| Workstream               | State after reply                                             | Decision                                                                                                       |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Accelerated Apps Catalog | Eligible path confirmed; portal record still needs correction | Treat the product record as the application. Complete every field NVIDIA named, then wait for periodic review. |
| Co-marketing             | Access restored; package not yet retrieved                    | Download the current kit and compare its badge/guidelines with the checked-in asset before posting.            |
| Startup Showcase         | Original ask unanswered                                       | Ask one narrow routing question in the existing thread.                                                        |
| ACE introduction         | Original ask unanswered                                       | Ask once in the same focused reply and include the live Audio2Face demo.                                       |
| GTC Pavilion             | Invite-only; no application                                   | Stop searching for an intake form. Keep the profile and demo current and build contact-level proof.            |
| GTC CFP                  | Separate from Pavilion                                        | Continue the periodic watch for speaking/poster submissions, without describing it as a Pavilion route.        |
| Technical publishing     | Self-serve and already proven                                 | Publish the prepared browser-digital-human forum post when the owner approves it.                              |
| NGC                      | Separate partner/listing process                              | Continue from `docs/nvidia-ngc-listing.md`; NVIDIA's resource link did not change its prerequisites.           |

## Authenticated owner actions

These are the only steps this repository cannot perform.

### 1. Complete the main `three.ws` product record

Open `Inception portal > Products > three.ws > Edit` and use this payload:

| Portal field      | Value                            |
| ----------------- | -------------------------------- |
| Development Stage | **Shipping**                     |
| Product name      | `three.ws`                       |
| Product URL       | `https://three.ws`               |
| Product logo      | `public/brand/three-ws-mark.png` |
| Brand color       | `#0B0D0C`                        |

**Currently used:** Riva, Audio2Face, applicable NIM microservices, CUDA Toolkit, cuDNN,
cuBLAS, CUDA Python, NVIDIA Kaolin, nvdiffrast, L4 GPUs, and RTX PRO 6000 Blackwell where
those choices exist in the form.

**Considering:** TensorRT, Triton Inference Server, and Omniverse Kit.

**Remove:** DeepVariant NIM. It is not part of three.ws.

Paste the prepared Product Description and Technical Details from the portal payload in
`docs/nvidia-apps-catalog-listing.md`. Save, reopen the record, and capture a screenshot
showing the saved stage, technology sections, description, technical details, logo, and
brand color.

Completion evidence: saved-record screenshot plus the portal's product-row view.

### 2. Add the second product record

After the main record is correct, add `three.ws Agent Embed (<agent-3d>)` using the complete
field set in `docs/nvidia-apps-catalog-listing.md`. This is a distinct shipping product
surface for the Digital Humans / Conversational AI workload. Do not create any additional
near-duplicate records.

Completion evidence: saved second-product row and its detail view.

### 3. Retrieve the official co-marketing package

Open `Inception portal > Benefits > Co-Branded Marketing Assets`, then:

1. download the current member badge package, social templates, event assets, and brand
   guidelines;
2. retain the original archive and its download date outside the public web root;
3. compare the supplied badge against `public/marks/nvidia-inception-badge.svg`;
4. replace the checked-in badge only if NVIDIA's current package differs;
5. record required clear space, backgrounds, attribution, and social-tag rules in
   `marketing/nvidia-inception/README.md`; and
6. publish nothing until that comparison is complete.

Completion evidence: archive name/date, guideline version, and either a badge diff or a
record that the existing SVG matches.

### 4. Send the focused reply

Reply in the existing thread after saving the portal record. Do not attach the private
screenshot and do not restate the five-part original email.

```text
Hello,

Thank you. This clarifies the catalog review path, the restored co-branded asset
benefit, and the invite-only GTC Pavilion process. We are updating the Shipping
product record with the runtime technologies, supporting Product Description and
Technical Details, logo, and brand color, and will keep the record and demo current.

Two questions from my original note remain:

1. Is Inception Startup Showcase consideration also driven by the product record,
or is there a separate nomination step?
2. Could you point me to the appropriate ACE / digital-human contact for our
browser-native Audio2Face-3D and Riva implementation?

The live, no-install demo is https://three.ws/demos/audio2face and the complete
runtime map is https://three.ws/docs/nvidia-models.

Thank you,

Nicholas
three.ws
https://three.ws
```

Completion evidence: sent timestamp in the existing thread. Record any answer in this
file and route it through the table in `docs/nvidia-apps-catalog-request.md`.

### 5. Use the technical channels

- Review `Inception portal > Recommendations` after the product save; record only relevant,
  actionable recommendations.
- Publish `docs/nvidia-forum-browser-digital-human.md` to the NVIDIA Developer Forums when
  owner-approved, then send the live URL in the existing Inception thread as proof.
- Continue the NGC candidate from `docs/nvidia-ngc-listing.md` as a separate workstream.

## Repository work completed from this response

- The response and its decisions are recorded privately here.
- The Accelerated Apps listing kit now maps every NVIDIA-stated requirement to an exact
  field, paste-ready copy, asset, or owner action.
- The original request log now records the response and contains a focused reply for the
  two unanswered asks.
- The visibility map, listings register, partner opportunity tracker, growth ledger, and
  NVIDIA marketing README now reflect the reply.
- The prepared 1920×1080 NVIDIA page, Audio2Face demo, and Forge captures remain the demo
  evidence. No new image was needed.

## Follow-up policy

- Do not send the old 2026-09-25 "no reply" follow-up; NVIDIA replied on 2026-09-14.
- Send only the focused two-question reply above after the portal record is saved.
- Do not ask for a GTC Pavilion application; NVIDIA explicitly said it is invite-only.
- Do not call the product catalog-listed until a public catalog URL exists.
- Check the public catalog monthly after the complete record is saved. Record a live URL,
  not an inferred approval.
