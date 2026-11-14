// Turns the OpenAPI spec on stdin into src/schema.d.ts text on stdout, with openapi-typescript.
// openapi-typescript needs the TypeScript 5 compiler API, which TypeScript 7 does not ship, so
// scripts/generate.ts installs typescript 5.9.3 and openapi-typescript 7.13.0 into a throwaway
// folder (argv[2]) and runs this file against them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modules = join(process.argv[2], "node_modules");
const load = async (file) => import(pathToFileURL(join(modules, file)).href);

const { default: openapiTS, astToString } = await load(
  "openapi-typescript/dist/index.mjs",
);
const { default: ts } = await load("typescript/lib/typescript.js");

const spec = JSON.parse(readFileSync(0, "utf8"));
const types = await openapiTS(spec, {
  transform: (schema) =>
    schema.format === "binary"
      ? ts.factory.createTypeReferenceNode("Blob")
      : undefined,
});
process.stdout.write(astToString(types));
