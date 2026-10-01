(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $("dropzone"), fileInput: $("fileInput"), fileList: $("fileList"),
    preset: $("preset"), customSize: $("customSize"), customW: $("customW"), customH: $("customH"),
    keepRatio: $("keepRatio"), fit: $("fit"), fitNote: $("fitNote"),
    bgMode: $("bgMode"), bg: $("bg"), bgNote: $("bgNote"), bgHint: $("bgHint"),
    format: $("format"), quality: $("quality"), qualityField: $("qualityField"), maxKB: $("maxKB"),
    processBtn: $("processBtn"), resultsCard: $("resultsCard"), results: $("results"), zipBtn: $("zipBtn"),
    folderInput: $("folderInput"), folderBtn: $("folderBtn"), clearBtn: $("clearBtn"),
    deletePreset: $("deletePreset"), addSize: $("addSize"), newName: $("newName"), newW: $("newW"),
    newH: $("newH"), saveSize: $("saveSize"),
    aiEnhance: $("aiEnhance"), uploadStatus: $("uploadStatus"), aiProgress: $("aiProgress"),
    aiProgressLabel: $("aiProgressLabel"), aiProgressPct: $("aiProgressPct"), aiProgressBar: $("aiProgressBar"),
    presetNote: $("presetNote"), namePattern: $("namePattern"), namePreview: $("namePreview"),
    folderSaveBtn: $("folderSaveBtn"), resultsSummary: $("resultsSummary"),
    viewDialog: $("viewDialog"), viewTitle: $("viewTitle"), viewMeta: $("viewMeta"), compareWrap: $("compareWrap"),
    viewBefore: $("viewBefore"), viewAfter: $("viewAfter"), viewDownload: $("viewDownload"), viewCrop: $("viewCrop"),
    viewActual: $("viewActual"), viewPrev: $("viewPrev"), viewNext: $("viewNext"), viewClose: $("viewClose"),
  };

  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  const SETTINGS_KEY = "image-resizer-settings-v3";
  const USER_PRESETS_KEY = "image-resizer-user-presets";
  const QUALITY_LABELS = { "0.6": "נמוכה", "0.8": "בינונית", "0.92": "גבוהה" };
  const SAVED_FIELDS = [
    "preset", "customW", "customH", "fit", "bgMode", "bg", "format", "quality", "maxKB", "namePattern",
  ];
  const FORMAT_TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };
  const DEFAULT_NAME_PATTERN = "{name}_{size}_{w}x{h}";
  // An output this many times bigger than its source pixels gets a "may look blurry" warning.
  const BLURRY_ENLARGEMENT = 1.5;

  const FIT_NOTES = {
    auto: "מוצר על רקע חלק או לוגו שקוף: מוצג בשלמותו, ממורכז ועם שוליים. תמונה רגילה: ממלאת את הגודל עם חיתוך קטן מהצדדים. אם החיתוך היה מוריד יותר מ-35% מהתמונה, היא מוצגת בשלמותה, והשטח שנשאר ממולא ברקע מטושטש מהתמונה (או בצבע הרקע שנבחר).",
    cover: "התמונה ממלאת את כל הגודל, והחלקים שבולטים מחוץ לו נחתכים.",
    contain: "כל התמונה נכנסת בלי חיתוך. השטח שנשאר ממולא ברקע: בצבע שנבחר, או ברקע המקורי (מורחב או מטושטש).",
    stretch: "התמונה נמתחת בדיוק לגודל. בלי חיתוך ובלי רקע, אבל עלולה להיראות מעוותת.",
  };

  // Empty space kept around a centred product, as a share of the shorter side.
  const PRODUCT_MARGIN = 0.05;
  // In automatic mode, a regular photo is cropped to fill the size only when that removes at most
  // this share of it; beyond that it's shown whole (e.g. a wide photo in a tall size), so the
  // subject isn't cut in half.
  const MAX_AUTO_CROP = 0.35;
  // Background detection works on at most this many pixels on the long side, to keep memory in check.
  const MAX_WORK_SIDE = 3000;
  // Flood-fill tolerances: max colour step between neighbouring pixels, max drift from the edge
  // pixel the fill started at, max tint difference from the edge colour.
  const STEP_TOL = 24, DRIFT_TOL = 100, TINT_TOL = 18;

  const resizer = typeof pica === "function" ? pica() : null;

  // After an update, browsers may keep showing a cached copy of the page for a few minutes.
  // version.txt is always fetched fresh; if it's newer than this script (its ?v=), reload the page
  // under a new address, which bypasses the cache.
  const APP_VERSION = parseInt(new URL(document.currentScript.src).searchParams.get("v"), 10) || 0;
  if (location.protocol.startsWith("http")) {
    fetch(`version.txt?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        const latest = parseInt(text, 10);
        if (latest > APP_VERSION && new URLSearchParams(location.search).get("v") !== String(latest)) {
          location.replace(`${location.pathname}?v=${latest}`);
        }
      })
      .catch(() => { /* offline or no version file: keep the page as is */ });
  }

  let files = [];
  let results = [];

  // ---------- Setup ----------

  // Sizes a user added with "+", kept in their browser only.
  let userPresets = [];
  function loadUserPresets() {
    try { userPresets = JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || "[]"); } catch { userPresets = []; }
  }
  function saveUserPresets() {
    try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets)); } catch { /* storage unavailable */ }
  }

  const allPresets = () => PRESETS.concat(userPresets);

  // Fixed settings a size carries in presets.js, in words.
  const BG_WORDS = { original: "רקע מקורי", white: "רקע לבן", transparent: "רקע שקוף" };
  const FIT_WORDS = { auto: "מיקום אוטומטי", cover: "ממלא את הגודל", contain: "בלי חיתוך" };
  function fixedSettingsText(p) {
    return [
      p.background && (BG_WORDS[p.background] || `רקע ${p.background}`),
      p.format && String(p.format).toUpperCase(),
      p.maxKB && `עד ${p.maxKB}KB`,
      p.fit && FIT_WORDS[p.fit],
    ].filter(Boolean).join(", ");
  }
  const sizeLabel = (p) => {
    const fixed = fixedSettingsText(p);
    return `${p.name} — ${p.width}×${p.height} px${fixed ? ` · ${fixed}` : ""}`;
  };

  function fillPresets() {
    els.preset.innerHTML = "";
    const group = (label) => {
      const g = document.createElement("optgroup");
      g.label = label;
      els.preset.append(g);
      return g;
    };
    els.preset.add(new Option("גודל מקורי של התמונה", "original"));
    const builtIn = group("גדלים");
    PRESETS.forEach((p, i) => builtIn.append(new Option(sizeLabel(p), String(i))));
    if (userPresets.length) {
      const mine = group("הגדלים שלי");
      userPresets.forEach((p, i) => mine.append(new Option(`${sizeLabel(p)} ★`, `u${i}`)));
    }
    const more = group("עוד");
    more.append(new Option("כל הגדלים ברשימה", "all"));
    more.append(new Option("גודל מותאם (חד-פעמי)…", "custom"));
    more.append(new Option("+ הוספת גודל חדש לרשימה…", "add"));
    updateOriginalLabel();
  }

  // Under the size list: a size's fixed settings, if it has any.
  function updatePresetNote() {
    const v = els.preset.value;
    const p = /^\d+$/.test(v) ? PRESETS[Number(v)] : null;
    const fixed = p && fixedSettingsText(p);
    const text = fixed ? `הגדרות קבועות לגודל הזה: ${fixed}. הן גוברות על הבחירה למטה.` : "";
    els.presetNote.textContent = text;
    els.presetNote.hidden = !text;
  }

  function addUserPreset() {
    const width = parseInt(els.newW.value, 10), height = parseInt(els.newH.value, 10);
    if (!(width > 0 && height > 0)) { alert("יש להזין רוחב וגובה"); return; }
    const name = els.newName.value.trim() || `גודל ${width}×${height}`;
    userPresets.push({ name, width, height });
    saveUserPresets();
    fillPresets();
    els.preset.value = `u${userPresets.length - 1}`;
    els.newName.value = els.newW.value = els.newH.value = "";
    updateVisibility();
  }

  function deleteUserPreset() {
    const i = Number(els.preset.value.slice(1));
    if (!confirm(`למחוק את "${userPresets[i].name}" מהרשימה?`)) return;
    userPresets.splice(i, 1);
    saveUserPresets();
    fillPresets();
    els.preset.value = "original";
    updateVisibility();
  }

  let firstImageSize = null; // for the file-name preview
  async function updateOriginalLabel() {
    const opt = els.preset.querySelector('option[value="original"]');
    if (files.length !== 1) {
      opt.textContent = files.length > 1 ? "גודל מקורי של כל תמונה" : "גודל מקורי של התמונה";
      updateNamePreview();
      return;
    }
    try {
      const b = await decodeImage(files[0]);
      opt.textContent = `גודל מקורי של התמונה — ${b.width}×${b.height} px`;
      firstImageSize = { width: b.width, height: b.height };
      b.close();
      updateNamePreview();
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
      if (s.aiEnhance != null) els.aiEnhance.checked = s.aiEnhance;
    } catch { /* storage unavailable */ }
  }

  function saveSettings() {
    try {
      const s = { keepRatio: els.keepRatio.checked, aiEnhance: els.aiEnhance.checked };
      SAVED_FIELDS.forEach((k) => (s[k] = els[k].value));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch { /* storage unavailable */ }
  }

  function updateVisibility() {
    const custom = els.preset.value === "custom";
    els.addSize.hidden = els.preset.value !== "add";
    els.deletePreset.hidden = !els.preset.value.startsWith("u");
    updatePresetNote();
    updateNamePreview();
    els.customSize.hidden = !custom;
    els.customH.disabled = custom && els.keepRatio.checked;
    els.fitNote.textContent = FIT_NOTES[els.fit.value];
    els.bg.hidden = els.bgMode.value !== "custom";
    els.bgNote.hidden = els.bgMode.value === "original";
    els.bgHint.hidden = !(els.bgMode.value === "transparent" && els.format.value === "image/jpeg");
    els.qualityField.hidden = els.format.value === "image/png";
  }

  // ---------- Files ----------

  const isPsd = (f) => /\.psd$/i.test(f.name) || f.type === "image/vnd.adobe.photoshop";
  const isImage = (f) => !f.name.startsWith(".") &&
    (f.type.startsWith("image/") || isPsd(f) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));

  // Pick pages from PDFs one at a time; their pictures join the list as PNG files.
  let pdfQueue = Promise.resolve();
  function addFiles(list) {
    const pdfs = [];
    for (const f of list) {
      if (PdfImport.isPdf(f)) pdfs.push(f);
      else if (isImage(f)) files.push(f);
    }
    renderFileList();
    for (const pdf of pdfs) {
      pdfQueue = pdfQueue.then(async () => {
        try {
          const extracted = await PdfImport.choose(pdf, (msg) => { els.uploadStatus.textContent = msg; });
          files.push(...extracted);
          renderFileList();
        } catch (err) {
          console.error(err);
          alert(`לא ניתן לפתוח את הקובץ "${pdf.name}"`);
        } finally {
          els.uploadStatus.textContent = "";
        }
      });
    }
  }

  // Manual crops (with rotation), per file, in the file's own pixels.
  const crops = new Map();

  // Width/height of the size chosen now, to offer it as the crop shape.
  function chosenRatio() {
    const v = els.preset.value;
    if (v === "custom" && !els.keepRatio.checked) {
      const w = parseInt(els.customW.value, 10), h = parseInt(els.customH.value, 10);
      return w > 0 && h > 0 ? w / h : null;
    }
    const p = /^\d+$/.test(v) ? PRESETS[Number(v)] : v.startsWith("u") ? userPresets[Number(v.slice(1))] : null;
    return p ? p.width / p.height : null;
  }

  async function cropFile(file) {
    let bitmap;
    try {
      bitmap = await decodeImage(file);
    } catch {
      alert(`לא ניתן לקרוא את הקובץ "${file.name}"`);
      return;
    }
    const result = await CropTool.open(bitmap, { presetRatio: chosenRatio(), current: crops.get(file), allowRotate: true });
    bitmap.close();
    if (result === undefined) return;
    if (result) crops.set(file, result);
    else crops.delete(file);
    renderFileList();
  }

  // Everything dropped, including the images inside dropped folders (and their sub-folders).
  async function droppedFiles(dataTransfer) {
    // Entries must be taken synchronously, before the drop event's data is released.
    const entries = [...(dataTransfer.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return [...dataTransfer.files];
    const out = [];
    const walk = async (entry) => {
      if (entry.isFile) {
        out.push(await new Promise((res, rej) => entry.file(res, rej)));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const e of batch) await walk(e);
        }
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  // Photoshop files are read with ag-psd, loaded only the first time one is needed.
  let psdLib = null;
  function loadPsdLib() {
    psdLib ||= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/ag-psd.min.js";
      s.onload = () => resolve(window.agPsd);
      s.onerror = () => { psdLib = null; reject(new Error("לא ניתן לטעון את רכיב קריאת קבצי הפוטושופ")); };
      document.head.append(s);
    });
    return psdLib;
  }

  async function decodePsd(file) {
    const { readPsd } = await loadPsdLib();
    const buffer = await file.arrayBuffer();
    // The flattened image Photoshop stores alongside the layers ("Maximize compatibility").
    // Saved without that option, a layered file holds only a blank placeholder there.
    const psd = readPsd(buffer, { skipLayerImageData: true, skipThumbnail: true });
    if (psd.canvas && !(psd.children?.length && isBlank(psd.canvas))) return createImageBitmap(psd.canvas);
    // Saved without it: stack the visible layers (layer effects and blend modes aren't applied).
    const full = readPsd(buffer, { skipCompositeImageData: true, skipThumbnail: true });
    const c = document.createElement("canvas");
    c.width = full.width;
    c.height = full.height;
    const ctx = c.getContext("2d");
    const draw = (layers) => {
      for (const layer of layers || []) {
        if (layer.hidden) continue;
        if (layer.children) { draw(layer.children); continue; }
        if (!layer.canvas) continue;
        ctx.globalAlpha = layer.opacity ?? 1;
        ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
      }
    };
    draw(full.children);
    return createImageBitmap(c);
  }

  // True when every sampled pixel is the same colour (an empty placeholder image).
  function isBlank(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor((w * h) / 20000)) * 4;
    for (let i = step; i < d.length; i += step) {
      if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return false;
    }
    return true;
  }

  function decodeImage(file) {
    return isPsd(file) ? decodePsd(file) : createImageBitmap(file);
  }

  function renderFileList() {
    els.fileList.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.textContent = f.name;
      const crop = document.createElement("button");
      crop.type = "button";
      crop.className = crops.has(f) ? "crop-btn cropped" : "crop-btn";
      crop.textContent = crops.has(f) ? "✂ נערך" : "✂";
      crop.title = "חיתוך, סיבוב ויישור";
      crop.onclick = () => cropFile(f);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.title = "הסרה";
      rm.onclick = () => { crops.delete(f); files.splice(i, 1); renderFileList(); };
      li.append(crop, rm);
      els.fileList.append(li);
    });
    els.processBtn.disabled = files.length === 0;
    els.clearBtn.hidden = files.length < 2;
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

    // A plain background shows along every side of the photo (the product may touch or cross
    // an edge, but never covers a whole side). A regular photo has at least one side with no
    // plain background at all, e.g. the ground below a sky.
    const coverage = (count, at) => { let c = 0; for (let i = 0; i < count; i++) c += isBg[at(i)]; return c / count; };
    const sides = [
      coverage(w, (i) => i), coverage(w, (i) => (h - 1) * w + i),
      coverage(h, (i) => i * w), coverage(h, (i) => i * w + w - 1),
    ];
    const total = (sides[0] * w + sides[1] * w + sides[2] * h + sides[3] * h) / (2 * (w + h));
    const removed = tail / n;
    if (Math.min(...sides) < 0.15 || total < 0.6 || removed < 0.03 || removed > 0.97) return false;
    // A studio backdrop also runs down (almost) a whole left or right side. A landscape doesn't:
    // sky above and road below can both look plain, but the hills between them break the sides.
    if (Math.max(sides[2], sides[3]) < 0.9) return false;

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

  // Edges of the photo the product runs into (it was cut off there when photographed).
  function touchedEdges(box, w, h) {
    return { top: box.y <= 1, bottom: box.y + box.h >= h - 1, left: box.x <= 1, right: box.x + box.w >= w - 1 };
  }

  // Decide how to treat one uploaded image:
  // - a transparent PNG (logo, cut-out product) is a "product" as is;
  // - a photo with a plain background is a "product" too: its background is removed when a new
  //   one was chosen, or kept and extended when the original background was chosen;
  // - anything else is a regular photo.
  function prepare(bitmap, bgMode, isJpegFile) {
    if (!isJpegFile) {
      const c = toCanvas(bitmap);
      if (hasTransparency(c)) {
        const box = contentBox(c);
        return { src: c, product: true, box, touch: touchedEdges(box, c.width, c.height) };
      }
    }
    const work = toCanvas(bitmap, MAX_WORK_SIDE);
    const cut = toCanvas(work);
    if (!removePlainBackground(cut)) {
      if (bgMode === "original") return { src: bitmap, product: false, blurFill: true };
      return { src: bitmap, product: false, note: "לא זוהה רקע חלק ואחיד, לכן הרקע המקורי נשאר", warn: true };
    }
    const box = contentBox(cut);
    const touch = touchedEdges(box, cut.width, cut.height);
    // Keeping the original backdrop: the product is still centred whole, and the backdrop is
    // extended wherever the new size needs more room than the photo has.
    if (bgMode === "original") return { src: work, mask: cut, product: true, box, touch, extend: true };
    return { src: cut, product: true, box, touch, replaced: true };
  }

  // ---------- Layout & resizing ----------

  function getTargets(img) {
    const v = els.preset.value;
    if (v === "original") return [{ name: "Original", width: img.width, height: img.height }];
    if (v === "all") return allPresets();
    if (v === "add") throw new Error("יש לשמור קודם את הגודל החדש, או לבחור גודל מהרשימה");
    if (v.startsWith("u")) return [userPresets[Number(v.slice(1))]];
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

    const cropShare = 1 - Math.min(W / iw, H / ih) / Math.max(W / iw, H / ih);
    const mode = fit !== "auto" ? fit
      : prep.product ? "product"
      : cropShare > MAX_AUTO_CROP ? "contain"
      : "cover";
    if (mode === "cover") {
      const s = Math.max(W / iw, H / ih);
      const sw = W / s, sh = H / s;
      return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: 0, dy: 0, dw: W, dh: H, cropped: cropShare > 0.02 };
    }
    // "contain" fits the whole image; "product" fits just the product, with a margin around it.
    // A product that was cut off at an edge of the photo stays flush with that edge, without margin.
    const product = mode === "product";
    const box = product ? { sx: prep.box.x, sy: prep.box.y, sw: prep.box.w, sh: prep.box.h } : whole;
    const t = product ? prep.touch : {};
    const m = product ? Math.round(Math.min(W, H) * PRODUCT_MARGIN) : 0;
    const mT = t.top ? 0 : m, mB = t.bottom ? 0 : m, mL = t.left ? 0 : m, mR = t.right ? 0 : m;
    const s = Math.min((W - mL - mR) / box.sw, (H - mT - mB) / box.sh);
    const dw = Math.max(1, Math.round(box.sw * s)), dh = Math.max(1, Math.round(box.sh * s));
    const place = (size, d, lo, hi, atLo, atHi) =>
      atLo && !atHi ? 0 : atHi && !atLo ? size - d : Math.round(lo + (size - lo - hi - d) / 2);
    const dx = place(W, dw, mL, mR, t.left, t.right), dy = place(H, dh, mT, mB, t.top, t.bottom);
    if (!product && prep.blurFill) {
      // Regular photo shown whole: the empty bands get a blurred, enlarged copy of the photo.
      return { ...whole, dx, dy, dw, dh, blurFill: true, shownWhole: fit === "auto" };
    }
    if (prep.extend) {
      // The backdrop around the product is shown too: the whole output maps back onto the photo,
      // and whatever falls outside it is filled by extendedCrop.
      return { sx: box.sx - dx / s, sy: box.sy - dy / s, sw: W / s, sh: H / s, dx: 0, dy: 0, dw: W, dh: H, extend: true };
    }
    return { ...box, dx, dy, dw, dh, shownWhole: !product && fit === "auto" };
  }

  // Cut a region that may reach past the photo's edges, filling the missing parts by stretching
  // the photo's outermost pixels outward, like extending the canvas over a plain studio backdrop.
  // Horizontal first, then vertical from that result, so the corners continue the sides smoothly.
  // Where the product itself reaches an edge, the backdrop line behind it is interpolated from the
  // backdrop on either side, so the product doesn't smear into the extension.
  function extendedCrop(src, mask, sx, sy, sw, sh) {
    const cw = Math.max(1, Math.round(sw)), ch = Math.max(1, Math.round(sh));
    const ox = -sx, oy = -sy, iw = src.width, ih = src.height;
    const S = Math.min(8, iw, ih);

    // One edge line (1px thick), averaged over the outermost S pixels so JPEG noise doesn't streak.
    const edgeLine = (from, fromMask, x, y, w, h, vertical) => {
      const lw = vertical ? 1 : w, lh = vertical ? h : 1;
      const grab = (img) => {
        const t = document.createElement("canvas");
        t.width = lw;
        t.height = lh;
        const tctx = t.getContext("2d", { willReadFrequently: true });
        tctx.imageSmoothingQuality = "high";
        tctx.drawImage(img, x, y, w, h, 0, 0, lw, lh);
        return t;
      };
      const line = grab(from);
      if (!fromMask) return line;
      const lctx = line.getContext("2d", { willReadFrequently: true });
      const px = lctx.getImageData(0, 0, lw, lh);
      const a = grab(fromMask).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, lw, lh).data;
      const d = px.data, len = lw * lh;
      const bg = (i) => a[i * 4 + 3] < 20; // no product in this part of the edge
      let prev = -1;
      for (let i = 0; i <= len; i++) {
        if (i < len && !bg(i)) continue;
        // [prev+1, i-1] is product: fill it from the backdrop at prev and i.
        for (let j = prev + 1; j < i; j++) {
          const f = prev < 0 ? 1 : i >= len ? 0 : (j - prev) / (i - prev);
          for (let c = 0; c < 3; c++) {
            const lo = prev < 0 ? d[i * 4 + c] : d[prev * 4 + c];
            const hi = i >= len ? d[prev * 4 + c] : d[i * 4 + c];
            d[j * 4 + c] = lo + (hi - lo) * f;
          }
          d[j * 4 + 3] = 255;
        }
        prev = i;
      }
      if (prev >= 0) lctx.putImageData(px, 0, 0); // if the whole edge is product, leave it as is
      return line;
    };

    const layer = (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return [c, c.getContext("2d")];
    };

    const [rows, rctx] = layer(cw, ih);
    const [rowsMask, mctx] = layer(cw, ih);
    if (ox > 0) rctx.drawImage(edgeLine(src, mask, 0, 0, S, ih, true), 0, 0, Math.ceil(ox) + 1, ih);
    if (ox + iw < cw) rctx.drawImage(edgeLine(src, mask, iw - S, 0, S, ih, true), Math.floor(ox + iw) - 1, 0, cw - Math.floor(ox + iw) + 1, ih);
    rctx.drawImage(src, ox, 0);
    if (mask) mctx.drawImage(mask, ox, 0);

    const [out, octx] = layer(cw, ch);
    const m = mask ? rowsMask : null;
    if (oy > 0) octx.drawImage(edgeLine(rows, m, 0, 0, cw, S, false), 0, 0, cw, Math.ceil(oy) + 1);
    if (oy + ih < ch) octx.drawImage(edgeLine(rows, m, 0, ih - S, cw, S, false), 0, Math.floor(oy + ih) - 1, cw, ch - Math.floor(oy + ih) + 1);
    octx.drawImage(rows, 0, oy);
    return out;
  }

  // A soft, enlarged copy of the photo covering W×H, used behind a regular photo shown whole.
  function blurredBackdrop(src, W, H) {
    const s = Math.max(W / src.width, H / src.height);
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(W / 24));
    small.height = Math.max(1, Math.round(H / 24));
    const sctx = small.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    const sw = W / s, sh = H / s;
    sctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, small.width, small.height);
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(small, 0, 0, W, H);
    return out;
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
    let crop;
    if (L.extend) {
      crop = extendedCrop(prep.src, prep.mask, L.sx, L.sy, L.sw, L.sh);
    } else {
      crop = document.createElement("canvas");
      crop.width = Math.max(1, Math.round(L.sw));
      crop.height = Math.max(1, Math.round(L.sh));
      const cctx = crop.getContext("2d");
      if (bg) { cctx.fillStyle = bg; cctx.fillRect(0, 0, crop.width, crop.height); }
      cctx.drawImage(prep.src, L.sx, L.sy, L.sw, L.sh, 0, 0, crop.width, crop.height);
    }

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
    if (L.blurFill) octx.drawImage(blurredBackdrop(prep.src, W, H), 0, 0);
    else if (bg) { octx.fillStyle = bg; octx.fillRect(0, 0, W, H); }
    octx.drawImage(scaled, L.dx, L.dy);
    return out;
  }

  // Colour to fill behind the image, or null to keep transparency (JPEG can't, so white there).
  function backgroundColor(type, mode, color) {
    const fill = mode === "white" ? "#ffffff" : mode === "custom" ? color : null;
    return fill || (type === "image/jpeg" ? "#ffffff" : null);
  }

  // The settings one output size is made with: the general choices, except where the size
  // carries its own in presets.js.
  function settingsFor(t, general) {
    const bg = t.background;
    const type = FORMAT_TYPES[String(t.format || "").toLowerCase()];
    const supported = type && ![...els.format.options].some((o) => o.value === type && o.disabled);
    const s = {
      type: supported ? type : general.type,
      bgMode: !bg ? general.bgMode : BG_WORDS[bg] ? bg : "custom",
      bgColor: bg && !BG_WORDS[bg] ? bg : general.bgColor,
      maxBytes: t.maxKB ? t.maxKB * 1024 : general.maxBytes,
      fit: t.fit || general.fit,
      quality: general.quality,
      fixed: fixedSettingsText(t),
    };
    // A size that must be transparent can't be a JPEG, unless it also fixes the format itself.
    if (bg === "transparent" && !type && s.type === "image/jpeg") s.type = "image/png";
    return s;
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

  // ---------- File names ----------

  function safeName(s) {
    return String(s).replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}\-]+/gu, "_").replace(/^_+|_+$/g, "") || "image";
  }

  // Build a file name from the pattern: {name} {size} {w} {h} {date}.
  function fileName(pattern, fileBase, t) {
    const date = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const tokens = {
      name: safeName(fileBase),
      size: String(t.name || "").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "size",
      w: t.width, h: t.height,
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    };
    const filled = (pattern.trim() || DEFAULT_NAME_PATTERN).replace(/\{(\w+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
    // Keep letters, numbers, - _ . and drop anything a file system won't accept.
    return filled.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^[-_.]+|[-_.]+$/g, "") || tokens.name;
  }

  function updateNamePreview() {
    let t;
    try { t = getTargets(firstImageSize || { width: 1200, height: 800 })[0]; } catch { t = null; }
    t ||= PRESETS[0];
    const base = files[0]?.name || "product.jpg";
    const ext = EXT[els.format.value] || "jpg";
    els.namePreview.textContent = `${fileName(els.namePattern.value, base, t)}.${ext}`;
  }

  // ---------- Processing ----------

  // Everything needed to (re)make one output: kept with its result, so a single size can be
  // re-cropped and the before/after view can be drawn later.
  async function makeOutput(job) {
    const { prep, L, W, H, s } = job;
    const canvas = await render(prep, W, H, L, backgroundColor(s.type, s.bgMode, s.bgColor));
    return encode(canvas, s.type, s.quality, s.maxBytes);
  }

  async function processAll() {
    saveSettings();
    clearResults();
    els.processBtn.disabled = true;
    els.processBtn.textContent = "מעבד…";

    const general = {
      type: els.format.value,
      quality: parseFloat(els.quality.value),
      maxBytes: parseFloat(els.maxKB.value) > 0 ? parseFloat(els.maxKB.value) * 1024 : 0,
      bgMode: els.bgMode.value,
      bgColor: els.bg.value,
      fit: els.fit.value,
    };
    const keepWhole = els.preset.value === "original" || (els.preset.value === "custom" && els.keepRatio.checked);
    const usedNames = new Set();
    els.aiProgress.hidden = true;
    let aiDone = 0, aiFailed = 0;

    try {
      for (const [index, file] of files.entries()) {
        let bitmap;
        try {
          bitmap = await decodeImage(file);
        } catch {
          throw new Error(`לא ניתן לקרוא את הקובץ "${file.name}"`);
        }
        const crop = crops.get(file);
        if (crop) {
          const full = bitmap;
          bitmap = await CropTool.apply(full, crop);
          full.close();
        }
        // Sizes are worked out from the image as uploaded (and cropped), before any AI enlargement.
        const targets = getTargets(bitmap);
        let opaque = file.type === "image/jpeg";
        let aiNote = "";
        let enhanced = null;
        if (els.aiEnhance.checked) {
          if (!opaque && hasTransparency(toCanvas(bitmap))) {
            aiNote = "שיפור AI לא זמין לתמונה עם שקיפות";
          } else {
            const label = files.length > 1 ? ` (${index + 1}/${files.length})` : "";
            const barLabel = files.length > 1 ? `משפר תמונה ${index + 1} מתוך ${files.length}` : "משפר את התמונה";
            const overall = (pct) => ((index + pct / 100) / files.length) * 100;
            els.processBtn.textContent = `משפר איכות עם AI${label}…`;
            showAiProgress("טוען את רכיב ה-AI…", overall(0));
            try {
              const neededSide = Math.max(...targets.map((t) => Math.max(t.width, t.height)));
              enhanced = await AiEnhance.enhance(bitmap, neededSide, (pct) => {
                els.processBtn.textContent = `משפר איכות עם AI${label}… ${Math.round(pct)}%`;
                showAiProgress(barLabel, overall(pct));
              });
              aiNote = "האיכות שופרה עם AI";
              aiDone++;
            } catch {
              aiNote = "שיפור ה-AI נכשל, התמונה עובדה בלעדיו";
              aiFailed++;
            }
            els.processBtn.textContent = "מעבד…";
          }
        }

        // One preparation per background choice (sizes may carry their own background).
        const preps = new Map();
        const prepFor = (bgMode) => {
          if (preps.has(bgMode)) return preps.get(bgMode);
          // Product or photo is decided on the image as uploaded: the AI's smoothing can make a
          // photo's sky or ground look like a plain studio backdrop.
          let prep = prepare(bitmap, bgMode, opaque);
          let note = aiNote;
          if (enhanced) {
            if (prep.product) {
              const sharper = prepare(enhanced, bgMode, true);
              if (sharper.product) prep = sharper;
              else note = "שיפור ה-AI לא הופעל לתמונה הזו";
            } else {
              prep = { ...prep, src: enhanced };
            }
          }
          prep = { ...prep, original: bitmap, enhanced: Boolean(enhanced) && note === aiNote, aiNote: note };
          preps.set(bgMode, prep);
          return prep;
        };

        for (const t of targets) {
          const s = settingsFor(t, general);
          const prep = prepFor(s.bgMode);
          const L = layout(prep, t.width, t.height, s.fit, keepWhole);
          const job = { prep, L, autoL: L, W: t.width, H: t.height, s };
          const out = await makeOutput(job);

          let name = fileName(els.namePattern.value, file.name, t);
          for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${fileName(els.namePattern.value, file.name, t)}_${n}`;
          usedNames.add(name.toLowerCase());

          const centred = !keepWhole && s.fit === "auto";
          const placeNote = prep.replaced ? (centred ? "הרקע הוחלף והמוצר מורכז" : "הרקע הוחלף")
            : prep.extend && centred ? "המוצר מורכז בשלמותו על הרקע המקורי"
            : [prep.note,
               centred && L.cropped ? "השוליים נחתכו מעט כדי למלא את הגודל" : "",
               L.shownWhole ? "הצורה שונה מאוד מהגודל, לכן התמונה מוצגת בשלמותה בלי חיתוך" : "",
              ].filter(Boolean).join(". ");
          // Quality check: how many output pixels each source pixel has to cover.
          const enlargement = L.dw / L.sw;
          const blurry = !prep.enhanced && enlargement > BLURRY_ENLARGEMENT;
          results.push({
            ...out, ...job, file: index,
            name: `${name}.${EXT[s.type]}`, label: t.name, width: t.width, height: t.height,
            limit: s.maxBytes, chosenQuality: s.quality,
            aiNote: prep.aiNote, placeNote, fixedNote: s.fixed && `הגדרות קבועות לגודל: ${s.fixed}`,
            warning: blurry
              ? `התמונה המקורית קטנה לגודל הזה (הגדלה פי ${enlargement.toFixed(1)}) ועלולה להיראות מטושטשת. כדאי לסמן "שיפור איכות עם AI".`
              : "",
            warn: prep.warn,
          });
        }
      }
      if (aiDone || aiFailed) {
        showAiProgress(aiFailed && !aiDone ? "שיפור ה-AI נכשל" : "השיפור הושלם", 100, !aiFailed || aiDone > 0);
      }
      renderResults();
    } catch (err) {
      alert(err.message || "שגיאה בעיבוד התמונה");
    } finally {
      els.processBtn.disabled = files.length === 0;
      els.processBtn.textContent = "שינוי גודל";
    }
  }

  // Progress bar under the AI option: overall percent across all images being enhanced.
  function showAiProgress(label, pct, finished = false) {
    const value = Math.max(0, Math.min(100, Math.round(pct)));
    els.aiProgress.hidden = false;
    els.aiProgress.classList.toggle("done", finished);
    els.aiProgressLabel.textContent = label;
    els.aiProgressPct.textContent = `${value}%`;
    els.aiProgressBar.style.width = `${value}%`;
    els.aiProgressBar.parentElement.setAttribute("aria-valuenow", value);
  }

  // ---------- Results ----------

  function clearResults() {
    results.forEach((r) => {
      if (r.url) URL.revokeObjectURL(r.url);
      if (r.beforeUrl) URL.revokeObjectURL(r.beforeUrl);
    });
    results = [];
    els.results.innerHTML = "";
    els.resultsSummary.textContent = "";
    els.resultsCard.hidden = true;
  }

  function formatKB(bytes) {
    return `<bdi>${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB</bdi>`;
  }

  function fillCard(div, r) {
    let sizeNote = "";
    if (r.limit) {
      sizeNote = r.fits
        ? ` ✓ מתחת ל-<bdi>${Math.round(r.limit / 1024)} KB</bdi>`
        : ` ⚠ מעל <bdi>${Math.round(r.limit / 1024)} KB</bdi>` +
          (r.blob.type === "image/png" ? " — PNG לא נדחס, נסו JPEG/WebP" : "");
    }
    const qNote = r.blob.type === "image/png" ? ""
      : r.quality < r.chosenQuality - 0.001 ? " · האיכות הותאמה למגבלת הגודל"
      : ` · איכות ${QUALITY_LABELS[String(r.chosenQuality)] || ""}`;

    div.innerHTML = `
      <button type="button" class="thumb" title="תצוגה מוגדלת והשוואה למקור"><img alt=""></button>
      <div class="meta">
        <div class="name"></div>
        <div>${r.label} · <bdi>${r.width}×${r.height} px</bdi></div>
        <div class="size ${r.limit ? (r.fits ? "ok" : "warn") : ""}">${formatKB(r.blob.size)}${qNote}${sizeNote}</div>
        <div class="info ${r.warn ? "warn" : ""}"></div>
        <div class="info warn quality-warning"></div>
        <div class="card-actions">
          <a download>הורדה</a>
          <button type="button" class="link view-btn">לפני/אחרי</button>
          <button type="button" class="link crop-size-btn">✂ חיתוך</button>
        </div>
      </div>`;
    div.querySelector("img").src = r.url;
    div.querySelector(".name").textContent = r.name;
    const info = div.querySelector(".info");
    info.textContent = [r.aiNote, r.manualCrop ? "החיתוך הותאם ידנית" : r.placeNote, r.fixedNote].filter(Boolean).join(". ");
    info.hidden = !info.textContent;
    const warning = div.querySelector(".quality-warning");
    warning.textContent = r.warning ? `⚠ ${r.warning}` : "";
    warning.hidden = !r.warning;
    const a = div.querySelector("a");
    a.href = r.url;
    a.download = r.name;
    const i = results.indexOf(r);
    div.querySelector(".thumb").onclick = div.querySelector(".view-btn").onclick = () => openViewer(i);
    div.querySelector(".crop-size-btn").onclick = () => adjustSizeCrop(r);
  }

  function updateSummary(extra = "") {
    const total = results.reduce((sum, r) => sum + r.blob.size, 0);
    const warnings = results.filter((r) => r.warning || (r.limit && !r.fits)).length;
    els.resultsSummary.innerHTML =
      `${results.length} קבצים מוכנים · סה"כ ${formatKB(total)}` +
      (warnings ? ` · <span class="warn">⚠ ${warnings} עם אזהרה</span>` : "") +
      (extra ? ` · <span class="ok"></span>` : "");
    if (extra) els.resultsSummary.querySelector(".ok").textContent = extra;
  }

  function renderResults() {
    for (const r of results) {
      r.url = URL.createObjectURL(r.blob);
      const div = document.createElement("div");
      div.className = "result";
      r.card = div;
      fillCard(div, r);
      els.results.append(div);
    }
    els.zipBtn.hidden = results.length < 2 || typeof JSZip === "undefined";
    els.folderSaveBtn.hidden = !("showDirectoryPicker" in window) || !results.length;
    els.resultsCard.hidden = results.length === 0;
    updateSummary();
    els.resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Re-make one output after its crop changed, and refresh its card (and the viewer, if open).
  async function remake(r) {
    const out = await makeOutput(r);
    Object.assign(r, out);
    URL.revokeObjectURL(r.url);
    r.url = URL.createObjectURL(r.blob);
    if (r.beforeUrl) { URL.revokeObjectURL(r.beforeUrl); r.beforeUrl = null; }
    fillCard(r.card, r);
    updateSummary();
  }

  // ---------- Adjusting the crop of one size ----------

  // The image as uploaded (no new background, AI or colour corrections), at the size of the
  // prepared image, so crop coordinates and the before/after view line up with the result.
  function plainSource(prep) {
    const c = document.createElement("canvas");
    c.width = prep.src.width;
    c.height = prep.src.height;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(prep.original, 0, 0, c.width, c.height);
    return c;
  }

  async function adjustSizeCrop(r) {
    const plain = plainSource(r.prep);
    const iw = plain.width, ih = plain.height;
    // Start from what the automatic layout used, kept inside the image.
    const L = r.L;
    let x = Math.max(0, L.sx), y = Math.max(0, L.sy);
    let w = Math.min(iw - x, L.sw - (x - L.sx)), h = Math.min(ih - y, L.sh - (y - L.sy));
    const current = r.manualCrop || { x, y, w, h };
    const choice = await CropTool.open(plain, { presetRatio: r.W / r.H, lockRatio: true, current });
    if (choice === undefined) return;
    if (choice) {
      r.manualCrop = choice;
      r.L = { sx: choice.x, sy: choice.y, sw: choice.w, sh: choice.h, dx: 0, dy: 0, dw: r.W, dh: r.H };
    } else {
      r.manualCrop = null;
      r.L = r.autoL;
    }
    const enlargement = r.L.dw / r.L.sw;
    r.warning = !r.prep.enhanced && enlargement > BLURRY_ENLARGEMENT
      ? `התמונה המקורית קטנה לגודל הזה (הגדלה פי ${enlargement.toFixed(1)}) ועלולה להיראות מטושטשת. כדאי לסמן "שיפור איכות עם AI".`
      : "";
    await remake(r);
    if (els.viewDialog.open) showInViewer(results.indexOf(r));
  }

  // ---------- Large view: before / after ----------

  let viewing = -1;

  async function beforeUrl(r) {
    if (!r.beforeUrl) {
      const plainPrep = { ...r.prep, src: plainSource(r.prep) };
      const canvas = await render(plainPrep, r.W, r.H, r.L, backgroundColor("image/png", r.s.bgMode, r.s.bgColor));
      r.beforeUrl = URL.createObjectURL(await toBlob(canvas, "image/png"));
    }
    return r.beforeUrl;
  }

  async function showInViewer(i) {
    viewing = i;
    const r = results[i];
    els.viewTitle.textContent = r.name;
    els.viewMeta.innerHTML = `${r.label} · <bdi>${r.width}×${r.height} px</bdi> · ${formatKB(r.blob.size)} · ${i + 1}/${results.length}`;
    els.viewAfter.src = r.url;
    els.viewBefore.src = await beforeUrl(r);
    els.viewDownload.href = r.url;
    els.viewDownload.download = r.name;
    els.viewPrev.disabled = i === 0;
    els.viewNext.disabled = i === results.length - 1;
  }

  async function openViewer(i) {
    if (!els.viewDialog.open) els.viewDialog.showModal();
    await showInViewer(i);
  }

  // ---------- Save to a folder ----------

  async function saveToFolder() {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: "image-resizer", mode: "readwrite" });
    } catch {
      return; // cancelled
    }
    els.folderSaveBtn.disabled = true;
    try {
      for (const r of results) {
        const handle = await dir.getFileHandle(r.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(r.blob);
        await writable.close();
      }
      updateSummary(`נשמרו ${results.length} קבצים בתיקייה "${dir.name}"`);
    } catch {
      alert("לא ניתן לשמור בתיקייה הזו. נסו תיקייה אחרת, או הורידו כ-ZIP.");
    } finally {
      els.folderSaveBtn.disabled = false;
    }
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
  els.dropzone.addEventListener("drop", async (ev) => addFiles(await droppedFiles(ev.dataTransfer)));
  els.folderBtn.addEventListener("click", () => els.folderInput.click());
  els.folderInput.addEventListener("change", () => { addFiles(els.folderInput.files); els.folderInput.value = ""; });
  els.clearBtn.addEventListener("click", () => { files = []; crops.clear(); renderFileList(); });
  els.saveSize.addEventListener("click", addUserPreset);
  els.deletePreset.addEventListener("click", deleteUserPreset);
  // Allow pasting an image from the clipboard (e.g. a screenshot).
  document.addEventListener("paste", (ev) => addFiles([...ev.clipboardData.files]));

  // A transparent background needs a format that supports it.
  els.bgMode.addEventListener("change", () => {
    if (els.bgMode.value === "transparent" && els.format.value === "image/jpeg") els.format.value = "image/png";
  });
  [els.preset, els.fit, els.format, els.keepRatio, els.bgMode].forEach((el) => el.addEventListener("change", updateVisibility));
  els.processBtn.addEventListener("click", processAll);
  els.zipBtn.addEventListener("click", downloadZip);
  els.folderSaveBtn.addEventListener("click", saveToFolder);

  els.namePattern.addEventListener("input", updateNamePreview);

  // Before / after viewer
  els.viewActual.addEventListener("change", () => els.compareWrap.classList.toggle("actual", els.viewActual.checked));
  els.viewPrev.addEventListener("click", () => viewing > 0 && showInViewer(viewing - 1));
  els.viewNext.addEventListener("click", () => viewing < results.length - 1 && showInViewer(viewing + 1));
  els.viewClose.addEventListener("click", () => els.viewDialog.close());
  els.viewCrop.addEventListener("click", () => adjustSizeCrop(results[viewing]));

  document.getElementById("year").textContent = new Date().getFullYear();
  loadUserPresets();
  fillPresets();
  disableUnsupportedFormats().then(() => { loadSettings(); updateVisibility(); });
})();
