// Adaptive Cards for three.ws models and agents.
//
// "View in 3D" is a CollabStageAction: Teams opens the three.ws viewer in a
// stage view (a large in-Teams window) instead of a browser tab. The viewer's
// host must be listed in validDomains in appPackage/manifest.json.

import { cardAttachment, ThumbnailCard } from "@microsoft/teams.api";
import {
  AdaptiveCard,
  CardElement,
  CollabStageAction,
  Column,
  ColumnSet,
  Fact,
  FactSet,
  Image,
  OpenUrlAction,
  TabInfo,
  TextBlock,
} from "@microsoft/teams.cards";

import { AgentItem, ModelItem, ogImageUrl, viewerUrl } from "./threews";

const CARD_VERSION = "1.5";
const SKILL_LIMIT = 4;

function stageAction(title: string, glbUrl: string, entityId: string): CollabStageAction {
  const url = viewerUrl(glbUrl, title);
  return new CollabStageAction(
    new TabInfo({ name: title, contentUrl: url, websiteUrl: url, entityId }),
    { title: "View in 3D" }
  );
}

function header(imageUrl: string, altText: string, title: string, subtitle: string): ColumnSet {
  return new ColumnSet({
    columns: [
      new Column(new Image(imageUrl, { altText, size: "Medium" })).withWidth("auto"),
      new Column(
        new TextBlock(title, { size: "Large", weight: "Bolder", wrap: true, style: "heading" }),
        new TextBlock(subtitle, { isSubtle: true, spacing: "None", wrap: true })
      )
        .withWidth("stretch")
        .withVerticalContentAlignment("Center"),
    ],
  });
}

/** A card for a ready-made catalog model or any three.ws model link. */
export function modelCard(model: Pick<ModelItem, "id" | "title" | "glbUrl" | "thumbnailUrl"> &
  Partial<Pick<ModelItem, "license" | "categories" | "kind">>): AdaptiveCard {
  const facts: Fact[] = [];
  if (model.license) facts.push(new Fact("Licence", model.license));
  if (model.categories?.length) facts.push(new Fact("Category", model.categories.join(", ")));
  facts.push(new Fact("Format", "GLB (glTF binary)"));

  const subtitle = model.license === "CC0" ? "Free for any use, no credit needed" : "3D model on three.ws";
  const viewer = viewerUrl(model.glbUrl, model.title);

  return new AdaptiveCard(
    header(model.thumbnailUrl, `Preview of ${model.title}`, model.title, subtitle),
    new FactSet(...facts)
  )
    .withVersion(CARD_VERSION)
    .withActions(
      stageAction(model.title, model.glbUrl, model.id),
      new OpenUrlAction(viewer, { title: "Open in browser" }),
      new OpenUrlAction(model.glbUrl, { title: "Download GLB" })
    );
}

/** A card for a public three.ws agent. */
export function agentCard(agent: AgentItem): AdaptiveCard {
  const body: CardElement[] = [
    header(
      agent.thumbnailUrl || ogImageUrl(agent.name, "/agents"),
      `${agent.name} avatar`,
      agent.name,
      agent.category ? `three.ws agent · ${agent.category}` : "three.ws agent"
    ),
  ];
  if (agent.description) body.push(new TextBlock(agent.description, { wrap: true, maxLines: 4 }));
  if (agent.skills.length) {
    const shown = agent.skills.slice(0, SKILL_LIMIT).join(", ");
    const more = agent.skills.length > SKILL_LIMIT ? ` and ${agent.skills.length - SKILL_LIMIT} more` : "";
    body.push(new TextBlock(`Skills: ${shown}${more}`, { isSubtle: true, wrap: true, size: "Small" }));
  }

  const card = new AdaptiveCard(...body).withVersion(CARD_VERSION);
  if (agent.avatarModelUrl) {
    card.withActions(
      stageAction(`${agent.name} in 3D`, agent.avatarModelUrl, agent.id),
      new OpenUrlAction(agent.pageUrl, { title: "Chat with agent" })
    );
  } else {
    card.withActions(new OpenUrlAction(agent.pageUrl, { title: "Chat with agent" }));
  }
  return card;
}

/** The compact preview Teams shows in the search result list. */
export function previewCard(title: string, text: string, imageUrl: string | null): ThumbnailCard {
  return {
    title,
    text,
    images: imageUrl ? [{ url: imageUrl, alt: title }] : [],
  };
}

/** One message extension result: the full Adaptive Card plus its list preview. */
export function resultAttachment(card: AdaptiveCard, preview: ThumbnailCard) {
  return {
    ...cardAttachment("adaptive", card),
    preview: cardAttachment("thumbnail", preview),
  };
}
