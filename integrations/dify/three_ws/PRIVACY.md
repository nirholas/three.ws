# Privacy Policy

This plugin connects Dify to the free three.ws 3D Studio service
(`https://three.ws/api/mcp-studio`), operated by the three.ws team.

## Data collection

- **One credential: your three.ws API key.** Making a model needs a free
  three.ws account. The key you paste is stored by Dify as an encrypted
  provider credential and is sent only to three.ws, as an
  `Authorization: Bearer` header. Revoke it any time at
  <https://three.ws/dashboard/api-keys>.
- **What is sent.** When a tool runs, the plugin sends three.ws the key and the
  tool's inputs: the text prompt, the reference image URL, the GLB URL to rig,
  or the search words. Like any web service, three.ws also sees the IP address
  of the machine running the plugin.

## Data usage

- Prompts and reference images are used to generate the requested 3D model.
  three.ws runs generation on its own infrastructure and on cloud AI providers
  it contracts with; inputs are sent there only to produce the model.
- **Models belong to your account.** Each model is filed under the account the
  key belongs to and is unlisted (kept out of the public gallery) until you
  publish it. The GLB itself is stored on the three.ws CDN at an unguessable URL
  that anyone with the link can open, so do not put private or confidential
  information in a prompt.
- Search queries are used to answer the search and are not tied to a person.
- No data is sold, and nothing is used for advertising.

## Third-party services

- three.ws: <https://three.ws>, privacy policy at <https://three.ws/legal/privacy>.

## Contact

Open an issue at <https://github.com/nirholas/three.ws/issues>.
