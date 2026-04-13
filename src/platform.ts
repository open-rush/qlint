/**
 * Platform adapter interface — each observability platform implements this.
 */

export type FilterOp =
	| "="
	| "!="
	| ">"
	| "<"
	| ">="
	| "<="
	| "in"
	| "not_in"
	| "regex"
	| "not_regex";

export type BuildFilter = {
	field: string;
	op: FilterOp;
	value: string | number | string[];
};

export type BuildInput = {
	filters: BuildFilter[];
	timeRange?: string;
	fulltext?: string;
	aggregation?: {
		fn: string;
		field?: string;
		groupBy?: string[];
	};
};

export type ValidateResult = {
	valid: boolean;
	errors?: string[];
};

export interface PlatformAdapter {
	readonly name: string;
	readonly displayName: string;
	validate(ql: string): ValidateResult;
	build(input: BuildInput): string;
}

export type Platform =
	| "octopus"
	| "elasticsearch"
	| "datadog"
	| "loki"
	| "sls"
	| "guance";

const adapters = new Map<string, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
	adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): PlatformAdapter {
	const adapter = adapters.get(name);
	if (!adapter) {
		const available = [...adapters.keys()].join(", ");
		throw new Error(
			`Unknown platform: "${name}". Available: ${available || "(none registered)"}`,
		);
	}
	return adapter;
}

export function listAdapters(): PlatformAdapter[] {
	return [...adapters.values()];
}
