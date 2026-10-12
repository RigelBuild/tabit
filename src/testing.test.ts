import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expectCommitted, renderForSnapshot } from "./testing.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function configFixture() {
	const directory = await mkdtemp(join(process.cwd(), ".tabit-testing-"));
	directories.push(directory);
	const modulePath = join(directory, "fixture.config.ts");
	const source = `import { defineConfig } from '${process.cwd()}/src/index.ts';\nimport { z } from '${process.cwd()}/node_modules/zod/index.js';\nexport default defineConfig(z.strictObject({ name: z.string() }), () => ({ name: 'fixture' }), { out: './result.json' });\n`;
	await writeFile(modulePath, source);
	return { directory: await realpath(directory), modulePath };
}

describe("testing helpers", () => {
	test("renders files for snapshots by absolute path", async () => {
		const { directory, modulePath } = await configFixture();
		expect(await renderForSnapshot(modulePath)).toEqual({
			[join(directory, "result.json")]: '{\n\t"name": "fixture"\n}\n',
		});
	});

	test("resolves relative paths from the caller's working directory", async () => {
		const { directory } = await configFixture();
		const relativePath = relative(process.cwd(), directory);
		expect(
			await renderForSnapshot(`${relativePath}/fixture.config.ts`),
		).toEqual({
			[join(directory, "result.json")]: '{\n\t"name": "fixture"\n}\n',
		});
	});

	test("rejects mismatched committed bytes and reports missing output", async () => {
		const { directory, modulePath } = await configFixture();
		await writeFile(join(directory, "result.json"), "wrong bytes\n");
		await expect(expectCommitted(modulePath)).rejects.toThrow("does not match");
		await rm(join(directory, "result.json"));
		await expect(expectCommitted(modulePath)).rejects.toThrow(
			"result.json is missing; run tabit to create it.",
		);
	});

	test("checks committed file bytes", async () => {
		const { directory, modulePath } = await configFixture();
		await writeFile(
			join(directory, "result.json"),
			'{\n\t"name": "fixture"\n}\n',
		);
		await expect(expectCommitted(modulePath)).resolves.toBeUndefined();
	});
});
