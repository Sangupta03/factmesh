// FactMesh — React UI (loaded via CDN + in-browser Babel, no npm/build step:
// this file is JSX transformed on page load, so the whole app still runs
// with just "uvicorn ..." and a browser refresh — no node toolchain needed).
//
// App shell: a collapsible sidebar for navigation + a full-width content
// area per "page" (Overview / Documents / Facts / Relationships / Issues).
// Facts and Relationships are server-paginated — with a real knowledge base
// running into the thousands of facts, shipping (and rendering) all of them
// in one flat scrolling list stops being usable fast.

const { useState, useEffect, useCallback, useRef } = React;
const API = "/api";
const PAGE_SIZE = 25;

// ------------------------------------------------------------------- icons
// Iconify's web component - a clean, consistent icon set (Lucide) pulled in
// with a single script tag, no icon-font build step.

function Icon({ name, className = "", size = 18 }) {
  return <iconify-icon icon={name} width={size} height={size} className={className}></iconify-icon>;
}

// -------------------------------------------------------------------- api

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
function fmt(n) { return (n ?? 0).toLocaleString(); }

// ----------------------------------------------------------------- sidebar

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: "lucide:layout-dashboard", color: "text-blue-600", activeBg: "bg-blue-50" },
  { key: "documents", label: "Documents", icon: "lucide:folder-open", color: "text-teal-600", activeBg: "bg-teal-50", countKey: "documents" },
  { key: "facts", label: "Facts", icon: "lucide:file-text", color: "text-violet-600", activeBg: "bg-violet-50", countKey: "facts" },
  { key: "relationships", label: "Relationships", icon: "lucide:git-compare", color: "text-fuchsia-600", activeBg: "bg-fuchsia-50", countKey: "relationships" },
  { key: "issues", label: "Extraction Issues", icon: "lucide:triangle-alert", color: "text-amber-600", activeBg: "bg-amber-50", countKey: "issues" },
];

function Sidebar({ page, onNavigate, collapsed, onToggle, counts, onHelp }) {
  return (
    <aside className={`shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-slate-200 transition-all duration-200 ${collapsed ? "w-[72px]" : "w-64"}`}>
      <div className={`flex items-center gap-3 h-16 px-4 border-b border-slate-100 ${collapsed ? "justify-center" : ""}`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-cyan-500 to-teal-500 flex items-center justify-center text-white shadow-md shadow-blue-500/30 shrink-0">
          <Icon name="lucide:waypoints" size={19} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-extrabold text-slate-900 text-[15px] leading-tight">FactMesh</div>
            <div className="text-[10.5px] text-slate-400 font-semibold leading-tight">Fact knowledge layer</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key;
          const count = item.countKey ? counts[item.countKey] : null;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              title={collapsed ? item.label : ""}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-bold transition-colors ${
                active ? `${item.activeBg} ${item.color}` : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon name={item.icon} size={19} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
              {!collapsed && count > 0 && (
                <span className={`text-[10.5px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${active ? "bg-white/70" : "bg-slate-100 text-slate-400"}`}>
                  {fmt(count)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-slate-100 space-y-1">
        <button
          onClick={onHelp}
          title={collapsed ? "How this works" : ""}
          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          <Icon name="lucide:circle-help" size={18} className="shrink-0" />
          {!collapsed && <span>How this works</span>}
        </button>
        <button
          onClick={onToggle}
          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          <Icon name={collapsed ? "lucide:panel-left-open" : "lucide:panel-left-close"} size={18} className="shrink-0" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ topbar

const PAGE_META = {
  overview: { title: "Overview", desc: "Everything the knowledge base has found so far, at a glance." },
  documents: { title: "Documents", desc: "Upload PDFs and track extraction progress." },
  facts: { title: "Facts", desc: "Every fact extracted, pinned to its exact source page and quote." },
  relationships: { title: "Relationships", desc: "How facts across documents corroborate, contradict, or are explained by context." },
  issues: { title: "Extraction Issues", desc: "Facts or passages the model itself wasn't confident about." },
};

function TopBar({ page, onUploadClick }) {
  const meta = PAGE_META[page];
  return (
    <div className="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-slate-200">
      <div className="flex items-center justify-between gap-4 px-6 md:px-8 h-16">
        <div className="min-w-0">
          <h1 className="text-[17px] font-extrabold text-slate-900 leading-tight truncate">{meta.title}</h1>
          <p className="text-[12px] text-slate-500 font-medium truncate hidden sm:block">{meta.desc}</p>
        </div>
        <button
          onClick={onUploadClick}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white font-bold text-[13px] px-4 py-2.5 shadow-md shadow-blue-500/25 shrink-0 transition-colors"
        >
          <Icon name="lucide:upload-cloud" size={16} /> Upload PDF
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- intro panel

function IntroPanel({ onClose }) {
  const steps = [
    { n: 1, grad: "from-blue-500 to-blue-600", icon: "lucide:upload-cloud", title: "Upload a PDF", desc: "Drop it in. Any report, filing, or document with checkable facts and numbers works." },
    { n: 2, grad: "from-cyan-500 to-cyan-600", icon: "lucide:scan-text", title: "We extract facts, with proof", desc: "Every fact is pinned to the exact page and sentence it came from — nothing is taken on faith." },
    { n: 3, grad: "from-teal-500 to-teal-600", icon: "lucide:git-compare", title: "See what agrees, disagrees, or is explained", desc: "Upload a second document and facts are compared automatically — no manual cross-checking." },
  ];
  return (
    <section className="relative rounded-3xl border border-blue-100 bg-gradient-to-b from-blue-50 via-white to-white p-7 mb-6 animate-fade-in">
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/70 hover:bg-white text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors">
        <Icon name="lucide:x" size={15} />
      </button>
      <h2 className="text-lg font-extrabold text-slate-900 mb-5 max-w-xl">Turn PDFs into a fact knowledge base — in three steps</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-3">
            <div className={`shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br ${s.grad} text-white flex items-center justify-center shadow-md`}>
              <Icon name={s.icon} size={17} />
            </div>
            <div>
              <strong className="block text-[13.5px] font-bold text-slate-800 mb-0.5">{s.title}</strong>
              <p className="text-[12.5px] text-slate-500 leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------- upload zone

function UploadZone({ onFiles }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  return (
    <section
      id="upload-zone"
      onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
      className={`flex items-center gap-5 rounded-3xl border-2 border-dashed p-7 mb-6 transition-colors flex-wrap sm:flex-nowrap ${
        dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
      } shadow-soft`}
    >
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-teal-100 text-blue-600 flex items-center justify-center shrink-0">
        <Icon name="lucide:upload-cloud" size={26} />
      </div>
      <div className="flex-1 min-w-[200px]">
        <strong className="block text-[15px] font-bold text-slate-800">Drop a PDF here to add it to the knowledge base</strong>
        <p className="text-[13px] text-slate-500 mt-1">Or click the button to browse your files. Processing runs automatically — no setup needed.</p>
      </div>
      <button
        onClick={() => inputRef.current.click()}
        className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white font-bold text-sm px-6 py-3 shadow-lg shadow-blue-500/30 transition-colors whitespace-nowrap"
      >
        Choose PDF
      </button>
      <input ref={inputRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </section>
  );
}

// -------------------------------------------------------------- documents

const STAGES = ["extracting", "embedding", "linking", "done"];
const DOC_ACCENTS = [
  { bar: "from-blue-500 to-blue-400", chip: "bg-blue-100 text-blue-600" },
  { bar: "from-fuchsia-500 to-fuchsia-400", chip: "bg-fuchsia-100 text-fuchsia-600" },
  { bar: "from-sky-500 to-sky-400", chip: "bg-sky-100 text-sky-600" },
  { bar: "from-amber-500 to-amber-400", chip: "bg-amber-100 text-amber-600" },
  { bar: "from-emerald-500 to-emerald-400", chip: "bg-emerald-100 text-emerald-600" },
  { bar: "from-rose-500 to-rose-400", chip: "bg-rose-100 text-rose-600" },
];

function DocumentCard({ doc, index, onDelete }) {
  const accent = DOC_ACCENTS[index % DOC_ACCENTS.length];
  const isError = doc.status === "error";
  const filled = Math.max(0, STAGES.indexOf(doc.status) + 1);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-soft overflow-hidden animate-fade-in">
      <div className={`h-1.5 bg-gradient-to-r ${isError ? "from-rose-500 to-rose-400" : accent.bar}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={`shrink-0 w-8 h-8 rounded-lg ${accent.chip} flex items-center justify-center`}>
              <Icon name="lucide:file-text" size={16} />
            </div>
            <span className="font-bold text-[13px] leading-snug text-slate-800 line-clamp-2" title={doc.filename}>
              {doc.title || doc.filename}
            </span>
          </div>
          <button onClick={() => onDelete(doc.id)} title="Remove document" className="shrink-0 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg p-1.5 transition-colors">
            <Icon name="lucide:trash-2" size={15} />
          </button>
        </div>

        {isError ? (
          <div>
            <div className="flex gap-1">{STAGES.map((_, i) => <div key={i} className="flex-1 h-1.5 rounded-full bg-rose-400" />)}</div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-rose-600">
              <Icon name="lucide:triangle-alert" size={13} className="shrink-0" />
              <span className="line-clamp-1">Failed — {(doc.status_detail || "unknown error").slice(0, 70)}</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex gap-1">
              {STAGES.map((_, i) => (
                <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i < filled ? `bg-gradient-to-r ${accent.bar}` : "bg-slate-100"}`} />
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-slate-500">
              {doc.status === "done" ? (
                <>
                  <Icon name="lucide:circle-check-big" size={13} className="text-emerald-500 shrink-0" />
                  <span className="text-emerald-600">Done — {fmt(doc.fact_count)} facts extracted</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse-soft shrink-0" />
                  <span className="line-clamp-1">{doc.status_detail || "Starting…"}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- stats

const STAT_DEFS = [
  { key: "documents", label: "Documents", icon: "lucide:folder-open", iconWrap: "bg-sky-100 text-sky-600", num: "text-sky-600", goto: "documents" },
  { key: "facts", label: "Facts extracted", icon: "lucide:sparkles", iconWrap: "bg-violet-100 text-violet-600", num: "text-violet-600", goto: "facts" },
  { key: "corroborates", label: "Corroborated", icon: "lucide:circle-check-big", iconWrap: "bg-emerald-100 text-emerald-600", num: "text-emerald-600", goto: "relationships", relFilter: "corroborates" },
  { key: "contradicts", label: "Contradictions", icon: "lucide:zap", iconWrap: "bg-rose-100 text-rose-600", num: "text-rose-600", goto: "relationships", relFilter: "contradicts" },
  { key: "contextual", label: "Context-explained", icon: "lucide:shuffle", iconWrap: "bg-amber-100 text-amber-600", num: "text-amber-600", goto: "relationships", relFilter: "contextual" },
];

function StatsGrid({ stats, onNavigate }) {
  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-7">
      {STAT_DEFS.map((def) => (
        <button
          key={def.key}
          onClick={() => onNavigate(def.goto, def.relFilter)}
          className="text-left rounded-2xl bg-white border border-slate-200 shadow-soft p-4 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
        >
          <div className={`w-8 h-8 rounded-lg ${def.iconWrap} flex items-center justify-center mb-3`}>
            <Icon name={def.icon} size={16} />
          </div>
          <div className={`text-2xl font-extrabold tracking-tight ${def.num}`}>{fmt(stats[def.key])}</div>
          <div className="text-[11.5px] font-semibold text-slate-500 mt-1">{def.label}</div>
        </button>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- pagination

function Pagination({ page, pageSize, total, onPage }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 mt-5 flex-wrap">
      <div className="text-[12.5px] text-slate-500 font-semibold">
        Showing <span className="text-slate-800">{fmt(from)}–{fmt(to)}</span> of <span className="text-slate-800">{fmt(total)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-bold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-slate-50"
        >
          <Icon name="lucide:chevron-left" size={14} /> Prev
        </button>
        <span className="text-[12.5px] font-bold text-slate-500 px-2">Page {page + 1} of {pageCount}</span>
        <button
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-bold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-slate-50"
        >
          Next <Icon name="lucide:chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- empty state

function EmptyState({ icon, iconColor = "text-blue-500", iconBg = "bg-blue-50", title, desc, action }) {
  return (
    <div className="text-center rounded-3xl border-2 border-dashed border-slate-200 bg-white py-16 px-6">
      <div className={`w-14 h-14 rounded-2xl ${iconBg} ${iconColor} flex items-center justify-center mx-auto mb-4`}>
        <Icon name={icon} size={26} />
      </div>
      <div className="text-[15px] font-bold text-slate-800 mb-1.5">{title}</div>
      <div className="text-[13px] text-slate-500 max-w-md mx-auto leading-relaxed">{desc}</div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- legend

const REL_META = {
  corroborates: { label: "Corroborates", desc: "Same fact, both documents agree.", icon: "lucide:circle-check-big", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", borderL: "border-l-emerald-400", badgeBg: "bg-emerald-100", badgeText: "text-emerald-700" },
  contradicts: { label: "Contradicts", desc: "Same fact, genuinely different values.", icon: "lucide:zap", dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", borderL: "border-l-rose-400", badgeBg: "bg-rose-100", badgeText: "text-rose-700" },
  contextual: { label: "Context-explained", desc: "Looked contradictory — time/scope explains it.", icon: "lucide:shuffle", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", borderL: "border-l-amber-400", badgeBg: "bg-amber-100", badgeText: "text-amber-700" },
};

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl bg-white border border-slate-200 shadow-softer px-5 py-3.5 mb-4">
      {Object.entries(REL_META).map(([key, m]) => (
        <div key={key} className="flex items-center gap-2 text-[12.5px] text-slate-500">
          <span className={`w-2.5 h-2.5 rounded-full ${m.dot} shrink-0`} />
          <span className={`font-bold ${m.text}`}>{m.label}</span> — {m.desc}
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------- facts

// A row's scope pill and document badge get a color picked deterministically
// from the text itself (same scope string -> same color, every time), so a
// table of a thousand rows reads as genuinely varied instead of one repeated
// teal pill down the entire page - the color becomes a scannable signal for
// "which category" rather than pure decoration.
const PILL_PALETTE = [
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-blue-100", text: "text-blue-700" },
];
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PILL_PALETTE[h % PILL_PALETTE.length];
}

function FactRow({ fact, docTitle, docAccent, expanded, onToggle }) {
  const lowConf = fact.confidence != null && fact.confidence < 0.6;
  const scopeColor = fact.scope ? hashColor(fact.scope) : null;
  return (
    <div className="border-b border-slate-100 last:border-0 even:bg-slate-50/60">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50/60 transition-colors">
        <Icon name={expanded ? "lucide:chevron-down" : "lucide:chevron-right"} size={15} className="text-slate-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 truncate">{fact.entity} · {fact.attribute}</div>
        </div>
        <div className="text-[14px] font-extrabold text-slate-900 shrink-0 whitespace-nowrap">
          {fact.value_raw}
          {fact.unit && <span className="text-[11.5px] font-semibold text-slate-400 ml-1">{fact.unit}</span>}
        </div>
        {scopeColor && <span className={`hidden md:inline-block shrink-0 text-[10.5px] font-bold rounded-full px-2.5 py-1 ${scopeColor.bg} ${scopeColor.text} whitespace-nowrap`}>{fact.scope}</span>}
        <div className={`hidden sm:flex items-center gap-1.5 text-[11px] font-bold shrink-0 w-40 justify-end rounded-full px-2.5 py-1 ${docAccent.chip}`}>
          <Icon name="lucide:file-text" size={12} className="shrink-0" />
          <span className="truncate">{docTitle}, p.{fact.page_number ?? "?"}</span>
        </div>
        {lowConf && <Icon name="lucide:triangle-alert" size={14} className="text-amber-500 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-11 pb-4 -mt-1 animate-fade-in">
          <div className="rounded-xl bg-slate-50 px-4 py-2.5 text-[13.5px] text-slate-600 leading-relaxed">“{fact.quote}”</div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] font-semibold text-slate-400">
            <span className="flex items-center gap-1.5 sm:hidden"><Icon name="lucide:file-text" size={13} /> {docTitle}, p.{fact.page_number ?? "?"}</span>
            {fact.as_of && <span className="flex items-center gap-1.5"><Icon name="lucide:calendar" size={13} /> {fact.as_of}</span>}
            {lowConf && (
              <span className="flex items-center gap-1.5 text-amber-600">
                <Icon name="lucide:triangle-alert" size={13} /> low-confidence extraction{fact.issue ? `: ${fact.issue}` : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FactsPage({ documents, addToast }) {
  const [query, setQuery] = useState("");
  const [docFilter, setDocFilter] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ items: [], total: 0 });
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q, docId, p) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: p * PAGE_SIZE });
      if (q) params.set("q", q);
      if (docId) params.set("document_id", docId);
      const res = await api("/facts?" + params.toString());
      setData(res);
    } catch (e) {
      addToast("Couldn't load facts", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { setPage(0); load(query, docFilter, 0); }, [query, docFilter]);
  useEffect(() => { load(query, docFilter, page); }, [page]);

  const docTitleById = (id) => documents.find((d) => d.id === id)?.title || "document";
  const docAccentById = (id) => {
    const idx = documents.findIndex((d) => d.id === id);
    return DOC_ACCENTS[(idx < 0 ? 0 : idx) % DOC_ACCENTS.length];
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
        <div className="relative flex-1">
          <Icon name="lucide:search" size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search facts by entity, attribute, value, or quote…"
            className="w-full rounded-xl border border-slate-200 bg-white shadow-softer pl-11 pr-4 py-3 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </div>
        <select
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white shadow-softer px-4 py-3 text-[13px] font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:w-64"
        >
          <option value="">All documents</option>
          {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </div>

      {data.items.length === 0 && !loading ? (
        query || docFilter
          ? <EmptyState icon="lucide:search-x" title="No matching facts" desc="Try a different search term or document filter." />
          : <EmptyState icon="lucide:file-text" title="No facts yet" desc="Upload a PDF and facts will show up here automatically, each one linked to its exact source page." />
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-soft overflow-hidden">
          {data.items.map((f) => (
            <FactRow key={f.id} fact={f} docTitle={docTitleById(f.document_id)} docAccent={docAccentById(f.document_id)} expanded={expandedId === f.id} onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)} />
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------- relationships

// The two sides of a comparison get distinct tints (blue vs. pink) so it's
// immediately obvious at a glance which quote belongs to which document,
// instead of two identical grey boxes that only differ in their text.
const SIDE_STYLE = {
  a: { bg: "bg-blue-50/60", border: "border-blue-100", source: "text-blue-600" },
  b: { bg: "bg-pink-50/60", border: "border-pink-100", source: "text-pink-600" },
};

function FactHalf({ r, side }) {
  const p = (k) => r[`${side}_${k}`];
  const s = SIDE_STYLE[side];
  return (
    <div className={`rounded-xl ${s.bg} border ${s.border} p-4`}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{p("entity")} · {p("attribute")}</div>
      <div className="text-[16px] font-extrabold text-slate-900 mt-1 mb-2">
        {p("value")}
        {p("unit") && <span className="text-[12px] font-semibold text-slate-400 ml-1">{p("unit")}</span>}
        {p("scope") && <span className="text-[12px] font-semibold text-slate-400 ml-1">({p("scope")})</span>}
      </div>
      <div className="text-[13px] text-slate-600 leading-relaxed">“{p("quote")}”</div>
      <div className={`flex items-center gap-1.5 text-[11.5px] font-bold ${s.source} mt-2.5`}>
        <Icon name="lucide:file-text" size={12} /> {p("doc_title")}, p.{p("page") ?? "?"}{p("as_of") ? ` · ${p("as_of")}` : ""}
      </div>
    </div>
  );
}

function RelationshipCard({ r }) {
  const m = REL_META[r.type] || REL_META.corroborates;
  const connector = r.type === "contradicts" ? "≠" : r.type === "contextual" ? "≈" : "=";
  return (
    <div className={`rounded-2xl bg-white border border-slate-200 border-l-4 ${m.borderL} shadow-soft p-5 mb-4 animate-fade-in`}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <span className={`flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide rounded-full px-3 py-1.5 ${m.badgeBg} ${m.badgeText}`}>
          <Icon name={m.icon} size={13} /> {m.label}
        </span>
        <span className="text-[11.5px] font-semibold text-slate-400">model confidence {r.confidence != null ? Math.round(r.confidence * 100) + "%" : "—"}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
        <FactHalf r={r} side="a" />
        <div className={`flex items-center justify-center text-xl font-extrabold ${m.text} md:rotate-0 rotate-90 py-1`}>{connector}</div>
        <FactHalf r={r} side="b" />
      </div>
      <div className={`mt-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed ${m.bg} ${m.text}`}>
        <b>Why: </b>{r.explanation}
      </div>
    </div>
  );
}

function RelationshipsPage({ initialFilter = "", addToast }) {
  const [filter, setFilter] = useState(initialFilter);
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (type, p) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: p * PAGE_SIZE });
      if (type) params.set("type", type);
      setData(await api("/relationships?" + params.toString()));
    } catch (e) {
      addToast("Couldn't load relationships", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { setPage(0); load(filter, 0); }, [filter]);
  useEffect(() => { load(filter, page); }, [page]);

  const chips = [{ key: "", label: "All", icon: "lucide:list" }, ...Object.entries(REL_META).map(([key, m]) => ({ key, label: m.label, icon: m.icon, dot: m.dot }))];

  return (
    <div>
      <Legend />
      <div className="flex flex-wrap gap-2 mb-4">
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key || "all"}
              onClick={() => setFilter(c.key)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-bold border transition-colors ${
                active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {c.dot && <span className={`w-2 h-2 rounded-full ${c.dot}`} />}
              {c.label}
            </button>
          );
        })}
      </div>

      {data.items.length === 0 && !loading ? (
        filter
          ? <EmptyState icon="lucide:git-compare" title="None of this type yet" desc={`Nothing has been classified as "${REL_META[filter]?.label}" so far — try "All" or upload another overlapping document.`} />
          : <EmptyState icon="lucide:git-compare" title="No relationships found yet" desc="Upload a second document that overlaps with the first — matching facts get compared automatically and show up here." />
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
          {data.items.map((r) => <RelationshipCard key={r.id} r={r} />)}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------- issues

function IssueCard({ issue }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 mb-3">
      <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 mb-2">
        <Icon name="lucide:triangle-alert" size={14} className="text-amber-500" />
        {issue.issue_type.replace(/_/g, " ")} · {issue.doc_title}, p.{issue.page_number ?? "?"}
      </div>
      <div className="text-[13.5px] text-slate-700 mb-2 leading-relaxed">{issue.description}</div>
      {issue.raw_text && <div className="text-[13.5px] text-slate-500 bg-white rounded-lg px-3.5 py-2.5">“{issue.raw_text}”</div>}
    </div>
  );
}

function IssuesPage({ addToast }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ items: [], total: 0 });

  const load = useCallback(async (p) => {
    try {
      setData(await api(`/issues?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`));
    } catch (e) {
      addToast("Couldn't load issues", "error");
    }
  }, [addToast]);

  useEffect(() => { load(page); }, [page]);

  return (
    <div>
      {data.items.length === 0 ? (
        <EmptyState
          icon="lucide:shield-check" iconColor="text-emerald-500" iconBg="bg-emerald-50"
          title="No extraction issues flagged"
          desc="This page surfaces facts or passages the model itself wasn't confident about — ambiguous units, unresolved references, garbled table values."
        />
      ) : (
        data.items.map((i) => <IssueCard key={i.id} issue={i} />)
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ overview

function OverviewPage({ stats, documents, onNavigate }) {
  const [highlights, setHighlights] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const contradicts = await api("/relationships?type=contradicts&limit=2");
        const contextual = await api("/relationships?type=contextual&limit=1");
        setHighlights([...contradicts.items, ...contextual.items]);
      } catch {}
    })();
  }, []);

  const working = documents.filter((d) => !["done", "error"].includes(d.status));

  return (
    <div>
      <StatsGrid stats={stats} onNavigate={onNavigate} />

      {working.length > 0 && (
        <section className="mb-7">
          <h2 className="text-[13px] font-extrabold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse-soft" /> Currently processing
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {working.map((d, i) => <DocumentCard key={d.id} doc={d} index={i} onDelete={() => {}} />)}
          </div>
        </section>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon="lucide:sparkles"
          title="Nothing here yet"
          desc="Upload your first PDF and this page will fill up with facts, corroborations, and contradictions automatically."
          action={
            <button onClick={() => onNavigate("documents")} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-[13px] px-5 py-2.5">
              <Icon name="lucide:upload-cloud" size={15} /> Go to Documents
            </button>
          }
        />
      ) : (
        <section>
          <h2 className="text-[13px] font-extrabold text-slate-700 mb-3">Notable findings</h2>
          {highlights.length === 0 ? (
            <div className="rounded-2xl bg-white border border-dashed border-slate-200 p-6 text-center text-[13px] text-slate-400 font-semibold">
              Nothing to reconcile yet — upload an overlapping document to see corroborations, contradictions, and context-explained cases here.
            </div>
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
              {highlights.map((r) => <RelationshipCard key={r.id} r={r} />)}
            </div>
          )}
          <button
            onClick={() => onNavigate("relationships")}
            className="flex items-center gap-1.5 text-[13px] font-bold text-blue-600 hover:text-blue-700 mt-1"
          >
            View all relationships <Icon name="lucide:arrow-right" size={14} />
          </button>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- documents

function DocumentsPage({ documents, onFiles, onDelete }) {
  return (
    <div>
      <UploadZone onFiles={onFiles} />
      {documents.length === 0 ? (
        <EmptyState icon="lucide:folder-open" title="No documents yet" desc="Upload a PDF above to start building your knowledge base." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {documents.map((d, i) => <DocumentCard key={d.id} doc={d} index={i} onDelete={onDelete} />)}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- toasts

function ToastStack({ toasts }) {
  const styles = { success: "bg-emerald-600", error: "bg-rose-600", info: "bg-slate-900" };
  const icons = { success: "lucide:circle-check", error: "lucide:circle-x", info: "lucide:info" };
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles[t.type] || styles.info} text-white rounded-xl px-4 py-3 text-[13px] font-semibold shadow-lg animate-toast-in flex items-center gap-2`}>
          <Icon name={icons[t.type] || icons.info} size={16} className="shrink-0" />
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------- app

function App() {
  const [page, setPage] = useState("overview");
  const [relFilterHint, setRelFilterHint] = useState(""); // consumed by RelationshipsPage via key remount
  const [collapsed, setCollapsed] = useState(localStorage.getItem("factmesh_sidebar_collapsed") === "1");
  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState({});
  const [showIntro, setShowIntro] = useState(localStorage.getItem("factmesh_intro_dismissed") !== "1");
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const refreshDocuments = useCallback(async () => setDocuments(await api("/documents")), []);
  const refreshStats = useCallback(async () => setStats(await api("/stats")), []);

  useEffect(() => {
    (async () => {
      try { await Promise.all([refreshDocuments(), refreshStats()]); }
      catch (e) { addToast("Couldn't reach the server. Is it running?", "error"); }
    })();
  }, []);

  useEffect(() => {
    const anyWorking = documents.some((d) => !["done", "error"].includes(d.status));
    if (!anyWorking) return;
    const timer = setTimeout(async () => { await refreshDocuments(); await refreshStats(); }, 2200);
    return () => clearTimeout(timer);
  }, [documents]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem("factmesh_sidebar_collapsed", c ? "0" : "1"); } catch {}
      return !c;
    });
  }, []);

  const uploadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length && fileList.length) addToast("Only PDF files are supported", "error");
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api("/documents", { method: "POST", body: form });
        addToast(`Processing "${file.name}"…`, "success");
      } catch (e) {
        addToast(`Failed to upload ${file.name}: ${e.message}`, "error");
      }
    }
    await refreshDocuments();
    await refreshStats();
  }, [addToast, refreshDocuments, refreshStats]);

  const deleteDocument = useCallback(async (id) => {
    if (!confirm("Remove this document and everything it contributed (facts + relationships)?")) return;
    await api(`/documents/${id}`, { method: "DELETE" });
    await refreshDocuments();
    await refreshStats();
    addToast("Document removed", "success");
  }, [addToast, refreshDocuments, refreshStats]);

  const handleNavigate = useCallback((target, relFilter) => {
    setPage(target);
    if (relFilter !== undefined) setRelFilterHint(relFilter + ":" + Math.random());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const counts = {
    documents: stats.documents || 0,
    facts: stats.facts || 0,
    relationships: (stats.corroborates || 0) + (stats.contradicts || 0) + (stats.contextual || 0),
    issues: stats.issues || 0,
  };

  return (
    <div className="flex min-h-screen bg-[#f7f7fc]">
      <Sidebar page={page} onNavigate={setPage} collapsed={collapsed} onToggle={toggleSidebar} counts={counts} onHelp={() => { setShowIntro(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} />

      <div className="flex-1 min-w-0 relative">
        {/* Ambient background wash - fixed, low-opacity, so scrolling past a
            plain white page doesn't feel flat. Sits behind everything, never
            intercepts clicks. */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
          <div className="absolute top-[-10%] right-[5%] w-[36rem] h-[36rem] bg-gradient-to-br from-blue-200 to-teal-100 rounded-full blur-3xl opacity-40" />
          <div className="absolute top-[30%] left-[55%] w-[28rem] h-[28rem] bg-gradient-to-br from-amber-100 to-rose-100 rounded-full blur-3xl opacity-30" />
          <div className="absolute bottom-[-15%] left-[20%] w-[32rem] h-[32rem] bg-gradient-to-br from-fuchsia-100 to-violet-100 rounded-full blur-3xl opacity-30" />
        </div>

        <TopBar page={page} onUploadClick={() => { setPage("documents"); setTimeout(() => document.getElementById("upload-zone")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }} />

        <div className="px-6 md:px-8 py-6 max-w-[1600px]">
          {showIntro && (
            <IntroPanel onClose={() => { setShowIntro(false); try { localStorage.setItem("factmesh_intro_dismissed", "1"); } catch {} }} />
          )}

          {page === "overview" && <OverviewPage stats={stats} documents={documents} onNavigate={handleNavigate} />}
          {page === "documents" && <DocumentsPage documents={documents} onFiles={uploadFiles} onDelete={deleteDocument} />}
          {page === "facts" && <FactsPage documents={documents} addToast={addToast} />}
          {page === "relationships" && <RelationshipsPageWithHint hint={relFilterHint} addToast={addToast} />}
          {page === "issues" && <IssuesPage addToast={addToast} />}

          <div className="mt-12 pt-6 border-t border-slate-200 text-center text-[12px] text-slate-400">
            FactMesh — a fact knowledge layer built for the Superjoin engineering intern assignment.
          </div>
        </div>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}

// Small wrapper so clicking a stat card (e.g. "Contradictions") lands on the
// Relationships page pre-filtered, without RelationshipsPage needing to know
// anything about where the filter request came from.
function RelationshipsPageWithHint({ hint, addToast }) {
  const initial = hint ? hint.split(":")[0] : "";
  return <RelationshipsPage key={hint} initialFilter={initial} addToast={addToast} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
