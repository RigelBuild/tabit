import type { z } from "zod";

export const MODULE_BRAND = Symbol.for("@rigelbuild/tabit.module");

export interface RenderTarget {
	out: string;
	schemaOut?: string;
}

export interface ConfigModule<S extends z.ZodType> {
	readonly [MODULE_BRAND]: true;
	readonly schema: S;
	readonly build: () => z.input<S>;
	readonly target: RenderTarget;
}

export function defineConfig<S extends z.ZodType>(
	schema: S,
	build: () => z.input<S>,
	target: RenderTarget,
): ConfigModule<S> {
	if (!target.out.endsWith(".json")) {
		throw new TypeError("Config output path must end in .json");
	}
	if (target.schemaOut !== undefined && !target.schemaOut.endsWith(".json")) {
		throw new TypeError("Config schema output path must end in .json");
	}
	return { [MODULE_BRAND]: true, schema, build, target };
}

export function isConfigModule(
	value: unknown,
): value is ConfigModule<z.ZodType> {
	if (value === null || typeof value !== "object") return false;
	const brand = Object.getOwnPropertyDescriptor(value, MODULE_BRAND);
	if (
		brand?.value !== true ||
		!("schema" in value) ||
		!("build" in value) ||
		!("target" in value)
	) {
		return false;
	}
	const candidate = value.schema;
	const target = value.target;
	if (
		typeof candidate !== "object" ||
		candidate === null ||
		!("_zod" in candidate) ||
		typeof value.build !== "function" ||
		target === null ||
		typeof target !== "object" ||
		!("out" in target) ||
		typeof target.out !== "string" ||
		!target.out.endsWith(".json")
	) {
		return false;
	}
	return (
		!("schemaOut" in target) ||
		target.schemaOut === undefined ||
		(typeof target.schemaOut === "string" && target.schemaOut.endsWith(".json"))
	);
}
