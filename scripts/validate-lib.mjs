// Catalog validation rules, shared by the build, `npm run validate` and CI.
// Mirrors data/catalog.schema.json, plus cross-entry checks (duplicates) that JSON Schema can't express.

export const KINDS = ["ontology", "schema", "vocabulary", "atlas", "data-standard", "knowledge-base"];
// Curated relations between catalog entries ("<this entry> <type> <target>"), shown in the relationship graph.
// Imports between ontologies are also harvested from OLS, Bioregistry and the OBO Dashboard (scripts/graph.mjs).
export const RELATION_TYPES = {
  imports: "imports or reuses terms from",
  uses: "references terms, identifiers or annotations from",
  extends: "extends",
  "derived-from": "is derived from or adapted from",
  "maps-to": "provides a mapping or conversion to",
  "part-of": "is a component or module of",
};
const ALLOWED = new Set([
  "id", "acronym", "name", "category", "kind", "description", "formats", "species", "maintainer", "license",
  "homepage", "repository", "download", "ols", "obo", "bioportal", "bioregistry", "status", "publications", "usedBy", "modules", "tools", "tags", "relations",
]);
const URL_FIELDS = ["homepage", "repository", "download"];
const isUrl = (s) => typeof s === "string" && /^https?:\/\/[^\s]+$/.test(s);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const normUrl = (s) => String(s || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");

export function validateEntry(e, categoryIds) {
  const p = [];
  const where = `entry "${e?.id ?? "?"}"`;
  if (!e || typeof e !== "object") return [`${where}: not an object`];
  for (const k of Object.keys(e)) if (!ALLOWED.has(k)) p.push(`${where}: unknown field "${k}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id || "")) p.push(`${where}: "id" must be lowercase letters/digits separated by dashes`);
  for (const k of ["name", "category", "kind", "description"]) if (!e[k] || typeof e[k] !== "string") p.push(`${where}: "${k}" is required`);
  if (e.category && !categoryIds.has(e.category)) p.push(`${where}: unknown category "${e.category}" (use one of ${[...categoryIds].join(", ")})`);
  if (e.kind && !KINDS.includes(e.kind)) p.push(`${where}: unknown kind "${e.kind}" (use one of ${KINDS.join(", ")})`);
  if (e.description && e.description.length < 40) p.push(`${where}: description should be at least 40 characters`);
  if (e.description && e.description.length > 600) p.push(`${where}: description should be at most 600 characters`);
  if (!e.homepage && !e.repository) p.push(`${where}: give at least a homepage or a repository`);
  for (const k of URL_FIELDS) if (e[k] != null && !isUrl(e[k])) p.push(`${where}: "${k}" must be an http(s) URL`);
  for (const k of ["formats", "species", "tags"]) if (e[k] != null && (!Array.isArray(e[k]) || e[k].some((x) => typeof x !== "string" || !x.trim()))) p.push(`${where}: "${k}" must be a list of strings`);
  if (e.status != null && !["active", "legacy"].includes(e.status)) p.push(`${where}: "status" must be "active" or "legacy"`);
  for (const k of ["ols", "obo"]) if (e[k] != null && !/^[a-z0-9_]+$/.test(e[k])) p.push(`${where}: "${k}" must be a lowercase id`);
  for (const [i, pub] of (e.publications || []).entries()) {
    if (!pub?.title || !pub?.doi) p.push(`${where}: publications[${i}] needs "title" and "doi"`);
    if (pub?.doi && !/^10\.\d{4,9}\/\S+$/.test(pub.doi)) p.push(`${where}: publications[${i}].doi "${pub.doi}" is not a DOI (expected 10.xxxx/…)`);
    if (pub?.year != null && !(Number.isInteger(pub.year) && pub.year > 1900 && pub.year < 2100)) p.push(`${where}: publications[${i}].year must be a year`);
  }
  for (const k of ["usedBy", "modules", "tools"])
    for (const [i, u] of (e[k] || []).entries()) {
      if (!u?.name) p.push(`${where}: ${k}[${i}] needs "name"`);
      if (!isUrl(u?.url)) p.push(`${where}: ${k}[${i}] needs an http(s) "url"`);
    }
  if (e.relations != null && !Array.isArray(e.relations)) p.push(`${where}: "relations" must be a list`);
  const relSeen = new Set();
  for (const [i, r] of (Array.isArray(e.relations) ? e.relations : []).entries()) {
    for (const k of Object.keys(r || {})) if (!["type", "target", "note", "url"].includes(k)) p.push(`${where}: relations[${i}] has unknown field "${k}"`);
    if (!Object.hasOwn(RELATION_TYPES, r?.type)) p.push(`${where}: relations[${i}].type must be one of ${Object.keys(RELATION_TYPES).join(", ")}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r?.target || "")) p.push(`${where}: relations[${i}].target must be the id of a catalog entry`);
    if (r?.target === e.id) p.push(`${where}: relations[${i}] points at the entry itself`);
    if (r?.url != null && !isUrl(r.url)) p.push(`${where}: relations[${i}].url must be an http(s) URL`);
    if (r?.note != null && typeof r.note !== "string") p.push(`${where}: relations[${i}].note must be a string`);
    const key = `${r?.type} ${r?.target}`;
    if (relSeen.has(key)) p.push(`${where}: relations[${i}] repeats "${key}"`);
    relSeen.add(key);
  }
  return p;
}

// Cross-entry checks: duplicate ids, names, acronyms, homepages, repositories or downloads.
export function validateCatalog(catalog, categories) {
  const categoryIds = new Set(categories.map((c) => c.id));
  if (!Array.isArray(catalog)) return ["catalog.json must be a JSON array"];
  const problems = catalog.flatMap((e) => validateEntry(e, categoryIds));
  const seen = { id: new Map(), name: new Map(), acronym: new Map(), url: new Map() };
  for (const e of catalog) {
    const check = (bucket, key, label) => {
      if (!key) return;
      if (seen[bucket].has(key)) problems.push(`entry "${e.id}": same ${label} as "${seen[bucket].get(key)}" — possible duplicate`);
      else seen[bucket].set(key, e.id);
    };
    check("id", e.id, "id");
    check("name", norm(e.name), "name");
    if (e.acronym && e.acronym !== e.name) check("acronym", norm(e.acronym), "acronym");
    // Several entries may legitimately share a repository (e.g. NIF-Ontology hosts NIFSTD and NPO),
    // so only downloads must be unique.
    if (e.download) check("url", normUrl(e.download), "download URL");
  }
  const ids = new Set(catalog.map((e) => e.id));
  for (const e of catalog)
    for (const [i, r] of (Array.isArray(e.relations) ? e.relations : []).entries())
      if (r?.target && r.target !== e.id && !ids.has(r.target)) problems.push(`entry "${e.id}": relations[${i}].target "${r.target}" is not in the catalog`);
  return problems;
}
