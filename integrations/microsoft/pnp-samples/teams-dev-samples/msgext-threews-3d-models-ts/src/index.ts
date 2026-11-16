import "./proxy";
import { ManagedIdentityCredential } from "@azure/identity";
import { App } from "@microsoft/teams.apps";
import { ConsoleLogger } from "@microsoft/teams.common/logging";

import { agentCard, modelCard, previewCard, resultAttachment } from "./cards";
import { getAgent, ogImageUrl, parseThreewsLink, searchAgents, searchModels } from "./threews";

const createTokenFactory = () => {
  return async (scope: string | string[], tenantId?: string): Promise<string> => {
    const managedIdentityCredential = new ManagedIdentityCredential({
      clientId: process.env.CLIENT_ID,
    });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, { tenantId });
    return tokenResponse.token;
  };
};

// Managed identity in Azure. Locally the bot uses the client id and secret
// from .localConfigs, or no auth at all in Microsoft 365 Agents Playground.
const options =
  process.env.BOT_TYPE === "UserAssignedMsi"
    ? { clientId: process.env.CLIENT_ID || "", token: createTokenFactory() }
    : {};

const logger = new ConsoleLogger("threews-3d-models", { level: "info" });

const app = new App({
  ...options,
  logger,
  skipAuth: !process.env.CLIENT_ID,
});

const HELP_TEXT =
  "Use the three.ws 3D models message extension from the compose box: search ready-made 3D models or public three.ws agents, " +
  "or paste a three.ws model or agent link to get a card with a View in 3D button.";

function messageResult(text: string) {
  return { composeExtension: { type: "message" as const, text } };
}

function listResult(attachments: ReturnType<typeof resultAttachment>[]) {
  return { composeExtension: { type: "result" as const, attachmentLayout: "list" as const, attachments } };
}

app.on("install.add", async ({ send }) => {
  await send(HELP_TEXT);
});

app.on("message", async ({ send }) => {
  await send(HELP_TEXT);
});

app.on("message.ext.query", async ({ activity }) => {
  const { commandId } = activity.value;
  // With initialRun, Teams opens the command with { name: "initialRun" } instead
  // of the typed query; that case lists the default results.
  const parameter = activity.value.parameters?.[0];
  const query = parameter && parameter.name !== "initialRun" ? String(parameter.value ?? "").trim() : "";

  try {
    if (commandId === "searchModels") {
      const models = await searchModels(query);
      if (!models.length) return messageResult(`No ready-made 3D models match "${query}". Try a simpler word such as chair, lamp or plant.`);
      return listResult(
        models.map((model) =>
          resultAttachment(
            modelCard(model),
            previewCard(model.title, `${model.license} · ${model.categories.join(", ") || model.kind}`, model.thumbnailUrl)
          )
        )
      );
    }

    if (commandId === "searchAgents") {
      const agents = await searchAgents(query);
      if (!agents.length) return messageResult(`No public three.ws agents match "${query}". Try a topic such as coach, tutor or guide.`);
      return listResult(
        agents.map((agent) =>
          resultAttachment(agentCard(agent), previewCard(agent.name, agent.description, agent.thumbnailUrl))
        )
      );
    }
  } catch (err) {
    logger.error(`search ${commandId} failed`, err);
    return messageResult("three.ws could not be reached just now. Try the search again in a moment.");
  }

  return { status: 400 };
});

app.on("message.ext.query-link", async ({ activity }) => {
  const link = activity.value.url ? parseThreewsLink(activity.value.url) : null;
  if (!link) return { status: 200 };

  try {
    if (link.type === "model") {
      const thumbnailUrl = ogImageUrl(link.title, "/viewer");
      const card = modelCard({ id: link.glbUrl, title: link.title, glbUrl: link.glbUrl, thumbnailUrl });
      return listResult([resultAttachment(card, previewCard(link.title, "3D model on three.ws", thumbnailUrl))]);
    }

    const agent = await getAgent(link.agentId);
    if (!agent) return { status: 200 };
    return listResult([resultAttachment(agentCard(agent), previewCard(agent.name, agent.description, agent.thumbnailUrl))]);
  } catch (err) {
    // A failed unfurl falls back to Teams' default link preview.
    logger.error("link unfurl failed", err);
    return { status: 200 };
  }
});

(async () => {
  await app.start();
})();
