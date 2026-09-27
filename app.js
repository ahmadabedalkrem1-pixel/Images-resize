(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $("dropzone"), fileInput: $("fileInput"), fileList: $("fileList"),
    preset: $("preset"), customSize: $("customSize"), customW: $("customW"), customH: $("customH"),
    keepRatio: $("keepRatio"), fit: $("fit"), focus: $("focus"), focusField: $("focusField"),
    bg: $("bg"), bgField: $("bgField"), format: $("format"), quality: $("quality"),
    qualityField: $("qualityField"), maxKB: $("maxKB"), processBtn: $("processBtn"),
    resultsCard: $("resultsCard"), results: $("results"), zipBtn: $("zipBtn"),
  };

  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  const SETTINGS_KEY = "image-resizer-settings";
  const SAVED_FIELDS = ["preset", "customW", "customH", "fit", "focus", "bg", "format", "quality", "maxKB"];

  let files = [];
  let results = [];

  // ---------- Setup ----------

  function fillPresets() {
    PRESETS.forEach((p, i) => {
      els.preset.add(new Option(`${p.name} — ${p.width}×${p.height}`, String(i)));
    });
    els.preset.add(new Option("כל הגדלים ברשימה", "all"));
    els.preset.add(new Option("גודל מותאם (Custom)…", "custom"));
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
    const ratioOnly = custom && els.keepRatio.checked;
    els.customSize.hidden = !custom;
    els.customH.disabled = ratioOnly;
    els.fit.closest(".field").hidden = ratioOnly;
    els.focusField.hidden = ratioOnly || els.fit.value !== "cover";
    const isJpeg = els.format.value === "image/jpeg";
    els.bgField.hidden = !(isJpeg || (!ratioOnly && els.fit.value === "contain"));
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
  }

  // ---------- Resizing ----------

  function getTargets(img) {
    const v = els.preset.value;
    if (v === "all") return PRESETS;
    if (v !== "custom") return [PRESETS[Number(v)]];
    const w = parseInt(els.customW.value, 10);
    let h = parseInt(els.customH.value, 10);
    if (els.keepRatio.checked && w > 0) h = Math.round((w * img.height) / img.width);
    if (!(w > 0 && h > 0)) throw new Error("יש להזין רוחב וגובה");
    return [{ name: "Custom", width: w, height: h }];
  }

  // Downscale in halving steps so large reductions stay sharp (no aliasing).
  function drawHighQuality(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
    let cur = src;
    while (sw / 2 >= dw && sh / 2 >= dh) {
      const c = document.createElement("canvas");
      c.width = Math.round(sw / 2);
      c.height = Math.round(sh / 2);
      const cctx = c.getContext("2d");
      cctx.imageSmoothingQuality = "high";
      cctx.drawImage(cur, sx, sy, sw, sh, 0, 0, c.width, c.height);
      cur = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function render(img, W, H, fit, focus, bg, fillBg) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (fillBg || fit === "contain") {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }
    const iw = img.width, ih = img.height;
    if (fit === "stretch") {
      drawHighQuality(ctx, img, 0, 0, iw, ih, 0, 0, W, H);
    } else if (fit === "contain") {
      const s = Math.min(W / iw, H / ih);
      const dw = Math.round(iw * s), dh = Math.round(ih * s);
      drawHighQuality(ctx, img, 0, 0, iw, ih, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
    } else {
      const s = Math.max(W / iw, H / ih);
      const sw = W / s, sh = H / s;
      let sx = (iw - sw) / 2, sy = (ih - sh) / 2;
      if (focus === "top") sy = 0;
      if (focus === "bottom") sy = ih - sh;
      if (focus === "left") sx = 0;
      if (focus === "right") sx = iw - sw;
      drawHighQuality(ctx, img, sx, sy, sw, sh, 0, 0, W, H);
    }
    return canvas;
  }

  const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  // Encode at the chosen quality; if a KB limit is set and exceeded, binary-search
  // the highest quality that still fits.
  async function encode(canvas, type, quality, maxBytes) {
    let blob = await toBlob(canvas, type, quality);
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
    const ratioOnly = els.preset.value === "custom" && els.keepRatio.checked;
    const fit = ratioOnly ? "stretch" : els.fit.value;
    const usedNames = new Set();

    try {
      for (const file of files) {
        const img = await createImageBitmap(file);
        for (const t of getTargets(img)) {
          const canvas = render(img, t.width, t.height, fit, els.focus.value, els.bg.value, type === "image/jpeg");
          const limit = maxBytes || (t.maxKB ? t.maxKB * 1024 : 0);
          const out = await encode(canvas, type, quality, limit);

          let name = `${safeName(file.name)}_${t.width}x${t.height}`;
          for (let n = 2; usedNames.has(name); n++) name = `${safeName(file.name)}_${t.width}x${t.height}_${n}`;
          usedNames.add(name);
          name += "." + EXT[type];

          results.push({ ...out, name, label: t.name, width: t.width, height: t.height, limit });
        }
        img.close();
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
            (els.format.value === "image/png" ? " — PNG לא נדחס, נסו JPEG/WebP" : "");
      }
      const qNote = r.blob.type !== "image/png" ? ` · איכות ${Math.round(r.quality * 100)}%` : "";

      div.innerHTML = `
        <div class="thumb"><img alt=""></div>
        <div class="meta">
          <div class="name"></div>
          <div>${r.label} · ${r.width}×${r.height}</div>
          <div class="size ${r.limit ? (r.fits ? "ok" : "warn") : ""}">${formatKB(r.blob.size)}${qNote}${sizeNote}</div>
          <a download>הורדה</a>
        </div>`;
      div.querySelector("img").src = r.url;
      div.querySelector(".name").textContent = r.name;
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

  [els.preset, els.fit, els.format, els.keepRatio].forEach((el) => el.addEventListener("change", updateVisibility));
  els.processBtn.addEventListener("click", processAll);
  els.zipBtn.addEventListener("click", downloadZip);

  fillPresets();
  disableUnsupportedFormats().then(() => { loadSettings(); updateVisibility(); });
})();
