import { describe, expect, it } from "vitest";
import { getAdapter, listAdapters, registerAdapter } from "../src/platform.js";
import "../src/platforms/octopus.js";

describe("platform registry", () => {
	it("octopus adapter is registered", () => {
		const adapter = getAdapter("octopus");
		expect(adapter.name).toBe("octopus");
		expect(adapter.displayName).toBeTruthy();
	});

	it("listAdapters includes octopus", () => {
		const adapters = listAdapters();
		expect(adapters.some((a) => a.name === "octopus")).toBe(true);
	});

	it("unknown platform throws", () => {
		expect(() => getAdapter("nonexistent")).toThrow("Unknown platform");
	});

	it("error message lists available platforms", () => {
		try {
			getAdapter("nonexistent");
		} catch (e: unknown) {
			expect((e as Error).message).toContain("octopus");
		}
	});
});
