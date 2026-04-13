#!/usr/bin/env node
/**
 * Test 200 queries against the real Octopus backend.
 * For each query: qlint validates → octo-cli executes → compare results.
 * Goal: find cases where qlint and backend disagree.
 */

import { execFileSync } from "node:child_process";

const QLINT_BIN = "node";
const QLINT_ARGS = ["dist/index.js"];
const OCTO_BIN = "npx";
const OCTO_ARGS = ["octo-cli"];
const TIME_RANGE = "1h";

// ── Step 1: Pull real field names and values from live logs ──

console.log("Fetching real log data for field/value extraction...\n");

let realFields = {};
try {
	const raw = execFileSync(OCTO_BIN, [...OCTO_ARGS, "logs", "search", "-l", TIME_RANGE, "-n", "20", "-o", "json"], {
		encoding: "utf8",
		timeout: 30000,
	});
	const data = JSON.parse(raw);
	for (const log of data.logs || []) {
		const attrs = log.attributes || {};
		for (const [k, v] of Object.entries(attrs)) {
			if (typeof v === "string" && v.length > 0 && v.length < 100
				&& !v.includes('"') && !v.includes("'") && !v.includes("\\")) {
				// Skip values containing quotes/backslashes — they need escaping
				// which complicates test generation without adding coverage value
				if (!realFields[k]) realFields[k] = new Set();
				if (realFields[k].size < 5) realFields[k].add(v);
			}
		}
	}
} catch (e) {
	console.error("Failed to fetch sample logs:", e.message);
	process.exit(1);
}

// Convert sets to arrays
for (const k of Object.keys(realFields)) {
	realFields[k] = [...realFields[k]];
}

const fieldNames = Object.keys(realFields);
console.log(`Extracted ${fieldNames.length} fields from live data.\n`);

// Pick helper
function pick(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}
function pickField() {
	const f = pick(fieldNames);
	return { field: f, value: pick(realFields[f]) };
}

// ── Step 2: Generate 200 test queries ──

const queries = [];

// Category 1: Simple field=value (30)
for (let i = 0; i < 30; i++) {
	const { field, value } = pickField();
	// Decide if value needs quoting
	const needsQuote = /[\s(),'=<>!]/.test(value);
	const v = needsQuote ? `"${value}"` : value;
	queries.push({ q: `${field} = ${v}`, expect: "valid", cat: "simple-eq" });
}

// Category 2: field!=value (10)
for (let i = 0; i < 10; i++) {
	const { field, value } = pickField();
	const needsQuote = /[\s(),'=<>!]/.test(value);
	const v = needsQuote ? `"${value}"` : value;
	queries.push({ q: `${field} != ${v}`, expect: "valid", cat: "neq" });
}

// Category 3: AND combinations (25)
for (let i = 0; i < 25; i++) {
	const f1 = pickField();
	const f2 = pickField();
	const nq1 = /[\s(),'=<>!]/.test(f1.value);
	const nq2 = /[\s(),'=<>!]/.test(f2.value);
	const v1 = nq1 ? `"${f1.value}"` : f1.value;
	const v2 = nq2 ? `"${f2.value}"` : f2.value;
	queries.push({
		q: `${f1.field} = ${v1} AND ${f2.field} = ${v2}`,
		expect: "valid",
		cat: "and",
	});
}

// Category 4: OR combinations (15)
for (let i = 0; i < 15; i++) {
	const f1 = pickField();
	const f2 = pickField();
	const nq1 = /[\s(),'=<>!]/.test(f1.value);
	const nq2 = /[\s(),'=<>!]/.test(f2.value);
	const v1 = nq1 ? `"${f1.value}"` : f1.value;
	const v2 = nq2 ? `"${f2.value}"` : f2.value;
	queries.push({
		q: `${f1.field} = ${v1} OR ${f2.field} = ${v2}`,
		expect: "valid",
		cat: "or",
	});
}

// Category 5: NOT (10)
for (let i = 0; i < 10; i++) {
	const { field, value } = pickField();
	const needsQuote = /[\s(),'=<>!]/.test(value);
	const v = needsQuote ? `"${value}"` : value;
	queries.push({ q: `NOT ${field} = ${v}`, expect: "valid", cat: "not" });
}

// Category 6: Parentheses (15)
for (let i = 0; i < 15; i++) {
	const f1 = pickField();
	const f2 = pickField();
	const f3 = pickField();
	const qv = (fv) => (/[\s(),'=<>!]/.test(fv.value) ? `"${fv.value}"` : fv.value);
	queries.push({
		q: `(${f1.field} = ${qv(f1)} OR ${f2.field} = ${qv(f2)}) AND ${f3.field} = ${qv(f3)}`,
		expect: "valid",
		cat: "parens",
	});
}

// Category 7: in operator (10)
for (let i = 0; i < 10; i++) {
	const field = pick(fieldNames);
	const vals = realFields[field].slice(0, 3);
	if (vals.length >= 2) {
		const valList = vals.map((v) => (/[\s(),'=<>!]/.test(v) ? `"${v}"` : v)).join(", ");
		queries.push({
			q: `${field} in (${valList})`,
			expect: "valid",
			cat: "in",
		});
	} else {
		const { field: f, value: v } = pickField();
		queries.push({ q: `${f} = ${v}`, expect: "valid", cat: "in-fallback" });
	}
}

// Category 8: NOT in (5)
for (let i = 0; i < 5; i++) {
	const field = pick(fieldNames);
	const vals = realFields[field].slice(0, 2);
	if (vals.length >= 2) {
		const valList = vals.map((v) => (/[\s(),'=<>!]/.test(v) ? `"${v}"` : v)).join(", ");
		queries.push({
			q: `NOT ${field} in (${valList})`,
			expect: "valid",
			cat: "not-in",
		});
	} else {
		queries.push({ q: `NOT ${pick(fieldNames)} = test`, expect: "valid", cat: "not-in-fb" });
	}
}

// Category 9: Fulltext search (10)
const fulltextTerms = ["error", "timeout", "connection", "failed", "exception", "null", "状态变化", "success", "warn", "retry"];
for (let i = 0; i < 10; i++) {
	const term = pick(fulltextTerms);
	queries.push({ q: `"${term}"`, expect: "valid", cat: "fulltext" });
}

// Category 10: Fulltext + field filter (10)
for (let i = 0; i < 10; i++) {
	const { field, value } = pickField();
	const term = pick(fulltextTerms);
	const needsQuote = /[\s(),'=<>!]/.test(value);
	const v = needsQuote ? `"${value}"` : value;
	queries.push({
		q: `"${term}" AND ${field} = ${v}`,
		expect: "valid",
		cat: "fulltext+filter",
	});
}

// Category 11: Wildcard (10)
for (let i = 0; i < 10; i++) {
	const { field, value } = pickField();
	const prefix = value.substring(0, Math.max(2, Math.floor(value.length / 2)));
	queries.push({
		q: `${field} = ${prefix}*`,
		expect: "valid",
		cat: "wildcard",
	});
}

// Category 12: Comparison operators > < >= <= (10)
const numFields = ["seqId", "screenWidth", "screenHeight", "screenSize"];
for (let i = 0; i < 10; i++) {
	const f = pick(numFields);
	const op = pick([">", "<", ">=", "<="]);
	const val = Math.floor(Math.random() * 1000);
	queries.push({ q: `${f} ${op} ${val}`, expect: "valid", cat: "compare" });
}

// Category 13: Three-field AND chains (10)
for (let i = 0; i < 10; i++) {
	const f1 = pickField(), f2 = pickField(), f3 = pickField();
	const qv = (fv) => (/[\s(),'=<>!]/.test(fv.value) ? `"${fv.value}"` : fv.value);
	queries.push({
		q: `${f1.field} = ${qv(f1)} AND ${f2.field} = ${qv(f2)} AND ${f3.field} = ${qv(f3)}`,
		expect: "valid",
		cat: "triple-and",
	});
}

// Category 14: NOT + parentheses (5)
for (let i = 0; i < 5; i++) {
	const f1 = pickField(), f2 = pickField();
	const qv = (fv) => (/[\s(),'=<>!]/.test(fv.value) ? `"${fv.value}"` : fv.value);
	queries.push({
		q: `NOT (${f1.field} = ${qv(f1)} AND ${f2.field} = ${qv(f2)})`,
		expect: "valid",
		cat: "not-parens",
	});
}

// Category 15: Known invalid queries (25)
const invalidQueries = [
	{ q: "", cat: "empty" },
	{ q: "AND", cat: "lone-and" },
	{ q: "OR", cat: "lone-or" },
	{ q: "service = foo AND", cat: "trailing-and" },
	{ q: "service = foo OR", cat: "trailing-or" },
	{ q: "service = foo NOT", cat: "trailing-not" },
	{ q: "= foo", cat: "no-field" },
	{ q: "!= foo", cat: "no-field-neq" },
	{ q: "> 500", cat: "no-field-gt" },
	{ q: "service == foo", cat: "double-eq" },
	{ q: 'service = "foo', cat: "unterm-string" },
	{ q: "service = foo AND (level = ERROR", cat: "unclose-paren" },
	{ q: "service = foo)", cat: "extra-paren" },
	{ q: "service foo", cat: "bare-words" },
	{ q: "foo bar baz", cat: "multi-bare" },
	{ q: 'service regexp "foo.*"', cat: "regexp" },
	{ q: 'service NOT regexp "foo.*"', cat: "not-regexp" },
	{ q: "service = foo | stats count(*)", cat: "pipeline-stats" },
	{ q: "service = foo | timestats step=5m count(*)", cat: "pipeline-timestats" },
	{ q: "service = foo | order by timestamp", cat: "pipeline-order" },
	{ q: "service = foo |", cat: "pipe-empty" },
	{ q: "AND AND service = foo", cat: "double-and" },
	{ q: "OR OR", cat: "double-or" },
	{ q: "service = foo AND AND level = bar", cat: "mid-double-and" },
	{ q: "service = foo OR OR level = bar", cat: "mid-double-or" },
];
for (const inv of invalidQueries) {
	queries.push({ q: inv.q, expect: "invalid", cat: `invalid:${inv.cat}` });
}

// Pad to 200 if needed
while (queries.length < 200) {
	const f1 = pickField(), f2 = pickField();
	const qv = (fv) => (/[\s(),'=<>!]/.test(fv.value) ? `"${fv.value}"` : fv.value);
	queries.push({
		q: `${f1.field} = ${qv(f1)} AND ${f2.field} != ${qv(f2)}`,
		expect: "valid",
		cat: "pad-and-neq",
	});
}

console.log(`Generated ${queries.length} test queries.\n`);

// ── Step 3: Run tests ──

let qlintPass = 0, qlintFail = 0;
let backendPass = 0, backendFail = 0, backendSkip = 0;
let mismatch = 0;
const mismatches = [];
const qlintErrors = [];

for (let i = 0; i < queries.length; i++) {
	const { q, expect, cat } = queries[i];
	const idx = `#${String(i + 1).padStart(3, "0")}`;

	// qlint validate
	let qlintResult;
	try {
		const out = execFileSync(QLINT_BIN, [...QLINT_ARGS, "validate", "-p", "octopus", q], {
			encoding: "utf8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		qlintResult = JSON.parse(out);
	} catch (e) {
		// exit code 1 = invalid
		try {
			qlintResult = JSON.parse(e.stdout);
		} catch {
			qlintResult = { valid: false, errors: ["qlint crash: " + e.message?.substring(0, 80)] };
		}
	}

	const qlintValid = qlintResult.valid;
	const qlintExpected = expect === "valid";

	if (qlintValid !== qlintExpected) {
		qlintFail++;
		qlintErrors.push({
			idx,
			cat,
			q,
			expected: expect,
			got: qlintValid ? "valid" : "invalid",
			errors: qlintResult.errors,
		});
	} else {
		qlintPass++;
	}

	// Backend test (only for queries qlint says valid, to check false positives)
	if (qlintValid && expect === "valid") {
		try {
			const out = execFileSync(OCTO_BIN, [...OCTO_ARGS, "logs", "search", "-q", q, "-l", TIME_RANGE, "-n", "1", "-o", "json"], {
				encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
			});
			JSON.parse(out); // should parse OK
			backendPass++;
		} catch (e) {
			const stderr = e.stderr || e.stdout || e.message || "";
			if (stderr.includes("400") || stderr.includes("Syntax error") || stderr.includes("-201")) {
				backendFail++;
				mismatch++;
				mismatches.push({ idx, cat, q, issue: "qlint=valid but backend=400", detail: stderr.substring(0, 120) });
			} else {
				// Network/timeout error — skip
				backendSkip++;
			}
		}
	} else if (!qlintValid && expect === "invalid") {
		// For known invalid, spot check a few against backend
		if (i < 5 || Math.random() < 0.1) {
			try {
				execFileSync(OCTO_BIN, [...OCTO_ARGS, "logs", "search", "-q", q, "-l", TIME_RANGE, "-n", "1", "-o", "json"], {
					encoding: "utf8",
					timeout: 10000,
					stdio: ["pipe", "pipe", "pipe"],
				});
				// If backend accepts something qlint rejected — that's also a mismatch
				mismatch++;
				mismatches.push({ idx, cat, q, issue: "qlint=invalid but backend=OK" });
			} catch {
				// Expected — both agree it's invalid
			}
		}
		backendSkip++;
	} else {
		backendSkip++;
	}

	// Progress
	if ((i + 1) % 25 === 0) {
		process.stdout.write(`  ${i + 1}/${queries.length} done\n`);
	}
}

// ── Step 4: Report ──

console.log("\n" + "=".repeat(60));
console.log("RESULTS");
console.log("=".repeat(60));
console.log(`Total queries:     ${queries.length}`);
console.log(`qlint correctness: ${qlintPass}/${queries.length} (${qlintFail} wrong)`);
console.log(`Backend tested:    ${backendPass + backendFail} (${backendSkip} skipped)`);
console.log(`Backend accepted:  ${backendPass}`);
console.log(`Backend rejected:  ${backendFail}`);
console.log(`Mismatches:        ${mismatch}`);

if (qlintErrors.length > 0) {
	console.log("\n--- qlint errors (expected vs actual) ---");
	for (const e of qlintErrors) {
		console.log(`  ${e.idx} [${e.cat}] expected=${e.expected} got=${e.got}: ${e.q}`);
		if (e.errors) console.log(`    errors: ${e.errors.join("; ")}`);
	}
}

if (mismatches.length > 0) {
	console.log("\n--- Mismatches (qlint vs backend disagree) ---");
	for (const m of mismatches) {
		console.log(`  ${m.idx} [${m.cat}] ${m.issue}: ${m.q}`);
		if (m.detail) console.log(`    ${m.detail}`);
	}
}

console.log("\n" + "=".repeat(60));
process.exit(mismatch > 0 || qlintFail > 0 ? 1 : 0);
