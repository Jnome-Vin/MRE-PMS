// ผังแบบปรับได้: รูปแบบแปลน (พื้นหลัง) + กรอบของแต่ละหน่วยเช่า วางทับด้วยตำแหน่งเป็น % ของรูป
// เก็บที่ settings / id = 'layout' (ซิงก์ทุกเครื่องเหมือนข้อมูลอื่น)
//   { id:'layout', fileStamp, floors: { '1': { name, image, ratio, boxes: { '101': [x,y,w,h] หรือ [x,y,w,h,องศา] }, notes: [{ text, box:[x,y,w,h] }] } } }
//   image = 'photo:<id>' (อัปโหลดจากในแอป) หรือ path ในโฟลเดอร์ app เช่น 'layout/floor-1.jpg' (Claude Desktop สร้างให้)
// ไฟล์ app/layout/layout.json: ถ้ามี และ updatedAt ใหม่กว่าที่เคยนำเข้า แอปจะนำเข้าอัตโนมัติตอนเปิด (ดู CLAUDE.md)
import * as db from './db.js';
import * as api from './api.js';
import { isServerMode } from './config.js';

export const get = () => db.get('settings', 'layout') || { id: 'layout', floors: {} };
export const floorOf = f => get().floors?.[String(f)] || null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
// กรอบ = [ซ้าย, บน, กว้าง, สูง] เป็น % · ค่าที่ 5 (ไม่บังคับ) = องศาที่หมุนตามเข็มนาฬิกา สำหรับอาคารที่วางเอียง
const box = b => Array.isArray(b) && (b.length === 4 || b.length === 5) ? [clamp(b[0], -20, 99), clamp(b[1], -20, 99), clamp(b[2], 1, 100), clamp(b[3], 1, 100), ...(Number(b[4]) ? [clamp(b[4], -180, 180)] : [])] : null;

// ตรวจและทำความสะอาดข้อมูลผัง (ใช้กับไฟล์ที่นำเข้า — ไฟล์อาจเขียนด้วยมือหรือโดย Claude)
export function normalize(src) {
  const floors = {};
  for (const [f, c] of Object.entries(src?.floors || {})) {
    if (!c || typeof c !== 'object') continue;
    const boxes = {};
    for (const [id, b] of Object.entries(c.boxes || {})) { const v = box(b); if (v) boxes[String(id)] = v; }
    floors[String(f)] = { name: String(c.name || ''), image: String(c.image || ''), ratio: clamp(c.ratio || 1.6, 0.3, 5), boxes,
      notes: (c.notes || []).map(n => ({ text: String(n.text || ''), box: box(n.box) })).filter(n => n.box && n.text) };
  }
  return floors;
}

export async function save(floors) {
  await db.put('settings', { id: 'layout', floors: normalize({ floors }), fileStamp: new Date().toISOString() });
}

// นำเข้า app/layout/layout.json ถ้าใหม่กว่าผังที่มีอยู่ (เครื่องที่ซิงก์ครั้งแรกจะใช้ของ server แทนตามกติกา sync)
export async function loadFile() {
  try {
    const r = await fetch('layout/layout.json', { cache: 'no-cache' });
    if (!r.ok) return false;
    const j = await r.json();
    if (!j?.floors || !j.updatedAt) return false;
    const cur = db.get('settings', 'layout');
    if (cur && String(cur.fileStamp || '') >= String(j.updatedAt)) return false;
    await db.put('settings', { id: 'layout', floors: normalize(j), fileStamp: String(j.updatedAt) });
    return true;
  } catch { return false; }
}

const cache = new Map();
export async function imageSrc(image) {
  if (!image) return '';
  if (!image.startsWith('photo:')) return /^(layout|assets)\/[\w./-]+$/.test(image) && !image.includes('..') ? image : '';
  const id = image.slice(6);
  if (cache.has(id)) return cache.get(id);
  let p = await db.getPhoto(id);
  if (!p && isServerMode()) {
    try { const r = await api.call('getPhoto', { id }); p = { id, dataUrl: r.dataUrl, driveId: r.fileId, name: r.name }; await db.putPhoto(p); } catch {}
  }
  if (p?.dataUrl) cache.set(id, p.dataUrl);
  return p?.dataUrl || '';
}

export async function storeImage(floor, dataUrl) {
  const id = `layout-${floor}-${Date.now().toString(36)}`;
  await db.putPhoto({ id, dataUrl, name: `ผัง-${floor}.jpg`, createdAt: new Date().toISOString() });
  if (isServerMode()) await db.queue({ kind: 'photo', photoId: id, folder: 'layout' });
  cache.set(id, dataUrl);
  return 'photo:' + id;
}

// PDF หน้าแรก → รูป (โหลด pdf.js เมื่อใช้ครั้งแรก ต้องออนไลน์)
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
// โหลด pdf.js ครั้งเดียว · worker ต้องสร้างจาก blob ในโดเมนของแอป (เบราว์เซอร์ไม่ยอมเปิด worker ข้ามโดเมนตรง ๆ แล้วค้าง)
let pdfReady = null;
function loadPdfJs() {
  return pdfReady ||= (async () => {
    if (!window.pdfjsLib) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('โหลดตัวอ่าน PDF ไม่ได้ (ต้องต่ออินเทอร์เน็ต)')); document.head.appendChild(s); });
    const src = await fetch(PDFJS + 'pdf.worker.min.js').then(r => { if (!r.ok) throw new Error('โหลดตัวอ่าน PDF ไม่ได้'); return r.text(); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    return window.pdfjsLib;
  })().catch(e => { pdfReady = null; throw e; });
}
export async function pdfToImage(file, max = 1800) {
  await loadPdfJs();
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1), v0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: max / Math.max(v0.width, v0.height) });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  return c.toDataURL('image/jpeg', 0.85);
}

// PDF ทุกหน้า (ไม่เกิน limit หน้า) → รูป JPEG ทีละหน้า · ใช้กับเอกสารแนบ เช่น หนังสือรับรองบริษัท (เก็บเป็นรูปเหมือนรูปบัตร)
export async function pdfPages(file, max = 1600, limit = 6) {
  await loadPdfJs();
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, out = [];
  for (let n = 1; n <= Math.min(pdf.numPages, limit); n++) {
    const page = await pdf.getPage(n), v0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: max / Math.max(v0.width, v0.height) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    out.push(c.toDataURL('image/jpeg', 0.82));
  }
  return { pages: out, total: pdf.numPages };
}

// จัดกรอบอัตโนมัติเป็นตาราง สำหรับหน่วยเช่าที่ยังไม่มีตำแหน่ง
export function autoBoxes(ids, ratio = 1.6) {
  const n = ids.length; if (!n) return {};
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * ratio)))), rows = Math.ceil(n / cols);
  const gw = 100 / cols, gh = 100 / rows, out = {};
  ids.forEach((id, i) => { out[id] = [(i % cols) * gw + gw * 0.05, Math.floor(i / cols) * gh + gh * 0.07, gw * 0.9, gh * 0.86].map(v => Math.round(v * 10) / 10); });
  return out;
}
