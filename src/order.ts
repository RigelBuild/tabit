import { z } from "zod";
import { RenderError } from "./render.ts";

type InternalSchema = z.ZodType & { _zod: { def: { type: string } } };

function orderValue(
	value: unknown,
	schema: z.ZodType,
	path: string,
	active: WeakSet<object>,
	unionInput: unknown,
	objectInput: unknown,
): unknown {
	const current = schema as InternalSchema;
	const definition = current._zod.def;
	if (definition.type === "lazy") {
		const lazy = current as typeof current & {
			_zod: { def: { getter: () => z.ZodType } };
		};
		return orderValue(
			value,
			lazy._zod.def.getter(),
			path,
			active,
			unionInput,
			objectInput,
		);
	}
	if (definition.type === "pipe") {
		const pipe = current as typeof current & {
			_zod: { def: { in: z.ZodType; out: z.ZodType } };
		};
		const parsedInput = pipe._zod.def.in.safeParse(unionInput);
		const innerInput = parsedInput.success ? parsedInput.data : unionInput;
		return orderValue(
			value,
			pipe._zod.def.out,
			path,
			active,
			innerInput,
			innerInput,
		);
	}
	if (
		[
			"optional",
			"nonoptional",
			"nullable",
			"default",
			"prefault",
			"readonly",
			"catch",
		].includes(definition.type)
	) {
		const wrapped = current as typeof current & {
			_zod: { def: { innerType: z.ZodType } };
		};
		const hasDefault =
			unionInput === undefined &&
			(definition.type === "default" || definition.type === "prefault");
		const innerType = wrapped._zod.def.innerType;
		const wrappedInput = hasDefault
			? definition.type === "prefault"
				? (
						current as typeof current & {
							_zod: { def: { defaultValue: unknown } };
						}
					)._zod.def.defaultValue
				: value
			: unionInput;
		return orderValue(
			value,
			innerType,
			path,
			active,
			wrappedInput,
			wrappedInput === unionInput ? objectInput : wrappedInput,
		);
	}
	if (definition.type === "union") {
		const union = current as typeof current & { options: readonly z.ZodType[] };
		let option: z.ZodType | undefined;
		let branchInput = unionInput;
		for (const candidate of union.options) {
			const parsed = candidate.safeParse(unionInput);
			if (parsed.success) {
				option = candidate;
				branchInput = parsed.data;
				break;
			}
		}
		return orderValue(
			value,
			option ?? z.unknown(),
			path,
			active,
			branchInput,
			branchInput,
		);
	}
	if (Array.isArray(value)) {
		if (active.has(value))
			throw new RenderError("Circular value is not JSON", path);
		active.add(value);
		try {
			const originalItems = Array.isArray(objectInput) ? objectInput : value;
			if (definition.type === "array") {
				const array = current as typeof current & { element: z.ZodType };
				return Array.from(value, (item, index) =>
					orderValue(
						item,
						array.element,
						`${path}[${index}]`,
						active,
						originalItems[index],
						originalItems[index],
					),
				);
			}
			if (definition.type === "tuple") {
				const tuple = current as typeof current & {
					_zod: {
						def: { items: readonly z.ZodType[]; rest: z.ZodType | null };
					};
				};
				const originalItems = Array.isArray(objectInput) ? objectInput : value;
				return Array.from(value, (item, index) => {
					const itemSchema = tuple._zod.def.items[index] ?? tuple._zod.def.rest;
					return itemSchema === null || itemSchema === undefined
						? item
						: orderValue(
								item,
								itemSchema,
								`${path}[${index}]`,
								active,
								originalItems[index],
								originalItems[index],
							);
				});
			}
			if (definition.type === "unknown" || definition.type === "any")
				return Array.from(value, (item, index) =>
					orderValue(
						item,
						z.unknown(),
						`${path}[${index}]`,
						active,
						originalItems[index],
						originalItems[index],
					),
				);
			return value;
		} finally {
			active.delete(value);
		}
	}
	if (value === null || typeof value !== "object") return value;
	if (
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	)
		return value;
	if (active.has(value))
		throw new RenderError("Circular value is not JSON", path);
	active.add(value);
	try {
		const object = value as Record<string, unknown>;
		const ordered: Record<string, unknown> = Object.create(null);
		const put = (key: string, child: unknown, childSchema: z.ZodType) => {
			if (child !== undefined) {
				const originalChild =
					objectInput !== null && typeof objectInput === "object"
						? Reflect.get(objectInput, key)
						: child;
				Object.defineProperty(ordered, key, {
					value: orderValue(
						child,
						childSchema,
						`${path}.${key}`,
						active,
						originalChild,
						originalChild,
					),
					enumerable: true,
					configurable: true,
					writable: true,
				});
			}
		};
		const protoKey =
			objectInput !== null && typeof objectInput === "object"
				? Object.getOwnPropertyDescriptor(objectInput, "__proto__")
				: undefined;
		if (protoKey?.enumerable && !Object.hasOwn(object, "__proto__")) {
			Object.defineProperty(object, "__proto__", {
				value: protoKey.value,
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
		if (definition.type === "unknown" || definition.type === "any") {
			for (const key of Object.keys(object).sort())
				put(key, object[key], z.unknown());
			return ordered;
		}
		if (definition.type === "object") {
			const objectSchema = current as typeof current & {
				shape: Record<string, z.ZodType>;
				_zod: { def: { catchall?: z.ZodType } };
			};
			for (const [key, childSchema] of Object.entries(objectSchema.shape))
				put(key, object[key], childSchema);
			const extraSchema = objectSchema._zod.def.catchall ?? z.unknown();
			for (const key of Object.keys(object)
				.filter((name) => !Object.hasOwn(objectSchema.shape, name))
				.sort())
				put(key, object[key], extraSchema);
			return ordered;
		}
		if (definition.type === "record") {
			const record = current as typeof current & { valueType: z.ZodType };
			for (const key of Object.keys(object).sort())
				put(key, object[key], record.valueType);
			return ordered;
		}
		for (const key of Object.keys(object).sort())
			put(key, object[key], z.unknown());
		return ordered;
	} finally {
		active.delete(value);
	}
}

export function orderParsedValue(
	value: unknown,
	schema: z.ZodType,
	inputValue: unknown,
): unknown {
	return orderValue(value, schema, "$", new WeakSet(), inputValue, inputValue);
}

export function orderUnnamedKeys(value: unknown, schema: z.ZodType): unknown {
	return orderParsedValue(value, schema, value);
}
