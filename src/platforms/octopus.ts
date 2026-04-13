import {
	type BuildInput,
	type PlatformAdapter,
	type ValidateResult,
	registerAdapter,
} from "../platform.js";

/**
 * Octopus LogQL adapter (API-level syntax).
 *
 * Supported by the OpenAPI (/infra-octopus-openapi):
 *   field=value  field!=value  field>500  field>=500  field<500  field<=500
 *   field in (a, b, c)   NOT field in (a, b)
 *   NOT field=value
 *   "fulltext search"
 *   field = pattern*                (wildcard)
 *   AND  OR  NOT  (parentheses)
 *
 * NOT supported by API (frontend-only UI syntax):
 *   field regexp "pattern"          → use wildcard or pass regex via separate API param
 *   ... | stats count(*) by (field) → use aggregate API endpoint with -a/-g params
 */

const COMPARE_OPS = ["!=", ">=", "<=", ">", "<", "="] as const;

function escapeValue(value: string): string {
	if (/[\s(),'"]/.test(value) || value === "") {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

function buildCondition(filter: BuildInput["filters"][number]): string {
	const { field, op, value } = filter;

	if (op === "in" || op === "not_in") {
		const values = Array.isArray(value) ? value : [String(value)];
		const valList = values.map((v) => escapeValue(String(v))).join(", ");
		const prefix = op === "not_in" ? "NOT " : "";
		return `${prefix}${field} in (${valList})`;
	}

	if (op === "regex" || op === "not_regex") {
		throw new Error(
			`"regex" operator is not supported by the Octopus API. Use wildcard instead: ${field}=${String(value).replace(/\.\*$/, "*")}`,
		);
	}

	const validOps: Record<string, string> = {
		"=": "=",
		"!=": "!=",
		">": ">",
		"<": "<",
		">=": ">=",
		"<=": "<=",
	};
	const qlOp = validOps[op];
	if (!qlOp) {
		throw new Error(
			`Unsupported operator "${op}" for Octopus. Valid: ${Object.keys(validOps).join(", ")}, in, not_in`,
		);
	}
	return `${field}${qlOp}${escapeValue(String(value))}`;
}

function build(input: BuildInput): string {
	const parts: string[] = [];

	if (input.fulltext) {
		parts.push(escapeValue(input.fulltext));
	}

	for (const filter of input.filters) {
		parts.push(buildCondition(filter));
	}

	return parts.join(" AND ");
}

const VALID_COMPARE_OPS = new Set(["=", "!=", ">", "<", ">=", "<="]);
const VALID_PIPELINE_CMDS = new Set(["stats", "timestats", "order", "limit", "eval"]);
const KEYWORDS = new Set(["and", "or", "not", "in", "regexp"]);

/**
 * Find the index of the pipeline '|' separator, ignoring '|' inside braces {a|b|c}.
 * Returns -1 if no pipeline separator found.
 */
function findPipelineIndex(ql: string): number {
	let braceDepth = 0;
	for (let i = 0; i < ql.length; i++) {
		const ch = ql[i]!;
		if (ch === "{") braceDepth++;
		else if (ch === "}") braceDepth--;
		else if (ch === "|" && braceDepth === 0) return i;
	}
	return -1;
}

type Token = { type: "ident" | "op" | "keyword" | "string" | "paren" | "pipe"; value: string };

/**
 * Simple tokenizer for Octopus LogQL query part (before pipeline |).
 */
function tokenize(ql: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < ql.length) {
		// Skip whitespace
		if (/\s/.test(ql[i]!)) {
			i++;
			continue;
		}
		// String literals
		if (ql[i] === '"' || ql[i] === "'") {
			const quote = ql[i]!;
			let j = i + 1;
			while (j < ql.length && ql[j] !== quote) {
				if (ql[j] === "\\" && j + 1 < ql.length) j++;
				j++;
			}
			tokens.push({ type: "string", value: ql.substring(i, j + 1) });
			i = j + 1;
			continue;
		}
		// Parentheses
		if (ql[i] === "(" || ql[i] === ")") {
			tokens.push({ type: "paren", value: ql[i]! });
			i++;
			continue;
		}
		// Pipe
		if (ql[i] === "|") {
			tokens.push({ type: "pipe", value: "|" });
			i++;
			continue;
		}
		// Comma
		if (ql[i] === ",") {
			i++;
			continue;
		}
		// Operators: !=, >=, <=, ==, >, <, =
		if (/[!=<>]/.test(ql[i]!)) {
			let op = ql[i]!;
			if (i + 1 < ql.length && ql[i + 1] === "=") {
				op += "=";
			}
			tokens.push({ type: "op", value: op });
			i += op.length;
			continue;
		}
		// Identifiers (including dotted names, numbers, paths, etc.)
		const identMatch = ql.substring(i).match(/^[^\s=!<>()"|,]+/);
		if (identMatch) {
			const word = identMatch[0]!;
			if (KEYWORDS.has(word.toLowerCase())) {
				tokens.push({ type: "keyword", value: word });
			} else {
				tokens.push({ type: "ident", value: word });
			}
			i += word.length;
			continue;
		}
		// Skip unknown character
		i++;
	}
	return tokens;
}

/**
 * Strip string literals from QL, replacing them with placeholders.
 * This prevents false positives when checking structure (e.g. "==" inside a quoted value).
 */
function stripStrings(ql: string): { stripped: string; errors: string[] } {
	const errors: string[] = [];
	let result = "";
	let i = 0;
	while (i < ql.length) {
		const ch = ql[i]!;
		if (ch === '"' || ch === "'") {
			const quote = ch;
			let j = i + 1;
			while (j < ql.length) {
				if (ql[j] === "\\" && j + 1 < ql.length) {
					j += 2;
					continue;
				}
				if (ql[j] === quote) break;
				j++;
			}
			if (j >= ql.length) {
				errors.push("Unterminated string literal");
				return { stripped: result + "_STR_", errors };
			}
			result += "_STR_";
			i = j + 1;
		} else {
			result += ch;
			i++;
		}
	}
	return { stripped: result, errors };
}

/**
 * Validate Octopus LogQL syntax.
 * Uses structural analysis on string-stripped input to avoid false positives.
 */
function validate(ql: string): ValidateResult {
	const trimmed = ql.trim();
	if (trimmed === "") {
		return { valid: false, errors: ["Empty query"] };
	}

	const errors: string[] = [];

	// Strip string literals to avoid false positives inside quoted values
	const { stripped, errors: stringErrors } = stripStrings(trimmed);
	errors.push(...stringErrors);

	// Check balanced parentheses (on stripped text)
	let parenDepth = 0;
	for (let i = 0; i < stripped.length; i++) {
		const ch = stripped[i]!;
		if (ch === "(") parenDepth++;
		if (ch === ")") parenDepth--;
		if (parenDepth < 0) {
			errors.push(`Unexpected ')' at position ${i}`);
			break;
		}
	}
	if (parenDepth > 0) {
		errors.push(`Unclosed parenthesis (${parenDepth} open)`);
	}

	// Check for trailing logical operators
	const trailingOp = stripped.match(/\b(AND|OR|NOT)\s*$/i);
	if (trailingOp) {
		errors.push(`Incomplete expression: trailing "${trailingOp[1]}"`);
	}

	// (Pipeline '|' is caught below as unsupported API syntax)

	// Check for double operators
	if (/\b(AND|OR)\s+(AND|OR)\b/i.test(stripped)) {
		errors.push("Consecutive logical operators");
	}

	// Check for invalid operators: == is not valid in Octopus QL
	if (/[^!<>]==/g.test(stripped) || /^==/g.test(stripped)) {
		errors.push('Invalid operator "==". Use "=" for equality');
	}

	// Check for broken string quoting — when a value contains quotes (e.g. JSON),
	// the user must escape them. Detect this by checking if a string close is
	// immediately followed by non-operator characters like letters or braces.
	// e.g. "{"key":"value"}" → string parses as "{" then bare Content-Type...
	{
		let inStr = false;
		let strChar = "";
		let strClosePos = -1;
		for (let i = 0; i < trimmed.length; i++) {
			const ch = trimmed[i]!;
			if (inStr) {
				if (ch === "\\" && i + 1 < trimmed.length) {
					i++;
					continue;
				}
				if (ch === strChar) {
					inStr = false;
					strClosePos = i;
				}
				continue;
			}
			if (/\s/.test(ch)) continue;
			if (ch === '"' || ch === "'") {
				inStr = true;
				strChar = ch;
				strClosePos = -1;
				continue;
			}
			// After a string closes, the next non-whitespace should be an operator, keyword, paren, pipe, or EOF.
			// But if it's a keyword (AND/OR/NOT/in/regexp) that's fine — e.g. "error" AND ...
			if (strClosePos >= 0 && /[a-zA-Z0-9_{[\]]/.test(ch)) {
				// Check if the upcoming word is a keyword
				const rest = trimmed.substring(i);
				const wordMatch = rest.match(/^(\w+)/);
				const word = wordMatch ? wordMatch[1]!.toLowerCase() : "";
				const isKeyword = KEYWORDS.has(word) || word === "and" || word === "or";
				if (!isKeyword) {
					errors.push(
						`Broken string quoting near position ${strClosePos} — value contains unescaped quotes. Escape inner quotes with \\", or use single quotes to wrap.`,
					);
					break;
				}
			}
			strClosePos = -1;
		}
	}

	// regexp is not supported by the Octopus OpenAPI
	if (/\bregexp\b/i.test(stripped)) {
		errors.push(
			'"regexp" is not supported by the Octopus API. Use wildcard (field = pattern*) instead',
		);
	}

	// Pipeline syntax (| stats/timestats) is not supported in query strings.
	// Aggregations must be passed via separate API parameters (-a/-g flags in octo-cli).
	const pipeIdx = findPipelineIndex(stripped);
	if (pipeIdx >= 0) {
		errors.push(
			'Pipeline syntax ("|") is not supported in API query strings. Use separate aggregation parameters (e.g. octo-cli logs aggregate -a "*:count" -g "service")',
		);
	}

	// Check for expression starting with an operator (no field name)
	if (/^\s*[=!><]/.test(stripped)) {
		errors.push("Expression starts with an operator — missing field name");
	}

	// Check for bare words without operators (not valid in Octopus QL)
	// Split by pipeline first, only check the query part
	const queryPipeIdx = findPipelineIndex(stripped);
	const queryPart = queryPipeIdx >= 0 ? stripped.substring(0, queryPipeIdx) : stripped;

	// Check for adjacent bare identifiers without any operator between them.
	// We tokenize the query part and look for two consecutive identifier tokens
	// with no operator in between. This catches "service costa-wx" but allows
	// "service = costa-wx" because '=' sits between them.
	// Skip this check inside parentheses (e.g. "field in (a, b, c)").
	const tokens = tokenize(queryPart);
	let depth = 0;
	for (let i = 0; i < tokens.length - 1; i++) {
		const t = tokens[i]!;
		if (t.type === "paren" && t.value === "(") depth++;
		if (t.type === "paren" && t.value === ")") depth--;
		if (depth > 0) continue; // Inside parens — don't check (value lists are comma-separated)

		const t2 = tokens[i + 1]!;
		if (t.type === "ident" && t2.type === "ident") {
			errors.push(
				`Adjacent terms "${t.value}" and "${t2.value}" without operator — use AND/OR or field=value syntax`,
			);
			break;
		}
	}

	return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

const octopusAdapter: PlatformAdapter = {
	name: "octopus",
	displayName: "Octopus (OctopusLogQL)",
	validate,
	build,
};

registerAdapter(octopusAdapter);

export { octopusAdapter };
