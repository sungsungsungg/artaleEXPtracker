import { useEffect, useRef, useState } from "react";
import ScreenShare from "./utils/screenShare";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import Card from "./utils/ContentCard.jsx";
import ContentCard from "./utils/ContentCard.jsx";

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

  // exp/sec
  const expPerSec = timeSpent > 0 ? expGained / timeSpent : 0;

  // (optional) 10-min estimate
  const expRate = expPerSec > 0 ? expPerSec * 600 : 0;

  // freeze percent at start
  const p0 = Number(expPercent); // initial percent (0..100)
  const E0 = Number(firstExp.number); // initial exp-in-level

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

      <div style={{ display: "flex", justifyContent: "space-evenly" }}>
        <ContentCard
          title={"Starting EXP"}
          content={numberWithCommas(firstExp.number)}
        />
        <ContentCard title={"Starting EXP (%)"} content={`${expPercent}%`} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-evenly" }}>
        <ContentCard
          title={"Current EXP"}
          content={numberWithCommas(exp.number)}
        />
        <ContentCard
          title={"Duration"}
          content={`${twoDigits(minute)}:${twoDigits(second)}`}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-evenly" }}>
        {expRate ? (
          <ContentCard
            title={"10min EXP"}
            content={numberWithCommas(expRate.toFixed(0))}
          />
        ) : (
          <ContentCard title={"10min EXP"} content={0} />
        )}
        {timeLeftSec && Number.isFinite(timeLeftSec) && timeLeftSec > 0 ? (
          <ContentCard
            title={"Time Left For a level"}
            content={`${hourToLevel >= 100 ? hourToLevel : twoDigits(hourToLevel)}:${twoDigits(minuteToLevel)}:${twoDigits(secondToLevel)}`}
          />
        ) : (
          <ContentCard
            title={"Time Left For a level"}
            content={`Not Measured`}
          />
        )}
        {/*   const totalExpToLevel = (Number(firstExp) / Number(expPercent)) * 100; */}
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
        2. Drag over the EXP bar area (should include the EXP number and
        percentage inside the red box) <br />
        3. Check if you get the correct starting EXP number (if not, drag again
        or reset or resize the Artale window) <br />
        4. Not going to make this better, so be happy with what’s here for now
        😄 <br />
        **Time Left for a level can be extra imprecise if your exp is lower than
        1% or higher than 99%
      </p>
    </>
  );
}

export default App;
