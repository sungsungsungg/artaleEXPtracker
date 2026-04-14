import { useEffect, useMemo, useState } from "react";
import "./overlay.css";
import { useI18n } from "./i18n/LanguageContext.jsx";

function isInactiveValue(value) {
  const text = String(value ?? "");
  return (
    text === "" ||
    /NOT STARTED|NOT MEASURED|READING|측정 전|측정 안 됨|읽는 중/i.test(text) ||
    text === "0"
  );
}

function PrimaryMetric({ label, value, emphasize = false, highlight = false }) {
  const inactive = isInactiveValue(value);
  return (
    <article
      className={`pip-metric ${inactive ? "pip-metric-inactive" : ""} ${highlight ? "pip-metric-highlight" : ""}`}
    >
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
  buffReminder,
  captureAlert = "",
}) {
  const { t } = useI18n();
  const defaultStats = useMemo(
    () => ({
      currentExp: "0",
      gainedExp: "0",
      duration: "00:00",
      expPercent: "0%",
      exp10min: "0",
      timeLeftForLevel: t("notMeasured"),
      status: t("idle"),
      buffCountdown: "00:00",
      buffStatus: t("buffIdle"),
      buffIsDue: false,
    }),
    [t],
  );
  const [stats, setStats] = useState(incomingStats || defaultStats);

  useEffect(() => {
    if (!incomingStats) return;
    setStats(incomingStats);
  }, [incomingStats]);

  useEffect(() => {
    if (incomingStats) return;
    setStats((prev) => ({
      ...defaultStats,
      ...prev,
      timeLeftForLevel: prev.timeLeftForLevel ?? defaultStats.timeLeftForLevel,
      status: prev.status ?? defaultStats.status,
    }));
  }, [defaultStats, incomingStats]);

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
          <h1 className="pip-title">{t("appTitle")}</h1>
          <p className="pip-subtitle">{t("floatingStats")}</p>
        </div>
        <span className="pip-status">{stats.status || t("idle")}</span>
      </header>

      {captureAlert ? (
        <div className="pip-capture-alert">{captureAlert}</div>
      ) : null}

      <section className="pip-primary-grid">
        <PrimaryMetric label={t("currentExp")} value={stats.currentExp} emphasize />
        <PrimaryMetric label={t("gainedExp")} value={stats.gainedExp} />
        <PrimaryMetric
          label={t("exp10min")}
          value={stats.exp10min}
          emphasize
        />
        <PrimaryMetric label={t("duration")} value={stats.duration} />
      </section>

      <section className="pip-secondary">
        <SecondaryMetric label={t("expPercent")} value={stats.expPercent} />
        <SecondaryMetric label={t("timeLeft")} value={stats.timeLeftForLevel} />
      </section>

      <section className={`pip-buff ${stats.buffIsDue ? "pip-buff-alert" : ""}`}>
        <div>
          <p className="pip-buff-label">{t("nextBuffIn")}</p>
          <p className="pip-buff-countdown">{stats.buffCountdown}</p>
        </div>
        <div className="pip-buff-side">
          <span className={`pip-buff-status ${stats.buffIsDue ? "pip-buff-status-alert" : ""}`}>
            {buffReminder?.status || stats.buffStatus}
          </span>
        </div>
      </section>

      <section className="pip-controls">
        {trackingStatus === "idle" && (
          <button
            className="pip-control-btn pip-control-start"
            onClick={onStart}
            disabled={!canStart}
          >
            {t("start")}
          </button>
        )}

        {trackingStatus === "running" && (
          <button className="pip-control-btn pip-control-stop" onClick={onStop}>
            {t("stop")}
          </button>
        )}

        {trackingStatus === "paused" && (
          <>
            <button
              className="pip-control-btn pip-control-continue"
              onClick={onContinue}
              disabled={!canContinue}
            >
              {t("continue")}
            </button>
          </>
        )}
        <button
          className="pip-control-btn pip-control-reset"
          onClick={onReset}
          disabled={!canReset}
        >
          {t("reset")}
        </button>
      </section>
    </main>
  );
}
