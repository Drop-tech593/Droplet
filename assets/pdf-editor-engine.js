
// ============================================================
// CORE SETUP
// ============================================================
pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/c0a5848ab2-pdf.worker.min.js';

const BASE_RENDER_SCALE = 1.5;
const HIT_TOLERANCE = 6;
const MIN_TEXT_ITEMS_FOR_DIGITAL = 5;
const THUMB_CACHE = new Map();

function uid() { return 'o' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function toast(msg, ms) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms || 2200);
}

function showLoading(msg) {
  const o = document.getElementById('loadingOverlay');
  document.getElementById('loadingMsg').textContent = msg || 'Working…';
  o.classList.add('show');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

function hexToRgb(hex) {
  const m = String(hex || '#000000').replace('#','');
  const v = m.length === 3 ? m.split('').map(c=>c+c).join('') : m;
  const n = parseInt(v, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
}

// ============================================================
// STATE
// ============================================================
const state = {
  pdfBytes: null,
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  zoom: 1,
  tool: 'select',
  pages: [],
  selectedObjectId: null,
  interaction: null,
  undoStack: [],
  redoStack: [],
  pageCanvasCache: {},
  renderedAtZoom: {}
};

const toolDefaults = {
  text:      { fontSize: 14, color: '#1e293b' },
  highlight: { color: '#fde047', opacity: 0.45 },
  whiteout:  { color: '#ffffff', opacity: 1 },
  draw:      { color: '#ef4444', strokeWidth: 3 },
  shape:     { color: '#2563eb', strokeWidth: 3, fill: false, shape: 'rect' }
};

// ============================================================
// FONT FALLBACK TABLE
// ============================================================
const FONT_FALLBACKS = [
  { re: /arial|helvetica|liberation\s*sans|nimbus\s*sans/i, family: 'Helvetica, Arial, sans-serif', pdfFamily: 'Helvetica' },
  { re: /times|liberation\s*serif|nimbus\s*roman/i, family: "'Times New Roman', Times, serif", pdfFamily: 'Times-Roman' },
  { re: /courier|mono/i, family: "'Courier New', Courier, monospace", pdfFamily: 'Courier' },
  { re: /georgia/i, family: 'Georgia, serif', pdfFamily: 'Times-Roman' },
  { re: /verdana/i, family: 'Verdana, Geneva, sans-serif', pdfFamily: 'Helvetica' },
  { re: /calibri|carlito/i, family: 'Calibri, Carlito, sans-serif', pdfFamily: 'Helvetica' },
  { re: /cambria/i, family: 'Cambria, Georgia, serif', pdfFamily: 'Times-Roman' }
];
function mapPdfFontToWeb(fontName, isBold, isItalic) {
  const clean = String(fontName || '').replace(/^[A-Z]{6}\+/, '');
  for (const f of FONT_FALLBACKS) {
    if (f.re.test(clean)) return { cssFamily: f.family, pdfFamily: f.pdfFamily, bold: !!isBold, italic: !!isItalic };
  }
  return { cssFamily: 'Helvetica, Arial, sans-serif', pdfFamily: 'Helvetica', bold: !!isBold, italic: !!isItalic };
}
function detectBold(n) { return /bold|black|heavy|demi|semibold|700|800|900/i.test(n || ''); }
function detectItalic(n) { return /italic|oblique|it\b/i.test(n || ''); }

// ============================================================
// DOM CACHE
// ============================================================
const el = {
  pdfInput: document.getElementById('pdfInput'),
  imageInput: document.getElementById('imageInput'),
  signInput: document.getElementById('signInput'),
  workspace: document.getElementById('workspace'),
  emptyState: document.getElementById('emptyState'),
  singlePageWrapper: document.getElementById('singlePageWrapper'),
  thumbnailList: document.getElementById('thumbnailList'),
  emptyThumbnails: document.getElementById('emptyThumbnails'),
  propsEmpty: document.getElementById('propsEmpty'),
  pageProps: document.getElementById('pageProps'),
  textProps: document.getElementById('textProps'),
  objectProps: document.getElementById('objectProps'),
  objectTypeLabel: document.getElementById('objectTypeLabel'),
  pageInfoText: document.getElementById('pageInfoText'),
  statusPage: document.getElementById('statusPage'),
  statusTool: document.getElementById('statusTool'),
  statusRecon: document.getElementById('statusRecon'),
  docTitleText: document.getElementById('docTitleText'),
  zoomLevel: document.getElementById('zoomLevel'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  ocrBtn: document.getElementById('ocrBtn')
};

// ============================================================
// DARK MODE
// ============================================================
(function() {
  const html = document.documentElement;
  const t = document.getElementById('theme-toggle');
  const saved = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (saved === 'dark') { html.classList.add('dark'); t.textContent = '☀️'; }
  t.addEventListener('click', () => {
    if (html.classList.contains('dark')) { html.classList.remove('dark'); t.textContent = '🌙'; localStorage.setItem('theme','light'); }
    else { html.classList.add('dark'); t.textContent = '☀️'; localStorage.setItem('theme','dark'); }
  });
})();

// ============================================================
// DOC TITLE
// ============================================================
let docTitle = 'Untitled PDF';
function setDocTitle(name) {
  docTitle = name || 'Untitled PDF';
  el.docTitleText.textContent = docTitle;
}
function editDocTitle() {
  const wrap = document.getElementById('docTitle');
  const text = document.getElementById('docTitleText');
  const btn = document.getElementById('docTitleEditBtn');
  if (wrap.querySelector('input')) return;
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'title-input';
  input.value = docTitle; input.style.display = 'block';
  text.style.display = 'none'; btn.style.display = 'none';
  wrap.appendChild(input); input.focus(); input.select();
  const finish = () => {
    setDocTitle(input.value.trim() || 'Untitled PDF');
    input.remove(); text.style.display = ''; btn.style.display = '';
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = docTitle; input.blur(); }
  });
}

// ============================================================
// HISTORY
// ============================================================
function snapshot() {
  return JSON.stringify({
    pages: state.pages.map(p => ({
      ...p,
      objects: p.objects.map(o => { const { _img, ...rest } = o; return rest; })
    })),
    currentPage: state.currentPage,
    selectedObjectId: state.selectedObjectId
  });
}
function pushHistory() {
  state.undoStack.push(snapshot());
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
  updateHistoryButtons();
}
async function undo() {
  if (!state.undoStack.length) return;
  const current = snapshot();
  const prev = state.undoStack.pop();
  state.redoStack.push(current);
  await applySnapshot(prev);
  toast('Undo');
}
async function redo() {
  if (!state.redoStack.length) return;
  const current = snapshot();
  const next = state.redoStack.pop();
  state.undoStack.push(current);
  await applySnapshot(next);
  toast('Redo');
}
async function applySnapshot(json) {
  const s = JSON.parse(json);
  state.pages = s.pages;
  state.currentPage = clamp(s.currentPage, 1, s.pages.length);
  state.selectedObjectId = s.selectedObjectId || null;
  for (const p of state.pages) {
    for (const o of p.objects) {
      if ((o.type === 'image' || o.type === 'sign') && o.dataUrl && !o._img) {
        try { o._img = await loadImage(o.dataUrl); } catch(_) {}
      }
    }
  }
  await renderCurrentPage();
  renderThumbnails();
  renderProps();
  updateStatusBar();
  updateHistoryButtons();
}
function updateHistoryButtons() {
  el.undoBtn.style.opacity = state.undoStack.length ? '1' : '0.4';
  el.redoBtn.style.opacity = state.redoStack.length ? '1' : '0.4';
}

// ============================================================
// OBJECT MODEL
// ============================================================
function createObject(type, x, y, w, h, extra) {
  return Object.assign({ id: uid(), type, x, y, w, h }, extra || {});
}
function currentPageData() { return state.pages[state.currentPage - 1]; }
function objectsOnCurrentPage() { const p = currentPageData(); return p ? p.objects : []; }
function findObject(id) {
  for (const p of state.pages) {
    const o = p.objects.find(x => x.id === id);
    if (o) return { page: p, obj: o };
  }
  return null;
}

// ============================================================
// HIT TESTING
// ============================================================
function hitTest(obj, px, py) {
  const { x, y, w, h } = obj;
  const tol = HIT_TOLERANCE;
  if (obj.type === 'draw') {
    const pts = obj.points || [];
    for (let i = 1; i < pts.length; i++) {
      const d = pointSegmentDistance(px, py, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y);
      if (d <= (obj.strokeWidth / 2) + tol) return true;
    }
    return false;
  }
  if (obj.type === 'shape' && (obj.shape === 'line' || obj.shape === 'arrow')) {
    const d = pointSegmentDistance(px, py, x, y, x + w, y + h);
    return d <= (obj.strokeWidth / 2) + tol;
  }
  return px >= x - tol && px <= x + w + tol && py >= y - tol && py <= y + h + tol;
}
function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
}
function topmostObjectAt(px, py) {
  const objs = objectsOnCurrentPage();
  for (let i = objs.length - 1; i >= 0; i--) {
    if (hitTest(objs[i], px, py)) return objs[i];
  }
  return null;
}

// ============================================================
// TEXT RECONSTRUCTION
// ============================================================
async function reconstructPageText(page, pdfPageNumber) {
  const pdfPage = await state.pdfDoc.getPage(pdfPageNumber);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate+(page._extraRotation||0))%360 });
  const pageH = viewport.height;

  const tc = await pdfPage.getTextContent({ includeMarkedContent: false });
  const items = (tc.items || []).filter(it => it && typeof it.str === 'string');

  const nonSpaceChars = items.reduce((sum, it) => sum + (it.str.replace(/\s/g,'').length), 0);
  const isScanned = nonSpaceChars === 0;
  if (isScanned) return { status: 'scanned', objects: [] };

  const normalized = items.map(it => {
    const tx = it.transform;
    const fontSize = Math.hypot(tx[2], tx[3]) || it.height || 12;
    const x = tx[4];
    const yBaseline = tx[5];
    const yTop = pageH - yBaseline - fontSize;
    const width = it.width || 0;
    const fontName = it.fontName || '';
    return {
      str: it.str, x, y: yTop, yBaseline, width, fontSize, fontName,
      bold: detectBold(fontName), italic: detectItalic(fontName)
    };
  });

  const lines = [];
  const sorted = [...normalized].sort((a, b) => Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x);
  for (const it of sorted) {
    if (!it.str) continue;
    const tol = Math.max(2, it.fontSize * 0.4);
    let line = lines.find(L => Math.abs(L.y - it.y) <= tol);
    if (!line) {
      line = { y: it.y, items: [], fontSize: it.fontSize };
      lines.push(line);
    }
    line.items.push(it);
    line.y = (line.y * (line.items.length - 1) + it.y) / line.items.length;
    line.fontSize = Math.max(line.fontSize, it.fontSize);
  }
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    L.x = L.items[0].x;
    L.right = Math.max(...L.items.map(i => i.x + i.width));
    L.y = L.items[0].y;
    L.fontSize = Math.max(...L.items.map(i => i.fontSize));
    L.bold = L.items.every(i => i.bold);
    L.italic = L.items.every(i => i.italic);
    L.text = joinLineItems(L.items);
    L.fontName = L.items[0].fontName || '';
    L.width = L.right - L.x;
  }
  lines.sort((a, b) => a.y - b.y);

  const sizeBuckets = {};
  for (const L of lines) {
    const s = Math.round(L.fontSize * 2) / 2;
    sizeBuckets[s] = (sizeBuckets[s] || 0) + L.text.length;
  }
  let bodySize = 12, bestWeight = 0;
  for (const [s, w] of Object.entries(sizeBuckets)) {
    if (w > bestWeight) { bestWeight = w; bodySize = parseFloat(s); }
  }

  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const isHeading = classifyHeading(L, bodySize, lines, i);
    const align = inferAlignment(L, lines);
    if (!cur) {
      cur = { lines: [L], heading: isHeading, alignment: align, fontSize: L.fontSize, bold: L.bold, italic: L.italic, fontName: L.fontName };
      continue;
    }
    const prev = cur.lines[cur.lines.length - 1];
    const gapY = L.y - (prev.y + prev.fontSize * 1.1);
    const xDiff = Math.abs(L.x - prev.x);
    const sameParagraph =
      !isHeading && !cur.heading &&
      Math.abs(L.fontSize - cur.fontSize) < 0.6 &&
      L.bold === cur.bold && L.italic === cur.italic &&
      align === cur.alignment &&
      xDiff < Math.max(6, cur.fontSize * 0.6) &&
      gapY < Math.max(6, cur.fontSize * 0.9);
    if (sameParagraph) cur.lines.push(L);
    else {
      blocks.push(cur);
      cur = { lines: [L], heading: isHeading, alignment: align, fontSize: L.fontSize, bold: L.bold, italic: L.italic, fontName: L.fontName };
    }
  }
  if (cur) blocks.push(cur);

  const objects = [];
  for (const b of blocks) {
    const x = Math.min(...b.lines.map(L => L.x));
    const yTop = b.lines[0].y;
    const right = Math.max(...b.lines.map(L => L.right));
    const yBot = Math.max(...b.lines.map(L => L.y + L.fontSize * 1.15));
    const w = right - x;
    const h = yBot - yTop;
    const text = b.lines.map(L => L.text).join('\n');
    const mapping = mapPdfFontToWeb(b.fontName, b.bold, b.italic);
    objects.push({
      id: uid(), type: 'text', source: 'pdf',
      text, x, y: yTop, w, h,
      fontSize: b.fontSize,
      fontFamily: mapping.cssFamily,
      pdfFamily: mapping.pdfFamily,
      fontWeight: b.bold ? 'bold' : 'normal',
      fontStyle: b.italic ? 'italic' : 'normal',
      textDecoration: 'none',
      color: '#000000',
      textAlign: b.alignment,
      lineHeight: 1.15,
      letterSpacing: 0,
      opacity: 1,
      _isHeading: b.heading,
      _masked: false,
      _maskColor: null,
      _revealed: false
    });
  }
  return { status: 'done', objects, bodySize };
}

function joinLineItems(items) {
  let out = '';
  for (let i = 0; i < items.length; i++) {
    if (i === 0) { out = items[i].str; continue; }
    const prev = items[i-1];
    const gap = items[i].x - (prev.x + prev.width);
    if (gap > 1 && !/\s$/.test(out)) out += ' ';
    out += items[i].str;
  }
  return out.replace(/\s+/g, ' ').trim();
}
function classifyHeading(line, bodySize, allLines, idx) {
  const r = line.fontSize / bodySize;
  if (r >= 1.7) return 'h1';
  if (r >= 1.4) return 'h2';
  if (r >= 1.15) return 'h3';
  if (line.bold && line.fontSize >= bodySize * 0.95) {
    const n = [allLines[idx-1], allLines[idx+1]].filter(Boolean);
    if (n.length && n.every(x => !x.bold)) return 'h3';
  }
  return null;
}
function inferAlignment(line, allLines) {
  if (!allLines.length) return 'left';
  const lefts = allLines.map(L => L.x);
  const rights = allLines.map(L => L.right);
  const minX = Math.min(...lefts);
  const maxRight = Math.max(...rights);
  const leftGap = line.x - minX;
  const rightGap = maxRight - line.right;
  if (leftGap < 2 && rightGap < 2) return 'justify';
  if (leftGap > 20 && rightGap < 10) return 'right';
  if (Math.abs(leftGap - rightGap) < 15 && leftGap > 20) return 'center';
  return 'left';
}

// ============================================================
// BACKGROUND SAMPLING (with cache invalidation on zoom)
// ============================================================
function sampleBackgroundColor(page, obj) {
  const key = page.pdfPageNumber || 'blank-' + state.currentPage;
  const cachedAtZoom = state.renderedAtZoom[key];
  if (cachedAtZoom !== state.zoom) {
    delete state.pageCanvasCache[key];
    delete state.renderedAtZoom[key];
  }
  const canvas = state.pageCanvasCache[key];
  if (!canvas) return '#ffffff';

  const ctx = canvas.getContext('2d');
  const scaleX = canvas.width / page.width;
  const scaleY = canvas.height / page.height;

  const sx = clamp(Math.floor(obj.x * scaleX), 0, canvas.width - 1);
  const sy = clamp(Math.floor(obj.y * scaleY), 0, canvas.height - 1);
  const sw = clamp(Math.ceil(obj.w * scaleX), 1, canvas.width - sx);
  const sh = clamp(Math.ceil(obj.h * scaleY), 1, canvas.height - sy);

  let data;
  try { data = ctx.getImageData(sx, sy, sw, sh).data; } catch (e) { return '#ffffff'; }

  const hist = { r: {}, g: {}, b: {} };
  for (let i = 0; i < data.length; i += 4) {
    hist.r[data[i]] = (hist.r[data[i]] || 0) + 1;
    hist.g[data[i+1]] = (hist.g[data[i+1]] || 0) + 1;
    hist.b[data[i+2]] = (hist.b[data[i+2]] || 0) + 1;
  }
  const mode = (h) => {
    let b = 255, c = -1;
    for (const k in h) if (h[k] > c) { c = h[k]; b = parseInt(k, 10); }
    return b;
  };
  return rgbToHex(mode(hist.r), mode(hist.g), mode(hist.b));
}

// ============================================================
// PAGE RENDERER
// ============================================================
let renderSequence=0;
async function renderCurrentPage() {
  const sequence=++renderSequence;
  el.singlePageWrapper.setAttribute("aria-busy","true");
  const wrap = el.singlePageWrapper;
  wrap.innerHTML = '';
  const page = currentPageData();
  if (!page) return;

  const container = document.createElement('div');
  container.className = 'page-container';

  const displayScale = state.zoom;
  const cssW = Math.round(page.width * displayScale);
  const cssH = Math.round(page.height * displayScale);
  const renderMultiplier = 2;

  container.style.width = cssW + 'px';
  container.style.height = cssH + 'px';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  canvasWrap.style.width = cssW + 'px';
  canvasWrap.style.height = cssH + 'px';
  canvasWrap.style.position = 'relative';

  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.className = 'pdf-canvas';
  pdfCanvas.width = cssW * renderMultiplier;
  pdfCanvas.height = cssH * renderMultiplier;
  pdfCanvas.style.width = cssW + 'px';
  pdfCanvas.style.height = cssH + 'px';
  canvasWrap.appendChild(pdfCanvas);

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.className = 'overlay-canvas';
  overlayCanvas.width = cssW * renderMultiplier;
  overlayCanvas.height = cssH * renderMultiplier;
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.inset = '0';
  overlayCanvas.style.width = cssW + 'px';
  overlayCanvas.style.height = cssH + 'px';
  overlayCanvas.style.pointerEvents = 'none';
  canvasWrap.appendChild(overlayCanvas);

  const overlay = document.createElement('div');
  overlay.className = 'overlay tool-' + state.tool;
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.zIndex = '3';
  canvasWrap.appendChild(overlay);

  container.appendChild(canvasWrap);
  wrap.appendChild(container);

  const objectScale = displayScale * renderMultiplier;
  const interactionScale = displayScale;

  if (page.blank) {
    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    state.pageCanvasCache['blank-' + state.currentPage] = pdfCanvas;
    state.renderedAtZoom['blank-' + state.currentPage] = state.zoom;
  } else if (state.pdfDoc) {
    try {
      const p = await state.pdfDoc.getPage(page.pdfPageNumber);
      const pdfViewportScale = displayScale * renderMultiplier;
      let extraRotation = page._extraRotation || 0;
      const rotation = (p.rotate + extraRotation + 360) % 360;
      const viewport = p.getViewport({ scale: pdfViewportScale, rotation });
      await p.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;
      state.pageCanvasCache[page.pdfPageNumber] = pdfCanvas;
      state.renderedAtZoom[page.pdfPageNumber] = state.zoom;
    } catch (e) { console.warn('Render failed:', e); }
  }

  if(sequence!==renderSequence)return;
  el.singlePageWrapper.setAttribute("aria-busy","false");
  renderObjectsToOverlay(overlayCanvas, page, objectScale);
  attachOverlayHandlers(overlay, overlayCanvas, page, interactionScale);
  attachReconstructionHover(overlay, overlayCanvas, page, objectScale);

  if (state.selectedObjectId) drawSelectionOutline(overlayCanvas, page, objectScale);
  if (page.reconStatus === 'scanned') showScanNotice(container);
  updateStatusBar();
}

function renderObjectsToOverlay(canvas, page, scale) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const o of page.objects) {
    if (o.source === 'pdf' && o.type === 'text') {
      const isSelected = o.id === state.selectedObjectId;
      if (!isSelected && !o._revealed && !o._masked) continue;
    }
    drawObject(ctx, o, scale);
  }
}

function drawObject(ctx, o, scale) {
  ctx.save();
  ctx.globalAlpha = o.opacity != null ? o.opacity : 1;
  if (o._masked && o._maskColor) {
    const pad = 1.5 * scale;
    ctx.fillStyle = o._maskColor;
    ctx.fillRect(o.x * scale - pad, o.y * scale - pad, o.w * scale + pad * 2, o.h * scale + pad * 2);
  }
  if (o.type === 'highlight' || o.type === 'whiteout') {
    ctx.fillStyle = o.color;
    ctx.fillRect(o.x * scale, o.y * scale, o.w * scale, o.h * scale);
  } else if (o.type === 'text') {
    const fam = o.fontFamily || 'Helvetica, Arial, sans-serif';
    const weight = o.fontWeight || 'normal';
    const style = o.fontStyle || 'normal';
    const decor = o.textDecoration || 'none';
    const fs = (o.fontSize || 14) * scale;
    ctx.font = `${style} ${weight} ${fs}px ${fam}, 'Droplet Noto'`;
    ctx.fillStyle = o.color || '#1e293b';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (o.letterSpacing) {
      drawTextWithLetterSpacing(ctx, o.text || '', o.x * scale, o.y * scale, o.w * scale, fs * (o.lineHeight || 1.15), o.letterSpacing * scale, o.textAlign || 'left', decor);
    } else {
      wrapText(ctx, o.text || '', o.x * scale, o.y * scale, o.w * scale, fs * (o.lineHeight || 1.15), o.textAlign || 'left', decor);
    }
  } else if (o.type === 'draw') {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.strokeWidth * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pts = o.points || [];
    if (pts.length) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * scale, pts[i].y * scale);
      ctx.stroke();
    }
  } else if (o.type === 'shape') {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.strokeWidth * scale;
    if (o.shape === 'rect') {
      if (o.fill) { ctx.fillStyle = o.color + '33'; ctx.fillRect(o.x * scale, o.y * scale, o.w * scale, o.h * scale); }
      ctx.strokeRect(o.x * scale, o.y * scale, o.w * scale, o.h * scale);
    } else if (o.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((o.x + o.w/2) * scale, (o.y + o.h/2) * scale, Math.abs(o.w/2) * scale, Math.abs(o.h/2) * scale, 0, 0, Math.PI * 2);
      if (o.fill) { ctx.fillStyle = o.color + '33'; ctx.fill(); }
      ctx.stroke();
    } else if (o.shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(o.x * scale, o.y * scale);
      ctx.lineTo((o.x + o.w) * scale, (o.y + o.h) * scale);
      ctx.stroke();
    } else if (o.shape === 'arrow') {
      const x1 = o.x * scale, y1 = o.y * scale;
      const x2 = (o.x + o.w) * scale, y2 = (o.y + o.h) * scale;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ah = 10 * scale;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ah * Math.cos(angle - Math.PI/6), y2 - ah * Math.sin(angle - Math.PI/6));
      ctx.lineTo(x2 - ah * Math.cos(angle + Math.PI/6), y2 - ah * Math.sin(angle + Math.PI/6));
      ctx.closePath();
      ctx.fillStyle = o.color; ctx.fill();
    }
  } else if (o.type === 'image' || o.type === 'sign') {
    if (o._img) ctx.drawImage(o._img, o.x * scale, o.y * scale, o.w * scale, o.h * scale);
  } else if (o.type === 'form') {
    ctx.fillStyle = 'rgba(37,99,235,0.06)';
    ctx.fillRect(o.x * scale, o.y * scale, o.w * scale, o.h * scale);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(o.x * scale, o.y * scale, o.w * scale, o.h * scale);
    ctx.fillStyle = '#2563eb';
    ctx.font = `${11 * scale}px Helvetica, Arial, sans-serif`;
    ctx.fillText('[' + o.formType + ']', o.x * scale + 4, o.y * scale + 12 * scale);
  }
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, align, decor) {
  const lines = String(text).split('\n');
  let yy = y;
  for (const rawLine of lines) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) { yy += lineHeight; continue; }
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        drawAlignedLine(ctx, line, x, yy, maxWidth, align, decor);
        line = w;
        yy += lineHeight;
      } else line = test;
    }
    if (line) { drawAlignedLine(ctx, line, x, yy, maxWidth, align, decor); yy += lineHeight; }
  }
}
function drawAlignedLine(ctx, line, x, y, maxWidth, align, decor) {
  const w = ctx.measureText(line).width;
  let dx = x;
  if (align === 'center') dx = x + (maxWidth - w) / 2;
  else if (align === 'right') dx = x + maxWidth - w;
  ctx.fillText(line, dx, y);
  if (decor === 'underline') ctx.fillRect(dx, y + ctx.measureText('M').width * 0.9, w, 1);
}
function drawTextWithLetterSpacing(ctx, text, x, y, maxWidth, lineHeight, spacing, align, decor) {
  const lines = String(text).split('\n');
  let yy = y;
  for (const line of lines) {
    let total = 0;
    for (const ch of line) total += ctx.measureText(ch).width + spacing;
    total -= spacing;
    let dx = x;
    if (align === 'center') dx = x + (maxWidth - total) / 2;
    else if (align === 'right') dx = x + maxWidth - total;
    let cx = dx;
    for (const ch of line) { ctx.fillText(ch, cx, yy); cx += ctx.measureText(ch).width + spacing; }
    yy += lineHeight;
  }
}
function drawSelectionOutline(canvas, page, scale) {
  const found = findObject(state.selectedObjectId);
  if (!found || found.page !== page) return;
  const o = found.obj;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(o.x * scale - 2, o.y * scale - 2, o.w * scale + 4, o.h * scale + 4);
  ctx.setLineDash([]);
  const handles = [
    [o.x * scale - 6, o.y * scale - 6],
    [(o.x + o.w) * scale - 2, o.y * scale - 6],
    [o.x * scale - 6, (o.y + o.h) * scale - 2],
    [(o.x + o.w) * scale - 2, (o.y + o.h) * scale - 2]
  ];
  ctx.fillStyle = '#2563eb';
  for (const [hx, hy] of handles) ctx.fillRect(hx, hy, 8, 8);
  ctx.restore();
}

// ============================================================
// HOVER FOR RECONSTRUCTED TEXT
// ============================================================
function attachReconstructionHover(overlay, overlayCanvas, page, scale) {
  let hoveredId = null;
  const onMove = (e) => {
    if (state.tool !== 'select') return;
    const rect = overlayCanvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    let found = null;
    const objs = objectsOnCurrentPage();
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.source !== 'pdf' || o.type !== 'text') continue;
      if (hitTest(o, px, py)) { found = o; break; }
    }
    const foundId = found ? found.id : null;
    if (foundId === hoveredId) return;
    hoveredId = foundId;
    renderObjectsToOverlay(overlayCanvas, page, scale);
    if (found) {
      const ctx = overlayCanvas.getContext('2d');
      ctx.save();
      ctx.strokeStyle = 'rgba(37,99,235,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(found.x * scale - 2, found.y * scale - 2, found.w * scale + 4, found.h * scale + 4);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.06;
      const fam = found.fontFamily || 'Helvetica, Arial, sans-serif';
      const fs = (found.fontSize || 14) * scale;
      ctx.font = `${found.fontStyle || 'normal'} ${found.fontWeight || 'normal'} ${fs}px ${fam}, 'Droplet Noto'`;
      ctx.fillStyle = found.color || '#1e293b';
      ctx.textBaseline = 'top';
      wrapText(ctx, found.text || '', found.x * scale, found.y * scale, found.w * scale, fs * (found.lineHeight || 1.15), found.textAlign || 'left', 'none');
      ctx.restore();
    }
    if (state.selectedObjectId) drawSelectionOutline(overlayCanvas, page, scale);
  };
  const onLeave = () => {
    if (hoveredId === null) return;
    hoveredId = null;
    renderObjectsToOverlay(overlayCanvas, page, scale);
    if (state.selectedObjectId) drawSelectionOutline(overlayCanvas, page, scale);
  };
  overlay.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerleave', onLeave);
}

// ============================================================
// SCAN NOTICE
// ============================================================
function showScanNotice(container) {
  const existing = container.querySelector('.scan-notice');
  if (existing) existing.remove();
  const notice = document.createElement('div');
  notice.className = 'scan-notice';
  notice.innerHTML = `
    <div class="sn-icon">🖼️</div>
    <div class="sn-text">
      <strong>This page looks scanned.</strong>
      Run OCR to make the text editable, or add your own text on top.
    </div>
    <button class="sn-btn" onclick="runOCROnCurrentPage()">🔍 OCR</button>
    <button class="sn-btn secondary" onclick="dismissScanNotice(this)">Later</button>
  `;
  container.appendChild(notice);
}
function dismissScanNotice(btn) {
  const n = btn.closest('.scan-notice');
  if (n) n.remove();
}

// ============================================================
// LAZY RECONSTRUCTION
// ============================================================
async function ensurePageReconstructed(page) {
  if (!page || page.reconstructed || page.reconStatus === 'working') return;
  if (page.blank) { page.reconstructed = true; return; }
  if (!state.pdfDoc) return;

  page.reconStatus = 'working';
  const pageAtStart = page;
  showReconToast('Converting text to editable objects…');

  try {
    const result = await reconstructPageText(page, page.pdfPageNumber);
    if (result.status === 'scanned') {
      page.reconStatus = 'scanned';
      page.reconstructed = true;
    } else {
      page.objects = [...result.objects, ...page.objects];
      page.reconStatus = 'done';
      page.reconstructed = true;
      page.bodySize = result.bodySize;
    }
  } catch (e) {
    console.warn('Reconstruction failed:', e);
    page.reconStatus = 'idle';
  } finally {
    hideReconToast();
    if (currentPageData() === pageAtStart) {
      await renderCurrentPage();
      renderThumbnails();
      updateStatusBar();
    }
  }
}
let reconToastEl = null;
function showReconToast(msg) {
  hideReconToast();
  const wrap = el.singlePageWrapper.querySelector('.page-container');
  if (!wrap) return;
  reconToastEl = document.createElement('div');
  reconToastEl.className = 'recon-toast show';
  reconToastEl.innerHTML = '<div class="rt-spinner"></div><span>' + msg + '</span>';
  wrap.style.position = 'relative';
  wrap.appendChild(reconToastEl);
}
function hideReconToast() {
  if (reconToastEl && reconToastEl.parentNode) reconToastEl.parentNode.removeChild(reconToastEl);
  reconToastEl = null;
}

// ============================================================
// OVERLAY INTERACTION (with image aspect ratio fix)
// ============================================================
function attachOverlayHandlers(overlay, overlayCanvas, page, scale) {
  const toPageCoords = (clientX, clientY) => {
    const rect = overlayCanvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };
  const objScale = () => overlayCanvas.width / page.width;

  overlay.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    overlay.setPointerCapture(e.pointerId);
    const { x, y } = toPageCoords(e.clientX, e.clientY);
    const s = objScale();

    if (state.tool === 'select') {
      const hit = topmostObjectAt(x, y);
      if (hit) {
        if (hit.source === 'pdf' && hit.type === 'text' && !hit._masked) {
          hit._maskColor = sampleBackgroundColor(page, hit);
          hit._masked = true;
          pushHistory();
        }
        state.selectedObjectId = hit.id;
        state.interaction = {
          mode: 'drag', objId: hit.id,
          startX: x, startY: y,
          origX: hit.x, origY: hit.y, origPoints: hit.points?.map(point=>({...point}))
        };
        renderObjectsToOverlay(overlayCanvas, page, s);
        drawSelectionOutline(overlayCanvas, page, s);
        renderProps();
      } else {
        state.selectedObjectId = null;
        state.interaction = null;
        renderObjectsToOverlay(overlayCanvas, page, s);
        renderProps();
      }
      return;
    }

    if (state.tool === 'text') {
      const o = createObject('text', x, y, 240, 24, {
        text: '',
        fontSize: toolDefaults.text.fontSize,
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 'normal', fontStyle: 'normal',
        textDecoration: 'none',
        color: toolDefaults.text.color,
        textAlign: 'left',
        lineHeight: 1.15, letterSpacing: 0, opacity: 1,
        _masked: false
      });
      page.objects.push(o);
      state.selectedObjectId = o.id;
      pushHistory();
      renderObjectsToOverlay(overlayCanvas, page, s);
      renderProps();
      openInlineTextEditor(overlay, overlayCanvas, page, scale, o);
      return;
    }

    // FIX: Image and signature insertion now preserves aspect ratio and constrains width.
    if (state.tool === 'image' || state.tool === 'sign') {
      const inputId = state.tool === 'image' ? 'imageInput' : 'signInput';
      const input = document.getElementById(inputId);
      input.onchange = async (ev) => {
        const f = ev.target.files[0];
        if (!f) return;
        const dataUrl = await readFileAsDataURL(f);
        const img = await loadImage(dataUrl);
        // Preserve aspect ratio, max width 240, max height 240
        const maxDim = 240;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const scaleFactor = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(20, w * scaleFactor);
        h = Math.max(20, h * scaleFactor);
        const o = createObject(state.tool === 'image' ? 'image' : 'sign', x, y, w, h,
          { dataUrl, naturalW: img.naturalWidth, naturalH: img.naturalHeight, opacity: 1 });
        o._img = img;
        page.objects.push(o);
        state.selectedObjectId = o.id;
        pushHistory();
        renderObjectsToOverlay(overlayCanvas, page, s);
        renderProps();
        input.value = '';
        toast('Image inserted. Use properties panel to fine‑tune size.', 2000);
      };
      input.click();
      return;
    }

    if (state.tool === 'highlight' || state.tool === 'whiteout' || state.tool === 'shape') {
      state.interaction = { mode: 'create-rect', tool: state.tool, startX: x, startY: y, curX: x, curY: y };
      return;
    }

    if (state.tool === 'draw') {
      const o = createObject('draw', x, y, 0, 0, {
        points: [{ x, y }],
        color: toolDefaults.draw.color,
        strokeWidth: toolDefaults.draw.strokeWidth,
        opacity: 1
      });
      page.objects.push(o);
      state.selectedObjectId = o.id;
      state.interaction = { mode: 'draw', objId: o.id };
      renderObjectsToOverlay(overlayCanvas, page, s);
      return;
    }

    if (state.tool === 'forms') {
      const type = prompt('Form field type:\ntext, checkbox, radio, dropdown, date, signature', 'text');
      if (!type) return;
      const t = ['text','checkbox','radio','dropdown','date','signature'].includes(type) ? type : 'text';
      const o = createObject('form', x, y, 160, 28, { formType: t, opacity: 1 });
      page.objects.push(o);
      state.selectedObjectId = o.id;
      pushHistory();
      renderObjectsToOverlay(overlayCanvas, page, s);
      renderProps();
      return;
    }
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!state.interaction) return;
    const { x, y } = toPageCoords(e.clientX, e.clientY);
    const it = state.interaction;
    const s = objScale();
    if (it.mode === 'drag') {
      const found = findObject(it.objId);
      if (!found) return;
      found.obj.x = it.origX + (x - it.startX);
      found.obj.y = it.origY + (y - it.startY);
      if(it.origPoints)found.obj.points=it.origPoints.map(point=>({x:point.x+x-it.startX,y:point.y+y-it.startY}));
      renderObjectsToOverlay(overlayCanvas, page, s);
      drawSelectionOutline(overlayCanvas, page, s);
      renderProps();
    } else if (it.mode === 'create-rect') {
      it.curX = x; it.curY = y;
      renderObjectsToOverlay(overlayCanvas, page, s);
      if (state.selectedObjectId) drawSelectionOutline(overlayCanvas, page, s);
      const ctx = overlayCanvas.getContext('2d');
      const rx = Math.min(it.startX, it.curX) * s;
      const ry = Math.min(it.startY, it.curY) * s;
      const rw = Math.abs(it.curX - it.startX) * s;
      const rh = Math.abs(it.curY - it.startY) * s;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      if (it.tool === 'highlight') { ctx.fillStyle = 'rgba(253,224,71,0.5)'; ctx.fillRect(rx, ry, rw, rh); }
      if (it.tool === 'whiteout') { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(rx, ry, rw, rh); }
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    } else if (it.mode === 'draw') {
      const found = findObject(it.objId);
      if (!found) return;
      found.obj.points.push({ x, y });
      renderObjectsToOverlay(overlayCanvas, page, s);
    }
  });

  overlay.addEventListener('pointerup', (e) => {
    if (!state.interaction) return;
    const it = state.interaction;
    const s = objScale();

    if (it.mode === 'drag') { pushHistory(); state.interaction = null; renderProps(); return; }

    if (it.mode === 'create-rect') {
      const rx = Math.min(it.startX, it.curX);
      const ry = Math.min(it.startY, it.curY);
      const rw = Math.abs(it.curX - it.startX);
      const rh = Math.abs(it.curY - it.startY);
      if (rw < 4 && rh < 4) { state.interaction = null; renderObjectsToOverlay(overlayCanvas, page, s); return; }
      if (it.tool === 'highlight') {
        page.objects.push(createObject('highlight', rx, ry, rw, rh, { color: toolDefaults.highlight.color, opacity: toolDefaults.highlight.opacity }));
      } else if (it.tool === 'whiteout') {
        page.objects.push(createObject('whiteout', rx, ry, rw, rh, { color: toolDefaults.whiteout.color, opacity: toolDefaults.whiteout.opacity }));
      } else if (it.tool === 'shape') {
        page.objects.push(createObject('shape', rx, ry, rw, rh, {
          shape: toolDefaults.shape.shape,
          color: toolDefaults.shape.color,
          strokeWidth: toolDefaults.shape.strokeWidth,
          fill: toolDefaults.shape.fill,
          opacity: 1
        }));
      }
      state.selectedObjectId = page.objects[page.objects.length - 1].id;
      state.interaction = null;
      pushHistory();
      renderObjectsToOverlay(overlayCanvas, page, s);
      drawSelectionOutline(overlayCanvas, page, s);
      renderProps();
      return;
    }

    if (it.mode === 'draw') {
      const found = findObject(it.objId);
      if (found) {
        const pts = found.obj.points;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        found.obj.x = Math.min(...xs); found.obj.y = Math.min(...ys);
        found.obj.w = Math.max(...xs) - found.obj.x;
        found.obj.h = Math.max(...ys) - found.obj.y;
      }
      state.interaction = null;
      pushHistory();
      renderObjectsToOverlay(overlayCanvas, page, s);
      renderProps();
      return;
    }
  });

  overlay.addEventListener('dblclick', (e) => {
    if (state.tool !== 'select') return;
    const { x, y } = toPageCoords(e.clientX, e.clientY);
    const hit = topmostObjectAt(x, y);
    if (hit && hit.type === 'text') {
      if (hit.source === 'pdf' && !hit._masked) {
        hit._maskColor = sampleBackgroundColor(page, hit);
        hit._masked = true;
      }
      state.selectedObjectId = hit.id;
      const s = objScale();
      renderObjectsToOverlay(overlayCanvas, page, s);
      drawSelectionOutline(overlayCanvas, page, s);
      renderProps();
      openInlineTextEditor(overlay, overlayCanvas, page, scale, hit);
    }
  });
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// ============================================================
// INLINE TEXT EDITOR
// ============================================================
function openInlineTextEditor(overlay, overlayCanvas, page, interactionScale, obj) {
  const existing = overlay.querySelector('.inline-editor');
  if (existing) existing.remove();
  const ta = document.createElement('textarea');
  ta.className = 'inline-editor';
  ta.value = obj.text || '';
  const fs = (obj.fontSize || 14) * interactionScale;
  const lh = obj.lineHeight || 1.15;
  ta.style.left = (obj.x * interactionScale) + 'px';
  ta.style.top = (obj.y * interactionScale) + 'px';
  ta.style.minWidth = Math.max(120, (obj.w || 200) * interactionScale) + 'px';
  ta.style.minHeight = Math.max(24, (obj.h || 24) * interactionScale) + 'px';
  ta.style.fontSize = fs + 'px';
  ta.style.lineHeight = String(lh);
  ta.style.fontFamily = obj.fontFamily || 'Helvetica, Arial, sans-serif';
  ta.style.fontWeight = obj.fontWeight || 'normal';
  ta.style.fontStyle = obj.fontStyle || 'normal';
  ta.style.color = obj.color || '#1e293b';
  ta.style.textAlign = obj.textAlign || 'left';
  ta.style.letterSpacing = (obj.letterSpacing || 0) + 'px';
  overlay.appendChild(ta);
  const autosize = () => {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 4) + 'px';
    ta.style.width = 'auto';
    ta.style.width = Math.max(120, ta.scrollWidth + 8) + 'px';
  };
  ta.style.transformOrigin='0 0';
  ta.style.transform='rotate('+(obj.rotation||0)+'deg)';
  ta.addEventListener('input', autosize);
  autosize();
  const commit = () => {
    const text = ta.value;
    if (!text.trim()) {
      page.objects = page.objects.filter(o => o.id !== obj.id);
      state.selectedObjectId = null;
      pushHistory();
    } else {
      obj.text = text;
      obj.w = Math.max(20, ta.scrollWidth / interactionScale);
      obj.h = Math.max(12, ta.scrollHeight / interactionScale);
      pushHistory();
    }
    ta.remove();
    const s = overlayCanvas.width / page.width;
    renderObjectsToOverlay(overlayCanvas, page, s);
    if (state.selectedObjectId) drawSelectionOutline(overlayCanvas, page, s);
    renderProps();
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ta.value = obj.text || ''; ta.blur(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ta.blur();
  });
  setTimeout(() => { ta.focus(); ta.select(); }, 0);
}

// ============================================================
// TOOL SWITCH
// ============================================================
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.floating-toolbar .tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  el.statusTool.textContent = 'Tool: ' + tool.charAt(0).toUpperCase() + tool.slice(1);
  const overlay=document.querySelector('.overlay');if(overlay)overlay.className='overlay tool-'+tool;
  reRenderOverlayOnly();
}

// ============================================================
// PROPERTIES PANEL
// ============================================================
function renderProps() {
  const page = currentPageData();
  if (!page) {
    el.pageProps.classList.add('hidden');
    el.textProps.classList.add('hidden');
    el.objectProps.classList.add('hidden');
    el.propsEmpty.classList.remove('hidden');
    return;
  }
  const found = state.selectedObjectId ? findObject(state.selectedObjectId) : null;
  if (found && found.page === page) {
    el.pageProps.classList.add('hidden');
    el.propsEmpty.classList.add('hidden');
    if (found.obj.type === 'text') {
      el.textProps.classList.remove('hidden');
      el.objectProps.classList.add('hidden');
      populateTextProps(found.obj);
    } else {
      el.textProps.classList.add('hidden');
      el.objectProps.classList.remove('hidden');
      populateObjectProps(found.obj);
    }
  } else {
    el.textProps.classList.add('hidden');
    el.objectProps.classList.add('hidden');
    el.propsEmpty.classList.add('hidden');
    el.pageProps.classList.remove('hidden');
    el.pageInfoText.textContent = `${state.currentPage} of ${state.pages.length}`;
  }
}
function populateTextProps(o) {
  document.getElementById('tp_text').value = o.text || '';
  document.getElementById('tp_fontFamily').value = o.fontFamily || 'Helvetica, Arial, sans-serif';
  const fs = o.fontSize || 14;
  document.getElementById('tp_fontSize').value = fs;
  document.getElementById('tp_fontSizeValue').textContent = fs;
  toggleBtnClass('tp_bold', o.fontWeight === 'bold');
  toggleBtnClass('tp_italic', o.fontStyle === 'italic');
  toggleBtnClass('tp_underline', o.textDecoration === 'underline');
  document.getElementById('tp_color').value = o.color || '#1e293b';
  document.getElementById('tp_colorHex').value = o.color || '#1e293b';
  setAlignBtnActive(o.textAlign || 'left');
  const lh = o.lineHeight || 1.15;
  document.getElementById('tp_lineHeight').value = lh;
  document.getElementById('tp_lineHeightValue').textContent = lh.toFixed(2);
  const ls = o.letterSpacing || 0;
  document.getElementById('tp_letterSpacing').value = ls;
  document.getElementById('tp_letterSpacingValue').textContent = ls;
  const op = Math.round((o.opacity != null ? o.opacity : 1) * 100);
  document.getElementById('tp_opacity').value = op;
  document.getElementById('tp_opacityValue').textContent = op + '%';
  document.getElementById('tp_x').value = Math.round(o.x);
  document.getElementById('tp_y').value = Math.round(o.y);
  document.getElementById('tp_w').value = Math.round(o.w);
  document.getElementById('tp_h').value = Math.round(o.h);
}
function toggleBtnClass(id, on) {
  const e = document.getElementById(id);
  if (e) e.classList.toggle('toggle-on', on);
}
function setAlignBtnActive(align) {
  ['tp_alignLeft','tp_alignCenter','tp_alignRight','tp_alignJustify'].forEach(id => {
    document.getElementById(id).classList.remove('toggle-on');
  });
  const map = { left:'tp_alignLeft', center:'tp_alignCenter', right:'tp_alignRight', justify:'tp_alignJustify' };
  const id = map[align];
  if (id) document.getElementById(id).classList.add('toggle-on');
}
function toggleTextStyle(style) {
  const found = findObject(state.selectedObjectId);
  if (!found || found.obj.type !== 'text') return;
  const o = found.obj;
  if (style === 'bold') o.fontWeight = o.fontWeight === 'bold' ? 'normal' : 'bold';
  if (style === 'italic') o.fontStyle = o.fontStyle === 'italic' ? 'normal' : 'italic';
  if (style === 'underline') o.textDecoration = o.textDecoration === 'underline' ? 'none' : 'underline';
  pushHistory();
  populateTextProps(o);
  reRenderOverlayOnly();
}
function setTextAlign(align) {
  const found = findObject(state.selectedObjectId);
  if (!found || found.obj.type !== 'text') return;
  found.obj.textAlign = align;
  pushHistory();
  setAlignBtnActive(align);
  reRenderOverlayOnly();
}
function populateObjectProps(o) {
  el.objectTypeLabel.textContent = '✏️ ' + o.type.charAt(0).toUpperCase() + o.type.slice(1);
  const show = (id, v) => { const e = document.getElementById(id); if (e) e.style.display = v ? '' : 'none'; };
  show('opColorGroup', ['draw','highlight','whiteout','shape'].includes(o.type));
  show('opStrokeGroup', ['draw','shape'].includes(o.type));
  show('opOpacityGroup', ['highlight','whiteout','image','sign'].includes(o.type));
  show('opShapeGroup', o.type === 'shape');
  show('opFillGroup', o.type === 'shape');
  if (o.color) { const c = document.getElementById('op_color'); if (c) c.value = o.color; }
  if (o.strokeWidth) {
    const s = document.getElementById('op_stroke');
    if (s) s.value = o.strokeWidth;
    document.getElementById('op_strokeValue').textContent = o.strokeWidth;
  }
  if (o.opacity != null) {
    const v = Math.round(o.opacity * 100);
    document.getElementById('op_opacity').value = v;
    document.getElementById('op_opacityValue').textContent = v + '%';
  }
  if (o.shape) document.getElementById('op_shape').value = o.shape;
  if (o.fill != null) document.getElementById('op_fill').checked = !!o.fill;
  document.getElementById('op_x').value = Math.round(o.x);
  document.getElementById('op_y').value = Math.round(o.y);
  document.getElementById('op_w').value = Math.round(o.w);
  document.getElementById('op_h').value = Math.round(o.h);
}

// Wire inputs
(function wireTextProps() {
  const found = () => findObject(state.selectedObjectId);
  document.getElementById('tp_text').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.text = e.target.value; reRenderOverlayOnly();
  });
  document.getElementById('tp_fontFamily').addEventListener('change', (e) => {
    const f = found(); if (!f) return;
    f.obj.fontFamily = e.target.value; pushHistory(); reRenderOverlayOnly();
  });
  document.getElementById('tp_fontSize').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.fontSize = parseFloat(e.target.value);
    document.getElementById('tp_fontSizeValue').textContent = e.target.value;
    reRenderOverlayOnly();
  });
  document.getElementById('tp_fontSize').addEventListener('change', () => pushHistory());
  document.getElementById('tp_color').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.color = e.target.value;
    document.getElementById('tp_colorHex').value = e.target.value;
    reRenderOverlayOnly();
  });
  document.getElementById('tp_colorHex').addEventListener('change', (e) => {
    const f = found(); if (!f) return;
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) {
      f.obj.color = e.target.value;
      document.getElementById('tp_color').value = e.target.value;
      reRenderOverlayOnly();
    }
  });
  document.getElementById('tp_lineHeight').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.lineHeight = parseFloat(e.target.value);
    document.getElementById('tp_lineHeightValue').textContent = parseFloat(e.target.value).toFixed(2);
    reRenderOverlayOnly();
  });
  document.getElementById('tp_lineHeight').addEventListener('change', () => pushHistory());
  document.getElementById('tp_letterSpacing').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.letterSpacing = parseFloat(e.target.value);
    document.getElementById('tp_letterSpacingValue').textContent = e.target.value;
    reRenderOverlayOnly();
  });
  document.getElementById('tp_letterSpacing').addEventListener('change', () => pushHistory());
  document.getElementById('tp_opacity').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.opacity = parseInt(e.target.value, 10) / 100;
    document.getElementById('tp_opacityValue').textContent = e.target.value + '%';
    reRenderOverlayOnly();
  });
  document.getElementById('tp_opacity').addEventListener('change', () => pushHistory());
  ['tp_x','tp_y','tp_w','tp_h'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      const f = found(); if (!f) return;
      const v = parseFloat(e.target.value);
      if (id === 'tp_x') f.obj.x = v;
      if (id === 'tp_y') f.obj.y = v;
      if (id === 'tp_w') f.obj.w = Math.max(4, v);
      if (id === 'tp_h') f.obj.h = Math.max(4, v);
      pushHistory(); reRenderOverlayOnly();
    });
  });
})();

(function wireObjectProps() {
  const found = () => findObject(state.selectedObjectId);
  document.getElementById('op_color').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.color = e.target.value; reRenderOverlayOnly();
  });
  document.getElementById('op_stroke').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.strokeWidth = parseFloat(e.target.value);
    document.getElementById('op_strokeValue').textContent = e.target.value;
    reRenderOverlayOnly();
  });
  document.getElementById('op_opacity').addEventListener('input', (e) => {
    const f = found(); if (!f) return;
    f.obj.opacity = parseInt(e.target.value, 10) / 100;
    document.getElementById('op_opacityValue').textContent = e.target.value + '%';
    reRenderOverlayOnly();
  });
  document.getElementById('op_shape').addEventListener('change', (e) => {
    const f = found(); if (!f) return;
    f.obj.shape = e.target.value; reRenderOverlayOnly();
  });
  document.getElementById('op_fill').addEventListener('change', (e) => {
    const f = found(); if (!f) return;
    f.obj.fill = e.target.checked; reRenderOverlayOnly();
  });
  ['op_x','op_y','op_w','op_h'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      const f = found(); if (!f) return;
      const v = parseFloat(e.target.value);
      if (id === 'op_x') f.obj.x = v;
      if (id === 'op_y') f.obj.y = v;
      if (id === 'op_w') f.obj.w = Math.max(4, v);
      if (id === 'op_h') f.obj.h = Math.max(4, v);
      pushHistory(); reRenderOverlayOnly();
    });
  });
})();

function reRenderOverlayOnly() {
  const page = currentPageData();
  if (!page) return;
  const canvas = document.querySelector('.overlay-canvas');
  if (!canvas) return;
  const s = canvas.width / page.width;
  renderObjectsToOverlay(canvas, page, s);
  if (state.selectedObjectId) drawSelectionOutline(canvas, page, s);
}

// ============================================================
// DOCUMENT OPERATIONS
// ============================================================
async function loadPDFBytes(bytes, name) {
  state.pdfBytes = bytes;
  try {
    state.pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    state.numPages = state.pdfDoc.numPages;
  } catch (e) {
    toast('Could not open PDF: ' + e.message, 3500);
    return;
  }
  state.pages = [];
  state.undoStack = [];
  state.redoStack = [];
  state.selectedObjectId = null;
  state.currentPage = 1;
  state.pageCanvasCache = {};
  state.renderedAtZoom = {};
  THUMB_CACHE.clear();

  for (let i = 1; i <= state.numPages; i++) {
    const p = await state.pdfDoc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    state.pages.push({
      pdfPageNumber: i,
      width: vp.width,
      height: vp.height,
      blank: false,
      objects: [],
      ocr: null,
      reconstructed: false,
      reconStatus: 'idle',
      _extraRotation: 0
    });
  }
  setDocTitle(name || 'Untitled PDF');
  el.emptyState.classList.add('hidden');
  el.singlePageWrapper.classList.remove('hidden');
  el.emptyThumbnails.classList.add('hidden');
  await renderCurrentPage();
  renderThumbnails();
  renderProps();
  updateStatusBar();
  updateHistoryButtons();
  ensurePageReconstructed(currentPageData());
}

function createBlankPDF() {
  state.pdfBytes = null;
  state.pdfDoc = null;
  state.pages = [{
    pdfPageNumber: null,
    width: 595, height: 842,
    blank: true, objects: [], ocr: null,
    reconstructed: true, reconStatus: 'done',
    _extraRotation: 0
  }];
  state.numPages = 1;
  state.currentPage = 1;
  state.undoStack = [];
  state.redoStack = [];
  state.selectedObjectId = null;
  state.pageCanvasCache = {};
  state.renderedAtZoom = {};
  THUMB_CACHE.clear();
  setDocTitle('Untitled PDF');
  el.emptyState.classList.add('hidden');
  el.singlePageWrapper.classList.remove('hidden');
  el.emptyThumbnails.classList.add('hidden');
  renderCurrentPage();
  renderThumbnails();
  renderProps();
  updateStatusBar();
  updateHistoryButtons();
  toast('Blank page created. Pick a tool to start editing.', 3000);
}

function closeDocument() {
  state.pdfBytes = null;
  state.pdfDoc = null;
  state.pages = [];
  state.numPages = 0;
  state.currentPage = 1;
  state.undoStack = [];
  state.redoStack = [];
  state.selectedObjectId = null;
  state.pageCanvasCache = {};
  state.renderedAtZoom = {};
  THUMB_CACHE.clear();
  el.singlePageWrapper.innerHTML = '';
  el.singlePageWrapper.classList.add('hidden');
  el.emptyState.classList.remove('hidden');
  el.emptyThumbnails.classList.remove('hidden');
  el.thumbnailList.innerHTML = '';
  el.textProps.classList.add('hidden');
  el.objectProps.classList.add('hidden');
  el.pageProps.classList.add('hidden');
  el.propsEmpty.classList.remove('hidden');
  setDocTitle('Untitled PDF');
  updateStatusBar();
  updateHistoryButtons();
}

el.pdfInput.addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const buf = await f.arrayBuffer();
  await loadPDFBytes(buf, f.name);
  el.pdfInput.value = '';
});

// ============================================================
// PAGE OPS
// ============================================================
function addBlankPage() {
  pushHistory();
  state.pages.push({
    pdfPageNumber: null,
    width: 595, height: 842,
    blank: true, objects: [], ocr: null,
    reconstructed: true, reconStatus: 'done',
    _extraRotation: 0
  });
  state.currentPage = state.pages.length;
  renderCurrentPage();
  renderThumbnails();
  updateStatusBar();
}
function duplicatePage() {
  if (!state.pages.length) return;
  pushHistory();
  const p = state.pages[state.currentPage - 1];
  const copy = {
    pdfPageNumber: p.pdfPageNumber,
    width: p.width, height: p.height,
    blank: p.blank,
    objects: JSON.parse(JSON.stringify(p.objects.map(o => { const { _img, ...rest } = o; return rest; }))),
    ocr: p.ocr ? JSON.parse(JSON.stringify(p.ocr)) : null,
    reconstructed: p.reconstructed,
    reconStatus: p.reconStatus,
    _extraRotation: p._extraRotation || 0
  };
  (async () => {
    for (const o of copy.objects) {
      if ((o.type === 'image' || o.type === 'sign') && o.dataUrl) {
        try { o._img = await loadImage(o.dataUrl); } catch (_) {}
      }
    }
  })();
  state.pages.splice(state.currentPage, 0, copy);
  state.currentPage++;
  renderCurrentPage();
  renderThumbnails();
  updateStatusBar();
}
function deletePage() {
  if (state.pages.length <= 1) { toast('Cannot delete the only page'); return; }
  if (!confirm('Delete this page?')) return;
  pushHistory();
  state.pages.splice(state.currentPage - 1, 1);
  state.currentPage = clamp(state.currentPage, 1, state.pages.length);
  state.selectedObjectId = null;
  THUMB_CACHE.clear();
  renderCurrentPage();
  renderThumbnails();
  renderProps();
  updateStatusBar();
}

function rotatePage(degrees) {
  const page = currentPageData();
  if (!page) return;
  pushHistory();
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = page.width / 2, cy = page.height / 2;
  for (const o of page.objects) {
    if (o.type === 'draw') {
      for (const p of (o.points || [])) {
        const dx = p.x - cx, dy = p.y - cy;
        p.x = cx + dx * cos - dy * sin;
        p.y = cy + dx * sin + dy * cos;
      }
      const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y);
      if (xs.length) {
        o.x = Math.min(...xs); o.y = Math.min(...ys);
        o.w = Math.max(...xs) - o.x; o.h = Math.max(...ys) - o.y;
      }
    } else {
      const corners = [
        [o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]
      ].map(([x, y]) => {
        const dx = x - cx, dy = y - cy;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
      });
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      o.x = Math.min(...xs); o.y = Math.min(...ys);
      o.w = Math.max(...xs) - o.x; o.h = Math.max(...ys) - o.y;
    }
  }
  if (Math.abs(degrees) % 180 === 90) {
    const t = page.width; page.width = page.height; page.height = t;
  }
  page._extraRotation = ((page._extraRotation || 0) + degrees + 360) % 360;
  const key = page.pdfPageNumber || 'blank-' + state.currentPage;
  delete state.pageCanvasCache[key];
  delete state.renderedAtZoom[key];
  THUMB_CACHE.delete(page.pdfPageNumber);
  renderCurrentPage();
  renderThumbnails();
  updateStatusBar();
  toast('Page rotated ' + (degrees > 0 ? '90° right' : '90° left'));
}

function clearPageObjects() {
  const p = currentPageData();
  if (!p || p.objects.length === 0) { toast('No edits on this page'); return; }
  if (!confirm('Remove all objects on this page? (Reconstructed text will be restored.)')) return;
  pushHistory();
  p.objects = [];
  p.ocr = null;
  p.reconstructed = false;
  p.reconStatus = 'idle';
  state.selectedObjectId = null;
  renderCurrentPage();
  renderProps();
  ensurePageReconstructed(p);
}
function revealAllText() {
  const p = currentPageData();
  if (!p) return;
  pushHistory();
  let any = false;
  for (const o of p.objects) {
    if (o.source === 'pdf' && o.type === 'text' && !o._masked) {
      if (!o._maskColor) o._maskColor = sampleBackgroundColor(p, o);
      o._masked = true;
      any = true;
    }
  }
  if (!any) { toast('No reconstructed text to reveal'); return; }
  reRenderOverlayOnly();
  toast('Revealed all reconstructed text on this page');
}
function deleteSelection() {
  if (!state.selectedObjectId) return;
  const found = findObject(state.selectedObjectId);
  if (!found) return;
  pushHistory();
  found.page.objects = found.page.objects.filter(o => o.id !== state.selectedObjectId);
  state.selectedObjectId = null;
  reRenderOverlayOnly();
  renderProps();
}

// ============================================================
// THUMBNAILS (cached)
// ============================================================
async function renderThumbnails() {
  el.thumbnailList.innerHTML = '';
  if (!state.pages.length) return;
  for (let i = 0; i < state.pages.length; i++) {
    const p = state.pages[i];
    const div = document.createElement('div');
    div.className = 'page-thumbnail' + (i === state.currentPage - 1 ? ' active' : '');
    const badge = p.reconStatus === 'done' && p.objects.some(o => o.source === 'pdf')
      ? '<div class="recon-badge">editable</div>' : '';
    div.innerHTML = `
      <div class="thumb-canvas-wrap"><div style="font-size:24px;color:#cbd5e1;">📄</div></div>
      <div class="page-number">${i + 1}</div>
      ${badge}
    `;
    div.onclick = async () => {
      state.currentPage = i + 1;
      state.selectedObjectId = null;
      await renderCurrentPage();
      renderThumbnails();
      renderProps();
      updateStatusBar();
      ensurePageReconstructed(currentPageData());
    };
    el.thumbnailList.appendChild(div);
    (async () => {
      const wrap = div.querySelector('.thumb-canvas-wrap');
      const targetW = 150;
      const scale = targetW / p.width;
      let canvas;
      const cacheKey = (p.pdfPageNumber || 'blank-' + i) + '@' + (p._extraRotation || 0);
      if (THUMB_CACHE.has(cacheKey)) {
        canvas = THUMB_CACHE.get(cacheKey);
        const clone = document.createElement('canvas');
        clone.width = canvas.width; clone.height = canvas.height;
        clone.getContext('2d').drawImage(canvas, 0, 0);
        wrap.innerHTML = '';
        wrap.appendChild(clone);
        return;
      }
      canvas = document.createElement('canvas');
      canvas.width = p.width * scale;
      canvas.height = p.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!p.blank && state.pdfDoc && p.pdfPageNumber) {
        try {
          const pg = await state.pdfDoc.getPage(p.pdfPageNumber);
          const rotation = (pg.rotate + (p._extraRotation || 0) + 360) % 360;
          const vp = pg.getViewport({ scale, rotation });
          await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch (_) {}
      }
      for (const o of p.objects) {
        if (o.source === 'pdf' && !o._masked && !o._revealed) continue;
        drawObject(ctx, o, scale);
      }
      THUMB_CACHE.set(cacheKey, canvas);
      const clone = document.createElement('canvas');
      clone.width = canvas.width; clone.height = canvas.height;
      clone.getContext('2d').drawImage(canvas, 0, 0);
      wrap.innerHTML = '';
      wrap.appendChild(clone);
    })();
  }
}

// ============================================================
// ZOOM & STATUS
// ============================================================
function setZoom(z) {
  state.zoom = clamp(z, 0.25, 4);
  el.zoomLevel.textContent = Math.round(state.zoom * 100) + '%';
  document.getElementById('zoomDropdown').classList.remove('open');
  renderCurrentPage();
}
function zoomIn() { setZoom(state.zoom + 0.25); }
function zoomOut() { setZoom(state.zoom - 0.25); }
function toggleZoomDropdown() { document.getElementById('zoomDropdown').classList.toggle('open'); }

function updateStatusBar() {
  el.statusPage.textContent = state.pages.length
    ? `Page ${state.currentPage} of ${state.pages.length}`
    : 'No document';
  const p = currentPageData();
  if (p) {
    const reconCount = p.objects.filter(o => o.source === 'pdf').length;
    el.statusRecon.textContent = p.reconStatus === 'scanned'
      ? '· Scanned page'
      : reconCount ? `· ${reconCount} editable text objects` : '';
  } else {
    el.statusRecon.textContent = '';
  }
}

// ============================================================
// OCR
// ============================================================
async function runOCROnCurrentPage() {
  const page = currentPageData();
  if (!page) return;
  if (!state.pdfDoc || page.blank) { toast('OCR requires a scanned PDF page'); return; }
  if (typeof Tesseract === 'undefined') {
    toast('Loading OCR engine (first time may take a few seconds)…', 3000);
    try { await loadScript('/assets/vendor/7a9ba970a3-tesseract.min.js'); }
    catch (e) { toast('Could not load OCR engine.'); return; }
  }
  showLoading('Running OCR on page ' + state.currentPage + '…');
  try {
    const pdfPage = await state.pdfDoc.getPage(page.pdfPageNumber);
    const scale = 2.0;
    const vp = pdfPage.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await pdfPage.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const result = await Tesseract.recognize(c, 'eng', {
      logger: m => { if (m.status === 'recognizing text') showLoading('OCR: ' + Math.round(m.progress * 100) + '%'); }
    });
    const text = (result.data.text || '').trim();
    const o = createObject('text', 20, 20, page.width - 40, Math.min(page.height - 40, 40 + text.split('\n').length * 16), {
      text: text || '(no text detected)',
      fontSize: 12,
      fontFamily: 'Helvetica, Arial, sans-serif',
      fontWeight: 'normal', fontStyle: 'normal',
      textDecoration: 'none',
      color: '#1e293b', textAlign: 'left',
      lineHeight: 1.3, letterSpacing: 0, opacity: 0.95,
      source: 'ocr', _masked: false
    });
    page.objects.push(o);
    page.reconStatus = 'done';
    page.reconstructed = true;
    state.selectedObjectId = o.id;
    pushHistory();
    hideLoading();
    renderCurrentPage();
    renderProps();
    toast('OCR complete. Text placed as an editable overlay.', 3500);
  } catch (e) {
    hideLoading();
    toast('OCR failed: ' + e.message, 3500);
  }
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ============================================================
// EXPORT — PDF
// ============================================================
async function exportPDF() {
  if (typeof PDFLib === 'undefined') { toast('PDF export library not loaded.'); return; }
  if (!state.pages.length) { toast('Nothing to export'); return; }
  showLoading('Building PDF with your edits…');
  try {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    let outDoc;
    let originalPages = [];
    const usedOriginalPages = new Set();
    if (state.pdfBytes) {
      outDoc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
      originalPages = outDoc.getPages();
      const total = outDoc.getPageCount();
      for (let i = total - 1; i >= 0; i--) outDoc.removePage(i);
    } else {
      outDoc = await PDFDocument.create();
    }
    const font = await outDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await outDoc.embedFont(StandardFonts.HelveticaOblique);
    const fontBoldItalic = await outDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    const imgCache = new Map();

    let srcDoc = null;
    if (state.pdfBytes) {
      srcDoc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    }

    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      let newPage;
      if (!p.blank && srcDoc && p.pdfPageNumber) {
        if (!usedOriginalPages.has(p.pdfPageNumber)) {
          newPage = outDoc.addPage(originalPages[p.pdfPageNumber - 1]);
          usedOriginalPages.add(p.pdfPageNumber);
        } else {
          const [copied] = await outDoc.copyPages(srcDoc, [p.pdfPageNumber - 1]);
          newPage = outDoc.addPage(copied);
        }
      } else {
        newPage = outDoc.addPage([p.width, p.height]);
      }
      const pw = p.width, ph = p.height;
      let coordinateMatrix = [1,0,0,1,0,0];
      if (!p.blank && state.pdfDoc && p.pdfPageNumber) {
        const sourcePage = await state.pdfDoc.getPage(p.pdfPageNumber);
        const rotation = (sourcePage.rotate + (p._extraRotation || 0)) % 360;
        newPage.setRotation(PDFLib.degrees(rotation));
        const [a,b,c,d,e,f] = sourcePage.getViewport({scale:1,rotation}).transform;
        const det=a*d-b*c;
        coordinateMatrix=[d/det,-b/det,c/det,-a/det,(-c*ph+c*f-d*e)/det,(a*ph+b*e-a*f)/det];
      }
      newPage.pushOperators(PDFLib.pushGraphicsState(),PDFLib.concatTransformationMatrix(...coordinateMatrix));
      for (const o of p.objects) {
        if (o.source === 'pdf' && o.type === 'text' && !o._masked && !o._revealed) continue;
        try {
          newPage.pushOperators(PDFLib.pushGraphicsState());
          if(o.rotation){
            const angle=-o.rotation*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),x=o.x,y=ph-o.y;
            newPage.pushOperators(PDFLib.concatTransformationMatrix(co,si,-si,co,x-x*co+y*si,y-x*si-y*co));
          }
          if (o._masked && o._maskColor) {
            const mc = hexToRgb(o._maskColor);
            newPage.drawRectangle({
              x: o.x, y: ph - o.y - o.h,
              width: o.w, height: o.h,
              color: rgb(mc.r, mc.g, mc.b)
            });
          }
          if (o.type === 'text') {
            const size = o.fontSize || 14;
            const color = hexToRgb(o.color || '#1e293b');
            const useFont = await DropletFonts.forText(outDoc,o);
            const lines = DropletFonts.lines(o.text,useFont,size,Math.max(o.w,10));
            let y = ph - o.y - size;
            for (const line of lines) {
              const letterSpacing=Number(o.letterSpacing)||0;
              const measured=useFont.widthOfTextAtSize(line,size)+Math.max(0,Array.from(line).length-1)*letterSpacing;
              const x=o.x+(o.textAlign==='center'?(o.w-measured)/2:o.textAlign==='right'?o.w-measured:0);
              if(letterSpacing){let cursor=x;for(const character of line){newPage.drawText(character,{x:cursor,y,size,font:useFont,color:rgb(color.r,color.g,color.b),opacity:o.opacity!=null?o.opacity:1});cursor+=useFont.widthOfTextAtSize(character,size)+letterSpacing;}}
              else newPage.drawText(line,{x,y,size,font:useFont,color:rgb(color.r,color.g,color.b),opacity:o.opacity!=null?o.opacity:1});
              if(o.textDecoration==='underline')newPage.drawLine({start:{x,y:y-2},end:{x:x+measured,y:y-2},thickness:Math.max(.5,size/16),color:rgb(color.r,color.g,color.b)});
              y -= size*(o.lineHeight||1.2);
            }
          } else if (o.type === 'highlight' || o.type === 'whiteout') {
            const color = hexToRgb(o.color || '#ffffff');
            newPage.drawRectangle({
              x: o.x, y: ph - o.y - o.h,
              width: o.w, height: o.h,
              color: rgb(color.r, color.g, color.b),
              opacity: o.opacity != null ? o.opacity : 1
            });
          } else if (o.type === 'draw') {
            const color = hexToRgb(o.color || '#ef4444');
            const pts = o.points || [];
            for (let k = 1; k < pts.length; k++) {
              newPage.drawLine({
                start: { x: pts[k-1].x, y: ph - pts[k-1].y },
                end:   { x: pts[k].x,   y: ph - pts[k].y },
                thickness: o.strokeWidth || 2,
                color: rgb(color.r, color.g, color.b),
                opacity: o.opacity != null ? o.opacity : 1
              });
            }
          } else if (o.type === 'shape') {
            const color = hexToRgb(o.color || '#2563eb');
            if (o.shape === 'rect') {
              newPage.drawRectangle({
                x: o.x, y: ph - o.y - o.h,
                width: o.w, height: o.h,
                borderColor: rgb(color.r, color.g, color.b),
                borderWidth: o.strokeWidth || 2,
                color: o.fill ? rgb(color.r, color.g, color.b) : undefined
              });
            } else if (o.shape === 'ellipse') {
              newPage.drawEllipse({
                x: o.x + o.w/2, y: ph - o.y - o.h/2,
                xScale: o.w/2, yScale: o.h/2,
                borderColor: rgb(color.r, color.g, color.b),
                borderWidth: o.strokeWidth || 2,
                color: o.fill ? rgb(color.r, color.g, color.b) : undefined
              });
            } else if (o.shape === 'line' || o.shape === 'arrow') {
              newPage.drawLine({
                start: { x: o.x, y: ph - o.y },
                end: { x: o.x + o.w, y: ph - (o.y + o.h) },
                thickness: o.strokeWidth || 2,
                color: rgb(color.r, color.g, color.b)
              });
              if(o.shape==='arrow'){
                const end={x:o.x+o.w,y:ph-o.y-o.h},angle=Math.atan2(-o.h,o.w),head=Math.max(10,(o.strokeWidth||2)*4);
                for(const offset of [-Math.PI/6,Math.PI/6])newPage.drawLine({start:end,end:{x:end.x-head*Math.cos(angle+offset),y:end.y-head*Math.sin(angle+offset)},thickness:o.strokeWidth||2,color:rgb(color.r,color.g,color.b)});
              }
            }
          } else if (o.type === 'image' || o.type === 'sign') {
            if (o.dataUrl) {
              let embedded = imgCache.get(o.dataUrl);
              if (!embedded) {
                const b64 = o.dataUrl.split(',')[1];
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
                if (o.dataUrl.startsWith('data:image/png')) embedded = await outDoc.embedPng(bytes);
                else embedded = await outDoc.embedJpg(bytes);
                if (embedded) imgCache.set(o.dataUrl, embedded);
              }
              if (embedded) {
                newPage.drawImage(embedded, {
                  x: o.x, y: ph - o.y - o.h,
                  width: o.w, height: o.h,
                  opacity: o.opacity != null ? o.opacity : 1
                });
              }
            }
          } else if (o.type === 'form') {
            const form=outDoc.getForm(),name='droplet_'+i+'_'+o.id;
            const transform=(x,y)=>({x:coordinateMatrix[0]*x+coordinateMatrix[2]*y+coordinateMatrix[4],y:coordinateMatrix[1]*x+coordinateMatrix[3]*y+coordinateMatrix[5]});
            const points=[transform(o.x,ph-o.y),transform(o.x+o.w,ph-o.y-o.h)];
            const bounds={x:Math.min(points[0].x,points[1].x),y:Math.min(points[0].y,points[1].y),width:Math.abs(points[1].x-points[0].x),height:Math.abs(points[1].y-points[0].y),borderWidth:1,borderColor:rgb(.15,.39,.92),backgroundColor:rgb(.96,.98,1)};
            if(o.formType==='checkbox'){const field=form.createCheckBox(name);field.addToPage(newPage,{...bounds,width:18,height:18});}
            else if(o.formType==='radio'){const field=form.createRadioGroup(name);field.addOptionToPage('Yes',newPage,{...bounds,width:18,height:18});}
            else if(o.formType==='dropdown'){const field=form.createDropdown(name);field.addOptions(['Choose an option','Option 1','Option 2']);field.select('Choose an option');field.addToPage(newPage,bounds);}
            else {const field=form.createTextField(name);field.setText(o.formValue||'');field.addToPage(newPage,bounds);}
          }
          newPage.pushOperators(PDFLib.popGraphicsState());
        } catch (err) { throw new Error('An edit could not be exported: '+err.message); }
      }
      newPage.pushOperators(PDFLib.popGraphicsState());
    }
    const bytes = await outDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (docTitle || 'document').replace(/\.pdf$/i, '');
    a.href = url;
    a.download = `dropletweb-${base}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    hideLoading();
    toast('PDF exported as dropletweb-' + base + '.pdf', 3000);
  } catch (e) {
    hideLoading();
    console.error(e);
    toast('Export failed: ' + e.message, 4000);
  }
}

// ============================================================
// EXPORT — DOCX
// ============================================================
async function pagesForTextExport(){
  const pages=[];
  for(const page of state.pages){
    const originals=!page.blank&&!page.reconstructed&&state.pdfDoc?(await reconstructPageText(page,page.pdfPageNumber)).objects:[];
    pages.push({...page,objects:[...originals,...page.objects]});
  }
  return pages;
}

async function exportDOCX() {
  if (typeof docx === 'undefined') { toast('DOCX library not loaded.'); return; }
  if (!state.pages.length) { toast('Nothing to export'); return; }
  showLoading('Building DOCX…');
  try {
    const exportPages=await pagesForTextExport();
    const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType } = docx;
    const sections = [];

    for (let i = 0; i < exportPages.length; i++) {
      const p = exportPages[i];
      const children = [];

      children.push(new Paragraph({
        children: [new TextRun({ text: `Page ${i + 1}`, bold: true, size: 24, color: '94a3b8' })],
        spacing: { after: 200 }
      }));

      const sorted = [...p.objects].sort((a, b) => Math.abs(a.y - b.y) > 5 ? a.y - b.y : a.x - b.x);

      for (const o of sorted) {

        if (o.type === 'text') {
          const runs = [];
          const lines = String(o.text || '').split('\n');
          lines.forEach((line, li) => {
            if (li > 0) runs.push(new TextRun({ break: 1 }));
            runs.push(new TextRun({
              text: line,
              bold: o.fontWeight === 'bold',
              italics: o.fontStyle === 'italic',
              underline: o.textDecoration === 'underline' ? {} : undefined,
              size: Math.round((o.fontSize || 14) * 2),
              color: (o.color || '#1e293b').replace('#',''),
              font: (o.fontFamily || 'Helvetica').split(',')[0].replace(/['"]/g,'')
            }));
          });
          children.push(new Paragraph({
            children: runs,
            alignment: o.textAlign === 'center' ? AlignmentType.CENTER
                     : o.textAlign === 'right'  ? AlignmentType.RIGHT
                     : o.textAlign === 'justify' ? AlignmentType.JUSTIFIED
                     : AlignmentType.LEFT,
            spacing: { line: Math.round((o.lineHeight || 1.15) * 240) }
          }));
        } else if (o.type === 'image' || o.type === 'sign') {
          if (o.dataUrl) {
            try {
              const b64 = o.dataUrl.split(',')[1];
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
              const ext = o.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
              const ratio = Math.min(1, 600 / o.w, 600 / o.h);
              const w = Math.round(o.w * ratio);
              const h = Math.round(o.h * ratio);
              children.push(new Paragraph({
                children: [new ImageRun({
                  data: bytes,
                  transformation: { width: Math.min(w, 600), height: Math.min(h, 600) },
                  type: ext
                })],
                spacing: { after: 120 }
              }));
            } catch (err) { console.warn('DOCX image skipped:', err); }
          }
        } else if (o.type === 'highlight' || o.type === 'whiteout') {
          children.push(new Paragraph({
            children: [new TextRun({
              text: `[${o.type === 'highlight' ? 'Highlight' : 'Whiteout'}] ${Math.round(o.w)}×${Math.round(o.h)} at (${Math.round(o.x)}, ${Math.round(o.y)})`,
              color: '94a3b8', italics: true, size: 18
            })]
          }));
        } else if (o.type === 'shape') {
          children.push(new Paragraph({
            children: [new TextRun({
              text: `[${o.shape}] at (${Math.round(o.x)}, ${Math.round(o.y)}) ${Math.round(o.w)}×${Math.round(o.h)}`,
              color: '94a3b8', italics: true, size: 18
            })]
          }));
        } else if (o.type === 'form') {
          children.push(new Paragraph({
            children: [new TextRun({
              text: `[Form: ${o.formType}] at (${Math.round(o.x)}, ${Math.round(o.y)})`,
              color: '2563eb', bold: true, size: 20
            })]
          }));
        }
      }

      sections.push({ properties: {}, children });
    }

    const doc = new Document({ sections });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (docTitle || 'document').replace(/\.(pdf|docx|xlsx)$/i, '');
    a.href = url;
    a.download = `dropletweb-${base}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    hideLoading();
    toast('DOCX exported as dropletweb-' + base + '.docx', 3000);
  } catch (e) {
    hideLoading();
    console.error(e);
    toast('DOCX export failed: ' + e.message, 4000);
  }
}

// ============================================================
// EXPORT — XLSX
// ============================================================
async function exportXLSX() {
  if (typeof XLSX === 'undefined') { toast('XLSX library not loaded.'); return; }
  if (!state.pages.length) { toast('Nothing to export'); return; }
  showLoading('Building XLSX…');
  try {
    const exportPages=await pagesForTextExport();
    const wb = XLSX.utils.book_new();

    const summaryAoA = [
      ['Document', docTitle || 'Untitled PDF'],
      ['Pages', exportPages.length],
      ['Exported', new Date().toISOString()],
      [],
      ['Page', 'Objects', 'Text objects', 'Images', 'Shapes', 'Highlights', 'Forms']
    ];
    for (let i = 0; i < exportPages.length; i++) {
      const p = exportPages[i];
      const count = (type) => p.objects.filter(o => o.type === type).length;
      summaryAoA.push([
        i + 1,
        p.objects.length,
        count('text'),
        count('image') + count('sign'),
        count('shape') + count('draw'),
        count('highlight') + count('whiteout'),
        count('form')
      ]);
    }
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoA);
    summaryWs['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    for (let i = 0; i < exportPages.length; i++) {
      const p = exportPages[i];
      const rows = [
        ['Type', 'X', 'Y', 'Width', 'Height', 'Font', 'Size', 'Color', 'Content/Info']
      ];
      const sorted = [...p.objects].sort((a, b) => Math.abs(a.y - b.y) > 5 ? a.y - b.y : a.x - b.x);
      for (const o of sorted) {
        let content = '';
        let font = '', size = '', color = '';
        if (o.type === 'text') {
          content = String(o.text || '').replace(/\n/g, ' / ');
          font = o.fontFamily || '';
          size = o.fontSize || '';
          color = o.color || '';
        } else if (o.type === 'image' || o.type === 'sign') {
          content = o.dataUrl ? 'image data' : '';
        } else if (o.type === 'highlight' || o.type === 'whiteout') {
          content = o.color || '';
          color = o.color || '';
        } else if (o.type === 'shape') {
          content = o.shape + (o.fill ? ' (filled)' : '');
          color = o.color || '';
        } else if (o.type === 'draw') {
          content = (o.points || []).length + ' points';
          color = o.color || '';
        } else if (o.type === 'form') {
          content = o.formType;
        }
        rows.push([
          o.type,
          Math.round(o.x),
          Math.round(o.y),
          Math.round(o.w),
          Math.round(o.h),
          font,
          size,
          color,
          content
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
        { wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 60 }
      ];
      const sheetName = `Page ${i + 1}`.slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (docTitle || 'document').replace(/\.(pdf|docx|xlsx)$/i, '');
    a.href = url;
    a.download = `dropletweb-${base}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    hideLoading();
    toast('XLSX exported as dropletweb-' + base + '.xlsx', 3000);
  } catch (e) {
    hideLoading();
    console.error(e);
    toast('XLSX export failed: ' + e.message, 4000);
  }
}

// ============================================================
// KEYBOARD
// ============================================================
document.addEventListener('keydown', (e) => {
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); exportPDF(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setZoom(1); }
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selectedObjectId) { e.preventDefault(); deleteSelection(); } }
  if (e.key === 'Escape') {
    state.selectedObjectId = null;
    reRenderOverlayOnly();
    renderProps();
    document.getElementById('zoomDropdown').classList.remove('open');
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const map = { v:'select', t:'text', i:'image', d:'draw', h:'highlight', w:'whiteout', s:'shape', g:'sign', f:'forms' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.zoom-controls')) {
    document.getElementById('zoomDropdown').classList.remove('open');
  }
});

// ============================================================
// REVEAL SEO CONTENT WHEN A DOCUMENT IS OPEN
// ============================================================
function updateSEOVisibility() {
  const seo = document.getElementById('seoSection');
  if (!seo) return;
  seo.style.display = state.pages.length ? 'block' : 'none';
}

// ============================================================
// INIT
// ============================================================
updateStatusBar();
updateHistoryButtons();
renderProps();
updateSEOVisibility();
console.log('✏️ Droplet PDF Editor loaded — 100% client-side. Export: PDF, DOCX, XLSX.');

