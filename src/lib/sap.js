// SAP BTP client for IntelliOps.
//
// VITE_SAP_MODE=live  → calls the CAP service (btp/) at VITE_SAP_API_URL
//                        (empty = same origin: Vite proxy in dev, approuter on BTP)
// VITE_SAP_MODE=mock  → (default) runs an in-browser mirror of the CAP flow,
//                        so the app works with no SAP backend running.
// If live mode can't reach CAP, calls fall back to the mock and say so.

const MODE = (import.meta.env.VITE_SAP_MODE || "mock").toLowerCase();
const BASE = `${import.meta.env.VITE_SAP_API_URL || ""}/odata/v4/coldchain`;

export function sapMode() {
  return MODE === "live" ? "live" : "mock";
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    credentials: "include",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return data.value !== undefined && Array.isArray(data.value) ? data.value : data;
}

async function withFallback(liveCall, mockCall) {
  // `via` = how the call was answered (live CAP or browser mock). Business
  // payloads keep their own `mode` (which adapters inside CAP are mock/live).
  if (sapMode() !== "live") return { ...(await mockCall()), via: "mock" };
  try {
    const result = await liveCall();
    return Array.isArray(result) ? { items: result, via: "live" } : { ...result, via: "live" };
  } catch (error) {
    if (error.status && error.status < 500) throw error; // real business error (e.g. 409)
    console.warn("SAP backend unreachable, using mock:", error.message);
    return { ...(await mockCall()), via: "mock", fallback: true };
  }
}

// ---------------------------------------------------------------- public API

export function simulateExcursion(shipment = "CN-24018") {
  return withFallback(() => call("POST", "simulateExcursion", { shipment }), () => mock.simulate(shipment));
}

export function approveRecovery({ shipment = "CN-24018", option, approver }) {
  return withFallback(() => call("POST", "approveRecovery", { shipment, option, approver }), () => mock.approve(shipment, option, approver));
}

export async function getRiskForecasts() {
  const result = await withFallback(() => call("GET", "riskForecasts()"), () => ({ items: mock.forecasts() }));
  return result.items ?? [];
}

export function getMaintenanceDocument(shipment = "CN-24018") {
  return withFallback(
    async () => (await call("GET", `maintenanceDocument(shipment='${encodeURIComponent(shipment)}')`)) ?? {},
    () => mock.document(shipment) ?? {}
  );
}

export function askJoule(question) {
  return withFallback(() => call("POST", "ask", { question }), () => mock.ask(question));
}

export function resetSapDemo() {
  return withFallback(() => call("POST", "resetDemo", {}).then(() => ({})), () => mock.reset());
}

// ---------------------------------------------------------------- in-browser mock
// Mirrors btp/srv/coldchain-service.js with the same seed data and outputs.

const mock = (() => {
  let excursion = null;
  let notificationNo = 10004700;
  let orderNo = 4000120;

  const baseForecasts = [
    { shipment: "CN-24018", driver: "Raghul", route: "Chennai → Madurai", probability: 0.0412, level: "LOW", timeToBreachMin: null, temperature: 6.0 },
    { shipment: "CN-24025", driver: "Prakash", route: "Tiruchirappalli → Sivaganga", probability: 0.0035, level: "LOW", timeToBreachMin: null, temperature: 5.0 },
    { shipment: "CN-24011", driver: "Nithin Adhithya", route: "Salem → Erode", probability: 0.0016, level: "LOW", timeToBreachMin: null, temperature: 5.1 },
    { shipment: "CN-24014", driver: "Depot pool", route: "Erode → Namakkal", probability: 0.0021, level: "LOW", timeToBreachMin: null, temperature: 4.3 },
    { shipment: "CN-24027", driver: "Nithish Barath", route: "Madurai → Melur", probability: 0.0008, level: "LOW", timeToBreachMin: null, temperature: 4.6 },
    { shipment: "CN-24029", driver: "Sabarish Krishnan", route: "Madurai District Store → PHC Tirumangalam", probability: 0.0004, level: "LOW", timeToBreachMin: null, temperature: 3.9 },
  ];

  const now = () => new Date().toISOString();
  const step = (service, message, topic = null, ref = null) => ({ ts: now(), service, topic, message, ref });

  function forecasts() {
    return baseForecasts
      .map((f) =>
        f.shipment === "CN-24018" && excursion
          ? { ...f, probability: 0.9197, level: "HIGH", timeToBreachMin: excursion.timeToBreachMin, temperature: 9.2 }
          : f
      )
      .sort((a, b) => b.probability - a.probability);
  }

  function simulate(shipment) {
    if (!excursion || excursion.status !== "Open") {
      notificationNo += 1;
      excursion = {
        shipment,
        status: "Open",
        peakTemp: 9.2,
        timeToBreachMin: 136,
        riskProbability: 0.9197,
        notification: { number: String(notificationNo), type: "M2", priority: "1", equipment: "10004521", functionalLocation: "TN-CHN-FLEET-REEF", description: `Reefer excursion ${shipment} 9.2C`, status: "OSNO" },
        workflowInstance: `mock-wf-${Date.now().toString(36)}`,
        order: null,
      };
    }
    const n = excursion.notification;
    return {
      shipment,
      peakTemp: 9.2,
      timeToBreachMin: excursion.timeToBreachMin,
      riskProbability: excursion.riskProbability,
      pmNotification: n.number,
      workflowInstance: excursion.workflowInstance,
      steps: [
        step("Event Mesh → HANA Cloud", "6 reefer readings published on Event Mesh and stored as time series", "reefer/reading"),
        step("Sensing Agent", `${shipment} projected to cross 8°C within the hour — on watch`),
        step("Sensing Agent", `Excursion HIGH on ${shipment}: 9.2°C and rising`),
        step("Scenario Agent", `Exposure budget leaves ${excursion.timeToBreachMin} min until breach`),
        step("AI Core", "24h excursion risk 92% (HIGH) — intelliops-excursion-risk-v1"),
        step("S/4HANA PM", `Notification ${n.number} (M2, priority 1) created for equipment ${n.equipment}`, "API_MAINTNOTIFICATION", n.number),
        step("Build Process Automation", `Recovery approval started for ${shipment} — task sent to coordinator`, "workflow-instances", excursion.workflowInstance),
        step("Event Mesh", "Excursion event broadcast to subscribers (driver app, Build Apps)", "excursion/detected"),
        step("Compliance Agent", "Automatic product disposition blocked — human approval required"),
      ],
    };
  }

  function approve(shipment, option, approver) {
    if (!excursion || excursion.status !== "Open") {
      const error = new Error(`No open excursion for ${shipment}. Simulate a temperature event first.`);
      error.status = 409;
      throw error;
    }
    const labels = { DIVERT_REICE: "Divert + re-ice", QUARANTINE: "Quarantine consignment", REALLOCATE_BUFFER: "Reallocate buffer stock" };
    orderNo += 1;
    excursion.status = "Approved";
    excursion.order = { number: String(orderNo), type: "PM01" };
    return {
      shipment,
      option,
      status: "Approved",
      pmNotification: excursion.notification.number,
      pmOrder: excursion.order.number,
      workflowInstance: excursion.workflowInstance,
      steps: [
        step("Build Process Automation", `Approval task completed by ${approver ?? "coordinator"}: ${labels[option] ?? option}`, "task-instances", excursion.workflowInstance),
        step("S/4HANA PM", `Order ${excursion.order.number} (PM01) created from notification ${excursion.notification.number}`, "API_MAINTENANCEORDER", excursion.order.number),
        step("Event Mesh", "Recovery instruction broadcast to the driver's app", "recovery/approved"),
      ],
    };
  }

  function document(shipment) {
    if (!excursion || excursion.shipment !== shipment) return null;
    const n = excursion.notification;
    return { shipment, ...n, orderNumber: excursion.order?.number ?? null, orderType: excursion.order?.type ?? null, mode: "mock" };
  }

  function ask(question) {
    const q = question.toLowerCase();
    const list = forecasts();
    const pct = (p) => `${Math.round(p * 100)}%`;
    const hit = list.find((f) => q.includes(f.shipment.toLowerCase()));
    if (hit) {
      const doc = document(hit.shipment);
      return {
        answer: `${hit.shipment} (${hit.route}, driver ${hit.driver}) is at ${hit.temperature}°C. 24h excursion risk is ${pct(hit.probability)} (${hit.level}).${doc ? ` S/4HANA notification ${doc.number} is open for equipment ${doc.equipment}.` : ""}`,
        shipments: [hit.shipment],
        source: "IntelliOps rules (mock)",
      };
    }
    if (/notification|maintenance|s\/4|order/.test(q)) {
      const doc = excursion ? document(excursion.shipment) : null;
      return {
        answer: doc ? `Open maintenance notification ${doc.number} for equipment ${doc.equipment} (${doc.shipment})${doc.orderNumber ? `, order ${doc.orderNumber}` : ""}.` : "No maintenance notifications have been raised yet.",
        shipments: doc ? [doc.shipment] : [],
        source: "IntelliOps rules (mock)",
      };
    }
    if (/risk|breach|excursion|today|which|attention|worst|hot|warm/.test(q)) {
      const atRisk = list.filter((f) => f.level !== "LOW");
      return {
        answer: atRisk.length
          ? `${atRisk.length} shipment${atRisk.length === 1 ? " is" : "s are"} at risk in the next 24 hours: ${atRisk.map((f) => `${f.shipment} (${f.route}) ${pct(f.probability)} ${f.level.toLowerCase()}`).join("; ")}.`
          : "No shipment is above low risk for the next 24 hours.",
        shipments: atRisk.map((f) => f.shipment),
        source: "IntelliOps rules (mock)",
      };
    }
    return {
      answer: "Try “Which shipments are at risk today?”, “Status of CN-24018” or “Show open maintenance notifications”.",
      shipments: [],
      source: "IntelliOps rules (mock)",
    };
  }

  function reset() {
    excursion = null;
    return {};
  }

  return { simulate, approve, forecasts, document, ask, reset };
})();

// Live GPS → SAP HANA Cloud time series (CAP action ingestPosition).
// Mock mode: nothing to send, the position already reached the map via Supabase.
export async function sendPosition(position) {
  if (sapMode() !== "live") return { via: "mock" };
  try {
    await call("POST", "ingestPosition", position);
    return { via: "live" };
  } catch (error) {
    if (error.status && error.status < 500) throw error;
    return { via: "mock", fallback: true };
  }
}
