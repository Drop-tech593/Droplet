/* Shared, short-lived file transfer between Droplet tools. */
(() => {
  'use strict';
  const DB_NAME = 'droplet-transfer-v2';
  const STORE = 'transfers';
  const SESSION_KEY = 'droplet-transfer-token';
  const TTL = 120000;
  const normalizeRoute = path => path.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  let cleanupTimer;

  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser storage is unavailable.'));
      request.onblocked = () => reject(new Error('Close other Droplet tabs and try again.'));
    });
  }

  async function transaction(mode, action) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let result;
        const setResult = value => { result = value; };
        try { action(tx.objectStore(STORE), setResult); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Could not access browser storage.'));
        tx.onabort = () => reject(tx.error || new Error('The file transfer was interrupted.'));
      });
    } finally { db.close(); }
  }

  async function cleanup() {
    await transaction('readwrite', store => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!cursor.value.createdAt || Date.now() - cursor.value.createdAt >= TTL) cursor.delete();
        cursor.continue();
      };
    });
  }

  async function clearPending() {
    const id = sessionStorage.getItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    if (id) await transaction('readwrite', store => store.delete(id));
  }

  async function send(files, route) {
    const selected = Array.from(files || []);
    if (!selected.length) throw new Error('Choose a file first.');
    if (selected.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
      throw new Error('Homepage transfers support up to 100 MB in total. Open the tool directly to check its file limit.');
    }
    if (selected.length > 20) throw new Error('Transfer up to 20 files at a time.');
    await cleanup();
    await clearPending();
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      id, route: normalizeRoute(route), createdAt: Date.now(),
      files: selected.map(file => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file }))
    };
    await transaction('readwrite', store => store.put(payload));
    try { sessionStorage.setItem(SESSION_KEY, id); }
    catch (error) { await transaction('readwrite', store => store.delete(id)); throw error; }
    location.assign(route);
  }

  function announce(message, kind = 'info') {
    let notice = document.getElementById('droplet-transfer-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'droplet-transfer-notice';
      notice.setAttribute('role', 'status');
      notice.className = 'droplet-notice';
      (document.querySelector('main') || document.body).prepend(notice);
    }
    notice.dataset.kind = kind;
    notice.textContent = message;
  }

  async function consume() {
    const id = sessionStorage.getItem(SESSION_KEY);
    if (!id) return;
    const payload = await transaction('readonly', (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => result(request.result);
    });
    if (!payload) { sessionStorage.removeItem(SESSION_KEY); return; }
    if (Date.now() - payload.createdAt >= TTL) {
      await clearPending();
      announce('Your temporary file transfer expired. Please select the file again.', 'warning');
      return;
    }
    if (normalizeRoute(location.pathname) !== payload.route) return;
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const preferred = document.getElementById('fileInput') || document.getElementById('file-input') || document.getElementById('recording');
    const input = preferred || inputs.find(element => !element.accept.includes('image')) || inputs[0];
    if (!input) {
      await clearPending();
      announce('Open this tool’s file picker to select your file.', 'warning');
      return;
    }
    try {
      const transfer = new DataTransfer();
      const files = input.multiple ? payload.files : payload.files.slice(0, 1);
      for (const entry of files) transfer.items.add(new File([entry.blob], entry.name, { type: entry.type, lastModified: entry.lastModified }));
      input.files = transfer.files;
      await clearPending();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      announce(files.length === 1 ? `Selected file: ${files[0].name}.` : `${files.length} files selected.`, 'success');
    } catch (error) {
      await clearPending();
      announce('This browser could not restore the selected file. Please choose it again using the tool’s file picker.', 'warning');
    }
  }

  function boot() {
    for (const element of document.querySelectorAll('[data-current-year]')) element.textContent = new Date().getFullYear();
    for (const input of document.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
      if (input.labels?.length || input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')) continue;
      input.setAttribute('aria-label', input.type === 'file' ? 'Choose a file' : input.placeholder || input.id.replace(/([A-Z])/g, ' $1') || 'Tool input');
    }
    for (const button of document.querySelectorAll('button')) {
      if (/^[✕×x]$/i.test(button.textContent.trim()) && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Close');
    }
    const themeButton = document.querySelector('[data-droplet-theme]');
    if (themeButton) {
      const update = () => {
        const dark = document.documentElement.classList.contains('dark');
        themeButton.setAttribute('aria-pressed', String(dark));
        themeButton.textContent = dark ? 'Light mode' : 'Dark mode';
      };
      update();
      themeButton.addEventListener('click', () => {
        const dark = document.documentElement.classList.toggle('dark');
        try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (_) {}
        update();
      });
    }
    cleanup().then(consume).catch(() => {
      try { if (sessionStorage.getItem(SESSION_KEY)) announce('Browser storage is unavailable. Please select your file again.', 'warning'); } catch (_) {}
    });
    cleanupTimer = setInterval(() => cleanup().catch(() => {}), TTL);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cleanup().catch(() => {}); });
  }
  window.DropletTransfer = Object.freeze({ send, clear: clearPending });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('pagehide', () => clearInterval(cleanupTimer));
})();
