/**
 * SAP Build Process Automation adapter — the human-in-the-loop gate.
 *
 * An excursion starts the "Cold-chain recovery approval" process. The
 * coordinator's decision in the IntelliOps cockpit completes the approval
 * task (it can equally be completed from SAP Task Center / My Inbox).
 *
 * Live mode uses the SPA workflow REST API through destination `SBPA_API`
 * (OAuth2ClientCredentials from the SBPA service key).
 */
const { settings } = require('../lib/config');
const { callDestination } = require('../lib/http');

let mockCounter = 0;

async function startApproval({ shipment, excursion, notification }) {
  const cfg = settings().bpa;
  const context = {
    shipmentNumber: shipment.number,
    route: `${shipment.origin} -> ${shipment.destination}`,
    temperature: Number(excursion.peakTemp),
    timeToBreachMin: excursion.timeToBreachMin,
    riskProbability: Number(excursion.riskProbability ?? 0),
    doses: shipment.doses,
    childrenAtRisk: shipment.children,
    pmNotification: notification?.number ?? '',
    recommendedOption: 'DIVERT_REICE',
  };

  if (cfg.mode !== 'live') {
    mockCounter += 1;
    return { id: `mock-wf-${Date.now().toString(36)}-${mockCounter}`, status: 'RUNNING', mode: 'mock', context };
  }

  const data = await callDestination(cfg.destination, {
    method: 'post',
    url: '/workflow/rest/v1/workflow-instances',
    headers: { 'Content-Type': 'application/json' },
    data: { definitionId: cfg.definitionId, context },
  });
  return { id: data.id, status: data.status, mode: 'live', context };
}

async function completeApproval({ instanceId, option, approver }) {
  const cfg = settings().bpa;
  if (cfg.mode !== 'live' || !instanceId || instanceId.startsWith('mock-')) {
    return { id: instanceId, status: 'COMPLETED', decision: option, mode: 'mock' };
  }

  const tasks = await callDestination(cfg.destination, {
    method: 'get',
    url: `/workflow/rest/v1/task-instances?workflowInstanceId=${encodeURIComponent(instanceId)}&status=READY`,
  });
  const task = Array.isArray(tasks) ? tasks[0] : null;
  if (!task) return { id: instanceId, status: 'NO_OPEN_TASK', decision: option, mode: 'live' };

  await callDestination(cfg.destination, {
    method: 'patch',
    url: `/workflow/rest/v1/task-instances/${task.id}`,
    headers: { 'Content-Type': 'application/json' },
    data: { status: 'COMPLETED', decision: 'approve', context: { selectedOption: option, approver } },
  });
  return { id: instanceId, status: 'COMPLETED', decision: option, mode: 'live' };
}

module.exports = { startApproval, completeApproval };
