import { useState } from "react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { drivers, getDriverForDate, getTodayDate } from "./data";
import { demoEmail } from "./lib/fleet";

const incidentDriverId = getDriverForDate(getTodayDate()).id;

export default function LoginPage({ onLogin, isEnteringApp }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      setError("Login worked, but the profile was not found.");
      setLoading(false);
      return;
    }

    onLogin(profile);
    setLoading(false);
  }

  return (
    <main className={`login-page ${isEnteringApp ? "login-leaving" : ""}`}>
      <section className="login-visual">
        <div className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}intelliops-logo.jpg`} alt="" />
          <div className="brand-text">
            <span className="brand-name">IntelliOps</span>
            <span className="brand-sub" style={{ color: "#a3a8a0" }}>Cold Chain Guardian</span>
          </div>
        </div>

        <img className="login-art" src={`${import.meta.env.BASE_URL}intelliops-logo.jpg`} alt="IntelliOps guardian emblem" />

        <div>
          <h2>Protect every shipment before it is too late.</h2>
          <p>
            IntelliOps connects live signals, field teams and recovery decisions in one
            cold-chain workspace — with a human approving every action.
          </p>
        </div>

        <div className="login-tags">
          <span>Temperature aware</span>
          <span>Driver connected</span>
          <span>Recovery ready</span>
        </div>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="eyebrow">Sign in</span>
            <h1>Welcome back</h1>
            <p className="muted" style={{ fontSize: 14 }}>
              Coordinators land in the operations cockpit; drivers see their live instructions.
            </p>
          </div>

          <label className="field">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="field">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="btn btn-dark btn-lg btn-block" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {isSupabaseConfigured ? (
            <p className="form-hint">Coordinator and driver accounts are enabled.</p>
          ) : (
            <div className="demo-box">
              <strong>Demo mode — no Supabase keys in .env</strong>
              <span>Pick an account; any password works. Open drivers in other tabs to see approvals arrive live.</span>
              <div className="demo-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setEmail("meera@intelliops.demo");
                    setPassword("demo");
                  }}
                >
                  Coordinator · Meera
                </button>
              </div>
              <span style={{ marginTop: 4, fontWeight: 600 }}>Drivers</span>
              <div className="demo-actions">
                {drivers.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`btn btn-outline btn-sm ${d.id === incidentDriverId ? "incident-driver" : ""}`}
                    title={d.id === incidentDriverId ? `${d.name} carries CN-24018 today` : `${d.name} · ${d.vehicle}`}
                    onClick={() => {
                      setEmail(demoEmail(d));
                      setPassword("demo");
                    }}
                  >
                    {d.name.split(" ")[0]}
                    {d.id === incidentDriverId && " · CN-24018"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
