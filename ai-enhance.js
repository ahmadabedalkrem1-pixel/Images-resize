// AI quality enhancement: Real-ESRGAN (general, 4×) running in the browser with TensorFlow.js.
// It redraws a small or heavily compressed image at 4× the size, restoring sharp edges and removing
// JPEG blocks. The model (~2.4MB) and TensorFlow.js (~1.4MB) load on first use; the model is then
// kept in the browser's storage for next time.
window.AiEnhance = (() => {
  // Larger inputs are scaled down first: the output (4×) is already bigger than any size we make,
  // and the run time grows with the number of pixels.
  const MAX_INPUT_SIDE = 1024;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("לא ניתן לטעון את רכיב ה-AI"));
    document.head.append(s);
  });

  let upscaler = null;
  function ready() {
    upscaler ||= (async () => {
      await loadScript("vendor/ai/tf.min.js");
      await loadScript("vendor/ai/webupscaler.js");
      // eslint-disable-next-line no-undef -- defined by webupscaler.js
      const u = new WebUpscaler({
        modelType: "realesrgan", model: "general_fast", scale: 4,
        backend: "webgl", modelBaseUrl: "vendor/ai/models",
      });
      await u.warmup();
      return u;
    })();
    upscaler.catch(() => { upscaler = null; });
    return upscaler;
  }

  // Enhance an image; resolves with an ImageBitmap 4× the (possibly reduced) input size.
  async function enhance(source, onProgress = () => {}) {
    const u = await ready();
    const s = Math.min(1, MAX_INPUT_SIDE / Math.max(source.width, source.height));
    const c = document.createElement("canvas");
    c.width = Math.round(source.width * s);
    c.height = Math.round(source.height * s);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const input = await new Promise((r) => c.toBlob(r, "image/png"));
    const output = await u.upscale(input, { format: "png", onProgress });
    return createImageBitmap(output);
  }

  return { enhance };
})();
