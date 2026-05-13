// Dev-only bootstrap: registers tsx as an ESM hook, then loads the TS worker.
import { register } from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
// Pass data:{} so tsx's initialize(t) receives a truthy value — without it tsx
// thinks it was invoked via the deprecated --loader flag and throws.
register(pathToFileURL(_require.resolve("tsx/esm")).href, import.meta.url, { data: {} });

await import("./simulation-worker.ts");
