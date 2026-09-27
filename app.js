(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $("dropzone"), fileInput: $("fileInput"), fileList: $("fileList"),
    preset: $("preset"), customSize: $("customSize"), customW: $("customW"), customH: $("customH"),
    keepRatio: $("keepRatio"), fit: $("fit"), fitNote: $("fitNote"),
    bgMode: $("bgMode"), bg: $("bg"), bgNote: $("bgNote"), bgHint: $("bgHint"),
    format: $("format"), quality: $("quality"), qualityField: $("qualityField"), maxKB: $("maxKB"),
    processBtn: $("processBtn"), resultsCard: $("resultsCard"), results: $("results"), zipBtn: $("zipBtn"),
  };

  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  const SETTINGS_KEY = "image-resizer-settings-v3";
  const SAVED_FIELDS = ["preset", "customW", "customH", "fit", "bgMode", "bg", "format", "quality", "maxKB"];

  const FIT_NOTES = {
    auto: "מוצר על רקע חלק או לוגו שקוף: ממורכז בתוך הגודל עם שוליים, בלי לחתוך אותו. תמונה רגילה: ממלאת את כל הגודל, והשוליים העודפים נחתכים מהצדדים באופן שווה.",
    cover: "התמונה ממלאת את כל הגודל, והחלקים שבולטים מחוץ לו נחתכים.",
    contain: "כל התמונה נכנסת בלי חיתוך, והשטח שנשאר ממולא בצבע הרקע.",
    stretch: "התמונה נמתחת בדיוק לגודל. בלי חיתוך ובלי רקע, אבל עלולה להיראות מעוותת.",
  };

  // Empty space kept around a centred product, as a share of the shorter side.
  const PRODUCT_MARGIN = 0.05;
  // Background detection works on at most this many pixels on the long side, to keep memory in check.
  const MAX_WORK_SIDE = 3000;
  // Flood-fill tolerances: max colour step between neighbouring pixels, max drift from the edge
  // pixel the fill started at, max tint difference from the edge colour.
  const STEP_TOL = 24, DRIFT_TOL = 100, TINT_TOL = 18;

  const resizer = typeof pica === "function" ? pica() : null;

  let files = [];
  let results = [];

  // ---------- Setup ----------

  function fillPresets() {
    els.preset.add(new Option("גודל מקורי של התמונה", "original"));
    PRESETS.forEach((p, i) => {
      els.preset.add(new Option(`${p.name} — ${p.width}×${p.height}`, String(i)));
    });
    els.preset.add(new Option("כל הגדלים ברשימה", "all"));
    els.preset.add(new Option("גודל מותאם (Custom)…", "custom"));
  }

  async function updateOriginalLabel() {
    const opt = els.preset.querySelector('option[value="original"]');
    if (files.length !== 1) {
      opt.textContent = files.length > 1 ? "גודל מקורי של כל תמונה" : "גודל מקורי של התמונה";
      return;
    }
    try {
      const b = await createImageBitmap(files[0]);
      opt.textContent = `גודל מקורי של התמונה — ${b.width}×${b.height}`;
      b.close();
    } catch { /* unreadable file; keep the generic label */ }
  }

  async function disableUnsupportedFormats() {
    for (const opt of els.format.options) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const blob = await new Promise((r) => c.toBlob(r, opt.value));
      if (!blob || blob.type !== opt.value) {
        opt.disabled = true;
        opt.textContent += " (לא נתמך בדפדפן הזה)";
      }
    }
    if (els.format.selectedOptions[0]?.disabled) els.format.value = "image/jpeg";
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      SAVED_FIELDS.forEach((k) => {
        if (s[k] == null) return;
        const el = els[k];
        if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === s[k] && !o.disabled)) return;
        el.value = s[k];
      });
      if (s.keepRatio != null) els.keepRatio.checked = s.keepRatio;
    } catch { /* storage unavailable */ }
  }

  function saveSettings() {
    try {
      const s = { keepRatio: els.keepRatio.checked };
      SAVED_FIELDS.forEach((k) => (s[k] = els[k].value));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch { /* storage unavailable */ }
  }

  function updateVisibility() {
    const custom = els.preset.value === "custom";
    els.customSize.hidden = !custom;
    els.customH.disabled = custom && els.keepRatio.checked;
    els.fitNote.textContent = FIT_NOTES[els.fit.value];
    els.bg.hidden = els.bgMode.value !== "custom";
    els.bgNote.hidden = els.bgMode.value === "original";
    els.bgHint.hidden = !(els.bgMode.value === "transparent" && els.format.value === "image/jpeg");
    els.qualityField.hidden = els.format.value === "image/png";
  }

  // ---------- Files ----------

  function addFiles(list) {
    for (const f of list) if (f.type.startsWith("image/")) files.push(f);
    renderFileList();
  }

  function renderFileList() {
    els.fileList.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.textContent = f.name;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.title = "הסרה";
      rm.onclick = () => { files.splice(i, 1); renderFileList(); };
      li.append(rm);
      els.fileList.append(li);
    });
    els.processBtn.disabled = files.length === 0;
    updateOriginalLabel();
  }

  // ---------- Background detection ----------

  function toCanvas(src, maxSide = Infinity) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * s);
    c.height = Math.round(src.height * s);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function hasTransparency(canvas) {
    const d = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  // Make a plain photo background (white, grey studio backdrop…) transparent: flood-fill from
  // the image edges, following pixels that change only gradually (so gradients and vignettes are
  // followed) and stay close to the edge colour (so the fill can't leak into the product). A tint
  // check stops it at coloured pixels, so bright reflections on the product are kept.
  // Returns false and leaves the canvas untouched when the edges aren't a plain background.
  function removePlainBackground(canvas) {
    const w = canvas.width, h = canvas.height, n = w * h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    const median = (c) => {
      const vals = border.map((p) => d[p * 4 + c]).sort((a, b) => a - b);
      return vals[vals.length >> 1];
    };
    const er = median(0), eg = median(1), eb = median(2);
    const tintOff = (i) => Math.hypot(d[i] - d[i + 1] - (er - eg), d[i + 1] - d[i + 2] - (eg - eb));
    const dist = (i, r, g, b) => Math.hypot(d[i] - r, d[i + 1] - g, d[i + 2] - b);

    const isBg = new Uint8Array(n);
    const seed = new Uint8Array(n * 3); // edge colour each filled pixel descends from
    const queue = new Int32Array(n);
    let tail = 0;
    for (const p of border) {
      const i = p * 4;
      if (isBg[p] || dist(i, er, eg, eb) > DRIFT_TOL || tintOff(i) > TINT_TOL) continue;
      isBg[p] = 1;
      seed[p * 3] = d[i]; seed[p * 3 + 1] = d[i + 1]; seed[p * 3 + 2] = d[i + 2];
      queue[tail++] = p;
    }
    for (let head = 0; head < tail; head++) {
      const p = queue[head], x = p % w, pi = p * 4;
      const sr = seed[p * 3], sg = seed[p * 3 + 1], sb = seed[p * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? (p >= w ? p - w : -1)
          : k === 1 ? (p + w < n ? p + w : -1)
          : k === 2 ? (x > 0 ? p - 1 : -1)
          : (x < w - 1 ? p + 1 : -1);
        if (q < 0 || isBg[q]) continue;
        const qi = q * 4;
        if (dist(qi, d[pi], d[pi + 1], d[pi + 2]) > STEP_TOL) continue;
        if (dist(qi, sr, sg, sb) > DRIFT_TOL || tintOff(qi) > TINT_TOL) continue;
        isBg[q] = 1;
        seed[q * 3] = sr; seed[q * 3 + 1] = sg; seed[q * 3 + 2] = sb;
        queue[tail++] = q;
      }
    }

    // Only a plain background covers (almost) the whole edge; a regular photo doesn't.
    const edgeCovered = border.filter((p) => isBg[p]).length / border.length;
    const removed = tail / n;
    if (edgeCovered < 0.8 || removed < 0.03 || removed > 0.97) return false;

    // Drop JPEG noise specks left in the background, so they don't throw off the centring.
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (isBg[p]) continue;
        let fg = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) fg += isBg[p + dy * w + dx] ? 0 : 1;
        if (fg <= 3) isBg[p] = 1;
      }
    }

    // Soften the cut: a product pixel's opacity is the share of its 3×3 neighbourhood that is
    // product, which anti-aliases the outline instead of leaving a jagged edge.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (isBg[p]) { d[p * 4 + 3] = 0; continue; }
        let fg = 0, total = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            total++;
            if (!isBg[yy * w + xx]) fg++;
          }
        }
        if (fg < total) d[p * 4 + 3] = Math.round((d[p * 4 + 3] * fg) / total);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return true;
  }

  // Bounding box of the visible (non-transparent) content.
  function contentBox(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] < 24) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Decide how to treat one uploaded image:
  // - a transparent PNG (logo, cut-out product) is a "product" as is;
  // - when a new background was chosen and the photo has a plain background, that background
  //   is removed and the image becomes a "product";
  // - anything else is a regular photo.
  function prepare(bitmap, bgMode, isJpegFile) {
    if (!isJpegFile) {
      const c = toCanvas(bitmap);
      if (hasTransparency(c)) return { src: c, product: true, box: contentBox(c) };
    }
    if (bgMode === "original") return { src: bitmap, product: false };

    const c = toCanvas(bitmap, MAX_WORK_SIDE);
    if (removePlainBackground(c)) {
      return { src: c, product: true, box: contentBox(c), replaced: true };
    }
    return {
      src: bitmap, product: false,
      note: "לא זוהה רקע חלק ואחיד, לכן הרקע המקורי נשאר", warn: true,
    };
  }

  // ---------- Layout & resizing ----------

  function getTargets(img) {
    const v = els.preset.value;
    if (v === "original") return [{ name: "Original", width: img.width, height: img.height }];
    if (v === "all") return PRESETS;
    if (v !== "custom") return [PRESETS[Number(v)]];
    const w = parseInt(els.customW.value, 10);
    let h = parseInt(els.customH.value, 10);
    if (els.keepRatio.checked && w > 0) h = Math.round((w * img.height) / img.width);
    if (!(w > 0 && h > 0)) throw new Error("יש להזין רוחב וגובה");
    return [{ name: "Custom", width: w, height: h }];
  }

  // Where the source region lands in the W×H output: {sx,sy,sw,sh} → {dx,dy,dw,dh}.
  function layout(prep, W, H, fit, keepWhole) {
    const iw = prep.src.width, ih = prep.src.height;
    const whole = { sx: 0, sy: 0, sw: iw, sh: ih };
    if (keepWhole || fit === "stretch") return { ...whole, dx: 0, dy: 0, dw: W, dh: H };

    const mode = fit === "auto" ? (prep.product ? "product" : "cover") : fit;
    if (mode === "cover") {
      const s = Math.max(W / iw, H / ih);
      const sw = W / s, sh = H / s;
      return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: 0, dy: 0, dw: W, dh: H };
    }
    // "contain" fits the whole image; "product" fits just the product, with a margin around it.
    const box = mode === "product" ? { sx: prep.box.x, sy: prep.box.y, sw: prep.box.w, sh: prep.box.h } : whole;
    const m = mode === "product" ? Math.round(Math.min(W, H) * PRODUCT_MARGIN) : 0;
    const s = Math.min((W - 2 * m) / box.sw, (H - 2 * m) / box.sh);
    const dw = Math.max(1, Math.round(box.sw * s)), dh = Math.max(1, Math.round(box.sh * s));
    return { ...box, dx: Math.round((W - dw) / 2), dy: Math.round((H - dh) / 2), dw, dh };
  }

  // Fallback when pica isn't available: downscale in halving steps so large reductions stay sharp.
  function drawHalving(ctx, src, dw, dh) {
    let cur = src, sw = src.width, sh = src.height;
    while (sw / 2 >= dw && sh / 2 >= dh) {
      const c = document.createElement("canvas");
      c.width = Math.round(sw / 2);
      c.height = Math.round(sh / 2);
      const cctx = c.getContext("2d");
      cctx.imageSmoothingQuality = "high";
      cctx.drawImage(cur, 0, 0, c.width, c.height);
      cur = c; sw = c.width; sh = c.height;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, dw, dh);
  }

  async function render(prep, W, H, L, bg) {
    // 1. Cut out the source region (flattened onto the background when it's opaque, so
    //    semi-transparent edges blend into the final colour rather than into black).
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(L.sw));
    crop.height = Math.max(1, Math.round(L.sh));
    const cctx = crop.getContext("2d");
    if (bg) { cctx.fillStyle = bg; cctx.fillRect(0, 0, crop.width, crop.height); }
    cctx.drawImage(prep.src, L.sx, L.sy, L.sw, L.sh, 0, 0, crop.width, crop.height);

    // 2. High-quality resample (pica's default filter includes Photoshop-style sharpening).
    const scaled = document.createElement("canvas");
    scaled.width = L.dw;
    scaled.height = L.dh;
    if (resizer) await resizer.resize(crop, scaled);
    else drawHalving(scaled.getContext("2d"), crop, L.dw, L.dh);

    // 3. Place it on the final canvas.
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d");
    if (bg) { octx.fillStyle = bg; octx.fillRect(0, 0, W, H); }
    octx.drawImage(scaled, L.dx, L.dy);
    return out;
  }

  // Colour to fill behind the image, or null to keep transparency (JPEG can't, so white there).
  function backgroundColor(type) {
    const mode = els.bgMode.value;
    const color = mode === "white" ? "#ffffff" : mode === "custom" ? els.bg.value : null;
    return color || (type === "image/jpeg" ? "#ffffff" : null);
  }

  const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  // Encode at the chosen quality; if a KB limit is set and exceeded, binary-search
  // the highest quality that still fits.
  async function encode(canvas, type, quality, maxBytes) {
    const blob = await toBlob(canvas, type, quality);
    if (!maxBytes || blob.size <= maxBytes) return { blob, fits: true, quality };
    if (type === "image/png") return { blob, fits: false, quality: 1 };

    let lo = 0.05, hi = quality, best = null, bestQ = 0;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const b = await toBlob(canvas, type, mid);
      if (b.size <= maxBytes) { best = b; bestQ = mid; lo = mid; } else { hi = mid; }
    }
    if (best) return { blob: best, fits: true, quality: bestQ };
    const smallest = await toBlob(canvas, type, 0.05);
    return { blob: smallest, fits: smallest.size <= maxBytes, quality: 0.05 };
  }

  function safeName(s) {
    return s.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "image";
  }

  async function processAll() {
    saveSettings();
    clearResults();
    els.processBtn.disabled = true;
    els.processBtn.textContent = "מעבד…";

    const type = els.format.value;
    const quality = parseFloat(els.quality.value);
    const maxBytes = parseFloat(els.maxKB.value) > 0 ? parseFloat(els.maxKB.value) * 1024 : 0;
    const keepWhole = els.preset.value === "original" || (els.preset.value === "custom" && els.keepRatio.checked);
    const bg = backgroundColor(type);
    const usedNames = new Set();

    try {
      for (const file of files) {
        const bitmap = await createImageBitmap(file);
        const prep = prepare(bitmap, els.bgMode.value, file.type === "image/jpeg");
        for (const t of getTargets(bitmap)) {
          const L = layout(prep, t.width, t.height, els.fit.value, keepWhole);
          const canvas = await render(prep, t.width, t.height, L, bg);
          const limit = maxBytes || (t.maxKB ? t.maxKB * 1024 : 0);
          const out = await encode(canvas, type, quality, limit);

          let name = `${safeName(file.name)}_${t.width}x${t.height}`;
          for (let n = 2; usedNames.has(name); n++) name = `${safeName(file.name)}_${t.width}x${t.height}_${n}`;
          usedNames.add(name);
          name += "." + EXT[type];

          const note = prep.replaced
            ? (keepWhole || els.fit.value !== "auto" ? "הרקע הוחלף" : "הרקע הוחלף והמוצר מורכז")
            : prep.note;
          results.push({ ...out, name, label: t.name, width: t.width, height: t.height, limit, note, warn: prep.warn });
        }
        bitmap.close();
      }
      renderResults();
    } catch (err) {
      alert(err.message || "שגיאה בעיבוד התמונה");
    } finally {
      els.processBtn.disabled = files.length === 0;
      els.processBtn.textContent = "שינוי גודל";
    }
  }

  // ---------- Results ----------

  function clearResults() {
    results.forEach((r) => r.url && URL.revokeObjectURL(r.url));
    results = [];
    els.results.innerHTML = "";
    els.resultsCard.hidden = true;
  }

  function formatKB(bytes) {
    return `<bdi>${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB</bdi>`;
  }

  function renderResults() {
    for (const r of results) {
      r.url = URL.createObjectURL(r.blob);
      const div = document.createElement("div");
      div.className = "result";

      let sizeNote = "";
      if (r.limit) {
        sizeNote = r.fits
          ? ` ✓ מתחת ל-<bdi>${Math.round(r.limit / 1024)} KB</bdi>`
          : ` ⚠ מעל <bdi>${Math.round(r.limit / 1024)} KB</bdi>` +
            (r.blob.type === "image/png" ? " — PNG לא נדחס, נסו JPEG/WebP" : "");
      }
      const qNote = r.blob.type !== "image/png" ? ` · איכות ${Math.round(r.quality * 100)}%` : "";

      div.innerHTML = `
        <div class="thumb"><img alt=""></div>
        <div class="meta">
          <div class="name"></div>
          <div>${r.label} · ${r.width}×${r.height}</div>
          <div class="size ${r.limit ? (r.fits ? "ok" : "warn") : ""}">${formatKB(r.blob.size)}${qNote}${sizeNote}</div>
          <div class="info ${r.warn ? "warn" : ""}"></div>
          <a download>הורדה</a>
        </div>`;
      div.querySelector("img").src = r.url;
      div.querySelector(".name").textContent = r.name;
      const info = div.querySelector(".info");
      info.textContent = r.note || "";
      info.hidden = !r.note;
      const a = div.querySelector("a");
      a.href = r.url;
      a.download = r.name;
      els.results.append(div);
    }
    els.zipBtn.hidden = results.length < 2 || typeof JSZip === "undefined";
    els.resultsCard.hidden = results.length === 0;
    els.resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function downloadZip() {
    const zip = new JSZip();
    results.forEach((r) => zip.file(r.name, r.blob));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resized-images.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Events ----------

  els.fileInput.addEventListener("change", () => { addFiles(els.fileInput.files); els.fileInput.value = ""; });
  ["dragenter", "dragover"].forEach((e) =>
    els.dropzone.addEventListener(e, (ev) => { ev.preventDefault(); els.dropzone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) =>
    els.dropzone.addEventListener(e, (ev) => { ev.preventDefault(); els.dropzone.classList.remove("over"); }));
  els.dropzone.addEventListener("drop", (ev) => addFiles(ev.dataTransfer.files));
  // Allow pasting an image from the clipboard (e.g. a screenshot).
  document.addEventListener("paste", (ev) => addFiles([...ev.clipboardData.files]));

  // A transparent background needs a format that supports it.
  els.bgMode.addEventListener("change", () => {
    if (els.bgMode.value === "transparent" && els.format.value === "image/jpeg") els.format.value = "image/png";
  });
  [els.preset, els.fit, els.format, els.keepRatio, els.bgMode].forEach((el) => el.addEventListener("change", updateVisibility));
  els.processBtn.addEventListener("click", processAll);
  els.zipBtn.addEventListener("click", downloadZip);

  fillPresets();
  disableUnsupportedFormats().then(() => { loadSettings(); updateVisibility(); });
})();
