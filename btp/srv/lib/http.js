/**
 * Thin wrapper over the SAP Cloud SDK so every live adapter resolves its
 * target through a BTP Destination (credentials never live in code).
 * Loaded lazily so mock mode works without the SDK being reachable.
 */
async function callDestination(destinationName, request) {
  const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
  const response = await executeHttpRequest({ destinationName }, request);
  return response.data;
}

module.exports = { callDestination };
