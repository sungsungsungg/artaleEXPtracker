import Tesseract from "tesseract.js";

export default async function startCaptureAndReadExp(stream, x, y, w, h) {
  // const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // Set these once you know the capture resolution
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  // Repeatedly OCR a cropped region where EXP appears
  setInterval(async () => {
    ctx.drawImage(video, 0, 0);

    // Crop only the HUD area containing EXP (you must tune these)
    const crop = ctx.getImageData(x, y, w, h);

    // Put crop into an offscreen canvas for OCR
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = w;
    cropCanvas.height = h;
    cropCanvas.getContext("2d").putImageData(crop, 0, 0);

    const { data } = await Tesseract.recognize(cropCanvas, "eng", {
      tessedit_char_whitelist: "0123456789EXPexp:+/[].%",
    });

    const text = data.text;
    const exp = text.match(/(\d[\d,]*)/); // crude: first number
    console.log("OCR raw:", text, "EXP:", exp?.[1]?.replaceAll(",", ""));
  }, 1000);

  return exp;
}
