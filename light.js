// Light adjustments of one image: brightness, contrast and colour saturation, each from -100 to 100.
// Only the three numbers are stored; the pixels are worked out when the image is resized, so the
// settings can be changed at any time without losing quality.
//
// The same maths runs in two places and must stay in step:
//   - setFilter(): the live preview, an SVG filter (#lightFilter in index.html) the browser applies;
//   - apply():     the real pixels of the output.
window.Light = (() => {
  const $ = (id) => document.getElementById(id);
  const NEUTRAL = Object.freeze({ brightness: 0, contrast: 0, saturation: 0 });

  const isNeutral = (l) => !l || (!l.brightness && !l.contrast && !l.saturation);

  // The sliders as the numbers the maths uses.
  function params(l) {
    return {
      // Brightness bends the mid-tones (a gamma curve): black stays black and white stays white, so
      // a white background stays white and bright areas don't burn out.
      gamma: Math.pow(2, -l.brightness / 100),
      // Contrast spreads the tones around mid-grey.
      slope: l.contrast >= 0 ? 1 + l.contrast / 100 : 1 + l.contrast / 200,
      // 0 = black and white, 1 = unchanged, 2 = twice as colourful.
      saturation: 1 + l.saturation / 100,
    };
  }

  // Point the preview filter at these settings. Elements show it through CSS: filter: url(#lightFilter).
  function setFilter(l) {
    const p = params(l || NEUTRAL);
    for (const f of $("lightFilterGamma").children) f.setAttribute("exponent", p.gamma);
    for (const f of $("lightFilterContrast").children) {
      f.setAttribute("slope", p.slope);
      f.setAttribute("intercept", 0.5 - 0.5 * p.slope);
    }
    $("lightFilterSaturation").setAttribute("values", p.saturation);
  }

  // The image with the settings applied; resolves with an ImageBitmap of the same size.
  async function apply(source, l) {
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    if (isNeutral(l)) return createImageBitmap(c);

    const p = params(l);
    // Brightness and contrast depend on one channel at a time, so they become a 256-entry table.
    const table = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      const bright = Math.pow(v / 255, p.gamma);
      table[v] = Math.min(1, Math.max(0, (bright - 0.5) * p.slope + 0.5)) * 255;
    }
    const image = ctx.getImageData(0, 0, c.width, c.height);
    const d = image.data;
    const s = p.saturation;
    if (s === 1) {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = table[d[i]]; d[i + 1] = table[d[i + 1]]; d[i + 2] = table[d[i + 2]];
      }
    } else {
      // The standard saturation matrix (the one CSS and SVG filters use).
      const rr = 0.213 + 0.787 * s, rg = 0.715 - 0.715 * s, rb = 0.072 - 0.072 * s;
      const gr = 0.213 - 0.213 * s, gg = 0.715 + 0.285 * s, gb = 0.072 - 0.072 * s;
      const br = 0.213 - 0.213 * s, bg = 0.715 - 0.715 * s, bb = 0.072 + 0.928 * s;
      for (let i = 0; i < d.length; i += 4) {
        const r = table[d[i]], g = table[d[i + 1]], b = table[d[i + 2]];
        d[i] = rr * r + rg * g + rb * b;       // the array clamps to 0–255 and rounds
        d[i + 1] = gr * r + gg * g + gb * b;
        d[i + 2] = br * r + bg * g + bb * b;
      }
    }
    ctx.putImageData(image, 0, 0);
    return createImageBitmap(c);
  }

  return { NEUTRAL, isNeutral, setFilter, apply };
})();
