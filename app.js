/* Geetha Agarwal Money Lenders — Pledge receipt app (offline PWA) */
(function () {
'use strict';

/* ---------------- cloud config ---------------- */
const GOOGLE_CLIENT_ID = '141909794238-2p26p5tbfhk9kdacm7ncdmeusra7dmu3.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP_FOLDER_NAME = 'Pledge Book - Backups';
const DATA_FILE_NAME = 'pledge-book-data.json';
// Google sign-in + Drive sync. Set false for a pure on-device build (no login).
const CLOUD_ENABLED = true;

/* ---------------- tiny helpers ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function todayISO() {
  const d = new Date();
  const l = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return l.toISOString().slice(0, 10);
}
function numOrEmpty(v) {
  v = (v == null ? '' : String(v)).trim();
  if (v === '') return '';
  const n = Number(v);
  return isNaN(n) ? '' : n;
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------- formatting ---------------- */
function fmtDate(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length !== 3) return iso;
  return p[2] + ' / ' + p[1] + ' / ' + p[0];
}
function addMonthsISO(iso, months) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || !p[0]) return '';
  const dt = new Date(p[0], p[1] - 1, p[2]);
  dt.setMonth(dt.getMonth() + months);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return dd + ' / ' + mm + ' / ' + dt.getFullYear();
}
function maturityDateObj(iso) {
  if (!iso) return null;
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || !p[0]) return null;
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setMonth(d.getMonth() + 6);
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysUntilDate(d) {
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}
// Returns null, or {kind:'overdue'|'due', days} for an active pledge near/past its due date.
function dueInfo(p, win) {
  if (!p || p.deleted || p.status === 'redeemed') return null;
  const m = maturityDateObj(p.date);
  if (!m) return null;
  const d = daysUntilDate(m);
  if (d < 0) return { kind: 'overdue', days: -d };
  if (d <= win) return { kind: 'due', days: d };
  return null;
}
function reminderWindow() { return parseInt(settings.reminderDays, 10) || 7; }

function formatINR(num) {
  if (num === '' || num == null) return '';
  const n = Number(num);
  if (!isFinite(n)) return '';
  const neg = n < 0;
  let s = Math.abs(Math.round(n)).toString();
  let last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + rest + last3;
}
function numToWordsIndian(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (!n) return '';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => x < 20 ? a[x] : (b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x) => {
    let s = '';
    const h = Math.floor(x / 100), r = x % 100;
    if (h) s += a[h] + ' Hundred' + (r ? ' ' : '');
    if (r) s += two(r);
    return s;
  };
  let res = '';
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thou = Math.floor(n / 1000); n %= 1000;
  if (crore) res += three(crore) + ' Crore ';
  if (lakh) res += two(lakh) + ' Lakh ';
  if (thou) res += two(thou) + ' Thousand ';
  if (n) res += three(n);
  res = res.trim().replace(/\s+/g, ' ');
  return res ? res + ' Only' : '';
}
function maskAadhaar(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 4) return d;
  return 'XXXX XXXX ' + d.slice(-4);
}
function computeNett(g, l) {
  const G = parseFloat(g), L = parseFloat(l);
  if (isFinite(G) && isFinite(L)) return (G - L).toFixed(2);
  if (isFinite(G)) return G.toFixed(2);
  return '';
}

/* ---------------- IndexedDB ---------------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ga_pledge_db', 1);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pledges')) db.createObjectStore('pledges', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(store, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const rq = t.objectStore(store).put(val);
    rq.onsuccess = () => res(rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
async function dbGet(store, key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction(store, 'readonly').objectStore(store).get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function dbAll(store) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction(store, 'readonly').objectStore(store).getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  });
}
async function dbDel(store, key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function dbClear(store) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).clear();
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

/* ---------------- settings ---------------- */
const DEFAULT_SETTINGS = {
  key: 'app',
  shopName: '',
  shopSub: 'MONEY LENDERS',
  address: '',
  licenseName: '',
  licenseCity: '',
  licenseNo: '',
  brokerName: '',
  brokerNoDate: '',
  nextPledgeNo: 1,
  customLogo: null,
  lastBackupAt: null,
  reminderDays: 7
};
let settings = Object.assign({}, DEFAULT_SETTINGS);
async function loadSettings() {
  const s = await dbGet('settings', 'app');
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
}
async function persistSettings(silent) {
  settings.key = 'app';
  await dbPut('settings', settings);
  if (!silent) applySettingsToBar();
}

/* ---------------- image compression ---------------- */
function fileToCompressedDataURL(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { URL.revokeObjectURL(url); reject(new Error('bad image')); return; }
      if (w > maxDim || h > maxDim) {
        const r = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { resolve(c.toDataURL('image/jpeg', quality || 0.72)); }
      catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load fail')); };
    img.src = url;
  });
}

/* ---------------- signature pad ---------------- */
function SignaturePad(canvas) {
  this.c = canvas;
  this.ctx = canvas.getContext('2d');
  this.drawn = false;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  this.w = rect.width; this.h = rect.height;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  this.ctx.scale(dpr, dpr);
  this.ctx.lineWidth = 2.2;
  this.ctx.lineCap = 'round';
  this.ctx.lineJoin = 'round';
  this.ctx.strokeStyle = '#0b3d91';
  let drawing = false, last = null;
  const self = this;
  const pos = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true; last = pos(e);
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (x) {} }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    self.ctx.beginPath();
    self.ctx.moveTo(last.x, last.y);
    self.ctx.lineTo(p.x, p.y);
    self.ctx.stroke();
    last = p; self.drawn = true;
    e.preventDefault();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', stop);
}
SignaturePad.prototype.clear = function () {
  this.ctx.clearRect(0, 0, this.c.width, this.c.height);
  this.drawn = false;
};
SignaturePad.prototype.isEmpty = function () { return !this.drawn; };
SignaturePad.prototype.dataURL = function () {
  return this.drawn ? this.c.toDataURL('image/png') : null;
};
SignaturePad.prototype.loadDataURL = function (url) {
  const self = this;
  const im = new Image();
  im.onload = () => { self.ctx.drawImage(im, 0, 0, self.w, self.h); self.drawn = true; };
  im.src = url;
};

/* ---------------- photo fields ---------------- */
function setPhotoPreview(field, url) {
  const img = $('.ph-img', field);
  const empty = $('.ph-empty', field);
  const rm = $('.ph-remove', field);
  if (url) { img.src = url; img.style.display = 'block'; empty.style.display = 'none'; rm.style.display = 'block'; }
  else { img.src = ''; img.style.display = 'none'; empty.style.display = 'flex'; rm.style.display = 'none'; }
}
function initPhotoFields(scope, store) {
  $$('[data-photo]', scope).forEach((field) => {
    const key = field.dataset.key;
    const camIn = $('[data-cam-input]', field);
    const galIn = $('[data-gal-input]', field);
    const camBtn = $('[data-cam]', field);
    const galBtn = $('[data-gal]', field);
    const rm = $('.ph-remove', field);
    if (camBtn) camBtn.onclick = () => camIn.click();
    if (galBtn) galBtn.onclick = () => galIn.click();
    const onpick = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const max = key === 'customLogo' ? 400 : 800;
        const dataURL = await fileToCompressedDataURL(file, max, 0.6);
        store[key] = dataURL;
        setPhotoPreview(field, dataURL);
      } catch (err) { toast('Could not load that image'); }
    };
    if (camIn) camIn.onchange = onpick;
    if (galIn) galIn.onchange = onpick;
    rm.onclick = () => { store[key] = null; setPhotoPreview(field, null); };
  });
}

/* ---------------- receipt rendering ---------------- */
const LAKSHMI_SVG = '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">'
  + '<circle cx="60" cy="60" r="57" fill="#fff" stroke="#8e1b1b" stroke-width="2.5"/>'
  + '<circle cx="60" cy="60" r="51" fill="none" stroke="#c9a24a" stroke-width="1.3"/>'
  + '<g fill="#0b3d91"><path d="M18 50 c5 -6 14 -7 19 -2 c1 3 -1 6 -4 6 c3 2 2 7 -2 8 l-1 -4 l-2 4 l-1 -4 c-5 0 -9 -4 -9 -8 z"/>'
  + '<path d="M102 50 c-5 -6 -14 -7 -19 -2 c-1 3 1 6 4 6 c-3 2 -2 7 2 8 l1 -4 l2 4 l1 -4 c5 0 9 -4 9 -8 z"/></g>'
  + '<circle cx="60" cy="46" r="17" fill="none" stroke="#c9a24a" stroke-width="1.3"/>'
  + '<path d="M47 80 C47 63 52 55 60 55 C68 55 73 63 73 80 C66 76 54 76 47 80 Z" fill="#8e1b1b"/>'
  + '<path d="M54 58 C48 54 44 49 42 44" fill="none" stroke="#8e1b1b" stroke-width="2.6" stroke-linecap="round"/>'
  + '<path d="M66 58 C72 54 76 49 78 44" fill="none" stroke="#8e1b1b" stroke-width="2.6" stroke-linecap="round"/>'
  + '<path d="M52 63 C46 67 44 73 45 78" fill="none" stroke="#8e1b1b" stroke-width="3" stroke-linecap="round"/>'
  + '<path d="M68 63 C74 67 76 73 75 78" fill="none" stroke="#8e1b1b" stroke-width="3" stroke-linecap="round"/>'
  + '<circle cx="40" cy="42" r="3.6" fill="#c9a24a"/><circle cx="80" cy="42" r="3.6" fill="#c9a24a"/>'
  + '<circle cx="60" cy="46" r="7" fill="#8e1b1b"/>'
  + '<path d="M53 40 L56 33 L60 38 L64 33 L67 40 Z" fill="#c9a24a"/><circle cx="60" cy="31.5" r="1.6" fill="#c9a24a"/>'
  + '<path d="M60 92 C49 92 41 86 39 80 C48 84 54 84 60 82 C66 84 72 84 81 80 C79 86 71 92 60 92 Z" fill="#8e1b1b"/>'
  + '<path d="M46 82 C48 76 53 73 60 73 C67 73 72 76 74 82" fill="none" stroke="#c9a24a" stroke-width="1.3"/>'
  + '<circle cx="50" cy="99" r="3" fill="#c9a24a"/><circle cx="60" cy="101" r="3.2" fill="#c9a24a"/><circle cx="70" cy="99" r="3" fill="#c9a24a"/>'
  + '</svg>';

const RECEIPT_CSS = ''
+ '.receipt{box-sizing:border-box;width:600px;background:#fff;color:#1a1a2e;font-family:Georgia,"Times New Roman",serif;padding:16px;}'
+ '.receipt,.receipt *{box-sizing:border-box;}'
+ '.receipt *{margin:0;padding:0;}'
+ '.receipt .r-frame{border:2px solid #8e1b1b;padding:13px;}'
+ '.receipt .r-head{display:flex;align-items:center;gap:10px;border-bottom:2px solid #8e1b1b;padding-bottom:8px;}'
+ '.receipt .r-logo{width:68px;height:68px;flex:0 0 auto;}'
+ '.receipt .r-logo svg,.receipt .r-logo img{width:68px;height:68px;object-fit:contain;display:block;}'
+ '.receipt .r-head-mid{flex:1;text-align:center;}'
+ '.receipt .r-shop{color:#8e1b1b;font-size:23px;font-weight:bold;letter-spacing:1px;line-height:1.05;}'
+ '.receipt .r-ml{color:#0b3d91;letter-spacing:6px;font-size:10px;font-weight:bold;margin-top:3px;}'
+ '.receipt .r-addr{font-size:12px;margin-top:3px;}'
+ '.receipt .r-forme{color:#8e1b1b;font-weight:bold;font-size:11px;letter-spacing:2px;margin-top:2px;}'
+ '.receipt .r-lic{flex:0 0 auto;text-align:right;font-size:10px;color:#0b3d91;line-height:1.35;}'
+ '.receipt .r-lic b{color:#8e1b1b;font-size:11px;}'
+ '.receipt .ink{color:#0b3d91;}'
+ '.receipt .b{font-weight:bold;}'
+ '.receipt .u{border-bottom:1px solid #aaa;display:inline-block;min-width:54%;padding:0 3px;}'
+ '.receipt .r-meta{display:flex;justify-content:space-between;font-size:13px;margin:8px 2px 4px;}'
+ '.receipt .r-meta .rp{color:#8e1b1b;font-weight:bold;}'
+ '.receipt .r-line{font-size:12px;margin:4px 2px;}'
+ '.receipt .r-div{border-top:1px solid #c9a24a;margin:7px 0;}'
+ '.receipt .r-cols{display:flex;gap:10px;align-items:flex-start;}'
+ '.receipt .r-colmain{flex:1;min-width:0;}'
+ '.receipt .r-fld{font-size:12px;margin:6px 2px;}'
+ '.receipt .r-photo{flex:0 0 116px;width:116px;height:138px;border:1px solid #999;border-radius:3px;overflow:hidden;background:#fafafa;display:flex;align-items:center;justify-content:center;text-align:center;}'
+ '.receipt .r-photo img{width:100%;height:100%;object-fit:cover;display:block;}'
+ '.receipt .r-ph{font-size:9px;color:#aaa;padding:4px;}'
+ '.receipt .r-loan{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin:5px 2px;}'
+ '.receipt .big{font-weight:bold;font-size:16px;}'
+ '.receipt .r-words{color:#0b3d91;font-style:italic;font-size:12px;}'
+ '.receipt .r-weights{display:flex;gap:6px;margin:7px 2px;text-align:center;}'
+ '.receipt .wcell{flex:1;border:1px solid #c9a24a;border-radius:3px;padding:4px 2px;}'
+ '.receipt .wcell.nett{background:#fff8e9;}'
+ '.receipt .wk{font-size:8px;color:#555;line-height:1.2;}'
+ '.receipt .wv{color:#0b3d91;font-weight:bold;font-size:13px;min-height:15px;margin-top:2px;}'
+ '.receipt .r-six{color:#8e1b1b;font-weight:bold;letter-spacing:1px;}'
+ '.receipt .sm{font-size:11px;}'
+ '.receipt .r-note{font-size:10px;line-height:1.45;color:#333;margin:7px 2px 2px;text-align:justify;background:#faf7f0;border-left:3px solid #c9a24a;padding:6px 8px;}'
+ '.receipt .r-sigs{display:flex;justify-content:space-between;gap:22px;margin-top:16px;}'
+ '.receipt .r-sig{flex:1;text-align:center;}'
+ '.receipt .r-sigbox{height:46px;border-bottom:1px solid #1a1a2e;display:flex;align-items:flex-end;justify-content:center;}'
+ '.receipt .r-sigbox img{max-height:46px;max-width:100%;display:block;}'
+ '.receipt .r-sigcap{font-size:10px;margin-top:3px;}'
+ '.receipt .r-received{display:flex;justify-content:space-between;align-items:flex-end;gap:22px;margin-top:14px;border-top:1px dashed #999;padding-top:8px;}'
+ '.receipt .r-recv{font-size:11px;max-width:52%;}'
+ '.receipt .r-sig.small{flex:0 0 210px;}'
+ '.receipt .r-sig.small .r-sigbox{height:34px;}'
+ '.receipt .r-redeem-hdr{text-align:center;color:#8e1b1b;font-weight:bold;letter-spacing:3px;font-size:13px;margin:0 2px 10px;padding-top:8px;border-top:2px dashed #c9a24a;}';

function injectReceiptCSS() {
  if ($('#rcpt-css')) return;
  const st = document.createElement('style');
  st.id = 'rcpt-css';
  st.textContent = RECEIPT_CSS;
  document.head.appendChild(st);
}

function buildReceiptNode(p, s) {
  const wrap = document.createElement('div');
  wrap.className = 'receipt';
  const date = fmtDate(p.date);
  const maturity = p.date ? addMonthsISO(p.date, 6) : '';
  const words = numToWordsIndian(p.principal);
  const nett = computeNett(p.gross, p.less);
  const aad = maskAadhaar(p.aadhaar);
  const logo = s.customLogo ? '<img src="' + s.customLogo + '" alt=""/>' : LAKSHMI_SVG;
  const cust = p.customerPhoto ? '<img src="' + p.customerPhoto + '" alt=""/>' : '<div class="r-ph">Customer Photo</div>';
  const art = p.articlePhoto ? '<img src="' + p.articlePhoto + '" alt=""/>' : '<div class="r-ph">Article / Item Photo</div>';
  const sP = p.signPawner ? '<img src="' + p.signPawner + '" alt=""/>' : '';
  const sB = p.signBroker ? '<img src="' + p.signBroker + '" alt=""/>' : '';
  const sF = p.signFooter ? '<img src="' + p.signFooter + '" alt=""/>' : '';
  const gross = (p.gross === '' || p.gross == null) ? '' : p.gross + ' g';
  const less = (p.less === '' || p.less == null) ? '' : p.less + ' g';
  const nettD = nett ? nett + ' g' : '';

  wrap.innerHTML =
    '<div class="r-frame">'
    + '<div class="r-head">'
    +   '<div class="r-logo">' + logo + '</div>'
    +   '<div class="r-head-mid">'
    +     '<div class="r-shop">' + escapeHTML(s.shopName) + '</div>'
    +     '<div class="r-ml">' + escapeHTML(s.shopSub) + '</div>'
    +     '<div class="r-addr">' + escapeHTML(s.address) + '</div>'
    +     '<div class="r-forme">FORM &#39;E&#39;</div>'
    +   '</div>'
    +   '<div class="r-lic"><b>' + escapeHTML(s.licenseName) + '</b><br/>' + escapeHTML(s.licenseCity) + '<br/>' + escapeHTML(s.licenseNo) + '</div>'
    + '</div>'

    + '<div class="r-meta"><div><span class="rp">Pledge No:</span> <span class="ink">' + escapeHTML(p.pledgeNo) + '</span></div>'
    +   '<div>Date: <span class="ink">' + escapeHTML(date) + '</span></div></div>'

    + '<div class="r-line">Pawn Broker: <span class="ink">' + escapeHTML(s.brokerName) + '</span></div>'
    + '<div class="r-line">Broker No. &amp; Date: <span class="ink">' + escapeHTML(s.brokerNoDate) + '</span></div>'

    + '<div class="r-div"></div>'
    + '<div class="r-line"><b>The following article(s) is / are pawned with me:</b></div>'
    + '<div class="r-cols"><div class="r-colmain">'
    +   '<div class="r-fld">Name of Pawner: <span class="ink u">' + escapeHTML(p.pawnerName) + '</span></div>'
    +   '<div class="r-fld">Full Address: <span class="ink u">' + escapeHTML(p.pawnerAddress) + '</span></div>'
    +   '<div class="r-fld">Aadhaar No: <span class="ink u">' + escapeHTML(aad) + '</span></div>'
    +   (p.mobile ? '<div class="r-fld">Mobile No: <span class="ink u">' + escapeHTML(p.mobile) + '</span></div>' : '')
    +   '<div class="r-fld">Date: <span class="ink u">' + escapeHTML(date) + '</span></div>'
    + '</div><div class="r-photo">' + cust + '</div></div>'

    + '<div class="r-div"></div>'
    + '<div class="r-loan"><div>Principal of loan: <span class="ink big">' + (p.principal !== '' && p.principal != null ? '&#8377; ' + formatINR(p.principal) : '') + '</span></div>'
    +   '<div class="r-words">' + (words ? '(' + escapeHTML(words) + ')' : '') + '</div></div>'
    + '<div class="r-line">Rate of interest / risk-safety charges: <span class="ink">' + escapeHTML(p.rate) + '</span></div>'

    + '<div class="r-div"></div>'
    + '<div class="r-cols"><div class="r-colmain">'
    +   '<div class="r-line">Description of articles: <span class="ink">' + escapeHTML(p.articleDesc) + '</span></div>'
    +   '<div class="r-weights">'
    +     '<div class="wcell"><div class="wk">Gross Weight</div><div class="wv">' + escapeHTML(gross) + '</div></div>'
    +     '<div class="wcell"><div class="wk">Less &#8212; Tankam/Lakka/stone</div><div class="wv">' + escapeHTML(less) + '</div></div>'
    +     '<div class="wcell nett"><div class="wk">Nett Weight</div><div class="wv">' + escapeHTML(nettD) + '</div></div>'
    +   '</div>'
    +   '<div class="r-line">Market value of article: <span class="ink">' + (p.marketValue !== '' && p.marketValue != null ? '&#8377; ' + formatINR(p.marketValue) : '') + '</span></div>'
    + '</div><div class="r-photo">' + art + '</div></div>'

    + '<div class="r-div"></div>'
    + '<div class="r-line">Time agreed for redemption: <span class="r-six">SIX MONTHS</span>'
    +   (maturity ? ' &nbsp; <span class="ink sm">(Matures: ' + escapeHTML(maturity) + ')</span>' : '') + '</div>'
    + '<div class="r-note"><b>Note:</b> It is agreed that in case the pawner fails to redeem within six months, the pawn broker will be entitled to sell the pawned article or articles without notice to the pawner and credit the amount towards the debit.</div>'

    + '<div class="r-sigs">'
    +   '<div class="r-sig"><div class="r-sigbox">' + sP + '</div><div class="r-sigcap">Signature / Thumb of Pawner</div></div>'
    +   '<div class="r-sig"><div class="r-sigbox">' + sB + '</div><div class="r-sigcap">Signature of Pawn Broker / Agent</div></div>'
    + '</div>'
    + '<div class="r-received"><div class="r-recv">Received the above-mentioned articles in good condition.</div>'
    +   '<div class="r-sig small"><div class="r-sigbox">' + sF + '</div><div class="r-sigcap">Pawner Sign / Thumb</div></div></div>'
    + '</div>';
  return wrap;
}

function buildRedemptionSectionNode(rd, p, s) {
  const sec = document.createElement('div');
  sec.className = 'receipt';
  const redeemerPhoto = rd.redeemerPhoto
    ? '<img src="' + rd.redeemerPhoto + '" alt=""/>'
    : '<div class="r-ph">Redeemer Photo</div>';
  const aad = maskAadhaar(rd.redeemerAadhaar);
  const sR = rd.signRedeemer ? '<img src="' + rd.signRedeemer + '" alt=""/>' : '';
  const sB = rd.signBroker ? '<img src="' + rd.signBroker + '" alt=""/>' : '';
  const sF = rd.signFooter ? '<img src="' + rd.signFooter + '" alt=""/>' : '';
  const rdDate = fmtDate(rd.redeemedDate);
  sec.innerHTML =
    '<div class="r-frame">'
    + '<div class="r-redeem-hdr">&#8212; REDEMPTION RECORD &#8212;</div>'
    + '<div class="r-meta"><div><span class="rp">Pledge No:</span> <span class="ink">' + escapeHTML(p.pledgeNo) + '</span></div>'
    +   '<div>Date: <span class="ink">' + escapeHTML(rdDate) + '</span></div></div>'
    + '<div class="r-line">The above-mentioned article(s) have been redeemed on the above date.</div>'
    + '<div class="r-div"></div>'
    + '<div class="r-cols"><div class="r-colmain">'
    +   '<div class="r-fld">Name of Redeemer: <span class="ink u">' + escapeHTML(rd.redeemerName) + '</span></div>'
    +   '<div class="r-fld">Full Address: <span class="ink u">' + escapeHTML(rd.redeemerAddress) + '</span></div>'
    +   '<div class="r-fld">Aadhaar No: <span class="ink u">' + escapeHTML(aad) + '</span></div>'
    +   (rd.redeemerMobile ? '<div class="r-fld">Mobile No: <span class="ink u">' + escapeHTML(rd.redeemerMobile) + '</span></div>' : '')
    + '</div><div class="r-photo">' + redeemerPhoto + '</div></div>'
    + '<div class="r-div"></div>'
    + '<div class="r-sigs">'
    +   '<div class="r-sig"><div class="r-sigbox">' + sR + '</div><div class="r-sigcap">Signature / Thumb of Redeemer</div></div>'
    +   '<div class="r-sig"><div class="r-sigbox">' + sB + '</div><div class="r-sigcap">Signature of Pawn Broker / Agent</div></div>'
    + '</div>'
    + '<div class="r-received"><div class="r-recv">Articles delivered back in good condition.</div>'
    +   '<div class="r-sig small"><div class="r-sigbox">' + sF + '</div><div class="r-sigcap">Broker Sign</div></div></div>'
    + '</div>';
  return sec;
}
function buildCombinedReceiptNode(p, s) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:600px;background:#fff;';
  const pledgeNode = buildReceiptNode(p, s);
  pledgeNode.style.paddingBottom = '0';
  wrap.appendChild(pledgeNode);
  const redeemNode = buildRedemptionSectionNode(p.redemptionDetails, p, s);
  redeemNode.style.paddingTop = '8px';
  wrap.appendChild(redeemNode);
  return wrap;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image load failed'));
    im.src = src;
  });
}
async function renderReceiptBlob(p, s, scale) {
  scale = scale || 2;
  injectReceiptCSS();
  const node = buildReceiptNode(p, s);
  const stage = $('#renderStage');
  stage.innerHTML = '';
  stage.appendChild(node);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const w = node.offsetWidth, h = node.offsetHeight;
  const xml = new XMLSerializer().serializeToString(node);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
    + '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">'
    + '<div xmlns="http://www.w3.org/1999/xhtml"><style>' + RECEIPT_CSS + '</style>' + xml + '</div>'
    + '</foreignObject></svg>';
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  let img;
  try { img = await loadImage(url); }
  finally { /* keep stage until drawn for fonts; cleared below */ }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(img, 0, 0);
  stage.innerHTML = '';
  return await new Promise((res, rej) => {
    canvas.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/png');
  });
}

async function renderCombinedReceiptBlob(p, s, scale) {
  scale = scale || 2;
  injectReceiptCSS();
  const node = buildCombinedReceiptNode(p, s);
  const stage = $('#renderStage');
  stage.innerHTML = '';
  stage.appendChild(node);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const w = node.offsetWidth, h = node.offsetHeight;
  const xml = new XMLSerializer().serializeToString(node);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
    + '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">'
    + '<div xmlns="http://www.w3.org/1999/xhtml"><style>' + RECEIPT_CSS + '</style>' + xml + '</div>'
    + '</foreignObject></svg>';
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  let img;
  try { img = await loadImage(url); }
  finally {}
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(img, 0, 0);
  stage.innerHTML = '';
  return await new Promise((res, rej) => {
    canvas.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/png');
  });
}

/* ---------------- view state ---------------- */
let formState = { customerPhoto: null, articlePhoto: null };
let settingsState = { customLogo: null };
let pads = { pawner: null, broker: null, footer: null };
let redemptionFormState = { redeemerPhoto: null };
let redemptionPads = { redeemer: null, broker: null, footer: null };
let currentEditId = null;
let currentViewId = null;
let currentViewPledge = null;
let currentBlob = null;
let currentObjURL = null;
let homeCache = [];
let currentFilter = 'all';
let gUser = null;
let syncing = false;
let authMode = 'login';
let lastPullAt = (function () { try { return localStorage.getItem('ga_lastPull') || '1970-01-01T00:00:00Z'; } catch (e) { return '1970-01-01T00:00:00Z'; } })();

/* ---------------- Google auth + Drive sync ---------------- */
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
let gTokenClient = null, gAccessToken = null, gTokenExpiry = 0, driveFolderId = null;
function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
function whenGisReady(timeoutMs) {
  return new Promise(function (resolve) {
    if (gisReady()) return resolve(true);
    var start = Date.now();
    var t = setInterval(function () {
      if (gisReady()) { clearInterval(t); resolve(true); }
      else if (Date.now() - start > (timeoutMs || 6000)) { clearInterval(t); resolve(false); }
    }, 120);
  });
}
function initGoogle() {
  if (gTokenClient || !gisReady()) return;
  try {
    gTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE + ' email profile openid',
      callback: function () {}
    });
  } catch (e) { gTokenClient = null; }
}
function getAccessToken(interactive) {
  return new Promise(function (resolve, reject) {
    if (gAccessToken && Date.now() < gTokenExpiry - 60000) { resolve(gAccessToken); return; }
    if (!gTokenClient) { reject(new Error('google-not-ready')); return; }
    var settled = false, timer = null;
    function done(fn, arg) { if (settled) return; settled = true; if (timer) clearTimeout(timer); fn(arg); }
    gTokenClient.callback = function (resp) {
      if (resp && resp.access_token) {
        gAccessToken = resp.access_token;
        gTokenExpiry = Date.now() + ((resp.expires_in || 3600) * 1000);
        done(resolve, gAccessToken);
      } else { done(reject, new Error((resp && resp.error) || 'no-token')); }
    };
    gTokenClient.error_callback = function (err) { done(reject, new Error((err && err.type) || 'no-token')); };
    // A silent request must never hang the UI: if no session/consent, resolve to an error fast.
    if (!interactive) { timer = setTimeout(function () { done(reject, new Error('no-token')); }, 12000); }
    try { gTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' }); }
    catch (e) { done(reject, e); }
  });
}
async function fetchUserEmail(token) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    return j.email || '';
  } catch (e) { return ''; }
}
function setAuthError(msg, ok) {
  const el = $('#authError'); if (!el) return;
  el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  el.textContent = msg || '';
}
function showLogin() {
  gUser = null;
  showView('view-login', 'Sign in', false);
}
async function doGoogleSignIn() {
  setAuthError('');
  const btn = $('#googleSignInBtn'); const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; }
  try {
    const ready = await whenGisReady(6000);
    if (!ready) throw new Error('offline');
    initGoogle();
    const token = await getAccessToken(true);
    const email = await fetchUserEmail(token);
    await onSignedIn({ email: email });
  } catch (e) {
    if (e && e.message === 'offline') setAuthError('No internet — connect to sign in the first time.');
    else setAuthError('Sign-in was cancelled or failed. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}
async function manualSync() {
  if (!gUser) { doGoogleSignIn(); return; }
  try { await whenGisReady(4000); initGoogle(); await getAccessToken(false); toast('Syncing…'); syncAll(); }
  catch (e) { doGoogleSignIn(); }
}
async function doLogout() {
  try { if (gAccessToken && window.google && google.accounts.oauth2.revoke) google.accounts.oauth2.revoke(gAccessToken, function () {}); } catch (e) {}
  gAccessToken = null; gTokenExpiry = 0; gUser = null;
  location.hash = '';
  showLogin();
  toast('Logged out');
}
async function onSignedIn(user) {
  gUser = user;
  const uid = (user && user.email) || 'google-user';
  let prev = null;
  try { prev = localStorage.getItem('ga_userId'); } catch (e) {}
  if (prev && prev !== uid) {
    // Different Google account on this device — clear local so data never mixes.
    await dbClear('pledges');
    settings = Object.assign({}, DEFAULT_SETTINGS);
    await dbPut('settings', settings);
    driveFolderId = null;
    try { localStorage.removeItem('ga_driveFolder'); } catch (e) {}
  } else if (!prev) {
    // First sign-in on this device — keep pledges made before signing in, push them up.
    if (!settings.updatedAt) touchSettings();
  }
  try { localStorage.setItem('ga_userId', uid); } catch (e) {}
  try { driveFolderId = localStorage.getItem('ga_driveFolder') || null; } catch (e) {}
  await ensureSyncFields();
  const ae = $('#accountEmail'); if (ae) ae.textContent = 'Signed in: ' + uid;
  if (!location.hash || location.hash === '#' || location.hash === '#login') location.hash = 'home';
  else route();
  syncAll();
}
async function ensureSyncFields() {
  const all = await dbAll('pledges');
  for (const p of all) {
    let changed = false;
    if (!p.uid) { p.uid = uuid(); changed = true; }
    if (!p.updatedAt) { p.updatedAt = p.createdAt || Date.now(); changed = true; }
    if (p.pendingPush === undefined) { p.pendingPush = true; changed = true; }
    if (p.deleted === undefined) { p.deleted = false; changed = true; }
    if (changed) await dbPut('pledges', p);
  }
}
function touchSettings() { settings.updatedAt = Date.now(); settings.pendingPush = true; }
let syncTimer = null;
function syncAll() { if (syncTimer) clearTimeout(syncTimer); syncTimer = setTimeout(function () { _syncAll(); }, 350); }

// The actual Drive round-trip: token -> folder -> pull -> push. Throws on failure.
async function performSync() {
  await whenGisReady(5000);
  initGoogle();
  await getAccessToken(false);
  await ensureFolder();
  await syncPull();
  await syncPush();
}

// Silent background sync (no on-screen chip) — used on app focus, reconnect, settings save.
async function _syncAll() {
  if (!CLOUD_ENABLED || !gUser || !navigator.onLine || syncing) return;
  syncing = true;
  setSyncStatus('Saving to Google Drive…');
  try {
    await performSync();
    setSyncStatus('✅ Saved to Google Drive · ' + new Date().toLocaleTimeString());
    if ($('#view-home').classList.contains('active')) showHome();
  } catch (e) {
    reportSyncError(e);
  } finally {
    syncing = false;
  }
}

// Visible per-action save: shows the green "Saved to Google Drive" chip only on a real upload.
async function syncNow() {
  if (!CLOUD_ENABLED) return;
  if (!gUser) { showSyncChip('saved', 'Saved on this device'); return; }
  if (!navigator.onLine) { showSyncChip('error', 'Saved on device — will sync when online'); return; }
  showSyncChip('saving', 'Saving to Google Drive…');
  setSyncStatus('Saving to Google Drive…');
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  // Let any background sync already in flight finish first, then run ours.
  let waited = 0;
  while (syncing && waited < 10000) { await new Promise(function (r) { setTimeout(r, 150); }); waited += 150; }
  syncing = true;
  try {
    await performSync();
    showSyncChip('saved', 'Saved to Google Drive');
    setSyncStatus('✅ Saved to Google Drive · ' + new Date().toLocaleTimeString());
    if ($('#view-home').classList.contains('active')) showHome();
  } catch (e) {
    const m = (e && e.message) || '';
    if (m === 'google-not-ready' || m === 'no-token' || m.indexOf('interaction') >= 0) {
      showSyncChip('error', 'Saved on device — open Settings ▸ Sync to finish');
    } else {
      showSyncChip('error', 'Saved on device — will retry');
    }
    reportSyncError(e);
  } finally {
    syncing = false;
  }
}

function reportSyncError(e) {
  const m = (e && e.message) || '';
  if (m === 'google-not-ready' || m === 'no-token' || m.indexOf('interaction') >= 0 || m === 'offline') {
    setSyncStatus('⚠️ Reconnect needed — open Settings → "Sync / Reconnect".');
  } else {
    setSyncStatus('⚠️ Save failed — retrying in 30 s…');
    setTimeout(syncAll, 30000);
  }
  console.warn('sync error', e);
}

function setSyncStatus(t) { const el = $('#syncStatus'); if (el) el.textContent = t; }

// Small floating chip that confirms a save reached Google Drive (states: saving | saved | error).
function showSyncChip(state, msg) {
  const el = $('#syncChip');
  if (!el) return;
  const icon = state === 'saving' ? '<span class="sc-spin"></span>'
    : (state === 'saved' ? '<span class="sc-ok">✓</span>' : '<span class="sc-warn">!</span>');
  el.className = 'sync-chip show ' + state;
  el.innerHTML = icon + '<span>' + escapeHTML(msg) + '</span>';
  clearTimeout(showSyncChip._t);
  if (state !== 'saving') {
    showSyncChip._t = setTimeout(function () { el.classList.remove('show'); }, state === 'saved' ? 2600 : 4500);
  }
}
async function driveFetch(path, opts) {
  const token = await getAccessToken(false);
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  const r = await fetch('https://www.googleapis.com/' + path, opts);
  if (!r.ok) throw new Error('drive-' + r.status);
  return r;
}
function qEsc(s) { return String(s).replace(/'/g, "\\'"); }
async function ensureFolder() {
  if (driveFolderId) return driveFolderId;
  const q = "mimeType='application/vnd.google-apps.folder' and name='" + qEsc(APP_FOLDER_NAME) + "' and trashed=false";
  const r = await driveFetch('drive/v3/files?spaces=drive&fields=' + encodeURIComponent('files(id,name)') + '&q=' + encodeURIComponent(q));
  const j = await r.json();
  if (j.files && j.files.length) driveFolderId = j.files[0].id;
  else {
    const cr = await driveFetch('drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) });
    const cj = await cr.json(); driveFolderId = cj.id;
  }
  try { localStorage.setItem('ga_driveFolder', driveFolderId); } catch (e) {}
  return driveFolderId;
}
async function driveFindFile(name) {
  const q = "name='" + qEsc(name) + "' and '" + driveFolderId + "' in parents and trashed=false";
  const r = await driveFetch('drive/v3/files?spaces=drive&orderBy=modifiedTime desc&fields=' + encodeURIComponent('files(id,name,modifiedTime)') + '&q=' + encodeURIComponent(q));
  const j = await r.json();
  return (j.files && j.files[0]) || null;
}
async function driveUploadJSON(name, content, existingId) {
  const meta = { name: name };
  if (!existingId) meta.parents = [driveFolderId];
  const boundary = 'gab' + Date.now();
  const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + content + '\r\n--' + boundary + '--';
  const method = existingId ? 'PATCH' : 'POST';
  const path = existingId ? ('upload/drive/v3/files/' + existingId + '?uploadType=multipart&fields=id') : ('upload/drive/v3/files?uploadType=multipart&fields=id');
  const r = await driveFetch(path, { method: method, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body });
  return await r.json();
}
async function driveDownloadJSON(fileId) {
  const r = await driveFetch('drive/v3/files/' + fileId + '?alt=media');
  return await r.json();
}
async function driveDelete(fileId) {
  try { await driveFetch('drive/v3/files/' + fileId, { method: 'DELETE' }); } catch (e) {}
}
async function driveListBackups() {
  await getAccessToken(false); await ensureFolder();
  const q = "'" + driveFolderId + "' in parents and trashed=false and name contains 'Backup-'";
  const r = await driveFetch('drive/v3/files?spaces=drive&orderBy=name desc&fields=' + encodeURIComponent('files(id,name,modifiedTime)') + '&q=' + encodeURIComponent(q));
  const j = await r.json();
  return j.files || [];
}
async function syncPush() {
  const localAll = await dbAll('pledges');
  const dirty = localAll.some(function (p) { return p.pendingPush; }) || settings.pendingPush;
  if (!dirty) return;
  const dataset = JSON.stringify({ app: 'ga-pledge', version: 2, updatedAt: Date.now(), pledges: localAll, settings: settings });
  const main = await driveFindFile(DATA_FILE_NAME);
  await driveUploadJSON(DATA_FILE_NAME, dataset, main ? main.id : null);
  const snapName = 'Backup-' + todayISO() + '.json';
  const snap = await driveFindFile(snapName);
  await driveUploadJSON(snapName, dataset, snap ? snap.id : null);
  // Both uploads confirmed — stamp time and persist settings exactly once.
  settings.lastBackupAt = Date.now();
  settings.pendingPush = false;
  await persistSettings(true);
  // Keep the Drive folder tiny — one always-current file + a few recent dated snapshots.
  try {
    const KEEP = 3;
    const backups = await driveListBackups(); // newest first
    for (let i = KEEP; i < backups.length; i++) { await driveDelete(backups[i].id); }
  } catch (e) {}
  // Clear pledge flags — re-fetch each record so a concurrent edit made during the upload
  // is never silently overwritten by the stale snapshot taken at the start of this function.
  for (const p of localAll) {
    if (!p.pendingPush) continue;
    const fresh = await dbGet('pledges', p.id);
    if (!fresh) continue;
    if (fresh.updatedAt === p.updatedAt) {
      // Record unchanged during upload — safe to mark as synced.
      fresh.pendingPush = false;
      await dbPut('pledges', fresh);
    }
    // If updatedAt differs the user edited during the upload — leave pendingPush:true
    // so the next sync cycle picks it up and sends the new version.
  }
}
async function syncPull() {
  const f = await driveFindFile(DATA_FILE_NAME);
  if (!f) return;
  let remote;
  try { remote = await driveDownloadJSON(f.id); } catch (e) { return; }
  if (!remote || !Array.isArray(remote.pledges)) return;
  const localAll = await dbAll('pledges');
  const byUid = {};
  localAll.forEach(function (p) { if (p.uid) byUid[p.uid] = p; });
  for (const r of remote.pledges) {
    if (!r.uid) continue;
    const local = byUid[r.uid];
    if (!local) {
      if (r.deleted) continue;
      const obj = Object.assign({}, r); delete obj.id; obj.pendingPush = false;
      await dbPut('pledges', obj);
    } else if ((r.updatedAt || 0) > (local.updatedAt || 0)) {
      if (r.deleted) { await dbDel('pledges', local.id); }
      else { const obj = Object.assign({}, r); obj.id = local.id; obj.pendingPush = false; await dbPut('pledges', obj); }
    }
  }
  if (remote.settings && (remote.settings.updatedAt || 0) > (settings.updatedAt || 0) && !settings.pendingPush) {
    settings = Object.assign({}, DEFAULT_SETTINGS, remote.settings, { key: 'app' });
    await dbPut('settings', settings);
    applySettingsToBar();
  }
}
/* ---------------- navigation ---------------- */
function nav(hash) { location.hash = hash; }
function navReplace(hash) {
  history.replaceState(null, '', location.pathname + location.search + '#' + hash);
  route();
}
function showView(id, title, back) {
  $$('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (title != null) $('#barTitle').innerHTML = escapeHTML(title);
  $('#backBtn').style.display = back ? 'block' : 'none';
  const home = id === 'view-home';
  $('#settingsBtn').style.display = home ? 'flex' : 'none';
  $('#newBtn').style.display = home ? 'flex' : 'none';
  window.scrollTo(0, 0);
}
function applySettingsToBar() {
  if ($('#view-home').classList.contains('active')) {
    $('#barTitle').innerHTML = escapeHTML(settings.shopName || 'Pledge Book') + '<small>' + escapeHTML(settings.shopSub || '') + '</small>';
  }
}

/* ---------------- HOME ---------------- */
async function showHome() {
  showView('view-home', null, false);
  $('#barTitle').innerHTML = escapeHTML(settings.shopName || 'Pledge Book') + '<small>' + escapeHTML(settings.shopSub || '') + '</small>';
  const all = await dbAll('pledges');
  homeCache = all.filter(function (p) { return !p.deleted; })
    .sort((a, b) => (Number(b.pledgeNo) || 0) - (Number(a.pledgeNo) || 0) || (b.createdAt - a.createdAt));
  renderList();
  renderReminderBanner();
}
function cardHTML(p) {
  const thumb = p.customerPhoto ? '<img class="thumb" src="' + p.customerPhoto + '"/>'
    : (p.articlePhoto ? '<img class="thumb" src="' + p.articlePhoto + '"/>' : '<div class="thumb">&#128141;</div>');
  const amt = (p.principal !== '' && p.principal != null) ? '&#8377;' + formatINR(p.principal) : '&#8212;';
  const mat = p.date ? 'Matures ' + addMonthsISO(p.date, 6) : '';
  const badge = p.status === 'redeemed' ? '<span class="badge redeemed">Redeemed</span>' : '<span class="badge active">Active</span>';
  const di = dueInfo(p, reminderWindow());
  const dueBadge = di ? (di.kind === 'overdue'
      ? '<span class="badge overdue">Overdue ' + di.days + 'd</span>'
      : '<span class="badge duesoon">Due in ' + di.days + 'd</span>') : '';
  return '<div class="card" data-id="' + p.id + '">' + thumb + '<div class="info">'
    + '<div class="row1"><span class="name">' + escapeHTML(p.pawnerName || '(no name)') + '</span><span class="pno">#' + escapeHTML(String(p.pledgeNo || '—')) + '</span></div>'
    + '<div class="sub"><span class="amt">' + amt + '</span><span>' + dueBadge + ' ' + badge + '</span></div>'
    + '<div class="sub"><span>' + (p.date ? fmtDate(p.date) : '') + '</span><span>' + mat + '</span></div>'
    + '</div></div>';
}
function renderList() {
  const q = ($('#searchInput').value || '').toLowerCase().trim();
  const win = reminderWindow();
  const list = homeCache.filter((p) => {
    if (currentFilter === 'due') { if (!dueInfo(p, win)) return false; }
    else if (currentFilter !== 'all' && p.status !== currentFilter) return false;
    if (!q) return true;
    const hay = [p.pledgeNo, p.pawnerName, p.mobile, p.date, fmtDate(p.date),
      (p.redemptionDetails && p.redemptionDetails.redeemerMobile) || ''].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  const el = $('#pledgeList');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="big">&#128210;</div><div>' +
      (homeCache.length ? 'No matching pledges.' : 'No pledges yet.') +
      '</div><div style="font-size:13px;margin-top:6px">Tap &ldquo;New Pledge&rdquo; to add one.</div></div>';
    return;
  }
  el.innerHTML = list.map(cardHTML).join('');
  $$('[data-id]', el).forEach((c) => { c.onclick = () => nav('view-' + c.dataset.id); });
}

/* ---------------- reminders ---------------- */
function reminderCounts() {
  const win = reminderWindow();
  let overdue = 0, due = 0;
  homeCache.forEach(function (p) { const i = dueInfo(p, win); if (i) { if (i.kind === 'overdue') overdue++; else due++; } });
  return { overdue: overdue, due: due };
}
function setFilter(f) {
  currentFilter = f;
  $$('.chip').forEach(function (x) { x.classList.toggle('active', x.dataset.filter === f); });
  renderList();
}
function renderReminderBanner() {
  const el = $('#reminderBanner');
  if (!el) return;
  const c = reminderCounts();
  if (c.overdue + c.due === 0) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  const parts = [];
  if (c.overdue) parts.push('🔴 <b>' + c.overdue + '</b> overdue');
  if (c.due) parts.push('🟠 <b>' + c.due + '</b> due soon');
  const needPerm = ('Notification' in window) && Notification.permission === 'default';
  el.innerHTML = '<div class="reminder-card"><span>' + parts.join(' &nbsp;·&nbsp; ') + '</span>'
    + '<a class="rb-view" data-due>View</a>'
    + (needPerm ? '<a class="rb-enable" data-enable>Turn on alerts</a>' : '')
    + '</div>';
  const v = $('[data-due]', el); if (v) v.onclick = function () { setFilter('due'); };
  const en = $('[data-enable]', el); if (en) en.onclick = enableAlerts;
}
function showLocalNotification(overdue, due) {
  const parts = [];
  if (overdue) parts.push(overdue + ' overdue');
  if (due) parts.push(due + ' due soon');
  const body = parts.join(' · ') + ' — tap to review pledges.';
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.showNotification) reg.showNotification('Pledge reminders', { body: body, icon: './icon.svg', badge: './icon.svg', tag: 'ga-due', renotify: true });
        else if (window.Notification) new Notification('Pledge reminders', { body: body, icon: './icon.svg' });
      });
    } else if (window.Notification) {
      new Notification('Pledge reminders', { body: body, icon: './icon.svg' });
    }
  } catch (e) {}
}
async function checkReminders() {
  try {
    const win = reminderWindow();
    const all = await dbAll('pledges');
    let overdue = 0, due = 0;
    all.forEach(function (p) { const i = dueInfo(p, win); if (i) { if (i.kind === 'overdue') overdue++; else due++; } });
    if (overdue + due > 0 && ('Notification' in window) && Notification.permission === 'granted') {
      const today = todayISO();
      let last = null; try { last = localStorage.getItem('ga_lastNotify'); } catch (e) {}
      if (last !== today) {
        showLocalNotification(overdue, due);
        try { localStorage.setItem('ga_lastNotify', today); } catch (e) {}
      }
    }
  } catch (e) {}
}
function updateAlertStatus() {
  const el = $('#alertStatus');
  if (!el) return;
  if (!('Notification' in window)) { el.textContent = 'This device does not support phone alerts.'; el.style.color = ''; return; }
  const p = Notification.permission;
  if (p === 'granted') { el.textContent = '✅ Phone alerts are ON.'; el.style.color = '#1c7c3c'; }
  else if (p === 'denied') { el.textContent = '⚠️ Alerts are blocked — turn them on in your browser settings.'; el.style.color = '#b5202a'; }
  else { el.textContent = 'Alerts are off — tap below to turn them on.'; el.style.color = '#6b6b6b'; }
}
async function enableAlerts() {
  if (!('Notification' in window)) { toast('This device does not support alerts'); return; }
  let perm;
  try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
  updateAlertStatus();
  renderReminderBanner();
  if (perm === 'granted') { await maybeRegisterPeriodicSync(); checkReminders(); toast('Alerts turned on'); }
  else if (perm === 'denied') { toast('Alerts are blocked in browser settings'); }
}
async function maybeRegisterPeriodicSync() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!navigator.serviceWorker) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !('periodicSync' in reg)) return;
    let st = { state: 'granted' };
    try { st = await navigator.permissions.query({ name: 'periodic-background-sync' }); } catch (e) {}
    if (st.state === 'granted') {
      try { await reg.periodicSync.register('ga-due-check', { minInterval: 24 * 60 * 60 * 1000 }); } catch (e) {}
    }
  } catch (e) {}
}

/* ---------------- FORM ---------------- */
function updateWords() {
  const w = numToWordsIndian($('#f-principal').value);
  $('#f-words').textContent = w ? '(' + w + ')' : '';
}
function updateNett() {
  const n = computeNett($('#f-gross').value, $('#f-less').value);
  $('#f-nett').value = n ? n + ' g' : '';
}
function updateMaturity() {
  const d = $('#f-date').value;
  $('#f-maturity').textContent = d ? addMonthsISO(d, 6) : '—';
}
async function showForm(id) {
  currentEditId = id || null;
  formState = { customerPhoto: null, articlePhoto: null };
  let p;
  if (id) {
    p = await dbGet('pledges', id);
    if (!p) { toast('Pledge not found'); nav('home'); return; }
  } else {
    p = { pledgeNo: settings.nextPledgeNo || '', date: todayISO(), status: 'active' };
  }
  $('#f-pledgeNo').value = p.pledgeNo == null ? '' : p.pledgeNo;
  $('#f-date').value = p.date || '';
  $('#f-name').value = p.pawnerName || '';
  $('#f-mobile').value = p.mobile || '';
  $('#f-address').value = p.pawnerAddress || '';
  $('#f-aadhaar').value = p.aadhaar || '';
  $('#f-principal').value = p.principal == null ? '' : p.principal;
  $('#f-rate').value = p.rate || '';
  $('#f-desc').value = p.articleDesc || '';
  $('#f-gross').value = p.gross == null ? '' : p.gross;
  $('#f-less').value = p.less == null ? '' : p.less;
  $('#f-market').value = p.marketValue == null ? '' : p.marketValue;
  formState.customerPhoto = p.customerPhoto || null;
  formState.articlePhoto = p.articlePhoto || null;

  const scope = $('#view-form');
  initPhotoFields(scope, formState);
  setPhotoPreview($('[data-key="customerPhoto"]', scope), formState.customerPhoto);
  setPhotoPreview($('[data-key="articlePhoto"]', scope), formState.articlePhoto);
  updateWords(); updateNett(); updateMaturity();

  showView('view-form', id ? 'Edit Pledge' : 'New Pledge', true);

  // signature pads need layout to exist first
  pads.pawner = new SignaturePad($('#pad-pawner'));
  pads.broker = new SignaturePad($('#pad-broker'));
  pads.footer = new SignaturePad($('#pad-footer'));
  if (p.signPawner) pads.pawner.loadDataURL(p.signPawner);
  if (p.signBroker) pads.broker.loadDataURL(p.signBroker);
  if (p.signFooter) pads.footer.loadDataURL(p.signFooter);
}
async function saveForm() {
  const pledgeNo = numOrEmpty($('#f-pledgeNo').value);
  const p = {
    pledgeNo: pledgeNo,
    date: $('#f-date').value || '',
    pawnerName: $('#f-name').value.trim(),
    mobile: $('#f-mobile').value.trim(),
    pawnerAddress: $('#f-address').value.trim(),
    aadhaar: $('#f-aadhaar').value.replace(/\D/g, ''),
    customerPhoto: formState.customerPhoto || null,
    principal: numOrEmpty($('#f-principal').value),
    rate: $('#f-rate').value.trim(),
    articleDesc: $('#f-desc').value.trim(),
    gross: numOrEmpty($('#f-gross').value),
    less: numOrEmpty($('#f-less').value),
    marketValue: numOrEmpty($('#f-market').value),
    articlePhoto: formState.articlePhoto || null,
    signPawner: pads.pawner ? pads.pawner.dataURL() : null,
    signBroker: pads.broker ? pads.broker.dataURL() : null,
    signFooter: pads.footer ? pads.footer.dataURL() : null
  };
  if (currentEditId) {
    const ex = await dbGet('pledges', currentEditId);
    p.id = currentEditId;
    p.uid = (ex && ex.uid) ? ex.uid : uuid();
    p.createdAt = ex ? ex.createdAt : Date.now();
    p.status = ex ? ex.status : 'active';
  } else {
    p.uid = uuid();
    p.createdAt = Date.now();
    p.status = 'active';
  }
  p.updatedAt = Date.now();
  p.pendingPush = true;
  p.deleted = false;
  let savedId;
  try {
    const key = await dbPut('pledges', p);
    savedId = currentEditId || key;
  } catch (e) {
    toast('Could not save');
    return;
  }
  const pn = parseInt(pledgeNo, 10);
  if (!isNaN(pn) && pn >= (parseInt(settings.nextPledgeNo, 10) || 0)) {
    settings.nextPledgeNo = pn + 1;
    touchSettings();
    await persistSettings(true);
  }
  toast('Pledge saved');
  syncNow();
  navReplace('view-' + savedId);
}

/* ---------------- REDEMPTION FORM ---------------- */
async function showRedemptionForm(id) {
  const p = await dbGet('pledges', id);
  if (!p) { toast('Pledge not found'); nav('home'); return; }
  currentViewId = id; currentViewPledge = p;
  redemptionFormState = { redeemerPhoto: null };
  $('#r-date').value = todayISO();
  $('#r-name').value = p.pawnerName || '';
  $('#r-mobile').value = p.mobile || '';
  $('#r-address').value = p.pawnerAddress || '';
  $('#r-aadhaar').value = '';
  const scope = $('#view-redeem');
  initPhotoFields(scope, redemptionFormState);
  setPhotoPreview($('[data-key="redeemerPhoto"]', scope), null);
  showView('view-redeem', 'Redemption — #' + (p.pledgeNo || ''), true);
  redemptionPads.redeemer = new SignaturePad($('#rpad-redeemer'));
  redemptionPads.broker = new SignaturePad($('#rpad-broker'));
  redemptionPads.footer = new SignaturePad($('#rpad-footer'));
}
async function saveRedemptionForm() {
  const p = currentViewPledge;
  if (!p) { toast('Error'); nav('home'); return; }
  const rd = {
    redeemedDate: $('#r-date').value || todayISO(),
    redeemerName: $('#r-name').value.trim(),
    redeemerMobile: $('#r-mobile').value.trim(),
    redeemerAddress: $('#r-address').value.trim(),
    redeemerAadhaar: $('#r-aadhaar').value.replace(/\D/g, ''),
    redeemerPhoto: redemptionFormState.redeemerPhoto || null,
    signRedeemer: redemptionPads.redeemer ? redemptionPads.redeemer.dataURL() : null,
    signBroker: redemptionPads.broker ? redemptionPads.broker.dataURL() : null,
    signFooter: redemptionPads.footer ? redemptionPads.footer.dataURL() : null,
    redeemedAt: Date.now()
  };
  p.status = 'redeemed';
  p.redemptionDetails = rd;
  p.updatedAt = Date.now();
  p.pendingPush = true;
  await dbPut('pledges', p);
  toast('Pledge redeemed');
  syncNow();
  navReplace('view-' + p.id);
}

/* ---------------- RECEIPT VIEW ---------------- */
function setRedeemBtn(p) {
  const rb = $('#redeemBtn');
  if (p.status === 'redeemed') { rb.classList.add('is-redeemed'); rb.innerHTML = '&#8634; Mark Active'; }
  else { rb.classList.remove('is-redeemed'); rb.innerHTML = '&#10003; Redeemed'; }
  $('#receiptStatus').innerHTML = p.status === 'redeemed'
    ? '<span class="badge redeemed">Redeemed</span>' : '<span class="badge active">Active</span>';
}
async function showReceipt(id) {
  const p = await dbGet('pledges', id);
  if (!p) { toast('Pledge not found'); nav('home'); return; }
  currentViewId = id; currentViewPledge = p; currentBlob = null;
  showView('view-receipt', 'Pledge #' + (p.pledgeNo || ''), true);
  setRedeemBtn(p);
  $('#receiptImg').removeAttribute('src');
  try {
    const blob = (p.status === 'redeemed' && p.redemptionDetails)
      ? await renderCombinedReceiptBlob(p, settings, 2)
      : await renderReceiptBlob(p, settings, 2);
    currentBlob = blob;
    if (currentObjURL) URL.revokeObjectURL(currentObjURL);
    currentObjURL = URL.createObjectURL(blob);
    $('#receiptImg').src = currentObjURL;
  } catch (err) {
    console.error('render error', err);
    toast('Could not render receipt image');
  }
}
async function doShare() {
  if (!currentBlob) { toast('Please wait a moment…'); return; }
  const name = 'Pledge_' + (currentViewPledge.pledgeNo || currentViewId);
  const file = new File([currentBlob], name + '.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      downloadBlob(currentBlob, name + '.png');
      toast('Image saved — attach it in WhatsApp');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    downloadBlob(currentBlob, name + '.png');
  }
}
function doPrint() {
  if (!currentObjURL) { toast('Please wait a moment…'); return; }
  const pi = $('#printImg');
  pi.src = currentObjURL;
  setTimeout(() => { window.print(); }, 250);
}
async function toggleRedeem() {
  const p = currentViewPledge;
  if (p.status === 'redeemed') {
    p.status = 'active';
    p.updatedAt = Date.now();
    p.pendingPush = true;
    await dbPut('pledges', p);
    setRedeemBtn(p);
    toast('Marked active');
    syncNow();
  } else {
    nav('redeem-' + p.id);
  }
}
async function doDelete() {
  if (!window.confirm('Delete this pledge permanently? This cannot be undone.')) return;
  const p = currentViewPledge;
  if (CLOUD_ENABLED && p) {
    p.deleted = true;
    p.updatedAt = Date.now();
    p.pendingPush = true;
    await dbPut('pledges', p);
    syncAll();
  } else {
    await dbDel('pledges', currentViewId);
  }
  toast('Pledge deleted');
  nav('home');
}

/* ---------------- SETTINGS ---------------- */
async function showSettings() {
  showView('view-settings', 'Settings', true);
  const s = settings;
  $('#s-shopName').value = s.shopName || '';
  $('#s-shopSub').value = s.shopSub || '';
  $('#s-address').value = s.address || '';
  $('#s-licenseName').value = s.licenseName || '';
  $('#s-licenseCity').value = s.licenseCity || '';
  $('#s-licenseNo').value = s.licenseNo || '';
  $('#s-brokerName').value = s.brokerName || '';
  $('#s-brokerNoDate').value = s.brokerNoDate || '';
  $('#s-nextPledgeNo').value = s.nextPledgeNo == null ? '' : s.nextPledgeNo;
  $('#s-reminderDays').value = s.reminderDays == null ? 7 : s.reminderDays;
  settingsState = { customLogo: s.customLogo || null };
  const scope = $('#view-settings');
  initPhotoFields(scope, settingsState);
  setPhotoPreview($('[data-key="customLogo"]', scope), settingsState.customLogo);
  updateAlertStatus();
}
async function saveSettingsFromForm() {
  settings.shopName = $('#s-shopName').value.trim();
  settings.shopSub = $('#s-shopSub').value.trim();
  settings.address = $('#s-address').value.trim();
  settings.licenseName = $('#s-licenseName').value.trim();
  settings.licenseCity = $('#s-licenseCity').value.trim();
  settings.licenseNo = $('#s-licenseNo').value.trim();
  settings.brokerName = $('#s-brokerName').value.trim();
  settings.brokerNoDate = $('#s-brokerNoDate').value.trim();
  const np = parseInt($('#s-nextPledgeNo').value, 10);
  settings.nextPledgeNo = isNaN(np) ? (settings.nextPledgeNo || 1) : np;
  const rd = parseInt($('#s-reminderDays').value, 10);
  settings.reminderDays = isNaN(rd) ? 7 : Math.max(0, rd);
  settings.customLogo = settingsState.customLogo || null;
  touchSettings();
  await persistSettings(true);
  syncAll();
  toast('Settings saved');
  nav('home');
}
/* ---------------- wiring ---------------- */
function wireHandlers() {
  $('#newBtn').onclick = () => nav('new');
  $('#settingsBtn').onclick = () => nav('settings');
  $('#backBtn').onclick = () => { if (history.length > 1) history.back(); else nav('home'); };

  $('#searchInput').oninput = renderList;
  $$('.chip').forEach((c) => {
    c.onclick = () => {
      $$('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      currentFilter = c.dataset.filter;
      renderList();
    };
  });

  $('#f-principal').oninput = updateWords;
  $('#f-gross').oninput = updateNett;
  $('#f-less').oninput = updateNett;
  $('#f-date').onchange = updateMaturity;
  $('#cancelFormBtn').onclick = () => nav('home');
  $('#saveFormBtn').onclick = saveForm;
  $$('[data-clear]').forEach((b) => {
    b.onclick = () => { const k = b.dataset.clear; if (pads[k]) pads[k].clear(); };
  });

  $('#cancelRedeemBtn').onclick = () => { if (currentViewId) navReplace('view-' + currentViewId); else nav('home'); };
  $('#saveRedeemBtn').onclick = saveRedemptionForm;
  $$('[data-rclear]').forEach((b) => {
    b.onclick = () => { const k = b.dataset.rclear; if (redemptionPads[k]) redemptionPads[k].clear(); };
  });

  $('#shareBtn').onclick = doShare;
  $('#printBtn').onclick = doPrint;
  $('#editBtn').onclick = () => nav('edit-' + currentViewId);
  $('#redeemBtn').onclick = toggleRedeem;
  $('#deleteBtn').onclick = doDelete;

  $('#saveSettingsBtn').onclick = saveSettingsFromForm;
  $('#enableAlertsBtn').onclick = enableAlerts;
}

/* ---------------- router ---------------- */
function route() {
  if (CLOUD_ENABLED && !gUser) { showLogin(); return; }
  const h = (location.hash || '#home').slice(1) || 'home';
  if (h === 'home') showHome();
  else if (h === 'new') showForm(null);
  else if (h.indexOf('edit-') === 0) showForm(Number(h.slice(5)));
  else if (h.indexOf('view-') === 0) showReceipt(Number(h.slice(5)));
  else if (h.indexOf('redeem-') === 0) showRedemptionForm(Number(h.slice(7)));
  else if (h === 'settings') showSettings();
  else showHome();
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function wireAuthHandlers() {
  const gb = $('#googleSignInBtn'); if (gb) gb.onclick = doGoogleSignIn;
  const lo = $('#logoutBtn'); if (lo) lo.onclick = doLogout;
  const sn = $('#syncNowBtn'); if (sn) sn.onclick = manualSync;
}

async function init() {
  injectReceiptCSS();
  // Ask the browser to keep our data safe from automatic eviction.
  try { if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); } } catch (e) {}
  try { settings = await loadSettings(); } catch (e) { settings = Object.assign({}, DEFAULT_SETTINGS); }
  wireHandlers();
  wireAuthHandlers();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', function () { syncAll(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && gUser) syncAll();
  });
  registerSW();
  setTimeout(function () { checkReminders(); maybeRegisterPeriodicSync(); }, 1500);
  if (!CLOUD_ENABLED) {
    const ag = $('#accountGroup'); if (ag) ag.style.display = 'none';
    route();
    return;
  }
  whenGisReady(8000).then(function () { initGoogle(); });
  let storedUser = null;
  try { storedUser = localStorage.getItem('ga_userId'); } catch (e) {}
  if (storedUser) onSignedIn({ email: storedUser });
  else showLogin();
}
document.addEventListener('DOMContentLoaded', init);
})();
