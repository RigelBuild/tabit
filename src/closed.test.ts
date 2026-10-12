import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineConfig } from "./define.ts";
import { renderModule } from "./render.ts";

function render(schema: z.ZodType, value: unknown, schemaOut = false) {
	const target = schemaOut
		? { out: "result.json", schemaOut: "result.schema.json" }
		: { out: "result.json" };
	return renderModule(
		defineConfig(schema, () => value, target),
		"/tmp",
	);
}

describe("closed schemas", () => {
	test("rejects a misspelled key with the Zod issue", () => {
		expect(() =>
			render(z.strictObject({ name: z.string() }), { name: "a", nam: "b" }),
		).toThrow("Unrecognized key");
	});

	const plainObject = z.object({ value: z.string() });

	test.each([
		["top-level", plainObject, "$"],
		[
			"record value",
			z.record(z.string(), plainObject),
			"/additionalProperties",
		],
		[
			"catchall",
			z.strictObject({}).catchall(plainObject),
			"/additionalProperties",
		],
		["tuple entry", z.tuple([plainObject]), "/prefixItems/0"],
		["tuple rest", z.tuple([]).rest(plainObject), "/items"],
		["anyOf member", z.union([plainObject, z.string()]), "/anyOf/0"],
	])(
		"rejects a plain object schema at %s and reports %s",
		(_name, schema, path) => {
			expect(() => render(schema, {})).toThrow(path);
		},
	);

	test("rejects a plain object reachable only through a recursive $ref definition", () => {
		let recursive: z.ZodType;
		recursive = z.lazy(() =>
			z.strictObject({ inner: plainObject, next: recursive.optional() }),
		);
		const schema = z.strictObject({ root: recursive, other: recursive });
		expect(() =>
			render(schema, {
				root: { inner: { value: "x" } },
				other: { inner: { value: "y" } },
			}),
		).toThrow("$defs/__schema0/properties/inner");
	});
});
