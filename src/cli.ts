#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isConfigModule } from "./define.ts";
import { findModules } from "./discover.ts";
import { renderModule } from "./render.ts";

function usage(): string {
	return "Usage: tabit [--check] [<dir>...]";
}

export async function runCli(args: readonly string[]): Promise<number> {
	let check = false;
	const directories: string[] = [];
	for (const arg of args) {
		if (arg === "--check" && !check) {
			check = true;
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(usage());
			return 2;
		}
		directories.push(resolve(arg));
	}
	let modules: string[];
	try {
		modules = await findModules(
			directories.length > 0 ? directories : [process.cwd()],
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	let stale = false;
	for (const modulePath of modules) {
		try {
			const loaded: unknown = await import(pathToFileURL(modulePath).href);
			if (
				loaded === null ||
				typeof loaded !== "object" ||
				!("default" in loaded) ||
				!isConfigModule(loaded.default)
			) {
				throw new Error(
					"Config module must default-export a value created by defineConfig",
				);
			}
			for (const file of renderModule(loaded.default, dirname(modulePath))) {
				let current: string | undefined;
				try {
					current = await readFile(file.path, "utf8");
				} catch (error) {
					if (
						!(error instanceof Error) ||
						!("code" in error) ||
						error.code !== "ENOENT"
					) {
						throw error;
					}
				}
				if (check) {
					if (current !== file.contents) {
						console.error(`${file.path} is stale; run tabit to update it.`);
						stale = true;
					}
				} else {
					await writeFile(file.path, file.contents, "utf8");
				}
			}
		} catch (error) {
			console.error(
				`${modulePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
			stale = true;
		}
	}
	return stale ? 1 : 0;
}

if (import.meta.main) process.exitCode = await runCli(process.argv.slice(2));
