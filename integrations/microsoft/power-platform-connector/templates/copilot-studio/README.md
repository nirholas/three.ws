# Copilot Studio sample: 3D Studio Assistant

An agent for Microsoft Copilot Studio that makes 3D models and works with three.ws agents through the three.ws 3D Studio connector. Publish it to Teams or Microsoft 365 Copilot and people can say "make a 3D model of a brass desk lamp" or "ask my support agent what changed this week" in chat.

| File | What it is |
|---|---|
| `agent.json` | The agent: name, description, conversation starters, the five connector tools with the descriptions the orchestrator picks them by, input guidance, and test prompts with the tool each should call |
| `instructions.md` | The agent instructions to paste into the Instructions box |

`npm run package:power-platform-connector -- --check` validates `agent.json` against the connector definition, so every tool and input here exists on the connector.

## Tools

| Tool name in the agent | Connector action |
|---|---|
| Generate a 3D model | Generate a 3D model from text |
| Check a 3D model job | Get generation job |
| List my agents | List my agents |
| Search public agents | Search public agents |
| Talk to an agent | Send a message to an agent |

## Build it

1. In Copilot Studio, **Create** a new agent and skip the conversational setup (**Configure**). Use `name` and `description` from `agent.json`, and paste `instructions.md` into **Instructions**. Leave generative orchestration on.
2. Under **Tools**, choose **Add a tool**, then **Connector**, search for three.ws 3D Studio, and add each action in the table above. For each one:
   - set the tool name and description from `agent.json`;
   - set each input to "Dynamically fill with AI" and paste its description;
   - under **Authentication**, choose "User authentication", so each person signs in with their own three.ws account and "List my agents" shows their own agents.
3. Add the four **Suggested prompts** from `conversationStarters`.
4. In the **Test** pane, send each prompt in `testPrompts` and confirm the activity map calls the expected tool. The 3D model prompts work without a three.ws plan. The agent prompts need a three.ws account with at least one agent.
5. **Publish**, then under **Channels** add Microsoft Teams and Microsoft 365 Copilot.

## Notes

- A model can take a few minutes at standard or high quality. The instructions tell the agent to report a pending job and check it when asked, rather than holding the conversation open.
- "Talk to an agent" answers for any agent the signed-in user owns. Another account's agent answers only once its owner publishes it.
