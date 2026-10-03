import { Check, CircleCheck } from "lucide-react";
import { recoveryOptions } from "../data";

export default function Recovery({
  driver,
  coordinatorName,
  selectedOption,
  setSelectedOption,
  approved,
  onApprove,
  sapApproval,
  sapError,
  onNavigate,
}) {
  const chosen = recoveryOptions.find((option) => option.id === selectedOption);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <button type="button" className="back-link" onClick={() => onNavigate("incident")}>
            ← Back to incident
          </button>
          <span className="eyebrow">Logistics agent</span>
          <h1 className="page-title">Recovery simulator</h1>
          <p className="page-sub">Choose the safest action for CN-24018. Three options simulated.</p>
        </div>
        <div className="banner dark" style={{ maxWidth: 520 }}>
          <Check size={20} color="#d2e28e" />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>
            <strong>Recommended: Divert + re-ice.</strong> Protects all 14 facilities and
            keeps the consignment within the recovery window.
          </span>
        </div>
      </div>

      <div className="option-grid">
        {recoveryOptions.map((option, index) => {
          const selected = selectedOption === option.id;
          return (
            <div
              key={option.id}
              className={`option-card ${option.recommended ? "recommended" : ""} ${selected ? "selected" : ""}`}
            >
              <div className="option-top">
                <span className="option-kicker">OPTION {String.fromCharCode(65 + index)}</span>
                {option.recommended && <span className="rec-label">RECOMMENDED</span>}
              </div>
              <div>
                <h2>{option.name}</h2>
                <p className="option-risk">{option.risk} risk</p>
              </div>
              <div className="option-stats">
                <div className="tile">
                  <span className="tile-label">Est. cost</span>
                  <span className="tile-value">{option.cost}</span>
                </div>
                <div className="tile">
                  <span className="tile-label">New ETA</span>
                  <span className="tile-value">{option.eta}</span>
                </div>
                <div className="tile">
                  <span className="tile-label">Facilities</span>
                  <span className="tile-value">{option.facilities}</span>
                </div>
              </div>
              <button
                type="button"
                className="btn"
                aria-pressed={selected}
                disabled={approved && !selected}
                onClick={() => !approved && setSelectedOption(option.id)}
              >
                {selected ? "Selected" : "Select option"}
              </button>
            </div>
          );
        })}
      </div>

      <section className="card approval-card">
        <div className="approval-text">
          <span className="eyebrow">Human gate</span>
          <h2>Approval required</h2>
          <p>
            {coordinatorName} must approve the recovery action. Approving completes the SAP Build
            Process Automation task, raises the S/4HANA maintenance order for the reefer, and
            sends the instruction to {driver.name}&apos;s driver app.
          </p>
        </div>

        {!approved ? (
          <button
            type="button"
            className="btn btn-dark btn-lg"
            disabled={!chosen}
            onClick={onApprove}
          >
            {chosen ? `Approve ${chosen.name.toLowerCase()}` : "Select an option first"}
          </button>
        ) : (
          <div className="approved-box" role="status">
            <CircleCheck size={22} />
            <div className="banner-text">
              <strong>{chosen?.name ?? "Recovery"} approved</strong>
              <span>
                {sapApproval
                  ? `S/4HANA order ${sapApproval.pmOrder ?? "—"} · BPA task completed · driver instructed`
                  : sapError
                    ? `Driver instructed · SAP step failed: ${sapError}`
                    : "Driver instructed · evidence pack started"}
              </span>
            </div>
            <button type="button" className="btn btn-dark" onClick={() => onNavigate("evidence")}>
              View evidence →
            </button>
          </div>
        )}
      </section>
    </>
  );
}
