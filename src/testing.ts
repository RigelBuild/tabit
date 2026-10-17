import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { z } from "zod";
import type { ConfigModule } from "./define.ts";
import { isConfigModule } from "./define.ts";
import { renderModule } from "./render.ts";

async function loadFixtureModule(
	modulePath: string,
): Promise<ConfigModule<z.ZodType>> {
	const url = pathToFileURL(modulePath).href;
	// Config modules are runtime-selected from the caller's test fixture path.
	const loaded: unknown = await import(url);
	if (
		loaded === null ||
		typeof loaded !== "object" ||
		!("default" in loaded) ||
		!isConfigModule(loaded.default)
	) {
		throw new TypeError(
			`${modulePath} must default-export a value created by defineConfig`,
		);
	}
	return loaded.default;
}

async function renderedFixture(modulePath: string) {
	const absolutePath = await realpath(resolve(modulePath));
	return renderModule(
		await loadFixtureModule(absolutePath),
		dirname(absolutePath),
	);
}

export async function expectCommitted(modulePath: string): Promise<void> {
	for (const file of await renderedFixture(modulePath)) {
		let actual: string;
		try {
			actual = await readFile(file.path, "utf8");
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				throw new Error(`${file.path} is missing; run tabit to create it.`);
			}
			throw error;
		}
		if (actual !== file.contents)
			throw new Error(`${file.path} does not match its rendered config`);
	}
}

export async function renderForSnapshot(
	modulePath: string,
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const file of await renderedFixture(modulePath))
		result[file.path] = file.contents;
	return result;
}
