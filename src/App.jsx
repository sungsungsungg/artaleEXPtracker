import { useEffect, useRef, useState } from "react";
import ScreenShare from "./utils/screenShare";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import ContentCard from "./utils/ContentCard.jsx";

function App() {
  const [previewExp, setPreviewExp] = useState(null);
  const [previewPercent, setPreviewPercent] = useState(null);
  const [sessionStartExp, setSessionStartExp] = useState(null);
  const [sessionCurrentExp, setSessionCurrentExp] = useState(null);
  const [sessionStartPercent, setSessionStartPercent] = useState(0);
  const [trackingStatus, setTrackingStatus] = useState("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasCropRegion, setHasCropRegion] = useState(false);
  const [hasStream, setHasStream] = useState(false);

  // ✅ overlay window ref
  const overlayRef = useRef(null);

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
  const sessionStatusLabel =
    trackingStatus.charAt(0).toUpperCase() + trackingStatus.slice(1);

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

  // ✅ open overlay window
  const openOverlay = () => {
    if (overlayRef.current && !overlayRef.current.closed) {
      overlayRef.current.focus();
      return;
    }

    // Vite sets this to "/" locally, and "/artaleEXPtracker/" on GitHub Pages (if base is configured)
    const base = import.meta.env.BASE_URL; // e.g. "/" or "/artaleEXPtracker/"

    overlayRef.current = window.open(
      `${base}`,
      "exp-overlay",
      "width=500,height=400,top=80,left=40",
    );
  };
  // ✅ close overlay window
  // const closeOverlay = () => {
  //   overlayRef.current?.close();
  //   overlayRef.current = null;
  // };

  // ✅ push updates to overlay whenever values change
  useEffect(() => {
    const w = overlayRef.current;
    if (!w || w.closed) return;

    w.postMessage(
      {
        type: "EXP_UPDATE",
        payload: {
          exp: numberWithCommas(previewExp ?? 0),
          expPercent: sessionStartPercent ?? 0,
          startedFrom: numberWithCommas(sessionStartExp ?? 0),
          duration: `${twoDigits(minute)}:${twoDigits(second)}`,
          exp10min: expRate ? numberWithCommas(expRate.toFixed(0)) : "0",
        },
      },
      window.location.origin,
    );
  }, [previewExp, sessionStartPercent, sessionStartExp, minute, second, expRate]);

  // ✅ cleanup when main tab closes
  useEffect(() => {
    return () => overlayRef.current?.close();
  }, []);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">EXP Tracker Artale</h1>
          <p className="dashboard-subtitle">Track EXP gain in real time</p>
        </div>
        <span className={`status-badge status-${trackingStatus}`}>
          {sessionStatusLabel}
        </span>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>Session Metrics</h2>
          <p>Live OCR preview and tracked session performance.</p>
        </div>
        <div className="metrics-grid metrics-grid-primary">
          <ContentCard
            title={"Current EXP"}
            content={hasValidPreviewExp ? numberWithCommas(previewExp) : "Reading OCR..."}
            priority="primary"
            muted={!hasValidPreviewExp}
          />
          <ContentCard
            title={"Gained EXP"}
            content={hasSession ? numberWithCommas(expGained) : "Not Started"}
            priority="primary"
            muted={!hasSession}
          />
          <ContentCard
            title={"Duration"}
            content={`${twoDigits(minute)}:${twoDigits(second)}`}
            priority="primary"
          />
        </div>

        <div className="metrics-grid metrics-grid-secondary">
          <ContentCard
            title={"Starting EXP"}
            content={hasSession ? numberWithCommas(sessionStartExp) : "Not Started"}
            muted={!hasSession}
          />
          <ContentCard
            title={"Starting EXP (%)"}
            content={hasSession ? `${sessionStartPercent}%` : "Not Started"}
            muted={!hasSession}
          />
          <ContentCard
            title={"10min EXP"}
            content={expRate ? numberWithCommas(expRate.toFixed(0)) : "Not Measured"}
            muted={!expRate}
          />
          <ContentCard
            title={"Time Left For a level"}
            content={
              hasTimeToLevel
                ? `${hourToLevel >= 100 ? hourToLevel : twoDigits(hourToLevel)}:${twoDigits(minuteToLevel)}:${twoDigits(secondToLevel)}`
                : "Not Measured"
            }
            muted={!hasTimeToLevel}
          />
        </div>
      </section>

      <section className="panel controls-panel">
        <div className="panel-header">
          <h2>Session Controls</h2>
          <p>Stopwatch-style controls for run, pause, resume, and reset.</p>
        </div>
        <div className="controls-row">
          <button className="control-btn control-btn-overlay" onClick={openOverlay}>
            Open Capture Tab
          </button>
          {isIdle && (
            <button
              className="control-btn control-btn-start"
              onClick={handleStart}
              disabled={!hasStream || !hasCropRegion || !hasValidPreviewExp}
            >
              Start
            </button>
          )}
          {isRunning && (
            <button className="control-btn control-btn-stop" onClick={handleStop}>
              Stop
            </button>
          )}
          {isPaused && (
            <>
              <button
                className="control-btn control-btn-continue"
                onClick={handleContinue}
                disabled={!hasStream}
              >
                Continue
              </button>
            </>
          )}
          <button
            className="control-btn control-btn-reset"
            onClick={handleReset}
            disabled={!canReset}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="panel capture-panel">
        <div className="panel-header">
          <h2>Capture Preview</h2>
          <p>Select the OCR area and verify live readings before starting.</p>
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
          1. Share the screen of Artale (entire screen works best). <br />
          2. Drag over the EXP bar area to include EXP number and percentage. <br />
          3. OCR preview updates as soon as a valid area is selected. <br />
          4. Click Start to begin tracking. Use Stop/Continue to pause and
          resume. <br />
          5. Reset clears session stats while keeping capture selection available.
        </p>
      </section>
    </main>
  );
}

export default App;
