import { describe, expect, it } from "vitest";
import "../src/platforms/octopus.js";
import { getAdapter } from "../src/platform.js";

const adapter = getAdapter("octopus");

describe("octopus build", () => {
	it("single equality filter", () => {
		expect(adapter.build({ filters: [{ field: "service", op: "=", value: "payment" }] })).toBe(
			"service=payment",
		);
	});

	it("multiple AND filters", () => {
		expect(
			adapter.build({
				filters: [
					{ field: "service", op: "=", value: "payment" },
					{ field: "level", op: "!=", value: "DEBUG" },
				],
			}),
		).toBe("service=payment AND level!=DEBUG");
	});

	it("comparison operators", () => {
		expect(adapter.build({ filters: [{ field: "latency", op: ">", value: 500 }] })).toBe(
			"latency>500",
		);
		expect(adapter.build({ filters: [{ field: "latency", op: "<=", value: 100 }] })).toBe(
			"latency<=100",
		);
	});

	it("in operator", () => {
		expect(
			adapter.build({
				filters: [{ field: "status", op: "in", value: ["200", "201", "204"] }],
			}),
		).toBe("status in (200, 201, 204)");
	});

	it("not_in operator", () => {
		expect(
			adapter.build({
				filters: [{ field: "status", op: "not_in", value: ["400", "500"] }],
			}),
		).toBe("NOT status in (400, 500)");
	});

	it("regex operator throws", () => {
		expect(() =>
			adapter.build({
				filters: [{ field: "service", op: "regex", value: "costa-.*" }],
			}),
		).toThrow("regex");
	});

	it("unknown operator throws", () => {
		expect(() =>
			adapter.build({
				filters: [{ field: "service", op: "~" as "=", value: "foo" }],
			}),
		).toThrow("Unsupported operator");
	});

	it("fulltext search", () => {
		expect(
			adapter.build({
				filters: [],
				fulltext: "connection refused",
			}),
		).toBe('"connection refused"');
	});

	it("fulltext + filters", () => {
		expect(
			adapter.build({
				filters: [{ field: "service", op: "=", value: "payment" }],
				fulltext: "error",
			}),
		).toBe("error AND service=payment");
	});

	it("value with spaces gets quoted", () => {
		expect(
			adapter.build({
				filters: [{ field: "msg", op: "=", value: "hello world" }],
			}),
		).toBe('msg="hello world"');
	});

	it("value with parens gets quoted", () => {
		expect(
			adapter.build({
				filters: [{ field: "msg", op: "=", value: "count(*)" }],
			}),
		).toBe('msg="count(*)"');
	});
});
