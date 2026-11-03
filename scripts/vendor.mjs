#!/usr/bin/env node
// Refreshes the vendored graph libraries in src/assets/vendor/ from pinned npm releases.
// Only needed when upgrading them; the site build itself has no dependencies.
//   node scripts/vendor.mjs          download, verify npm integrity, copy/bundle, write SHA256SUMS
//   node scripts/vendor.mjs --check  verify the committed files against SHA256SUMS (no network)
// graphology and sigma are copied unchanged from their published UMD builds. ForceAtlas2 is published as
// CommonJS only, so it is bundled into an IIFE (global `graphologyLayoutForceAtlas2`) with a pinned esbuild.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root } from "./paths.mjs";

const PACKAGES = {
  graphology: "0.26.0",
  sigma: "3.0.2",
  "graphology-layout-forceatlas2": "0.10.1",
  "graphology-utils": "2.5.2", // dependency of ForceAtlas2, bundled into it
};
const ESBUILD = "0.28.2";
const out = path.join(root, "src/assets/vendor");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (process.argv.includes("--check")) {
  const sums = (await readFile(path.join(out, "SHA256SUMS"), "utf8")).trim().split("\n");
  let bad = 0;
  for (const line of sums) {
    const [hash, file] = line.split(/\s+/);
    const ok = sha256(await readFile(path.join(out, file))) === hash;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${file}`);
  }
  process.exit(bad ? 1 : 0);
}

const work = await mkdtemp(path.join(tmpdir(), "neuroschema-vendor-"));
try {
  const nm = path.join(work, "node_modules");
  for (const [name, version] of Object.entries(PACKAGES)) {
    const meta = await (await fetch(`https://registry.npmjs.org/${name}/${version}`)).json();
    const tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
    const [algo, expected] = meta.dist.integrity.split("-");
    const actual = createHash(algo).update(tgz).digest("base64");
    if (actual !== expected) throw new Error(`${name}@${version}: integrity mismatch`);
    const dir = path.join(nm, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(work, `${name}.tgz`), tgz);
    execFileSync("tar", ["xzf", path.join(work, `${name}.tgz`), "-C", dir, "--strip-components=1"]);
    console.log(`✓ ${name}@${version} (${meta.dist.integrity.slice(0, 20)}…)`);
  }
  await mkdir(out, { recursive: true });
  const files = {
    "graphology.umd.min.js": path.join(nm, "graphology/dist/graphology.umd.min.js"),
    "sigma.min.js": path.join(nm, "sigma/dist/sigma.min.js"),
    "LICENSE.graphology.txt": path.join(nm, "graphology/LICENSE.txt"),
    "LICENSE.sigma.txt": path.join(nm, "sigma/LICENSE.txt"),
    "LICENSE.graphology-layout-forceatlas2.txt": path.join(nm, "graphology-layout-forceatlas2/LICENSE.txt"),
  };
  for (const [to, from] of Object.entries(files)) await copyFile(from, path.join(out, to));
  await writeFile(path.join(work, "entry.js"), 'module.exports = require("graphology-layout-forceatlas2");\n');
  const fa2 = "graphology-layout-forceatlas2.min.js";
  execFileSync("npx", ["--yes", `esbuild@${ESBUILD}`, path.join(work, "entry.js"), "--bundle", "--minify", "--format=iife", "--global-name=graphologyLayoutForceAtlas2", "--legal-comments=none", `--outfile=${path.join(out, fa2)}`], { cwd: work, stdio: "inherit" });
  const banner = `/* graphology-layout-forceatlas2@${PACKAGES["graphology-layout-forceatlas2"]} + graphology-utils@${PACKAGES["graphology-utils"]}, MIT (see LICENSE.graphology-layout-forceatlas2.txt). Bundled by scripts/vendor.mjs with esbuild@${ESBUILD}. */\n`;
  await writeFile(path.join(out, fa2), banner + (await readFile(path.join(out, fa2), "utf8")));
  const names = [...Object.keys(files), fa2].sort();
  const sums = await Promise.all(names.map(async (f) => `${sha256(await readFile(path.join(out, f)))}  ${f}`));
  await writeFile(path.join(out, "SHA256SUMS"), sums.join("\n") + "\n");
  await writeFile(
    path.join(out, "VERSIONS.json"),
    JSON.stringify({ packages: PACKAGES, esbuild: ESBUILD, source: "https://registry.npmjs.org/", script: "scripts/vendor.mjs" }, null, 2) + "\n"
  );
  console.log(`Wrote ${names.length} files to ${path.relative(root, out)}/`);
} finally {
  await rm(work, { recursive: true, force: true });
}
