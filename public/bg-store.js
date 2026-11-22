// Client-only custom card/replay backgrounds. Never uploaded to the server.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BgStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DB = 'devameer-bg';
  const STORE = 'media';
  const SETTINGS_KEY = 'devameer-card-bg';
  const MAX_IMAGE = 5 * 1024 * 1024;
  const MAX_VIDEO = 25 * 1024 * 1024;
  const MAX_VIDEO_S = 30;
  const defaults = { dim: 0.48, blur: 10, fit: 'cover' };

  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function idb(mode, fn) {
    return openDb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let val;
      if (req && typeof req === 'object' && 'onsuccess' in req) req.onsuccess = () => { val = req.result; };
      tx.oncomplete = () => res(val);
      tx.onerror = () => rej(tx.error);
    }));
  }
  function settings() {
    try {
      const j = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (j && typeof j === 'object') return { ...defaults, ...j, fit: j.fit === 'contain' ? 'contain' : 'cover' };
    } catch { /* ignore */ }
    return { ...defaults };
  }
  function saveSettings(s) {
    const next = { ...settings(), ...s };
    next.dim = Math.max(0, Math.min(0.85, +next.dim || 0));
    next.blur = Math.max(0, Math.min(24, +next.blur || 0));
    next.fit = next.fit === 'contain' ? 'contain' : 'cover';
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }
  function videoMeta(file) {
    return new Promise((res, rej) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
        URL.revokeObjectURL(v.src);
        res(info);
      };
      v.onerror = () => rej(new Error('Could not read that video'));
      v.src = URL.createObjectURL(file);
    });
  }
  async function saveFile(file) {
    if (!file) throw new Error('No file');
    const type = String(file.type || '');
    const isVideo = type.startsWith('video/');
    const isImage = type.startsWith('image/');
    if (!isVideo && !isImage) throw new Error('Choose a photo or a video');
    if (isImage && file.size > MAX_IMAGE) throw new Error('Photo must be 5 MB or smaller');
    if (isVideo && file.size > MAX_VIDEO) throw new Error('Video must be 25 MB or smaller');
    if (isVideo) {
      const meta = await videoMeta(file);
      if (!Number.isFinite(meta.duration) || meta.duration > MAX_VIDEO_S + 0.5) throw new Error('Video must be 30 seconds or shorter');
    }
    const rec = { name: file.name, type, kind: isVideo ? 'video' : 'image', size: file.size, blob: file };
    await idb('readwrite', (s) => s.put(rec, 'file'));
    return rec;
  }
  async function loadFile() {
    const rec = await idb('readonly', (s) => s.get('file'));
    return rec && rec.result !== undefined ? rec.result : rec;
  }
  async function clearFile() { await idb('readwrite', (s) => s.delete('file')); }
  return { MAX_IMAGE, MAX_VIDEO, MAX_VIDEO_S, defaults, settings, saveSettings, saveFile, loadFile, clearFile, videoMeta };
});
