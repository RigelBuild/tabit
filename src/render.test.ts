import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validateClosedSchema } from "./closed.ts";
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

describe("schema output", () => {
	test("emits output-mode schema with defaulted fields required", () => {
		const files = render(
			z.strictObject({ name: z.string(), attempts: z.int().default(3) }),
			{ name: "worker" },
			true,
		);
		expect(files[0]?.contents).toContain('"attempts": 3');
		expect(files[1]?.path).toBe("/tmp/result.schema.json");
		expect(files[1]?.contents).toMatch(
			/"required": \[\s*"name",\s*"attempts"\s*\]/,
		);
	});
	test("rejects a bare transform with a root schema path", () => {
		expect(() =>
			validateClosedSchema(
				z.transform((value: unknown) => value),
				"input",
			),
		).toThrow("Transform schemas are not supported at /");
	});
	test("reports a nested bare transform schema path", () => {
		const schema = z.strictObject({
			nested: z.transform((value: unknown) => value),
		});
		expect(() => validateClosedSchema(schema, "input")).toThrow(
			"Transform schemas are not supported at /properties/nested",
		);
	});

	test.each([
		[
			"intersection",
			z
				.strictObject({ left: z.string() })
				.and(z.strictObject({ right: z.string() })),
		],
		["transform", z.transform((value: unknown) => value)],
	] as const)("rejects output-mode %s with a path", (_kind, schema) => {
		expect(() => validateClosedSchema(schema, "output")).toThrow("at /");
	});
	test.each([
		["date", z.date()],
		["bigint", z.bigint()],
		["map", z.map(z.string(), z.string())],
		["function", z.function()],
		["undefined", z.undefined()],
	] as const)(
		"rejects optional %s schemas for schema output",
		(_kind, unsupported) => {
			const schema = z.strictObject({ value: unsupported.optional() });
			expect(() => render(schema, { value: undefined }, true)).toThrow(
				`at /properties/value`,
			);
		},
	);
	test("rejects an optional set when emitting schema output", () => {
		const schema = z.strictObject({ value: z.set(z.string()).optional() });
		expect(() => render(schema, {}, true)).toThrow("/properties/value");
	});
});
describe("render paths and JSON boundaries", () => {
	test("reports a nested Zod issue path", () => {
		expect(() =>
			render(z.strictObject({ nested: z.strictObject({ count: z.int() }) }), {
				nested: { count: "bad" },
			}),
		).toThrow("$.nested.count");
	});
	test("reports nested invalid-union paths and punctuation keys", () => {
		const schema = z.strictObject({
			items: z.array(
				z.union([
					z.strictObject({ nested: z.strictObject({ count: z.number() }) }),
					z.strictObject({ other: z.string() }),
				]),
			),
		});
		expect(() =>
			render(schema, { items: [{ nested: { count: "bad" } }] }),
		).toThrow("$.items[0].nested.count");
		expect(() =>
			render(z.strictObject({ "a.b": z.number() }), { "a.b": "bad" }),
		).toThrow('$["a.b"]');
	});

	test("uses the prefault value when selecting a transformed union branch", () => {
		const schema = z
			.union([
				z.strictObject({ y: z.number(), x: z.number() }),
				z.preprocess(
					(value) => (typeof value === "string" ? { x: 1, y: 2 } : {}),
					z.strictObject({ x: z.number(), y: z.number() }),
				),
			])
			.prefault("choose-second");
		const expected = '{\n\t"x": 1,\n\t"y": 2\n}\n';
		const [file] = render(schema, undefined);
		expect(file?.contents).toBe(expected);
	});

	test("uses the preprocessed array input when selecting a nested union branch", () => {
		const union = z.union([
			z.strictObject({ y: z.number(), x: z.number() }),
			z.preprocess(
				(value) => (typeof value === "string" ? { x: 1, y: 2 } : {}),
				z.strictObject({ x: z.number(), y: z.number() }),
			),
		]);
		const schema = z.preprocess(
			(value) => (value === "array" ? ["choose-second"] : []),
			z.array(union),
		);
		const [file] = render(schema, "array");
		expect(file?.contents).toBe('[\n\t{\n\t\t"x": 1,\n\t\t"y": 2\n\t}\n]\n');
	});

	test("uses bracket notation for punctuation keys in JSON-value errors", () => {
		expect(() => render(z.unknown(), { "a.b": Number.NaN })).toThrow(
			'$["a.b"]',
		);
	});

	test("reports nested Date and non-finite number paths", () => {
		expect(() =>
			render(z.unknown(), { config: { created: new Date(0) } }),
		).toThrow("$.config.created");
		expect(() => render(z.unknown(), { values: [1, Number.NaN] })).toThrow(
			"$.values[1]",
		);
	});

	test("formats circular value paths with punctuation keys", () => {
		const circular: Record<string, unknown> = {};
		circular["a.b"] = circular;
		expect(() => render(z.unknown(), circular)).toThrow('$["a.b"]');
	});

	test("rejects sparse array holes with their index", () => {
		const sparse: unknown[] = [];
		sparse.length = 2;
		sparse[0] = "present";
		expect(() => render(z.unknown(), sparse)).toThrow("$[1]");
	});
});

describe("ordering parsed values", () => {
	test("recurses through arrays admitted by unknown and any schemas", () => {
		const [file] = render(z.unknown(), [[{ z: 1, a: 2 }], [3]]);
		expect(file?.contents).toContain('"a": 2');
		expect(file?.contents).toContain('"z": 1');
		const anyFile = render(z.any(), [[{ z: 1, a: 2 }]])[0];
		expect(anyFile?.contents).toContain('"a": 2');
	});

	test("unwraps lazy and nonoptional schemas while preserving nested order", () => {
		let recursive: z.ZodType;
		recursive = z.lazy(() =>
			z.strictObject({
				z: z.number(),
				a: z.record(z.string(), z.number()),
				next: recursive.optional(),
			}),
		);
		const [file] = render(recursive.nonoptional(), {
			a: { z: 1, b: 2 },
			z: 3,
		});
		expect(file?.contents).toBe(
			'{\n\t"z": 3,\n\t"a": {\n\t\t"b": 2,\n\t\t"z": 1\n\t}\n}\n',
		);
	});

	test("keeps prototype-sensitive catchall keys", () => {
		const input: Record<string, unknown> = { a: 1, constructor: 2 };
		Object.defineProperty(input, "__proto__", {
			value: 3,
			enumerable: true,
		});
		const [file] = render(z.looseObject({}), input);
		expect(file?.contents).toBe(
			'{\n\t"__proto__": 3,\n\t"a": 1,\n\t"constructor": 2\n}\n',
		);
	});

	test("orders union branches from parsed input instead of transformed output", () => {
		const schema = z.union([
			z.preprocess(
				() => ({ z: 1, a: 2 }),
				z.strictObject({ z: z.number(), a: z.number() }),
			),
			z.strictObject({ a: z.number(), z: z.number() }),
		]);
		const [file] = render(schema, "input");
		expect(file?.contents).toBe('{\n\t"z": 1,\n\t"a": 2\n}\n');
	});
	test("uses original array and tuple inputs when selecting union branches", () => {
		const union = z.union([
			z.preprocess(
				(value) => (typeof value === "string" ? { x: 1, y: 2 } : {}),
				z.strictObject({ x: z.number(), y: z.number() }),
			),
			z.strictObject({ y: z.number(), x: z.number() }),
		]);
		const [arrayFile] = render(z.array(union), ["choose-first"]);
		expect(arrayFile?.contents).toBe(
			'[\n\t{\n\t\t"x": 1,\n\t\t"y": 2\n\t}\n]\n',
		);
		const [tupleFile] = render(z.tuple([union]), ["choose-first"]);
		expect(tupleFile?.contents).toBe(
			'[\n\t{\n\t\t"x": 1,\n\t\t"y": 2\n\t}\n]\n',
		);
	});

	test.each([
		[
			"default",
			z
				.union([
					z.strictObject({ z: z.number(), a: z.number() }),
					z.strictObject({ a: z.number(), z: z.number() }),
				])
				.default({ z: 1, a: 2 }),
		],
		[
			"prefault",
			z
				.union([
					z.strictObject({ z: z.number(), a: z.number() }),
					z.strictObject({ a: z.number(), z: z.number() }),
				])
				.prefault({ z: 1, a: 2 }),
		],
	] as const)("preserves the selected %s union branch", (_name, schema) => {
		const [file] = render(schema, undefined);
		expect(file?.contents).toBe('{\n\t"z": 1,\n\t"a": 2\n}\n');
	});
});

describe("rejected schema kinds", () => {
	for (const schemaOut of [false, true]) {
		test(`rejects intersections with schemaOut=${schemaOut}`, () => {
			const schema = z
				.strictObject({ left: z.string() })
				.and(z.strictObject({ right: z.string() }));
			expect(() => render(schema, {}, schemaOut)).toThrow(
				"Intersection schemas are not supported at /",
			);
		});

		test(`rejects transforms with schemaOut=${schemaOut}`, () => {
			expect(() =>
				render(z.string().transform(Number), "1", schemaOut),
			).toThrow("Transform schemas are not supported at /");
		});
	}

	test("allows a pipe into a non-transform schema", () => {
		expect(render(z.string().pipe(z.string().min(1)), "valid")).toHaveLength(1);
	});
});

describe("JSON value ordering", () => {
	test("keeps schema keys and sorts record keys", () => {
		const schema = z.strictObject({
			b: z.number(),
			a: z.number(),
			r: z.record(z.string(), z.number()),
		});
		const [file] = render(schema, { r: { z: 1, y: 2 }, a: 1, b: 2 });
		expect(file?.contents).toBe(
			'{\n\t"b": 2,\n\t"a": 1,\n\t"r": {\n\t\t"y": 2,\n\t\t"z": 1\n\t}\n}\n',
		);
	});

	test("sorts catchall keys and drops undefined object keys", () => {
		const schema = z
			.strictObject({ known: z.string().optional() })
			.catchall(z.number());
		const [file] = render(schema, { z: 2, known: undefined, a: 1 });
		expect(file?.contents).toBe('{\n\t"a": 1,\n\t"z": 2\n}\n');
	});

	test("rejects undefined array values with their path", () => {
		expect(() => render(z.array(z.int().optional()), [1, undefined])).toThrow(
			"$[1]",
		);
	});

	test("rejects non-JSON values admitted by unknown schemas", () => {
		expect(() => render(z.unknown(), new Date(0))).toThrow("$");
	});

	test("sorts nested record keys allowed by unknown schemas", () => {
		const [file] = render(z.unknown(), { nested: { z: 1, a: 2 } });
		expect(file?.contents).toBe(
			'{\n\t"nested": {\n\t\t"a": 2,\n\t\t"z": 1\n\t}\n}\n',
		);
	});
	test("sorts top-level and nested null-prototype objects", () => {
		const nested = Object.setPrototypeOf({ z: 1, a: 2 }, null);
		const input = Object.setPrototypeOf({ z: 3, nested }, null);
		const [file] = render(z.unknown(), input);
		expect(file?.contents).toBe(
			'{\n\t"nested": {\n\t\t"a": 2,\n\t\t"z": 1\n\t},\n\t"z": 3\n}\n',
		);
	});

	test("rejects duplicate artifact paths", () => {
		const schema = z.strictObject({ value: z.string() });
		expect(() =>
			renderModule(
				defineConfig(schema, () => ({ value: "x" }), {
					out: "same.json",
					schemaOut: "same.json",
				}),
				"/tmp",
			),
		).toThrow("target.schemaOut");
	});
});
