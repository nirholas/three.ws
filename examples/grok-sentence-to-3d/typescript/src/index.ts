// Grok finds or makes a 3D chair through the three.ws studio server.
//
// Uses the official xAI TypeScript SDK with the three.ws studio server as a remote MCP tool. xAI
// connects to the server and runs the tool calls on its own side; this script streams them as they
// happen and prints the final GLB URL and a viewer link.
//
//   XAI_API_KEY=... THREE_WS_API_KEY=... npm start
//   npm run check                    three.ws leg only: list tools, search the catalog (no xAI key)
//   npm start -- "a brass desk lamp" any other request
//
// Keys are read from the environment only and are never printed.

import { APIError, SpaceXSI, type InputItem } from "@xai-official/sdk";
import { mcp } from "@xai-official/sdk/tools";
import {
  ALLOWED_TOOLS,
  COLLECT_PROMPT,
  EXIT_FAILED,
  EXIT_NO_KEY,
  EXIT_OK,
  MAX_ROUNDS,
  MCP_URL,
  MODEL,
  WAIT_BETWEEN_ROUNDS_MS,
  checkThreeWs,
  describeError,
  findGlbUrl,
  firstPrompt,
  parseArgs,
  viewerLink,
  xaiKey,
} from "./lib.ts";

async function check(): Promise<number> {
  const { lines, missing, items } = await checkThreeWs();
  for (const line of lines) console.log(line);
  if (missing.length) {
    console.error(`error    the server does not offer: ${missing.join(", ")}`);
    return EXIT_FAILED;
  }
  if (!items.length) {
    console.error("error    search_catalog returned no chairs");
    return EXIT_FAILED;
  }
  for (const item of items) console.log(`catalog  ${item.title}  ${item.url}`);
  console.log("ok       three.ws leg is live");
  return EXIT_OK;
}

async function run(task: string): Promise<number> {
  const apiKey = xaiKey();
  if (!apiKey) {
    console.error("error    set XAI_API_KEY (create one at https://console.x.ai), or run with --check");
    return EXIT_NO_KEY;
  }
  const threeWsKey = process.env.THREE_WS_API_KEY;
  if (!threeWsKey) {
    console.error(
      "note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys",
    );
  }

  // The key is passed in so GROK_API_KEY works too; the SDK itself only reads XAI_API_KEY.
  const client = new SpaceXSI({ apiKey, retryBeforeOutput: true, maxRetries: 3 });
  const tools = [
    mcp({
      server_url: MCP_URL,
      server_label: "three-ws",
      server_description: "Free 3D studio: search CC0 3D assets, or make a textured GLB from one sentence.",
      allowed_tools: ALLOWED_TOOLS,
      authorization: threeWsKey,
    }),
  ];
  const input: InputItem[] = [{ role: "user", content: firstPrompt(task) }];

  let text = "";
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // xAI runs the tool calls; the stream reports each one when its arguments are complete.
    const stream = await client.responses.create({
      model: MODEL,
      input,
      tools,
      reasoning: { effort: "low" },
      max_turns: 10,
      stream: true,
    });
    const response = await stream
      .on("server_tool_call", (call) => {
        if (call.type === "mcp_call") console.log(`tool     ${call.server_label}___${call.name} ${call.arguments.slice(0, 200)}`);
      })
      .done();
    text = response.toText();
    const glb = findGlbUrl(text);
    if (glb) {
      console.log(`\n${text.trim()}\n`);
      console.log(`glb      ${glb}`);
      console.log(`viewer   ${viewerLink(glb)}`);
      return EXIT_OK;
    }
    if (round === MAX_ROUNDS) break;
    console.log(`round ${round}: no GLB yet, asking Grok to collect the job again in ${WAIT_BETWEEN_ROUNDS_MS / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_BETWEEN_ROUNDS_MS));
    // Responses are not stored: carry Grok's output into the next round with toInput().
    input.push(...response.toInput(), { role: "user", content: COLLECT_PROMPT });
  }

  console.error(`error    no GLB after ${MAX_ROUNDS} rounds; the last reply was:\n${text}`);
  return EXIT_FAILED;
}

async function main(argv: string[]): Promise<number> {
  const { check: checkOnly, task } = parseArgs(argv);
  try {
    return checkOnly ? await check() : await run(task);
  } catch (err) {
    // The network boundary: report, never a stack trace.
    console.error(`error    ${describeError(err, APIError.is)}`);
    return EXIT_FAILED;
  }
}

process.exitCode = await main(process.argv.slice(2));
