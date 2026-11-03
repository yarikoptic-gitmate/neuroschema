// Relationship graph between catalog entries, derived at build time (published as /graph.json).
//
// The JSON uses the same {nodes, edges} shape as the ORINOCO-Lite explorer (nodes: id, label, type, size, url;
// edges: id, source, target, type), so either viewer can render it. Extra fields carry provenance.
// Edges read "source <type> target"; each lists the evidence behind it and where that came from:
//   imports       OLS importsFrom/exportsTo, Bioregistry dependsOn/appearsIn, the ontology file itself
//                 (owl:imports and term use, scripts/artefact-scan.mjs), OBO Dashboard usedBy, or curated
//   uses, extends, derived-from, maps-to, part-of
//                 curated `relations` in data/catalog.json; `usedBy` items naming another entry become `uses`
//   adopts        a project → the entry it adopts (curated `usedBy` and OBO Foundry registry usages)
// Nodes are catalog entries (type = kind), vocabularies outside the catalog that entries import (type "external"),
// and adopting projects (type "project"). Reuse by ontologies outside the catalog is not drawn: it would add
// hundreds of leaves (CL alone is reused by ~90) and is already listed on each entry page.
import { BASIC_VOCABS, adopters } from "./rubric.mjs";
import { RELATION_TYPES } from "./validate-lib.mjs";

export const EDGE_TYPES = { ...RELATION_TYPES, adopts: "adopts" };
// When one pair is linked in several ways, the edge is typed by the most specific relation.
const PRECEDENCE = ["part-of", "extends", "derived-from", "maps-to", "uses", "imports", "adopts"];
const PRETTY = { ncbitaxon: "NCBITaxon", schemaorg_https: "schema.org", schemaorg_http: "schema.org", chebi: "ChEBI", envo: "ENVO", foodon: "FoodOn", hsapdv: "HsapDv" };
const normUrl = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
const clip = (s, n = 240) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || undefined);

export function buildGraph(catalog, evaluation, { kindLabel = {}, categories = [] } = {}) {
  const ev = (id) => evaluation?.entries?.[id] || null;
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  // Resolve registry prefixes to catalog ids, and usedBy items by acronym or name. Not by URL: a programme and
  // its standard can share a homepage (SPARC and the SPARC Data Structure both live at sparc.science).
  const byKey = new Map();
  for (const e of catalog) for (const k of [e.id, e.ols, e.obo, e.bioregistry, ev(e.id)?.bioregistry?.prefix]) if (k) byKey.set(String(k).toLowerCase(), e.id);
  const byName = new Map(catalog.flatMap((e) => [e.acronym, e.name].filter(Boolean).map((n) => [n.toLowerCase(), e.id])));
  const entryFor = (u) => byName.get(String(u.name || "").toLowerCase()) || null;

  const nodes = new Map();
  const edges = new Map();
  const link = (source, target, type, evidence) => {
    if (!source || !target || source === target) return;
    const key = `${source}\u0000${target}`;
    const edge = edges.get(key) || { source, target, evidence: [] };
    const same = edge.evidence.find((x) => x.type === type && x.note === evidence.note);
    if (same) same.via = [...new Set([...same.via, ...evidence.via])];
    else edge.evidence.push({ type, ...evidence });
    edges.set(key, edge);
  };

  for (const e of catalog) {
    const r = ev(e.id);
    nodes.set(e.id, {
      id: e.id,
      label: e.acronym || e.name,
      type: e.kind,
      url: `/o/${e.id}/`,
      name: e.name,
      kindLabel: kindLabel[e.kind] || e.kind,
      category: e.category,
      categoryName: catName[e.category] || e.category,
      grade: r?.grade || null,
      score: r?.score ?? null,
      legacy: e.status === "legacy" || undefined,
      description: e.description,
    });
  }

  // Harvested imports/reuse between ontologies (and their imports from vocabularies outside the catalog).
  const external = (prefix) => {
    const id = `ext:${prefix}`;
    if (!nodes.has(id)) nodes.set(id, { id, label: PRETTY[prefix] || prefix.toUpperCase(), type: "external", url: `https://bioregistry.io/${encodeURIComponent(prefix)}`, name: `${PRETTY[prefix] || prefix.toUpperCase()} (not in the catalog)` });
    return id;
  };
  const harvested = (e, list, via, reverse) => {
    for (const raw of list || []) {
      const x = String(raw).toLowerCase();
      if (BASIC_VOCABS.includes(x)) continue;
      const other = byKey.get(x);
      if (reverse) {
        if (other) link(other, e.id, "imports", { via: [via] });
      } else link(e.id, other || external(x), "imports", { via: [via] });
    }
  };
  for (const e of catalog) {
    const r = ev(e.id);
    if (!r) continue;
    harvested(e, r.ols?.importsFrom, "OLS", false);
    harvested(e, r.bioregistry?.dependsOn, "Bioregistry", false);
    // Same evidence as rubric.mjs imports(): owl:imports and vocabularies whose terms the file uses.
    const scan = r.artefactScan && !r.artefactScan.error ? r.artefactScan : null;
    harvested(e, [...(scan?.imports || []).map((x) => x.id).filter(Boolean), ...Object.keys(scan?.uses || {})], "ontology file", false);
    harvested(e, r.ols?.exportsTo, "OLS", true);
    harvested(e, r.bioregistry?.appearsIn, "Bioregistry", true);
    harvested(e, r.dashboard?.usedBy, "OBO Dashboard", true);
  }

  // Curated relations, then adopters: a usedBy item naming another entry is a relation, anything else is a project.
  for (const e of catalog) for (const rel of e.relations || []) link(e.id, rel.target, rel.type, { via: ["catalog"], note: rel.note, url: rel.url });
  const projects = new Map();
  for (const e of catalog) {
    for (const a of adopters(e, ev(e.id))) {
      const other = a.source === "curated" ? entryFor(a) : null;
      if (other && other !== e.id) {
        link(other, e.id, "uses", { via: ["catalog (usedBy)"], note: a.note });
        continue;
      }
      const key = normUrl(a.url);
      const p = projects.get(key) || { names: [], url: a.url, adopts: [] };
      if (a.source === "curated") p.names.unshift(a.name);
      else p.names.push(a.name);
      p.adopts.push([e.id, { via: [a.source === "curated" ? "catalog (usedBy)" : a.source], note: clip(a.note) }]);
      projects.set(key, p);
    }
  }
  for (const [key, p] of projects) {
    const id = `project:${key}`;
    nodes.set(id, { id, label: p.names[0], type: "project", url: p.url, name: p.names[0] });
    for (const [target, evidence] of p.adopts) link(id, target, "adopts", evidence);
  }

  // Finalise: primary type per edge, degree-based size (ORINOCO-Lite sizes nodes by `size`).
  const degree = new Map();
  const out = [...edges.values()]
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
    .map((x, i) => {
      for (const n of [x.source, x.target]) degree.set(n, (degree.get(n) || 0) + 1);
      const types = PRECEDENCE.filter((t) => x.evidence.some((v) => v.type === t));
      return { id: `e${i}`, source: x.source, target: x.target, type: types[0], ...(types.length > 1 ? { types } : {}), via: [...new Set(x.evidence.flatMap((v) => v.via))], evidence: x.evidence };
    });
  const order = ["ontology", "vocabulary", "schema", "data-standard", "atlas", "knowledge-base", "external", "project"];
  const list = [...nodes.values()]
    .map((n) => ({ ...n, size: degree.get(n.id) || 0 }))
    .filter((n) => n.size || !["external", "project"].includes(n.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.id.localeCompare(b.id));

  return {
    generatedAt: evaluation?.generatedAt || null,
    description: "Relationships between neuroscience ontologies, schemas, vocabularies and data standards in NeuroSchema. Edges read 'source <type> target'.",
    nodeTypes: { ...Object.fromEntries(Object.keys(kindLabel).map((k) => [k, kindLabel[k]])), external: "Vocabulary outside the catalog", project: "Adopting project" },
    edgeTypes: EDGE_TYPES,
    nodes: list,
    edges: out,
  };
}
