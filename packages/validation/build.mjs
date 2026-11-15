import { URL } from "node:url";
import { writeFile } from "node:fs/promises";
// Node 26 loads this ESM build from both imports and synchronous require calls.
await writeFile(
  new URL("./dist/package.json", import.meta.url),
  '{"type":"module"}\n',
);
