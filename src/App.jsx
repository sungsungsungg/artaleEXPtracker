import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ScreenShare from "./utils/screenShare";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import ContentCard from "./utils/ContentCard.jsx";
import StatsOverlay from "./StatsOverlay.jsx";
import usePip from "./hooks/usePip";
import { useI18n } from "./i18n/LanguageContext.jsx";
import LanguageToggle from "./components/LanguageToggle.jsx";

const DEFAULT_BUFF_INTERVAL_SECONDS = 4 * 60 + 30;
const BUFF_ALERT_SECONDS = 5;

function App() {
  const { t } = useI18n();
  const [previewExp, setPreviewExp] = useState(null);
  const [previewPercent, setPreviewPercent] = useState(null);
  const [sessionStartExp, setSessionStartExp] = useState(null);
  const [sessionCurrentExp, setSessionCurrentExp] = useState(null);
  const [sessionStartPercent, setSessionStartPercent] = useState(0);
  const [trackingStatus, setTrackingStatus] = useState("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [regionStatus, setRegionStatus] = useState({ exp: false, percent: false });
  const [hasStream, setHasStream] = useState(false);
  const [captureAlert, setCaptureAlert] = useState("");
  const [buffTrackingEnabled, setBuffTrackingEnabled] = useState(true);
  const [buffVolume, setBuffVolume] = useState(60);
  const [buffIntervalSeconds, setBuffIntervalSeconds] = useState(
    DEFAULT_BUFF_INTERVAL_SECONDS,
  );
  const [buffMinutesInput, setBuffMinutesInput] = useState(
    Math.floor(DEFAULT_BUFF_INTERVAL_SECONDS / 60),
  );
  const [buffSecondsInput, setBuffSecondsInput] = useState(
    DEFAULT_BUFF_INTERVAL_SECONDS % 60,
  );
  const {
    isSupported: isPipSupported,
    mountNode: pipMountNode,
    openPip,
  } = usePip({
    width: 380,
    height: 360,
    title: t("floatingStats"),
  });
  const audioContextRef = useRef(null);
  const beepTimeoutRef = useRef(null);

  // ---- utils ----
  function numberWithCommas(x) {
    if (x === null || x === undefined) return "0";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function twoDigits(n) {
    return String(n).padStart(2, "0");
  }
  function formatClock(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
      return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
    }

    return `${twoDigits(minutes)}:${twoDigits(seconds)}`;
  }
  function clampBuffInterval(totalSeconds) {
    return Math.min(59 * 60 + 59, Math.max(30, totalSeconds));
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
  const hasRequiredRegions = regionStatus.exp && regionStatus.percent;
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
  const buffCycleSecond =
    isRunning && buffTrackingEnabled ? elapsedSeconds % buffIntervalSeconds : 0;
  const buffSecondsLeft = isRunning && buffTrackingEnabled
    ? Math.max(0, buffIntervalSeconds - buffCycleSecond)
    : buffIntervalSeconds;
  const buffIsDue =
    buffTrackingEnabled &&
    isRunning &&
    elapsedSeconds >= buffIntervalSeconds &&
    buffCycleSecond < BUFF_ALERT_SECONDS;
  const buffStatusLabel = !buffTrackingEnabled
    ? t("buffOff")
    : buffIsDue
      ? t("buffDueNow")
      : isRunning
        ? t("buffTracking")
        : isPaused
          ? t("buffPaused")
          : t("buffIdle");
  const buffReminder = useMemo(
    () => ({
      countdown: buffTrackingEnabled ? formatClock(buffSecondsLeft) : t("buffOff"),
      interval: formatClock(buffIntervalSeconds),
      status: buffStatusLabel,
      isDue: buffIsDue,
      volume: buffVolume,
    }),
    [
      buffIntervalSeconds,
      buffIsDue,
      buffSecondsLeft,
      buffStatusLabel,
      buffTrackingEnabled,
      buffVolume,
      t,
    ],
  );
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
      buffCountdown: buffTrackingEnabled ? formatClock(buffSecondsLeft) : t("buffOff"),
      buffStatus: buffStatusLabel,
      buffIsDue,
      buffEnabled: buffTrackingEnabled,
      buffVolume,
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
      buffSecondsLeft,
      buffStatusLabel,
      buffIsDue,
      buffTrackingEnabled,
      buffVolume,
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

  useEffect(() => {
    return () => {
      if (beepTimeoutRef.current) {
        window.clearTimeout(beepTimeoutRef.current);
      }
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!buffIsDue || buffVolume <= 0) {
      if (beepTimeoutRef.current) {
        window.clearTimeout(beepTimeoutRef.current);
        beepTimeoutRef.current = null;
      }
      return undefined;
    }

    const playBuffBeep = async () => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      const context =
        audioContextRef.current && audioContextRef.current.state !== "closed"
          ? audioContextRef.current
          : new AudioContextClass();
      audioContextRef.current = context;

      if (context.state === "suspended") {
        await context.resume().catch(() => {});
      }
      if (context.state !== "running") return;

      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const now = context.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(720, now);
      oscillator.frequency.setValueAtTime(720, now + 0.1);
      oscillator.frequency.setValueAtTime(880, now + 0.11);
      oscillator.frequency.setValueAtTime(880, now + 0.2);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, buffVolume / 1800),
        now + 0.025,
      );
      gainNode.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, buffVolume / 2600),
        now + 0.11,
      );
      gainNode.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, buffVolume / 1800),
        now + 0.135,
      );
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.26);
    };

    playBuffBeep();
    beepTimeoutRef.current = window.setTimeout(function queueNextBeep() {
      playBuffBeep();
      beepTimeoutRef.current = window.setTimeout(queueNextBeep, 1800);
    }, 1800);

    return () => {
      if (beepTimeoutRef.current) {
        window.clearTimeout(beepTimeoutRef.current);
        beepTimeoutRef.current = null;
      }
    };
  }, [buffIsDue, buffVolume]);

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

  const handleBuffIntervalSave = () => {
    const nextMinutes = Number(buffMinutesInput) || 0;
    const nextSeconds = Number(buffSecondsInput) || 0;
    const nextInterval = clampBuffInterval(nextMinutes * 60 + nextSeconds);
    setBuffIntervalSeconds(nextInterval);
    setBuffMinutesInput(Math.floor(nextInterval / 60));
    setBuffSecondsInput(nextInterval % 60);
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
              disabled={!hasStream || !hasRequiredRegions || !hasValidPreviewExp}
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

      <section className={`panel buff-panel ${buffIsDue ? "buff-panel-alert" : ""}`}>
        <div className="panel-header">
          <h2>{t("buffCheck")}</h2>
          <p>{t("buffCheckDesc")}</p>
        </div>
        <div className="buff-compact">
          <div className="buff-summary">
            <div className="buff-stat">
              <span className="buff-stat-label">{t("nextBuffIn")}</span>
              <strong className="buff-stat-value">{buffReminder.countdown}</strong>
            </div>
            <div className="buff-stat">
              <span className="buff-stat-label">{t("buffStatus")}</span>
              <strong className="buff-stat-value">{buffReminder.status}</strong>
            </div>
          </div>
          <div className="buff-controls-inline">
            <button
              className={`buff-toggle ${buffTrackingEnabled ? "buff-toggle-on" : "buff-toggle-off"}`}
              onClick={() => setBuffTrackingEnabled((prev) => !prev)}
            >
              {buffTrackingEnabled ? t("buffTrackingOn") : t("buffTrackingOff")}
            </button>
            <div className="buff-config-inline">
              <label className="buff-input-group">
                <span>{t("minutes")}</span>
                <input
                  className="buff-input"
                  type="number"
                  min="0"
                  max="59"
                  value={buffMinutesInput}
                  onChange={(event) => setBuffMinutesInput(event.target.value)}
                />
              </label>
              <label className="buff-input-group">
                <span>{t("seconds")}</span>
                <input
                  className="buff-input"
                  type="number"
                  min="0"
                  max="59"
                  value={buffSecondsInput}
                  onChange={(event) => setBuffSecondsInput(event.target.value)}
                />
              </label>
              <label className="buff-slider-group">
                <span>{t("buffVolume")}</span>
                <input
                  className="buff-volume-slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={buffVolume}
                  onChange={(event) => setBuffVolume(Number(event.target.value))}
                />
                <strong className="buff-volume-value">{buffVolume}%</strong>
              </label>
              <button
                className="control-btn control-btn-overlay buff-save-btn"
                onClick={handleBuffIntervalSave}
              >
                {t("saveBuffInterval")}
              </button>
            </div>
          </div>
          <p className="buff-config-hint">
            {t("buffIntervalHint", { interval: buffReminder.interval })}
          </p>
        </div>
      </section>

      <section className="panel capture-panel">
        <div className="panel-header">
          <h2>{t("capturePreview")}</h2>
          <p>{t("capturePreviewDesc")}</p>
        </div>
        <ScreenShare
          onReading={handleReading}
          onRegionChange={setRegionStatus}
          onStreamChange={setHasStream}
          onShareStopped={handleShareStopped}
          onCaptureStatusChange={setCaptureAlert}
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
              canStart={isIdle && hasStream && hasRequiredRegions && hasValidPreviewExp}
              canContinue={isPaused && hasStream}
              canReset={canReset}
              onStart={handleStart}
              onStop={handleStop}
              onContinue={handleContinue}
              onReset={handleReset}
              buffReminder={buffReminder}
              captureAlert={captureAlert}
            />,
            pipMountNode,
          )
        : null}
    </>
  );
}

export default App;
