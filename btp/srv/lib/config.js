const cds = require('@sap/cds');

/**
 * IntelliOps settings live under `cds.intelliops` in package.json and can be
 * overridden per profile or with env vars, e.g.
 *   cds_intelliops_s4_mode=live
 *   cds_intelliops_aicore_deploymentId=d123…
 */
function settings() {
  const s = cds.env.intelliops || {};
  return {
    topicPrefix: s.topicPrefix || 'intelliops/coldchain',
    s4: { mode: 'mock', destination: 'S4HANA_PM', notificationType: 'M2', priority: '1', orderType: 'PM01', ...(s.s4 || {}) },
    bpa: { mode: 'mock', destination: 'SBPA_API', definitionId: 'eu10.intelliops.coldchainrecovery.recoveryApproval', ...(s.bpa || {}) },
    aicore: { mode: 'mock', destination: 'AICORE', resourceGroup: 'default', deploymentId: '', ...(s.aicore || {}) },
    joule: { mode: 'mock', destination: 'AICORE', resourceGroup: 'default', deploymentId: '', apiVersion: '2024-02-01', ...(s.joule || {}) },
  };
}

module.exports = { settings };
