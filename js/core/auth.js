// เข้าสู่ระบบด้วยอีเมล + รหัสผ่าน และสิทธิ์ผู้ใช้ 3 ระดับ
// - โหมด server: ตรวจรหัสที่ Apps Script แล้วเก็บ hash ไว้ในเครื่องเพื่อให้ login ตอน offline ได้
// - โหมด local: ผู้ใช้เก็บในเครื่องนี้ (ใช้ก่อนเชื่อม Google)
// ความปลอดภัย (ดู core/security.js): กติการหัสผ่าน · ล็อกบัญชีเมื่อใส่รหัสผิด 5 ครั้ง · บันทึกประวัติ · ยกเลิก session ที่ server เมื่อออกจากระบบ
import { APP, KEY, isServerMode } from './config.js';
import * as db from './db.js';
import * as api from './api.js';
import * as sec from './security.js';
import * as acc from './access.js';

export const ROLES = { admin: 'Administrator', manager: 'Manager', operator: 'Operator', viewer: 'Viewer (ดูอย่างเดียว)' };

// ตารางสิทธิ์ — เพิ่มสิทธิ์ใหม่ที่นี่ที่เดียว
const PERMS = {
  'users.manage':   ['admin'],                       // เพิ่ม/แก้ผู้ใช้
  'rooms.manage':   ['admin'],                       // เพิ่ม/ลบห้อง
  'audit.view':     ['admin'],                       // ดูประวัติการใช้งาน
  'settings.view':  ['admin', 'manager'],            // เห็นเมนูตั้งค่า
  'data.delete':    ['admin', 'manager'],            // ลบข้อมูล
};
let session = null;
export const current = () => session;
export const can = perm => !!session && (PERMS[perm] ? PERMS[perm].includes(session.role) : true);

// ---------- hash (ต้องเหมือน backend/Auth.gs) ----------
async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function hashPassword(pw, salt, iter = APP.hashIterations) {
  let h = await sha256hex(salt + pw);
  for (let i = 1; i < iter; i++) h = await sha256hex(h + salt);
  return h;
}
const iterOf = u => Number(u?.iter) || APP.hashIterationsOld;   // บัญชีเดิมที่ไม่มีค่า = จำนวนรอบแบบเดิม
export function randomString(n = 10, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789') {
  const a = crypto.getRandomValues(new Uint32Array(n)); return [...a].map(x => chars[x % chars.length]).join('');
}
// รหัสชั่วคราว: ตัวอักษร 9 ตัว + ตัวเลข 2 ตัว (ผ่านกติการหัสผ่านเสมอ)
const tempPassword = () => randomString(9, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz') + randomString(2, '23456789');
const norm = e => String(e || '').trim().toLowerCase();

// ---------- session ----------
const SKEY = KEY('session');
function saveSession(s) { session = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch {} acc.set(s ? s.access || { role: s.role } : null); if (s) { db.setActor(s.email); api.setToken(s.token); } else api.setToken(null); }
export function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || 'null');
    // โหมด server: session จากบัญชีในเครื่อง (ไม่มี token และไม่ใช่ login ตอน offline) ใช้ซิงก์ไม่ได้ → ให้เข้าสู่ระบบใหม่
    const stale = s && isServerMode() && !s.token && !s.offline;
    if (s && !stale && new Date(s.exp) > new Date()) { saveSession(s); return s; }
  } catch {}
  saveSession(null); return null;
}
function makeSession(u, token, offline = false) {
  return { email: u.email, name: u.name, role: u.role, access: accessOf(u), sso: !!u.sso, mustChange: !!u.mustChange, token, offline,
    exp: new Date(Date.now() + APP.sessionHours * 3600e3).toISOString() };
}
// สิทธิ์การมองเห็นของผู้ใช้ (server ส่งมาใน user.access · โหมดเครื่องเดียวอ่านจากบัญชีในเครื่อง)
const accessOf = u => acc.normalize(u.access || { role: u.role, hide: u.hide, personal: u.personal, floors: u.floors });
// ข้อมูลในเครื่องต้องตรงกับสิทธิ์ของผู้ที่เข้าสู่ระบบ: ถ้าสิทธิ์ต่างจากข้อมูลที่เก็บไว้ ให้ล้างแล้วดึงจาก server ใหม่ทั้งหมด
// (กันผู้ใช้ที่ถูกจำกัดสิทธิ์เห็นข้อมูลที่ผู้ใช้สิทธิ์เต็มเคยดึงมาเก็บไว้ในเครื่องเดียวกัน)
async function prepareCache(access, online) {
  if (!isServerMode()) return;
  const sig = acc.cacheSig(access), prev = await db.meta('cacheSig') || (await db.meta('lastSync') ? 'full' : '');
  if (prev === sig || (!prev && sig === 'full')) return db.meta('cacheSig', sig);
  if (!online) throw new Error('สิทธิ์ของบัญชีนี้ต่างจากข้อมูลที่เก็บในเครื่อง ต้องเข้าสู่ระบบขณะออนไลน์ 1 ครั้งก่อน');
  if (sig !== 'full') {
    if ((await db.outbox()).length) throw new Error('เครื่องนี้มีข้อมูลรออัปโหลดของผู้ใช้คนก่อน ให้ผู้ใช้คนนั้นเข้าสู่ระบบและอัปโหลดให้เสร็จก่อน');
    await db.wipeSynced();
  }
  await db.meta('lastSync', ''); await db.meta('cacheSig', sig);
}
// รับ session จาก server (ใช้ทั้ง login ด้วยรหัสผ่าน และตั๋วจากศูนย์รวม)
async function acceptServerLogin(r) {
  try { await prepareCache(accessOf(r.user), true); }
  catch (e) { api.setToken(r.token); api.call('logout', {}, { timeout: 8000 }).catch(() => {}).finally(() => api.setToken(session?.token || null)); throw e; }
  saveSession(makeSession(r.user, r.token));
  return session;
}
// เข้าสู่ระบบด้วย "ตั๋ว" จากศูนย์รวม login (ยังไม่เปิดใช้จนกว่าจะมีศูนย์รวม — ดู HUB-DESIGN.md)
export async function ssoLogin(ticket) {
  if (!isServerMode()) throw new Error('โครงการนี้ยังไม่ได้เชื่อม Google จึงใช้ศูนย์รวม login ไม่ได้');
  return acceptServerLogin(await api.call('ssoLogin', { ticket }));
}

export function logout() {
  if (session) {
    if (session.token && isServerMode()) api.call('logout', {}, { timeout: 8000 }).catch(() => {});   // ยกเลิก session ที่ server ด้วย
    sec.log('ออกจากระบบ', '', '', session.email);
  }
  sec.setLocked(false);
  saveSession(null);
}

// ---------- first run (โหมด local) ----------
export const needsSetup = () => !isServerMode() && db.all('users').length === 0;
export async function createFirstAdmin(email, name, pw) {
  const bad = sec.passwordProblem(pw, email); if (bad) throw new Error(bad);
  const salt = randomString(16);
  const u = { id: norm(email), email: norm(email), name, role: 'admin', salt, iter: APP.hashIterations, hash: await hashPassword(pw, salt), mustChange: false, active: true };
  await db.put('users', u, { silent: true });
  saveSession(makeSession(u, null));
  await sec.log('สร้างผู้ดูแลระบบคนแรก', u.email, '', u.email);
}

// ---------- login ----------
// ตรวจรหัสกับข้อมูลในเครื่อง พร้อมนับครั้งที่ผิดและล็อกบัญชี (โหมดเครื่องเดียว และตอนออฟไลน์)
async function localCheck(email, pw, salt, hash, iter, known) {
  const wait = await sec.lockedMinutes(email);
  if (wait) throw new Error(sec.lockedMessage(wait));
  if (known && await hashPassword(pw, salt, iter) === hash) { await sec.clearFail(email); return; }
  const left = await sec.noteFail(email);
  if (known) await sec.log(left ? 'เข้าสู่ระบบไม่สำเร็จ' : `ล็อกบัญชี (ใส่รหัสผิด ${APP.maxFails} ครั้ง)`, '', '', email);
  throw new Error(left ? `อีเมลหรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${left} ครั้งก่อนถูกล็อก)` : `ใส่รหัสผ่านผิด ${APP.maxFails} ครั้ง บัญชีถูกล็อก ${APP.lockMinutes} นาที`);
}

export async function login(email, pw) {
  email = norm(email);
  if (isServerMode()) {
    try {
      const r = await api.call('login', { email, password: pw });
      await db.meta('cred:' + email, { ...r.cred, user: r.user });       // สำหรับ login ตอน offline
      await sec.clearFail(email);
      return await acceptServerLogin(r);
    } catch (e) {
      if (!['OFFLINE', 'NETWORK'].includes(e.code)) throw e;
      const c = await db.meta('cred:' + email);                          // offline: ตรวจกับ hash ที่เคยเก็บไว้
      if (!c) throw new Error('ออฟไลน์อยู่ และอีเมลนี้ยังไม่เคยเข้าสู่ระบบบนเครื่องนี้');
      await localCheck(email, pw, c.salt, c.hash, c.iter, true);
      await prepareCache(accessOf(c.user), false);
      saveSession(makeSession(c.user, null, true));
      return session;
    }
  }
  const u = db.get('users', email), ok = !!u && u.active !== false;
  await localCheck(email, pw, u?.salt, u?.hash, iterOf(u), ok);
  saveSession(makeSession(u, null));
  await sec.log('เข้าสู่ระบบ', '', '', u.email);
  return session;
}

// ยืนยันรหัสผ่านของผู้ใช้ที่เข้าสู่ระบบอยู่ (ใช้ก่อนทำรายการสำคัญ และใช้ปลดล็อกหน้าจอ)
// โหมด server: ตรวจกับ hash ที่เก็บไว้ตอน login (ไม่ต้องต่อเน็ต) · ถ้าไม่มีให้ถาม server
export async function verifyPassword(pw) {
  if (!session || !pw) return false;
  if (isServerMode()) {
    const c = await db.meta('cred:' + session.email);
    if (c?.salt && c?.hash) return await hashPassword(pw, c.salt, c.iter) === c.hash;
    try { await api.call('login', { email: session.email, password: pw }); return true; } catch { return false; }
  }
  const u = db.get('users', session.email);
  return !!u && await hashPassword(pw, u.salt, iterOf(u)) === u.hash;
}

export async function changePassword(oldPw, newPw) {
  const bad = sec.passwordProblem(newPw, session.email); if (bad) throw new Error(bad);
  if (newPw === oldPw) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม');
  let token = session.token;
  if (isServerMode()) {
    const r = await api.call('changePassword', { oldPassword: oldPw, newPassword: newPw });
    await db.meta('cred:' + session.email, { ...r.cred, user: r.user });
    token = r.token || token;   // server ออก session ใหม่ให้ และยกเลิก session เก่าของบัญชีนี้ทุกเครื่อง
  } else {
    const u = db.get('users', session.email);
    if (await hashPassword(oldPw, u.salt, iterOf(u)) !== u.hash) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
    const salt = randomString(16);
    await db.put('users', { ...u, salt, iter: APP.hashIterations, hash: await hashPassword(newPw, salt), mustChange: false }, { silent: true });
    await sec.log('เปลี่ยนรหัสผ่าน');
  }
  saveSession({ ...session, token, mustChange: false });
}

// ---------- จัดการผู้ใช้ (Administrator เท่านั้น) ----------
function guard() { if (!can('users.manage')) throw new Error('ไม่มีสิทธิ์จัดการผู้ใช้'); }
const publicUser = u => ({ email: u.email, name: u.name, role: u.role, access: accessOf(u), mustChange: !!u.mustChange, active: u.active !== false, lastLogin: u.lastLogin || '' });

export async function listUsers() {
  guard();
  if (isServerMode()) return (await api.call('listUsers')).users;
  return Promise.all(db.all('users').map(async u => ({ ...publicUser(u), locked: await sec.lockedMinutes(u.email) > 0 })));
}
// คืนค่ารหัสผ่านชั่วคราวเพื่อให้ Admin แจ้งผู้ใช้ — ผู้ใช้ต้องเปลี่ยนเองตอนเข้าครั้งแรก
export async function addUser({ email, name, role }) {
  guard(); email = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  if (!ROLES[role]) throw new Error('ระดับผู้ใช้ไม่ถูกต้อง');
  if (isServerMode()) return (await api.call('addUser', { email, name, role })).tempPassword;
  if (db.get('users', email)) throw new Error('มีอีเมลนี้อยู่แล้ว');
  const temp = tempPassword(), salt = randomString(16);
  await db.put('users', { id: email, email, name, role, salt, iter: APP.hashIterations, hash: await hashPassword(temp, salt), mustChange: true, active: true }, { silent: true });
  await sec.log('เพิ่มผู้ใช้', email, 'ระดับ ' + role);
  return temp;
}
export async function updateUser(email, patch) {
  guard();
  if (email === session.email && (patch.role && patch.role !== 'admin' || patch.active === false)) throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  if (isServerMode()) return api.call('updateUser', { email, patch });
  const u = db.get('users', email), nu = { ...u, ...patch };
  if (patch.access) { const a = acc.normalize({ ...patch.access, role: nu.role }); nu.hide = a.hide; nu.personal = a.personal; nu.floors = a.floors; delete nu.access; }
  await db.put('users', nu, { silent: true });
  await sec.log('แก้ไขผู้ใช้', email, [patch.role && `ระดับ ${u.role} → ${patch.role}`, patch.active !== undefined && (patch.active ? 'เปิดบัญชี' : 'ปิดบัญชี'), patch.access && 'สิทธิ์การมองเห็น ' + accessText(accessOf(nu))].filter(Boolean).join(', '));
}
// ข้อความสรุปสิทธิ์ (ใช้ในประวัติการใช้งานและตารางผู้ใช้)
export const accessText = a => a.role === 'admin' ? 'เห็นทั้งหมด' : [a.floors.length ? 'เฉพาะชั้น/โซน ' + a.floors.join(',') : 'ทุกชั้น/โซน', a.personal ? '' : 'ไม่เห็นข้อมูลส่วนบุคคล', a.hide.length ? 'ซ่อน ' + a.hide.length + ' เมนู' : ''].filter(Boolean).join(' · ');
export async function resetPassword(email) {
  guard();
  if (isServerMode()) return (await api.call('resetPassword', { email })).tempPassword;
  const u = db.get('users', email), temp = tempPassword(), salt = randomString(16);
  await db.put('users', { ...u, salt, iter: APP.hashIterations, hash: await hashPassword(temp, salt), mustChange: true }, { silent: true });
  await sec.clearFail(email);
  await sec.log('รีเซ็ตรหัสผ่าน', email);
  return temp;
}
export async function unlockUser(email) {
  guard();
  await sec.clearFail(email);
  if (isServerMode()) return api.call('unlockUser', { email });
  await sec.log('ปลดล็อกบัญชี', email);
}
