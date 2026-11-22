// Parse CAD files off the main thread with occt-import-js.
importScripts('occt-import-js.js');

let occtPromise = null;

onmessage = async (ev) => {
  try {
    if (!occtPromise) {
      occtPromise = occtimportjs({ locateFile: (p) => p });
    }
    const occt = await occtPromise;
    const { format, buffer, params } = ev.data;
    const result = occt.ReadFile(format, new Uint8Array(buffer), params);
    postMessage({ ok: true, result });
  } catch (err) {
    postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
