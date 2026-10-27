// scripts/validate-lib.mjs and data/catalog.schema.json describe the same entries.
// scripts/check-schema.py holds the schema to the fixtures in tests/fixtures/; this file holds
// validate-lib to the same ones, so a rule added to one and not the other fails here.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCatalog, KINDS, FIELDS, isSiteRoot, newUsedBy } from "../scripts/validate-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const categories = read("data/categories.json");
const schema = read("data/catalog.schema.json");
const fixtures = (dir) =>
  readdirSync(path.join(root, "tests/fixtures", dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [`${dir}/${f}`, read(`tests/fixtures/${dir}/${f}`)]);

for (const [name, catalog] of fixtures("valid"))
  test(`accepts ${name}`, () => assert.deepEqual(validateCatalog(catalog, categories), []));

for (const [name, catalog] of [...fixtures("invalid"), ...fixtures("invalid-cross-entry")])
  test(`rejects ${name}`, () => assert.notDeepEqual(validateCatalog(catalog, categories), []));

test("fields, kinds and categories match data/catalog.schema.json", () => {
  const entry = schema.$defs.entry.properties;
  assert.deepEqual([...FIELDS].sort(), Object.keys(entry).sort());
  assert.deepEqual([...KINDS].sort(), [...entry.kind.enum].sort());
  assert.deepEqual(categories.map((c) => c.id).sort(), [...entry.category.enum].sort());
});

test("isSiteRoot tells a front page from a page that shows the use", () => {
  for (const url of ["https://openneuro.org", "https://openneuro.org/", "http://www.example.org/"]) assert.ok(isSiteRoot(url), url);
  for (const url of [
    "https://bids-specification.readthedocs.io/en/stable/glossary.html#objects.metadata.CogAtlasID",
    "https://github.com/sccn/NEMAR-pipeline",
    "https://example.org/#adopters",
    "https://example.org/?q=bids",
    "not a url",
  ])
    assert.ok(!isSiteRoot(url), url);
});

test("newUsedBy lists only usedBy links the earlier catalog didn't have", () => {
  const before = [{ id: "a", usedBy: [{ name: "X", url: "https://x.org/" }] }, { id: "b" }];
  const now = [
    { id: "a", usedBy: [{ name: "X", url: "https://x.org/" }, { name: "Y", url: "https://y.org/" }] },
    { id: "b", usedBy: [{ name: "X", url: "https://x.org/docs" }] },
    { id: "c", usedBy: [{ name: "Z", url: "https://z.org/" }] },
  ];
  assert.deepEqual(
    newUsedBy(now, before).map((u) => `${u.id}:${u.name}`),
    ["a:Y", "b:X", "c:Z"],
  );
  assert.deepEqual(newUsedBy(now, now), []);
});
