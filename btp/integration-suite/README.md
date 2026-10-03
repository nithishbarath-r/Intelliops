# SAP Integration Suite — live feeds into Event Mesh

Two integration flows replace `feeds/weather-bridge.js` and `feeds/reefer-simulator.js` in production.

## iFlow 1 · `IntelliOps_Weather_To_EventMesh`
| Step | Adapter / step | Detail |
|---|---|---|
| Timer | Start timer | every 10 min |
| Get positions | OData V4 receiver → destination `INTELLIOPS_SRV` | `Shipments?$select=number,lastLatitude,lastLongitude&$filter=status ne 'Delivered'` |
| Split | General splitter | one message per shipment |
| Weather | HTTP receiver | `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation` |
| Map | Groovy / message mapping | → `{shipment, airTemp, humidity, rainMm, latitude, longitude, ts}` |
| Publish | AMQP receiver (Event Mesh, WebSocket) | topic `sap/intelliops/coldchain/weather/observation` |

## iFlow 2 · `IntelliOps_Reefer_To_EventMesh`
| Step | Adapter / step | Detail |
|---|---|---|
| Receive | HTTPS sender (or AMQP from the telematics broker) | reefer gateway posts `{deviceId, temp, humidity, door, lat, lon, ts}` |
| Enrich | Value mapping | `deviceId` → shipment number (e.g. REEFER-4521 → CN-24018) |
| Validate | Content modifier + router | drop readings with no temperature; flag sensor gaps as `Silent` |
| Publish | AMQP receiver (Event Mesh) | topic `sap/intelliops/coldchain/reefer/reading` |

CAP subscribes to both topics (`srv/coldchain-service.js → init()`), so nothing else changes
when you switch from the local scripts to Integration Suite.

## Event Mesh
Create the `enterprise-messaging` instance with `event-mesh.json` (namespace `sap/intelliops/coldchain`).
CAP creates its queue and topic subscriptions on start-up.
