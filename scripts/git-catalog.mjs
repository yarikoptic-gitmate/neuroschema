// data/catalog.json as it was at a git ref, for comparing a change with what came before.
import { execFileSync } from "node:child_process";

export function catalogAt(ref) {
  try {
    // The default 1 MB output limit is smaller than the catalog; hitting it made every entry look changed.
    return JSON.parse(execFileSync("git", ["show", `${ref}:data/catalog.json`], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }));
  } catch (err) {
    // No catalog at that ref (e.g. a new repo): every entry is new. Anything else is a real error.
    if (!/does not exist|exists on disk, but not in|invalid object name|unknown revision/i.test(String(err.stderr || err.message))) throw err;
    return [];
  }
}

// Ids of the entries in `now` that are new or differ from `before`.
export function changedIds(now, before) {
  const old = Object.fromEntries(before.map((e) => [e.id, JSON.stringify(e)]));
  return now.filter((e) => old[e.id] !== JSON.stringify(e)).map((e) => e.id);
}
