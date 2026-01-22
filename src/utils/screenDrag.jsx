import { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";

/**
 * Helpers: preprocess + upscale for better OCR on HUD text
 */
function preprocessToBW(canvas, threshold = 180) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = gray > threshold ? 255 : 0; // white text -> white
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  ctx.putImageData(img, 0, 0);
}

function upscaleCanvas(srcCanvas, scale = 5) {
  const up = document.createElement("canvas");
  up.width = Math.max(1, Math.round(srcCanvas.width * scale));
  up.height = Math.max(1, Math.round(srcCanvas.height * scale));

  const uctx = up.getContext("2d");
  if (!uctx) return up;

  uctx.imageSmoothingEnabled = false; // keep edges crisp
  uctx.drawImage(srcCanvas, 0, 0, up.width, up.height);
  return up;
}

export default function CropSelector({
  videoRef,
  stream,
  setExp,
  setExpPercent,
  setFirstExp,
}) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  const [dragging, setDragging] = useState(false);

  // Store crop box in video/canvas pixel space: [x, y, w, h]
  const cropBoxRef = useRef([0, 0, 0, 0]);
  const start = useRef({ x: 0, y: 0 });

  // Avoid stale closure issues with interval
  const isFirstRef = useRef(true);

  // Reuse frame canvas for performance
  const frameCanvasRef = useRef(null);
  const frameCtxRef = useRef(null);

  /**
   * Attach stream to video (React doesn't reliably set srcObject via JSX prop)
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream, videoRef]);

  /**
   * Init overlay canvas ctx once
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    ctxRef.current = canvas.getContext("2d");
  }, []);

  /**
   * Convert mouse event to canvas (video pixel) coordinates
   */
  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current;
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;

    return {
      x: (e.clientX - r.left) * scaleX,
      y: (e.clientY - r.top) * scaleY,
    };
  };

  const onMouseDown = (e) => {
    const p = getCanvasPoint(e);
    start.current = p;
    setDragging(true);
  };

  const onMouseMove = (e) => {
    if (!dragging) return;

    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const p = getCanvasPoint(e);

    const x1 = start.current.x;
    const y1 = start.current.y;
    const left = Math.min(x1, p.x);
    const top = Math.min(y1, p.y);
    const width = Math.abs(p.x - x1);
    const height = Math.abs(p.y - y1);

    // Draw selection rectangle on overlay
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, width, height);

    cropBoxRef.current = [left, top, width, height];
  };

  const onMouseUp = () => {
    setDragging(false);
    // reset "first exp" capture for new selection
    isFirstRef.current = true;
  };

  /**
   * OCR loop (runs continuously, but only does work if a region is selected and not dragging)
   */
  useEffect(() => {
    let intervalId;

    const run = async () => {
      const video = videoRef.current;
      const overlayCanvas = canvasRef.current;

      if (!video || !overlayCanvas) return;
      if (video.readyState < 2) return; // not enough frame data yet
      if (dragging) return; // don't OCR while user is selecting

      const [x, y, w, h] = cropBoxRef.current;

      // Need a valid selection
      if (w < 8 || h < 8) return;

      // Make sure crop is within bounds
      const sx = Math.max(0, Math.floor(x));
      const sy = Math.max(0, Math.floor(y));
      const sw = Math.min(video.videoWidth - sx, Math.floor(w));
      const sh = Math.min(video.videoHeight - sy, Math.floor(h));
      if (sw <= 0 || sh <= 0) return;

      // Prepare reusable frame canvas once
      if (!frameCanvasRef.current) {
        const fc = document.createElement("canvas");
        fc.width = video.videoWidth;
        fc.height = video.videoHeight;
        frameCanvasRef.current = fc;
        frameCtxRef.current = fc.getContext("2d");
      }

      const frameCanvas = frameCanvasRef.current;
      const frameCtx = frameCtxRef.current;

      // If the video resolution changes, resize frame canvas
      if (
        frameCanvas.width !== video.videoWidth ||
        frameCanvas.height !== video.videoHeight
      ) {
        frameCanvas.width = video.videoWidth;
        frameCanvas.height = video.videoHeight;
        frameCtxRef.current = frameCanvas.getContext("2d");
      }

      const frameCtx2 = frameCtxRef.current;
      if (!frameCtx2) return;

      // Draw current video frame
      frameCtx2.drawImage(video, 0, 0);

      // Crop region into its own canvas
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = sw;
      cropCanvas.height = sh;
      const cropCtx = cropCanvas.getContext("2d");
      if (!cropCtx) return;

      // Faster than getImageData/putImageData: draw directly with source rect
      cropCtx.drawImage(frameCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

      // Preprocess + upscale
      preprocessToBW(cropCanvas, 180);
      const up = upscaleCanvas(cropCanvas, 3);

      // OCR (digits + dot only). Reconstruct brackets yourself if needed.
      const { data } = await Tesseract.recognize(up, "eng", {
        tessedit_char_whitelist: "0123456789.",
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      });

      const normalized = (data.text || "").replace(/\s+/g, " ").trim();
      if (!normalized) return;

      // EXP: usually the long integer
      const expNumber =
        normalized.match(/\d{4,}/)?.[0] ?? normalized.match(/\d+/)?.[0] ?? "";

      // Percent: usually decimal like 66.31
      const pct = normalized.match(/\d+\.\d+/)?.[0] ?? "";

      // Update states
      if (expNumber) setExp({ number: expNumber, time: new Date() });

      // First EXP capture
      if (isFirstRef.current && expNumber) {
        setFirstExp({ number: expNumber, time: new Date() });
        if (pct) setExpPercent(pct);
        isFirstRef.current = false;
      }

      // Debug
      console.log("OCR raw:", normalized, { expNumber, pct });
    };

    intervalId = setInterval(() => {
      run().catch(console.error);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [videoRef, dragging, setExp, setExpPercent, setFirstExp]);

  return (
    <>
      <button
        style={{ width: "50%", justifySelf: "center" }}
        onClick={() => {
          isFirstRef.current = true;
        }}
      >
        Reset
      </button>
      <div style={{ position: "relative", width: 800 }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: "100%",
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
          onLoadedMetadata={() => {
            const canvas = canvasRef.current;
            const video = videoRef.current;
            if (!canvas || !video) return;

            // Match overlay canvas pixel space to video pixel space
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }}
        />

        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: "crosshair",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        />
      </div>
    </>
  );
}
