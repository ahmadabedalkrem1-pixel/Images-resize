// Manual crop of one image, with Cropper.js (loaded the first time the crop window opens).
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
      s.onerror = () => { lib = null; reject(new Error("לא ניתן לטעון את כלי החיתוך")); };
      document.head.append(s);
    });
    return lib;
  }

  // Open the crop window for a decoded image.
  // presetRatio: width/height of the chosen size (or null); current: the saved crop, if any.
  // Resolves with {x, y, w, h} in image pixels, null for "no crop", or undefined when cancelled.
  async function open(bitmap, { presetRatio = null, current = null } = {}) {
    const Cropper = await loadLib();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const url = URL.createObjectURL(await new Promise((r) => canvas.toBlob(r, "image/png")));

    const dialog = $("cropDialog"), img = $("cropImg"), ratio = $("cropRatio"), size = $("cropSize");
    ratio.querySelector('option[value="preset"]').disabled = !presetRatio;
    if (ratio.value === "preset" && !presetRatio) ratio.value = "free";
    const ratioValue = () => (ratio.value === "free" ? NaN : ratio.value === "preset" ? presetRatio : Number(ratio.value));

    dialog.showModal();
    img.src = url;
    await img.decode();
    const cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 1,
      aspectRatio: current ? NaN : ratioValue(),
      zoomOnWheel: false,
      data: current ? { x: current.x, y: current.y, width: current.w, height: current.h } : undefined,
      crop: (e) => { size.textContent = `${Math.round(e.detail.width)} × ${Math.round(e.detail.height)} px`; },
    });

    return new Promise((resolve) => {
      const finish = (result) => {
        cropper.destroy();
        URL.revokeObjectURL(url);
        dialog.close();
        ratio.onchange = dialog.oncancel = null;
        $("cropSave").onclick = $("cropReset").onclick = $("cropCancel").onclick = null;
        resolve(result);
      };
      ratio.onchange = () => cropper.setAspectRatio(ratioValue());
      $("cropSave").onclick = () => {
        const d = cropper.getData(true);
        const x = Math.max(0, d.x), y = Math.max(0, d.y);
        const w = Math.min(bitmap.width - x, d.width), h = Math.min(bitmap.height - y, d.height);
        const whole = x === 0 && y === 0 && w === bitmap.width && h === bitmap.height;
        finish(w > 0 && h > 0 && !whole ? { x, y, w, h } : null);
      };
      $("cropReset").onclick = () => finish(null);
      $("cropCancel").onclick = () => finish(undefined);
      dialog.oncancel = () => finish(undefined);
    });
  }

  return { open };
})();
