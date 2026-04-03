const DEFAULT_PREPROCESS = {
  upscaleFactor: 2,
  threshold: 160,
  contrast: 1.15,
  invert: false,
  applyThreshold: true,
  trimXRatio: 0,
  trimYRatio: 0,
};

function ensureCanvasSize(canvasRef, width, height) {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));
  let canvas = canvasRef.current;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvasRef.current = canvas;
  }
  if (canvas.width !== safeW || canvas.height !== safeH) {
    canvas.width = safeW;
    canvas.height = safeH;
  }
  return canvas;
}

function setNearestNeighbor(ctx) {
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.msImageSmoothingEnabled = false;
}

export function getRawRegionCanvas({
  frameCanvas,
  region,
  targetCanvasRef,
  upscaleFactor = 1,
}) {
  if (!region) return null;
  const sx = Math.max(0, Math.floor(region.x));
  const sy = Math.max(0, Math.floor(region.y));
  const sw = Math.max(1, Math.floor(region.width));
  const sh = Math.max(1, Math.floor(region.height));

  if (
    sx + sw > frameCanvas.width ||
    sy + sh > frameCanvas.height ||
    sw < 2 ||
    sh < 2
  ) {
    return null;
  }

  const upW = Math.max(1, Math.round(sw * upscaleFactor));
  const upH = Math.max(1, Math.round(sh * upscaleFactor));
  const canvas = ensureCanvasSize(targetCanvasRef, upW, upH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  setNearestNeighbor(ctx);
  ctx.clearRect(0, 0, upW, upH);
  ctx.drawImage(frameCanvas, sx, sy, sw, sh, 0, 0, upW, upH);
  return canvas;
}

function preprocessGrayOrBinary(canvas, threshold, contrast, invert, applyThreshold) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const safeContrast = Math.max(0, contrast ?? 1);

  for (let i = 0; i < px.length; i += 4) {
    const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const contrasted = (gray - 128) * safeContrast + 128;
    let value = contrasted;
    if (applyThreshold) {
      value = contrasted >= threshold ? 255 : 0;
    }
    if (invert) value = 255 - value;
    px[i] = value;
    px[i + 1] = value;
    px[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
}

export function preprocessOcrRegion({
  frameCanvas,
  region,
  rawCanvasRef,
  processedCanvasRef,
  config = DEFAULT_PREPROCESS,
}) {
  if (!region) return null;
  const cfg = { ...DEFAULT_PREPROCESS, ...config };
  const trimX = Math.floor(region.width * (cfg.trimXRatio ?? 0));
  const trimY = Math.floor(region.height * (cfg.trimYRatio ?? 0));
  const sx = Math.max(0, Math.floor(region.x + trimX));
  const sy = Math.max(0, Math.floor(region.y + trimY));
  const sw = Math.max(1, Math.floor(region.width - trimX * 2));
  const sh = Math.max(1, Math.floor(region.height - trimY * 2));

  if (
    sx + sw > frameCanvas.width ||
    sy + sh > frameCanvas.height ||
    sw < 4 ||
    sh < 4
  ) {
    return null;
  }

  const rawCanvas = ensureCanvasSize(rawCanvasRef, sw, sh);
  const rawCtx = rawCanvas.getContext("2d");
  if (!rawCtx) return null;
  rawCtx.drawImage(frameCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  const upW = Math.round(sw * cfg.upscaleFactor);
  const upH = Math.round(sh * cfg.upscaleFactor);
  const processedCanvas = ensureCanvasSize(processedCanvasRef, upW, upH);
  const processedCtx = processedCanvas.getContext("2d");
  if (!processedCtx) return null;

  setNearestNeighbor(processedCtx);
  processedCtx.drawImage(rawCanvas, 0, 0, upW, upH);
  preprocessGrayOrBinary(
    processedCanvas,
    cfg.threshold,
    cfg.contrast,
    cfg.invert,
    cfg.applyThreshold,
  );

  return processedCanvas;
}

export function preprocessExpRegionVariants({
  frameCanvas,
  region,
  rawCanvasRef,
  variantCanvasRefs,
  variants,
}) {
  if (!Array.isArray(variants) || variants.length === 0) return [];

  const outputs = [];
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    const normalizedVariant = {
      ...variant,
      // Keep integer, bounded upscales for pixel-font stability.
      upscaleFactor: Math.max(
        1,
        Math.min(3, Math.round(Number(variant.upscaleFactor ?? 1))),
      ),
    };
    const processedCanvasRef =
      variantCanvasRefs[i] ?? (variantCanvasRefs[i] = { current: null });
    const canvas = preprocessOcrRegion({
      frameCanvas,
      region,
      rawCanvasRef,
      processedCanvasRef,
      config: normalizedVariant,
    });
    if (canvas) {
      outputs.push({
        id: variant.id || `variant-${i}`,
        canvas,
        config: normalizedVariant,
      });
    }
  }
  return outputs;
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/[^\d.,%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseExpValue(text, lastAccepted = null) {
  const clean = String(text || "").replace(/[^\d]/g, " ");
  const tokens = (clean.match(/\d{3,}/g) || [])
    .filter((t) => /^\d{4,}$/.test(t))
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n));
  if (!tokens.length) return null;

  if (!Number.isFinite(lastAccepted)) {
    return tokens[0];
  }

  return tokens.reduce((best, candidate) => {
    const bestDelta = Math.abs(best - lastAccepted);
    const candDelta = Math.abs(candidate - lastAccepted);
    return candDelta < bestDelta ? candidate : best;
  }, tokens[0]);
}

export function parsePercentValue(text) {
  const clean = String(text || "").replace(/[^\d.]/g, "");
  const decimal = clean.match(/(\d{1,3}\.\d{1,2})/);
  if (decimal) {
    const val = Number(decimal[1]);
    return Number.isFinite(val) ? val : null;
  }

  const digits = clean.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length >= 3 && digits.length <= 4) {
    const val = Number(`${digits.slice(0, digits.length - 2)}.${digits.slice(-2)}`);
    return Number.isFinite(val) ? val : null;
  }
  if (digits.length <= 2) {
    const val = Number(digits);
    return Number.isFinite(val) ? val : null;
  }
  return null;
}

export async function recognizeExpWithTesseract(worker, canvas, lastAcceptedExp) {
  const result = await worker.recognize(canvas);
  const raw = result?.data?.text || "";
  const confidence = Number.isFinite(result?.data?.confidence)
    ? result.data.confidence
    : null;

  return {
    rawText: raw,
    sanitizedText: sanitizeText(raw),
    expValue: parseExpValue(raw, lastAcceptedExp),
    confidence,
  };
}

export async function recognizeExpWithTesseractVariants(
  worker,
  variants,
  lastAcceptedExp,
) {
  if (!variants?.length) return null;

  const candidates = [];
  for (const variant of variants) {
    const result = await recognizeExpWithTesseract(
      worker,
      variant.canvas,
      lastAcceptedExp,
    );
    const numericLen = result.expValue ? String(result.expValue).length : 0;
    const confidenceScore = Number.isFinite(result.confidence)
      ? result.confidence
      : 0;
    const plausible = isPlausibleExp(result.expValue, lastAcceptedExp);
    const deltaPenalty =
      Number.isFinite(lastAcceptedExp) && Number.isFinite(result.expValue)
        ? Math.min(25, Math.abs(result.expValue - lastAcceptedExp) / 100000)
        : 0;

    const score =
      confidenceScore +
      (plausible ? 25 : -80) +
      Math.min(12, numericLen * 1.5) -
      deltaPenalty;

    candidates.push({
      ...result,
      score,
      variantId: variant.id,
      canvas: variant.canvas,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

export async function recognizePercentWithTesseract(worker, canvas) {
  const result = await worker.recognize(canvas);
  const raw = result?.data?.text || "";
  const confidence = Number.isFinite(result?.data?.confidence)
    ? result.data.confidence
    : null;

  return {
    rawText: raw,
    sanitizedText: sanitizeText(raw),
    expPercent: parsePercentValue(raw),
    confidence,
  };
}

export function isPlausibleExp(expValue, lastAcceptedExp = null) {
  if (!Number.isFinite(expValue) || expValue < 1000) return false;
  if (!Number.isFinite(lastAcceptedExp)) return true;

  const delta = expValue - lastAcceptedExp;
  if (delta < -1000) return false;
  const maxJump = Math.max(5_000_000, Math.floor(lastAcceptedExp * 0.1));
  if (delta > maxJump) return false;
  return true;
}

export function isPlausiblePercent(expPercent) {
  return (
    Number.isFinite(expPercent) &&
    expPercent >= 0 &&
    expPercent <= 100
  );
}

export function updateStableNumericValue(stabilityRef, nextValue) {
  if (!Number.isFinite(nextValue)) return null;
  const prev = stabilityRef.current ?? { pending: null, accepted: null };

  if (!Number.isFinite(prev.pending) || prev.pending !== nextValue) {
    stabilityRef.current = { pending: nextValue, accepted: prev.accepted };
    return null;
  }

  stabilityRef.current = { pending: null, accepted: nextValue };
  return nextValue;
}
