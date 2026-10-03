// Demo stand-in for Supabase, used only when VITE_SUPABASE_URL / KEY are missing.
// Implements the part of the supabase-js API this app uses (auth, table
// queries, realtime channels). Data lives in localStorage and changes are
// broadcast between browser tabs, so a coordinator tab and driver tabs talk
// to each other like real Supabase realtime.
//
// Tables: profiles, shipments, recovery_instructions, gps_positions
// (same shape as supabase/migrations/001_intelliops_schema.sql).

import { driverIdByLocalId, drivers, getDriverForDate, getTodayDate, shipmentByDriver } from "../data";
import { demoEmail, DRIVER_TRIPS, INCIDENT_TRIP, placeCoords } from "./fleet";

const DB_KEY = "intelliops-demo-db-v2";
const SESSION_KEY = "intelliops-demo-session";
const COORDINATOR_ID = "demo-coordinator";
const GPS_LIMIT = 3000;
const TABLES = ["profiles", "shipments", "recovery_instructions", "gps_positions"];

function storageGet(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage: keep working in memory */
  }
}

function assignedLocalDriver() {
  return getDriverForDate(getTodayDate());
}

function seed() {
  const assigned = assignedLocalDriver();
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  const profiles = [
    { id: COORDINATOR_ID, role: "coordinator", full_name: "Meera Raghavan", email: "meera@intelliops.demo", phone: "+919000000000", vehicle_number: null },
    ...drivers.map((d) => ({
      id: driverIdByLocalId[d.id],
      role: "driver",
      full_name: d.name,
      email: demoEmail(d),
      phone: d.phone,
      vehicle_number: d.vehicle,
    })),
  ];

  const shipments = drivers.map((d, index) => {
    const uuid = driverIdByLocalId[d.id];
    const isIncident = d.id === assigned.id;
    const trip = isIncident ? INCIDENT_TRIP : DRIVER_TRIPS[d.id];
    return {
      id: shipmentByDriver[uuid],
      driver_id: uuid,
      shipment_number: trip.number,
      status: isIncident ? "ACTION_REQUIRED" : "IN_TRANSIT",
      temperature: trip.temperature,
      origin: trip.origin,
      destination: trip.destination,
      current_latitude: trip.position.lat,
      current_longitude: trip.position.lon,
      location_accuracy: 12,
      location_shared_at: iso(60000 * (index + 1)),
      current_temperature: null,
      current_humidity: null,
      weather_updated_at: null,
      tracking_status: "LIVE",
      last_seen_at: iso(20000 * (index + 1)),
      last_seen_status: "GPS_CONNECTED",
      tracking_source: "telematics",
      created_at: iso(6 * 3600000),
    };
  });

  return { version: 2, seededFor: assigned.id, profiles, shipments, recovery_instructions: [], gps_positions: [] };
}

let memoryDb = null;

function loadDb() {
  const stored = storageGet(localStorage, DB_KEY) ?? memoryDb;
  // Re-seed when the day's assigned driver changes (the incident moves with it).
  if (stored && stored.seededFor === assignedLocalDriver().id && TABLES.every((t) => Array.isArray(stored[t]))) return stored;
  const fresh = seed();
  saveDb(fresh);
  return fresh;
}

function saveDb(db) {
  memoryDb = db;
  storageSet(localStorage, DB_KEY, db);
}

// ------------------------------------------------------------------ realtime

const listeners = []; // { table, event, filter, callback }

function emitChange(table, eventType, row, old = null) {
  const subject = row ?? old;
  for (const l of listeners) {
    if (l.table !== table) continue;
    if (l.event !== "*" && l.event !== eventType) continue;
    if (l.filter) {
      const [column, rule] = l.filter.split("=");
      const expected = rule?.replace(/^eq\./, "");
      if (String(subject?.[column]) !== expected) continue;
    }
    try {
      l.callback({ eventType, new: row ?? {}, old: old ?? {} });
    } catch (error) {
      console.error(error);
    }
  }
}

function diffAndEmit(before, after) {
  for (const table of ["shipments", "recovery_instructions", "gps_positions"]) {
    const oldRows = new Map((before?.[table] ?? []).map((r) => [r.id, r]));
    const newIds = new Set();
    for (const row of after?.[table] ?? []) {
      newIds.add(row.id);
      const prev = oldRows.get(row.id);
      if (!prev) emitChange(table, "INSERT", row);
      else if (JSON.stringify(prev) !== JSON.stringify(row)) emitChange(table, "UPDATE", row, prev);
    }
    for (const [id, prev] of oldRows) if (!newIds.has(id)) emitChange(table, "DELETE", null, prev);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== DB_KEY) return;
    try {
      const before = event.oldValue ? JSON.parse(event.oldValue) : null;
      const after = event.newValue ? JSON.parse(event.newValue) : null;
      memoryDb = after;
      diffAndEmit(before, after);
    } catch {
      /* ignore */
    }
  });
}

// ------------------------------------------------------------------ queries

function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function query(table) {
  const state = { op: "select", filters: [], order: null, limit: null, single: null, payload: null, returnRows: false };

  const builder = {
    select() {
      if (state.op !== "select") state.returnRows = true;
      return builder;
    },
    insert(payload) {
      state.op = "insert";
      state.payload = payload;
      return builder;
    },
    update(payload) {
      state.op = "update";
      state.payload = payload;
      return builder;
    },
    delete() {
      state.op = "delete";
      return builder;
    },
    eq(column, value) {
      state.filters.push((row) => row[column] === value);
      return builder;
    },
    neq(column, value) {
      state.filters.push((row) => row[column] !== value);
      return builder;
    },
    in(column, values) {
      state.filters.push((row) => values.includes(row[column]));
      return builder;
    },
    gte(column, value) {
      state.filters.push((row) => row[column] >= value);
      return builder;
    },
    not(column, operator, value) {
      if (operator === "is" && value === null) state.filters.push((row) => row[column] != null);
      else state.filters.push((row) => row[column] !== value);
      return builder;
    },
    order(column, { ascending = true } = {}) {
      state.order = { column, ascending };
      return builder;
    },
    limit(n) {
      state.limit = n;
      return builder;
    },
    single() {
      state.single = "single";
      return builder;
    },
    maybeSingle() {
      state.single = "maybe";
      return builder;
    },
    then(resolve, reject) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };

  function shape(rows) {
    if (state.single) {
      if (!rows.length) {
        return state.single === "single"
          ? { data: null, error: { code: "PGRST116", message: "No rows found" } }
          : { data: null, error: null };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  function run() {
    const db = loadDb();
    const rows = db[table] ?? [];
    const matches = (row) => state.filters.every((f) => f(row));

    if (state.op === "insert") {
      const items = (Array.isArray(state.payload) ? state.payload : [state.payload]).map((item) => ({
        id: uuid(),
        created_at: new Date().toISOString(),
        ...item,
      }));
      let next = [...rows, ...items];
      if (table === "gps_positions" && next.length > GPS_LIMIT) next = next.slice(-GPS_LIMIT);
      saveDb({ ...db, [table]: next });
      items.forEach((item) => emitChange(table, "INSERT", item));
      return state.returnRows ? shape(items) : { data: null, error: null };
    }

    if (state.op === "update") {
      const updated = [];
      const nextRows = rows.map((row) => {
        if (!matches(row)) return row;
        const merged = { ...row, ...state.payload };
        updated.push({ merged, old: row });
        return merged;
      });
      saveDb({ ...db, [table]: nextRows });
      updated.forEach(({ merged, old }) => emitChange(table, "UPDATE", merged, old));
      return state.returnRows ? shape(updated.map((u) => u.merged)) : { data: null, error: null };
    }

    if (state.op === "delete") {
      const removed = rows.filter(matches);
      saveDb({ ...db, [table]: rows.filter((r) => !matches(r)) });
      removed.forEach((r) => emitChange(table, "DELETE", null, r));
      return { data: null, error: null };
    }

    let result = rows.filter(matches);
    if (state.order) {
      const { column, ascending } = state.order;
      result = [...result].sort((a, b) => {
        const av = a[column] ?? "";
        const bv = b[column] ?? "";
        return (av < bv ? -1 : av > bv ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (state.limit != null) result = result.slice(0, state.limit);
    return shape(result);
  }

  return builder;
}

// ------------------------------------------------------------------ demo helpers

/** Reset the demo database for a clean run (all tabs are notified). */
function resetDemoData() {
  const before = loadDb();
  const fresh = seed();
  saveDb(fresh);
  diffAndEmit(before, fresh);
}

/**
 * Keep the demo fleet alive: trucks not driven by a real phone creep towards
 * their destination and report in, so the fleet map looks like a live fleet.
 */
function demoFleetTick() {
  const db = loadDb();
  const now = Date.now();
  let changed = false;
  const shipments = db.shipments.map((s) => {
    const phoneActive = s.tracking_source === "driver" && now - new Date(s.last_seen_at).getTime() < 90000;
    const paused = s.tracking_status === "PAUSED";
    if (phoneActive || paused || s.current_latitude == null) return s;
    const dest = placeCoords(s.destination);
    if (!dest) return s;
    const dLat = dest.lat - s.current_latitude;
    const dLon = dest.lon - s.current_longitude;
    const dist = Math.hypot(dLat, dLon);
    if (dist < 0.004) return s;
    const step = Math.min(dist, s.status === "ACTION_REQUIRED" ? 0 : 0.0028); // incident truck is stopped near Melur
    changed = true;
    return {
      ...s,
      current_latitude: Number((s.current_latitude + (dLat / dist) * step).toFixed(6)),
      current_longitude: Number((s.current_longitude + (dLon / dist) * step).toFixed(6)),
      last_seen_at: new Date(now).toISOString(),
      location_shared_at: new Date(now).toISOString(),
    };
  });
  if (!changed) return;
  const before = db;
  const after = { ...db, shipments };
  saveDb(after);
  diffAndEmit(before, after);
}

// ------------------------------------------------------------------ auth

const authListeners = [];

function currentSession() {
  return storageGet(sessionStorage, SESSION_KEY);
}

function setSession(session) {
  storageSet(sessionStorage, SESSION_KEY, session);
  authListeners.forEach((cb) => cb(session ? "SIGNED_IN" : "SIGNED_OUT", session));
}

/** Pick the demo profile for an email: a driver's name, "driver", or the coordinator. */
function profileForEmail(db, email) {
  const value = email.trim().toLowerCase();
  const exact = db.profiles.find((p) => p.email === value);
  if (exact) return exact;
  const byName = db.profiles.find((p) => p.role === "driver" && value.startsWith(p.full_name.split(" ")[0].toLowerCase()));
  if (byName) return byName;
  if (/driver/.test(value)) {
    const assignedId = driverIdByLocalId[assignedLocalDriver().id];
    return db.profiles.find((p) => p.id === assignedId);
  }
  return db.profiles.find((p) => p.role === "coordinator");
}

export function createDemoClient() {
  return {
    isDemo: true,
    resetDemoData,
    demoFleetTick,
    auth: {
      async getSession() {
        return { data: { session: currentSession() }, error: null };
      },
      async getUser() {
        const session = currentSession();
        return { data: { user: session?.user ?? null }, error: session ? null : { message: "Not signed in" } };
      },
      async signInWithPassword({ email, password }) {
        if (!email || !password) return { data: null, error: { message: "Enter an email and any password." } };
        const profile = profileForEmail(loadDb(), email);
        const session = { user: { id: profile.id, email }, access_token: "demo" };
        setSession(session);
        return { data: { user: session.user, session }, error: null };
      },
      async signOut() {
        setSession(null);
        return { error: null };
      },
      onAuthStateChange(callback) {
        authListeners.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                const i = authListeners.indexOf(callback);
                if (i > -1) authListeners.splice(i, 1);
              },
            },
          },
        };
      },
    },
    from: query,
    channel() {
      const own = [];
      const channel = {
        on(_type, { event = "*", table, filter }, callback) {
          const listener = { table, event, filter, callback };
          own.push(listener);
          listeners.push(listener);
          return channel;
        },
        subscribe(callback) {
          if (typeof callback === "function") callback("SUBSCRIBED");
          return channel;
        },
        _remove() {
          own.forEach((l) => {
            const i = listeners.indexOf(l);
            if (i > -1) listeners.splice(i, 1);
          });
        },
      };
      return channel;
    },
    removeChannel(channel) {
      channel?._remove?.();
    },
  };
}
