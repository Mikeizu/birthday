import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const all = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : path.join(directory, entry.name),
    ),
  );
  return all.flat();
}
const assets = (await files("dist"))
  .filter((file) => !file.endsWith("/sw.js"))
  .sort();
const hash = createHash("sha256");
for (const file of assets) {
  hash.update(file);
  hash.update(await readFile(file));
}
const version = hash.digest("hex").slice(0, 16);
const list = [
  "/",
  ...assets.map(
    (file) => "/" + path.relative("dist", file).split(path.sep).join("/"),
  ),
];
const source = await readFile("public/sw.js", "utf8");
await writeFile(
  "dist/sw.js",
  source
    .replaceAll("__PRECACHE_FILES__", JSON.stringify(list))
    .replaceAll("__CACHE_VERSION__", version),
);
console.log(
  `Offline shell ${version}: ${list.length} local assets will be cached after the first online visit.`,
);
