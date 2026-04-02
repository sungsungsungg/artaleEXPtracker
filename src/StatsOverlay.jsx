import { useEffect, useState } from "react";
import "./overlay.css";

const defaultStats = {
  currentExp: "0",
  gainedExp: "0",
  duration: "00:00",
  expPercent: "0%",
  exp10min: "0",
  timeLeftForLevel: "Not Measured",
  status: "Idle",
};

function isInactiveValue(value) {
  const text = String(value ?? "");
  return (
    text === "" ||
    /NOT STARTED|NOT MEASURED|READING/i.test(text) ||
    text === "0"
  );
}

function PrimaryMetric({ label, value, emphasize = false }) {
  const inactive = isInactiveValue(value);
  return (
    <article className={`pip-metric ${inactive ? "pip-metric-inactive" : ""}`}>
      <p className="pip-label">{label}</p>
      <p className={`pip-value ${emphasize && !inactive ? "pip-value-accent" : ""}`}>
        {value}
      </p>
    </article>
  );
}

function SecondaryMetric({ label, value }) {
  const inactive = isInactiveValue(value);
  return (
    <div className="pip-secondary-row">
      <span className="pip-secondary-label">{label}</span>
      <span className={`pip-secondary-value ${inactive ? "pip-secondary-inactive" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default function StatsOverlay({
  stats: incomingStats,
  trackingStatus = "idle",
  canStart = false,
  canContinue = false,
  canReset = false,
  onStart,
  onStop,
  onContinue,
  onReset,
}) {
  const [stats, setStats] = useState(incomingStats || defaultStats);

  useEffect(() => {
    if (!incomingStats) return;
    setStats(incomingStats);
  }, [incomingStats]);

  useEffect(() => {
    if (incomingStats) return undefined;

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event?.data?.type !== "STATS_UPDATE") return;
      if (event?.data?.payload) {
        setStats((prev) => ({ ...prev, ...event.data.payload }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [incomingStats]);

  return (
    <main className="pip-root">
      <header className="pip-header">
        <div>
          <h1 className="pip-title">EXP Tracker</h1>
          <p className="pip-subtitle">Floating Stats</p>
        </div>
        <span className="pip-status">{stats.status || "Idle"}</span>
      </header>

      <section className="pip-primary-grid">
        <PrimaryMetric
          label="Current EXP"
          value={stats.currentExp}
          emphasize
        />
        <PrimaryMetric label="Gained EXP" value={stats.gainedExp} />
        <PrimaryMetric label="Duration" value={stats.duration} />
        <PrimaryMetric label="EXP %" value={stats.expPercent} />
      </section>

      <section className="pip-secondary">
        <SecondaryMetric label="10min EXP" value={stats.exp10min} />
        <SecondaryMetric label="Time Left" value={stats.timeLeftForLevel} />
      </section>

      <section className="pip-controls">
        {trackingStatus === "idle" && (
          <button
            className="pip-control-btn pip-control-start"
            onClick={onStart}
            disabled={!canStart}
          >
            Start
          </button>
        )}

        {trackingStatus === "running" && (
          <button className="pip-control-btn pip-control-stop" onClick={onStop}>
            Stop
          </button>
        )}

        {trackingStatus === "paused" && (
          <>
            <button
              className="pip-control-btn pip-control-continue"
              onClick={onContinue}
              disabled={!canContinue}
            >
              Continue
            </button>
          </>
        )}
        <button
          className="pip-control-btn pip-control-reset"
          onClick={onReset}
          disabled={!canReset}
        >
          Reset
        </button>
      </section>
    </main>
  );
}
