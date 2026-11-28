import { afterEach, describe, expect, it } from "vitest";

import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

describe("hello route", () => {
	it("returns a greeting through the sandbox host", async () => {
		host = await createPluginTestHost();
		const result = await host.invokeRoute("hello");
		expect(result).toEqual({ greeting: "hello", pluginId: "three-ws" });
	});
});
