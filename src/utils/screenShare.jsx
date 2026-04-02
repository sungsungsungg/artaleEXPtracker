import { useRef, useState } from "react";
import CropSelector from "./screenDrag";
import { useI18n } from "../i18n/LanguageContext.jsx";

export default function ScreenShare({
  onReading,
  onRegionChange,
  onStreamChange,
  onShareStopped,
}) {
  const { t } = useI18n();
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
      onStreamChange?.(true);
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
      setError(e?.message || t("screenShareCancelled"));
    }
  };

  const stopShare = () => {
    if (videoRef.current) videoRef.current.srcObject = null;
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    onStreamChange?.(false);
    onShareStopped?.();
  };

  return (
    <div className="capture-shell">
      {error && <div className="capture-error">{error}</div>}

      <CropSelector
        videoRef={videoRef}
        stream={stream}
        onReading={onReading}
        onRegionChange={onRegionChange}
      />
      <div className="capture-actions">
        <button
          className="control-btn control-btn-start"
          onClick={startShare}
          disabled={!!stream}
        >
          {t("shareScreen")}
        </button>
        <button
          className="control-btn control-btn-stop"
          onClick={stopShare}
          disabled={!stream}
        >
          {t("stopCapture")}
        </button>
      </div>
    </div>
  );
}
