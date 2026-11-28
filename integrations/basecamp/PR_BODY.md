Adds three.ws, a Basecamp chatbot that makes 3D models.

Someone types `!threews` and a description in a Campfire or Ping, for example `!threews a low-poly lighthouse on a rocky island`. The chatbot answers at once that the model is being made, then posts the finished model in the same room through the chatbot callback URL: it mentions the person who asked and includes a preview image, a 3D viewer link, a link to view it in AR on a phone, and a GLB download.

Setup page: https://three.ws/integrations/basecamp

How it is set up:

1. Create a command URL in three.ws (free account, Settings, Basecamp chatbot).
2. A Basecamp admin opens a Campfire, chooses Configure chatbots, adds a chatbot named `threews` and pastes the command URL.
3. Type `!threews` and a description in any Campfire or Ping in that account.

It only reads the command text, the sender's name and the callback URL Basecamp sends, and only posts back to Basecamp's own hosts. Each command URL can be revoked from three.ws at any time.

Listing: category 6 (Marketing, Design, and Asset Management), icon `icons/threews.png` (256x256). `ruby bin/ci` passes locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
