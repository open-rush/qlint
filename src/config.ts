import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type QlintConfig = {
	platform?: string;
};

const PROJECT_CONFIG_NAME = ".qlint.json";

function defaultGlobalDir(): string {
	return join(homedir(), ".qlint");
}

function readJsonFile(path: string): QlintConfig | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8")) as QlintConfig;
	} catch {
		return null;
	}
}

function findProjectConfig(startDir?: string): QlintConfig | null {
	let dir = startDir ?? process.cwd();
	const root = "/";
	while (dir !== root) {
		const configPath = join(dir, PROJECT_CONFIG_NAME);
		const config = readJsonFile(configPath);
		if (config) return config;
		const parent = join(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export type ResolveOptions = {
	globalDir?: string;
	cwd?: string;
};

/**
 * Resolve platform with priority: CLI flag > project .qlint.json > global ~/.qlint/config.json
 */
export function resolvePlatform(cliPlatform?: string, opts?: ResolveOptions): string | undefined {
	if (cliPlatform) return cliPlatform;

	const projectConfig = findProjectConfig(opts?.cwd);
	if (projectConfig?.platform) return projectConfig.platform;

	const globalConfigPath = join(opts?.globalDir ?? defaultGlobalDir(), "config.json");
	const globalConfig = readJsonFile(globalConfigPath);
	return globalConfig?.platform;
}

export function requirePlatform(cliPlatform?: string, opts?: ResolveOptions): string {
	const platform = resolvePlatform(cliPlatform, opts);
	if (!platform) {
		throw new Error(
			"No platform configured. Run `qlint config -p <platform>` or use --platform flag.",
		);
	}
	return platform;
}

export function saveGlobalConfig(config: QlintConfig, globalDir?: string): void {
	const dir = globalDir ?? defaultGlobalDir();
	const configPath = join(dir, "config.json");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function getGlobalConfig(globalDir?: string): QlintConfig {
	const configPath = join(globalDir ?? defaultGlobalDir(), "config.json");
	return readJsonFile(configPath) ?? {};
}
