#!/usr/bin/env node
// Prints the ids of catalog entries that differ from a git ref (default: origin/main).
// Usage: node scripts/changed-entries.mjs [ref]
import { readFileSync } from "node:fs";
import { catalogAt, changedIds } from "./git-catalog.mjs";

const ref = process.argv[2] || "origin/main";
const now = JSON.parse(readFileSync("data/catalog.json", "utf8"));
console.log(changedIds(now, catalogAt(ref)).join(","));
