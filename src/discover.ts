import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

async function visit(
	directory: string,
	files: string[],
	visited: Set<string>,
): Promise<void> {
	const realDirectory = await realpath(directory);
	if (visited.has(realDirectory)) return;
	visited.add(realDirectory);
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) await visit(path, files, visited);
		else if (entry.isSymbolicLink()) {
			try {
				const target = await stat(path);
				if (target.isDirectory()) await visit(path, files, visited);
				else if (target.isFile() && entry.name.endsWith(".config.ts"))
					files.push(path);
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "ELOOP"
				)
					throw error;
			}
		} else if (entry.isFile() && entry.name.endsWith(".config.ts")) {
			files.push(path);
		}
	}
}

function tokens(source: string): string[] {
	const result: string[] = [];
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === "'" || char === '"' || char === "`") {
			const quote = char;
			let text = "";
			index += 1;
			while (index < source.length && source[index] !== quote) {
				if (source[index] === "\\") index += 1;
				if (index < source.length) text += source[index];
				index += 1;
			}
			index += 1;
			result.push(`string:${text}`);
			continue;
		}
		if (char === "/" && next === "/") {
			index += 2;
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (
				index < source.length &&
				!(source[index] === "*" && source[index + 1] === "/")
			)
				index += 1;
			index += 2;
			continue;
		}
		if (char !== undefined && /[A-Za-z_$]/.test(char)) {
			let word = char;
			index += 1;
			while (index < source.length && /[\w$]/.test(source[index] ?? "")) {
				word += source[index];
				index += 1;
			}
			result.push(word);
			continue;
		}
		if (char !== undefined && !/\s/.test(char)) result.push(char);
		index += 1;
	}
	return result;
}

function matchesPackage(token: string | undefined): boolean {
	if (!token?.startsWith("string:")) return false;
	const specifier = token.slice("string:".length);
	return (
		specifier === "@rigelbuild/tabit" ||
		specifier.startsWith("@rigelbuild/tabit/")
	);
}

const transpiler = new Bun.Transpiler({ loader: "ts" });

function importsRenderer(source: string): boolean {
	const input = tokens(transpiler.transformSync(source));
	for (let index = 0; index < input.length; index += 1) {
		if (input[index] === "import") {
			let cursor = index + 1;
			if (input[cursor] === "(") cursor += 1;
			else if (input[cursor]?.startsWith("string:")) {
				if (matchesPackage(input[cursor])) return true;
				continue;
			} else {
				while (
					cursor < input.length &&
					input[cursor] !== "from" &&
					input[cursor] !== ";"
				)
					cursor += 1;
				if (input[cursor] === "from") cursor += 1;
			}
			if (matchesPackage(input[cursor])) return true;
		}
		if (input[index] === "export") {
			let cursor = index + 1;
			while (
				cursor < input.length &&
				input[cursor] !== "from" &&
				input[cursor] !== ";"
			)
				cursor += 1;
			if (input[cursor] === "from" && matchesPackage(input[cursor + 1]))
				return true;
		}
	}
	return false;
}

export async function findModules(dirs: readonly string[]): Promise<string[]> {
	const files: string[] = [];
	const visited = new Set<string>();
	for (const dir of dirs) await visit(resolve(dir), files, visited);
	const candidates = await Promise.all(
		files.map(async (file) => ({ file, source: await readFile(file, "utf8") })),
	);
	return candidates
		.filter(({ source }) => importsRenderer(source))
		.map(({ file }) => file)
		.sort();
}
