// NULLPUNKT — Worker für prozedurale Texturen (Owner: world). Antwortet mit übertragbaren Puffern.
import { generateTexture } from './texgen.js';

self.onmessage = e => {
  const { texName, S } = e.data || {};
  try {
    const r = generateTexture(texName, S);
    self.postMessage({ texName, result: r }, [r.albedo.buffer, r.normal.buffer, r.rm.buffer]);
  } catch (err) {
    self.postMessage({ texName, error: String(err && err.message || err) });
  }
};
