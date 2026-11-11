# Ask your agent from a Teams channel

Put one of your three.ws agents in a Teams channel. Every new message posted in the channel goes to the agent, and its answer comes back as a reply in the thread.

## What it does

1. **Trigger:** Teams "When a new channel message is added" on the channel you choose. It checks once a minute, fires once per message, and a trigger condition skips anything not posted by a person, so the flow never answers its own replies.
2. Content Conversion "Html to text" strips the Teams formatting from the message.
3. **three.ws "Send a message to an agent"** sends the text (up to 4000 characters) to the agent you chose.
4. Teams "Reply with a message in a channel" posts the agent's name and answer in the thread. If the agent call fails, the reply says so and gives the HTTP status, so people know to check the agent id or the connection.

## Before you import

- A three.ws agent. One of your own always answers you. Another account's agent answers only if its owner has published it.
- A Teams team and channel the flow bot can post in.
- A three.ws connection signed in as the agent's owner.

## Parameters

| Parameter | What to enter |
|---|---|
| Team id, Channel id | The channel to listen in (pick them in the trigger to fill these in) |
| Agent id | The agent that answers. The Agent dropdown in "Send a message to an agent" lists your own agents |

## Limits

Each three.ws account has its own rate limit on agent messages, so a very busy channel can see replies slow down. Replies inside threads are not sent to the agent: start a new post to ask a new question.

## Import

Import `workflow.json` as described in [the templates README](../README.md), map the Teams, Content Conversion and three.ws connection references, and fill in the parameters. Post a question in the channel to test it.
