// ฐานข้อมูลในเครื่อง (IndexedDB) — ทำงานได้แม้ไม่มีอินเทอร์เน็ต
// ข้อมูลทั้งหมดโหลดเข้าหน่วยความจำตอนเริ่ม (ข้อมูลอพาร์ทเม้นท์มีขนาดเล็ก) เพื่อให้โมดูลอ่านแบบ sync ได้
// ทุกการแก้ไขในคอลเลกชันที่ซิงก์ จะถูกเข้าคิว outbox รออัปโหลดขึ้น Google Sheets

import { SITE } from '../../site.js';
import * as acc from './access.js';
const DB_NAME = SITE.storageKey || 'rea-pms';
const DB_VER = 2;   // 2: เพิ่ม store 'audit' (ประวัติการใช้งานในโหมดเครื่องเดียว)
export const SYNC_COLS = ['rooms', 'tenants', 'slots', 'bills', 'settings', 'lineLinks'];
const LOCAL_COLS = ['users'];               // ใช้เฉพาะโหมด local (ยังไม่เชื่อม Google)
const STORES = [...SYNC_COLS, ...LOCAL_COLS, 'photos', 'outbox', 'meta', 'audit'];

let idb;
const mem = {};                              // col -> Map(id -> record)
const listeners = new Set();
export let actor = 'system';
export const setActor = a => { actor = a; };

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function tx(store, mode = 'readonly') { return idb.transaction(store, mode).objectStore(store); }

export async function open() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) {
        d.createObjectStore(s, s === 'outbox' || s === 'audit' ? { keyPath: 'seq', autoIncrement: true } : { keyPath: s === 'meta' ? 'key' : 'id' });
      }
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  for (const c of [...SYNC_COLS, ...LOCAL_COLS]) {
    mem[c] = new Map((await req(tx(c).getAll())).map(o => [o.id, o]));
  }
}

export const isEmpty = () => SYNC_COLS.every(c => mem[c].size === 0);
// สิทธิ์การมองเห็น (core/access.js): ผู้ใช้ที่ถูกจำกัดจะอ่านได้เฉพาะชั้น/โซนของตัวเอง และไม่ได้รับข้อมูลส่วนบุคคลของผู้เช่า
// raw = อ่านข้อมูลดิบทั้งหมด ใช้เฉพาะงานภายใน (ซิงก์) ห้ามใช้กับหน้าจอ
const floorOf = roomId => mem.rooms.get(String(roomId))?.floor ?? null;
const limited = col => SYNC_COLS.includes(col) && acc.dataRestricted();
export const all = (col, { withDeleted = false, raw = false } = {}) => {
  const list = [...mem[col].values()].filter(o => withDeleted || !o.deleted);
  return raw || !limited(col) ? list : list.filter(o => acc.inScope(col, o, floorOf)).map(o => acc.strip(col, o));
};
export const get = (col, id) => {
  const o = mem[col].get(String(id));
  if (!o || o.deleted) return null;
  return !limited(col) ? o : acc.inScope(col, o, floorOf) ? acc.strip(col, o) : null;
};
// ล้างข้อมูลที่ซิงก์ไว้ในเครื่อง (ใช้เมื่อผู้ใช้ที่ถูกจำกัดสิทธิ์เข้าเครื่องที่เคยเก็บข้อมูลเต็ม)
export async function wipeSynced() {
  for (const c of [...SYNC_COLS, 'photos', 'outbox']) { await req(tx(c, 'readwrite').clear()); if (mem[c]) mem[c] = new Map(); }
  SYNC_COLS.forEach(emit);
}
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = col => listeners.forEach(fn => fn(col));

// บันทึก 1 รายการ: silent = ไม่เข้าคิวอัปโหลด (ใช้ตอนรับข้อมูลจาก server หรือ seed)
export async function put(col, obj, { silent = false, keepStamp = false } = {}) {
  let rec = { ...obj, id: String(obj.id) };
  const prev = mem[col].get(rec.id) || null;
  if (!silent && SYNC_COLS.includes(col)) {
    const why = acc.writeProblem(col, rec, prev, floorOf);
    if (why) { const e = new Error(why); e.code = 'READONLY'; throw e; }
    rec = acc.keepPersonal(col, rec, prev);
  }
  if (!keepStamp) { rec.updatedAt = new Date().toISOString(); rec.updatedBy = actor; }
  mem[col].set(rec.id, rec);
  await req(tx(col, 'readwrite').put(rec));
  if (!silent && auditHook && SYNC_COLS.includes(col)) { try { await auditHook(col, rec, prev); } catch (e) { console.warn('audit', e); } }
  if (!silent && SYNC_COLS.includes(col)) await queue({ kind: 'put', col, id: rec.id });
  emit(col);
  return rec;
}

export async function putMany(col, list, opts = { silent: true, keepStamp: true }) {
  const store = idb.transaction(col, 'readwrite').objectStore(col);
  for (const o of list) {
    const rec = { ...o, id: String(o.id) };
    if (!opts.keepStamp) { rec.updatedAt = new Date().toISOString(); rec.updatedBy = actor; }
    mem[col].set(rec.id, rec); store.put(rec);
    if (!opts.silent) await queue({ kind: 'put', col, id: rec.id });
  }
  await new Promise(r => { store.transaction.oncomplete = r; });
  emit(col);
}

// ลบแบบ soft delete เพื่อให้การลบซิงก์ไปเครื่องอื่นได้
export async function remove(col, id) {
  const o = mem[col].get(String(id)); if (!o) return;
  await put(col, { ...o, deleted: true });
}
export async function hardRemove(col, id) { mem[col]?.delete(String(id)); await req(tx(col, 'readwrite').delete(String(id))); emit(col); }

// ---------- ประวัติการใช้งาน (โหมดเครื่องเดียว — โหมด server บันทึกที่ Google Sheet) ----------
let auditHook = null;
export const setAuditHook = fn => { auditHook = fn; };
export async function addAudit(rec) { await req(tx('audit', 'readwrite').add(rec)); }
export const allAudit = () => req(tx('audit').getAll());

// ---------- meta (ค่าภายในเครื่อง) ----------
export async function meta(key, val) {
  if (val === undefined) return (await req(tx('meta').get(key)))?.val;
  await req(tx('meta', 'readwrite').put({ key, val }));
}

// ---------- รูปภาพ (บัตรประชาชน) เก็บเป็น dataURL ----------
export async function putPhoto(rec) { await req(tx('photos', 'readwrite').put(rec)); }
export async function getPhoto(id) { return id ? req(tx('photos').get(id)) : null; }

// ---------- outbox (คิวรออัปโหลด) ----------
export async function queue(entry) {
  // รวมรายการ put ซ้ำของ record เดียวกันไว้รายการเดียว · บิลที่รอส่ง LINE อยู่แล้วไม่ส่งซ้ำ (กันโควตาข้อความหมด)
  if (entry.kind === 'put' || entry.kind === 'line') {
    const dup = (await outbox()).find(e => e.kind === entry.kind && (entry.kind === 'put' ? e.col === entry.col && e.id === entry.id : e.billId === entry.billId));
    if (dup) return;
  }
  await req(tx('outbox', 'readwrite').add({ ...entry, at: new Date().toISOString(), by: actor }));
  emit('outbox');
}
export async function queueMany(entries) {
  const have = new Set((await outbox()).filter(e => e.kind === 'put').map(e => e.col + '|' + e.id));
  const store = idb.transaction('outbox', 'readwrite').objectStore('outbox'), at = new Date().toISOString();
  for (const e of entries) if (!(e.kind === 'put' && have.has(e.col + '|' + e.id))) store.add({ ...e, at, by: actor });
  await new Promise(r => { store.transaction.oncomplete = r; });
  emit('outbox');
}
export const outbox = () => req(tx('outbox').getAll());
export async function unqueue(seq) { await req(tx('outbox', 'readwrite').delete(seq)); emit('outbox'); }
export async function updateQueued(e) { await req(tx('outbox', 'readwrite').put(e)); emit('outbox'); }
