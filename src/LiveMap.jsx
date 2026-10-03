import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, ZoomControl } from "react-leaflet";
import { LocateFixed, Maximize2, Phone, Sun } from "lucide-react";
import { supabase } from "./lib/supabase";
import { compass, distanceKm, motion } from "./lib/geo";
import { driverFromProfile, placeCoords } from "./lib/fleet";
import { destinationIcon, TILE_ATTRIBUTION, TILE_URL, truckIcon } from "./lib/mapIcons";

const STATUS = {
  LIVE: { text: "Live", color: "#6e8f1a" },
  STALE: { text: "Delayed", color: "#e0a84e" },
  OFFLINE: { text: "Offline", color: "#d9541e" },
  NOT_STARTED: { text: "No GPS yet", color: "#9a9e97" },
  PAUSED: { text: "Paused", color: "#9a9e97" },
};

function trackingState(shipment, now) {
  if (!shipment?.last_seen_at) return { status: "NOT_STARTED", ageSeconds: null };
  const ageSeconds = Math.max(0, Math.floor((now - new Date(shipment.last_seen_at).getTime()) / 1000));
  let status = ageSeconds <= 120 ? "LIVE" : ageSeconds <= 600 ? "STALE" : "OFFLINE";
  if (shipment.tracking_status === "PAUSED" && status === "LIVE") status = "PAUSED";
  return { status, ageSeconds };
}

function ago(seconds) {
  if (seconds == null) return "";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

function clock(value) {
  return value ? new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

const hasPosition = (s) => s?.current_latitude != null && s?.current_longitude != null;
const posOf = (s) => [Number(s.current_latitude), Number(s.current_longitude)];

/** Fit all trucks once, then keep the selected truck in view while following. */
function MapController({ fleet, selected, follow, recenterToken, fitToken }) {
  const map = useMap();
  const fitted = useRef(false);

  const fitAll = () => {
    const pts = fleet.filter(hasPosition).map(posOf);
    if (pts.length === 1) map.setView(pts[0], 12, { animate: false });
    else if (pts.length > 1) map.fitBounds(pts, { padding: [60, 60], maxZoom: 11, animate: false });
  };

  useEffect(() => {
    if (!fitted.current && fleet.some(hasPosition)) {
      fitted.current = true;
      fitAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet]);

  useEffect(() => {
    if (fitToken) fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  const selectedPos = selected && hasPosition(selected) ? posOf(selected) : null;
  const key = selectedPos ? selectedPos.join(",") : "";
  useEffect(() => {
    if (follow && selectedPos && fitted.current) map.panTo(selectedPos, { animate: true, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, follow]);

  useEffect(() => {
    if (recenterToken && selectedPos) map.setView(selectedPos, Math.max(map.getZoom(), 13), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterToken]);

  return null;
}

export default function LiveMap({ incidentShipment, incidentDriver, onNavigate }) {
  const [fleet, setFleet] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [trails, setTrails] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const [follow, setFollow] = useState(true);
  const [recenterToken, setRecenterToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const [loadError, setLoadError] = useState(null);

  // Load the fleet + driver names, then follow realtime changes.
  useEffect(() => {
    let active = true;

    async function load() {
      const [{ data: ships, error }, { data: people }] = await Promise.all([
        supabase.from("shipments").select("*"),
        supabase.from("profiles").select("*").eq("role", "driver"),
      ]);
      if (!active) return;
      if (error) {
        setLoadError(error.message);
        return;
      }
      setFleet(ships ?? []);
      setProfiles(Object.fromEntries((people ?? []).map((p) => [p.id, p])));
      setTrails((current) => {
        const next = { ...current };
        for (const s of ships ?? []) if (hasPosition(s) && !next[s.id]) next[s.id] = [{ lat: posOf(s)[0], lon: posOf(s)[1], ts: s.last_seen_at ?? new Date().toISOString() }];
        return next;
      });
    }
    load();

    const channel = supabase
      .channel("fleet-live-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setFleet((list) => list.filter((s) => s.id !== payload.old?.id));
          return;
        }
        const row = payload.new;
        setFleet((list) => (list.some((s) => s.id === row.id) ? list.map((s) => (s.id === row.id ? row : s)) : [...list, row]));
        if (hasPosition(row)) {
          const point = { lat: Number(row.current_latitude), lon: Number(row.current_longitude), ts: row.last_seen_at ?? new Date().toISOString() };
          setTrails((all) => {
            const trail = all[row.id] ?? [];
            const last = trail[trail.length - 1];
            if (last && last.lat === point.lat && last.lon === point.lon) return all;
            return { ...all, [row.id]: [...trail, point].slice(-600) };
          });
        }
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Demo database only: keep the other trucks moving so the fleet looks alive.
  useEffect(() => {
    if (!supabase.isDemo) return undefined;
    const timer = setInterval(() => supabase.demoFleetTick(), 6000);
    return () => clearInterval(timer);
  }, []);

  // Re-evaluate live / delayed / offline without waiting for new data.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Default selection: the incident truck, else the most recently seen one.
  const effectiveId = useMemo(() => {
    if (selectedId && fleet.some((s) => s.id === selectedId)) return selectedId;
    const incident = fleet.find((s) => s.shipment_number === incidentShipment) ?? fleet.find((s) => s.status === "ACTION_REQUIRED");
    if (incident) return incident.id;
    const seen = [...fleet].filter(hasPosition).sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
    return seen[0]?.id ?? null;
  }, [selectedId, fleet, incidentShipment]);

  const selected = fleet.find((s) => s.id === effectiveId) ?? null;

  // Stored GPS history (gps_positions) for the selected truck — survives reloads.
  useEffect(() => {
    if (!effectiveId) return undefined;
    let active = true;
    supabase
      .from("gps_positions")
      .select("*")
      .eq("shipment_id", effectiveId)
      .order("recorded_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!active || error || !data?.length) return; // table missing in older projects: keep session trail
        const history = data.reverse().map((p) => ({ lat: Number(p.latitude), lon: Number(p.longitude), ts: p.recorded_at }));
        setTrails((all) => {
          const session = all[effectiveId] ?? [];
          const lastHistoryTs = history[history.length - 1].ts;
          return { ...all, [effectiveId]: [...history, ...session.filter((p) => p.ts > lastHistoryTs)] };
        });
      });
    return () => {
      active = false;
    };
  }, [effectiveId]);

  const driverFor = (s) => {
    if (!s) return null;
    const fromProfile = driverFromProfile(profiles[s.driver_id]);
    if (fromProfile) return fromProfile;
    if (s.shipment_number === incidentShipment) return incidentDriver;
    return { name: "Unassigned", initials: "—", vehicle: "—", type: "Reefer", phone: "" };
  };

  const ordered = [...fleet].sort((a, b) => {
    const rank = (s) => (s.shipment_number === incidentShipment || s.status === "ACTION_REQUIRED" ? 0 : 1);
    return rank(a) - rank(b) || String(a.shipment_number).localeCompare(String(b.shipment_number));
  });

  const trail = (selected && trails[selected.id]) || [];
  const { speedKmh, heading } = motion(trail);
  const here = selected && hasPosition(selected) ? { lat: posOf(selected)[0], lon: posOf(selected)[1] } : null;
  const dest = selected ? placeCoords(selected.destination) : null;
  const origin = selected ? placeCoords(selected.origin) : null;
  const remainingKm = here && dest ? distanceKm(here, dest) : null;
  const totalKm = origin && dest ? distanceKm(origin, dest) : null;
  const progress = remainingKm != null && totalKm ? Math.min(100, Math.max(0, Math.round((1 - remainingKm / totalKm) * 100))) : null;
  const etaMin = remainingKm != null && speedKmh && speedKmh > 5 ? Math.round((remainingKm / speedKmh) * 60) : null;
  const selState = trackingState(selected, now);
  const selDriver = driverFor(selected);
  const isIncident = selected && (selected.shipment_number === incidentShipment || selected.status === "ACTION_REQUIRED");
  const liveCount = fleet.filter((s) => trackingState(s, now).status === "LIVE").length;

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <button type="button" className="back-link" onClick={() => onNavigate("dashboard")}>
            ← Back to cockpit
          </button>
          <span className="eyebrow">Live fleet map</span>
          <h1 className="page-title">Every reefer, live</h1>
          <p className="page-sub">
            {fleet.length
              ? `${fleet.length} vehicles · ${liveCount} reporting live GPS. Select a truck to follow it.`
              : loadError
                ? `Could not load the fleet: ${loadError}`
                : "Loading fleet…"}
          </p>
        </div>
      </div>

      <div className="map-layout">
        <section className="map-card">
          <MapContainer center={[10.9, 78.6]} zoom={7} scrollWheelZoom zoomControl={false} className="live-map">
            <ZoomControl position="topright" />
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

            {selected && here && dest && (
              <>
                <Polyline positions={[[here.lat, here.lon], [dest.lat, dest.lon]]} pathOptions={{ color: "#141613", weight: 3, opacity: 0.5, dashArray: "4 10", lineCap: "round" }} />
                <Marker position={[dest.lat, dest.lon]} icon={destinationIcon}>
                  <Tooltip direction="bottom" offset={[0, 8]}>{selected.destination}</Tooltip>
                </Marker>
              </>
            )}
            {trail.length > 1 && (
              <Polyline positions={trail.map((p) => [p.lat, p.lon])} pathOptions={{ color: isIncident ? "#d9541e" : "#1f3a5f", weight: 5, opacity: 0.9, lineCap: "round", lineJoin: "round" }} />
            )}

            {fleet.filter(hasPosition).map((s) => {
              const state = trackingState(s, now);
              const sel = s.id === effectiveId;
              const alert = s.shipment_number === incidentShipment || s.status === "ACTION_REQUIRED";
              const d = driverFor(s);
              return (
                <Marker
                  key={s.id}
                  position={posOf(s)}
                  icon={truckIcon({ live: state.status === "LIVE", alert, selected: sel, heading: sel ? heading : null })}
                  zIndexOffset={sel ? 1000 : alert ? 500 : 0}
                  eventHandlers={{ click: () => setSelectedId(s.id) }}
                >
                  <Tooltip direction="top" permanent={sel || alert} className="truck-label">
                    {s.shipment_number}
                  </Tooltip>
                  <Popup>
                    <strong>{s.shipment_number}</strong> · {d?.name}
                    <br />
                    {s.origin} → {s.destination}
                    <br />
                    {STATUS[state.status].text}
                    {state.ageSeconds != null && ` · ${ago(state.ageSeconds)}`}
                  </Popup>
                </Marker>
              );
            })}

            <MapController fleet={fleet} selected={selected} follow={follow} recenterToken={recenterToken} fitToken={fitToken} />
          </MapContainer>

          <div className="map-overlay">
            <span className="map-chip">
              {liveCount > 0 ? <span className="pulse-dot" /> : <span className="status-dot" style={{ background: "#9a9e97" }} />}
              {liveCount} live of {fleet.length}
            </span>
            {selected && (
              <span className="map-chip" style={{ fontWeight: 400 }}>
                {selected.shipment_number} · {selected.origin} → {selected.destination}
              </span>
            )}
          </div>

          <div className="map-controls">
            {selected && (
              <button type="button" className={`btn btn-outline btn-sm ${follow ? "on" : ""}`} aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
                {follow ? "Following truck" : "Follow truck"}
              </button>
            )}
            {selected && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setRecenterToken((t) => t + 1)}>
                <LocateFixed size={15} /> Recenter
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                setFollow(false);
                setFitToken((t) => t + 1);
              }}
            >
              <Maximize2 size={15} /> Whole fleet
            </button>
          </div>

          {selected && selState.status === "STALE" && (
            <div className="map-alert" role="status">
              <strong>GPS update delayed</strong>
              <span>Showing {selected.shipment_number}&apos;s last known location from {ago(selState.ageSeconds)}.</span>
            </div>
          )}
          {selected && selState.status === "OFFLINE" && (
            <div className="map-alert" role="status">
              <strong>Driver may be offline</strong>
              <span>The phone may be off, out of coverage, or GPS disabled. Call {selDriver?.name} before acting.</span>
            </div>
          )}
        </section>

        <aside className="map-side">
          <section className="card fleet-card">
            <h2 className="card-title" style={{ fontSize: 18 }}>Fleet</h2>
            <div className="fleet-list" role="listbox" aria-label="Vehicles">
              {ordered.map((s) => {
                const state = trackingState(s, now);
                const d = driverFor(s);
                const sel = s.id === effectiveId;
                const alert = s.shipment_number === incidentShipment || s.status === "ACTION_REQUIRED";
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    className={`fleet-row ${sel ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedId(s.id);
                      setFollow(true);
                      setRecenterToken((t) => t + 1);
                    }}
                  >
                    <span className="status-dot" style={{ background: alert ? "#d9541e" : STATUS[state.status].color }} />
                    <span className="fleet-main">
                      <span className="mono">{s.shipment_number}</span>
                      <span className="fleet-sub">{d?.name} · {s.destination}</span>
                    </span>
                    <span className="fleet-state">{alert ? "Excursion" : STATUS[state.status].text}</span>
                  </button>
                );
              })}
              {!fleet.length && <p className="muted" style={{ fontSize: 13 }}>No vehicles yet.</p>}
            </div>
          </section>

          {selected && (
            <section className="card">
              <div className="person-row">
                <span className="avatar square" style={{ width: 44, height: 44 }}>{selDriver?.initials}</span>
                <span className="person-meta">
                  <span className="person-name" style={{ fontSize: 15, fontWeight: 600 }}>{selDriver?.name}</span>
                  <span className="person-sub">{selDriver?.vehicle} · {selected.shipment_number}</span>
                </span>
                {selDriver?.phone && (
                  <a className="square-btn" style={{ background: "#141613", color: "#fff", border: 0, width: 44, height: 44, borderRadius: 12 }} href={`tel:${selDriver.phone}`} aria-label={`Call ${selDriver.name}`}>
                    <Phone size={17} />
                  </a>
                )}
              </div>
              <div className="tile-grid">
                <div className="tile">
                  <span className="tile-label">Speed · heading</span>
                  <span className="tile-value">{speedKmh != null ? `${Math.round(speedKmh)} km/h ${compass(heading)}` : "—"}</span>
                </div>
                <div className="tile">
                  <span className="tile-label">GPS</span>
                  <span className="tile-value">{STATUS[selState.status].text}{selState.ageSeconds != null ? ` · ${ago(selState.ageSeconds)}` : ""}</span>
                </div>
                <div className="tile">
                  <span className="tile-label">To {selected.destination} · direct</span>
                  <span className="tile-value">{remainingKm != null ? `${remainingKm.toFixed(1)} km` : "—"}</span>
                </div>
                <div className="tile">
                  <span className="tile-label">ETA at this speed</span>
                  <span className="tile-value">{etaMin != null ? `${Math.floor(etaMin / 60)}h ${String(etaMin % 60).padStart(2, "0")}m` : "—"}</span>
                </div>
              </div>
              {progress != null && (
                <>
                  <div className="progress" aria-label={`Route ${progress}% complete`}><div style={{ width: `${progress}%` }} /></div>
                  <span className="person-sub">{progress}% of {selected.origin} → {selected.destination} · last fix {clock(selected.last_seen_at)} · {trail.length} trail points</span>
                </>
              )}
              {isIncident && (
                <button type="button" className="btn btn-dark btn-block" onClick={() => onNavigate("incident")}>
                  Open incident
                </button>
              )}
            </section>
          )}

          {selected && (
            <section className="dark-panel" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 20 }}>
              <div className="hero-col-head">
                <h2 className="dark-title" style={{ fontSize: 17 }}>Outside air at the truck</h2>
                <Sun size={20} color="#e0a84e" />
              </div>
              {selected.current_temperature != null ? (
                <>
                  <div className="weather-big">
                    <strong style={{ fontSize: 36 }}>{selected.current_temperature}°C</strong>
                    <span className="dark-sub" style={{ fontSize: 14 }}>Humidity {selected.current_humidity ?? "—"}%</span>
                  </div>
                  <span className="dark-sub">From the driver&apos;s GPS position · {clock(selected.weather_updated_at)}</span>
                </>
              ) : (
                <span className="dark-sub" style={{ fontSize: 13 }}>Appears once the driver starts live GPS tracking.</span>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
