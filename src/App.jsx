import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ScreenShare from "./utils/screenShare";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import ContentCard from "./utils/ContentCard.jsx";
import StatsOverlay from "./StatsOverlay.jsx";
import usePip from "./hooks/usePip";
import { useI18n } from "./i18n/LanguageContext.jsx";
import LanguageToggle from "./components/LanguageToggle.jsx";

function App() {
  const { t } = useI18n();
  const [previewExp, setPreviewExp] = useState(null);
  const [previewPercent, setPreviewPercent] = useState(null);
  const [sessionStartExp, setSessionStartExp] = useState(null);
  const [sessionCurrentExp, setSessionCurrentExp] = useState(null);
  const [sessionStartPercent, setSessionStartPercent] = useState(0);
  const [trackingStatus, setTrackingStatus] = useState("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasCropRegion, setHasCropRegion] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const {
    isSupported: isPipSupported,
    mountNode: pipMountNode,
    openPip,
  } = usePip({
    width: 380,
    height: 300,
    title: t("floatingStats"),
  });

  // ---- utils ----
  function numberWithCommas(x) {
    if (x === null || x === undefined) return "0";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function twoDigits(n) {
    return String(n).padStart(2, "0");
  }

  // ---- derived values (safe guards) ----
  const second = Math.floor(elapsedSeconds % 60);
  const minute = Math.floor(elapsedSeconds / 60);
  const isRunning = trackingStatus === "running";
  const isPaused = trackingStatus === "paused";
  const isIdle = trackingStatus === "idle";
  const hasValidPreviewExp =
    typeof previewExp === "number" && Number.isFinite(previewExp);
  const hasSession = typeof sessionStartExp === "number";
  const currentSessionExp = hasSession
    ? (isRunning ? previewExp : sessionCurrentExp) ?? sessionCurrentExp
    : null;

  const expGained = hasSession
    ? Number(currentSessionExp ?? sessionStartExp) - Number(sessionStartExp)
    : 0;
  const timeSpent = elapsedSeconds;

  // exp/sec
  const expPerSec = timeSpent > 0 ? expGained / timeSpent : 0;

  // (optional) 10-min estimate
  const expRate = expPerSec > 0 ? expPerSec * 600 : 0;

  // freeze percent at start
  const p0 = Number(sessionStartPercent); // initial percent (0..100)
  const E0 = Number(sessionStartExp ?? 0); // initial exp-in-level

  // estimate total exp needed for the level from initial snapshot
  const totalExpToLevel = p0 > 0 ? (E0 * 100) / p0 : 0;

  // estimated current exp-in-level using only gained exp
  const currentExpEst = E0 + expGained;

  // remaining exp
  const leftOverExpToLevel = Math.max(0, totalExpToLevel - currentExpEst);

  // seconds remaining
  const timeLeftSec = expPerSec > 0 ? leftOverExpToLevel / expPerSec : 0;

  // split
  const hourToLevel = Math.floor(timeLeftSec / 3600);
  const minuteToLevel = Math.floor((timeLeftSec % 3600) / 60);
  const secondToLevel = Math.floor(timeLeftSec % 60);
  const hasTimeToLevel =
    timeLeftSec && Number.isFinite(timeLeftSec) && timeLeftSec > 0;
  const canReset = hasSession || elapsedSeconds > 0 || !isIdle;
  const sessionStatusLabel = t(trackingStatus);
  const floatingStatsPayload = useMemo(
    () => ({
      currentExp: numberWithCommas(previewExp ?? 0),
      gainedExp: hasSession ? numberWithCommas(expGained) : t("notStarted"),
      duration: `${twoDigits(minute)}:${twoDigits(second)}`,
      expPercent: hasSession ? `${sessionStartPercent}%` : t("notStarted"),
      exp10min: expRate ? numberWithCommas(expRate.toFixed(0)) : t("notMeasured"),
      timeLeftForLevel: hasTimeToLevel
        ? `${hourToLevel >= 100 ? hourToLevel : twoDigits(hourToLevel)}:${twoDigits(minuteToLevel)}:${twoDigits(secondToLevel)}`
        : t("notMeasured"),
      status: sessionStatusLabel,
    }),
    [
      previewExp,
      hasSession,
      expGained,
      minute,
      second,
      sessionStartPercent,
      expRate,
      hasTimeToLevel,
      hourToLevel,
      minuteToLevel,
      secondToLevel,
      sessionStatusLabel,
      t,
    ],
  );

  useEffect(() => {
    if (!isRunning) return undefined;
    const intervalId = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(intervalId);
  }, [isRunning]);

  const handleStart = () => {
    if (!hasValidPreviewExp) return;
    setSessionStartExp(previewExp);
    setSessionCurrentExp(previewExp);
    setSessionStartPercent(
      typeof previewPercent === "number" && Number.isFinite(previewPercent)
        ? previewPercent
        : 0,
    );
    setElapsedSeconds(0);
    setTrackingStatus("running");
  };

  const handleStop = () => {
    setTrackingStatus("paused");
  };

  const handleContinue = () => {
    setTrackingStatus("running");
  };

  const handleReset = () => {
    if (isRunning) {
      setSessionStartExp(hasValidPreviewExp ? previewExp : null);
      setSessionCurrentExp(hasValidPreviewExp ? previewExp : null);
      setSessionStartPercent(
        hasValidPreviewExp &&
          typeof previewPercent === "number" &&
          Number.isFinite(previewPercent)
          ? previewPercent
          : 0,
      );
      setElapsedSeconds(0);
      setTrackingStatus("running");
      return;
    }

    setTrackingStatus("idle");
    setSessionStartExp(null);
    setSessionCurrentExp(null);
    setSessionStartPercent(0);
    setElapsedSeconds(0);
  };

  const handleReading = ({ expNumber, pct }) => {
    if (typeof expNumber === "number" && Number.isFinite(expNumber)) {
      setPreviewExp(expNumber);
      if (isRunning) {
        setSessionCurrentExp(expNumber);
      }
    }
    if (typeof pct === "number" && Number.isFinite(pct)) {
      setPreviewPercent(pct);
    }
  };

  const handleShareStopped = () => {
    setHasStream(false);
    if (isRunning) {
      setTrackingStatus("paused");
    }
  };

  return (
    <>
      <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">{t("appTitle")}</h1>
          <p className="dashboard-subtitle">{t("appSubtitle")}</p>
        </div>
        <div className="header-actions">
          <LanguageToggle />
          <span className={`status-badge status-${trackingStatus}`}>
            {sessionStatusLabel}
          </span>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>{t("sessionMetrics")}</h2>
          <p>{t("sessionMetricsDesc")}</p>
        </div>
        <div className="metrics-grid metrics-grid-primary">
          <ContentCard
            title={t("currentExp")}
            content={hasValidPreviewExp ? numberWithCommas(previewExp) : t("readingOcr")}
            priority="primary"
            muted={!hasValidPreviewExp}
          />
          <ContentCard
            title={t("gainedExp")}
            content={hasSession ? numberWithCommas(expGained) : t("notStarted")}
            priority="primary"
            muted={!hasSession}
          />
          <ContentCard
            title={t("exp10min")}
            content={expRate ? numberWithCommas(expRate.toFixed(0)) : t("notMeasured")}
            priority="primary"
            muted={!expRate}
          />
          <ContentCard
            title={t("duration")}
            content={`${twoDigits(minute)}:${twoDigits(second)}`}
            priority="primary"
          />
        </div>

        <div className="metrics-grid metrics-grid-secondary">
          <ContentCard
            title={t("expPercent")}
            content={hasSession ? `${sessionStartPercent}%` : t("notStarted")}
            muted={!hasSession}
          />
          <ContentCard
            title={t("startingExp")}
            content={hasSession ? numberWithCommas(sessionStartExp) : t("notStarted")}
            muted={!hasSession}
          />
          <ContentCard
            title={t("startingExpPercent")}
            content={hasSession ? `${sessionStartPercent}%` : t("notStarted")}
            muted={!hasSession}
          />
          <ContentCard
            title={t("timeLeftForLevel")}
            content={
              hasTimeToLevel
                ? `${hourToLevel >= 100 ? hourToLevel : twoDigits(hourToLevel)}:${twoDigits(minuteToLevel)}:${twoDigits(secondToLevel)}`
                : t("notMeasured")
            }
            muted={!hasTimeToLevel}
          />
        </div>
      </section>

      <section className="panel controls-panel">
        <div className="panel-header">
          <h2>{t("sessionControls")}</h2>
          <p>{t("sessionControlsDesc")}</p>
        </div>
        <div className="controls-row">
          <button
            className="control-btn control-btn-overlay"
            onClick={openPip}
            disabled={!isPipSupported}
          >
            {t("openFloatingStats")}
          </button>
          {isIdle && (
            <button
              className="control-btn control-btn-start"
              onClick={handleStart}
              disabled={!hasStream || !hasCropRegion || !hasValidPreviewExp}
            >
              {t("start")}
            </button>
          )}
          {isRunning && (
            <button className="control-btn control-btn-stop" onClick={handleStop}>
              {t("stop")}
            </button>
          )}
          {isPaused && (
            <>
              <button
                className="control-btn control-btn-continue"
                onClick={handleContinue}
                disabled={!hasStream}
              >
                {t("continue")}
              </button>
            </>
          )}
          <button
            className="control-btn control-btn-reset"
            onClick={handleReset}
            disabled={!canReset}
          >
            {t("reset")}
          </button>
        </div>
      </section>

      <section className="panel capture-panel">
        <div className="panel-header">
          <h2>{t("capturePreview")}</h2>
          <p>{t("capturePreviewDesc")}</p>
        </div>
        <ScreenShare
          onReading={handleReading}
          onRegionChange={setHasCropRegion}
          onStreamChange={setHasStream}
          onShareStopped={handleShareStopped}
        />
      </section>

      <section className="panel help-panel">
        <p className="help-copy">
          {t("help1")} <br />
          {t("help2")} <br />
          {t("help3")} <br />
          {t("help4")} <br />
          {t("help5")} <br />
          {t("help6")}
        </p>
      </section>
      </main>
      {pipMountNode
        ? createPortal(
            <StatsOverlay
              stats={floatingStatsPayload}
              trackingStatus={trackingStatus}
              canStart={isIdle && hasStream && hasCropRegion && hasValidPreviewExp}
              canContinue={isPaused && hasStream}
              canReset={canReset}
              onStart={handleStart}
              onStop={handleStop}
              onContinue={handleContinue}
              onReset={handleReset}
            />,
            pipMountNode,
          )
        : null}
    </>
  );
}

export default App;
