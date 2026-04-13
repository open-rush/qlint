import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePlatform, requirePlatform, saveGlobalConfig, getGlobalConfig } from "../src/config.js";

describe("config resolution (isolated)", () => {
	const testDir = join(tmpdir(), `qlint-cfg-${Date.now()}`);
	const globalDir = join(testDir, "global-qlint");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		mkdirSync(globalDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("CLI flag takes highest priority over project and global", () => {
		writeFileSync(join(globalDir, "config.json"), '{"platform":"global-plat"}');
		writeFileSync(join(projectDir, ".qlint.json"), '{"platform":"project-plat"}');

		const result = resolvePlatform("cli-plat", { globalDir, cwd: projectDir });
		expect(result).toBe("cli-plat");
	});

	it("project config takes priority over global config", () => {
		writeFileSync(join(globalDir, "config.json"), '{"platform":"global-plat"}');
		writeFileSync(join(projectDir, ".qlint.json"), '{"platform":"project-plat"}');

		const result = resolvePlatform(undefined, { globalDir, cwd: projectDir });
		expect(result).toBe("project-plat");
	});

	it("global config is used when no CLI flag and no project config", () => {
		writeFileSync(join(globalDir, "config.json"), '{"platform":"global-plat"}');
		// No .qlint.json in projectDir

		const result = resolvePlatform(undefined, { globalDir, cwd: projectDir });
		expect(result).toBe("global-plat");
	});

	it("returns undefined when nothing is configured", () => {
		// No files written
		const result = resolvePlatform(undefined, { globalDir, cwd: projectDir });
		expect(result).toBeUndefined();
	});

	it("requirePlatform throws when nothing is configured", () => {
		expect(() => requirePlatform(undefined, { globalDir, cwd: projectDir })).toThrow(
			"No platform configured",
		);
	});

	it("requirePlatform returns platform when global config exists", () => {
		writeFileSync(join(globalDir, "config.json"), '{"platform":"elasticsearch"}');

		const result = requirePlatform(undefined, { globalDir, cwd: projectDir });
		expect(result).toBe("elasticsearch");
	});
});

describe("config persistence (isolated)", () => {
	const testDir = join(tmpdir(), `qlint-persist-${Date.now()}`);
	const globalDir = join(testDir, "global-qlint");

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("saveGlobalConfig + getGlobalConfig roundtrip", () => {
		saveGlobalConfig({ platform: "datadog" }, globalDir);
		const loaded = getGlobalConfig(globalDir);
		expect(loaded.platform).toBe("datadog");
	});

	it("saveGlobalConfig creates directory if missing", () => {
		const newDir = join(testDir, "new-dir");
		saveGlobalConfig({ platform: "loki" }, newDir);
		const loaded = getGlobalConfig(newDir);
		expect(loaded.platform).toBe("loki");
	});

	it("getGlobalConfig returns empty object for missing file", () => {
		const config = getGlobalConfig(join(testDir, "nonexistent"));
		expect(config).toEqual({});
	});
});
