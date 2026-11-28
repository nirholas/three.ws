# three.ws for Basecamp: listing kit

The three.ws Basecamp chatbot lets anyone in a Basecamp Campfire or Ping type
`!threews a brass desk lamp` and get a textured 3D model posted back in the
room, with a poster image, a 3D viewer link, a phone AR link and a GLB download.

This folder holds what Basecamp needs to list the integration on
[basecamp.com/extras](https://basecamp.com/extras) through
[basecamp/bc-integrations](https://github.com/basecamp/bc-integrations). The
integration itself lives elsewhere in the repo:

- Setup page: [pages/integrations-basecamp.html](../../pages/integrations-basecamp.html), served at <https://three.ws/integrations/basecamp>
- Command URL handler: [api/basecamp/command.js](../../api/basecamp/command.js)
- Chat and job logic: [api/_lib/basecamp-forge.js](../../api/_lib/basecamp-forge.js), run by [api/basecamp/forge-run.js](../../api/basecamp/forge-run.js)
- Command URL store: [api/_lib/basecamp-chatbots.js](../../api/_lib/basecamp-chatbots.js), managed by [api/basecamp/chatbots.js](../../api/basecamp/chatbots.js) and the settings panel [src/dashboard-next/pages/settings-basecamp.js](../../src/dashboard-next/pages/settings-basecamp.js)
- Developer doc: [docs/basecamp.md](../../docs/basecamp.md)

## Files

- `threews.png`: the 256x256 PNG listing icon, rendered from
  `public/brand/three-ws-app-icon-1024.png`. Regenerate with:

  ```bash
  node -e "require('sharp')('public/brand/three-ws-app-icon-1024.png').resize(256,256).png({compressionLevel:9}).toFile('integrations/basecamp/threews.png')"
  ```

## The listing entry

Appended to the end of `integrations.yml` (new listings go last). Category 6 is
"Marketing, Design, and Asset Management". The description is 139 characters,
plain text, as the repo's `bin/ci` requires (160 at most, none of
`< > * _ \` [ ] \ #`).

```yaml
  - title: "three.ws"
    description: "Type !threews and a description in a Campfire or Ping to get a textured 3D model back in the room, with a 3D viewer, AR and a GLB download."
    url: "https://three.ws/integrations/basecamp"
    image: extras/threews.png
    category: 6
```

## Submitting

Basecamp reviews the setup page, so it must be live first: the page and the
`/api/basecamp/*` handlers ship with a normal production deploy, after the
`basecamp_chatbots` migration is applied.

1. Check it is live: `curl -sI https://three.ws/integrations/basecamp` answers 200,
   and a signed-in account can create a command URL in Settings, Basecamp chatbot.
2. Fork, add the two files, run the check and open the pull request:

   ```bash
   gh repo fork basecamp/bc-integrations --clone --remote && cd bc-integrations
   git checkout -b add-threews
   cp ../three.ws/integrations/basecamp/threews.png icons/threews.png
   # append the entry above to the end of integrations.yml
   ruby bin/ci
   git add icons/threews.png integrations.yml
   git commit -m "Add three.ws: 3D models from a Campfire or Ping"
   git push -u origin add-threews
   gh pr create --repo basecamp/bc-integrations --title "Add three.ws" --body-file ../three.ws/integrations/basecamp/PR_BODY.md
   ```

3. If the check on the pull request lists anything, fix it and push again.

The pull request body is [PR_BODY.md](PR_BODY.md).
