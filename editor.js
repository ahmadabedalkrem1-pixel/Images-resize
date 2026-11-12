// The edit window of one uploaded image. Its three tools sit on tabs: Crop (crop.js), Light
// (light.js) and Remove (erase.js), and one Save keeps everything. The same window, without the
// tabs, adjusts the crop of one output size.
window.ImageEditor = (() => {
  const $ = (id) => document.getElementById(id);
  const TABS = { crop: "panelCrop", light: "panelLight", erase: "panelErase" };
  const PREVIEW_SIDE = 1600;   // long side of the Light tab's preview, in pixels

  const tabButton = (tab) => $("editTabs").querySelector(`[data-tab="${tab}"]`);

  // Show the window as the full editor (tabs, three panels) or as the crop of one size.
  function setMode(full) {
    $("editDialog").classList.toggle("crop-only", !full);
    $("editTabs").hidden = !full;
    $("cropClear").hidden = !full;
    $("panelLight").hidden = $("panelErase").hidden = !full;
    $("editTitle").textContent = full ? "Edit image" : "Crop for this size";
    $("editSave").textContent = full ? "Save changes" : "Save crop";
    $("editReset").textContent = full ? "Restore original" : "Automatic crop";
    $("editStatus").textContent = "";
    $("editStatus").classList.remove("warn");
  }

  // Edit one image.
  //   original    — the image as uploaded (ImageBitmap);
  //   erased      — the image with objects removed earlier (ImageBitmap), or null;
  //   crop, light — the saved crop and light settings, or null;
  //   presetRatio — width/height of the chosen size, offered as a crop shape (or null);
  //   name        — the file's name, shown next to the title;
  //   canApplyAll — offer "use these light settings for all images".
  // Resolves with:
  //   undefined — cancelled;
  //   null      — "Restore original": drop every edit of this image;
  //   { crop, light, erased, lightForAll } — crop and light as above (null = none); erased is a
  //     canvas with the new image, or undefined when nothing was removed this time.
  function open({ original, erased = null, crop = null, light = null, presetRatio = null, name = "", canApplyAll = false }) {
    const dialog = $("editDialog"), status = $("editStatus");
    if (dialog.open) return Promise.resolve(undefined);

    const state = {
      tab: null,
      loading: false,
      crop,                                            // kept up to date when the Crop tab is left
      light: { ...Light.NEUTRAL, ...(light || {}) },
      imageVersion: 0,                                 // goes up when the Remove tool changes the image
      cropVersion: -1,                                 // the imageVersion the crop tool was built from
    };
    const before = JSON.stringify([state.crop, state.light]);
    let cropCtl = null, eraseCtl = null;
    // The image the tools work on: with the removals made so far.
    const image = () => (eraseCtl ? eraseCtl.image : erased || original);

    // ---- Status line: each tab has its own message ----
    const statuses = { crop: ["", false], light: ["", false], erase: ["", false] };
    const showStatus = () => {
      const [text, warn] = statuses[state.tab] || ["", false];
      status.textContent = text;
      status.classList.toggle("warn", warn);
    };
    const setStatus = (tab, text, warn = false) => {
      statuses[tab] = [text, warn];
      if (state.tab === tab) showStatus();
    };

    // ---- Crop ----
    const syncCrop = () => { if (cropCtl?.touched()) state.crop = cropCtl.get(); };
    async function buildCrop() {
      syncCrop();
      cropCtl?.destroy();
      cropCtl = null;
      setStatus("crop", "Loading…");
      // Always start from a free shape: the saved crop as it is, or the whole image. What the tab
      // shows is then exactly what Save keeps, and a shape applies only when the user picks one.
      $("cropRatio").value = "free";
      cropCtl = await CropTool.start(image(), { presetRatio, allowRotate: true, current: state.crop });
      state.cropVersion = state.imageVersion;
      setStatus("crop", "");
    }

    // ---- Light ----
    const sliders = { brightness: $("lightBrightness"), contrast: $("lightContrast"), saturation: $("lightSaturation") };
    const showLight = () => {
      for (const [key, el] of Object.entries(sliders)) {
        const v = state.light[key];
        el.value = v;
        $(`${el.id}Out`).textContent = v > 0 ? `+${v}` : String(v);
      }
      const neutral = Light.isNeutral(state.light);
      Light.setFilter(state.light);
      dialog.classList.toggle("lit", !neutral);
      $("lightReset").disabled = neutral;
    };
    // The preview shows the image as it will be cut, so the light is judged on what is kept.
    async function drawPreview() {
      const src = image();
      const cut = state.crop ? await CropTool.apply(src, state.crop) : null;
      const img = cut || src;
      const k = Math.min(1, PREVIEW_SIDE / Math.max(img.width, img.height));
      const c = $("lightPreview");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      cut?.close();
    }

    // ---- Tabs ----
    async function showTab(tab) {
      if (state.loading || tab === state.tab || eraseCtl?.busy()) return;
      state.loading = true;
      try {
        if (state.tab === "crop") syncCrop();
        state.tab = tab;
        for (const [t, panel] of Object.entries(TABS)) {
          $(panel).classList.toggle("off", t !== tab);
          tabButton(t).setAttribute("aria-selected", String(t === tab));
        }
        showStatus();
        if (tab === "crop") {
          if (!cropCtl || state.cropVersion !== state.imageVersion) await buildCrop();
        } else if (tab === "light") {
          await drawPreview();
        } else if (!eraseCtl) {
          eraseCtl = EraseTool.start(erased || original, original, {
            onStatus: (text, warn) => setStatus("erase", text, warn),
            onChange: () => { state.imageVersion++; },
          });
        }
      } catch (err) {
        console.error(err);
        setStatus(tab, err.message || "This tool could not be opened.", true);
      } finally {
        state.loading = false;
      }
    }

    setMode(true);
    $("editName").textContent = name;
    $("lightAllWrap").hidden = !canApplyAll;
    $("lightAll").checked = false;
    showLight();
    dialog.showModal();

    return new Promise((resolve) => {
      const finish = (result) => {
        cropCtl?.destroy();
        eraseCtl?.destroy();
        const preview = $("lightPreview");
        preview.width = preview.height = 0;
        Light.setFilter(null);
        dialog.classList.remove("lit", "compare");
        dialog.close();
        for (const el of Object.values(sliders)) el.oninput = el.ondblclick = null;
        $("editTabs").onclick = $("cropClear").onclick = $("lightReset").onclick = null;
        $("lightCompare").onpointerdown = $("lightCompare").onpointerup = $("lightCompare").onpointerleave = null;
        $("editSave").onclick = $("editReset").onclick = $("editCancel").onclick = dialog.oncancel = null;
        $("editName").textContent = "";
        resolve(result);
      };
      const idle = () => !state.loading && !eraseCtl?.busy();
      const changed = () => {
        syncCrop();
        return eraseCtl?.changed() || JSON.stringify([state.crop, state.light]) !== before || $("lightAll").checked;
      };

      $("editTabs").onclick = (e) => {
        const tab = e.target.closest("[data-tab]")?.dataset.tab;
        if (tab) showTab(tab);
      };
      $("cropClear").onclick = async () => {
        if (!idle()) return;
        state.loading = true;
        try {
          cropCtl?.destroy();
          cropCtl = null;
          state.crop = null;
          await buildCrop();
        } catch (err) {
          console.error(err);
        } finally {
          state.loading = false;
        }
      };
      for (const [key, el] of Object.entries(sliders)) {
        el.oninput = () => { state.light[key] = Number(el.value); showLight(); };
        el.ondblclick = () => { state.light[key] = 0; showLight(); };   // double-click: back to 0
      }
      $("lightReset").onclick = () => { state.light = { ...Light.NEUTRAL }; showLight(); };
      $("lightCompare").onpointerdown = () => dialog.classList.add("compare");
      $("lightCompare").onpointerup = $("lightCompare").onpointerleave = () => dialog.classList.remove("compare");

      $("editSave").onclick = () => {
        if (!idle()) return;
        syncCrop();
        finish({
          crop: state.crop,
          light: Light.isNeutral(state.light) ? null : { ...state.light },
          erased: eraseCtl?.changed() ? eraseCtl.result() : undefined,
          lightForAll: canApplyAll && $("lightAll").checked,
        });
      };
      $("editReset").onclick = () => {
        if (!idle()) return;
        const edited = erased || crop || !Light.isNeutral(light) || changed();
        if (edited && !confirm("Remove all the edits of this image and go back to the original?")) return;
        finish(edited ? null : undefined);
      };
      const cancel = () => {
        if (!idle()) return;
        if (changed() && !confirm("Discard the changes you made to this image?")) return;
        finish(undefined);
      };
      $("editCancel").onclick = cancel;
      dialog.oncancel = (e) => { e.preventDefault(); cancel(); };

      showTab("crop");
    });
  }

  // Adjust the crop of one output size, in the size's own shape.
  //   source — the image the size is made from (canvas or ImageBitmap);
  //   presetRatio — the size's width/height; current — the crop in use now {x, y, w, h}.
  // Resolves with the chosen crop, null for "Automatic crop", or undefined when cancelled.
  async function cropOnly(source, { presetRatio, current }) {
    const dialog = $("editDialog");
    if (dialog.open) return undefined;
    setMode(false);
    $("panelCrop").classList.remove("off");
    $("editName").textContent = "";
    Light.setFilter(null);
    dialog.classList.remove("lit", "compare");
    dialog.showModal();
    let ctl;
    try {
      ctl = await CropTool.start(source, { presetRatio, lockRatio: true, current });
    } catch (err) {
      dialog.close();
      alert(err.message || "Could not load the crop tool");
      return undefined;
    }
    return new Promise((resolve) => {
      const finish = (result) => {
        ctl.destroy();
        dialog.close();
        $("editSave").onclick = $("editReset").onclick = $("editCancel").onclick = dialog.oncancel = null;
        resolve(result);
      };
      $("editSave").onclick = () => finish(ctl.get());
      $("editReset").onclick = () => finish(null);
      $("editCancel").onclick = () => finish(undefined);
      dialog.oncancel = (e) => { e.preventDefault(); finish(undefined); };
    });
  }

  return { open, cropOnly };
})();
