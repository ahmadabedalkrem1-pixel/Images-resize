// "Remove" tool: paint over something and, when the mouse is released, the AI fills that area from
// what is around it (like Photoshop's Remove tool). Every removal can be undone. The window around it
// (tabs, Save, Cancel) is in editor.js.
window.EraseTool = (() => {
  const $ = (id) => document.getElementById(id);
  const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];   // relative to "whole image fits the window"
  const MAX_UNDO = 30;

  // Start the tool in the edit window. Its area must be on screen already, to fit the image to it.
  //   source:   the image to edit (with earlier removals, if any) — ImageBitmap or canvas;
  //   original: the image as uploaded, for "hold to see the original";
  //   onStatus(text, warn): a message for the window's status line;
  //   onChange(): the image changed (a removal, an undo or a redo).
  // Returns a controller:
  //   image     — the canvas holding the edited image (live);
  //   changed() — whether the image differs from the one given;
  //   busy()    — whether a removal is running;
  //   result()  — a copy of the edited image, as a canvas;
  //   destroy() — stop and release everything.
  function start(source, original, { onStatus = () => {}, onChange = () => {} } = {}) {
    const area = $("eraseArea"), stage = $("eraseStage");
    const imgCanvas = $("eraseImage"), maskCanvas = $("eraseMask"), origCanvas = $("eraseOrig");
    const cursor = $("eraseCursor"), brush = $("eraseBrush");
    const undoBtn = $("eraseUndo"), redoBtn = $("eraseRedo"), compareBtn = $("eraseCompare");
    const zoomIn = $("eraseZoomIn"), zoomOut = $("eraseZoomOut"), zoomLabel = $("eraseZoom");

    const W = source.width, H = source.height;
    for (const c of [imgCanvas, maskCanvas, origCanvas]) { c.width = W; c.height = H; }
    const ictx = imgCanvas.getContext("2d", { willReadFrequently: true });
    ictx.drawImage(source, 0, 0);
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    origCanvas.getContext("2d").drawImage(original, 0, 0, W, H);
    origCanvas.hidden = true;
    maskCanvas.hidden = false;

    const undo = [], redo = [];
    // Removals in effect now: up for a removal or a redo, down for an undo.
    let applied = 0;
    let busy = false, ready = false, destroyed = false;
    const refreshButtons = () => {
      undoBtn.disabled = busy || !undo.length;
      redoBtn.disabled = busy || !redo.length;
      stage.classList.toggle("busy", busy);
    };

    // ---- Zoom ----
    const fit = Math.min(area.clientWidth / W, area.clientHeight / H, 4);
    let zoom = 0, scale = 1;
    const updateCursorSize = () => {
      const d = Number(brush.value);
      cursor.style.width = cursor.style.height = `${d}px`;
    };
    const applyZoom = (keepCentre = true) => {
      const cx = (area.scrollLeft + area.clientWidth / 2) / scale, cy = (area.scrollTop + area.clientHeight / 2) / scale;
      scale = fit * ZOOMS[zoom];
      stage.style.width = `${W * scale}px`;
      stage.style.height = `${H * scale}px`;
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      zoomOut.disabled = zoom === 0;
      zoomIn.disabled = zoom === ZOOMS.length - 1;
      if (keepCentre) {
        area.scrollLeft = cx * scale - area.clientWidth / 2;
        area.scrollTop = cy * scale - area.clientHeight / 2;
      }
      updateCursorSize();
    };

    // ---- Painting ----
    let drawing = false, last = null;
    let box = null;   // marked area in image pixels
    const toImage = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    };
    const moveCursor = (e) => {
      const r = stage.getBoundingClientRect();
      cursor.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px) translate(-50%, -50%)`;
    };
    const paint = (p) => {
      const radius = Number(brush.value) / scale / 2;
      mctx.strokeStyle = mctx.fillStyle = "rgb(255, 60, 60)";
      mctx.lineCap = mctx.lineJoin = "round";
      mctx.lineWidth = radius * 2;
      if (last) {
        mctx.beginPath();
        mctx.moveTo(last.x, last.y);
        mctx.lineTo(p.x, p.y);
        mctx.stroke();
      } else {
        mctx.beginPath();
        mctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        mctx.fill();
      }
      last = p;
      const b = { x0: p.x - radius, y0: p.y - radius, x1: p.x + radius, y1: p.y + radius };
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    };
    const clearMarks = () => { mctx.clearRect(0, 0, W, H); box = null; };

    // The marks plus room around them, so the model sees what to fill the area with.
    const workBox = () => {
      const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
      const pad = Math.max(32, Math.max(bw, bh));
      const x = Math.max(0, Math.floor(box.x0 - pad)), y = Math.max(0, Math.floor(box.y0 - pad));
      const x1 = Math.min(W, Math.ceil(box.x1 + pad)), y1 = Math.min(H, Math.ceil(box.y1 + pad));
      return { x, y, w: x1 - x, h: y1 - y };
    };

    async function removeMarked() {
      if (!box) return;
      const b = workBox();
      if (b.w < 1 || b.h < 1) { clearMarks(); return; }
      busy = true;
      refreshButtons();
      try {
        if (!ready) onStatus("Waiting for the AI to load…");
        await Inpaint.ready();
        if (destroyed) return;
        onStatus("Removing…");
        const before = await Inpaint.fill(imgCanvas, maskCanvas, b);
        undo.push({ x: b.x, y: b.y, data: before });
        if (undo.length > MAX_UNDO) undo.shift();
        redo.length = 0;
        applied++;
        onStatus("Removed. Paint over anything else, or save.");
        onChange();
      } catch (err) {
        console.error(err);
        if (!destroyed) onStatus("The AI could not remove this. Check the internet connection and try again.", true);
      } finally {
        if (!destroyed) clearMarks();
        busy = false;
        if (!destroyed) refreshButtons();
      }
    }

    // Swap a saved region with what is on the image now (undo / redo).
    const swap = (from, to, step) => {
      const s = from.pop();
      if (!s) return;
      const now = ictx.getImageData(s.x, s.y, s.data.width, s.data.height);
      ictx.putImageData(s.data, s.x, s.y);
      to.push({ x: s.x, y: s.y, data: now });
      applied += step;
      refreshButtons();
      onChange();
    };

    clearMarks();
    refreshButtons();
    applyZoom(false);

    // Start loading the AI while the user looks at the image.
    Inpaint.ready((pct) => { if (!destroyed) onStatus(`Loading the AI (first time only, about 40MB)… ${Math.round(pct)}%`); })
      .then(() => { ready = true; if (!busy && !destroyed) onStatus("Ready. Paint over what you want to remove."); })
      .catch(() => { if (!destroyed) onStatus("The AI could not be loaded. Check the internet connection and try again.", true); });

    stage.onpointerdown = (e) => {
      if (busy || e.button !== 0) return;
      stage.setPointerCapture(e.pointerId);
      drawing = true;
      last = null;
      paint(toImage(e));
    };
    stage.onpointermove = (e) => {
      moveCursor(e);
      cursor.hidden = false;
      if (drawing) paint(toImage(e));
    };
    stage.onpointerup = stage.onpointercancel = () => {
      if (!drawing) return;
      drawing = false;
      last = null;
      removeMarked();
    };
    stage.onpointerleave = () => { if (!drawing) cursor.hidden = true; };
    brush.oninput = updateCursorSize;
    zoomIn.onclick = () => { zoom = Math.min(ZOOMS.length - 1, zoom + 1); applyZoom(); };
    zoomOut.onclick = () => { zoom = Math.max(0, zoom - 1); applyZoom(); };
    undoBtn.onclick = () => swap(undo, redo, -1);
    redoBtn.onclick = () => swap(redo, undo, +1);
    compareBtn.onpointerdown = () => { origCanvas.hidden = false; maskCanvas.hidden = true; };
    compareBtn.onpointerup = compareBtn.onpointerleave = () => { origCanvas.hidden = true; maskCanvas.hidden = false; };

    return {
      image: imgCanvas,
      changed: () => applied > 0,
      busy: () => busy,
      result() {
        const out = document.createElement("canvas");
        out.width = W; out.height = H;
        out.getContext("2d").drawImage(imgCanvas, 0, 0);
        return out;
      },
      destroy() {
        destroyed = true;
        for (const c of [imgCanvas, maskCanvas, origCanvas]) { c.width = c.height = 0; }
        stage.onpointerdown = stage.onpointermove = stage.onpointerup = stage.onpointercancel = stage.onpointerleave = null;
        brush.oninput = null;
        undoBtn.onclick = redoBtn.onclick = zoomIn.onclick = zoomOut.onclick = null;
        compareBtn.onpointerdown = compareBtn.onpointerup = compareBtn.onpointerleave = null;
        stage.classList.remove("busy");
        cursor.hidden = true;
      },
    };
  }

  return { start };
})();
