import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChartLine,
  CircleCheck,
  LayoutGrid,
  LogOut,
  Package,
  RotateCcw,
  Thermometer,
  Truck,
} from "lucide-react";
import LoginPage from "./LoginPage";
import DriverDashboard from "./DriverDashboard";
import LiveMap from "./LiveMap";
import Cockpit from "./screens/Cockpit";
import Incident from "./screens/Incident";
import Recovery from "./screens/Recovery";
import Evidence from "./screens/Evidence";
import History from "./screens/History";
import { supabase } from "./lib/supabase";
import {
  approveRecovery as approveInSap,
  resetSapDemo,
  simulateExcursion,
} from "./lib/sap";
import { getDriverForDate, getTodayDate, initialsOf, recoveryOptions } from "./data";
import { INCIDENT_SHIPMENT, resolveIncident } from "./lib/fleet";
import "./index.css";

const NAV_ITEMS = [
  { id: "dashboard", label: "Cockpit", Icon: LayoutGrid },
  { id: "incident", label: "Incident", Icon: Thermometer },
  { id: "map", label: "Live map", Icon: Truck },
  { id: "recovery", label: "Recovery", Icon: Package },
  { id: "evidence", label: "Evidence", Icon: ChartLine },
  { id: "history", label: "History", Icon: CalendarDays },
];

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [screen, setScreen] = useState("dashboard");
  const [selectedOption, setSelectedOption] = useState(null);
  const [approved, setApproved] = useState(false);
  const [driverContacted, setDriverContacted] = useState(false);
  const [driverAlertSent, setDriverAlertSent] = useState(false);
  const todayDate = getTodayDate();
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [draftDate, setDraftDate] = useState(todayDate);
  const [simulationStarted, setSimulationStarted] = useState(false);
  const [agentMessages, setAgentMessages] = useState([]);
  const [sapSimulation, setSapSimulation] = useState(null);
  const [sapApproval, setSapApproval] = useState(null);
  const [sapError, setSapError] = useState(null);
  const [acknowledgementMessage, setAcknowledgementMessage] = useState(null);
  const [isEnteringApp, setIsEnteringApp] = useState(false);
  const [incident, setIncident] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const simulationTimers = useRef([]);

  // Session + profile.
  useEffect(() => {
    async function loadSession() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      setSession(currentSession);

      if (currentSession?.user) {
        const { data: currentProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", currentSession.user.id)
          .single();

        setProfile(currentProfile);
      }

      setAuthLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Driver acknowledgements.
  useEffect(() => {
    const channel = supabase
      .channel("coordinator-recovery-updates")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "recovery_instructions" },
        (payload) => {
          if (payload.new.status === "ACKNOWLEDGED") {
            setAcknowledgementMessage(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => () => simulationTimers.current.forEach(clearTimeout), []);

  // Who carries the CN-24018 incident, looked up in the database (works with
  // any Supabase project and with the demo database).
  useEffect(() => {
    if (profile?.role !== "coordinator") return undefined;
    let active = true;
    resolveIncident(supabase, getDriverForDate(selectedDate)).then((result) => {
      if (active) setIncident(result);
    });
    return () => {
      active = false;
    };
  }, [profile?.role, selectedDate]);

  async function approveRecovery() {
    if (!selectedOption) {
      return;
    }

    const target = await resolveIncident(supabase, getDriverForDate(selectedDate));
    const activeDriverId = target.driverId;
    const shipmentId = target.shipmentId;

    if (!activeDriverId || !shipmentId) {
      alert("No driver or shipment is assigned for this date.");
      return;
    }

    const selectedRecovery = recoveryOptions.find(
      (option) => option.id === selectedOption
    );

    if (!selectedRecovery) {
      return;
    }

    const instruction =
      selectedRecovery.id === "DIVERT_REICE"
        ? "Divert to the nearest cold-storage facility and re-ice the shipment."
        : selectedRecovery.name;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      alert("Please sign in before approving recovery.");
      return;
    }

    const { error } = await supabase.from("recovery_instructions").insert({
      driver_id: activeDriverId,
      shipment_id: shipmentId,
      instruction,
      status: "SENT",
      created_by: user.id,
    });

    if (error) {
      console.error("SUPABASE INSERT ERROR", error);
      alert(
        `Supabase error\n\n` +
          `Code: ${error.code ?? "none"}\n` +
          `Message: ${error.message ?? "none"}\n` +
          `Details: ${error.details ?? "none"}\n` +
          `Hint: ${error.hint ?? "none"}`
      );
      return;
    }

    // SAP: complete the Build Process Automation task and raise the S/4HANA order.
    try {
      const approval = await sapApprove(selectedRecovery.id);
      setSapApproval(approval);
      setSapError(null);
    } catch (sapFailure) {
      console.error("SAP approval failed:", sapFailure);
      setSapError(sapFailure.message);
    }

    setApproved(true);
  }

  async function sapApprove(option) {
    const request = { shipment: "CN-24018", option, approver: profile?.full_name ?? "Coordinator" };
    try {
      return await approveInSap(request);
    } catch (error) {
      if (error.status !== 409) throw error;
      // No open excursion yet (the event was never simulated): detect it first.
      const simulation = await simulateExcursion("CN-24018");
      setSapSimulation(simulation);
      return approveInSap(request);
    }
  }

  function clearSimulation() {
    simulationTimers.current.forEach(clearTimeout);
    simulationTimers.current = [];
    setSimulationStarted(false);
    setAgentMessages([]);
    setSapError(null);
  }

  function resetDemo() {
    const today = getTodayDate();
    clearSimulation();
    setScreen("dashboard");
    setSelectedOption(null);
    setApproved(false);
    setDriverContacted(false);
    setDriverAlertSent(false);
    setSelectedDate(today);
    setDraftDate(today);
    setAcknowledgementMessage(null);
    setSapSimulation(null);
    setSapApproval(null);
    resetSapDemo().catch((error) => console.error("SAP reset failed:", error));
    if (supabase.isDemo) {
      supabase.resetDemoData();
      resolveIncident(supabase, getDriverForDate(today)).then(setIncident);
    }
  }

  function applyDate() {
    if (draftDate) {
      setSelectedDate(draftDate);
      setDriverContacted(false);
      setDriverAlertSent(false);
    }
  }

  async function toggleSimulation() {
    if (simulationStarted) {
      clearSimulation();
      return;
    }

    setScreen("dashboard");
    setSimulationStarted(true);
    setAgentMessages([]);

    // Publishes reefer readings through Event Mesh → HANA Cloud → agents →
    // AI Core → S/4HANA PM → Build Process Automation (see btp/).
    let result;
    try {
      result = await simulateExcursion("CN-24018");
      setSapSimulation(result);
      setSapError(null);
    } catch (error) {
      console.error("SAP simulation failed:", error);
      setSapError(error.message);
      setSimulationStarted(false);
      return;
    }

    simulationTimers.current = result.steps.map((step, index) =>
      setTimeout(() => {
        setAgentMessages((current) => [...current, step]);
      }, (index + 1) * 600)
    );
  }

  async function handleLogout() {
    await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setProfile(null);
    setScreen("dashboard");
    setUserMenuOpen(false);
  }

  if (authLoading) {
    return <div className="loading-screen">Loading IntelliOps…</div>;
  }

  if (!session || !profile || isEnteringApp) {
    return (
      <LoginPage
        isEnteringApp={isEnteringApp}
        onLogin={(loggedInProfile) => {
          setIsEnteringApp(true);
          setTimeout(() => {
            setProfile(loggedInProfile);
            setIsEnteringApp(false);
          }, 700);
        }}
      />
    );
  }

  if (profile.role === "driver") {
    return <DriverDashboard profile={profile} onLogout={handleLogout} />;
  }

  const coordinatorName = profile.full_name ?? "Meera Raghavan";
  const assignedDriver = incident?.driver ?? getDriverForDate(selectedDate);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}intelliops-logo.jpg`} alt="" />
          <div className="brand-text">
            <span className="brand-name">IntelliOps</span>
            <span className="brand-sub">Cold Chain Guardian</span>
          </div>
        </div>

        <nav className="nav-pill" aria-label="Primary">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-link ${screen === id ? "active" : ""}`}
              aria-current={screen === id ? "page" : undefined}
              aria-label={label}
              title={label}
              onClick={() => setScreen(id)}
            >
              <Icon size={screen === id ? 16 : 18} strokeWidth={1.9} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="top-actions">
          <span className="live-chip">LIVE</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={
              acknowledgementMessage
                ? "Notifications: driver acknowledged"
                : "Notifications"
            }
            onClick={() => acknowledgementMessage && setScreen("evidence")}
          >
            <Bell size={18} strokeWidth={1.8} />
            {acknowledgementMessage && <span className="dot" />}
          </button>

          <div className="user-menu">
            <button
              type="button"
              className="user-chip"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className="avatar">{initialsOf(coordinatorName)}</span>
              <span className="user-meta">
                <span className="user-name">{coordinatorName}</span>
                <span className="user-role">Coordinator</span>
              </span>
            </button>

            {userMenuOpen && (
              <div className="menu-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    resetDemo();
                    setUserMenuOpen(false);
                  }}
                >
                  <RotateCcw size={16} /> Reset demo
                </button>
                <button type="button" role="menuitem" onClick={handleLogout}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {acknowledgementMessage && (
        <div className="banner lime" role="status">
          <CircleCheck size={22} />
          <div className="banner-text">
            <strong>Driver acknowledged the recovery instruction</strong>
            <span>{acknowledgementMessage.instruction}</span>
          </div>
          <button
            type="button"
            className="btn btn-dark btn-sm"
            onClick={() => setAcknowledgementMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <main key={screen} className="screen">
        {screen === "dashboard" && (
          <Cockpit
            selectedDate={selectedDate}
            draftDate={draftDate}
            setDraftDate={setDraftDate}
            applyDate={applyDate}
            assignedDriver={assignedDriver}
            simulationStarted={simulationStarted}
            agentMessages={agentMessages}
            totalSteps={sapSimulation?.steps?.length ?? 0}
            sapError={sapError}
            onSimulate={toggleSimulation}
            onNavigate={setScreen}
          />
        )}

        {screen === "incident" && (
          <Incident
            driver={assignedDriver}
            onNavigate={setScreen}
            driverContacted={driverContacted}
            setDriverContacted={setDriverContacted}
            driverAlertSent={driverAlertSent}
            setDriverAlertSent={setDriverAlertSent}
            sapSimulation={sapSimulation}
            sapApproval={sapApproval}
          />
        )}

        {screen === "map" && (
          <LiveMap
            incidentShipment={INCIDENT_SHIPMENT}
            incidentDriver={assignedDriver}
            onNavigate={setScreen}
          />
        )}

        {screen === "recovery" && (
          <Recovery
            driver={assignedDriver}
            coordinatorName={coordinatorName}
            selectedOption={selectedOption}
            setSelectedOption={setSelectedOption}
            approved={approved}
            onApprove={approveRecovery}
            sapApproval={sapApproval}
            sapError={sapError}
            onNavigate={setScreen}
          />
        )}

        {screen === "evidence" && (
          <Evidence
            selectedOption={selectedOption}
            approved={approved}
            coordinatorName={coordinatorName}
            acknowledged={Boolean(acknowledgementMessage)}
            sapSimulation={sapSimulation}
            sapApproval={sapApproval}
            onNavigate={setScreen}
          />
        )}

        {screen === "history" && (
          <History
            selectedDate={selectedDate}
            draftDate={draftDate}
            setDraftDate={setDraftDate}
            applyDate={applyDate}
            onNavigate={setScreen}
          />
        )}
      </main>
    </div>
  );
}

export default App;
