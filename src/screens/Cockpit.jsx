import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Ellipsis,
  LocateFixed,
  Search,
  Sparkles,
  TriangleAlert,
  Upload,
  WifiOff,
  Zap,
} from "lucide-react";
import { askJoule, getRiskForecasts, sapMode } from "../lib/sap";
import {
  getConsignments,
  getHistoryForDate,
  statusMeta,
} from "../data";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "excursion", label: "Excursion" },
  { id: "watch", label: "Watch" },
  { id: "silent", label: "Silent" },
  { id: "normal", label: "In range" },
];

function previousDay(date) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Cockpit({
  selectedDate,
  draftDate,
  setDraftDate,
  applyDate,
  assignedDriver,
  simulationStarted,
  agentMessages,
  totalSteps,
  sapError,
  onSimulate,
  onNavigate,
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState("search"); // search | joule
  const [jouleAnswer, setJouleAnswer] = useState(null);
  const [jouleBusy, setJouleBusy] = useState(false);
  const [forecasts, setForecasts] = useState([]);

  const day = getHistoryForDate(selectedDate);
  const yesterday = getHistoryForDate(previousDay(selectedDate));
  const healthDelta = parseInt(day.health, 10) - parseInt(yesterday.health, 10);
  const total = day.normal + day.attention;
  const normalPct = Math.round((day.normal / total) * 100);

  const consignments = useMemo(
    () => getConsignments(assignedDriver),
    [assignedDriver]
  );

  const counts = {
    all: total,
    excursion: 1,
    watch: 1,
    silent: 2,
    normal: day.normal,
  };

  const rows = consignments.filter((row) => {
    const matchesFilter = filter === "all" || row.status === filter;
    const q = searchMode === "search" ? query.trim().toLowerCase() : "";
    const matchesQuery =
      !q ||
      [row.id, row.driver, row.vehicle, row.from, row.to]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return matchesFilter && matchesQuery;
  });

  const decisionReady =
    simulationStarted && totalSteps > 0 && agentMessages.length >= totalSteps;

  // SAP AI Core — 24h excursion risk per consignment (refreshes after a simulation).
  useEffect(() => {
    let active = true;
    getRiskForecasts()
      .then((items) => active && setForecasts(items))
      .catch((error) => console.error("Risk forecasts failed:", error));
    return () => {
      active = false;
    };
  }, [decisionReady, simulationStarted]);

  const riskByShipment = Object.fromEntries(forecasts.map((f) => [f.shipment, f]));

  async function runJoule(question) {
    const q = question.trim();
    if (!q) return;
    setJouleBusy(true);
    try {
      setJouleAnswer(await askJoule(q));
    } catch (error) {
      setJouleAnswer({ answer: `Joule could not answer: ${error.message}`, shipments: [], source: "error" });
    } finally {
      setJouleBusy(false);
    }
  }

  return (
    <div className="cockpit-grid">
      {/* ---------- Left column ---------- */}
      <aside className="cockpit-side">
        <section className="card">
          <h2 className="card-title">Cold-chain network overview</h2>

          <div className="tile-grid">
            <div className="tile">
              <span className="tile-label">Normal</span>
              <span className="tile-value">{day.normal}</span>
            </div>
            <div className="tile warn">
              <span className="tile-label">Need attention</span>
              <span className="tile-value">{day.attention}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Warning lead time</span>
              <span className="tile-value">{day.leadTime}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Children at risk</span>
              <span className="tile-value">{day.children}</span>
            </div>
          </div>

          <div className="person-row">
            <span className="avatar square">{assignedDriver.initials}</span>
            <span className="person-meta">
              <span className="person-name">{assignedDriver.name}</span>
              <span className="person-sub">Driver · {assignedDriver.vehicle}</span>
            </span>
            <span className="chip lime">On route</span>
          </div>

          <div className="alert-list">
            <button type="button" className="alert-link" onClick={() => onNavigate("incident")}>
              <span className="alert-icon hot"><TriangleAlert size={17} /></span>
              <span className="alert-body">
                <span className="alert-title">1 excursion</span>
                <span className="alert-sub">CN-24018 · investigate now</span>
              </span>
              <ChevronRight size={18} />
            </button>
            <button type="button" className="alert-link" onClick={() => onNavigate("map")}>
              <span className="alert-icon"><WifiOff size={17} strokeWidth={1.8} /></span>
              <span className="alert-body">
                <span className="alert-title">2 silent stalls</span>
                <span className="alert-sub">Loggers not reporting</span>
              </span>
              <ChevronRight size={18} />
            </button>
            <button type="button" className="alert-link" onClick={() => onNavigate("history")}>
              <span className="alert-icon"><Clock size={17} strokeWidth={1.8} /></span>
              <span className="alert-body">
                <span className="alert-title">1 on watch</span>
                <span className="alert-sub">CN-24011 · handover dwell</span>
              </span>
              <ChevronRight size={18} />
            </button>
          </div>
        </section>

        <section className="lime-card reefer-card">
          <TruckArt />
          <div>
            <h2>Reefer on the road</h2>
            <p>CN-24018 · Chennai → Madurai. 12,000 doses of DTP / Hep-B, tracked live.</p>
          </div>
          <button type="button" className="btn btn-dark btn-block" onClick={() => onNavigate("map")}>
            Track vehicle <LocateFixed size={17} />
          </button>
        </section>
      </aside>

      {/* ---------- Right column ---------- */}
      <div className="cockpit-main">
        <section className="dark-panel hero-panel">
          <div className="hero-toolbar">
            <form
              className="hero-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (searchMode === "joule") runJoule(query);
              }}
            >
              <div className="search-mode" role="group" aria-label="Search or ask Joule">
                <button
                  type="button"
                  aria-pressed={searchMode === "search"}
                  aria-label="Search consignments"
                  className={searchMode === "search" ? "on" : ""}
                  onClick={() => {
                    setSearchMode("search");
                    setJouleAnswer(null);
                  }}
                >
                  <Search size={15} />
                </button>
                <button
                  type="button"
                  aria-pressed={searchMode === "joule"}
                  className={searchMode === "joule" ? "on" : ""}
                  onClick={() => {
                    setSearchMode("joule");
                    setQuery("");
                  }}
                >
                  <Sparkles size={15} /> Joule
                </button>
              </div>
              <label className="sr-only" htmlFor="cockpit-query">
                {searchMode === "joule" ? "Ask Joule" : "Search consignments"}
              </label>
              <input
                id="cockpit-query"
                type={searchMode === "joule" ? "text" : "search"}
                placeholder={
                  searchMode === "joule"
                    ? "Ask Joule: which shipments are at risk today?"
                    : "Search consignment, driver or vehicle…"
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {searchMode === "joule" && (
                <button type="submit" className="joule-send" disabled={jouleBusy || !query.trim()}>
                  {jouleBusy ? "Asking…" : "Ask"}
                </button>
              )}
            </form>

            <div className="date-field">
              <label htmlFor="cockpit-date">Date</label>
              <input
                id="cockpit-date"
                type="date"
                value={draftDate}
                min="2020-01-01"
                max="2030-12-31"
                onChange={(event) => setDraftDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyDate();
                  }
                }}
              />
              <button type="button" onClick={applyDate}>Apply</button>
            </div>

            <button type="button" className="btn btn-ghost-dark" onClick={() => window.print()}>
              <Upload size={16} /> Export
            </button>
            <button type="button" className="btn btn-white" onClick={onSimulate}>
              <Zap size={16} className="simulate-icon" />
              {simulationStarted ? "Clear simulation" : "Simulate temperature event"}
            </button>
          </div>

          {searchMode === "joule" && !jouleAnswer && (
            <div className="joule-suggestions">
              {["Which shipments are at risk today?", "Status of CN-24018", "Show open maintenance notifications"].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setQuery(q);
                    runJoule(q);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {jouleAnswer && (
            <div className="joule-answer" role="status">
              <Sparkles size={18} />
              <div>
                <p>{jouleAnswer.answer}</p>
                <small>
                  {jouleAnswer.source}
                  {jouleAnswer.fallback ? " · SAP backend unreachable" : ""}
                </small>
              </div>
              <button type="button" className="square-btn dark" aria-label="Close answer" onClick={() => setJouleAnswer(null)}>
                ×
              </button>
            </div>
          )}

          {sapError && (
            <div className="joule-answer warn" role="alert">
              <TriangleAlert size={18} />
              <div><p>SAP pipeline error: {sapError}</p></div>
            </div>
          )}

          <div className="hero-grid">
            <div className="hero-col">
              {simulationStarted ? (
                <>
                  <div className="hero-col-head">
                    <div className="hero-col-title">
                      <h2 className="dark-title">Agent orchestration</h2>
                      <span className="dark-sub">
                        Temperature event from CN-24018 · SAP BTP {sapMode() === "live" ? "live" : "mock mode"}
                      </span>
                    </div>
                    <span className={`agent-status ${decisionReady ? "ready" : ""}`}>
                      {decisionReady ? "DECISION READY" : "AGENTS PROCESSING"}
                    </span>
                  </div>

                  <ol className="agent-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {agentMessages.map((step, index) => (
                      <li className="agent-step" key={`${step.service}-${index}`}>
                        <span className="mono">{String(index + 1).padStart(2, "0")}</span>
                        <span>
                          <span className="svc-tag">{step.service}</span>
                          {step.message}
                        </span>
                        <Check size={14} strokeWidth={2.5} />
                      </li>
                    ))}
                  </ol>

                  {decisionReady && (
                    <button type="button" className="decision-link" onClick={() => onNavigate("incident")}>
                      Decision ready — divert + re-ice recommended, approval needed
                      <span aria-hidden="true">→</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="hero-col-head">
                    <div className="hero-col-title">
                      <h2 className="dark-title">Reefer temperature</h2>
                      <span className="dark-sub">CN-24018 · last 2 hours · limit 8°C</span>
                    </div>
                    <button
                      type="button"
                      className="square-btn dark"
                      aria-label="Open incident detail"
                      onClick={() => onNavigate("incident")}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="time-axis">
                    <span>09:40</span><span>10:00</span><span>10:20</span><span>10:40</span>
                    <span>11:00</span><span>11:20</span><span className="now">11:40</span>
                  </div>
                  <TempBars />
                </>
              )}
            </div>

            <div className="hero-col">
              <div className="hero-col-head">
                <h2 className="dark-title">Cold-chain health</h2>
                <button
                  type="button"
                  className="square-btn dark"
                  aria-label="View history"
                  onClick={() => onNavigate("history")}
                >
                  <ArrowUpDown size={16} />
                </button>
              </div>
              <div className="health-number">
                <strong>{day.health}</strong>
                <span className={`chip ${healthDelta < 0 ? "dark-warn" : "lime"}`}>
                  {healthDelta > 0 ? "+" : healthDelta < 0 ? "−" : "±"}
                  {Math.abs(healthDelta)} pts vs previous day
                </span>
              </div>
              <div className="gauge-row">
                <HealthGauge values={[normalPct, 99, 95]} />
                <div className="legend">
                  <LegendItem color="#d2e28e" label="Consignments normal" value={`${day.normal} / ${total}`} />
                  <LegendItem color="#8fb9cc" label="Sensors online" value="198 / 200" />
                  <LegendItem color="#e0a84e" label="Routes reporting" value="42 / 44" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="table-section">
          <div className="table-head">
            <div className="table-title">
              <h2>Consignments</h2>
              <span className="chip soft">{total}</span>
            </div>
            <div className="pills" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`pill ${filter === f.id ? "active" : ""}`}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label} <strong>{counts[f.id]}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="table-scroll">
            <div className="ctable" role="table" aria-label="Consignments">
              <div className="crow head" role="row">
                <span role="columnheader">Consignment</span>
                <span role="columnheader">Driver</span>
                <span role="columnheader">Route</span>
                <span role="columnheader">Vehicle</span>
                <span role="columnheader">Reefer</span>
                <span role="columnheader" title="24h excursion risk from SAP AI Core">Risk 24h</span>
                <span role="columnheader">Status</span>
                <span role="columnheader"><span className="sr-only">Actions</span></span>
              </div>

              {rows.map((row) => {
                const meta = statusMeta[row.status];
                const hot = row.status === "excursion";
                return (
                  <div className="crow" role="row" key={row.id}>
                    <span role="cell" className="mono">{row.id}</span>
                    <span role="cell">{row.driver}</span>
                    <span role="cell" className="route-cell">
                      <svg width="12" height="30" viewBox="0 0 12 30" fill="none" aria-hidden="true">
                        <circle cx="6" cy="5" r="3.5" stroke="#141613" strokeWidth="1.5" />
                        <path d="M6 9v12" stroke="#b7bbb4" strokeWidth="1.5" strokeDasharray="2 2" />
                        <circle cx="6" cy="25" r="3.5" fill="#141613" />
                      </svg>
                      <span><span>{row.from}</span><span>{row.to}</span></span>
                    </span>
                    <span role="cell" className="vehicle-cell">
                      <span className="mono">{row.vehicle}</span>
                      <small>{row.type}</small>
                    </span>
                    <span role="cell" className={hot ? "temp-hot" : ""}>{row.temp}</span>
                    <RiskCell forecast={riskByShipment[row.id]} />
                    <span role="cell" className="status-cell">
                      <span className="status-dot" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                    <span role="cell" className="row-actions">
                      <button
                        type="button"
                        className={`btn btn-sm ${hot ? "btn-dark" : "btn-outline"}`}
                        onClick={() => onNavigate(hot ? "incident" : "map")}
                      >
                        {hot ? "Investigate" : "Track"}
                      </button>
                      <button type="button" className="square-btn" style={{ width: 36, height: 36 }} aria-label={`More actions for ${row.id}`}>
                        <Ellipsis size={16} />
                      </button>
                    </span>
                  </div>
                );
              })}

              {rows.length === 0 && (
                <p className="table-empty">No consignments match this filter.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function LegendItem({ color, label, value }) {
  return (
    <div className="legend-item">
      <span className="legend-swatch" style={{ background: color }} />
      <span>
        {label}
        <small>{value}</small>
      </span>
    </div>
  );
}

// Reefer readings every 2.5 min, interpolated from the sensing-agent points.
const BAR_POINTS = [[0, 5.4], [16, 5.8], [24, 6.2], [32, 7.1], [40, 8.3], [47, 9.2]];
const BARS = Array.from({ length: 48 }, (_, i) => {
  let t = 5.4;
  for (let k = 0; k < BAR_POINTS.length - 1; k += 1) {
    const [x0, y0] = BAR_POINTS[k];
    const [x1, y1] = BAR_POINTS[k + 1];
    if (i >= x0 && i <= x1) t = y0 + ((y1 - y0) * (i - x0)) / (x1 - x0);
  }
  const jitter = i < 47 ? (((i * 37) % 7) - 3) * 0.06 : 0;
  return t + jitter;
});

function TempBars() {
  const maxTemp = 10;
  return (
    <div className="bars" role="img" aria-label="Reefer temperature rising from about 5.4°C to 9.2°C, above the 8°C limit since 11:20">
      <div className="limit-line" style={{ bottom: `${(8 / maxTemp) * 100 * 0.86}%` }} />
      <span className="limit-label" style={{ bottom: `calc(${(8 / maxTemp) * 100 * 0.86}% + 4px)` }}>
        8°C limit
      </span>
      {BARS.map((t, i) => {
        const last = i === BARS.length - 1;
        return (
          <div
            key={i}
            className={`bar ${last ? "now" : t >= 8 ? "over" : ""}`}
            style={{ height: `${(t / maxTemp) * 86}%` }}
          >
            {last && <span className="bar-tag">{t.toFixed(1)}°C</span>}
          </div>
        );
      })}
    </div>
  );
}

function HealthGauge({ values }) {
  const arcs = [
    { r: 130, color: "#d2e28e" },
    { r: 106, color: "#8fb9cc" },
    { r: 82, color: "#e0a84e" },
  ];
  return (
    <svg
      className="gauge"
      viewBox="0 0 300 160"
      fill="none"
      role="img"
      aria-label={`Network signals: ${values[0]}% consignments normal, ${values[1]}% sensors online, ${values[2]}% routes reporting`}
    >
      {arcs.map(({ r, color }, i) => {
        const d = `M${150 - r} 150 A${r} ${r} 0 0 1 ${150 + r} 150`;
        return (
          <g key={r}>
            <path d={d} stroke="#2a2d29" strokeWidth="14" strokeLinecap="round" />
            <path
              d={d}
              pathLength="100"
              strokeDasharray={`${values[i]} 100`}
              stroke={color}
              strokeWidth="14"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

function TruckArt() {
  return (
    <svg className="truck-art" viewBox="0 0 300 170" fill="none" aria-hidden="true">
      <ellipse cx="160" cy="156" rx="140" ry="8" fill="#b8c975" />
      <rect x="18" y="22" width="178" height="112" rx="6" fill="#fff" stroke="#141613" strokeWidth="2" />
      <line x1="18" y1="118" x2="196" y2="118" stroke="#141613" strokeWidth="2" />
      <g stroke="#8fb9cc" strokeWidth="3" strokeLinecap="round">
        <path d="M107 48v44" /><path d="M88 59l38 22" /><path d="M126 59l-38 22" />
      </g>
      <rect x="200" y="40" width="10" height="84" rx="2" fill="#141613" />
      <path d="M210 58h36c6 0 11 3 14 8l16 26c2 3 3 6 3 10v24c0 4-3 8-8 8h-61z" fill="#fff" stroke="#141613" strokeWidth="2" />
      <path d="M222 66h24c3 0 5 1 7 4l11 20h-42z" fill="#dde7ee" stroke="#141613" strokeWidth="2" />
      <rect x="266" y="112" width="14" height="6" rx="2" fill="#141613" />
      {[62, 100, 244].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="140" r="15" fill="#141613" />
          <circle cx={cx} cy="140" r="6" fill="#d2e28e" />
        </g>
      ))}
      <rect x="34" y="30" width="34" height="14" rx="3" fill="#141613" />
      <text x="51" y="40.5" fontFamily="Geist Mono, monospace" fontSize="8" fill="#d2e28e" textAnchor="middle">2–8°C</text>
    </svg>
  );
}

function RiskCell({ forecast }) {
  if (!forecast) return <span role="cell" className="muted">—</span>;
  const pct = Math.round(Number(forecast.probability) * 100);
  const color = forecast.level === "HIGH" ? "#d9541e" : forecast.level === "MEDIUM" ? "#e0a84e" : "#6e8f1a";
  return (
    <span role="cell" className="risk-cell" title={`SAP AI Core · ${forecast.level}`}>
      <span className="risk-bar"><span style={{ width: `${Math.max(4, pct)}%`, background: color }} /></span>
      <span className={forecast.level === "HIGH" ? "temp-hot" : ""}>{pct}%</span>
    </span>
  );
}
