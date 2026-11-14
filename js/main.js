// จุดเริ่มต้นของแอป: โหลดฐานข้อมูล → เข้าสู่ระบบ → แสดงเมนูตามสิทธิ์
// เพิ่มโมดูลใหม่: สร้างไฟล์ใน js/modules/ แล้วเพิ่มใน MODULES ด้านล่าง
import { APP, KEY, UNIT, FLOOR, feature } from './core/config.js';
import * as db from './core/db.js';
import * as auth from './core/auth.js';
import * as sync from './core/sync.js';
import { $, esc, toast, openModal, closeModal } from './core/ui.js';
import * as seed from './data/seed.js';
import { renderLogin, renderSetup, renderChangePassword, openReauth } from './modules/login.js';

import dashboard from './modules/dashboard.js';
import floorplan from './modules/floorplan.js';
import parking from './modules/parking.js';
import billing from './modules/billing.js';
import tenants from './modules/tenants.js';
import reports from './modules/reports.js';
import users from './modules/users.js';
import settings from './modules/settings.js';
import audit from './modules/audit.js';
import * as sec from './core/security.js';
import { showLock } from './modules/lock.js';
import * as acc from './core/access.js';
import { preloadAssets } from './core/docs.js';
import { migrateData } from './core/model.js';
import { checkBirthdays } from './modules/birthdays.js';
import { printScreen } from './core/print.js';
import { loadFile as loadLayoutFile } from './core/layout.js';

const MODULES = [dashboard, floorplan, parking, billing, tenants, reports, users, audit, settings].filter(m => m.id !== 'parking' || feature('parking'));
document.title = APP.name + ' · ' + APP.product;
let currentId = 'dashboard', currentArg = null;

export const nav = {
  go(id, arg = null) { currentId = id; currentArg = arg; renderShell(); },
  refresh() { renderView(); },
};

async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // เวอร์ชันใหม่ติดตั้งเสร็จ → โหลดหน้าใหม่ครั้งเดียวให้ใช้ไฟล์ใหม่ทันที
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
  await db.open();
  if (db.isEmpty() && !(await db.meta('seeded'))) await loadSeed();
  await migrateData();
  await loadLayoutFile();   // ผังจากไฟล์ app/layout/layout.json (ถ้ามีและใหม่กว่า)
  await sync.init();
  preloadAssets();
  let restored = auth.restore();
  // เปิดมาจากศูนย์รวม login พร้อม "ตั๋ว" (#sso=…) → แลกเป็น session ของโครงการนี้ แล้วลบตั๋วออกจากแถบที่อยู่ทันที
  const sso = /[#&]sso=([\w.-]+)/.exec(location.hash);
  if (sso) {
    history.replaceState(null, '', location.pathname + location.search);
    try { await auth.ssoLogin(sso[1]); restored = null; } catch (e) { setTimeout(() => toast('เข้าสู่ระบบผ่านศูนย์รวมไม่สำเร็จ: ' + e.message, 6000), 500); }
  }
  route();
  // ความปลอดภัย: ล็อกหน้าจอเมื่อไม่ได้ใช้งาน · เปิดแอปใหม่หลังทิ้งไว้นาน หรือปิดไปทั้งที่ล็อกอยู่ ต้องปลดล็อกก่อน
  if (restored && (sec.isLocked() || sec.idleExceeded())) showLock();
  sec.startIdleWatch(() => { if (auth.current()) showLock(); });
  db.onChange(col => {   // ข้อมูลจากเครื่องอื่นเข้ามา → วาดหน้าใหม่ถ้าผู้ใช้ไม่ได้กำลังพิมพ์
    if (col === 'outbox' || !auth.current()) return;
    const a = document.activeElement;
    if (!$('#modal').classList.contains('on') && !(a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) scheduleRender();
  });
}

// โมดูลอื่นขอเปลี่ยนหน้าได้โดยไม่ต้องรู้จัก nav โดยตรง
document.addEventListener('app-nav', e => nav.go(e.detail.id, e.detail.arg || null));
// ปุ่ม 🖨️ มุมขวาบนของทุกป๊อปอัป
document.addEventListener('click', e => { if (e.target.closest('.modal-print')) printScreen(); });

let rt; const scheduleRender = () => { clearTimeout(rt); rt = setTimeout(renderView, 300); };

async function loadSeed() {
  await db.putMany('rooms', seed.rooms.map(stamp));
  await db.putMany('slots', seed.slots.map(stamp));
  await db.putMany('settings', seed.settings.map(stamp));
  await db.meta('seeded', true);
}
// วันที่เก่าเพื่อให้ข้อมูลจาก server/ไฟล์นำเข้าทับได้เสมอ
function stamp(o) { return { ...o, updatedAt: '2000-01-01T00:00:00.000Z', updatedBy: 'seed' }; }

function route() {
  const root = $('#root');
  if (auth.needsSetup()) return renderSetup(root, route);
  const s = auth.current();
  if (!s) return renderLogin(root, route);
  if (s.mustChange) return renderChangePassword(root, route, { forced: true });
  // เพิ่งเข้าสู่ระบบ: ล้างสถานะ "ต้องเข้าสู่ระบบ" ที่ค้างจากตอนเปิดแอปก่อน login แล้วซิงก์ทันที (ดึงข้อมูลจาก server)
  if (s.token) { sync.tokenReady(); sync.run(); }
  renderShell();
}

// เมนูซ้ายแบบซ่อนอัตโนมัติ: เหลือแถบไอคอน เลื่อนเมาส์มาแล้วขยาย (จำค่าไว้ในเครื่องนี้)
function autoHide(v) {
  try {
    if (v === undefined) return localStorage.getItem(KEY('autohide')) === '1';
    localStorage.setItem(KEY('autohide'), v ? '1' : '0');
  } catch { return false; }
}

// เมนูที่มีไอคอนรูปภาพ (assets/nav/<id>.png) — เมนูอื่นใช้อีโมจิจาก m.icon
const NAV_IMG = new Set(['dashboard', 'floorplan', 'parking', 'billing', 'tenants', 'reports', 'users']);
// เมนูที่ผู้ใช้เห็น = ผ่านสิทธิ์ตามระดับ และไม่ถูกซ่อนรายคน (core/access.js)
const visible = () => MODULES.filter(m => (!m.perm || auth.can(m.perm)) && !acc.current().hide.includes(m.id));

function renderShell() {
  const s = auth.current(); if (!s) return route();
  if (!visible().some(m => m.id === currentId)) currentId = visible()[0]?.id || 'dashboard';
  $('#root').innerHTML = `
  <div class="app ${autoHide() ? 'autohide' : ''}">
    <nav class="side">
      <div class="side-logo"><img src="assets/brand-logo.png" alt=""></div>
      <div class="brand"><h1>${esc(APP.name)}</h1><div class="sub">${esc(APP.product)} · v${APP.version}</div></div>
      <div class="items">${visible().map(m => `<button data-m="${m.id}" class="${m.id === currentId ? 'on' : ''}" title="${esc(m.title)}"><i class="${NAV_IMG.has(m.id) ? 'pic' : ''}">${NAV_IMG.has(m.id) ? `<img src="assets/nav/${m.id}.png" alt="">` : m.icon}</i><span>${esc(m.title)}</span></button>`).join('')}</div>
      <div class="me"><div class="who"><b>${esc(s.name || s.email)}</b><br>${auth.ROLES[s.role]}</div>
        <button data-lock title="ล็อกหน้าจอ (ต้องใส่รหัสผ่านเพื่อใช้ต่อ)"><i>🔒</i><span>ล็อกหน้าจอ</span></button><button data-pw title="เปลี่ยนรหัสผ่าน"><i>🔑</i><span>เปลี่ยนรหัสผ่าน</span></button><button data-out title="ออกจากระบบ"><i>⏻</i><span>ออกจากระบบ</span></button>
        <label class="ah" title="ซ่อนเมนูเหลือแค่ไอคอน เลื่อนเมาส์มาที่เมนูเพื่อขยาย"><input type="checkbox" data-autohide ${autoHide() ? 'checked' : ''}><span>ซ่อนเมนูอัตโนมัติ</span></label></div>
    </nav>
    <main>
      <div class="statusbar" id="statusbar"></div>
      <section id="view"></section>
    </main>
  </div>`;
  $('#root').querySelectorAll('[data-m]').forEach(b => b.onclick = () => nav.go(b.dataset.m));
  $('[data-out]').onclick = () => { auth.logout(); route(); };
  $('[data-lock]').onclick = () => showLock();
  $('[data-autohide]').onchange = e => { autoHide(e.target.checked); $('.app').classList.toggle('autohide', e.target.checked); };
  $('[data-pw]').onclick = () => {
    const box = openModal('<div id="pwbox"></div>');
    renderChangePassword(box.querySelector('#pwbox'), () => { closeModal(); toast('เปลี่ยนรหัสผ่านแล้ว'); }, { forced: false });
  };
  if (unsubStatus) unsubStatus();
  unsubStatus = sync.onStatus(renderStatus);
  renderView();
  setTimeout(() => checkBirthdays().catch(console.error), 600);   // เตือนวันเกิดผู้เช่าเดือนนี้ (วันละครั้ง)
}
let unsubStatus = null;

function renderView() {
  const el = $('#view'); if (!el) return;
  const m = visible().find(x => x.id === currentId);
  if (!m) { el.innerHTML = '<div class="card empty">บัญชีนี้ยังไม่ได้รับสิทธิ์เห็นเมนูใด กรุณาติดต่อผู้ดูแลระบบ</div>'; return; }
  try { m.render(el, nav, currentArg); } catch (e) { console.error(e); el.innerHTML = `<div class="card">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`; }
}

function renderStatus(st) {
  const el = $('#statusbar'); if (!el) return;
  const s = auth.current();
  const a = acc.current();
  const scope = [a.role === 'viewer' && '<span class="pill info" title="บัญชีนี้แก้ไขข้อมูลไม่ได้">👁 ดูอย่างเดียว</span>', a.floors.length && `<span class="pill info" title="เห็นเฉพาะชั้น/โซนที่รับผิดชอบ">เฉพาะ${FLOOR} ${a.floors.join(', ')}</span>`].filter(Boolean).join('');
  const mode = scope + (st.server ? '' : '<span class="pill idle" title="ข้อมูลอยู่ในเครื่องนี้เท่านั้น ตั้งค่า Google ได้ที่เมนูตั้งค่า">โหมดเครื่องเดียว (ยังไม่เชื่อม Google)</span>');
  const net = `<span class="net ${st.online ? '' : 'off'}"><i></i>${st.online ? 'ออนไลน์' : 'ออฟไลน์'}</span>`;
  const pend = st.pending && st.server ? `<span class="pill warn">รออัปโหลด ${st.pending} รายการ</span>` : (st.server ? '<span class="pill ok">ข้อมูลตรงกับ server</span>' : '');
  const btn = st.server ? (st.needAuth || (s && !s.token)
      ? `<button class="btn sm" data-reauth>เข้าสู่ระบบเพื่ออัปโหลด</button>`
      : `<button class="btn sm" data-sync ${st.syncing || !st.online ? 'disabled' : ''}>${st.syncing ? 'กำลังอัปโหลด…' : '☁️ อัปโหลด/ดึงข้อมูล'}</button>`) : '';
  const err = st.error ? `<span class="pill bad" title="${esc(st.error)}">ซิงก์ไม่สำเร็จ</span>` : '';
  el.innerHTML = `${mode}${err}${pend}${net}${btn}<button class="btn sm" data-print title="พิมพ์หน้านี้ (กระดาษ A4)">🖨️ พิมพ์หน้านี้</button>`;
  el.querySelector('[data-print]').onclick = () => printScreen();
  backupPill(el, st.server);
  el.querySelector('[data-sync]')?.addEventListener('click', () => sync.run());
  el.querySelector('[data-reauth]')?.addEventListener('click', () => openReauth(() => { sync.tokenReady(); sync.run(); renderShell(); }));
}

// เตือนเรื่องสำรองข้อมูลบนแถบสถานะ (เฉพาะผู้ที่เห็นเมนูตั้งค่า)
//   โหมดเครื่องเดียว: ไม่ได้ดาวน์โหลดไฟล์สำรองเกินจำนวนวันที่ตั้งไว้ → กดเพื่อสำรองทันที
//   โหมด server: ยังไม่ได้เปิดสำรองอัตโนมัติ หรือสำรองครั้งล่าสุดเกิน 2 วัน → ไปหน้าตั้งค่า
async function backupPill(el, server) {
  if (!auth.can('settings.view')) return;
  let html = '', act = null;
  if (!server) {
    const age = await sec.backupAgeDays(), lim = Number(sec.cfg().remindDays) || 7;
    if (age >= lim && !db.isEmpty()) { html = `⚠️ ไม่ได้สำรองข้อมูล ${age} วัน — กดเพื่อสำรอง`; act = async () => { await sec.downloadBackup(); toast('ดาวน์โหลดไฟล์สำรองแล้ว เก็บไฟล์ไว้นอกเครื่องนี้ด้วย', 4000); renderStatus(sync.status()); }; }
  } else {
    const s = await sec.serverStatus();
    const old = s?.lastBackup ? (Date.now() - new Date(s.lastBackup).getTime()) / 864e5 : 99;
    if (s && !s.backupOn) html = '⚠️ ยังไม่ได้เปิดสำรองข้อมูลอัตโนมัติ';
    else if (s && old > 2) html = `⚠️ สำรองอัตโนมัติไม่ทำงานมา ${Math.floor(old)} วัน`;
    act = () => nav.go('settings');
  }
  el.querySelector('[data-bk]')?.remove();
  if (!html || !el.isConnected) return;
  const b = document.createElement('button'); b.className = 'pill bad pay-btn'; b.dataset.bk = '1'; b.textContent = html; b.onclick = act;
  el.prepend(b);
}

// บันทึกไม่ได้เพราะสิทธิ์ (ดูอย่างเดียว / นอกชั้น-โซนที่รับผิดชอบ) → แจ้งผู้ใช้แทนการเงียบ
addEventListener('unhandledrejection', e => { if (e.reason?.code === 'READONLY') { e.preventDefault(); toast('🔒 ' + e.reason.message, 4000); } });

boot().catch(e => { console.error(e); $('#root').innerHTML = `<div class="boot">เปิดแอปไม่สำเร็จ: ${esc(e.message)}</div>`; });
