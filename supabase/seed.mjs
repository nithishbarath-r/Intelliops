#!/usr/bin/env node
/**
 * Create the IntelliOps demo accounts and data in YOUR Supabase project.
 *
 *   1. Run supabase/migrations/001_intelliops_schema.sql in the SQL editor.
 *   2. In PowerShell (project folder):
 *        $env:SUPABASE_URL="https://xxxx.supabase.co"
 *        $env:SUPABASE_SERVICE_ROLE_KEY="service-role-key"   # Settings → API (keep it secret!)
 *        node supabase/seed.mjs
 *
 * Creates (or reuses) 1 coordinator + the 5 drivers from the original app,
 * all with password DEMO_PASSWORD (default IntelliOps@2026), and one
 * shipment per driver. Raghul carries the CN-24018 incident.
 * Safe to run again: existing users are reused, rows are upserted.
 */
import { createClient } from "@supabase/supabase-js";
import { drivers } from "../src/data.js";
import { demoEmail, DRIVER_TRIPS, INCIDENT_TRIP } from "../src/lib/fleet.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD || "IntelliOps@2026";
const incidentDriverId = process.env.INCIDENT_DRIVER || "driver-1";

if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (see the comment at the top of this file).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(email, fullName) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (!error) return data.user;
  const existing = await findUserByEmail(email);
  if (existing) return existing;
  throw error;
}

async function main() {
  const accounts = [
    { email: "meera@intelliops.demo", role: "coordinator", full_name: "Meera Raghavan", phone: "+919000000000", vehicle_number: null },
    ...drivers.map((d) => ({ email: demoEmail(d), role: "driver", full_name: d.name, phone: d.phone, vehicle_number: d.vehicle, localId: d.id })),
  ];

  const ids = {};
  for (const account of accounts) {
    const user = await ensureUser(account.email, account.full_name);
    ids[account.localId ?? "coordinator"] = user.id;
    const { error } = await admin.from("profiles").upsert(
      { id: user.id, role: account.role, full_name: account.full_name, phone: account.phone, vehicle_number: account.vehicle_number },
      { onConflict: "id" }
    );
    if (error) throw error;
    console.log(`✓ ${account.role.padEnd(11)} ${account.email}`);
  }

  const now = new Date().toISOString();
  const shipments = drivers.map((d) => {
    const trip = d.id === incidentDriverId ? INCIDENT_TRIP : DRIVER_TRIPS[d.id];
    return {
      shipment_number: trip.number,
      driver_id: ids[d.id],
      status: d.id === incidentDriverId ? "ACTION_REQUIRED" : "IN_TRANSIT",
      temperature: trip.temperature,
      origin: trip.origin,
      destination: trip.destination,
      current_latitude: trip.position.lat,
      current_longitude: trip.position.lon,
      location_accuracy: 12,
      location_shared_at: now,
      tracking_status: "LIVE",
      last_seen_at: now,
      last_seen_status: "GPS_CONNECTED",
    };
  });

  const { error: shipError } = await admin.from("shipments").upsert(shipments, { onConflict: "shipment_number" });
  if (shipError) throw shipError;
  console.log(`✓ ${shipments.length} shipments (CN-24018 → ${drivers.find((d) => d.id === incidentDriverId).name})`);

  console.log(`\nDone. Sign in with any account above and password: ${password}`);
}

main().catch((error) => {
  console.error("Seed failed:", error.message ?? error);
  process.exit(1);
});
