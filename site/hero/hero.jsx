// The overview page's hero figure: how Documentation Robotics sits on a codebase, drawn as a
// layered graph with heimdall-ui's GraphCanvas. It mounts in a shadow root so heimdall's
// stylesheet and the page's own CSS can't affect each other.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { GraphCanvas, GraphNode } from "@tinkermonkey/heimdall-ui";
import heimdallCss from "@tinkermonkey/heimdall-ui/css";

// ---------------------------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------------------------

// What each band and part is. Positions come from the layouts below.
const BANDS = [
  { id: "band-clients", layer: 2, title: "Clients", note: "how you and your agent work" },
  { id: "band-dr", layer: 5, title: "Documentation Robotics", short: "DR", note: "the spec and your model" },
  { id: "band-cbm", layer: 3, title: "Code graph", note: "codebase-memory-mcp" },
  { id: "band-code", layer: 12, title: "Your codebase", note: "the system being modeled" },
  { id: "band-models", layer: 1, title: "Models", note: "judgment, beside the stack" }
];

const PARTS = [
  { id: "viewer", label: "dr visualize", kind: "UI", color: "climate",
    about: "The viewer: the model as a graph, changesets drawn on it, and comment threads that reach Claude as you write them." },
  { id: "cli", label: "dr", kind: "CLI", color: "climate",
    about: "The command line: create, validate, migrate and export models, and manage changesets by hand." },
  { id: "mcp", label: "dr mcp", kind: "MCP", color: "climate",
    about: "The MCP server: 42 tools that give an agent every step, from project_status to a changeset you confirm." },
  { id: "model", label: "DR model", kind: "data", color: "software",
    about: "Your system as typed elements and relationships, kept in documentation-robotics/ next to the code, with each planned change staged as a changeset." },
  { id: "dr", label: "dr core", kind: "core", color: "software",
    about: "Model operations, changesets, validation, extraction and verification. Every client runs the same core." },
  { id: "spec", label: "DR spec", kind: "spec", color: "software",
    about: "13 layers, 193 node types and 987 relationship types. It defines what the model can say, and the brief checks plans against it." },
  { id: "cbm", label: "codebase-memory-mcp", kind: "CBM", color: "default",
    about: "Parses the code into a graph of files, classes, functions and routes, plus docs and infrastructure, joined by calls, imports, HTTP calls and tests. DR reads that graph and projects it onto its layers." },
  { id: "source", label: "source & tests", kind: "src", color: "default",
    about: "The repository being modeled. Each extracted element keeps a reference to the file and symbol it came from." },
  { id: "git", label: "git history", kind: "git", color: "default",
    about: "What changed since the model last did. Drift checks and branch verification read it." },
  { id: "claude", label: "Claude", kind: "LLM", color: "life",
    about: "Claude Code in your terminal, or DrBot in the viewer. It plans and builds through dr mcp, and decides what extraction's rules can't." },
  { id: "decision", label: "Decision model", kind: "DM", color: "life",
    about: "Calibrated answers for the extraction cases the rules can't settle, so fewer go to Claude. Measured, not wired in yet." }
];

const EDGES = [
  { id: "e-viewer-model", sourceId: "viewer", targetId: "model", label: "shows" },
  { id: "e-cli-dr", sourceId: "cli", targetId: "dr", label: "runs" },
  { id: "e-mcp-dr", sourceId: "mcp", targetId: "dr", label: "runs" },
  { id: "e-claude-mcp", sourceId: "claude", targetId: "mcp", label: "calls tools", variant: "hot" },
  { id: "e-dr-model", sourceId: "dr", targetId: "model", label: "stages" },
  { id: "e-dr-spec", sourceId: "dr", targetId: "spec", label: "checks" },
  { id: "e-dr-cbm", sourceId: "dr", targetId: "cbm", label: "reads graph" },
  { id: "e-dr-decision", sourceId: "dr", targetId: "decision", label: "asks", strokeDash: 4 },
  { id: "e-cbm-source", sourceId: "cbm", targetId: "source", label: "indexes" },
  { id: "e-model-source", sourceId: "model", targetId: "source", label: "points back to" },
  { id: "e-dr-git", sourceId: "dr", targetId: "git", label: "reads changes" }
];

// Positions are node centres. Bands are drawn as large, non-interactive nodes behind the parts.
// Wide: four stacked bands with the models column on the right. Narrow (phones): the models
// band sits above the stack and the parts are packed closer.
const LAYOUTS = {
  wide: {
    bands: {
      "band-clients": [400, 62, 840, 124],
      "band-dr": [400, 212, 840, 124],
      "band-cbm": [400, 362, 840, 124],
      "band-code": [400, 512, 840, 124],
      "band-models": [960, 212, 200, 424]
    },
    parts: {
      viewer: [150, 74], cli: [400, 74], mcp: [650, 74],
      model: [150, 224], dr: [400, 224], spec: [650, 224],
      cbm: [400, 374],
      source: [150, 524], git: [650, 524],
      claude: [960, 74], decision: [960, 374]
    }
  },
  narrow: {
    bands: {
      "band-models": [170, 50, 340, 96],
      "band-clients": [170, 166, 340, 96],
      "band-dr": [170, 282, 340, 96],
      "band-cbm": [170, 398, 340, 96],
      "band-code": [170, 514, 340, 96]
    },
    parts: {
      decision: [86, 62], claude: [270, 62],
      viewer: [66, 178], cli: [176, 178], mcp: [282, 178],
      model: [62, 294], dr: [174, 294], spec: [284, 294],
      cbm: [170, 410],
      source: [80, 526], git: [262, 526]
    }
  }
};

function graphFor(name) {
  const layout = LAYOUTS[name];
  const bands = BANDS.map((b) => {
    const [x, y, w, h] = layout.bands[b.id];
    return { ...b, x, y, w, h, narrow: name === "narrow" };
  });
  const nodes = [
    ...bands.map((b) => ({ id: b.id, label: b.title, x: b.x, y: b.y, attributes: { band: true } })),
    ...PARTS.map((p) => {
      const [x, y] = layout.parts[p.id];
      return { id: p.id, label: p.label, kind: p.kind, domainColor: p.color, x, y };
    })
  ];
  return { bands: Object.fromEntries(bands.map((b) => [b.id, b])), nodes };
}

const GRAPHS = { wide: graphFor("wide"), narrow: graphFor("narrow") };
const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));
const NARROW_QUERY = "(max-width: 640px)";

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const LOCAL_CSS = `
:host { display: block; }
.hero-graph { position: relative; height: var(--hero-height, 440px); }
.band {
  box-sizing: border-box; border-radius: 8px; padding: 8px 12px;
  border: 1px solid rgb(var(--band) / 0.35); background: rgb(var(--band) / 0.06);
  display: flex; gap: 8px; align-items: baseline;
}
.band b {
  font: 600 10.5px/1.2 var(--font-mono, monospace); letter-spacing: 0.1em; text-transform: uppercase;
  color: rgb(var(--band));
}
.band span { font: 400 11px/1.2 var(--font-mono, monospace); color: rgb(var(--canvas-fg-3)); }
.hero-tip { max-width: 260px; font: 400 12.5px/1.5 var(--font-sans, sans-serif); }
.hero-caption {
  display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap;
  padding: 10px 14px; border-top: 1px solid rgb(var(--canvas-border));
  background: rgb(var(--canvas-bg-2)); color: rgb(var(--canvas-fg-2));
  font: 400 13px/1.5 var(--font-sans, sans-serif);
}
.hero-caption b {
  font: 500 10.5px/1.5 var(--font-mono, monospace); letter-spacing: 0.1em; text-transform: uppercase;
  color: rgb(var(--canvas-fg-3)); flex: none;
}
.hero-caption span { flex: 1 1 260px; min-width: 0; }
@media (max-width: 640px) { .hero-graph { height: var(--hero-height-narrow, 560px); } }
`;

/** heimdall-ui's stylesheet, rescoped from the document to the shadow root. */
function scopeCss(css) {
  return css
    .replace(/body\.dark-canvas/g, ":host(.dark-canvas)")
    .replace(/:root/g, ":host")
    .replace(/(^|[{},])(\s*)(html|body)(?=\s*[{,])/g, "$1$2:host");
}

function Band({ band }) {
  return (
    <div className="band" style={{ width: band.w, height: band.h, "--band": `var(--graph-layer-${band.layer})` }} aria-hidden="true">
      <b>{band.narrow ? band.short ?? band.title : band.title}</b>
      {!band.narrow && <span>{band.note}</span>}
    </div>
  );
}

function useLayoutName() {
  const [name, setName] = useState(() => (window.matchMedia(NARROW_QUERY).matches ? "narrow" : "wide"));
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setName(query.matches ? "narrow" : "wide");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return name;
}

function Hero() {
  const [selected, setSelected] = useState();
  const layoutName = useLayoutName();
  const graph = GRAPHS[layoutName];
  const edges = useMemo(() => EDGES, []);

  const renderNode = useCallback((node, isSelected, hierarchy, props) => {
    const band = graph.bands[node.id];
    if (band) return <Band band={band} />;
    return (
      <GraphNode
        id={node.id}
        label={node.label}
        kind={node.kind}
        domainColor={node.domainColor}
        selected={isSelected}
        onSelect={props?.onSelect}
        tooltipId={props?.tooltipId}
      />
    );
  }, [graph]);

  const nodeTooltip = useCallback((node) => {
    const part = PART_BY_ID[node.id];
    return part ? <div className="hero-tip">{part.about}</div> : null;
  }, []);

  const part = selected ? PART_BY_ID[selected] : undefined;
  return (
    <>
      <div className="hero-graph">
        <GraphCanvas
          key={layoutName}
          nodes={graph.nodes}
          edges={edges}
          layout="manual"
          renderNode={renderNode}
          nodeTooltip={nodeTooltip}
          tooltipDelay={250}
          selectedNodeId={selected}
          onNodeSelect={(id) => setSelected((cur) => (cur === id || !PART_BY_ID[id] ? undefined : id))}
          onBackgroundClick={() => setSelected(undefined)}
          draggable={false}
          fitView
          fitPadding={20}
          showLayoutIndicator={false}
          showToolbar={layoutName === "wide"}
          aria-label="How Documentation Robotics works with a codebase"
        />
      </div>
      <div className="hero-caption" aria-live="polite">
        <b>{part ? part.label : "Explore"}</b>
        <span>{part ? part.about : "Select a part to see what it does. Drag to pan."}</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------------------------

function pageIsDark() {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function mount(host) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = scopeCss(heimdallCss) + LOCAL_CSS;
  shadow.appendChild(style);
  const root = document.createElement("div");
  shadow.appendChild(root);

  const syncTheme = () => host.classList.toggle("dark-canvas", pageIsDark());
  syncTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Let the wheel scroll the page instead of zooming the figure; the toolbar zooms.
  // Registered before React attaches its own root listeners, so stopImmediatePropagation wins.
  root.addEventListener("wheel", (e) => e.stopImmediatePropagation(), { capture: true });

  createRoot(root).render(<Hero />);
}

const host = document.getElementById("dr-stack");
if (host) mount(host);
