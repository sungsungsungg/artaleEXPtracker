import { useRef, useState } from "react";
import CropSelector from "./screenDrag";
import { useI18n } from "../i18n/LanguageContext.jsx";

export default function ScreenShare({
  onReading,
  onRegionChange,
  onStreamChange,
  onShareStopped,
  onCaptureStatusChange,
}) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState("");
  const [needsReshare, setNeedsReshare] = useState(false);

  const detachStreamListeners = (targetStream) => {
    if (!targetStream) return;
    const track = targetStream.getVideoTracks()[0];
    if (track) {
      track.onended = null;
    }
    targetStream.oninactive = null;
  };

  const stopShare = (reason = "manual", targetStream = streamRef.current) => {
    if (videoRef.current) videoRef.current.srcObject = null;
    detachStreamListeners(targetStream);

    if (reason === "manual") {
      targetStream?.getTracks().forEach((t) => t.stop());
      setError("");
      setNeedsReshare(false);
      onCaptureStatusChange?.("");
    } else {
      const message = t("screenShareEndedUnexpectedly");
      setError(message);
      setNeedsReshare(true);
      onCaptureStatusChange?.(message);
    }

    streamRef.current = null;
    setStream(null);
    onStreamChange?.(false);
    onShareStopped?.();
  };

  const startShare = async () => {
    setError("");
    setNeedsReshare(false);
    onCaptureStatusChange?.("");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30,
        },
        audio: false,
      });

      streamRef.current = s;
      setStream(s);
      onStreamChange?.(true);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }

      // Detect when browser/OS ends sharing unexpectedly.
      const track = s.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          stopShare("external", s);
        };
      }
      s.oninactive = () => {
        stopShare("external", s);
      };
    } catch (e) {
      // User canceled or browser blocked
      const message = e?.message || t("screenShareCancelled");
      setError(message);
      onCaptureStatusChange?.(message);
    }
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
          onClick={() => stopShare("manual")}
          disabled={!stream}
        >
          {t("stopCapture")}
        </button>
        {needsReshare && !stream && (
          <button
            className="control-btn control-btn-overlay"
            onClick={startShare}
            type="button"
          >
            {t("reShareScreen")}
          </button>
        )}
      </div>
    </div>
  );
}
