// ความปลอดภัยฝั่งแอป
//   1) กติการหัสผ่าน + ล็อกบัญชีเมื่อใส่รหัสผิดหลายครั้ง (โหมดเครื่องเดียว และตอนออฟไลน์ · ตอนออนไลน์ server เป็นผู้ล็อก)
//   2) ล็อกหน้าจอเมื่อไม่ได้ใช้งาน (หน้าจอล็อกอยู่ที่ modules/lock.js)
//   3) ประวัติการใช้งาน: โหมดเครื่องเดียวเก็บในเครื่อง · โหมด server อ่านจาก Google Sheet
//   4) สำรองข้อมูล: ดาวน์โหลดไฟล์ + เตือนเมื่อไม่ได้สำรองนาน · โหมด server มีสำรองอัตโนมัติทุกคืนที่ Google Drive
// ไฟล์นี้ห้าม import auth.js (auth.js เป็นฝ่ายเรียกใช้ไฟล์นี้)
import * as db from './db.js';
import * as api from './api.js';
import { APP, KEY, isServerMode } from './config.js';

// ค่าที่ Administrator ตั้งได้ (ตั้งค่า → ความปลอดภัย) — ซิงก์ทุกเครื่อง
export const cfg = () => ({ idleMin: 10, remindDays: 7, ...(db.get('settings', 'security') || {}) });

// ---------- รหัสผ่าน ----------
export function passwordProblem(pw, email = '') {
  pw = String(pw || '');
  if (pw.length < APP.minPasswordLength) return `รหัสผ่านต้องยาวอย่างน้อย ${APP.minPasswordLength} ตัวอักษร`;
  if (!/[A-Za-zก-๙]/.test(pw) || !/\d/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
  const em = String(email).trim().toLowerCase(), name = em.split('@')[0];
  if (em && (pw.toLowerCase() === em || (name.length >= 4 && pw.toLowerCase() === name))) return 'รหัสผ่านต้องไม่เหมือนอีเมล';
  return '';
}
export const PASSWORD_HINT = `อย่างน้อย ${APP.minPasswordLength} ตัว มีทั้งตัวอักษรและตัวเลข`;

// ---------- ล็อกบัญชี (นับในเครื่อง) ----------
const failKey = email => 'fail:' + String(email).trim().toLowerCase();
export async function lockedMinutes(email) {
  const f = await db.meta(failKey(email));
  return f?.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
// คืนจำนวนครั้งที่เหลือก่อนถูกล็อก (0 = ล็อกแล้ว)
export async function noteFail(email) {
  let f = await db.meta(failKey(email)) || { n: 0, until: 0, at: 0 };
  if (Date.now() - (f.at || 0) > APP.lockMinutes * 60e3) f = { n: 0, until: 0 };   // ผิดครั้งก่อนนานแล้ว เริ่มนับใหม่
  f.n++; f.at = Date.now(); f.until = f.n >= APP.maxFails ? Date.now() + APP.lockMinutes * 60e3 : 0;
  await db.meta(failKey(email), f);
  return Math.max(0, APP.maxFails - f.n);
}
export async function clearFail(email) { await db.meta(failKey(email), null); }
export const lockedMessage = min => `บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ในอีก ${min} นาที หรือให้ Administrator ปลดล็อก`;

// ---------- ประวัติการใช้งาน ----------
const COL_NAME = { rooms: 'หน่วยเช่า', tenants: 'ผู้เช่า', slots: 'ที่จอดรถ', bills: 'บิล', settings: 'ตั้งค่า', lineLinks: 'LINE' };
const SKIP = ['updatedAt', 'updatedBy', '_serverAt', 'id'];
const MASK = ['idNo', 'lineCode', 'idPhoto', 'photo'];   // ข้อมูลอ่อนไหว: บันทึกว่าเปลี่ยน แต่ไม่บันทึกค่า
const show = v => { const t = v == null || v === '' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v); return t.length > 60 ? t.slice(0, 57) + '…' : t; };

// สรุปสิ่งที่เปลี่ยน: [รายการ, ข้อมูล, รายละเอียด] หรือ null ถ้าไม่มีอะไรเปลี่ยน (กติกาเดียวกับ backend/Security.gs)
export function diff(col, rec, prev) {
  const label = `${COL_NAME[col] || col} ${rec.id}${rec.name ? ` (${rec.name})` : rec.tenantName ? ` (${rec.tenantName})` : ''}`;
  if (!prev) return ['เพิ่ม', label, ''];
  if (rec.deleted && !prev.deleted) return ['ลบ', label, ''];
  const out = [];
  for (const k of Object.keys({ ...prev, ...rec })) {
    if (SKIP.includes(k)) continue;
    const a = prev[k] === undefined || prev[k] === '' ? null : prev[k], b = rec[k] === undefined || rec[k] === '' ? null : rec[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push(MASK.includes(k) ? `${k}: (เปลี่ยน)` : `${k}: ${show(a)} → ${show(b)}`);
  }
  return out.length ? [prev.deleted && !rec.deleted ? 'กู้คืน' : 'แก้ไข', label, out.join(' | ').slice(0, 900)] : null;
}

// บันทึกเหตุการณ์ (เฉพาะโหมดเครื่องเดียว — โหมด server บันทึกที่ server เพื่อไม่ให้แก้ย้อนหลังจากเครื่องได้)
export async function log(action, target = '', detail = '', user = '') {
  if (isServerMode()) return;
  try { await db.addAudit({ at: new Date().toISOString(), user: user || db.actor, action, target, detail }); } catch (e) { console.warn('audit', e); }
}
db.setAuditHook(async (col, rec, prev) => { if (isServerMode()) return; const d = diff(col, rec, prev); if (d) await log(...d); });

const day = iso => { const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export async function listAudit({ from = '', to = '', user = '', q = '' } = {}) {
  if (isServerMode()) return api.call('auditLog', { from, to, user, q });
  const all = await db.allAudit(), rows = [];
  q = q.toLowerCase(); user = user.trim().toLowerCase();
  for (let i = all.length - 1; i >= 0 && rows.length < 500; i--) {
    const r = all[i], d = day(r.at);
    if ((from && d < from) || (to && d > to)) continue;
    if (user && String(r.user).toLowerCase() !== user) continue;
    if (q && ![r.user, r.action, r.target, r.detail].join(' ').toLowerCase().includes(q)) continue;
    rows.push(r);
  }
  return { rows, total: all.length };
}

// ---------- สำรองข้อมูล ----------
export async function downloadBackup() {
  const data = { format: 'rea-pms', version: 1, ...Object.fromEntries(db.SYNC_COLS.map(c => [c, db.all(c, { withDeleted: true })])) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `rea-pms-backup-${day(new Date().toISOString())}.json`; a.click();
  await db.meta('lastBackupAt', Date.now());
  await log('สำรองข้อมูล', 'ดาวน์โหลดไฟล์', a.download);
}
// จำนวนวันตั้งแต่สำรองครั้งล่าสุด (ถ้ายังไม่เคย นับจากวันที่เริ่มใช้เครื่องนี้)
export async function backupAgeDays() {
  let since = await db.meta('lastBackupAt');
  if (!since) { since = await db.meta('firstRunAt'); if (!since) { since = Date.now(); await db.meta('firstRunAt', since); } }
  return Math.floor((Date.now() - since) / 864e5);
}
export const lastBackupAt = () => db.meta('lastBackupAt');

// สถานะสำรองอัตโนมัติบน server (จำไว้ 10 นาที ไม่ถาม server ทุกครั้งที่เปลี่ยนหน้า)
let stat = null, statAt = 0;
export async function serverStatus(force = false) {
  if (!isServerMode()) return null;
  if (!force && stat && Date.now() - statAt < 10 * 60e3) return stat;
  try { stat = await api.call('securityStatus'); statAt = Date.now(); } catch { if (force) throw new Error('อ่านสถานะจาก server ไม่ได้ (ต้องออนไลน์)'); }
  return stat;
}
export const backupNow = async () => { const r = await api.call('backupNow', {}, { timeout: 120000 }); stat = null; return r; };

// ---------- ล็อกหน้าจอเมื่อไม่ได้ใช้งาน ----------
const LKEY = KEY('locked'), AKEY = KEY('lastActive');
let last = Date.now(), started = false;
export const isLocked = () => { try { return localStorage.getItem(LKEY) === '1'; } catch { return false; } };
export const setLocked = v => { try { v ? localStorage.setItem(LKEY, '1') : localStorage.removeItem(LKEY); } catch {} if (!v) touch(); };
export function touch() { last = Date.now(); }
const persist = () => { try { localStorage.setItem(AKEY, String(last)); } catch {} };
// เปิดแอปขึ้นมาใหม่หลังทิ้งไว้นานเกินกำหนด → ต้องปลดล็อกก่อน
export function idleExceeded() {
  const min = Number(cfg().idleMin) || 0; if (!min) return false;
  let t = 0; try { t = Number(localStorage.getItem(AKEY)) || 0; } catch {}
  return !!t && Date.now() - t > min * 60e3;
}
export function startIdleWatch(onIdle) {
  if (started) return; started = true;
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, touch, { passive: true, capture: true });
  setInterval(() => {
    const min = Number(cfg().idleMin) || 0;
    if (isLocked()) return;
    if (min && Date.now() - last > min * 60e3) onIdle(); else persist();
  }, 5000);
}
