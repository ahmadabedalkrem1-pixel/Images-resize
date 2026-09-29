/**
 * Web Upscaler - 核心類
 * 提供簡單的 API：輸入 blob，返回 upscaled blob
 */

class WebUpscaler {
  /**
   * 創建 WebUpscaler 實例
   * @param {Object} options - 配置選項
   * @param {string} options.modelType - 模型類型: 'realcugan' 或 'realesrgan'
   * @param {number} options.scale - 放大倍數: 2 或 4
   * @param {string} options.backend - 運算後端: 'webgpu' 或 'webgl'
   * @param {string} options.modelBaseUrl - 模型基礎 URL
   * @param {number} options.tileSize - Tile 大小 (預設 64)
   * @param {number} options.overlap - Overlap 大小 (預設 12)
   * @param {string} options.denoise - Real-CUGAN 降噪級別 (預設 'conservative')
   * @param {string} options.model - Real-ESRGAN 模型名稱 (預設 'anime_plus')
   */
  constructor(options = {}) {
    this.modelType = options.modelType || 'realcugan';
    this.scale = options.scale || 4;
    this.backend = options.backend || 'webgl';
    this.modelBaseUrl = options.modelBaseUrl || '/models';
    this.tileSize = options.tileSize || 64;
    this.overlap = options.overlap || 12;
    this.denoise = options.denoise || 'conservative';
    this.model = options.model || 'anime_plus';
    this.sharpen = options.sharpen || 0;
    this.debug = options.debug || false;

    this.loadedModel = null;
    this.ready = false;
  }

  _log(...args) {
    if (this.debug) console.log(...args);
  }

  /**
   * 預載入模型
   * @returns {Promise<void>}
   */
  async warmup() {
    if (this.ready) return;

    // 設置後端
    await tf.setBackend(this.backend);
    this._log('backend:', tf.getBackend());

    this.loadedModel = await this._loadModel();
    this.ready = true;

    this._log('model ready');
  }

  /**
   * 放大圖片
   * @param {Blob} inputBlob - 輸入圖片 blob
   * @param {Object} options - 選項
   * @param {string} options.format - 輸出格式: 'png', 'jpeg', 'webp' (預設 'png')
   * @param {number} options.quality - 輸出質量 0-1 (預設 0.92)
   * @param {Function} options.onProgress - 進度回調 (0-100)
   * @returns {Promise<Blob>} - 放大後的圖片 blob
   */
  async upscale(inputBlob, options = {}) {
    // 確保模型已載入
    if (!this.ready) {
      await this.warmup();
    }

    const format = options.format || 'png';
    const quality = options.quality || 0.92;
    const onProgress = options.onProgress || (() => {});

    // 1. Blob 轉 ImageData
    const imageData = await this._blobToImageData(inputBlob);

    // 2. 處理圖片
    const upscaledImageData = await this._upscaleImageData(
      imageData,
      this.loadedModel,
      this.scale,
      onProgress
    );

    // 3. ImageData 轉 Blob
    const outputBlob = await this._imageDataToBlob(upscaledImageData, format, quality);

    return outputBlob;
  }

  /**
   * 釋放資源
   */
  dispose() {
    if (this.loadedModel) {
      this.loadedModel.dispose();
      this.loadedModel = null;
      this.ready = false;
      this._log('model disposed');
    }
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 載入模型
   * @private
   */
  async _loadModel() {
    let modelUrl;
    let modelName;

    if (this.modelType === 'realesrgan') {
      modelUrl = `${this.modelBaseUrl}/realesrgan/${this.model}-${this.tileSize}/model.json`;
      modelName = `realesrgan-${this.model}-${this.tileSize}`;
    } else {
      modelUrl = `${this.modelBaseUrl}/realcugan/${this.scale}x-${this.denoise}-${this.tileSize}/model.json`;
      modelName = `realcugan-${this.scale}x-${this.denoise}-${this.tileSize}`;
    }

    this._log('loading model:', modelUrl);

    // try loading from cache
    try {
      const model = await tf.loadGraphModel(`indexeddb://${modelName}`);
      this._log('model loaded from cache');
      return model;
    } catch (error) {
      this._log('no cache, loading from network...');
    }

    // load from network and cache
    const model = await tf.loadGraphModel(modelUrl);

    try {
      await model.save(`indexeddb://${modelName}`);
      this._log('model cached');
    } catch (error) {
      if (this.debug) console.warn('failed to cache model:', error);
    }

    return model;
  }

  /**
   * 處理 ImageData
   * @private
   */
  async _upscaleImageData(imageData, model, scale, onProgress) {
    const { width, height } = imageData;

    const layout = this._calculateTileLayout(width, height, this.tileSize, this.overlap);
    const { numX, numY, locsX, locsY, padLeft, padTop, padRight, padBottom } = layout;

    const outputWidth = width * scale;
    const outputHeight = height * scale;
    const output = new ImageData(outputWidth, outputHeight);

    const total = numX * numY;
    let current = 0;

    for (let i = 0; i < numX; i++) {
      for (let j = 0; j < numY; j++) {
        const x = locsX[i];
        const y = locsY[j];

        // 提取 tile
        const tile = this._extractTile(imageData, x, y, this.tileSize, this.tileSize);

        // 處理 tile
        let outputTensor = this._processTile(tile, model);
        if (this.sharpen > 0) {
          const sharpened = this._sharpenTensor(outputTensor, this.sharpen);
          outputTensor.dispose();
          outputTensor = sharpened;
        }
        const processedTile = this._tensorToImageData(outputTensor);
        outputTensor.dispose();

        // 合併到輸出
        this._mergeTile(
          output,
          processedTile,
          (x + padLeft[i]) * scale,
          (y + padTop[j]) * scale,
          padLeft[i] * scale,
          padTop[j] * scale,
          padRight[i] * scale,
          padBottom[j] * scale
        );

        current++;
        onProgress((current / total) * 100);
      }
    }

    return output;
  }

  /**
   * 處理單個 tile
   * @private
   */
  _processTile(imageData, model) {
    return tf.tidy(() => {
      const tensor = tf.browser
        .fromPixels(imageData)
        .div(255)
        .toFloat()
        .expandDims(0);

      const output = model.predict(tensor);
      return output;
    });
  }

  /**
   * 對 tensor 套用 sharpening kernel，strength 0-1 控制混合強度
   * @private
   */
  _sharpenTensor(tensor, strength) {
    return tf.tidy(() => {
      // depthwiseConv2d kernel shape: [filterH, filterW, inChannels, channelMultiplier]
      // 同一個 laplacian sharpen kernel 套用到每個 channel
      const k = [
         0,  0,  0,  -1, -1, -1,  0,  0,  0,
        -1, -1, -1,   5,  5,  5, -1, -1, -1,
         0,  0,  0,  -1, -1, -1,  0,  0,  0
      ];
      const kernel = tf.tensor4d(k, [3, 3, 3, 1]);
      const sharpened = tf.depthwiseConv2d(tensor, kernel, 1, 'same').clipByValue(0, 1);
      return tf.add(tensor.mul(1 - strength), sharpened.mul(strength));
    });
  }

  /**
   * Tensor 轉 ImageData
   * @private
   */
  _tensorToImageData(tensor) {
    const [, height, width] = tensor.shape;

    const clipped = tf.tidy(() =>
      tensor
        .squeeze([0])
        .mul(255)
        .cast('int32')
        .clipByValue(0, 255)
    );

    const data = clipped.dataSync();
    clipped.dispose();

    // 轉換為 RGBA
    const rgbaData = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgbaData[i * 4] = data[i * 3];
      rgbaData[i * 4 + 1] = data[i * 3 + 1];
      rgbaData[i * 4 + 2] = data[i * 3 + 2];
      rgbaData[i * 4 + 3] = 255;
    }

    return new ImageData(rgbaData, width, height);
  }

  /**
   * 計算 tile 布局
   * @private
   */
  _calculateTileLayout(width, height, tileSize, overlap) {
    let numX = 1;
    let numY = 1;

    if (width > tileSize) {
      while ((tileSize * numX - width) / (numX - 1) < overlap) numX++;
    }

    if (height > tileSize) {
      while ((tileSize * numY - height) / (numY - 1) < overlap) numY++;
    }

    const locsX = new Array(numX);
    const locsY = new Array(numY);
    const padLeft = new Array(numX);
    const padTop = new Array(numY);
    const padRight = new Array(numX);
    const padBottom = new Array(numY);

    const totalLapX = tileSize * numX - width;
    const totalLapY = tileSize * numY - height;
    const baseLapX = Math.floor(totalLapX / (numX - 1));
    const baseLapY = Math.floor(totalLapY / (numY - 1));
    const extraLapX = totalLapX - baseLapX * (numX - 1);
    const extraLapY = totalLapY - baseLapY * (numY - 1);

    locsX[0] = 0;
    for (let i = 1; i < numX; i++) {
      locsX[i] = locsX[i - 1] + tileSize - baseLapX - (i <= extraLapX ? 1 : 0);
    }

    locsY[0] = 0;
    for (let i = 1; i < numY; i++) {
      locsY[i] = locsY[i - 1] + tileSize - baseLapY - (i <= extraLapY ? 1 : 0);
    }

    padLeft[0] = 0;
    padTop[0] = 0;
    padRight[numX - 1] = 0;
    padBottom[numY - 1] = 0;

    for (let i = 1; i < numX; i++) {
      padLeft[i] = Math.floor((locsX[i - 1] + tileSize - locsX[i]) / 2);
    }

    for (let i = 1; i < numY; i++) {
      padTop[i] = Math.floor((locsY[i - 1] + tileSize - locsY[i]) / 2);
    }

    for (let i = 0; i < numX - 1; i++) {
      padRight[i] = locsX[i] + tileSize - locsX[i + 1] - padLeft[i + 1];
    }

    for (let i = 0; i < numY - 1; i++) {
      padBottom[i] = locsY[i] + tileSize - locsY[i + 1] - padTop[i + 1];
    }

    return { numX, numY, locsX, locsY, padLeft, padTop, padRight, padBottom };
  }

  /**
   * 提取 tile
   * @private
   */
  _extractTile(imageData, x, y, width, height) {
    const tileData = new Uint8ClampedArray(width * height * 4);

    for (let j = 0; j < height; j++) {
      const sourceY = y + j;
      const sourceOffset = (sourceY * imageData.width + x) * 4;
      const destOffset = j * width * 4;
      tileData.set(
        imageData.data.subarray(sourceOffset, sourceOffset + width * 4),
        destOffset
      );
    }

    return new ImageData(tileData, width, height);
  }

  /**
   * 合併 tile
   * @private
   */
  _mergeTile(output, tile, x, y, padLeft, padTop, padRight, padBottom) {
    const copyWidth = tile.width - padLeft - padRight;
    const copyHeight = tile.height - padTop - padBottom;

    for (let j = 0; j < copyHeight; j++) {
      const sourceOffset = ((padTop + j) * tile.width + padLeft) * 4;
      const destOffset = ((y + j) * output.width + x) * 4;
      output.data.set(
        tile.data.subarray(sourceOffset, sourceOffset + copyWidth * 4),
        destOffset
      );
    }
  }

  /**
   * Blob 轉 ImageData
   * @private
   */
  async _blobToImageData(blob) {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        resolve(ctx.getImageData(0, 0, img.width, img.height));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('載入圖片失敗'));
      };

      img.src = url;
    });
  }

  /**
   * ImageData 轉 Blob
   * @private
   */
  async _imageDataToBlob(imageData, format = 'png', quality = 0.92) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;

    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob(resolve, `image/${format}`, quality);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebUpscaler;
}
