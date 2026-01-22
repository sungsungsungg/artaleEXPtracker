import { useEffect, useRef, useState } from "react";
import ScreenShare from "./utils/screenShare";
import "./App.css";

function App() {
  const [firstExp, setFirstExp] = useState({ number: 0, time: null });
  const [exp, setExp] = useState({ number: 0, time: null });
  const [expPercent, setExpPercent] = useState(0);

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
  const hasTimes = firstExp.time && exp.time && exp.time >= firstExp.time;

  const second = hasTimes
    ? Math.floor(((exp.time - firstExp.time) / 1000) % 60)
    : 0;

  const minute = hasTimes
    ? Math.floor((exp.time - firstExp.time) / 1000 / 60)
    : 0;

  const expGained = exp.number - firstExp.number;
  const timeSpent = hasTimes ? (exp.time - firstExp.time) / 1000 : 0;

  // 10 minutes = 600 seconds
  const expRate = timeSpent > 0 ? (expGained / timeSpent) * 600 : 0;

  // ✅ open overlay window
  const openOverlay = () => {
    if (overlayRef.current && !overlayRef.current.closed) {
      overlayRef.current.focus();
      return;
    }

    // Vite sets this to "/" locally, and "/artaleEXPtracker/" on GitHub Pages (if base is configured)
    const base = import.meta.env.BASE_URL; // e.g. "/" or "/artaleEXPtracker/"

    overlayRef.current = window.open(
      `${base}overlay`,
      "exp-overlay",
      "width=500,height=400,top=80,left=40",
    );
  };
  // ✅ close overlay window
  const closeOverlay = () => {
    overlayRef.current?.close();
    overlayRef.current = null;
  };

  // ✅ push updates to overlay whenever values change
  useEffect(() => {
    const w = overlayRef.current;
    if (!w || w.closed) return;

    w.postMessage(
      {
        type: "EXP_UPDATE",
        payload: {
          exp: numberWithCommas(exp.number),
          expPercent: expPercent ?? 0,
          startedFrom: numberWithCommas(firstExp.number),
          duration: `${twoDigits(minute)}:${twoDigits(second)}`,
          exp10min: expRate ? numberWithCommas(expRate.toFixed(0)) : "0",
        },
      },
      window.location.origin,
    );
  }, [exp, expPercent, firstExp, minute, second, expRate]);

  // ✅ cleanup when main tab closes
  useEffect(() => {
    return () => overlayRef.current?.close();
  }, []);

  return (
    <>
      <h1>EXP Tracker Artale</h1>

      <div>
        Current Exp: {numberWithCommas(exp.number)} ({expPercent}%)
      </div>
      <div>Started from: {numberWithCommas(firstExp.number)}</div>
      <div>
        Duration : {twoDigits(minute)}:{twoDigits(second)}
      </div>
      <div>
        10min EXP : {expRate ? numberWithCommas(expRate.toFixed(0)) : 0}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          justifyContent: "center",
        }}
      >
        <button onClick={openOverlay}>Open A Tab</button>
      </div>
      <br />

      <ScreenShare
        setExp={setExp}
        setExpPercent={setExpPercent}
        setFirstExp={setFirstExp}
      />

      <p>
        How to use <br />
        1. Share the screen of Artale (works best if you share the entire
        screen) <br />
        2. Drag over the EXP area (should include the EXP number and percentage){" "}
        <br />
        3. Check if you get the correct EXP number (if not, drag again or resize
        the Artale window) <br />
        4. If you want to open a small tab, click on "Open A Tab" <br />
        5. Not going to make this better, so be happy with what’s here for now
        😄
      </p>
    </>
  );
}

export default App;
