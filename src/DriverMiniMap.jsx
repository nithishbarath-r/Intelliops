import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import {
  DESTINATION,
  ORIGIN,
  ROUTE,
  TILE_ATTRIBUTION,
  TILE_URL,
  motion,
} from "./lib/liveTracking";
import { destinationIcon, originIcon, truckIcon } from "./lib/mapIcons";

function Follow({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat == null) return;
    if (map.getZoom() < 12) map.setView([lat, lng], 14);
    else map.panTo([lat, lng], { animate: true });
  }, [lat, lng, map]);
  return null;
}

// Small map on the driver's screen: own position, trail and the route.
export default function DriverMiniMap({ location, trail, live }) {
  const lat = location?.latitude;
  const lng = location?.longitude;
  const { heading } = motion(trail);

  return (
    <div className="driver-mini-map">
      <MapContainer
        center={lat != null ? [lat, lng] : [11.4, 79.2]}
        zoom={lat != null ? 14 : 7}
        scrollWheelZoom={false}
        className="driver-mini-map-canvas"
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <Polyline
          positions={ROUTE}
          pathOptions={{ color: "#94a3b8", weight: 4, dashArray: "8 10" }}
        />
        {trail.length > 1 && (
          <Polyline
            positions={trail.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#2563eb", weight: 5 }}
          />
        )}
        <Marker position={ORIGIN.position} icon={originIcon} />
        <Marker position={DESTINATION.position} icon={destinationIcon} />
        {lat != null && (
          <Marker position={[lat, lng]} icon={truckIcon({ live, heading })} />
        )}
        <Follow lat={lat} lng={lng} />
      </MapContainer>
      {lat == null && (
        <div className="driver-mini-map-empty">
          Start live tracking to see your truck on the map
        </div>
      )}
    </div>
  );
}
