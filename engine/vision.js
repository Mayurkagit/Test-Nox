import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The captcha model and its weights. The weights file name is also written
// inside the model, so renaming it means patching the model too.
const MODEL_FILE = 'nd_core_layer.bin';
const MODEL_WEIGHTS = 'nd_core_layer.weights';
const require = createRequire(import.meta.url);

// Two engines run the same captcha model:
//  - native (onnxruntime-node, C++): the fastest. It needs Microsoft's Visual C++
//    runtime DLLs, which ship beside it (scripts/copy-vc-runtime.cjs).
//  - wasm (onnxruntime-web, WebAssembly): no native code at all, so it runs on any
//    PC where the native one can't load or can't open the model (a few ms slower).
// The native engine is tried first; the WebAssembly one takes over if it fails.
let ort = null; // the engine in use
let engine = ''; // 'native' | 'wasm'
let nativeError = '';
let ortSession = null;
let sessionLoadingPromise = null;
let lastInitError = null;

// Files the engines read from disk live in app.asar.unpacked in the packaged app
// (asarUnpack in package.json).
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

export function captchaEngineInfo() {
  return { engine, nativeError, lastInitError, ready: !!ortSession };
}

async function openNative(modelPath) {
  const mod = await import('onnxruntime-node');
  const nort = mod.default || mod;
  let session = null;
  try {
    session = await nort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });
  } catch (err) {
    console.warn('⚠️ [Native ONNX] Defaulting to automatic backend:', err.message);
    session = await nort.InferenceSession.create(modelPath);
  }
  return { ort: nort, session };
}

async function openWasm(modelPath) {
  const mod = await import('onnxruntime-web');
  const wort = mod.default || mod;
  // Its loader script and .wasm sit in onnxruntime-web/dist; handed over directly
  // so nothing is fetched and nothing is read from inside app.asar.
  const dist = unpacked(path.dirname(require.resolve('onnxruntime-web')));
  wort.env.wasm.numThreads = 1;
  wort.env.wasm.proxy = false;
  wort.env.wasm.wasmPaths = {
    mjs: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.mjs')).href,
    wasm: pathToFileURL(path.join(dist, 'ort-wasm-simd-threaded.wasm')).href,
  };
  wort.env.wasm.wasmBinary = fs.readFileSync(path.join(dist, 'ort-wasm-simd-threaded.wasm'));
  // The model's weights are in a second file beside it, under the name the
  // model itself records (nd_core_layer.weights).
  const dataName = MODEL_WEIGHTS;
  const dataPath = path.join(path.dirname(modelPath), dataName);
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  if (fs.existsSync(dataPath)) options.externalData = [{ path: dataName, data: new Uint8Array(fs.readFileSync(dataPath)) }];
  const session = await wort.InferenceSession.create(new Uint8Array(fs.readFileSync(modelPath)), options);
  return { ort: wort, session };
}

// Numerically stable softmax
function softmax(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  let sum = 0;
  const exp = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    exp[i] = Math.exp(arr[i] - max);
    sum += exp[i];
  }
  for (let i = 0; i < arr.length; i++) {
    exp[i] /= sum;
  }
  return exp;
}

/**
 * Open the captcha model (native engine, else WebAssembly) and warm it up.
 * `opts.engine` ('native' | 'wasm') forces one engine (for testing).
 */
export async function initLocalCaptchaModel(customModelPath = null, opts = {}) {
  if (ortSession) return ortSession;
  if (sessionLoadingPromise) return sessionLoadingPromise;

  sessionLoadingPromise = (async () => {
    try {
      lastInitError = null;
      // In the packaged app the model ships unpacked (asarUnpack in package.json):
      // onnxruntime's native loader reads it from disk, together with its
      // weights file beside it, and cannot see inside app.asar.
      const defaultPath = unpacked(path.resolve(__dirname, '..', 'models', MODEL_FILE));
      const modelPath = customModelPath || defaultPath;

      if (!fs.existsSync(modelPath)) {
        throw new Error(`ONNX model file not found at: ${modelPath}`);
      }

      let opened = null;
      if (opts.engine !== 'wasm') {
        try {
          console.log('⚡ [Native ONNX] Initializing C++ inference session from:', modelPath);
          opened = await openNative(modelPath);
          engine = 'native';
        } catch (err) {
          nativeError = `${err.name || 'Error'}: ${err.message || String(err)}`;
          console.error('❌ [Native ONNX] Native engine unavailable, using WebAssembly:', nativeError);
          if (opts.engine === 'native') throw err;
        }
      }
      if (!opened) {
        console.log('⚡ [WASM ONNX] Initializing WebAssembly inference session from:', modelPath);
        opened = await openWasm(modelPath);
        engine = 'wasm';
      }

      ort = opened.ort;
      const session = opened.session;
      ortSession = session;
      console.log(`✅ [${engine === 'native' ? 'Native' : 'WASM'} ONNX] Inference session created successfully!`);

      // 🔥 IMMEDIATE FAST WARMUP: Run dummy tensor to pre-compile execution graph in RAM
      try {
        const dummyTensor = new ort.Tensor('float32', new Float32Array(1 * 1 * 36 * 120), [1, 1, 36, 120]);
        await session.run({ input: dummyTensor });
        console.log('🔥 [ONNX] Execution graph pre-warmed in RAM');
      } catch (warmupErr) {
        console.warn('⚠️ [ONNX] Pre-warm notice:', warmupErr);
      }

      return session;
    } catch (e) {
      lastInitError = `${e.name || 'Error'}: ${e.message || String(e)}`;
      console.error('❌ [ONNX] Failed to load ONNX model:', lastInitError);
      return null;
    } finally {
      sessionLoadingPromise = null;
    }
  })();

  return sessionLoadingPromise;
}

/**
 * Decode left and right logits from model output.
 */
function decodeLogits(results, startTime) {
  const leftData = results.left_logits?.data;
  const rightData = results.right_logits?.data;

  if (!leftData || !rightData) {
    throw new Error('Invalid model output: missing left_logits or right_logits');
  }

  // Decode Left Logits (21 classes -> 10..30)
  const leftProbs = softmax(leftData);
  let maxLeftIdx = 0;
  let maxLeftProb = leftProbs[0];
  for (let i = 1; i < leftProbs.length; i++) {
    if (leftProbs[i] > maxLeftProb) {
      maxLeftProb = leftProbs[i];
      maxLeftIdx = i;
    }
  }
  const predLeft = maxLeftIdx + 10;

  // Decode Right Logits (9 classes -> 1..9)
  const rightProbs = softmax(rightData);
  let maxRightIdx = 0;
  let maxRightProb = rightProbs[0];
  for (let i = 1; i < rightProbs.length; i++) {
    if (rightProbs[i] > maxRightProb) {
      maxRightProb = rightProbs[i];
      maxRightIdx = i;
    }
  }
  const predRight = maxRightIdx + 1;

  const sum = predLeft + predRight;
  const confidence = maxLeftProb * maxRightProb;
  const durationMs = Number((performance.now() - startTime).toFixed(2));

  // Sanity validation: 10 <= sum <= 40
  if (sum < 10 || sum > 40) {
    return {
      success: false,
      error: `Sum ${sum} out of bounds (10-40)`,
      confidence: Number(confidence.toFixed(4)),
      durationMs
    };
  }

  return {
    success: true,
    data: {
      answer: String(sum),
      numericAnswer: sum,
      left: predLeft,
      right: predRight,
      leftConfidence: Number(maxLeftProb.toFixed(4)),
      rightConfidence: Number(maxRightProb.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      durationMs,
      model: engine === 'wasm' ? 'wasm-onnx-web-v1' : 'native-onnx-node-v1',
      rawText: `${predLeft} + ${predRight} = ${sum}`
    }
  };
}

/**
 * Solve captcha using pre-extracted Float32Array (1 * 1 * 36 * 120).
 * Ultra-fast path: < 2ms execution time.
 */
export async function solveCaptchaTensor(floatArray) {
  const startTime = performance.now();
  try {
    const session = await initLocalCaptchaModel();
    if (!session) {
      return { success: false, error: `ONNX init failed: ${lastInitError || 'Unknown error'}` };
    }

    // Accept TypedArray or regular Array/Object with length 4320
    const rawFloats = floatArray instanceof Float32Array ? floatArray : new Float32Array(Object.values(floatArray));
    if (rawFloats.length !== 1 * 1 * 36 * 120) {
      return { success: false, error: `Invalid tensor size: expected 4320 floats, got ${rawFloats.length}` };
    }

    const inputTensor = new ort.Tensor('float32', rawFloats, [1, 1, 36, 120]);
    const results = await session.run({ input: inputTensor });

    return decodeLogits(results, startTime);
  } catch (err) {
    console.error('❌ [ONNX] Tensor execution error:', err);
    return {
      success: false,
      error: err.message || 'Local ONNX inference failed',
      durationMs: Number((performance.now() - startTime).toFixed(2))
    };
  }
}

/**
 * Solve captcha from Base64 or Buffer using nativeImage.
 */
export async function solveCaptchaBase64(base64Image, nativeImageHelper = null) {
  const startTime = performance.now();
  try {
    if (!base64Image) {
      return { success: false, error: 'Empty base64Image string provided' };
    }

    let nativeImage = nativeImageHelper;
    if (!nativeImage) {
      try {
        const electron = await import('electron');
        nativeImage = electron.nativeImage || electron.default?.nativeImage;
      } catch (_) {}
    }

    if (!nativeImage) {
      return { success: false, error: 'nativeImage module not available for base64 decoding' };
    }

    let img = null;
    if (typeof base64Image === 'string') {
      if (base64Image.startsWith('data:')) {
        img = nativeImage.createFromDataURL(base64Image);
      } else {
        const buf = Buffer.from(base64Image, 'base64');
        img = nativeImage.createFromBuffer(buf);
      }
    } else if (Buffer.isBuffer(base64Image)) {
      img = nativeImage.createFromBuffer(base64Image);
    }

    if (!img || img.isEmpty()) {
      return { success: false, error: 'Failed to decode image from base64 buffer' };
    }

    // Resize to 120x36
    const resized = img.resize({ width: 120, height: 36, quality: 'best' });
    const bitmap = resized.toBitmap(); // BGRA Buffer (120 * 36 * 4)

    const floatArray = new Float32Array(1 * 1 * 36 * 120);
    for (let i = 0; i < 36 * 120; i++) {
      // In Electron toBitmap(), order is typically BGRA
      const b = bitmap[i * 4];
      const g = bitmap[i * 4 + 1];
      const r = bitmap[i * 4 + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      floatArray[i] = (gray / 255.0 - 0.5) / 0.5;
    }

    return await solveCaptchaTensor(floatArray);
  } catch (err) {
    console.error('❌ [ONNX] Base64 solve error:', err);
    return {
      success: false,
      error: err.message || 'Base64 image solve failed',
      durationMs: Number((performance.now() - startTime).toFixed(2))
    };
  }
}
