import { useEffect, useMemo, useRef, useState } from "react";
import { createWorker, PSM } from "tesseract.js";
import { useI18n } from "../i18n/LanguageContext.jsx";
import {
  getRawRegionCanvas,
  isPlausibleExp,
  isPlausiblePercent,
  preprocessExpRegionVariants,
  recognizeExpWithTesseractVariants,
  recognizePercentWithTesseractVariants,
  updateStableExpValue,
  updateStablePercentValue,
} from "./hudOcrEngines";

const EXP_PREPROCESS_VARIANTS = [
  {
    id: "brightness-top15-2x",
    preprocessMode: "brightness",
    upscaleFactor: 2,
    invert: false,
    useAdaptiveBrightThreshold: true,
    brightTopPercent: 0.15,
    secondBrightBand: 24,
    nearWhiteTolerance: 36,
    trimXRatio: 0,
    trimYRatio: 0,
  },
  {
    id: "brightness-top18-3x",
    preprocessMode: "brightness",
    upscaleFactor: 3,
    invert: false,
    useAdaptiveBrightThreshold: true,
    brightTopPercent: 0.18,
    secondBrightBand: 20,
    nearWhiteTolerance: 34,
    trimXRatio: 0,
    trimYRatio: 0,
  },
  {
    id: "brightness-fixed-2x",
    preprocessMode: "brightness",
    upscaleFactor: 2,
    invert: false,
    useAdaptiveBrightThreshold: false,
    brightThreshold: 205,
    secondBrightBand: 18,
    nearWhiteTolerance: 34,
    trimXRatio: 0,
    trimYRatio: 0,
  },
  {
    id: "light-threshold-2x-fallback",
    upscaleFactor: 2,
    threshold: 172,
    contrast: 1.16,
    applyThreshold: true,
    invert: false,
    trimXRatio: 0,
    trimYRatio: 0,
  },
];

const PERCENT_PREPROCESS_VARIANTS = [
  {
    id: "pct-brightness-top18-2x",
    preprocessMode: "brightness",
    upscaleFactor: 2,
    invert: false,
    useAdaptiveBrightThreshold: true,
    brightTopPercent: 0.18,
    secondBrightBand: 18,
    nearWhiteTolerance: 36,
    trimXRatio: 0.01,
    trimYRatio: 0.03,
    thinStrokePasses: 0,
  },
  {
    id: "pct-brightness-fixed-2x",
    preprocessMode: "brightness",
    upscaleFactor: 2,
    invert: false,
    useAdaptiveBrightThreshold: false,
    brightThreshold: 205,
    secondBrightBand: 16,
    nearWhiteTolerance: 34,
    trimXRatio: 0.01,
    trimYRatio: 0.03,
    thinStrokePasses: 0,
  },
  {
    id: "pct-light-threshold-2x",
    upscaleFactor: 2,
    threshold: 172,
    contrast: 1.15,
    applyThreshold: true,
    invert: false,
    trimXRatio: 0.01,
    trimYRatio: 0.03,
    thinStrokePasses: 0,
  },
  {
    id: "pct-gray-2x-fallback",
    upscaleFactor: 2,
    contrast: 1.08,
    applyThreshold: false,
    invert: false,
    trimXRatio: 0.01,
    trimYRatio: 0.03,
  },
];

function isValidRegion(region) {
  return !!region && region.width >= 8 && region.height >= 8;
}

function clampRegionToCanvas(region, canvasWidth, canvasHeight) {
  if (!region) return null;
  const x = Math.max(0, Math.min(canvasWidth - 1, Math.floor(region.x)));
  const y = Math.max(0, Math.min(canvasHeight - 1, Math.floor(region.y)));
  const maxW = Math.max(1, canvasWidth - x);
  const maxH = Math.max(1, canvasHeight - y);
  const width = Math.max(1, Math.min(maxW, Math.floor(region.width)));
  const height = Math.max(1, Math.min(maxH, Math.floor(region.height)));
  return { x, y, width, height };
}

export default function CropSelector({
  videoRef,
  stream,
  onReading,
  onRegionChange,
}) {
  const { t } = useI18n();

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

  const dragStartRef = useRef({ x: 0, y: 0 });

  const frameCanvasRef = useRef(null);
  const frameCtxRef = useRef(null);

  const expRawCanvasRef = useRef(null);
  const expVariantCanvasRefs = useRef(
    EXP_PREPROCESS_VARIANTS.map(() => ({ current: null })),
  );
  const pctRawCanvasRef = useRef(null);
  const pctVariantCanvasRefs = useRef(
    PERCENT_PREPROCESS_VARIANTS.map(() => ({ current: null })),
  );
  const expPreviewCanvasRef = useRef(null);
  const expOptimizedPreviewCanvasRef = useRef(null);
  const pctPreviewCanvasRef = useRef(null);
  const pctOptimizedPreviewCanvasRef = useRef(null);
  const expPreviewRawCanvasRef = useRef(null);
  const pctPreviewRawCanvasRef = useRef(null);
  const expPreviewSizeRef = useRef({ width: 160, height: 28 });
  const pctPreviewSizeRef = useRef({ width: 160, height: 28 });

  const expWorkerRef = useRef(null);
  const pctWorkerRef = useRef(null);

  const loopTimerRef = useRef(null);
  const stopLoopRef = useRef(false);
  const ocrBusyRef = useRef(false);

  const expStabilityRef = useRef({ pending: null, accepted: null });
  const pctStabilityRef = useRef({ pending: null, accepted: null });
  const acceptedRef = useRef({ expValue: null, expPercent: null });

  const [workerReady, setWorkerReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [interactionMode, setInteractionMode] = useState("select");
  const [selectionMode, setSelectionMode] = useState("exp"); // exp | percent

  const [expRegion, setExpRegion] = useState(null);
  const [percentRegion, setPercentRegion] = useState(null);

  const regionStatus = useMemo(
    () => ({
      exp: isValidRegion(expRegion),
      percent: isValidRegion(percentRegion),
    }),
    [expRegion, percentRegion],
  );

  useEffect(() => {
    onRegionChange?.(regionStatus);
  }, [onRegionChange, regionStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream, videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    ctxRef.current = canvas.getContext("2d");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setupWorkers = async () => {
      const [expWorker, pctWorker] = await Promise.all([
        createWorker("eng"),
        createWorker("eng"),
      ]);

      if (cancelled) {
        await expWorker.terminate();
        await pctWorker.terminate();
        return;
      }

      expWorkerRef.current = expWorker;
      pctWorkerRef.current = pctWorker;

      await expWorker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      await pctWorker.setParameters({
        tessedit_char_whitelist: "0123456789.%",
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });

      setWorkerReady(true);
    };

    setupWorkers().catch(console.error);

    return () => {
      cancelled = true;
      setWorkerReady(false);
      const expWorker = expWorkerRef.current;
      const pctWorker = pctWorkerRef.current;
      expWorkerRef.current = null;
      pctWorkerRef.current = null;
      if (expWorker) expWorker.terminate().catch(console.error);
      if (pctWorker) pctWorker.terminate().catch(console.error);
    };
  }, []);

  const drawOverlay = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawRegion = (region, color, label) => {
      if (!isValidRegion(region)) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(region.x, region.y, region.width, region.height);

      const pillW = 34;
      const pillH = 18;
      ctx.fillStyle = color;
      ctx.fillRect(region.x, Math.max(0, region.y - pillH), pillW, pillH);
      ctx.fillStyle = "#0d1420";
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, region.x + pillW / 2, Math.max(9, region.y - pillH / 2));
    };

    drawRegion(expRegion, "#4ea1ff", "EXP");
    drawRegion(percentRegion, "#ffb24c", "%");
  };

  const drawPreviewCanvas = (sourceCanvas, targetRef, fixedSize = null) => {
    const target = targetRef.current;
    if (!target || !sourceCanvas) return;
    const tctx = target.getContext("2d");
    if (!tctx) return;

    // Preview should be a truthful pixel-preserving copy of OCR input.
    const drawWidth = fixedSize?.width ?? sourceCanvas.width;
    const drawHeight = fixedSize?.height ?? sourceCanvas.height;

    if (target.width !== drawWidth || target.height !== drawHeight) {
      target.width = drawWidth;
      target.height = drawHeight;
    }

    tctx.imageSmoothingEnabled = false;
    tctx.webkitImageSmoothingEnabled = false;
    tctx.mozImageSmoothingEnabled = false;
    tctx.msImageSmoothingEnabled = false;
    tctx.clearRect(0, 0, target.width, target.height);
    tctx.drawImage(sourceCanvas, 0, 0, target.width, target.height);
  };

  const clearPreviewCanvas = (targetRef) => {
    const target = targetRef.current;
    if (!target) return;
    if (target.width !== 160 || target.height !== 28) {
      target.width = 160;
      target.height = 28;
    }
    const tctx = target.getContext("2d");
    if (!tctx) return;
    tctx.clearRect(0, 0, target.width, target.height);
  };

  useEffect(() => {
    drawOverlay();
  }, [expRegion, percentRegion]);

  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const onMouseDown = (e) => {
    if (interactionMode !== "select") return;
    const p = getCanvasPoint(e);
    dragStartRef.current = p;
    setDragging(true);
  };

  const onMouseMove = (e) => {
    if (interactionMode !== "select" || !dragging) return;

    const p = getCanvasPoint(e);
    const x1 = dragStartRef.current.x;
    const y1 = dragStartRef.current.y;

    const region = {
      x: Math.min(x1, p.x),
      y: Math.min(y1, p.y),
      width: Math.abs(p.x - x1),
      height: Math.abs(p.y - y1),
    };

    if (selectionMode === "exp") {
      setExpRegion(region);
    } else {
      setPercentRegion(region);
    }
  };

  const onMouseUp = () => {
    if (interactionMode !== "select") return;
    setDragging(false);
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
      viewport.scrollLeft = Math.max(0, centerX * ratio - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, centerY * ratio - viewport.clientHeight / 2);
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
    if (!stream || !e.ctrlKey) return;
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
    if (stream) return;
    resetZoom();
    setExpRegion(null);
    setPercentRegion(null);
    expStabilityRef.current = { pending: null, accepted: null };
    pctStabilityRef.current = { pending: null, accepted: null };
    acceptedRef.current = { expValue: null, expPercent: null };
  }, [stream]);

  useEffect(() => {
    if (!stream || !workerReady) return undefined;
    stopLoopRef.current = false;

    const run = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      if (video.readyState < 2) return;
      if (dragging) return;

      const expWorker = expWorkerRef.current;
      const pctWorker = pctWorkerRef.current;
      if (!expWorker || !pctWorker) return;

      if (!frameCanvasRef.current) {
        const fc = document.createElement("canvas");
        fc.width = video.videoWidth;
        fc.height = video.videoHeight;
        frameCanvasRef.current = fc;
        frameCtxRef.current = fc.getContext("2d");
      }

      const frameCanvas = frameCanvasRef.current;
      if (
        frameCanvas.width !== video.videoWidth ||
        frameCanvas.height !== video.videoHeight
      ) {
        frameCanvas.width = video.videoWidth;
        frameCanvas.height = video.videoHeight;
        frameCtxRef.current = frameCanvas.getContext("2d");
      }

      const frameCtx = frameCtxRef.current;
      if (!frameCtx) return;
      frameCtx.drawImage(video, 0, 0);

      const safeExpRegion = isValidRegion(expRegion)
        ? clampRegionToCanvas(expRegion, frameCanvas.width, frameCanvas.height)
        : null;
      const safePctRegion = isValidRegion(percentRegion)
        ? clampRegionToCanvas(percentRegion, frameCanvas.width, frameCanvas.height)
        : null;

      let updated = false;

      if (safeExpRegion) {
        const expRawPreview = getRawRegionCanvas({
          frameCanvas,
          region: safeExpRegion,
          targetCanvasRef: expPreviewRawCanvasRef,
          upscaleFactor: 2,
        });
        if (expRawPreview) {
          drawPreviewCanvas(expRawPreview, expPreviewCanvasRef);
          expPreviewSizeRef.current = {
            width: expPreviewCanvasRef.current?.width ?? 160,
            height: expPreviewCanvasRef.current?.height ?? 28,
          };
        }

        const expVariants = preprocessExpRegionVariants({
          frameCanvas,
          region: safeExpRegion,
          rawCanvasRef: expRawCanvasRef,
          variantCanvasRefs: expVariantCanvasRefs.current,
          variants: EXP_PREPROCESS_VARIANTS,
        });

        if (expVariants.length) {
          const expResult = await recognizeExpWithTesseractVariants(
            expWorker,
            expVariants,
            acceptedRef.current.expValue,
          );
          if (expResult?.canvas) {
            drawPreviewCanvas(
              expResult.canvas,
              expOptimizedPreviewCanvasRef,
              expPreviewSizeRef.current,
            );
          }
          if (
            expResult &&
            isPlausibleExp(expResult.expValue, acceptedRef.current.expValue)
          ) {
            const stableForwardExp = updateStableExpValue(
              expStabilityRef,
              expResult.expValue,
              acceptedRef.current.expValue,
            );
            if (Number.isFinite(stableForwardExp)) {
              acceptedRef.current.expValue = stableForwardExp;
              updated = true;
            }
          }
        }
      } else {
        clearPreviewCanvas(expPreviewCanvasRef);
        clearPreviewCanvas(expOptimizedPreviewCanvasRef);
      }

      if (safePctRegion) {
        const pctRawPreview = getRawRegionCanvas({
          frameCanvas,
          region: safePctRegion,
          targetCanvasRef: pctPreviewRawCanvasRef,
          upscaleFactor: 2,
        });
        if (pctRawPreview) {
          drawPreviewCanvas(pctRawPreview, pctPreviewCanvasRef);
          pctPreviewSizeRef.current = {
            width: pctPreviewCanvasRef.current?.width ?? 160,
            height: pctPreviewCanvasRef.current?.height ?? 28,
          };
        }

        const pctVariants = preprocessExpRegionVariants({
          frameCanvas,
          region: safePctRegion,
          rawCanvasRef: pctRawCanvasRef,
          variantCanvasRefs: pctVariantCanvasRefs.current,
          variants: PERCENT_PREPROCESS_VARIANTS,
        });

        if (pctVariants.length) {
          const pctResult = await recognizePercentWithTesseractVariants(
            pctWorker,
            pctVariants,
            acceptedRef.current.expPercent,
          );
          if (pctResult?.canvas) {
            drawPreviewCanvas(
              pctResult.canvas,
              pctOptimizedPreviewCanvasRef,
              pctPreviewSizeRef.current,
            );
          }
          if (pctResult) {
            console.debug("Percent OCR", {
              raw: pctResult.rawText,
              sanitized: pctResult.sanitizedPercentText ?? pctResult.sanitizedText,
              parsed: pctResult.expPercent,
              confidence: pctResult.confidence,
              variant: pctResult.variantId,
            });
            if (isPlausiblePercent(pctResult.expPercent)) {
              const stablePct = updateStablePercentValue(
                pctStabilityRef,
                pctResult.expPercent,
                acceptedRef.current.expPercent,
              );
              if (Number.isFinite(stablePct)) {
                acceptedRef.current.expPercent = stablePct;
                updated = true;
              }
            }
          }
        }
      } else {
        clearPreviewCanvas(pctPreviewCanvasRef);
        clearPreviewCanvas(pctOptimizedPreviewCanvasRef);
      }

      if (updated) {
        onReading?.({
          expNumber: acceptedRef.current.expValue,
          pct: acceptedRef.current.expPercent,
        });
      }

      if (safeExpRegion && !updated) {
        // Keep visibility into why metric can differ from what preview seems to show.
        // This helps tune variant scoring and outlier gates.
        console.debug("OCR accepted snapshot", {
          acceptedExp: acceptedRef.current.expValue,
          acceptedPercent: acceptedRef.current.expPercent,
        });
      }
    };

    const loop = async () => {
      if (stopLoopRef.current) return;

      if (!ocrBusyRef.current) {
        ocrBusyRef.current = true;
        try {
          await run();
        } catch (error) {
          console.error(error);
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
  }, [dragging, expRegion, onReading, percentRegion, stream, videoRef, workerReady]);

  return (
    <>
      <div className="ocr-region-toolbar">
        <div className="ocr-mode-toggle" role="group" aria-label={t("ocrRegionMode")}> 
          <button
            type="button"
            className={`ocr-mode-btn ${selectionMode === "exp" ? "ocr-mode-btn-active-exp" : ""}`}
            onClick={() => setSelectionMode("exp")}
            disabled={!stream}
          >
            {t("selectExpRegion")}
          </button>
          <button
            type="button"
            className={`ocr-mode-btn ${selectionMode === "percent" ? "ocr-mode-btn-active-percent" : ""}`}
            onClick={() => setSelectionMode("percent")}
            disabled={!stream}
          >
            {t("selectPercentRegion")}
          </button>
        </div>
        <div className="ocr-region-status-row">
          <span className={`ocr-region-chip ${regionStatus.exp ? "set" : "unset"}`}>
            {regionStatus.exp ? t("expRegionSet") : t("expRegionMissing")}
          </span>
          <span className={`ocr-region-chip ${regionStatus.percent ? "set" : "unset"}`}>
            {regionStatus.percent ? t("percentRegionSet") : t("percentRegionMissing")}
          </span>
        </div>
      </div>

      <div className="ocr-read-preview-grid">
        <div className="ocr-read-preview-card">
          <p className="ocr-read-preview-label">{t("selectExpRegion")}</p>
          <div className="ocr-read-preview-compare">
            <div className="ocr-read-preview-slot">
              <span className="ocr-read-preview-slot-label">Raw</span>
              <canvas
                ref={expPreviewCanvasRef}
                className="ocr-read-preview-canvas"
                width={160}
                height={28}
              />
            </div>
            <div className="ocr-read-preview-slot">
              <span className="ocr-read-preview-slot-label">Optimized</span>
              <canvas
                ref={expOptimizedPreviewCanvasRef}
                className="ocr-read-preview-canvas"
                width={160}
                height={28}
              />
            </div>
          </div>
        </div>
        <div className="ocr-read-preview-card">
          <p className="ocr-read-preview-label">{t("selectPercentRegion")}</p>
          <div className="ocr-read-preview-compare">
            <div className="ocr-read-preview-slot">
              <span className="ocr-read-preview-slot-label">Raw</span>
              <canvas
                ref={pctPreviewCanvasRef}
                className="ocr-read-preview-canvas"
                width={160}
                height={28}
              />
            </div>
            <div className="ocr-read-preview-slot">
              <span className="ocr-read-preview-slot-label">Optimized</span>
              <canvas
                ref={pctOptimizedPreviewCanvasRef}
                className="ocr-read-preview-canvas"
                width={160}
                height={28}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="zoom-toolbar">
        <div className="zoom-actions">
          <button
            className="control-btn control-btn-overlay"
            type="button"
            onClick={() => applyZoom(zoom - ZOOM_STEP)}
            disabled={!stream || zoom <= MIN_ZOOM}
          >
            {t("zoomOut")}
          </button>
          <button
            className="control-btn control-btn-overlay"
            type="button"
            onClick={() => applyZoom(zoom + ZOOM_STEP)}
            disabled={!stream || zoom >= MAX_ZOOM}
          >
            {t("zoomIn")}
          </button>
          <button
            className="control-btn control-btn-reset"
            type="button"
            onClick={resetZoom}
            disabled={!stream}
          >
            {t("resetZoom")}
          </button>
          <button
            className="control-btn control-btn-overlay"
            type="button"
            onClick={() =>
              setInteractionMode((prev) => (prev === "pan" ? "select" : "pan"))
            }
            disabled={!stream || zoom <= 1}
          >
            {interactionMode === "pan" ? t("switchToSelect") : t("enablePan")}
          </button>
        </div>
        <div className="zoom-meta">
          <span className="zoom-percent">{Math.round(zoom * 100)}%</span>
          <span className="zoom-hint">{t("zoomHint")}</span>
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
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              drawOverlay();
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
