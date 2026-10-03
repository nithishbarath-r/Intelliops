import { Download, MapPin } from "lucide-react";
import { dateDaysAgo, formatDateLabel, getHistoryForDate, recoveryOptions } from "../data";

const RECENT_DAYS = [0, 1, 2].map((offset) => {
  const date = dateDaysAgo(offset);
  const label = offset === 0 ? "Today" : offset === 1 ? "Yesterday" : formatDateLabel(date).replace(/ \d{4}$/, "");
  return [label, date];
});

export default function Evidence({
  selectedOption,
  approved,
  coordinatorName,
  acknowledged,
  sapSimulation,
  sapApproval,
  onNavigate,
}) {
  const chosen = recoveryOptions.find((option) => option.id === selectedOption);
  const decision = chosen ? chosen.name.toLowerCase() : "diversion and re-icing";

  const clock = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sapSteps = [...(sapSimulation?.steps ?? []), ...(sapApproval?.steps ?? [])];
  const sapTimeline = sapSteps.map((step) => [clock(step.ts), step.service, step.message]);

  const staticTimeline = [
    ["11:40", "Sensing Agent", "Detected 9.2°C and a stationary vehicle."],
    ["11:41", "Scenario Agent", "Calculated 2h 10m until breach."],
    ["11:41", "Inventory Agent", "Identified 14 facilities and 3 sessions at risk."],
    ["11:42", "Logistics Agent", "Simulated three recovery options."],
    approved
      ? [
          "11:58",
          coordinatorName,
          `Approved ${decision}.${acknowledged ? " Driver acknowledged." : " Waiting for driver acknowledgement."}`,
        ]
      : ["—", "Human gate", "Waiting for coordinator approval."],
  ];
  const timeline = sapTimeline.length ? sapTimeline : staticTimeline;
  const documents = [
    ["S/4 notification", sapApproval?.pmNotification ?? sapSimulation?.pmNotification],
    ["S/4 order", sapApproval?.pmOrder],
    ["BPA instance", sapApproval?.workflowInstance ?? sapSimulation?.workflowInstance],
  ].filter(([, value]) => value);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <button type="button" className="back-link" onClick={() => onNavigate("dashboard")}>
            ← Back to cockpit
          </button>
          <span className="eyebrow">Evidence pack · CN-24018</span>
          <h1 className="page-title">{approved ? "Incident recovered" : "Incident in progress"}</h1>
        </div>
        <span className={`status-badge ${approved ? "ok" : "alert"}`}>
          {approved ? "Recovery approved" : "Awaiting approval"}
        </span>
      </div>

      {approved ? (
        <section className="lime-card success-hero">
          <div>
            <strong>Nothing visible happened — that is success.</strong>
            <span>
              The shipment was diverted before the breach became irreversible. 12,000 doses
              kept within range.
            </span>
          </div>
          <button type="button" className="btn btn-dark" onClick={() => window.print()}>
            <Download size={16} /> Download audit PDF
          </button>
        </section>
      ) : (
        <section className="dark-panel success-hero">
          <div>
            <strong>No recovery approved yet.</strong>
            <span style={{ color: "#a3a8a0" }}>
              The audit trail completes once a recovery action is approved.
            </span>
          </div>
          <button type="button" className="btn btn-white" onClick={() => onNavigate("recovery")}>
            Open recovery simulator →
          </button>
        </section>
      )}

      <div className="evidence-grid">
        <section className="card">
          <h2 className="card-title">Audit timeline</h2>
          {documents.length > 0 && (
            <div className="sap-chip-row">
              {documents.map(([label, value]) => (
                <span className="sap-chip" key={label}>
                  {label} <strong>{value}</strong>
                </span>
              ))}
            </div>
          )}
          <div className="timeline">
            {timeline.map(([time, agent, text], index) => (
              <div
                key={`${time}-${agent}-${index}`}
                className={`tl-item ${index === timeline.length - 1 ? "final" : ""}`}
              >
                <span className="tl-time mono">{time}</span>
                <span className="tl-rail">
                  <span className="tl-dot" />
                  <span className="tl-line" />
                </span>
                <span className="tl-body">
                  <strong>{agent}</strong>
                  <span>{text}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="stack">
          <section className="dark-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="dark-title">Route memory</h2>
            <div className="memory-row">
              <span className="memory-icon"><MapPin size={20} /></span>
              <p>
                Similar unscheduled stops happened <strong>3 times</strong> on this route in the
                last 30 days.
              </p>
            </div>
            <p className="dark-sub" style={{ fontSize: 13 }}>
              Suggested follow-up: review scheduled-stop controls with the transporter.
            </p>
          </section>

          <section className="card" style={{ flexGrow: 1 }}>
            <div className="hero-col-head">
              <h2 className="card-title">Recent days</h2>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate("history")}>
                Full history
              </button>
            </div>
            <div className="day-grid">
              {RECENT_DAYS.map(([label, date]) => {
                const day = getHistoryForDate(date);
                return (
                  <div className="tile" key={date} style={{ padding: 14 }}>
                    <span className="tile-label">{label}</span>
                    <span className="tile-value">{day.health}</span>
                    <small className={day.attention > 2 ? "warn" : ""}>
                      {day.attention} need attention
                    </small>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
