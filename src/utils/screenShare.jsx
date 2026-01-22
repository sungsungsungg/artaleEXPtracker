import { useEffect, useRef, useState } from "react";
import CropSelector from "./screenDrag";

export default function ScreenShare({ setExp, setExpPercent, setFirstExp }) {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState("");

  const startShare = async () => {
    setError("");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30,
        },
        audio: false,
      });

      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }

      // Detect when user stops sharing from browser UI
      const track = s.getVideoTracks()[0];
      track.onended = () => {
        stopShare();
      };
    } catch (e) {
      // User canceled or browser blocked
      setError(e?.message || "Screen share was cancelled/blocked.");
    }
  };

  const stopShare = () => {
    if (videoRef.current) videoRef.current.srcObject = null;
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div style={{ color: "crimson" }}>{error}</div>}

      <CropSelector
        videoRef={videoRef}
        stream={stream}
        setExp={setExp}
        setExpPercent={setExpPercent}
        setFirstExp={setFirstExp}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={startShare} disabled={!!stream}>
          Share screen
        </button>
        <button onClick={stopShare} disabled={!stream}>
          Stop
        </button>
      </div>
    </div>
  );
}
