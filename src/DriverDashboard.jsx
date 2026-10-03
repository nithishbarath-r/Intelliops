import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleCheck,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { sendPosition } from "./lib/sap";
import { demoRoute, distanceKm } from "./lib/geo";
import { placeCoords } from "./lib/fleet";
import { destinationIcon, TILE_ATTRIBUTION, TILE_URL, truckIcon } from "./lib/mapIcons";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";

export default function DriverDashboard({ profile, onLogout }) {
  const [shipment, setShipment] = useState(null);
  const [recoveryAlert, setRecoveryAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [weather, setWeather] = useState(null);
  const [locationStatus, setLocationStatus] = useState("Not shared");
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const [coordinator, setCoordinator] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const watchIdRef = useRef(null);
  const simTimerRef = useRef(null);
  const lastSentRef = useRef(null);
  const lastWeatherRef = useRef(null);
  const shipmentRef = useRef(null);
  const gpsTableRef = useRef(true); // false once we learn gps_positions doesn't exist
  const [myTrail, setMyTrail] = useState([]);

  useEffect(() => {
    shipmentRef.current = shipment;
  }, [shipment]);

  // Stop GPS and the demo drive when the driver leaves the page.
  useEffect(
    () => () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!profile?.id) {
      return undefined;
    }

    async function loadDriverData() {
      const { data: shipmentRows, error: shipmentError } = await supabase
       .from("shipments")
       .select("*")
       .eq("driver_id", profile.id)
       .limit(1);

    if (shipmentError) {
      console.error("Shipment loading failed:", shipmentError);
    }

    const shipmentData = shipmentRows?.[0] ?? null;

      

      const { data: coordinatorData, error: coordinatorError } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("role", "coordinator")
        .limit(1)
        .maybeSingle();

      if (coordinatorError) {
        console.error("Coordinator loading failed:", coordinatorError);
      }

      const { data: alertData, error: alertError } = await supabase
        .from("recovery_instructions")
        .select("*")
        .eq("driver_id", profile.id)
        .in("status", ["SENT", "ACKNOWLEDGED", "IN_PROGRESS"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (alertError) {
        console.error("Recovery alert loading failed:", alertError);
      }

      setShipment(shipmentData);
      setCoordinator(coordinatorData);
      setRecoveryAlert(alertData);
      setLoading(false);
    }

    loadDriverData();

    const channel = supabase
      .channel(`driver-alerts-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "recovery_instructions",
          filter: `driver_id=eq.${profile.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setRecoveryAlert(null);
          } else {
            setRecoveryAlert(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  async function acknowledgeRecovery() {
    if (!recoveryAlert?.id) return;

    const { data, error } = await supabase
      .from("recovery_instructions")
      .update({
        status: "ACKNOWLEDGED",
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", recoveryAlert.id)
      .select()
      .single();

    if (error) {
      console.error("Could not acknowledge recovery:", error);
      return;
    }

    setRecoveryAlert(data);
  }

  // ------------------------------------------------------------------ live GPS
  // Continuous tracking: the phone's GPS (browser Geolocation API, no key
  // needed) streams positions; each one is saved to Supabase (driver ->
  // coordinator realtime) and sent to SAP HANA Cloud as a GPS time series.

  function shareLocation() {
    setShowLocationConfirm(true);
  }

  function confirmShareLocation() {
    setShowLocationConfirm(false);
    startTracking();
  }

  function startTracking() {
    if (!navigator.geolocation) {
      setLocationStatus("GPS unavailable on this device");
      return;
    }
    stopSimulation();
    stopWatch();
    setLocationStatus("Finding GPS signal…");
    setTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) =>
        handleFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
          speedKmh: position.coords.speed != null ? position.coords.speed * 3.6 : null,
        }),
      handleLocationError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  function startSimulation() {
    stopWatch();
    stopSimulation();
    const route = demoRoute();
    let index = 0;
    setTracking(true);
    setSimulating(true);
    setLocationStatus("Demo drive started");
    const step = () => {
      const point = route[Math.min(index, route.length - 1)];
      handleFix({ latitude: point.lat, longitude: point.lon, accuracy: 8, speedKmh: 63 }, { force: true });
      index += 1;
      if (index >= route.length) stopSimulation("Demo drive reached Madurai");
    };
    step();
    simTimerRef.current = setInterval(step, 2000);
  }

  function stopWatch() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }

  function stopSimulation(message) {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setSimulating(false);
    if (message) {
      setTracking(false);
      setLocationStatus(message);
    }
  }

  async function stopTracking() {
    stopWatch();
    stopSimulation();
    setTracking(false);
    setLocationStatus("Live tracking stopped");
    if (shipment?.id) {
      await supabase
        .from("shipments")
        .update({ tracking_status: "PAUSED", last_seen_status: "TRACKING_STOPPED" })
        .eq("id", shipment.id);
    }
  }

  async function handleFix(fix, { force = false } = {}) {
    setLocation(fix);
    const now = Date.now();
    const last = lastSentRef.current;
    const movedKm = last ? distanceKm({ lat: last.latitude, lon: last.longitude }, { lat: fix.latitude, lon: fix.longitude }) : Infinity;

    // Throttle: save at most every 8 s, or sooner if the truck moved 30 m+.
    if (!force && last && now - last.at < 8000 && movedKm < 0.03) return;
    lastSentRef.current = { ...fix, at: now };

    const currentShipment = shipmentRef.current;
    if (!currentShipment?.id) {
      setLocationStatus("Shipment not found");
      return;
    }

    const sharedAt = new Date(now).toISOString();
    const payload = {
      current_latitude: fix.latitude,
      current_longitude: fix.longitude,
      location_accuracy: fix.accuracy,
      location_shared_at: sharedAt,
      tracking_status: "LIVE",
      last_seen_at: sharedAt,
      last_seen_status: "GPS_CONNECTED",
      ...(supabase.isDemo ? { tracking_source: "driver" } : {}),
    };

    // Outside-air weather (Open-Meteo, no key) every 10 minutes.
    // A weather failure never blocks the location update.
    if (!lastWeatherRef.current || now - lastWeatherRef.current > 10 * 60000) {
      lastWeatherRef.current = now;
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${fix.latitude}&longitude=${fix.longitude}&current=temperature_2m,relative_humidity_2m&timezone=auto`
        );
        if (!response.ok) throw new Error(`Weather ${response.status}`);
        const data = await response.json();
        const nextWeather = { temperature: data.current.temperature_2m, humidity: data.current.relative_humidity_2m };
        setWeather(nextWeather);
        Object.assign(payload, {
          current_temperature: nextWeather.temperature,
          current_humidity: nextWeather.humidity,
          weather_updated_at: sharedAt,
        });
      } catch (error) {
        console.warn("Weather unavailable:", error.message);
      }
    }

    const { data: updated, error } = await supabase
      .from("shipments")
      .update(payload)
      .eq("id", currentShipment.id)
      .select("*")
      .single();

    if (error) {
      console.error("Supabase location update failed:", error);
      setLocationStatus(`Save failed: ${error.message}`);
      return;
    }

    if (updated) setShipment(updated);
    setSentCount((count) => count + 1);
    setMyTrail((trail) => [...trail, [fix.latitude, fix.longitude]].slice(-400));

    // GPS history for the coordinator's map (table from supabase/migrations).
    if (gpsTableRef.current) {
      const { error: gpsError } = await supabase.from("gps_positions").insert({
        shipment_id: currentShipment.id,
        driver_id: profile.id,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        speed_kmh: fix.speedKmh != null ? Math.round(fix.speedKmh * 10) / 10 : null,
        recorded_at: sharedAt,
      });
      if (gpsError) {
        gpsTableRef.current = false;
        console.warn("GPS history not saved (run supabase/migrations to add gps_positions):", gpsError.message);
      }
    }
    setLocationStatus(`Live · updated ${new Date(now).toLocaleTimeString("en-GB")}`);

    // SAP BTP: GPS time series in HANA Cloud (no-op in mock mode).
    sendPosition({
      shipment: currentShipment.shipment_number,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      speedKmh: fix.speedKmh,
    }).catch((sapError) => console.warn("SAP position not sent:", sapError.message));
  }

  function handleLocationError(error) {
    if (error.code === error.PERMISSION_DENIED) {
      console.error("Location permission denied");
      setLocationStatus("Location permission denied — allow it in the browser");
      stopWatch();
      setTracking(false);
      return;
    }
    // Timeouts / weak signal are normal on the road: keep tracking, and only
    // change the status if no fix has been received yet.
    console.warn(`GPS ${error.code === error.TIMEOUT ? "timeout" : "unavailable"}:`, error.message);
    if (!lastSentRef.current) {
      setLocationStatus(error.code === error.TIMEOUT ? "Waiting for GPS signal…" : "GPS signal unavailable — trying again");
    }
  }

  function openWhatsApp() {
    if (!coordinator?.phone) {
      alert("Coordinator phone number is not available.");
      return;
    }

    const phone = coordinator.phone.replace(/[^0-9]/g, "");
    const message =
      `Hello ${coordinator.full_name}, this is ` +
      `${profile?.full_name ?? "the driver"}. ` +
      `I am contacting you about shipment ` +
      `${shipment?.shipment_number ?? ""}.`;

    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  if (!profile?.id) {
    return <main className="loading-screen">Driver profile is not available.</main>;
  }

  if (loading) {
    return <div className="loading-screen">Loading driver workspace…</div>;
  }

  const isCritical = shipment?.status === "ACTION_REQUIRED";
  const coordinatorName = coordinator?.full_name ?? "Meera Raghavan";
  const firstName = profile.full_name?.split(" ")[0] ?? "Driver";
  const initials =
    profile.full_name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") ?? "DR";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";
  const acknowledged = recoveryAlert && recoveryAlert.status !== "SENT";

  return (
    <main className="driver-app">
      {showLocationConfirm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowLocationConfirm(false);
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-modal-title"
          >
            <span className="memory-icon" style={{ background: "#eef4d6", color: "#1b230a" }}>
              <MapPin size={22} />
            </span>
            <h2 id="location-modal-title">Start live GPS tracking?</h2>
            <p>
              Your phone&apos;s GPS position is shared with {coordinatorName} every few seconds while
              tracking is on, so the reefer can be followed live on the map. You can stop it any time.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowLocationConfirm(false)}>
                Not now
              </button>
              <button type="button" className="btn btn-dark" onClick={confirmShareLocation}>
                Start tracking
              </button>
            </div>
          </section>
        </div>
      )}

      <header className="driver-top">
        <div className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}intelliops-logo.jpg`} alt="" style={{ width: 40, height: 40 }} />
          <div className="brand-text">
            <span className="brand-name" style={{ fontSize: 15 }}>IntelliOps</span>
            <span className="brand-sub">Driver cockpit</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="avatar square">{initials}</span>
          <button type="button" className="square-btn" onClick={onLogout} aria-label="Sign out" style={{ width: 44, height: 44, borderRadius: 12 }}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="driver-greet">
        <span>{greeting}</span>
        <h1>{firstName}</h1>
      </div>

      <section className="dark-panel driver-alert">
        <div className="driver-alert-head">
          <span className={`driver-alert-icon ${isCritical ? "" : "calm"}`}>
            {isCritical ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
          </span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <strong style={{ fontSize: 15, fontWeight: 600 }}>
              {isCritical ? "Cold-chain excursion" : "Shipment in range"}
            </strong>
            <span className="dark-sub">
              {isCritical ? "Keep the container closed" : "No action needed right now"}
            </span>
          </div>
        </div>
        <div className="driver-tiles">
          <div className={`kpi ${isCritical ? "hot" : ""}`}>
            <span className="kpi-label">Reefer</span>
            <span className="kpi-value">{shipment?.temperature ?? "--"}°C</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{isCritical ? "Window" : "Range"}</span>
            <span className="kpi-value">{isCritical ? "2h 10m" : "2–8°C"}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Load</span>
            <span className="kpi-value mono" style={{ fontSize: 13, paddingTop: 4 }}>
              {shipment?.shipment_number ?? "--"}
            </span>
          </div>
        </div>
      </section>

      {recoveryAlert ? (
        <section className={`lime-card instruction-card ${acknowledged ? "acked" : ""}`}>
          <div className="instruction-head">
            <span className="eyebrow">Recovery instruction</span>
            <span>Approved by {coordinatorName}</span>
          </div>
          <p>{recoveryAlert.instruction}</p>
          {recoveryAlert.status === "SENT" ? (
            <button type="button" className="btn btn-dark btn-lg btn-block" onClick={acknowledgeRecovery}>
              Acknowledge instruction
            </button>
          ) : (
            <div className="acked-note" role="status">
              <Check size={18} strokeWidth={2.4} />
              {recoveryAlert.status === "ACKNOWLEDGED"
                ? "Acknowledged — coordinator notified"
                : recoveryAlert.status}
            </div>
          )}
        </section>
      ) : (
        <section className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16 }}>
          <CircleCheck size={22} color="#6e8f1a" />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontSize: 14, fontWeight: 600 }}>No new recovery instruction</strong>
            <span className="person-sub">New coordinator actions will appear here.</span>
          </div>
        </section>
      )}

      <section className="card" style={{ padding: 16, gap: 12 }}>
        <div className="hero-col-head">
          <h2 className="card-title" style={{ fontSize: 16 }}>Current journey</h2>
          <span className="person-sub mono">{profile.vehicle_number}</span>
        </div>
        <div className="route-cell">
          <svg width="12" height="44" viewBox="0 0 12 44" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4" stroke="#141613" strokeWidth="1.6" />
            <path d="M6 11v22" stroke="#b7bbb4" strokeWidth="1.6" strokeDasharray="2 3" />
            <circle cx="6" cy="38" r="4" fill="#141613" />
          </svg>
          <span style={{ gap: 14, fontSize: 14 }}>
            <span>{shipment?.origin ?? "Madurai"}</span>
            <span>{shipment?.destination ?? "Chennai"}</span>
          </span>
        </div>
        <DriverMiniMap
          position={
            location
              ? [location.latitude, location.longitude]
              : shipment?.current_latitude != null
                ? [Number(shipment.current_latitude), Number(shipment.current_longitude)]
                : null
          }
          destination={placeCoords(shipment?.destination)}
          trail={myTrail}
          live={tracking}
          alert={isCritical}
        />
        <div className="kv-row">
          <span>Live GPS</span>
          <span className={tracking ? "gps-live" : ""}>{locationStatus}</span>
        </div>
        {location && (
          <>
            <div className="kv-row"><span>Position</span><span className="mono">{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</span></div>
            <div className="kv-row"><span>Accuracy · speed</span><span>±{location.accuracy} m · {location.speedKmh != null ? `${Math.round(location.speedKmh)} km/h` : "—"}</span></div>
            <div className="kv-row"><span>Updates sent</span><span>{sentCount}</span></div>
          </>
        )}
        {tracking ? (
          <button type="button" className="btn btn-dark btn-block" onClick={stopTracking}>
            <span className="pulse-dot" /> {simulating ? "Stop demo drive" : "Stop live tracking"}
          </button>
        ) : (
          <button type="button" className="btn btn-dark btn-block" onClick={shareLocation}>
            <Navigation size={16} /> Start live GPS tracking
          </button>
        )}
        {(!isSupabaseConfigured || import.meta.env.DEV) && !tracking && (
          <button type="button" className="btn btn-outline btn-block" onClick={startSimulation}>
            <MapPin size={16} /> Simulate drive (demo)
          </button>
        )}
      </section>

      <section className="dark-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="hero-col-head">
          <h2 className="dark-title" style={{ fontSize: 16 }}>Local conditions</h2>
          <Sun size={20} color="#e0a84e" />
        </div>
        {weather ? (
          <>
            <div className="weather-big">
              <strong style={{ fontSize: 36 }}>{weather.temperature}°C</strong>
              <span className="dark-sub" style={{ fontSize: 14 }}>Humidity {weather.humidity}%</span>
            </div>
            <span className="dark-sub">Based on your shared GPS location</span>
          </>
        ) : (
          <span className="dark-sub" style={{ fontSize: 13 }}>Share your location to load local weather.</span>
        )}
      </section>

      <section className="card" style={{ padding: 16, gap: 10 }}>
        <p className="bullet hot">Stop safely before inspecting the reefer. Never touch equipment while moving.</p>
        <p className="bullet">{coordinatorName} is monitoring this shipment.</p>
      </section>

      <button type="button" className="btn btn-outline btn-lg btn-block" style={{ borderColor: "#141613" }} onClick={openWhatsApp}>
        <Phone size={17} /> WhatsApp {coordinatorName.split(" ")[0]}
      </button>
    </main>
  );
}

function FollowMe({ position }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!position) return;
    if (first.current) {
      first.current = false;
      map.setView(position, 13, { animate: false });
    } else {
      map.panTo(position, { animate: true, duration: 0.5 });
    }
  }, [position, map]);
  return null;
}

/** Small live map on the driver's phone: own position, trail and destination. */
function DriverMiniMap({ position, destination, trail, live, alert }) {
  if (!position) {
    return (
      <div className="mini-map" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f2ee" }}>
        <span className="person-sub">Start live GPS to see yourself on the map</span>
      </div>
    );
  }
  return (
    <div className="mini-map">
      <MapContainer center={position} zoom={13} zoomControl={false} attributionControl={false} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {destination && (
          <>
            <Polyline positions={[position, [destination.lat, destination.lon]]} pathOptions={{ color: "#141613", weight: 3, opacity: 0.5, dashArray: "4 10" }} />
            <Marker position={[destination.lat, destination.lon]} icon={destinationIcon} />
          </>
        )}
        {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: "#d9541e", weight: 4, opacity: 0.9 }} />}
        <Marker position={position} icon={truckIcon({ live, alert, selected: true })} />
        <FollowMe position={position} />
      </MapContainer>
    </div>
  );
}
