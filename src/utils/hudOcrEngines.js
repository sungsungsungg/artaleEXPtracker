const DEFAULT_PREPROCESS = {
  upscaleFactor: 2,
  threshold: 160,
  contrast: 1.15,
  invert: false,
  applyThreshold: true,
  preprocessMode: "standard", // standard | brightness
  trimXRatio: 0,
  trimYRatio: 0,
  brightThreshold: 200, // simple brightness cutoff
  useAdaptiveBrightThreshold: false,
  brightTopPercent: 0.15, // keep top 15% brightest
  secondBrightBand: 20, // include near-bright edge pixels
  thirdBrightBand: 36, // include next-brightest anti-aliased pixels
  fourthBrightBand: 50, // include one more soft edge band
  nearWhiteTolerance: 38, // keep mostly neutral/white pixels
  thinStrokePasses: 0,
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

function preprocessBrightnessMask(canvas, cfg) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;

  const histogram = new Uint32Array(256);
  const pixelCount = canvas.width * canvas.height;
  const tolerance = Math.max(0, cfg.nearWhiteTolerance ?? 38);

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const brightness = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const colorDistance =
      Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
    if (colorDistance <= tolerance * 3) {
      histogram[brightness] += 1;
    }
  }

  let brightCutoff = Math.max(0, Math.min(255, cfg.brightThreshold ?? 200));
  if (cfg.useAdaptiveBrightThreshold) {
    const topPercent = Math.max(0.05, Math.min(0.3, cfg.brightTopPercent ?? 0.15));
    const target = Math.max(1, Math.floor(pixelCount * topPercent));
    let seen = 0;
    for (let b = 255; b >= 0; b -= 1) {
      seen += histogram[b];
      if (seen >= target) {
        brightCutoff = b;
        break;
      }
    }
  }

  const secondCutoff = Math.max(
    0,
    brightCutoff - Math.max(0, cfg.secondBrightBand ?? 20),
  );
  const thirdCutoff = Math.max(
    0,
    brightCutoff - Math.max(0, cfg.thirdBrightBand ?? 36),
  );
  const fourthCutoff = Math.max(
    0,
    brightCutoff - Math.max(0, cfg.fourthBrightBand ?? 50),
  );

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    const colorDistance =
      Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
    const nearWhite = colorDistance <= tolerance * 3;

    let value = 0;
    if (nearWhite && brightness >= brightCutoff) {
      value = 255;
    } else if (nearWhite && brightness >= secondCutoff) {
      value = 180;
    } else if (nearWhite && brightness >= thirdCutoff) {
      value = 120;
    } else if (nearWhite && brightness >= fourthCutoff) {
      value = 80;
    }

    if (cfg.invert) value = 255 - value;
    px[i] = value;
    px[i + 1] = value;
    px[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
}

function thinBinaryStrokes(canvas, passes = 1) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  if (width < 3 || height < 3) return;

  for (let pass = 0; pass < passes; pass += 1) {
    const image = ctx.getImageData(0, 0, width, height);
    const src = image.data;
    const out = new Uint8ClampedArray(src);

    const isWhite = (x, y) => src[(y * width + x) * 4] > 127;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = (y * width + x) * 4;
        if (src[idx] <= 127) continue;

        const n = isWhite(x, y - 1);
        const s = isWhite(x, y + 1);
        const e = isWhite(x + 1, y);
        const w = isWhite(x - 1, y);
        const ne = isWhite(x + 1, y - 1);
        const nw = isWhite(x - 1, y - 1);
        const se = isWhite(x + 1, y + 1);
        const sw = isWhite(x - 1, y + 1);

        const neighborCount = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0) +
          (ne ? 1 : 0) + (nw ? 1 : 0) + (se ? 1 : 0) + (sw ? 1 : 0);

        // Light thinning: remove only dense core pixels, preserve edges/decimal dots.
        if (neighborCount >= 6 && ((w && e) || (n && s))) {
          out[idx] = 0;
          out[idx + 1] = 0;
          out[idx + 2] = 0;
        }
      }
    }

    image.data.set(out);
    ctx.putImageData(image, 0, 0);
  }
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
  if (cfg.preprocessMode === "brightness") {
    preprocessBrightnessMask(processedCanvas, cfg);
  } else {
    preprocessGrayOrBinary(
      processedCanvas,
      cfg.threshold,
      cfg.contrast,
      cfg.invert,
      cfg.applyThreshold,
    );
  }
  if ((cfg.thinStrokePasses ?? 0) > 0 && cfg.applyThreshold !== false) {
    thinBinaryStrokes(processedCanvas, Math.max(1, cfg.thinStrokePasses));
  }

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

function sanitizePercentText(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (!normalized) return "";

  let dotSeen = false;
  let out = "";
  for (const ch of normalized) {
    if (ch === ".") {
      if (dotSeen) continue;
      dotSeen = true;
      out += ".";
    } else {
      out += ch;
    }
  }

  if (out.startsWith(".")) out = `0${out}`;
  return out;
}

export function parseExpValue(text, lastAccepted = null) {
  const clean = String(text || "").replace(/[^\d]/g, " ");
  const tokenStrings = (clean.match(/\d{3,}/g) || []).filter((t) => /^\d{4,}$/.test(t));
  if (!tokenStrings.length) return null;

  let narrowed = tokenStrings;
  if (Number.isFinite(lastAccepted)) {
    const expectedLen = String(Math.floor(Math.abs(lastAccepted))).length;
    const nearLen = tokenStrings.filter(
      (t) => Math.abs(t.length - expectedLen) <= 1,
    );
    if (nearLen.length) narrowed = nearLen;
  }

  const tokens = narrowed
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
  const clean = sanitizePercentText(text);
  if (!clean) return null;
  let normalized = clean;
  if (!normalized.includes(".")) {
    // Fallback for OCR missing dot: 6684 -> 66.84, 984 -> 9.84
    if (/^\d{3,4}$/.test(normalized)) {
      normalized = `${normalized.slice(0, normalized.length - 2)}.${normalized.slice(-2)}`;
    }
  }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return null;
  const val = Number(normalized);
  if (!Number.isFinite(val)) return null;
  if (val < 0 || val > 100) return null;
  return val;
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
    const expectedLen = Number.isFinite(lastAcceptedExp)
      ? String(Math.floor(Math.abs(lastAcceptedExp))).length
      : null;
    const resultLen = Number.isFinite(result.expValue)
      ? String(Math.floor(Math.abs(result.expValue))).length
      : 0;
    const lengthPenalty =
      expectedLen != null ? Math.min(30, Math.abs(resultLen - expectedLen) * 12) : 0;
    const brightnessBonus = variant.id?.includes("brightness") ? 8 : 0;

    const score =
      confidenceScore +
      (plausible ? 25 : -80) +
      Math.min(12, numericLen * 1.5) -
      deltaPenalty -
      lengthPenalty +
      brightnessBonus;

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
  const sanitizedPercentText = sanitizePercentText(raw);
  const parsedPercent = parsePercentValue(raw);

  return {
    rawText: raw,
    sanitizedText: sanitizeText(raw),
    sanitizedPercentText,
    expPercent: parsedPercent,
    confidence,
    canvas,
  };
}

export async function recognizePercentWithTesseractVariants(
  worker,
  variants,
  lastAcceptedPercent = null,
) {
  if (!variants?.length) return null;

  const candidates = [];
  for (const variant of variants) {
    const result = await recognizePercentWithTesseract(worker, variant.canvas);
    const plausible = isPlausiblePercent(result.expPercent);
    const confidenceScore = Number.isFinite(result.confidence) ? result.confidence : 0;

    let continuityPenalty = 0;
    if (Number.isFinite(lastAcceptedPercent) && Number.isFinite(result.expPercent)) {
      // Keep this light so a bad sticky value does not trap new valid reads.
      continuityPenalty = Math.min(4, Math.abs(result.expPercent - lastAcceptedPercent) * 0.08);
    }

    const sanitized = result.sanitizedPercentText || "";
    const dotIndex = sanitized.indexOf(".");
    const digitsBeforeDot =
      dotIndex >= 0 ? sanitized.slice(0, dotIndex).replace(/[^\d]/g, "").length : 0;
    const structureBonus =
      dotIndex >= 0
        ? digitsBeforeDot >= 2
          ? 8
          : 2
        : 0;

    const score =
      confidenceScore +
      (plausible ? 30 : -120) -
      continuityPenalty +
      (sanitized.includes(".") ? 6 : 0) +
      structureBonus +
      (variant.id?.includes("brightness") ? 6 : 0);

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

export function isPlausibleExp(expValue, lastAcceptedExp = null) {
  if (!Number.isFinite(expValue) || expValue < 1000) return false;
  if (!Number.isFinite(lastAcceptedExp)) return true;

  const delta = expValue - lastAcceptedExp;
  if (delta < 0) {
    // Small backward moves are usually OCR noise.
    // Large backward moves can represent a level-up reset.
    const dropRatio = Math.abs(delta) / Math.max(lastAcceptedExp, 1);
    return dropRatio >= 0.4;
  }
  // Do not hard-reject large forward jumps here; those are handled in
  // updateStableExpValue with repeat-confirmation to avoid lock-ups.
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

export function updateStablePercentValue(
  stabilityRef,
  nextValue,
  lastAcceptedPercent = null,
) {
  if (!Number.isFinite(nextValue)) return null;
  // Percent should recover immediately once OCR yields a valid in-range value.
  stabilityRef.current = { pending: null, accepted: nextValue, count: 0 };
  return nextValue;
}

export function updateStableExpValue(
  stabilityRef,
  nextValue,
  lastAcceptedExp = null,
) {
  if (!Number.isFinite(nextValue)) return null;
  const prev = stabilityRef.current ?? { pending: null, accepted: null, count: 0 };

  if (!Number.isFinite(lastAcceptedExp)) {
    if (prev.pending === nextValue) {
      const count = (prev.count ?? 1) + 1;
      stabilityRef.current = { pending: nextValue, accepted: prev.accepted, count };
      if (count >= 2) {
        stabilityRef.current = { pending: null, accepted: nextValue, count: 0 };
        return nextValue;
      }
      return null;
    }
    stabilityRef.current = { pending: nextValue, accepted: prev.accepted, count: 1 };
    return null;
  }

  const delta = nextValue - lastAcceptedExp;
  if (delta === 0) return lastAcceptedExp;

  if (delta > 0) {
    const largeJumpThreshold = Math.max(
      5_000_000,
      Math.floor(lastAcceptedExp * 0.1),
    );

    if (delta <= largeJumpThreshold) {
      // Normal forward updates should feel live.
      stabilityRef.current = { pending: null, accepted: nextValue, count: 0 };
      return nextValue;
    }

    // For unusually large forward jumps, require repeated confirmation
    // instead of hard-rejecting (prevents permanent stalls after bad outliers).
    const tolerance = Math.max(50000, Math.floor(nextValue * 0.02));
    if (Number.isFinite(prev.pending) && Math.abs(prev.pending - nextValue) <= tolerance) {
      const count = (prev.count ?? 1) + 1;
      stabilityRef.current = { pending: prev.pending, accepted: prev.accepted, count };
      if (count >= 2) {
        stabilityRef.current = { pending: null, accepted: nextValue, count: 0 };
        return nextValue;
      }
      return null;
    }

    stabilityRef.current = { pending: nextValue, accepted: prev.accepted, count: 1 };
    return null;
  }

  // Backward values (potential level-up reset) require repeated confirmation.
  const tolerance = Math.max(2000, Math.floor(lastAcceptedExp * 0.002));
  if (Number.isFinite(prev.pending) && Math.abs(prev.pending - nextValue) <= tolerance) {
    const count = (prev.count ?? 1) + 1;
    stabilityRef.current = { pending: prev.pending, accepted: prev.accepted, count };
    if (count >= 2) {
      stabilityRef.current = { pending: null, accepted: nextValue, count: 0 };
      return nextValue;
    }
    return null;
  }

  stabilityRef.current = { pending: nextValue, accepted: prev.accepted, count: 1 };
  return null;
}
