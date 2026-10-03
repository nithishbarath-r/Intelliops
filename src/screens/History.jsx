import { CircleCheck } from "lucide-react";
import { getHistoryForDate } from "../data";

export default function History({
  selectedDate,
  draftDate,
  setDraftDate,
  applyDate,
  onNavigate,
}) {
  const data = getHistoryForDate(selectedDate);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <button type="button" className="back-link" onClick={() => onNavigate("dashboard")}>
            ← Back to cockpit
          </button>
          <span className="eyebrow">Historical operations</span>
          <h1 className="page-title">Cold-chain history</h1>
          <p className="page-sub">Review previous network conditions and recorded incidents.</p>
        </div>

        <form
          className="card date-card"
          style={{ padding: 14 }}
          onSubmit={(event) => {
            event.preventDefault();
            applyDate();
          }}
        >
          <label htmlFor="history-date">
            Select date
            <input
              id="history-date"
              type="date"
              value={draftDate}
              min="2020-01-01"
              max="2030-12-31"
              onChange={(event) => setDraftDate(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-dark">Apply</button>
        </form>
      </div>

      <section className="dark-panel success-hero">
        <div>
          <span className="dark-sub" style={{ fontSize: 13 }}>Selected date</span>
          <strong>{data.label}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <CircleCheck size={28} color="#d2e28e" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 44, fontWeight: 400, letterSpacing: -1, lineHeight: 1 }}>
              {data.health}
            </span>
            <span className="dark-sub">cold-chain health</span>
          </div>
        </div>
      </section>

      <div className="stat-grid">
        <div className="tile">
          <span className="tile-label">Normal consignments</span>
          <span className="tile-value">{data.normal}</span>
        </div>
        <div className="tile warn">
          <span className="tile-label">Need attention</span>
          <span className="tile-value">{data.attention}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Warning lead time</span>
          <span className="tile-value">{data.leadTime}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Children at risk</span>
          <span className="tile-value">{data.children}</span>
        </div>
      </div>

      <section className="card" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="eyebrow">Recorded incident</span>
          <h2 className="card-title">{data.incident}</h2>
          <p className="muted" style={{ fontSize: 14 }}>{data.incidentDetails}</p>
        </div>
        <button type="button" className="btn btn-dark" onClick={() => onNavigate("dashboard")}>
          Return to cockpit
        </button>
      </section>
    </>
  );
}
