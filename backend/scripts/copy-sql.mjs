// Copy non-TS assets (*.sql) into dist after tsc, mirroring the src/ layout under dist/src.
// tsc only emits compiled .ts files, but server code (e.g. ingest/indexAfterLoad.ts) and the
// migration runner read .sql files at runtime relative to their compiled location.
import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(backendRoot, "src");
const outRoot = join(backendRoot, "dist", "src");

function copySqlRecursively(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      copySqlRecursively(fullPath);
    } else if (entry.name.endsWith(".sql")) {
      const rel = fullPath.slice(srcDir.length + 1);
      const dest = join(outRoot, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(fullPath, dest);
      console.log(`copied ${rel}`);
    }
  }
}

copySqlRecursively(srcDir);
