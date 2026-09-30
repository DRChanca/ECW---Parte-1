"use strict";

const WIDTH = 1280;
const HEIGHT = 720;
const BYTES_PER_PIXEL = 4;
const IMAGE_BYTES = WIDTH * HEIGHT * BYTES_PER_PIXEL;
const INPUT_POINTER = 0;
const OUTPUT_POINTER = IMAGE_BYTES;

const WASM_BASE64 =
  "AGFzbQEAAAABCAFgBH9/f38AAwIBAAUDAQBxBxMCBm1lbW9yeQIABmRpbGF0ZQAACt8BAdwBAQV/QQAhBQJAA0AgBSADTw0BQQAhBAJAA0AgBCACTw0BIAUgAmwgBGpBAnQhBiAAIAZqIQcgBy0AAEUhCCAIRSAEQQBLcQRAIAdBBGstAABFIQgLIAhFIARBAWogAklxBEAgB0EEai0AAEUhCAsgCEUgBUEAS3EEQCAHIAJBAnRrLQAARSEICyAIRSAFQQFqIANJcQRAIAcgAkECdGotAABFIQgLIAgEQCABIAZqQYCAgHg2AgAFIAEgBmogBygCADYCAAsgBEEBaiEEDAALCyAFQQFqIQUMAAsLCw==";

const fileInput = document.querySelector("#image-file");
const fileName = document.querySelector("#file-name");
const loadWasmButton = document.querySelector("#load-wasm-button");
const wasmModeInputs = document.querySelectorAll('input[name="wasm-mode"]');
const compareButton = document.querySelector("#compare-button");
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const jsTime = document.querySelector("#js-time");
const wasmTime = document.querySelector("#wasm-time");

const originalCanvas = document.querySelector("#original-canvas");
const jsCanvas = document.querySelector("#js-canvas");
const wasmCanvas = document.querySelector("#wasm-canvas");

let selectedFile = null;
let wasm = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}

function resetResults() {
  jsTime.textContent = "— ms";
  wasmTime.textContent = "— ms";
  summary.textContent = "Selecciona una imagen válida para comenzar.";
  jsCanvas.getContext("2d").clearRect(0, 0, WIDTH, HEIGHT);
  wasmCanvas.getContext("2d").clearRect(0, 0, WIDTH, HEIGHT);
}

async function decodeFile(file) {
  const encodedBytes = await file.arrayBuffer();
  const blob = new Blob([encodedBytes], { type: file.type });
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, WIDTH, HEIGHT);
  } finally {
    bitmap.close();
  }
}

async function validateFile(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.type)) {
    throw new Error("Selecciona un archivo PNG o JPEG.");
  }

  const encodedBytes = await file.arrayBuffer();
  const bitmap = await createImageBitmap(new Blob([encodedBytes], { type: file.type }));

  try {
    if (bitmap.width !== WIDTH || bitmap.height !== HEIGHT) {
      throw new Error(`La imagen debe medir exactamente ${WIDTH} × ${HEIGHT} píxeles.`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, WIDTH, HEIGHT);

    for (let index = 0; index < imageData.data.length; index += BYTES_PER_PIXEL) {
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const alpha = imageData.data[index + 3];
      const isBlack = red === 0 && green === 0 && blue === 0;
      const isWhite = red === 255 && green === 255 && blue === 255;

      if (alpha !== 255 || (!isBlack && !isWhite)) {
        throw new Error("La imagen debe contener únicamente píxeles negros o blancos totalmente opacos.");
      }
    }

    originalCanvas.getContext("2d").putImageData(imageData, 0, 0);
  } finally {
    bitmap.close();
  }
}

function dilateWithJavaScript(source) {
  const output = new Uint8ClampedArray(source.length);

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const pixel = y * WIDTH + x;
      const offset = pixel * BYTES_PER_PIXEL;
      let black = source[offset] === 0;

      if (!black && x > 0) {
        black = source[offset - BYTES_PER_PIXEL] === 0;
      }
      if (!black && x + 1 < WIDTH) {
        black = source[offset + BYTES_PER_PIXEL] === 0;
      }
      if (!black && y > 0) {
        black = source[offset - WIDTH * BYTES_PER_PIXEL] === 0;
      }
      if (!black && y + 1 < HEIGHT) {
        black = source[offset + WIDTH * BYTES_PER_PIXEL] === 0;
      }

      const value = black ? 0 : 255;
      output[offset] = value;
      output[offset + 1] = value;
      output[offset + 2] = value;
      output[offset + 3] = 255;
    }
  }

  return output;
}

async function runJavaScript(file) {
  const startedAt = performance.now();
  const imageData = await decodeFile(file);
  const output = dilateWithJavaScript(imageData.data);
  jsCanvas.getContext("2d").putImageData(new ImageData(output, WIDTH, HEIGHT), 0, 0);
  return performance.now() - startedAt;
}

async function runWebAssembly(file) {
  const startedAt = performance.now();
  await loadWebAssembly();
  const imageData = await decodeFile(file);
  const bytes = new Uint8Array(wasm.exports.memory.buffer);
  bytes.set(imageData.data, INPUT_POINTER);
  wasm.exports.dilate(INPUT_POINTER, OUTPUT_POINTER, WIDTH, HEIGHT);

  const wasmOutput = new Uint8ClampedArray(
    wasm.exports.memory.buffer,
    OUTPUT_POINTER,
    IMAGE_BYTES
  );
  const copiedOutput = wasmOutput.slice();
  wasmCanvas.getContext("2d").putImageData(
    new ImageData(copiedOutput, WIDTH, HEIGHT),
    0,
    0
  );
  return performance.now() - startedAt;
}

function describeComparison(javaScriptMilliseconds, wasmMilliseconds) {
  if (javaScriptMilliseconds === wasmMilliseconds) {
    return "Ambas implementaciones han tardado lo mismo.";
  }

  const wasmIsFaster = wasmMilliseconds < javaScriptMilliseconds;
  const fastestName = wasmIsFaster ? "WebAssembly" : "JavaScript";
  const ratio = wasmIsFaster
    ? javaScriptMilliseconds / wasmMilliseconds
    : wasmMilliseconds / javaScriptMilliseconds;
  return `${fastestName} ha sido ${ratio.toFixed(2)}× más rápido.`;
}

wasmModeInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    if (!input.checked) {
      return;
    }

    if (input.value === "during-comparison") {
      wasm = null;
      loadWasmButton.disabled = false;
      loadWasmButton.textContent = "Cargar WebAssembly";
      setStatus("WebAssembly se cargara durante la comparacion.");
      return;
    }

    loadWasmButton.disabled = true;
    setStatus("Cargando WebAssembly antes de comparar...");
    try {
      await loadWebAssembly();
      if (!input.checked) {
        wasm = null;
        return;
      }
      loadWasmButton.textContent = "WebAssembly cargado";
      setStatus("WebAssembly esta cargado y no se incluira en la medicion.");
    } catch (error) {
      loadWasmButton.disabled = false;
      loadWasmButton.textContent = "Cargar WebAssembly";
      setStatus(error instanceof Error ? error.message : "No se pudo cargar WebAssembly.", true);
    }
  });
});

fileInput.addEventListener("change", async () => {
  compareButton.disabled = true;
  selectedFile = null;
  resetResults();
  originalCanvas.getContext("2d").clearRect(0, 0, WIDTH, HEIGHT);

  const [file] = fileInput.files;
  fileName.textContent = file ? file.name : "Ningún archivo seleccionado";
  if (!file) {
    setStatus("Selecciona una imagen para continuar.");
    return;
  }

  setStatus("Validando la imagen…");
  try {
    await validateFile(file);
    selectedFile = file;
    compareButton.disabled = false;
    setStatus(
      wasm
        ? "Imagen válida. WebAssembly ya está cargado y su carga no se medirá."
        : "Imagen válida. Puedes precargar WebAssembly o incluir su carga al comparar."
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se ha podido leer la imagen.", true);
  }
});

async function loadWebAssembly() {
  if (wasm) {
    return wasm;
  }

  const binary = atob(WASM_BASE64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const result = await WebAssembly.instantiate(bytes);
  wasm = result.instance;
  return wasm;
}

loadWasmButton.addEventListener("click", async () => {
  loadWasmButton.disabled = true;
  loadWasmButton.textContent = "Cargando…";
  setStatus("Cargando WebAssembly fuera de la medición…");

  try {
    await loadWebAssembly();
    loadWasmButton.textContent = "WebAssembly cargado";
    setStatus(
      selectedFile
        ? "WebAssembly cargado. Su tiempo de carga no se incluirá en la comparación."
        : "WebAssembly cargado. Selecciona una imagen para continuar."
    );
  } catch (error) {
    loadWasmButton.disabled = false;
    loadWasmButton.textContent = "Cargar WebAssembly";
    setStatus(
      `${error instanceof Error ? error.message : "Error desconocido"} Ejecuta la aplicación con npm start.`,
      true
    );
  }
});

compareButton.addEventListener("click", async () => {
  if (!selectedFile) {
    return;
  }

  const wasmMode = document.querySelector('input[name="wasm-mode"]:checked').value;
  if (wasmMode === "during-comparison") {
    // Cada comparacion debe incluir una nueva inicializacion del modulo.
    wasm = null;
  }
  const wasmWasPreloaded = Boolean(wasm);
  compareButton.disabled = true;
  loadWasmButton.disabled = true;
  jsTime.textContent = "Midiendo…";
  wasmTime.textContent = "En espera…";
  summary.textContent = "Ejecutando primero JavaScript y después WebAssembly…";
  setStatus("Comparación en curso…");

  try {
    const javaScriptMilliseconds = await runJavaScript(selectedFile);
    jsTime.textContent = `${javaScriptMilliseconds.toFixed(3)} ms`;

    wasmTime.textContent = "Midiendo…";
    const wasmMilliseconds = await runWebAssembly(selectedFile);
    wasmTime.textContent = `${wasmMilliseconds.toFixed(3)} ms`;

    const loadDescription = wasmWasPreloaded
      ? "La carga de WebAssembly no se ha incluido."
      : "La carga de WebAssembly se ha incluido.";
    summary.textContent = `${describeComparison(javaScriptMilliseconds, wasmMilliseconds)} ${loadDescription}`;
    setStatus("Comparación completada.");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Se ha producido un error durante la comparación.",
      true
    );
    summary.textContent = "No se ha podido completar la comparación.";
  } finally {
    compareButton.disabled = false;
    loadWasmButton.disabled = Boolean(wasm);
    if (wasm) {
      loadWasmButton.textContent = "WebAssembly cargado";
    }
  }
});
