import { describe, expect, it } from "vitest";
import "../src/platforms/octopus.js";
import { getAdapter } from "../src/platform.js";

const adapter = getAdapter("octopus");

describe("octopus validate", () => {
	const valid = (q: string) => expect(adapter.validate(q)).toEqual({ valid: true });
	const invalid = (q: string) => expect(adapter.validate(q).valid).toBe(false);

	describe("basic field=value", () => {
		it("simple equality", () => valid("service = payment"));
		it("no spaces around =", () => valid("service=payment"));
		it("not equal", () => valid("service != payment"));
		it("greater than", () => valid("latency > 500"));
		it("less than", () => valid("latency < 100"));
		it("greater or equal", () => valid("latency >= 500"));
		it("less or equal", () => valid("latency <= 100"));
	});

	describe("logical operators", () => {
		it("AND", () => valid("service = a AND level = b"));
		it("OR", () => valid("service = a OR service = b"));
		it("NOT", () => valid("NOT level = DEBUG"));
		it("AND + OR", () => valid("service = a AND level = b OR host = c"));
		it("triple AND chain", () => valid("a = 1 AND b = 2 AND c = 3"));
	});

	describe("parentheses", () => {
		it("simple parens", () => valid("(service = a OR service = b)"));
		it("parens + AND", () => valid("(service = a OR service = b) AND level = ERROR"));
		it("NOT + parens", () => valid("NOT (service = test AND level = DEBUG)"));
		it("nested parens", () => valid("((a = 1 OR b = 2) AND c = 3)"));
	});

	describe("in operator", () => {
		it("simple in", () => valid("log_type in (app, clog, alog)"));
		it("NOT in", () => valid("NOT log_type in (app, clog)"));
		it("single value in", () => valid("service in (payment)"));
	});

	describe("fulltext search", () => {
		it("quoted string", () => valid('"connection refused"'));
		it("fulltext + AND", () => valid('"error" AND service = payment'));
		it("fulltext OR fulltext", () => valid('"error" OR "timeout"'));
	});

	describe("special values", () => {
		it("wildcard", () => valid("service = costa-*"));
		it("URL value", () => valid("view.url = https://example.com/#/path"));
		it("dotted field name", () => valid("k8s.container.name = http-server"));
		it("quoted value with spaces", () => valid('msg = "hello world"'));
		it("quoted base64", () => valid('token = "abc123def456=="'));
		it("path with braces", () =>
			valid("path = /api/{client:web|mobile}/data"));
		it("chinese value in quotes", () => valid('state = "整理"'));
	});

	describe("invalid queries", () => {
		it("empty", () => invalid(""));
		it("trailing AND", () => invalid("service = a AND"));
		it("trailing OR", () => invalid("service = a OR"));
		it("trailing NOT", () => invalid("service = a NOT"));
		it("unclosed paren", () => invalid("service = a AND (level = ERROR"));
		it("extra close paren", () => invalid("service = a)"));
		it("double ==", () => invalid("service == value"));
		it("starts with operator", () => invalid("= value"));
		it("adjacent bare words", () => invalid("service payment"));
		it("unterminated string", () => invalid('service = "foo'));
		it("consecutive AND AND", () => invalid("a = 1 AND AND b = 2"));
		it("consecutive OR OR", () => invalid("a = 1 OR OR b = 2"));
		it("lone AND", () => invalid("AND"));
	});

	describe("API-unsupported syntax", () => {
		it("regexp rejected", () => {
			const r = adapter.validate('service regexp "costa-.*"');
			expect(r.valid).toBe(false);
			expect(r.errors?.[0]).toContain("regexp");
		});
		it("NOT regexp rejected", () => {
			const r = adapter.validate('service NOT regexp "test-.*"');
			expect(r.valid).toBe(false);
		});
		it("pipeline stats rejected", () => {
			const r = adapter.validate("service = a | stats count(*) by (service)");
			expect(r.valid).toBe(false);
			expect(r.errors?.[0]).toContain("Pipeline");
		});
		it("pipeline timestats rejected", () => {
			const r = adapter.validate("service = a | timestats step=5m count(*)");
			expect(r.valid).toBe(false);
		});
		it("pipe only rejected", () => invalid("service = a |"));
	});

	describe("broken quoting", () => {
		it("JSON value with unescaped quotes", () => {
			const r = adapter.validate(
				'field = "{"Content-Type":"application/json"}"',
			);
			expect(r.valid).toBe(false);
			expect(r.errors?.[0]).toContain("Broken string quoting");
		});
	});
});
