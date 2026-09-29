// PDF import: the user picks pages, and gets either the pictures embedded in them (at their original
// resolution) or each whole page rendered as an image. pdf.js is loaded only the first time.
window.PdfImport = (() => {
  const $ = (id) => document.getElementById(id);
  const PAGE_DPI = 300;          // whole pages are rendered at print resolution…
  const MAX_PAGE_SIDE = 5000;    // …but never larger than this on the long side
  const MIN_PICTURE_SIDE = 64;   // smaller embedded pictures are icons, lines and decorations
  const THUMB_WIDTH = 140;

  let lib = null;
  function loadLib() {
    lib ||= import(new URL("vendor/pdfjs/pdf.min.mjs", document.baseURI).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
      return pdfjs;
    });
    lib.catch(() => { lib = null; });
    return lib;
  }

  const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, "image/png"));

  async function renderPage(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  }

  async function renderWholePage(page) {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(PAGE_DPI / 72, MAX_PAGE_SIDE / Math.max(base.width, base.height));
    return renderPage(page, scale);
  }

  // A decoded pdf.js image object → canvas at its own resolution.
  function pictureToCanvas(img, ImageKind) {
    const { width: w, height: h } = img;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (img.bitmap) {
      ctx.drawImage(img.bitmap, 0, 0);
      return canvas;
    }
    if (!img.data) return null;
    const out = ctx.createImageData(w, h);
    const d = out.data, src = img.data;
    if (img.kind === ImageKind.RGBA_32BPP) {
      d.set(src.subarray(0, d.length));
    } else if (img.kind === ImageKind.RGB_24BPP) {
      for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
        d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = 255;
      }
    } else if (img.kind === ImageKind.GRAYSCALE_1BPP) {
      const rowBytes = (w + 7) >> 3;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
          const i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
        }
      }
    } else {
      return null;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  // Pictures placed on the page, as pdf.js decoded them (their own pixels, not the page scale).
  async function extractPictures(page, pdfjs) {
    const { OPS, ImageKind } = pdfjs;
    const ops = await page.getOperatorList();
    const seen = new Set();
    const pictures = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      let img = null;
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const id = args[0];
        if (seen.has(id)) continue;
        seen.add(id);
        const store = id.startsWith("g_") ? page.commonObjs : page.objs;
        img = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 10000);
          store.get(id, (obj) => { clearTimeout(timer); resolve(obj); });
        });
      } else if (fn === OPS.paintInlineImageXObject) {
        img = args[0];
      }
      if (!img) continue;
      const canvas = pictureToCanvas(img, ImageKind);
      if (canvas && canvas.width >= MIN_PICTURE_SIDE && canvas.height >= MIN_PICTURE_SIDE) pictures.push(canvas);
    }
    return pictures;
  }

  // Show the page picker; resolves with { pages: [numbers], mode } or null when cancelled.
  function pickPages(doc, fileName) {
    const dialog = $("pdfDialog"), grid = $("pdfPages"), addBtn = $("pdfAdd");
    $("pdfTitle").textContent = `בחירת עמודים מ-${fileName}`;
    grid.innerHTML = "";
    const boxes = [];
    let cancelled = false;
    for (let n = 1; n <= doc.numPages; n++) {
      const tile = document.createElement("label");
      tile.className = "pdf-page";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = doc.numPages <= 5;
      const thumb = document.createElement("div");
      thumb.className = "pdf-thumb";
      const caption = document.createElement("span");
      caption.textContent = `עמוד ${n}`;
      tile.append(box, thumb, caption);
      grid.append(tile);
      boxes.push(box);
    }
    // Thumbnails fill in one by one while the dialog is already usable.
    (async () => {
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        try {
          const page = await doc.getPage(n);
          const scale = THUMB_WIDTH / page.getViewport({ scale: 1 }).width;
          grid.children[n - 1].querySelector(".pdf-thumb").append(await renderPage(page, scale));
        } catch { /* a page that can't render still gets a checkbox */ }
      }
    })();

    return new Promise((resolve) => {
      const finish = (result) => {
        cancelled = true;
        dialog.close();
        addBtn.onclick = $("pdfCancel").onclick = dialog.oncancel = null;
        resolve(result);
      };
      $("pdfAll").onclick = () => boxes.forEach((b) => (b.checked = true));
      $("pdfNone").onclick = () => boxes.forEach((b) => (b.checked = false));
      $("pdfCancel").onclick = () => finish(null);
      dialog.oncancel = () => finish(null);
      addBtn.onclick = () => {
        const pages = boxes.map((b, i) => (b.checked ? i + 1 : 0)).filter(Boolean);
        if (!pages.length) { alert("יש לבחור לפחות עמוד אחד"); return; }
        finish({ pages, mode: dialog.querySelector('input[name="pdfMode"]:checked').value });
      };
      dialog.showModal();
    });
  }

  // Ask which pages to take from a PDF file; resolves with the resulting PNG files ([] if cancelled).
  async function choose(file, onStatus = () => {}) {
    onStatus("פותח את ה-PDF…");
    const pdfjs = await loadLib();
    // Closing the loading task (not the document) is what releases it in pdf.js.
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    try {
      const doc = await task.promise;
      onStatus("");
      const choice = await pickPages(doc, file.name);
      if (!choice) return [];
      const base = file.name.replace(/\.pdf$/i, "");
      const files = [];
      for (const [i, n] of choice.pages.entries()) {
        onStatus(`מחלץ מה-PDF… עמוד ${i + 1} מתוך ${choice.pages.length}`);
        const page = await doc.getPage(n);
        if (choice.mode === "page") {
          files.push(new File([await toBlob(await renderWholePage(page))], `${base}-p${n}.png`, { type: "image/png" }));
        } else {
          const pictures = await extractPictures(page, pdfjs);
          for (const [k, c] of pictures.entries()) {
            const name = pictures.length > 1 ? `${base}-p${n}-img${k + 1}.png` : `${base}-p${n}.png`;
            files.push(new File([await toBlob(c)], name, { type: "image/png" }));
          }
        }
      }
      if (!files.length) alert('לא נמצאו תמונות בעמודים שנבחרו. אפשר לבחור "לשמור את העמוד כולו כתמונה".');
      return files;
    } finally {
      task.destroy();
    }
  }

  const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

  return { choose, isPdf };
})();
