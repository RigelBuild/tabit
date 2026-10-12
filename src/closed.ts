import { z } from "zod";
import { RenderError } from "./render.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function openObjectPaths(jsonSchema: unknown): string[] {
	if (!isRecord(jsonSchema)) return [];
	const definitions = isRecord(jsonSchema.$defs) ? jsonSchema.$defs : {};
	const seenReferences = new Set<string>();
	const paths: string[] = [];
	const visit = (node: unknown, path: string): void => {
		if (!isRecord(node)) return;
		if (node.type === "object" && !("additionalProperties" in node))
			paths.push(path || "$");
		if (typeof node.$ref === "string") {
			const prefix = "#/$defs/";
			if (node.$ref.startsWith(prefix)) {
				const key = node.$ref
					.slice(prefix.length)
					.replaceAll("~1", "/")
					.replaceAll("~0", "~");
				if (!seenReferences.has(key) && key in definitions) {
					seenReferences.add(key);
					visit(definitions[key], `${path || "$"} -> ${node.$ref}`);
				}
			}
		}
		for (const key of ["properties", "$defs"]) {
			const children = node[key];
			if (isRecord(children)) {
				for (const [name, child] of Object.entries(children))
					visit(child, `${path}/${key}/${name}`);
			}
		}
		for (const key of ["additionalProperties", "items"]) {
			const child = node[key];
			if (isRecord(child)) visit(child, `${path}/${key}`);
		}
		for (const key of ["prefixItems", "anyOf", "oneOf", "allOf"]) {
			const children = node[key];
			if (Array.isArray(children)) {
				children.forEach((child, index) => {
					visit(child, `${path}/${key}/${index}`);
				});
			}
		}
	};
	visit(jsonSchema, "");
	return paths;
}

export function validateClosedSchema(
	schema: z.ZodType,
	io: "input" | "output",
): unknown {
	const document = z.toJSONSchema(schema, {
		io,
		unrepresentable: ({ zodSchema, path, message }) => {
			const type = zodSchema._zod.def.type;
			if (
				type === "transform" ||
				(type === "pipe" &&
					zodSchema._zod.def.out._zod.def.type === "transform")
			) {
				throw new RenderError(
					"Transform schemas are not supported",
					`/${path.join("/")}`,
				);
			}
			throw new RenderError(message, `/${path.join("/")}`);
		},
		override: ({ zodSchema, jsonSchema: current, path }) => {
			const type = zodSchema._zod.def.type;
			if (type === "intersection") {
				throw new RenderError(
					"Intersection schemas are not supported",
					`/${path.join("/")}`,
				);
			}
			if (
				type === "transform" ||
				(type === "pipe" &&
					zodSchema._zod.def.out._zod.def.type === "transform")
			) {
				throw new RenderError(
					"Transform schemas are not supported",
					`/${path.join("/")}`,
				);
			}
			return current;
		},
	});
	const openPaths = openObjectPaths(document);
	const openPath = openPaths[0];
	if (openPath !== undefined)
		throw new RenderError(
			"Object schemas must reject or describe additional properties",
			openPath,
		);
	return document;
}
