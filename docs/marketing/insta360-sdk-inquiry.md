# Insta360 Media SDK inquiry (draft, not sent)

Status: draft for the owner. Nobody has contacted Insta360. Send it only if you decide to pursue the Media SDK as an upgrade path; the shipped pipeline does not need it (see [docs/research/insta360-360-capture-2026-11.md](../research/insta360-360-capture-2026-11.md), section 3 and section 7).

- **To:** enterprise@insta360.com
- **Alternative route:** the SDK application form at https://www.insta360.com/sdk/apply (paste the body below into its "use case" field)
- **From:** the three.ws owner address
- **Subject:** Media SDK terms for server-side stitching, and partner directory listing

---

Hello Insta360 team,

I run three.ws, a web platform where people turn their own footage and photos into 3D they can download and keep. We now accept 360 footage: a stitched equirectangular video or photo, or a raw `.insv` / `.insp` file, becomes a Gaussian splat scene (PLY and SPZ) or a depth mesh (GLB) that the user owns. Many of the people asking for this shoot on Insta360 cameras, from the ONE X2 through the X5.

Today we stitch raw files with our own open-source code. We would like to offer the best possible stitch to Insta360 owners, and the Media SDK is the obvious way to do that. Before we apply for or integrate it, we need written answers to a few questions about the terms:

1. **Server-side use.** May the Media SDK run on our own servers (Linux, NVIDIA GPU, inside a Docker container on Google Cloud) to stitch files that our users upload to us? The SDK would never be shipped to end users; only the stitched output would be returned to the person who uploaded the file.
2. **Commercial use.** three.ws charges for some processing. Is commercial use of the SDK in that setting permitted, and under what licence, fee or revenue terms?
3. **Agreements.** Does access require an NDA, a business licence or a signed agreement beyond the online EULA? If so, could you send the documents for review?
4. **Attribution.** Are there attribution or naming requirements for products that use the SDK (for example, how we may say a feature "works with Insta360 cameras")?
5. **Partner or plugin directory.** Does Insta360 maintain a partner, plugin or "works with" directory for third-party tools that accept Insta360 files? If so, how would three.ws apply to be listed?

We describe Insta360 support factually and never imply a partnership or endorsement that does not exist. A written reply we can keep on file would let us decide quickly.

Thank you for your time.

Best regards,
The three.ws team
https://three.ws
