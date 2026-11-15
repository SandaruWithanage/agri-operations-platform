import { URL } from "node:url";
import { writeFile } from "node:fs/promises";
// The NestJS runtime uses CommonJS; browser bundlers continue consuming typed sources.
await writeFile(
  new URL("./dist/package.json", import.meta.url),
  '{"type":"commonjs"}\n',
);
