import { useEffect, useRef, useState } from "react";
import { createWorker, PSM } from "tesseract.js";

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

function sanitizeHudText(text) {
  return (text || "")
    .toUpperCase()
    .replace(/[^\w[\].,%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHudValues(text) {
  const sanitized = sanitizeHudText(text);
  const compact = sanitized.replace(/\s+/g, "");

  const pctMatch =
    compact.match(/\[(\d{1,3}(?:\.\d{1,2})?)%?\]/) ||
    compact.match(/(\d{1,3}(?:\.\d{1,2})?)%/);
  const expSide = compact.split("[")[0] || compact;
  const expMatch =
    expSide.match(/\d{4,}(?:,\d{3})*/) || compact.match(/\d{4,}(?:,\d{3})*/);

  const expValue = expMatch
    ? Number(expMatch[0].replaceAll(",", ""))
    : null;
  const expPercent = pctMatch ? Number(pctMatch[1]) : null;

  return {
    sanitized,
    expValue: Number.isFinite(expValue) ? expValue : null,
    expPercent: Number.isFinite(expPercent) ? expPercent : null,
  };
}

function getTextStripCanvas(frameCanvas, sx, sy, sw, sh) {
  const stripTop = sy + Math.floor(sh * 0.02);
  const stripHeight = Math.max(1, Math.floor(sh * 0.56));

  const cropY = Math.max(0, stripTop);
  const cropH = Math.min(frameCanvas.height - cropY, stripHeight);
  if (cropH <= 0) return null;

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = sw;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) return null;
  cropCtx.drawImage(frameCanvas, sx, cropY, sw, cropH, 0, 0, sw, cropH);
  return cropCanvas;
}

export default function CropSelector({
  videoRef,
  stream,
  onReading,
  onRegionChange,
}) {
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const ZOOM_STEP = 0.25;

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const viewportRef = useRef(null);
  const panDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [interactionMode, setInteractionMode] = useState("select");

  // Store crop box in video/canvas pixel space: [x, y, w, h]
  const cropBoxRef = useRef([0, 0, 0, 0]);
  const start = useRef({ x: 0, y: 0 });

  // Reuse frame canvas for performance
  const frameCanvasRef = useRef(null);
  const frameCtxRef = useRef(null);
  const ocrBusyRef = useRef(false);
  const workerRef = useRef(null);
  const loopTimerRef = useRef(null);
  const stopLoopRef = useRef(false);
  const [workerReady, setWorkerReady] = useState(false);
  const acceptedRef = useRef({ expValue: null, expPercent: null });

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

  useEffect(() => {
    let cancelled = false;

    const setupWorker = async () => {
      const worker = await createWorker("eng");
      if (cancelled) {
        await worker.terminate();
        return;
      }

      workerRef.current = worker;
      await worker.setParameters({
        tessedit_char_whitelist: "EXP0123456789[].,%",
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      setWorkerReady(true);
    };

    setupWorker().catch(console.error);

    return () => {
      cancelled = true;
      setWorkerReady(false);
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) {
        worker.terminate().catch(console.error);
      }
    };
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
    if (interactionMode !== "select") return;
    const p = getCanvasPoint(e);
    start.current = p;
    setDragging(true);
  };

  const onMouseMove = (e) => {
    if (interactionMode !== "select") return;
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
    onRegionChange?.(width >= 8 && height >= 8);
  };

  const onMouseUp = () => {
    if (interactionMode !== "select") return;
    setDragging(false);
    const [, , width, height] = cropBoxRef.current;
    onRegionChange?.(width >= 8 && height >= 8);
  };

  const clampZoom = (nextZoom) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

  const applyZoom = (nextZoom) => {
    const clamped = clampZoom(nextZoom);
    if (clamped === zoom) return;

    const viewport = viewportRef.current;
    if (!viewport) {
      setZoom(clamped);
      return;
    }

    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    const ratio = clamped / zoom;

    setZoom(clamped);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(
        0,
        centerX * ratio - viewport.clientWidth / 2,
      );
      viewport.scrollTop = Math.max(
        0,
        centerY * ratio - viewport.clientHeight / 2,
      );
    });
  };

  const resetZoom = () => {
    const viewport = viewportRef.current;
    setZoom(1);
    setInteractionMode("select");
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  };

  const handleWheelZoom = (e) => {
    if (!stream) return;
    if (!e.ctrlKey) return;
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    applyZoom(zoom + direction * ZOOM_STEP);
  };

  const onViewportMouseDown = (e) => {
    if (interactionMode !== "pan" || zoom <= 1) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    panDragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
  };

  const onViewportMouseMove = (e) => {
    if (!panDragRef.current.active) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    e.preventDefault();
    const deltaX = e.clientX - panDragRef.current.startX;
    const deltaY = e.clientY - panDragRef.current.startY;
    viewport.scrollLeft = panDragRef.current.startScrollLeft - deltaX;
    viewport.scrollTop = panDragRef.current.startScrollTop - deltaY;
  };

  const stopPanDrag = () => {
    panDragRef.current.active = false;
  };

  useEffect(() => {
    if (!stream) {
      resetZoom();
    }
  }, [stream]);

  /**
   * OCR loop (runs continuously, but only does work if a region is selected and not dragging)
   */
  useEffect(() => {
    if (!stream || !workerReady) return undefined;
    stopLoopRef.current = false;

    const run = async () => {
      const video = videoRef.current;
      if (!video || !canvasRef.current) return;
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

      // Crop only the top text strip to reduce bright EXP bar noise.
      const cropCanvas = getTextStripCanvas(frameCanvas, sx, sy, sw, sh);
      if (!cropCanvas) return;

      // Preprocess + upscale
      preprocessToBW(cropCanvas, 165);
      const up = upscaleCanvas(cropCanvas, 4);

      const worker = workerRef.current;
      if (!worker) return;
      const { data } = await worker.recognize(up);

      const parsed = parseHudValues(data.text || "");
      const plausibleExp =
        Number.isFinite(parsed.expValue) && parsed.expValue >= 1000;
      const plausiblePct =
        Number.isFinite(parsed.expPercent) &&
        parsed.expPercent >= 0 &&
        parsed.expPercent <= 100;

      if (!plausibleExp) return;

      const last = acceptedRef.current;
      const pctToUse = plausiblePct ? parsed.expPercent : last.expPercent;

      acceptedRef.current = {
        expValue: parsed.expValue,
        expPercent: pctToUse ?? null,
      };

      onReading?.({
        expNumber: acceptedRef.current.expValue,
        pct: acceptedRef.current.expPercent,
      });

      // Debug
      console.log("OCR raw:", parsed.sanitized, acceptedRef.current);
    };

    const loop = async () => {
      if (stopLoopRef.current) return;

      if (!ocrBusyRef.current) {
        ocrBusyRef.current = true;
        try {
          await run();
        } catch (err) {
          console.error(err);
        } finally {
          ocrBusyRef.current = false;
        }
      }

      loopTimerRef.current = window.setTimeout(loop, 400);
    };
    loop();

    return () => {
      stopLoopRef.current = true;
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    };
  }, [videoRef, dragging, onReading, stream, workerReady]);

  return (
    <>
      <div className="zoom-toolbar">
        <div className="zoom-actions">
          <button
            className="control-btn control-btn-overlay"
            type="button"
            onClick={() => applyZoom(zoom - ZOOM_STEP)}
            disabled={!stream || zoom <= MIN_ZOOM}
          >
            - Zoom Out
          </button>
          <button
            className="control-btn control-btn-overlay"
            type="button"
            onClick={() => applyZoom(zoom + ZOOM_STEP)}
            disabled={!stream || zoom >= MAX_ZOOM}
          >
            + Zoom In
          </button>
          <button
            className="control-btn control-btn-reset"
            type="button"
            onClick={resetZoom}
            disabled={!stream}
          >
            Reset Zoom
          </button>
          <button
            className="control-btn control-btn-overlay"
            type="button"
            onClick={() =>
              setInteractionMode((prev) => (prev === "pan" ? "select" : "pan"))
            }
            disabled={!stream || zoom <= 1}
          >
            {interactionMode === "pan" ? "Switch To Select" : "Enable Pan"}
          </button>
        </div>
        <div className="zoom-meta">
          <span className="zoom-percent">{Math.round(zoom * 100)}%</span>
          <span className="zoom-hint">
            Hold Ctrl and use mouse wheel to zoom.
          </span>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`preview-viewport ${interactionMode === "pan" ? "mode-pan" : "mode-select"}`}
        onWheel={handleWheelZoom}
        onMouseDown={onViewportMouseDown}
        onMouseMove={onViewportMouseMove}
        onMouseUp={stopPanDrag}
        onMouseLeave={stopPanDrag}
      >
        <div className="preview-stage" style={{ width: `${zoom * 100}%` }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", display: "block" }}
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
              cursor: interactionMode === "pan" ? "grab" : "crosshair",
              pointerEvents: stream ? "auto" : "none",
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
        </div>
      </div>
    </>
  );
}
