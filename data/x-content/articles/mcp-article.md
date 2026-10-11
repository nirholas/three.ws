three.ws runs an MCP server that needs no account and no API key. Add its address to Claude Code, or to any client that speaks MCP over HTTP, and the assistant you are talking to gets fifteen free tools for 3D work: turn text or an image into a textured model, generate a rigged avatar, rig a model you already have, refine one by describing the change, search a catalog of ready-made assets, give the assistant a persistent body that speaks, and render a model from several angles so the assistant can see what it made. We connected to it while writing this, and the session below is that run.

## Connecting

In Claude Code, put this in `.mcp.json` at the root of a project, and the tools are there the next time a session starts:

```json
{
  "mcpServers": {
    "three-ws-studio": {
      "type": "http",
      "url": "https://three.ws/api/mcp-studio"
    }
  }
}
```

In the Claude apps, the address goes in as a custom connector with authentication set to None. Any other client only needs to know that the server speaks MCP over Streamable HTTP, protocol version 2025-06-18, and answers every request synchronously over POST.

## What the fifteen tools do

- **forge_free** turns a text prompt into a textured GLB. It takes a draft, standard or high tier, and standard is what you get when you leave the tier out.
- **text_to_avatar** and **mesh_forge** generate an avatar or an art-directed mesh from text or from a reference image.
- **rig_mesh** adds a skeleton to a model you already have, so it can be animated.
- **forge_avatar** generates a rigged, animation-ready avatar in one call.
- **refine_model** takes a model and a sentence describing a change, and returns the refined model with its version lineage.
- **check_job** collects a generation that outlived the tool call that started it, and **get_job** reports the same job as a status a script can branch on, with progress and the seconds that remain.
- **look_at_model** renders a model and hands the frames back as images.
- **search_catalog**, **get_catalog_item** and **get_item_source** search the platform's free asset catalog of CC0 props, rigged characters and motion clips, read one item in full, and return paste-ready code that renders it on any site.
- **create_agent_persona**, **get_agent_persona** and **persona_say** save a rigged model as a persistent agent body, reload it by id in a later session, and speak a reply through it with lip-sync, emotion and gesture.

## A real session

We used the official MCP TypeScript SDK to connect with no credentials at all, list the tools, and call look_at_model on a CC0 film camera from the platform's free [asset catalog](https://three.ws/objects). The server marks five of the fifteen tools read-only: look_at_model, the three catalog tools and get_agent_persona. look_at_model changes nothing on the server, so it was the right tool to call against production.

![The run, unedited. The client connects to the free 3D Studio server with no key, reads its protocol version, lists all fifteen tools with the five read-only ones marked, then calls look_at_model on a GLB of a vintage film camera and prints the text blocks and image frames that came back.](/x-media/mcp-article/session.png)

The tool answered with one text block, followed by four PNG frames, each introduced by the angle it shows. The text block opens with the angle list, then the four plain links that come with any model result (viewer, GLB, poster PNG and embed HTML), then a reading of the geometry:

> Rendered this model from 4 angle(s): three-quarter, front, side, back.
>
> Geometry: 18,682 triangles, a normal real-time budget for a hero prop or character.

![The four frames look_at_model returned for the camera, as the client received them: three-quarter, front, side and back, each rendered on the server and labelled with the camera angle it was taken from.](/x-media/mcp-article/four-views.png)

## Why the assistant needs to look

A GLB file is opaque to a language model. Before this tool, an assistant that generated a model could hand you a link and had no way to check its own work. With frames in hand it can answer the questions a person would ask at a glance: is the subject complete and recognisable, is the far side finished, is anything melted, fused or missing. The text that comes back ends by telling the model to generate again with a prompt that names the specific fault, which turns one-shot generation into a loop the assistant can run by itself.

By default it renders four views at 512 pixels, which is enough to judge form without flooding the conversation. A caller can ask for up to six angles and frames up to 1024 pixels. It works on any public GLB over https, not only on models made by the platform, and its structured result carries a link that opens the same model in the browser viewer. That viewer is where the cover of this article was captured.

## Limits

The server is free, so it is rate limited per IP address: four generations a minute and 30 an hour. look_at_model rides the same quota, because it renders frames on the server. check_job and the catalog tools never count against it, so collecting a slow job or searching for a ready-made asset costs nothing.

A generation can take longer than one tool call. When it does, the call returns a pending job, and check_job collects it later rather than letting it be lost. Asking forge_free for the high tier runs on a self-hosted GPU worker that scales to zero; if that lane refuses or times out, the call degrades to standard rather than failing the conversation.

The catalog tools are on this server for a reason. The platform's main MCP server lists the same three, but a full MCP client that connects there is sent through sign-in first, because most of that server's tools act on an account. With no account, the free server is where a client reaches the catalog, and the server's own instructions tell the assistant to search it before generating anything.

The tool reference, tiers and quotas are on the [3D Studio MCP page](https://three.ws/docs/mcp-studio). Ready-made prompts that drive these tools are in the [prompt library](https://three.ws/prompts).
