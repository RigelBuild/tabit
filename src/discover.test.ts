import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { isConfigModule } from "./define.ts";
import { findModules } from "./discover.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "tabit-discovery-"));
	directories.push(directory);
	return directory;
}

describe("module discovery", () => {
	test("skips config files that do not import the library", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "plain.config.ts"), "export default {};\n");
		await writeFile(
			join(directory, "tool.config.ts"),
			"import 'node:assert'; export default {};\n",
		);
		const nested = join(directory, ".hidden");
		await mkdir(nested);
		await writeFile(
			join(nested, "hidden.config.ts"),
			"import '@rigelbuild/tabit';\n",
		);
		expect(await findModules([directory])).toEqual([]);
	});
	test("selects imports separated by comments but ignores type-only imports and comments", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "commented.config.ts"),
			"import { /* note */ defineConfig } from /* note */ '@rigelbuild/tabit';\n",
		);
		await writeFile(
			join(directory, "type-only.config.ts"),
			"import type { ConfigModule } from '@rigelbuild/tabit';\n",
		);
		await writeFile(
			join(directory, "string.config.ts"),
			"const note = \"import { defineConfig } from '@rigelbuild/tabit'\";\n",
		);
		expect(await findModules([directory])).toEqual([
			join(directory, "commented.config.ts"),
		]);
	});
	test("ignores named imports whose bindings are all type-only", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "type-only-named.config.ts"),
			"import { type ConfigModule } from '@rigelbuild/tabit';\n",
		);
		expect(await findModules([directory])).toEqual([]);
	});

	test("discovers module files reached through symlinks", async () => {
		const directory = await temporaryDirectory();
		const target = join(directory, "target");
		await mkdir(target);
		const source = join(target, "linked.config.ts");
		await writeFile(
			source,
			"import { defineConfig } from '@rigelbuild/tabit';\n",
		);
		await symlink(source, join(directory, "alias.config.ts"));
		expect(await findModules([directory])).toEqual([
			join(directory, "alias.config.ts"),
			source,
		]);
	});

	test("stops directory symlink cycles while finding ordinary modules", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "normal.config.ts"),
			"import '@rigelbuild/tabit';\n",
		);
		await symlink(directory, join(directory, "cycle"));
		expect(await findModules([directory])).toEqual([
			join(directory, "normal.config.ts"),
		]);
	});

	test("ignores import types and type re-exports but accepts side-effect imports", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "import-type.config.ts"),
			"type Config = import('@rigelbuild/tabit').ConfigModule;\n",
		);
		await writeFile(
			join(directory, "type-reexport.config.ts"),
			"export type { ConfigModule } from '@rigelbuild/tabit';\n",
		);
		await writeFile(
			join(directory, "side-effect.config.ts"),
			"import '@rigelbuild/tabit';\n",
		);
		expect(await findModules([directory])).toEqual([
			join(directory, "side-effect.config.ts"),
		]);
	});

	test("hidden-directory fixture contains a real named package import", async () => {
		const directory = await temporaryDirectory();
		const nested = join(directory, ".hidden");
		await mkdir(nested);
		await writeFile(
			join(nested, "hidden.config.ts"),
			"import { defineConfig } from '@rigelbuild/tabit';\nexport default defineConfig;\n",
		);
		expect(await findModules([directory])).toEqual([]);
	});

	test("rejects malformed branded modules and invalid target suffixes", () => {
		const otherBrand = Symbol.for("@rigelbuild/tabit.module");
		const schema = z.strictObject({ value: z.string() });
		const base = {
			[otherBrand]: true,
			schema,
			build: () => ({ value: "x" }),
		};
		expect(isConfigModule({ ...base, target: {} })).toBe(false);
		expect(isConfigModule({ ...base, target: { out: "a.txt" } })).toBe(false);
		expect(
			isConfigModule({
				...base,
				target: { out: "a.json", schemaOut: "b.txt" },
			}),
		).toBe(false);
	});
});
