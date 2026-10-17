# @rigelbuild/tabit

Define Zod-backed TypeScript configuration and render deterministic JSON with Bun.

Pronounced TAH-bit. Named for the star π3 Ori, "the enduring one".

Install with `bun add @rigelbuild/tabit`.

## Define a config module

```ts
import { defineConfig } from "@rigelbuild/tabit";
import { z } from "zod";

const Settings = z.strictObject({ service: z.string(), retries: z.int().default(3) });
export default defineConfig(Settings, () => ({ service: "worker" }), {
  out: "./settings.json",
  schemaOut: "./settings.schema.json",
});
```

The module filename ends in `.config.ts`. Config objects should use `z.strictObject` or an explicitly open object schema. Rendering rejects unclosed object schemas, transforms, intersections, and values that JSON cannot represent. It also rejects schema types that JSON Schema cannot represent: dates, bigints, maps, functions, and `undefined`.

## Render and check

```sh
tabit [--check] [<dir>...]
```

The command searches the current directory recursively for config modules. It skips dot directories and `node_modules`, and selects files with runtime imports from this package; type-only imports and exports do not count. Pass directories to limit the search. `tabit` writes JSON and optional JSON Schema files beside each module. `tabit --check` compares the expected bytes without writing.

The exit code is `0` when rendering succeeds or every output is current, `1` for an invalid config or stale output, and `2` for invalid command usage.

## Tests

Import `expectCommitted` and `renderForSnapshot` from `@rigelbuild/tabit/testing` to check rendered files or collect output for snapshots. Paths may be absolute or resolved against the caller's current working directory. `expectCommitted` reports missing output files with their paths.
