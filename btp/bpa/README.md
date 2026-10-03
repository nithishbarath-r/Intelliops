# SAP Build Process Automation — "Cold-chain recovery approval"

The Compliance & Human-in-the-Loop step. Product disposition is never automated.

## Process (build it in the SBPA process editor)

1. **Trigger – API** with inputs from `process-context.schema.json`.
2. **Approval form → Coordinator** (group `IntelliOps_Coordinator`)
   - Shows shipment, temperature, time to breach, AI Core risk, S/4 notification.
   - Decision field `selectedOption`: Divert + re-ice / Quarantine / Reallocate buffer.
   - Due date = `timeToBreachMin` minutes; escalate to the district officer at 50%.
3. **Condition** on the decision.
4. **Action – Notify driver**: call CAP `approveRecovery` (destination `INTELLIOPS_SRV`)
   or let the cockpit do it; the driver app / Build Apps mobile app receives
   the Event Mesh topic `…/recovery/approved`.
5. **End** – audit trail stays in HANA Cloud (`PipelineEvents`, `Excursions`).

The cockpit's **Approve** button completes this task through the SPA API, so the
coordinator can decide either in IntelliOps or in SAP Task Center / My Inbox.

## Wiring

- Deploy the process, copy its **definition id** and set
  `cds_intelliops_bpa_definitionId=<id>` on `intelliops-srv`.
- Create destination `SBPA_API`: URL = `api` from the SBPA service key,
  Authentication = OAuth2ClientCredentials (uaa `url`/oauth/token, clientid, clientsecret).

## Build Apps — field staff mobile app

The existing React driver view (`src/DriverDashboard.jsx`) is the reference
design. To ship it as a native app, create an SAP Build Apps project with an
OData data source on destination `INTELLIOPS_SRV` (`/odata/v4/coldchain`):
list `Shipments` for the driver, show the latest `Excursions` with the
recovery option, and call `ingestReading` / Supabase-equivalent acknowledge.
