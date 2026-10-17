import { resolve } from "node:path";
import { z } from "zod";
import { validateClosedSchema } from "./closed.ts";
import type { ConfigModule } from "./define.ts";
import { orderParsedValue } from "./order.ts";

export interface RenderedFile {
	path: string;
	contents: string;
}

export class RenderError extends Error {
	constructor(
		message: string,
		readonly at: string,
	) {
		super(`${message} at ${at}`);
		this.name = "RenderError";
	}
}

function deepestIssuePath(issue: z.core.$ZodIssue): PropertyKey[] {
	if (issue.code !== "invalid_union" || issue.errors.length === 0)
		return issue.path;
	let deepest = issue.path;
	for (const branch of issue.errors) {
		for (const nested of branch) {
			const candidate = [...issue.path, ...deepestIssuePath(nested)];
			if (candidate.length > deepest.length) deepest = candidate;
		}
	}
	return deepest;
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
	return path.reduce<string>((result, part) => {
		if (typeof part === "number") return `${result}[${part}]`;
		const key = String(part);
		return /^[A-Za-z_$][\w$]*$/.test(key)
			? `${result}.${key}`
			: `${result}[${JSON.stringify(key)}]`;
	}, "$");
}

function validateJsonValue(value: unknown, path: readonly PropertyKey[]): void {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (typeof value !== "object" || value === null) {
		throw new RenderError(
			`Value is not JSON: ${typeof value}`,
			formatIssuePath(path),
		);
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const child = value[index];
			if (child === undefined) {
				throw new RenderError(
					"Undefined array elements are not JSON",
					formatIssuePath([...path, index]),
				);
			}
			validateJsonValue(child, [...path, index]);
		}
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new RenderError(
			"Value is not a plain JSON object",
			formatIssuePath(path),
		);
	}
	for (const [key, child] of Object.entries(value)) {
		if (child !== undefined) validateJsonValue(child, [...path, key]);
	}
}

function jsonContents(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

export function renderModule(
	mod: ConfigModule<z.ZodType>,
	moduleDir: string,
): RenderedFile[] {
	validateClosedSchema(mod.schema, "input");
	const rawValue = mod.build();
	const parsed = mod.schema.safeParse(rawValue);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const at =
			issue === undefined ? "$" : formatIssuePath(deepestIssuePath(issue));
		throw new RenderError(z.prettifyError(parsed.error), at);
	}
	const value = orderParsedValue(parsed.data, mod.schema, rawValue);
	if (
		rawValue !== null &&
		typeof rawValue === "object" &&
		!Array.isArray(rawValue) &&
		value !== null &&
		typeof value === "object"
	) {
		const protoKey = Object.getOwnPropertyDescriptor(rawValue, "__proto__");
		if (protoKey?.enumerable && !Object.hasOwn(value, "__proto__")) {
			Object.defineProperty(value, "__proto__", {
				value: protoKey.value,
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
	}
	validateJsonValue(value, []);
	const files: RenderedFile[] = [
		{ path: resolve(moduleDir, mod.target.out), contents: jsonContents(value) },
	];
	if (mod.target.schemaOut !== undefined) {
		const schemaPath = resolve(moduleDir, mod.target.schemaOut);
		if (files.some((file) => file.path === schemaPath)) {
			throw new RenderError(
				"Config and schema output paths must differ",
				"target.schemaOut",
			);
		}
		const outputSchema = validateClosedSchema(mod.schema, "output");
		files.push({ path: schemaPath, contents: jsonContents(outputSchema) });
	}
	return files;
}
