import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "tabit-cli-"));
	directories.push(directory);
	const scope = join(directory, "node_modules", "@rigelbuild");
	await mkdir(scope, { recursive: true });

	await symlink(process.cwd(), join(scope, "tabit"));
	await symlink(
		join(process.cwd(), "node_modules", "zod"),
		join(directory, "node_modules", "zod"),
	);
	return directory;
}

const moduleSource =
	"import { defineConfig } from '@rigelbuild/tabit';\nimport { z } from 'zod';\nexport default defineConfig(z.strictObject({ name: z.string() }), () => ({ name: 'sample' }), { out: './result.json' });\n";

describe("CLI", () => {
	test("check reports an existing stale output without changing its bytes", async () => {
		const directory = await temporaryDirectory();
		const output = join(directory, "result.json");
		await writeFile(output, "stale bytes\n");
		await writeFile(join(directory, "sample.config.ts"), moduleSource);
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await runCli(["--check", directory])).toBe(1);
			expect(error).toHaveBeenCalledWith(
				`${output} is stale; run tabit to update it.`,
			);
			expect(await readFile(output, "utf8")).toBe("stale bytes\n");
		} finally {
			error.mockRestore();
		}
	});

	test("check reports a missing output and leaves it absent", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "sample.config.ts"),
			moduleSource.replace("./result.json", "./missing.json"),
		);
		expect(await runCli(["--check", directory])).toBe(1);
		expect(await Bun.file(join(directory, "missing.json")).exists()).toBe(
			false,
		);
	});

	test("render writes output and check passes only while bytes match", async () => {
		const directory = await temporaryDirectory();
		const output = join(directory, "result.json");
		await writeFile(join(directory, "sample.config.ts"), moduleSource);
		expect(await runCli([directory])).toBe(0);
		expect(await runCli(["--check", directory])).toBe(0);
		await writeFile(output, "edited bytes\n");
		expect(await runCli(["--check", directory])).toBe(1);
		expect(await readFile(output, "utf8")).toBe("edited bytes\n");
	});

	test("returns 1 when a matching module does not default-export a config", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "invalid.config.ts"),
			"import {} from '@rigelbuild/tabit'; export default {};\n",
		);
		expect(await runCli([directory])).toBe(1);
	});
	test("does not load files with only a type-only package reference", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "types.config.ts"),
			"export type { ConfigModule } from '@rigelbuild/tabit';\n",
		);
		expect(await runCli([directory])).toBe(0);
	});

	test("usage errors return 2 and print tabit usage", async () => {
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await runCli(["--unknown"])).toBe(2);
			expect(error).toHaveBeenCalledWith("Usage: tabit [--check] [<dir>...]");
		} finally {
			error.mockRestore();
		}
	});
});
