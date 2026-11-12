// Manual crop (and rotate / straighten) of one image, with Cropper.js, loaded the first time it is
// needed. The window around it (tabs, Save, Cancel) is in editor.js.
window.CropTool = (() => {
  const $ = (id) => document.getElementById(id);

  let lib = null;
  function loadLib() {
    lib ||= new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "vendor/cropper/cropper.min.css";
      document.head.append(css);
      const s = document.createElement("script");
      s.src = "vendor/cropper/cropper.min.js";
      s.onload = () => resolve(window.Cropper);
      s.onerror = () => { lib = null; reject(new Error("Could not load the crop tool")); };
      document.head.append(s);
    });
    return lib;
  }

  // Size of the box a w×h image occupies once rotated by deg — the same box Cropper.js measures
  // crop coordinates in, and the one rotateImage() draws into.
  function rotatedSize(w, h, deg) {
    const r = (deg * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    return { width: w * c + h * s, height: w * s + h * c };
  }

  // The image turned by deg degrees, centred in its rotated box (transparent around it).
  function rotateImage(src, deg) {
    if (!deg) return src;
    const { width, height } = rotatedSize(src.width, src.height, deg);
    const c = document.createElement("canvas");
    c.width = Math.round(width);
    c.height = Math.round(height);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  // Largest rectangle with the image's proportions that stays inside it after a small tilt, so
  // straightening never leaves empty corners. In rotated-box coordinates.
  function straightCrop(w, h, deg) {
    const r = Math.abs((deg * Math.PI) / 180);
    const c = Math.cos(r), s = Math.sin(r);
    const k = Math.min(w / (w * c + h * s), h / (w * s + h * c));
    const box = rotatedSize(w, h, deg);
    return { x: (box.width - w * k) / 2, y: (box.height - h * k) / 2, width: w * k, height: h * k };
  }

  // Start cropping a decoded image (ImageBitmap or canvas) in the crop area of the edit window. The
  // area must be on screen already, because Cropper.js measures it.
  // Options:
  //   presetRatio — width/height of the chosen size, offered as a shape (or null);
  //   lockRatio   — keep exactly that shape (used to adjust one output size);
  //   allowRotate — show 90° turns and the straighten slider;
  //   current     — the saved crop {x, y, w, h, rotate}, if any.
  // Resolves with a controller:
  //   touched() — whether the user changed the crop, its shape or the rotation;
  //   get()     — {x, y, w, h, rotate} (rotate in degrees, coordinates in the rotated image), or null
  //               when the whole image is kept;
  //   destroy() — stop and release everything.
  async function start(source, { presetRatio = null, lockRatio = false, allowRotate = false, current = null } = {}) {
    const Cropper = await loadLib();
    const sw = source.width, sh = source.height;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d").drawImage(source, 0, 0);
    const url = URL.createObjectURL(await new Promise((r) => canvas.toBlob(r, "image/png")));
    canvas.width = canvas.height = 0;

    const img = $("cropImg"), ratio = $("cropRatio"), size = $("cropSize");
    const rotateTools = $("cropRotate"), straighten = $("cropStraighten"), angleOut = $("cropAngle");
    ratio.querySelector('option[value="preset"]').disabled = !presetRatio;
    if (lockRatio && presetRatio) ratio.value = "preset";
    else if (ratio.value === "preset" && !presetRatio) ratio.value = "free";
    ratio.disabled = lockRatio;
    rotateTools.hidden = !allowRotate;
    const ratioValue = () => (ratio.value === "free" ? NaN : ratio.value === "preset" ? presetRatio : Number(ratio.value));

    // Rotation = quarter turns + fine straightening.
    let quarter = 0, fine = 0;
    if (current?.rotate) {
      quarter = Math.round(current.rotate / 90) * 90;
      fine = current.rotate - quarter;
    }
    straighten.value = fine;
    angleOut.textContent = `${fine}°`;

    img.src = url;
    await img.decode();
    const cropper = await new Promise((resolve) => {
      const c = new Cropper(img, {
        viewMode: 1,
        autoCropArea: 1,
        aspectRatio: current && !lockRatio ? NaN : ratioValue(),
        zoomOnWheel: false,
        crop: (e) => { size.textContent = `${Math.round(e.detail.width)} × ${Math.round(e.detail.height)} px`; },
        ready: () => resolve(c),
      });
    });
    // Cropper.js keeps the image's on-screen size when it turns, so a quarter turn can leave part
    // of it outside the window; scale it back to fit, centred, before placing the crop box. The crop
    // box is shrunk first because the image may never be smaller than it.
    const fitToWindow = () => {
      const box = cropper.getContainerData();
      cropper.setCropBoxData({ left: box.width / 2, top: box.height / 2, width: 1, height: 1 });
      const c = cropper.getCanvasData();
      const k = Math.min(box.width / c.width, box.height / c.height);
      cropper.setCanvasData({
        width: c.width * k, height: c.height * k,
        left: (box.width - c.width * k) / 2, top: (box.height - c.height * k) / 2,
      });
    };
    if (quarter + fine) { cropper.rotateTo(quarter + fine); fitToWindow(); }
    if (current) cropper.setData({ x: current.x, y: current.y, width: current.w, height: current.h });

    const applyRotation = () => {
      const deg = quarter + fine;
      cropper.rotateTo(deg);
      fitToWindow();
      const turned = quarter % 180 !== 0;
      const w = turned ? sh : sw, h = turned ? sw : sh;
      cropper.setData(straightCrop(w, h, fine));
    };

    // The crop counts as changed only once the user does something, so opening the window (for
    // another tool, say) never crops an image by itself.
    let touched = false;
    const touch = () => { touched = true; };
    img.addEventListener("cropstart", touch);
    ratio.onchange = () => { cropper.setAspectRatio(ratioValue()); touch(); };
    $("cropLeft").onclick = () => { quarter = (quarter + 270) % 360; applyRotation(); touch(); };
    $("cropRight").onclick = () => { quarter = (quarter + 90) % 360; applyRotation(); touch(); };
    straighten.oninput = () => {
      fine = Number(straighten.value);
      angleOut.textContent = `${fine}°`;
      applyRotation();
      touch();
    };

    return {
      touched: () => touched,
      get() {
        const d = cropper.getData(true);
        const rotate = quarter + fine;
        const box = rotatedSize(sw, sh, rotate);
        const bw = Math.round(box.width), bh = Math.round(box.height);
        const x = Math.max(0, d.x), y = Math.max(0, d.y);
        const w = Math.min(bw - x, d.width), h = Math.min(bh - y, d.height);
        const whole = !rotate && x === 0 && y === 0 && w === bw && h === bh;
        return w > 0 && h > 0 && !whole ? { x, y, w, h, rotate } : null;
      },
      destroy() {
        img.removeEventListener("cropstart", touch);
        cropper.destroy();
        URL.revokeObjectURL(url);
        img.removeAttribute("src");
        ratio.onchange = straighten.oninput = null;
        ratio.disabled = false;
        $("cropLeft").onclick = $("cropRight").onclick = null;
        size.textContent = "";
      },
    };
  }

  // Apply a saved crop to an image: turn it, then cut the chosen area.
  async function apply(source, crop) {
    const turned = rotateImage(source, crop.rotate || 0);
    return createImageBitmap(turned, crop.x, crop.y, crop.w, crop.h);
  }

  return { start, apply };
})();
