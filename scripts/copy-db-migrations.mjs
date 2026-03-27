import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourceDir = path.join(repoRoot, "src", "lib", "migrations");
const targetDir = path.join(repoRoot, "dist", "migrations");

await fs.mkdir(targetDir, { recursive: true });

for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".sql")) {
    continue;
  }
  await fs.copyFile(
    path.join(sourceDir, entry.name),
    path.join(targetDir, entry.name),
  );
}
