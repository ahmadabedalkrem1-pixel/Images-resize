// AI object removal: MI-GAN (Picsart AI Research) running in the browser with ONNX Runtime Web.
// Give it an image region and a mask of what to remove; it fills the masked pixels from what is
// around them, and every pixel outside the mask comes back exactly as it was. The runtime (~14MB)
// and the model (~28MB) load on first use; the model is then kept in the browser's storage.
window.Inpaint = (() => {
  const BASE = "vendor/inpaint/";
  const MODEL = "migan_pipeline_v2.onnx";
  const CACHE = "image-resizer-inpaint-v1";
  // Larger regions are reduced to this before filling. The model works at 512px inside, so this
  // loses nothing in the filled area and keeps each run to a few seconds.
  const MAX_REGION_SIDE = 2048;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load the AI component"));
    document.head.append(s);
  });

  // The model file, from the browser's storage when it was downloaded before.
  async function modelBytes(onProgress) {
    const url = new URL(BASE + MODEL, document.baseURI).href;
    let cache = null;
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    } catch { cache = null; /* no storage (private window, file://): just download */ }

    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error("Could not load the AI component");
    const total = Number(res.headers.get("content-length")) || 28079181;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(99, (got / total) * 100));
    }
    const bytes = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    try { await cache?.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })); } catch { /* storage full: fine */ }
    return bytes;
  }

  let session = null;
  // Load the runtime and the model once; onProgress gets the download percent.
  function ready(onProgress = () => {}) {
    session ||= (async () => {
      if (!window.ort) await loadScript(BASE + "ort.wasm.min.js");
      ort.env.wasm.wasmPaths = new URL(BASE, document.baseURI).href;
      ort.env.wasm.numThreads = 1;   // threads need special server headers that GitHub Pages lacks
      ort.env.wasm.proxy = true;     // run in a background worker so the page stays responsive
      const bytes = await modelBytes(onProgress);
      return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    })();
    session.catch(() => { session = null; });
    return session;
  }

  // Grow the hole by r pixels in every direction, so the edge of the object goes too.
  function dilate(hole, w, h, r) {
    if (r < 1) return hole;
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      const row = y * w;
      for (let x = 0; x < Math.min(r, w); x++) count += hole[row + x];
      for (let x = 0; x < w; x++) {
        if (x + r < w) count += hole[row + x + r];
        if (x - r - 1 >= 0) count -= hole[row + x - r - 1];
        tmp[row + x] = count > 0 ? 1 : 0;
      }
    }
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        if (y + r < h) count += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
        out[y * w + x] = count > 0 ? 1 : 0;
      }
    }
    return out;
  }

  // Fill the marked part of a region of an image.
  //   image: canvas with the whole image; mask: canvas of the same size, painted where to remove;
  //   box: {x, y, w, h} region to work on (the marks plus the surroundings the model may look at).
  // Writes the filled pixels into image and returns the ImageData that was there before (for undo).
  async function fill(image, mask, box) {
    const sess = await ready();
    const { x, y, w, h } = box;
    const ictx = image.getContext("2d", { willReadFrequently: true });
    const before = ictx.getImageData(x, y, w, h);
    const marks = mask.getContext("2d", { willReadFrequently: true }).getImageData(x, y, w, h).data;

    let hole = new Uint8Array(w * h);
    for (let i = 0; i < hole.length; i++) hole[i] = marks[i * 4 + 3] > 0 ? 1 : 0;
    hole = dilate(hole, w, h, Math.max(2, Math.round(Math.max(w, h) / 512)));

    // What the model sees: the region, reduced when it is very large.
    const s = Math.min(1, MAX_REGION_SIDE / Math.max(w, h));
    const mw = Math.max(1, Math.round(w * s)), mh = Math.max(1, Math.round(h * s));
    const src = document.createElement("canvas");
    src.width = mw; src.height = mh;
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(image, x, y, w, h, 0, 0, mw, mh);
    const px = sctx.getImageData(0, 0, mw, mh).data;
    const n = mw * mh;
    const rgb = new Uint8Array(3 * n), keep = new Uint8Array(n);
    for (let j = 0; j < mh; j++) {
      // A model pixel is in the hole if any region pixel it covers is.
      const y0 = Math.floor(j / s), y1 = Math.min(h, Math.ceil((j + 1) / s));
      for (let i = 0; i < mw; i++) {
        const k = j * mw + i;
        rgb[k] = px[k * 4]; rgb[n + k] = px[k * 4 + 1]; rgb[2 * n + k] = px[k * 4 + 2];
        let inHole = 0;
        if (s === 1) inHole = hole[k];
        else {
          const x0 = Math.floor(i / s), x1 = Math.min(w, Math.ceil((i + 1) / s));
          for (let yy = y0; yy < y1 && !inHole; yy++) for (let xx = x0; xx < x1; xx++) if (hole[yy * w + xx]) { inHole = 1; break; }
        }
        keep[k] = inHole ? 0 : 255;
      }
    }

    const out = await sess.run({
      image: new ort.Tensor("uint8", rgb, [1, 3, mh, mw]),
      mask: new ort.Tensor("uint8", keep, [1, 1, mh, mw]),
    });
    const res = out.result.data;

    // Back to the region's size (when it was reduced).
    const filled = sctx.createImageData(mw, mh);
    for (let k = 0; k < n; k++) {
      filled.data[k * 4] = res[k]; filled.data[k * 4 + 1] = res[n + k]; filled.data[k * 4 + 2] = res[2 * n + k];
      filled.data[k * 4 + 3] = 255;
    }
    sctx.putImageData(filled, 0, 0);
    let full = filled.data;
    if (s < 1) {
      const up = document.createElement("canvas");
      up.width = w; up.height = h;
      const uctx = up.getContext("2d", { willReadFrequently: true });
      uctx.imageSmoothingQuality = "high";
      uctx.drawImage(src, 0, 0, w, h);
      full = uctx.getImageData(0, 0, w, h).data;
    }

    // Only the hole changes; transparency stays as it was.
    const after = new ImageData(new Uint8ClampedArray(before.data), w, h);
    const d = after.data;
    for (let k = 0; k < w * h; k++) {
      if (!hole[k]) continue;
      d[k * 4] = full[k * 4]; d[k * 4 + 1] = full[k * 4 + 1]; d[k * 4 + 2] = full[k * 4 + 2];
    }
    ictx.putImageData(after, x, y);
    return before;
  }

  return { ready, fill };
})();
