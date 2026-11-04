# Privacy Policy

This plugin connects Dify to the free three.ws 3D Studio service
(`https://three.ws/api/mcp-studio`), operated by the three.ws team.

## Data collection

- **No personal data and no credentials.** The plugin asks for no API key,
  account, or token, and stores nothing on the Dify side.
- **What is sent.** When a tool runs, the plugin sends three.ws only the tool's
  inputs: the text prompt, the reference image URL, the GLB URL to rig, or the
  search words. Like any web service, three.ws also sees the IP address of the
  machine running the plugin, which it uses for per-IP rate limiting.

## Data usage

- Prompts and reference images are used to generate the requested 3D model.
  three.ws runs generation on its own infrastructure and on cloud AI providers
  it contracts with; inputs are sent there only to produce the model.
- **Generated models are public files.** Each generated GLB is stored on the
  three.ws CDN at an unguessable URL that anyone with the link can open. Do not
  put private or confidential information in a prompt.
- Search queries are used to answer the search and are not tied to a person.
- No data is sold, and nothing is used for advertising.

## Third-party services

- three.ws: <https://three.ws>, privacy policy at <https://three.ws/legal/privacy>.

## Contact

Open an issue at <https://github.com/nirholas/three.ws/issues>.
