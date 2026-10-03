import { useEffect, useRef, useState } from "react";
import { Check, Phone, Send, ShieldCheck, Wrench } from "lucide-react";
import { getMaintenanceDocument } from "../lib/sap";
import { temperatureData } from "../data";

const FINDINGS = [
  ["Sensing", "Reefer temperature reached 9.2°C and is rising."],
  ["Scenario", "Cumulative exposure will cross the batch limit in 2h 10m."],
  ["Inventory", "14 downstream facilities and 3 sessions are affected."],
  ["Logistics", "Three recovery options have been simulated."],
];

export default function Incident({
  driver,
  onNavigate,
  driverContacted,
  setDriverContacted,
  driverAlertSent,
  setDriverAlertSent,
  sapSimulation,
  sapApproval,
}) {
  const [pmDoc, setPmDoc] = useState(null);

  // S/4HANA Plant Maintenance document raised for the reefer (via CAP).
  useEffect(() => {
    let active = true;
    getMaintenanceDocument("CN-24018")
      .then((doc) => active && setPmDoc(doc?.number ? doc : null))
      .catch((error) => console.error("Maintenance document failed:", error));
    return () => {
      active = false;
    };
  }, [sapSimulation, sapApproval]);

  const riskPct = sapSimulation?.riskProbability != null ? Math.round(Number(sapSimulation.riskProbability) * 100) : null;

  function sendWhatsAppAlert() {
    const message =
      "URGENT COLD-CHAIN ALERT: Consignment CN-24018 is at 9.2°C and rising. " +
      "Please stop safely, check the reefer, and proceed to the nearest re-icing point. " +
      "Please contact the coordinator immediately.";

    const whatsappUrl = `https://wa.me/${driver.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    setDriverAlertSent(true);
  }

  const firstName = driver.name.split(" ")[0];

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <button type="button" className="back-link" onClick={() => onNavigate("dashboard")}>
            ← Back to cockpit
          </button>
          <span className="eyebrow alert">Urgent incident · INC-2026-0418</span>
          <h1 className="page-title">CN-24018 — Chennai to Madurai</h1>
          <p className="page-sub">
            12,000 doses · DTP / Hep-B vaccine · Driver {driver.name} · {driver.vehicle}
          </p>
        </div>
        <span className="status-badge alert">Action required</span>
      </div>

      <section className="dark-panel incident-hero">
        <div className="kpi-stack">
          <div className="kpi hot">
            <span className="kpi-label">Current temperature</span>
            <div className="kpi-row">
              <span className="kpi-value">9.2°C</span>
              <span className="kpi-note">Limit 8°C · rising</span>
            </div>
          </div>
          <div className="kpi">
            <span className="kpi-label">Time to breach</span>
            <div className="kpi-row">
              <span className="kpi-value">2h 10m</span>
              <span className="kpi-note">No return at 13:51</span>
            </div>
          </div>
          <div className="kpi">
            <span className="kpi-label">Impact</span>
            <div className="kpi-row">
              <span className="kpi-value">380 children</span>
              <span className="kpi-note">14 facilities · 3 sessions</span>
            </div>
          </div>
        </div>

        <div className="hero-col">
          <div className="hero-col-head">
            <div className="hero-col-title">
              <h2 className="dark-title">Temperature trend · Sensing Agent</h2>
              <span className="dark-sub">
                Crossed 8°C at 11:20 and still rising · stationary for 40 min
                {riskPct != null && ` · SAP AI Core 24h risk ${riskPct}%`}
              </span>
            </div>
            <span className="chip dark-warn">RISING</span>
          </div>

          <TrendChart data={temperatureData} limit={8} />
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h2 className="card-title">What the agents found</h2>
          {FINDINGS.map(([title, text], index) => (
            <div className="finding" key={title}>
              <span className="finding-num mono">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </div>
          ))}
          <div className="banner lime">
            <ShieldCheck size={20} />
            <div className="banner-text">
              <strong>Human approval required</strong>
              <span>Product disposition is never automated.</span>
            </div>
          </div>
        </section>

        <div className="stack">
          <section className="card">
            <h2 className="card-title">Live route</h2>
            <div className="route-steps">
              <div className="route-step done">
                <span className="route-node"><Check size={15} strokeWidth={3} /></span>
                <span>Chennai State Store</span>
              </div>
              <div className="route-connector done" />
              <div className="route-step active">
                <span className="route-node">!</span>
                <span>{driver.type}</span>
              </div>
              <div className="route-connector" />
              <div className="route-step">
                <span className="route-node" />
                <span>Madurai District Store</span>
              </div>
              <div className="route-connector" />
              <div className="route-step">
                <span className="route-node" />
                <span>14 clinics</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="hero-col-head">
              <h2 className="card-title">S/4HANA Plant Maintenance</h2>
              {pmDoc && <span className={`mode-badge ${pmDoc.mode === "live" ? "live" : ""}`}>{pmDoc.mode === "live" ? "Live S/4" : "Mock"}</span>}
            </div>
            {pmDoc ? (
              <>
                <div className="person-row">
                  <span className="memory-icon" style={{ background: "#eef4d6", color: "#1b230a" }}><Wrench size={18} /></span>
                  <span className="person-meta">
                    <span className="person-name" style={{ fontSize: 15, fontWeight: 600 }}>
                      Notification <span className="mono">{pmDoc.number}</span>
                    </span>
                    <span className="person-sub">{pmDoc.description}</span>
                  </span>
                </div>
                <div className="sap-grid">
                  <div className="tile"><span className="tile-label">Type · priority</span><span className="tile-value">{pmDoc.type} · {pmDoc.priority === "1" ? "Very high" : pmDoc.priority}</span></div>
                  <div className="tile"><span className="tile-label">Equipment</span><span className="tile-value mono" style={{ fontSize: 15 }}>{pmDoc.equipment}</span></div>
                  <div className="tile"><span className="tile-label">Functional location</span><span className="tile-value mono" style={{ fontSize: 13 }}>{pmDoc.functionalLocation}</span></div>
                  <div className="tile">
                    <span className="tile-label">Maintenance order</span>
                    <span className="tile-value mono" style={{ fontSize: 15 }}>{pmDoc.orderNumber ? `${pmDoc.orderNumber} · ${pmDoc.orderType}` : "After approval"}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                No notification yet. When the reefer breaches 8°C, IntelliOps raises an M2 malfunction notification
                on the reefer&apos;s equipment in S/4HANA automatically. Run “Simulate temperature event” on the cockpit.
              </p>
            )}
          </section>

          <section className="card" style={{ flexGrow: 1 }}>
            <div className="hero-col-head">
              <h2 className="card-title">Contact the driver</h2>
              <span className="inline-status">On route</span>
            </div>
            <div className="person-row">
              <span className="avatar square lg">{driver.initials}</span>
              <span className="person-meta">
                <span className="person-name" style={{ fontSize: 15, fontWeight: 600 }}>{driver.name}</span>
                <span className="person-sub">
                  {driver.vehicle} · {driver.type} · {driver.location}
                </span>
              </span>
            </div>
            <div className="contact-actions">
              <a className="btn btn-dark" href={`tel:${driver.phone}`} onClick={() => setDriverContacted(true)}>
                <Phone size={16} />
                {driverContacted ? "Call placed" : `Call ${firstName}`}
              </a>
              <button type="button" className="btn btn-outline" onClick={sendWhatsAppAlert}>
                <Send size={16} />
                {driverAlertSent ? "WhatsApp opened" : "Send WhatsApp alert"}
              </button>
            </div>
            {(driverContacted || driverAlertSent) && (
              <p className="result-note" role="status">
                {driverContacted && driverAlertSent
                  ? "Driver contacted and urgent instruction sent."
                  : driverContacted
                    ? "Call started — contact attempt logged."
                    : "Urgent instruction sent to the driver."}
              </p>
            )}
          </section>
        </div>
      </div>

      <button type="button" className="btn btn-dark btn-lg btn-block" onClick={() => onNavigate("recovery")}>
        Open recovery simulator <span aria-hidden="true">→</span>
      </button>
    </>
  );
}

// Lightweight SVG line chart (replaces recharts — no extra dependencies).
function TrendChart({ data, limit, max = 12 }) {
  const [active, setActive] = useState(data.length - 1);
  const [W, setW] = useState(960);
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setW(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const H = 240;
  const pad = { top: 16, right: 20, bottom: 28, left: 36 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const x = (i) => pad.left + (innerW * i) / Math.max(1, data.length - 1);
  const y = (v) => pad.top + innerH - (v / max) * innerH;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)} ${y(d.temperature)}`).join(" ");
  const area = `${line} L${x(data.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  const ticks = [0, 3, 6, 9, 12];
  const point = data[active];
  const first = data[0];
  const last = data[data.length - 1];

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: "block" }}
        role="img"
        aria-label={`Reefer temperature rose from ${first.temperature}°C at ${first.time} to ${last.temperature}°C at ${last.time}; limit ${limit}°C`}
      >
        <defs>
          <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d9541e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#d9541e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a3d39" : "#262925"} />
            <text x={pad.left - 8} y={y(t) + 4} fill="#8c918a" fontSize="11" textAnchor="end">{t}°</text>
          </g>
        ))}
        <line x1={pad.left} x2={W - pad.right} y1={y(limit)} y2={y(limit)} stroke="#d9541e" strokeDasharray="4 4" />
        <text x={pad.left + 6} y={y(limit) - 6} fill="#f2a07e" fontSize="11">{limit}°C limit</text>
        <path d={area} fill="url(#tempFill)" />
        <path d={line} fill="none" stroke="#f4f5f2" strokeWidth="2.5" strokeLinejoin="round" />
        {data.map((d, i) => (
          <g key={d.time}>
            <text x={x(i)} y={H - 8} fill={i === active ? "#f4f5f2" : "#8c918a"} fontSize="11" textAnchor="middle">{d.time}</text>
            <circle
              cx={x(i)}
              cy={y(d.temperature)}
              r={i === active ? 6 : 4.5}
              fill={d.temperature >= limit ? "#d9541e" : "#121412"}
              stroke="#f4f5f2"
              strokeWidth="2"
             
            />
            <rect
              x={x(i) - innerW / (2 * Math.max(1, data.length - 1))}
              y={pad.top}
              width={innerW / Math.max(1, data.length - 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
            />
          </g>
        ))}
      </svg>
      <span
        style={{
          position: "absolute",
          left: `${(x(active) / W) * 100}%`,
          top: `${(y(point.temperature) / H) * 100}%`,
          transform: `translate(${active === data.length - 1 ? "-100%" : "-50%"}, calc(-100% - 12px))`,
          padding: "4px 8px",
          borderRadius: 8,
          background: "#fff",
          color: "#141613",
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {point.time} · {point.temperature}°C
      </span>
    </div>
  );
}
