// Relationship graph: the explorer on /graph/ and the small neighbourhood graph on each entry page.
// Renders /graph.json with sigma.js + graphology and lays it out with ForceAtlas2, the same stack as the
// ORINOCO-Lite explorer. The libraries (src/assets/vendor/) load only once a graph scrolls into view.
(() => {
  const roots = [...document.querySelectorAll("[data-graph]")];
  if (!roots.length) return;
  const version = (document.currentScript?.src || "").split("?v=")[1] || "";
  const bust = (u) => (version ? `${u}?v=${version}` : u);
  const VENDOR = ["/assets/vendor/graphology.umd.min.js", "/assets/vendor/graphology-layout-forceatlas2.min.js", "/assets/vendor/sigma.min.js"];
  const loadScript = (src) =>
    new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = bust(src);
      s.onload = ok;
      s.onerror = () => fail(new Error(`could not load ${src}`));
      document.head.appendChild(s);
    });
  let libs, data;
  const loadLibs = () => (libs ||= VENDOR.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()));
  const loadData = () => (data ||= fetch(bust("/graph.json")).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`graph.json: HTTP ${r.status}`)))));

  // Colour families (CSS custom properties, so light/dark and the brand live in style.css) and shapes.
  // Three hues × two shapes keep all six kinds apart for colour-blind readers; grey = outside the catalog.
  const SHAPE = { ontology: "circle", vocabulary: "square", schema: "circle", "data-standard": "square", atlas: "circle", "knowledge-base": "square", external: "circle", project: "diamond" };
  const EDGE_GROUP = { imports: "imports", adopts: "adopts" }; // everything else is a curated relation
  const groupOf = (t) => EDGE_GROUP[t] || "curated";
  const PHRASE = {
    imports: ["Imports", "Imported by"],
    uses: ["Uses", "Used by"],
    extends: ["Extends", "Extended by"],
    "derived-from": ["Derived from", "Basis for"],
    "maps-to": ["Maps to", "Mapped from"],
    "part-of": ["Part of", "Has part"],
    adopts: ["Adopts", "Adopted by"],
  };
  const isLeafType = (t) => t === "external" || t === "project";
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const theme = () => {
    const colours = Object.fromEntries(Object.keys(SHAPE).map((k) => [k, css(`--g-${k}`)]));
    return {
      text: css("--text"), surface: css("--surface"), line: css("--line"),
      edge: css("--g-edge"), edgeStrong: css("--g-edge-strong"), highlight: css("--g-highlight"), dim: css("--g-dim"),
      node: (k) => colours[k] || colours.external,
    };
  };
  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Square and diamond nodes: sigma's point program with a different fragment shader.
  function shapePrograms(Sigma) {
    const base = Sigma.rendering.NodePointProgram;
    const shader = (dist) => `
precision mediump float;
varying vec4 v_color;
varying float v_border;
void main(void) {
  vec2 m = abs(gl_PointCoord - vec2(0.5, 0.5));
  float dist = ${dist};
  #ifdef PICKING_MODE
  gl_FragColor = dist > 0.0 ? v_color : vec4(0.0);
  #else
  float t = dist > v_border ? 1.0 : (dist > 0.0 ? dist / v_border : 0.0);
  gl_FragColor = mix(vec4(0.0), v_color, t);
  #endif
}`;
    const make = (fs) =>
      class extends base {
        getDefinition() {
          return { ...super.getDefinition(), FRAGMENT_SHADER_SOURCE: fs };
        }
      };
    // Square of the same area as the disc; diamond inscribed in the sprite.
    return { circle: Sigma.rendering.NodeCircleProgram, square: make(shader("0.443 - max(m.x, m.y)")), diamond: make(shader("0.5 - (m.x + m.y)")) };
  }

  // Label backdrop on hover, drawn in theme colours (sigma's default is a white box).
  const drawHover = (getTheme) => (ctx, d, s) => {
    const t = getTheme();
    const size = s.labelSize;
    ctx.font = `${s.labelWeight} ${size}px ${s.labelFont}`;
    const label = d.label || "";
    const w = ctx.measureText(label).width;
    const x = d.x + d.size + 4;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size + 3, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.highlight;
    ctx.stroke();
    if (!label) return;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 5, d.y - size / 2 - 5, w + 10, size + 10, 6);
    else ctx.rect(x - 5, d.y - size / 2 - 5, w + 10, size + 10);
    ctx.fillStyle = t.surface;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.line;
    ctx.stroke();
    ctx.fillStyle = t.text;
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, d.y);
  };

  function buildGraphology(G, json, keep) {
    const g = new graphology.Graph({ type: "directed", multi: false });
    const ids = keep ? new Set(keep) : null;
    const order = Object.keys(SHAPE);
    for (const n of json.nodes) {
      if (ids && !ids.has(n.id)) continue;
      // Deterministic start: each node type gets a sector, so the layout is the same on every visit.
      const a = ((order.indexOf(n.type) + hash(n.id) * 0.9) / order.length) * Math.PI * 2;
      const r = 1 + hash(n.id + "r") * 2 + (isLeafType(n.type) ? 2 : 0);
      g.addNode(n.id, { ...n, kind: n.type, type: SHAPE[n.type] || "circle", degree: n.size, x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    for (const e of json.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      g.addEdgeWithKey(e.id, e.source, e.target, { ...e, rel: e.type, group: groupOf(e.type), type: e.type === "adopts" ? "line" : "arrow" });
    }
    g.forEachNode((id, a) => {
      const d = g.degree(id);
      g.setNodeAttribute(id, "size", isLeafType(a.kind) ? 2.5 + Math.sqrt(d) * 0.9 : 4.5 + Math.min(11, Math.sqrt(d) * 1.9));
    });
    return g;
  }

  // Settings picked by comparing layouts of the real catalog: LinLog separates the OBO core from the
  // standards; outbound attraction keeps hubs (CL, Uberon) from swallowing their neighbours.
  // With `ringLeaves`, vocabularies and projects linked to a single entry are left out of the force layout
  // and placed on a small ring around that entry, so they sit next to it when shown.
  function layout(g, { ringLeaves = false } = {}) {
    const fa2 = graphologyLayoutForceAtlas2;
    const isLeaf = (id) => ringLeaves && isLeafType(g.getNodeAttribute(id, "kind")) && g.degree(id) === 1;
    const core = g.copy();
    core.filterNodes((id) => isLeaf(id)).forEach((id) => core.dropNode(id));
    fa2.assign(core, {
      iterations: core.order > 60 ? 1000 : 400,
      settings: { ...fa2.inferSettings(core), linLogMode: true, outboundAttractionDistribution: true, strongGravityMode: true, gravity: 2, scalingRatio: 10, adjustSizes: true },
    });
    core.forEachNode((id, a) => g.mergeNodeAttributes(id, { x: a.x, y: a.y }));
    if (!ringLeaves) return;
    const xs = core.mapNodes((id, a) => a.x), ys = core.mapNodes((id, a) => a.y);
    const r = 0.05 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const rings = new Map();
    g.forEachNode((id) => {
      if (!isLeaf(id)) return;
      const parent = g.neighbors(id)[0];
      rings.set(parent, [...(rings.get(parent) || []), id]);
    });
    for (const [parent, ids] of rings) {
      const { x, y } = g.getNodeAttributes(parent);
      const start = hash(parent) * Math.PI * 2;
      ids.sort().forEach((id, i) => {
        const angle = start + (Math.PI * 2 * i) / ids.length;
        const k = 1 + (ids.length > 10 ? (i % 2) * 0.45 : 0); // two staggered rings for busy hubs
        g.mergeNodeAttributes(id, { x: x + Math.cos(angle) * r * k, y: y + Math.sin(angle) * r * k });
      });
    }
  }

  // Relations of a node, grouped by phrase ("Imports", "Used by", …), for the info panel.
  function relationsOf(g, id) {
    const groups = new Map();
    const add = (phrase, other, edge) => {
      if (!groups.has(phrase)) groups.set(phrase, []);
      groups.get(phrase).push({ other, edge });
    };
    g.forEachOutEdge(id, (key, e, s, t) => add(PHRASE[e.rel]?.[0] || e.rel, t, e));
    g.forEachInEdge(id, (key, e, s) => add(PHRASE[e.rel]?.[1] || e.rel, s, e));
    const rank = Object.values(PHRASE).flat();
    return [...groups].sort((a, b) => rank.indexOf(a[0]) - rank.indexOf(b[0]));
  }
  const evidenceText = (e) =>
    (e.evidence || [])
      .map((v) => `${PHRASE[v.type]?.[0] || v.type}: ${v.via.join(", ")}${v.note ? ` — ${v.note}` : ""}`)
      .join("\n");

  async function init(root) {
    const mode = root.dataset.graph; // "full" | "mini"
    const canvas = root.querySelector(".graph-canvas");
    const status = root.querySelector(".graph-status");
    const say = (msg) => status && (status.textContent = msg);
    let json;
    try {
      [, json] = await Promise.all([loadLibs(), loadData()]);
    } catch (err) {
      say(`The graph could not be loaded (${err.message}). The table of relationships below lists the same data.`);
      return;
    }
    const Sigma = window.Sigma;
    const mini = mode === "mini";
    const focus = root.dataset.focus || (mode === "full" ? new URLSearchParams(location.search).get("focus") : null);

    let keep = null;
    if (mini) {
      const nb = new Set([focus]);
      for (const e of json.edges) {
        if (e.source === focus) nb.add(e.target);
        if (e.target === focus) nb.add(e.source);
      }
      keep = nb;
    }
    const g = buildGraphology(graphology, json, keep);
    if (!g.order || (mini && g.order < 2)) return say("No relationships recorded yet.");
    layout(g, { ringLeaves: !mini });

    let t = theme();
    const state = {
      hiddenTypes: new Set(),
      hiddenGroups: new Set(),
      showLeaves: mini,
      hovered: null,
      selected: null,
    };
    const near = (id) => {
      const s = new Set([id]);
      g.forEachNeighbor(id, (n) => s.add(n));
      return s;
    };
    const active = () => state.hovered || state.selected;
    let neighbourhood = null;
    const recompute = () => (neighbourhood = active() ? near(active()) : null);

    const nodeHidden = (id, a) => {
      if (state.hiddenTypes.has(a.kind)) return true;
      if (!state.showLeaves && isLeafType(a.kind) && a.degree < 2 && !(state.selected && neighbourhood?.has(id))) return true;
      return false;
    };
    let renderer;
    try {
      renderer = new Sigma(g, canvas, {
        nodeProgramClasses: shapePrograms(Sigma),
        edgeProgramClasses: { line: Sigma.rendering.EdgeRectangleProgram, arrow: Sigma.rendering.EdgeArrowProgram },
        defaultDrawNodeHover: drawHover(() => t),
        labelFont: "Inter, ui-sans-serif, system-ui, sans-serif",
        labelSize: 12,
        labelWeight: "500",
        labelColor: { color: t.text },
        labelDensity: mini ? 3 : 0.9,
        labelGridCellSize: 70,
        labelRenderedSizeThreshold: mini ? 0 : 6,
        zIndex: true,
        enableCameraRotation: false,
        enableCameraZooming: !mini,
        minCameraRatio: 0.08,
        maxCameraRatio: 3,
        stagePadding: 24,
        nodeReducer: (id, a) => {
          const out = { ...a, color: t.node(a.kind) };
          if (nodeHidden(id, a)) return { ...out, hidden: true };
          if (neighbourhood && !neighbourhood.has(id)) return { ...out, color: t.dim, label: "", size: a.size * 0.6, zIndex: 0 };
          if (neighbourhood) return { ...out, zIndex: 2, forceLabel: true, highlighted: id === active() };
          if (mini) return { ...out, zIndex: id === focus ? 2 : 1, forceLabel: true, highlighted: id === focus };
          return { ...out, zIndex: isLeafType(a.kind) ? 0 : 1 };
        },
        edgeReducer: (id, a) => {
          const [s, tg] = g.extremities(id);
          const strong = a.group === "curated";
          const out = { ...a, color: strong ? t.edgeStrong : t.edge, size: strong ? 1.6 : a.group === "adopts" ? 0.7 : 1 };
          if (state.hiddenGroups.has(a.group) || nodeHidden(s, g.getNodeAttributes(s)) || nodeHidden(tg, g.getNodeAttributes(tg))) return { ...out, hidden: true };
          const x = active();
          if (x) return s === x || tg === x ? { ...out, color: t.highlight, size: out.size + 1, zIndex: 1 } : { ...out, hidden: true };
          return out;
        },
      });
    } catch (err) {
      say("Your browser can't draw the graph (WebGL is unavailable). The table of relationships below lists the same data.");
      return;
    }
    say("");
    root.classList.add("is-ready");
    const refresh = () => {
      recompute();
      renderer.refresh();
    };
    // Follow the theme toggle and the OS setting.
    const retheme = () => {
      t = theme();
      renderer.setSetting("labelColor", { color: t.text });
      refresh();
    };
    new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", retheme);

    renderer.on("enterNode", ({ node }) => {
      state.hovered = node;
      canvas.style.cursor = "pointer";
      refresh();
    });
    renderer.on("leaveNode", () => {
      state.hovered = null;
      canvas.style.cursor = "";
      refresh();
    });

    if (mini) {
      renderer.on("clickNode", ({ node }) => {
        const a = g.getNodeAttributes(node);
        if (!isLeafType(a.kind) && node !== focus) location.href = a.url;
      });
      return;
    }

    // ---- full explorer ----
    const info = root.querySelector(".graph-info");
    const intro = info?.innerHTML || "";
    const camera = renderer.getCamera();
    // Frame a node and its neighbours (camera coordinates are the normalised "framed graph" space).
    const centre = (id) => {
      const pts = [...near(id)].map((n) => renderer.getNodeDisplayData(n)).filter(Boolean);
      if (!pts.length) return;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const ratio = Math.min(1.1, Math.max(0.15, Math.max(x1 - x0, y1 - y0) * 1.4));
      camera.animate({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, ratio }, { duration: 450 });
    };
    function show(id) {
      if (!info) return;
      if (!id) {
        info.innerHTML = intro;
        return;
      }
      const a = g.getNodeAttributes(id);
      const rel = relationsOf(g, id);
      const typeLabel = json.nodeTypes[a.kind] || a.kind;
      const link = isLeafType(a.kind)
        ? `<a class="btn-ghost" href="${esc(a.url)}" rel="noopener">${a.kind === "project" ? "Project website" : "Bioregistry record"} ↗</a>`
        : `<a class="btn-ghost" href="${esc(a.url)}">Open ${esc(a.label)} →</a>`;
      info.innerHTML = `
        <p class="gi-kind"><span class="g-swatch" data-shape="${esc(SHAPE[a.kind] || "circle")}" style="--c: var(--g-${esc(a.kind)})" aria-hidden="true"></span>${esc(typeLabel)}${a.categoryName ? ` · ${esc(a.categoryName)}` : ""}</p>
        <h3>${esc(a.label)}</h3>
        ${a.name && a.name !== a.label ? `<p class="gi-name">${esc(a.name)}</p>` : ""}
        ${a.grade ? `<p class="small"><span class="grade grade-${esc(a.grade)} sm" title="Evaluation score ${esc(a.score)}/100"><b>${esc(a.grade)}</b><small>${esc(a.score)}</small></span>${a.legacy ? " · legacy" : ""}</p>` : ""}
        ${a.description ? `<p class="small muted">${esc(a.description.length > 260 ? a.description.slice(0, 257) + "…" : a.description)}</p>` : ""}
        <p>${link} <button type="button" class="btn-ghost" data-clear>Clear</button></p>
        ${
          rel.length
            ? rel
                .map(
                  ([phrase, items]) => `<div class="gi-group"><h4>${esc(phrase)} <span class="count">${items.length}</span></h4><p>${items
                    .sort((x, y) => g.getNodeAttribute(x.other, "label").localeCompare(g.getNodeAttribute(y.other, "label")))
                    .map(({ other, edge }) => `<button type="button" class="chip chip-link chip-node" data-node="${esc(other)}" title="${esc(evidenceText(edge))}"><span class="g-swatch" data-shape="${esc(SHAPE[g.getNodeAttribute(other, "kind")] || "circle")}" style="--c: var(--g-${esc(g.getNodeAttribute(other, "kind"))})" aria-hidden="true"></span>${esc(g.getNodeAttribute(other, "label"))}</button>`)
                    .join(" ")}</p></div>`
                )
                .join("")
            : `<p class="small muted">No relationships recorded yet.</p>`
        }`;
    }
    const input = root.querySelector(".graph-search input");
    let searched = ""; // last query acted on; blurring the box fires "change" again
    const select = (id, { move = false, query = "" } = {}) => {
      state.selected = id && g.hasNode(id) ? id : null;
      if (input && !query) input.value = "";
      searched = query;
      show(state.selected);
      refresh();
      if (state.selected && move) centre(state.selected);
      const p = new URLSearchParams(location.search);
      if (state.selected) p.set("focus", state.selected);
      else p.delete("focus");
      const qs = p.toString();
      history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    };
    renderer.on("clickNode", ({ node }) => select(state.selected === node ? null : node));
    renderer.on("doubleClickNode", ({ node, preventSigmaDefault }) => {
      preventSigmaDefault();
      const a = g.getNodeAttributes(node);
      if (!isLeafType(a.kind)) location.href = a.url;
    });
    renderer.on("clickStage", () => select(null));
    info?.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-node]");
      if (b) select(b.dataset.node, { move: true });
      if (ev.target.closest("[data-clear]")) select(null);
    });

    // Legend / filters
    for (const box of root.querySelectorAll("[data-node-type]"))
      box.addEventListener("change", () => {
        box.checked ? state.hiddenTypes.delete(box.dataset.nodeType) : state.hiddenTypes.add(box.dataset.nodeType);
        refresh();
      });
    for (const box of root.querySelectorAll("[data-edge-group]"))
      box.addEventListener("change", () => {
        box.checked ? state.hiddenGroups.delete(box.dataset.edgeGroup) : state.hiddenGroups.add(box.dataset.edgeGroup);
        refresh();
      });
    const leaves = root.querySelector("[data-leaves]");
    leaves?.addEventListener("change", () => {
      state.showLeaves = leaves.checked;
      refresh();
    });

    // Search: a datalist of every node, matched on acronym or name.
    const list = root.querySelector(".graph-search datalist");
    if (input && list) {
      const opts = [];
      g.forEachNode((id, a) => opts.push([`${a.label}${a.name && a.name !== a.label && !isLeafType(a.kind) ? ` — ${a.name}` : ""}`, id]));
      opts.sort((x, y) => x[0].localeCompare(y[0]));
      list.innerHTML = opts.map(([label]) => `<option value="${esc(label)}"></option>`).join("");
      const find = (q) => {
        q = q.trim().toLowerCase();
        if (!q) return null;
        const exact = opts.find(([l]) => l.toLowerCase() === q) || opts.find(([l]) => l.toLowerCase().split(" — ")[0] === q);
        return (exact || opts.find(([l]) => l.toLowerCase().includes(q)))?.[1] || null;
      };
      const go = () => {
        if (input.value === searched) return;
        const id = find(input.value);
        if (!id) return;
        const box = root.querySelector(`[data-node-type="${CSS.escape(g.getNodeAttribute(id, "kind"))}"]`);
        if (box && !box.checked) box.click();
        select(id, { move: true, query: input.value });
      };
      input.addEventListener("change", go);
      input.addEventListener("keydown", (ev) => ev.key === "Enter" && (ev.preventDefault(), go()));
    }
    root.querySelector("[data-zoom=in]")?.addEventListener("click", () => camera.animatedZoom({ duration: 250 }));
    root.querySelector("[data-zoom=out]")?.addEventListener("click", () => camera.animatedUnzoom({ duration: 250 }));
    root.querySelector("[data-zoom=reset]")?.addEventListener("click", () => camera.animatedReset({ duration: 300 }));

    if (focus && g.hasNode(focus)) setTimeout(() => select(focus, { move: true }), 50);
    else refresh();
  }

  // Start each graph when it comes into view (entry pages put it below the fold).
  const start = (root) => init(root).catch((err) => console.error("graph:", err));
  if (!("IntersectionObserver" in window)) return roots.forEach(start);
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((x) => {
        if (!x.isIntersecting) return;
        io.unobserve(x.target);
        start(x.target);
      }),
    { rootMargin: "200px" }
  );
  roots.forEach((r) => io.observe(r));
})();
