## MCP Server Information

**Server Name:** three-ws
**Repository URL:** https://github.com/nirholas/three.ws
**Brief Description:** Remote Streamable HTTP server at `https://three.ws/mcp`. Generates textured 3D models and rigged avatars from text, searches a free CC0 asset catalog, validates and optimizes glTF/GLB, and runs AI agents with memory, a 3D body and a wallet. OAuth 2.1 with dynamic client registration and PKCE; Docker's gateway registers itself with a loopback redirect, no pre-shared client needed. Docs: https://three.ws/docs/mcp

## Basic Requirements

- [x] **Open Source**: Uses acceptable license (Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause or other permissive license)
- [x] **MCP Compliant**: Implements MCP API specification
- [x] **Active Development**: Recent commits and maintained
- [ ] **Docker Artifact**: Dockerfile (not applicable: remote server)
- [x] **Documentation**: Basic README and setup instructions
- [x] **Security Contact**: Method for reporting security issues (security@three.ws, https://three.ws/.well-known/security.txt)

## Submitter Checklist

- [x] This server meets the basic requirements listed above
- [x] I understand this will undergo automated and manual review.
- [x] I have tested the MCP Server using `task validate -- --name three-ws`
- [x] I have built the MCP Server using `task build -- --tools three-ws`
- [ ] If the server requires credentials to test it, I have [shared test credentials using this form](https://forms.gle/6Lw3nsvu2d6nFg8e6) (not required: a reviewer can create a free three.ws account from the OAuth sign-in page)
