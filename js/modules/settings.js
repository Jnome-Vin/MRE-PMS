// ตั้งค่า (Administrator, Manager): อัตราค่าบริการ, ข้อมูลอาคาร, เชื่อม Google, LINE OA, จัดการคลัง (Admin), สำรองข้อมูล
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import * as api from '../core/api.js';
import * as sync from '../core/sync.js';
import { getApiUrl, setApiUrl, APP, SITE, FLOOR } from '../core/config.js';
import { esc, toast, openModal, closeModal, confirmBox, thDate, fmt0 } from '../core/ui.js';
import { randomString } from '../core/auth.js';
import { printInFrame } from '../core/printframe.js';
import * as sec from '../core/security.js';
import { isServerMode } from '../core/config.js';

const num = (el, id) => Number(el.querySelector('#' + id).value) || 0;
const val = (el, id) => el.querySelector('#' + id).value.trim();

// กล่องยืนยันด้วยรหัสผ่าน (ซ้อนบนหน้าต่างที่เปิดอยู่) → { newCode } เมื่อรหัสถูก · null เมื่อยกเลิก
function passwordPrompt(title, html, extra = '') {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `<form class="card" style="width:min(440px,92vw);padding:18px" autocomplete="off">
      <h3 style="margin:0 0 8px">🔐 ${esc(title)}</h3><p style="margin:0 0 10px">${html}</p>
      <label style="display:block;font-size:13px;color:var(--muted)">รหัสผ่านของคุณ (${esc(auth.current()?.email || '')})</label>
      <input type="password" id="pp-pw" class="input" style="width:100%;margin-top:4px" autocomplete="current-password">${extra}
      <div class="err" id="pp-err" style="margin-top:6px"></div>
      <div class="form-acts"><button type="button" class="btn" id="pp-x">ยกเลิก</button><button class="btn danger" id="pp-ok">ยืนยันยกเลิกการผูก</button></div></form>`;
    document.body.appendChild(ov);
    const pw = ov.querySelector('#pp-pw'); pw.focus();
    const close = v => { ov.remove(); resolve(v); };
    ov.querySelector('#pp-x').onclick = () => close(null);
    ov.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const btn = ov.querySelector('#pp-ok'); btn.disabled = true;
      const ok = await auth.verifyPassword(pw.value);
      btn.disabled = false;
      if (!ok) { ov.querySelector('#pp-err').textContent = 'รหัสผ่านไม่ถูกต้อง'; pw.select(); return; }
      close({ newCode: !!ov.querySelector('#pp-new')?.checked });
    };
  });
}

function roomForm(r, done) {
  const isNew = !r;
  r = r || { kind: 'room', type: SITE.unitType || '', rent: 0, floor: 1 };
  const box = openModal(`<h3>${isNew ? 'เพิ่มคลัง' : 'แก้ไขคลัง ' + r.id}</h3>
    <form class="form">
      <label class="req">รหัสคลัง</label><input id="r-id" value="${esc(r.id || '')}" ${isNew ? '' : 'disabled'} placeholder="เช่น 210 หรือ A-01">
      <label class="req">${FLOOR} (ตัวเลข)</label><input id="r-floor" type="number" min="1" max="99" value="${r.floor || 1}">
      <label>ประเภทพื้นที่</label><select id="r-kind">${[['room', 'คลัง'], ['kiosk', 'Kiosk / ร้านค้า'], ['office', 'สำนักงาน'], ['laundry', 'ห้องซักผ้า']].map(([k, v]) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>ชนิดคลัง</label><input id="r-type" value="${esc(r.type || '')}" list="r-types" placeholder="เช่น แอร์ / พัดลม / โกดัง 500 ตร.ม."><datalist id="r-types"><option>แอร์</option><option>พัดลม</option><option>ส่วนกลาง</option></datalist>
      <label>พื้นที่ (ตร.ม.)</label><input id="r-area" type="number" min="0" step="1" value="${r.area ?? ''}" placeholder="ใช้ในสัญญาเช่า และการ์ดบนผัง">
      <label>ค่าเช่า/เดือน</label><input id="r-rent" type="number" min="0" step="100" value="${r.rent || 0}">
      <label>ค่าน้ำเฉพาะคลัง</label><input id="r-w" type="number" min="0" step="0.5" value="${r.wRate ?? ''}" placeholder="ว่าง = ใช้อัตรามาตรฐาน">
      <label>ค่าไฟเฉพาะคลัง</label><input id="r-e" type="number" min="0" step="0.5" value="${r.eRate ?? ''}" placeholder="ว่าง = ใช้อัตรามาตรฐาน">
      <label>ชื่อเรียก</label><input id="r-label" value="${esc(r.label || '')}">
      <label>ยกเว้นน้ำไฟขั้นต่ำ</label><label style="color:inherit"><input type="checkbox" id="r-nomin" ${r.noMin ? 'checked' : ''} style="width:auto"> ยกเว้น</label>
      <div class="err full" id="rerr"></div></form>
    <div class="form-acts">${!isNew ? '<button class="btn danger" id="rdel" style="margin-right:auto">ลบคลัง</button>' : ''}<button class="btn" id="rx">ยกเลิก</button><button class="btn pri" id="rok">บันทึก</button></div>`);
  box.querySelector('#rx').onclick = closeModal;
  box.querySelector('#rok').onclick = async () => {
    const id = val(box, 'r-id');
    if (!/^[A-Za-z0-9ก-๙._/-]{1,12}$/.test(id)) return box.querySelector('#rerr').textContent = 'รหัสต้องเป็นตัวอักษร/ตัวเลข ไม่เกิน 12 ตัว ไม่มีช่องว่าง (ใช้ - . _ / ได้)';
    if (isNew && db.get('rooms', id)) return box.querySelector('#rerr').textContent = 'มีคลังนี้อยู่แล้ว';
    const w = val(box, 'r-w'), e = val(box, 'r-e'), area = val(box, 'r-area');
    await db.put('rooms', { ...r, id, floor: Math.max(1, num(box, 'r-floor') || 1), kind: val(box, 'r-kind'), type: val(box, 'r-type'), rent: num(box, 'r-rent'), area: area === '' ? null : +area,
      wRate: w === '' ? null : +w, eRate: e === '' ? null : +e, label: val(box, 'r-label'), noMin: box.querySelector('#r-nomin').checked });
    closeModal(); toast('บันทึกคลังแล้ว'); done();
  };
  box.querySelector('#rdel')?.addEventListener('click', async () => {
    if (M.tenantOf(r.id)) return toast('คลังนี้มีผู้เช่าอยู่ ต้องย้ายออกก่อน');
    if (!await confirmBox(`ลบคลัง ${r.id}? (ประวัติบิลยังอยู่)`, 'ลบคลัง')) return;
    await db.remove('rooms', r.id); closeModal(); done();
  });
}

export default {
  id: 'settings', title: 'ตั้งค่า', icon: '⚙️', perm: 'settings.view',
  async render(el, nav) {
    const rt = M.rates(), p = M.property(), admin = auth.can('rooms.manage'), sc = sec.cfg();
    const auto = await sync.autoUpload();
    const links = db.all('lineLinks');
    const lineAdmin = auth.current()?.role === 'admin';   // server ให้แก้ข้อมูล LINE ได้เฉพาะ Administrator
    el.innerHTML = `
    <div class="top"><h2>ตั้งค่า</h2><span class="note">เวอร์ชัน ${APP.version}</span></div>
    <div class="grid2">
      <div class="card"><b>อัตราค่าบริการ</b>
        <form class="form" style="margin-top:12px">
          <label>ค่าน้ำ (บาท/หน่วย)</label><input id="water" type="number" step="0.5" value="${rt.water}">
          <label>ค่าไฟ (บาท/หน่วย)</label><input id="elec" type="number" step="0.5" value="${rt.elec}">
          <label>ค่าที่จอดมาตรฐาน</label><input id="pfee" type="number" step="50" value="${rt.parkingFee}">
          <label>ค่าตู้เย็นมาตรฐาน</label><input id="ffee" type="number" step="50" value="${rt.fridgeFee}">
          <label>ครบกำหนดชำระ (วันที่)</label><input id="due" type="number" min="1" max="28" value="${rt.dueDay}">
          <label>ผู้พักร่วมสูงสุด/คลัง</label><input id="maxocc" type="number" min="0" max="10" value="${rt.maxOccupants ?? 2}">
          <label>น้ำ/ไฟ ขั้นต่ำ</label><label style="color:inherit"><input type="checkbox" id="minon" ${rt.minOn ? 'checked' : ''} style="width:auto"> ใช้ขั้นต่ำ</label>
          <label>น้ำประปา ขั้นต่ำ</label><span><input id="mwu" type="number" min="0" value="${rt.minWaterUnits ?? 1}" style="width:70px"> หน่วย × อัตราตามสัญญา</span>
          <label>ไฟฟ้า ขั้นต่ำ</label><span><input id="meu" type="number" min="0" value="${rt.minElecUnits ?? 1}" style="width:70px"> หน่วย × อัตราตามสัญญา</span>
          <p class="note full" style="margin:0">ใช้น้อยกว่าขั้นต่ำ หรือไม่ได้ใช้เลย (0 หน่วย) คิดเท่าขั้นต่ำ เช่น ขั้นต่ำ 1 หน่วย อัตราน้ำ ฿15 → คิด ฿15</p>
        </form>
        <p class="note">มีผลกับบิลที่สร้างใหม่ · คลังที่มีอัตราเฉพาะ หรือยกเว้นขั้นต่ำ ตั้งที่ "จัดการคลัง"</p>
        <div class="form-acts"><button class="btn pri" id="saveRates">บันทึกอัตรา</button></div></div>

      <div class="card"><b>ข้อมูลโครงการ (แสดงบนบิลและสัญญา)</b>
        <form class="form" style="margin-top:12px">
          <label>ชื่อโครงการ</label><input id="pname" value="${esc(p.name)}">
          <label>ชื่ออังกฤษ</label><input id="pnameen" value="${esc(p.nameEn)}">
          <label>ชื่อนิติบุคคลผู้ให้เช่า (ใช้ในสัญญา)</label><input id="plegal" value="${esc(p.legalName ?? SITE.legalName ?? '')}" placeholder="เว้นว่าง = ใช้ชื่อโครงการ เช่น บริษัท … จำกัด">
          <label>ที่อยู่</label><input id="paddr" value="${esc(p.address)}">
          <label>โทร</label><input id="pphone" value="${esc(p.phone)}">
          <label>เลขผู้เสียภาษี</label><input id="ptax" value="${esc(p.taxId)}">
          <label>ที่อยู่ (อังกฤษ)</label><input id="paddren" value="${esc(p.addressEn)}">
          <label>บัญชีรับเงิน (แสดงในสัญญาเช่า)</label><input id="pbank" value="${esc(p.bankText)}" placeholder="เช่น ชื่อบัญชี … ธนาคาร … เลขที่ …">
          <label>รหัส Wi-Fi (แสดงในสัญญาเช่า เว้นว่างได้)</label><input id="pwifi" value="${esc(p.wifi)}">
          <label>PromptPay</label><input id="ppp" value="${esc(p.promptpay)}">
          <label>หมายเหตุบิล (ไทย)</label><input id="pnote" value="${esc(p.billNote)}">
          <label>หมายเหตุบิล (อังกฤษ)</label><input id="pnoteen" value="${esc(p.billNoteEn)}">
          <label>อ่านสลิปด้วย Claude</label><label style="color:inherit"><input type="checkbox" id="pclaude" ${p.claudeSlip ? 'checked' : ''} style="width:auto"> แสดงปุ่ม "🤖 Claude อ่าน" สำหรับสลิปและเลขมิเตอร์ (แม่นกว่า มีค่าใช้จ่าย · ต้องใส่ API key ในชีต) — ปกติใช้แบบฟรี</label>
          <label>QR ชำระเงินบนบิล</label><label style="color:inherit"><input type="checkbox" id="pqr" ${p.showQr !== false ? 'checked' : ''} style="width:auto"> แสดง (ไฟล์ app/assets/payment-qr.png)</label>
        </form>
        <div class="form-acts"><button class="btn pri" id="saveProp">บันทึก</button></div></div>

      <div class="card"><b>เชื่อม Google Sheets / Drive</b>
        <p class="note">วาง URL ของ Web App ที่ได้จากการ Deploy Apps Script (ดูขั้นตอนใน docs/SETUP.md)</p>
        <div class="toolbar"><input class="input" id="apiurl" style="flex:1;min-width:220px" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(getApiUrl())}" ${admin ? '' : 'disabled'}>
          ${admin ? '<button class="btn" id="testApi">ทดสอบ</button><button class="btn pri" id="saveApi">บันทึก</button>' : ''}</div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="auto" ${auto ? 'checked' : ''}> อัปโหลดอัตโนมัติเมื่อมีสัญญาณอินเทอร์เน็ต</label>
        <p class="note">ถ้าปิด ข้อมูลจะรอในเครื่องจนกว่าจะกด "☁️ อัปโหลด" ที่แถบด้านบน</p>
        ${admin ? '<div class="form-acts"><button class="btn" id="pushAll">อัปโหลดข้อมูลทั้งหมดในเครื่องขึ้น Google Sheet</button></div>' : ''}</div>

      <div class="card"><b>LINE OA</b> <span class="pill ${links.length ? 'ok' : 'idle'}">ผูกแล้ว ${links.filter(l => l.active !== false).length} คลัง</span>
        <p class="note">ผู้เช่าเพิ่มเพื่อน LINE OA แล้วพิมพ์ <b>รหัสคลัง-รหัส</b> เช่น <code>304-482913</code> ระบบจะผูกบัญชีกับคลังและตั้งชื่อเป็น "304-ชื่อผู้เช่า" · Channel access token ตั้งใน Apps Script (Script properties) ไม่เก็บในแอป</p>
        ${links.some(l => l.active !== false) ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>คลัง</th><th>ชื่อในระบบ</th><th>ชื่อ LINE</th><th>ผูกเมื่อ</th>${lineAdmin ? '<th></th>' : ''}</tr></thead><tbody>
          ${links.filter(l => l.active !== false).sort((a, b) => String(a.room).localeCompare(String(b.room))).map(l => `<tr><td><b>${esc(l.room)}</b></td><td>${esc(l.displayName || '')}</td><td>${esc(l.lineName || '-')}</td>
            <td class="note">${l.linkedAt ? thDate(l.linkedAt) : '-'}</td>${lineAdmin ? `<td><button class="btn sm danger" data-unlink="${esc(l.id)}">ยกเลิกการผูก</button></td>` : ''}</tr>`).join('')}</tbody></table>` : ''}
        <div class="form-acts"><button class="btn" id="codes">ดู/พิมพ์รหัสผูก LINE ของแต่ละคลัง</button></div></div>

      <div class="card"><b>จัดการคลัง</b> ${admin ? '' : '<span class="pill idle">เฉพาะ Administrator</span>'}
        <div class="chips" style="margin-top:10px">${M.rooms().map(r => `<button class="chip" data-room="${r.id}" ${admin ? '' : 'disabled'} title="กดเพื่อแก้ไข (พื้นที่ ค่าเช่า อัตราน้ำไฟ)">${r.id}${Number(r.area) ? ` <small class="note">${fmt0(r.area)} ตร.ม.</small>` : ''}</button>`).join('')}</div>
        ${admin ? '<div class="form-acts"><button class="btn pri" id="addRoom">+ เพิ่มคลัง</button></div>' : ''}</div>

      <div class="card"><b>🔐 ความปลอดภัย</b> ${admin ? '' : '<span class="pill idle">แก้ได้เฉพาะ Administrator</span>'}
        <form class="form" style="margin-top:12px">
          <label>ล็อกหน้าจอเมื่อไม่ได้ใช้งาน</label><select id="sec-idle" ${admin ? '' : 'disabled'}>${[[0, 'ไม่ล็อก'], [5, '5 นาที'], [10, '10 นาที'], [15, '15 นาที'], [30, '30 นาที'], [60, '1 ชั่วโมง']].map(([v, l]) => `<option value="${v}" ${Number(sc.idleMin) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${isServerMode() ? '' : `<label>เตือนให้สำรองข้อมูลเมื่อเกิน</label><select id="sec-remind" ${admin ? '' : 'disabled'}>${[3, 7, 14, 30].map(v => `<option value="${v}" ${Number(sc.remindDays) === v ? 'selected' : ''}>${v} วัน</option>`).join('')}</select>`}
        </form>
        <p class="note">• ใส่รหัสผ่านผิด ${APP.maxFails} ครั้ง บัญชีถูกล็อก ${APP.lockMinutes} นาที — Administrator ปลดล็อกได้ที่เมนู ผู้ใช้งาน<br>
          • รหัสผ่านต้องมี${sec.PASSWORD_HINT}${isServerMode() ? ' · เปลี่ยนรหัสผ่านแล้ว เครื่องอื่นที่เข้าสู่ระบบค้างไว้ต้องเข้าใหม่' : ''}<br>
          • การเข้าสู่ระบบและการเพิ่ม/แก้/ลบข้อมูลทุกครั้ง ถูกบันทึกที่เมนู ประวัติการใช้งาน (เฉพาะ Administrator)</p>
        <div id="secstat" class="note" style="line-height:1.8"></div>
        <div class="form-acts">${admin && isServerMode() ? '<button class="btn" id="bkNow">สำรองข้อมูลขึ้น Google Drive เดี๋ยวนี้</button>' : ''}${admin ? '<button class="btn pri" id="saveSec">บันทึก</button>' : ''}</div></div>

      <div class="card"><b>สำรอง / นำเข้าข้อมูล</b>
        <p class="note">ไฟล์สำรองเป็น JSON (ไม่รวมรูปบัตร) — มีข้อมูลผู้เช่า ต้องเก็บในที่ปลอดภัยนอกเครื่องนี้ และห้ามอัปโหลดขึ้น GitHub<br><span id="bkinfo"></span></p>
        <div class="form-acts">${admin ? '<label class="btn" for="impf">นำเข้าข้อมูลจากไฟล์…</label><input id="impf" type="file" accept=".json,application/json" hidden>' : ''}
          <button class="btn" id="backup">ดาวน์โหลดไฟล์สำรอง</button></div></div>
    </div>`;
    const re = () => this.render(el, nav);
    const $e = s => el.querySelector(s);

    $e('#saveRates').onclick = async () => { await db.put('settings', { ...rt, id: 'rates', water: num(el, 'water'), elec: num(el, 'elec'), parkingFee: num(el, 'pfee'), fridgeFee: num(el, 'ffee'), dueDay: num(el, 'due') || 5, maxOccupants: num(el, 'maxocc'),
      minOn: $e('#minon').checked, minWaterUnits: num(el, 'mwu'), minElecUnits: num(el, 'meu') }); toast('บันทึกอัตราแล้ว'); };
    $e('#saveProp').onclick = async () => { await db.put('settings', { ...p, id: 'property', name: val(el, 'pname'), nameEn: val(el, 'pnameen'), legalName: val(el, 'plegal'),address: val(el, 'paddr'), addressEn: val(el, 'paddren'), bankText: val(el, 'pbank'), wifi: val(el, 'pwifi'), phone: val(el, 'pphone'), taxId: val(el, 'ptax'),
      promptpay: val(el, 'ppp'), billNote: val(el, 'pnote'), billNoteEn: val(el, 'pnoteen'), showQr: $e('#pqr').checked, claudeSlip: $e('#pclaude').checked }); toast('บันทึกแล้ว'); };
    $e('#auto').onchange = async e => { await sync.autoUpload(e.target.checked); toast(e.target.checked ? 'เปิดอัปโหลดอัตโนมัติ' : 'ปิดอัปโหลดอัตโนมัติ'); };
    $e('#testApi')?.addEventListener('click', async () => {
      const old = getApiUrl(); setApiUrl(val(el, 'apiurl'));
      try { const r = await api.call('ping'); toast(`เชื่อมต่อสำเร็จ: ${r.sheet || 'OK'}`); } catch (e) { toast('เชื่อมต่อไม่สำเร็จ: ' + e.message, 4000); }
      setApiUrl(old);
    });
    $e('#saveApi')?.addEventListener('click', async () => {
      const u = val(el, 'apiurl');
      if (u && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) return toast('URL ต้องเป็น https://script.google.com/macros/s/…/exec');
      if (!await confirmBox(u ? 'เปลี่ยนการเชื่อมต่อ? ผู้ใช้ทุกคนต้องเข้าสู่ระบบใหม่ด้วยบัญชีบน Google Sheet' : 'ยกเลิกการเชื่อม Google และกลับไปโหมดเครื่องเดียว?')) return;
      setApiUrl(u); auth.logout(); location.reload();
    });
    $e('#pushAll')?.addEventListener('click', async () => {
      if (!getApiUrl()) return toast('ยังไม่ได้เชื่อม Google');
      if (!await confirmBox('อัปโหลดข้อมูลทั้งหมด (คลัง ผู้เช่า ที่จอด บิล) ขึ้น Google Sheet?', 'อัปโหลด')) return;
      await sync.queueEverything(); sync.run(); toast('เข้าคิวอัปโหลดแล้ว');
    });
    // ยกเลิกการผูก LINE (เช่น บัญชีทดสอบ ผู้เช่าย้ายออก เปลี่ยนเครื่อง) — ผูกใหม่ได้ด้วยการพิมพ์รหัสคลังในแชท OA อีกครั้ง
    el.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => {
      const l = links.find(x => x.id === b.dataset.unlink); if (!l) return;
      if (!await confirmBox(`ยกเลิกการผูก LINE "${l.lineName || l.displayName || ''}" กับคลัง ${l.room}? บัญชีนี้จะไม่ได้รับบิลของคลังนี้อีก`, 'ยกเลิกการผูก')) return re();
      await db.put('lineLinks', { ...l, active: false, unlinkedAt: new Date().toISOString() });
      toast(`ยกเลิกการผูก LINE คลัง ${l.room} แล้ว`); re();
    });
    $e('#codes').onclick = async () => {
      // สร้างรหัสผูก LINE ให้คลังที่ยังไม่มี: คลัง/Kiosk ทุกคลัง + คลังประเภทอื่นที่มีผู้เช่า (เช่น 102 ห้องซักผ้า)
      for (const r of M.rooms().filter(r => r.kind === 'room' || r.kind === 'kiosk' || M.tenantOf(r.id))) if (!r.lineCode) await db.put('rooms', { ...r, lineCode: randomString(6, '0123456789') });
      // ข้อความชวนผู้เช่าผูก LINE (รหัสอยู่บรรทัดของตัวเอง — webhook รับได้แม้ผู้เช่าคัดลอกข้อความทั้งหมดส่งกลับมา)
      // ผู้เช่าต่างชาติ (ภาษาบนบิล = อังกฤษ) ได้ข้อความภาษาอังกฤษ
      const msgLines = r => M.tenantOf(r.id)?.lang === 'en'
        ? [`Hello from ${M.property().nameEn || M.property().name}`, `-- Regarding Room ${r.id} --`, "Please type the number below and send it back to link your LINE with our billing bot.", '', `${r.id}-${r.lineCode}`]
        : [`สวัสดีค่ะ จาก ${M.property().name}`, `-- ติดต่อกับคลัง ${r.id} ค่ะ --`, 'รบกวนพิมพ์ตัวเลขด้านล่างส่งกลับมาเพื่อ ผูกกับ Bot ของอพาร์ทเม้นท์ค่ะ', '', `${r.id}-${r.lineCode}`];
      const msgFor = r => msgLines(r).join('\n');
      // แบบมีสี (รหัสสีแดง) สำหรับโปรแกรมที่รับข้อความมีรูปแบบ — แชท LINE จะแสดงเป็นตัวอักษรปกติ
      const msgHtml = r => { const l = msgLines(r); return l.slice(0, -1).map(esc).join('<br>') + `<br><b style="color:#e00000">${esc(l[l.length - 1])}</b>`; };
      const box = openModal(`<h3>รหัสผูก LINE OA</h3><p class="note">ให้ผู้เช่าส่งข้อความ <b>รหัสคลัง-รหัส</b> มาที่ LINE OA · กด 📋 เพื่อคัดลอกข้อความไปวางในแชทของผู้เช่า</p>
        <div class="scroll" style="max-height:50vh"><table class="tbl"><thead><tr><th>คลัง</th><th>ผู้เช่า</th><th>ข้อความที่ต้องส่ง</th><th>สถานะ</th><th></th></tr></thead><tbody>
        ${M.rooms().filter(r => r.lineCode).map(r => { const l = M.lineLinkOf(r.id); return `<tr><td>${r.id}</td><td>${esc(M.tenantOf(r.id)?.name || '-')}${M.tenantOf(r.id)?.lang === 'en' ? ' <span class="pill idle" title="ผู้เช่าต่างชาติ — ข้อความเป็นภาษาอังกฤษ">EN</span>' : ''}</td><td><code style="color:#e00000;font-weight:700">${r.id}-${r.lineCode}</code></td><td>${l ? '✅ ' + esc(l.displayName || '') : '-'}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-copy="${r.id}" title="คัดลอกข้อความพร้อมรหัส">📋 คัดลอก</button>${l && auth.current()?.role === 'admin' ? ` <button class="btn sm" data-unlink="${r.id}" style="color:var(--bad)" title="ยกเลิกการผูก LINE ของคลังนี้ (ต้องใส่รหัสผ่าน)">🔓 ยกเลิกการผูก</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div><div class="form-acts"><button class="btn" id="cx">ปิด</button><button class="btn pri" id="cp">พิมพ์ใบแจ้งรหัส</button></div>`, { wide: true });
      // ยกเลิกการผูก LINE: ยืนยันด้วยรหัสผ่านของผู้ใช้ที่เข้าสู่ระบบ · เลือกเปลี่ยนรหัสคลังใหม่ได้ (LINE เดิมผูกกลับด้วยรหัสเก่าไม่ได้)
      box.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => {
        const room = b.dataset.unlink, links = db.all('lineLinks').filter(l => l.room === room && l.active !== false);
        const ok = await passwordPrompt(`ยกเลิกการผูก LINE คลัง ${room}`,
          `LINE ที่ผูกอยู่: <b>${links.map(l => esc(l.displayName || l.lineName || '-')).join(', ')}</b><br>หลังยกเลิก บิลและสัญญาจะไม่ถูกส่งเข้า LINE นี้อีก`,
          '<label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="pp-new" checked> เปลี่ยนรหัสผูกของคลังใหม่ (LINE เดิมใช้รหัสเก่าผูกกลับไม่ได้)</label>');
        if (!ok) return;
        const at = new Date().toISOString(), by = auth.current()?.email || '';
        for (const l of links) await db.put('lineLinks', { ...l, active: false, unlinkedAt: at, unlinkedBy: by });
        if (ok.newCode) { const r = db.get('rooms', room); await db.put('rooms', { ...r, lineCode: randomString(6, '0123456789') }); }
        toast(`ยกเลิกการผูก LINE คลัง ${room} แล้ว${ok.newCode ? ' · เปลี่ยนรหัสใหม่แล้ว' : ''}`, 3500);
        $e('#codes').onclick();   // แสดงตารางใหม่
      });
      box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
        const r = db.get('rooms', b.dataset.copy);
        try {
          // คัดลอกแบบมีสีก่อน ถ้าเบราว์เซอร์ไม่ยอม ใช้ข้อความธรรมดา
          try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([msgFor(r)], { type: 'text/plain' }), 'text/html': new Blob([msgHtml(r)], { type: 'text/html' }) })]); }
          catch { await navigator.clipboard.writeText(msgFor(r)); }
          b.textContent = '✔ คัดลอกแล้ว'; toast(`คัดลอกข้อความคลัง ${r.id} แล้ว — ไปวางในแชท LINE ของผู้เช่าได้เลย`); }
        catch { toast('คัดลอกไม่ได้ — เลือกข้อความในช่องรหัสแล้วกด Ctrl+C แทน', 4000); }
      });
      box.querySelector('#cx').onclick = closeModal;
      box.querySelector('#cp').onclick = () => {
        printInFrame(M.rooms().filter(r => r.lineCode && M.tenantOf(r.id)).map(r => M.tenantOf(r.id).lang === 'en'
          ? `<div class="bill"><h4>${esc(M.property().nameEn || M.property().name)} — Room ${r.id}</h4>
          <p>Receive your bills via LINE: add the building's LINE OA as a friend, then send this number</p><p style="font-size:28px;font-family:monospace;color:#e00000"><b>${r.id}-${r.lineCode}</b></p></div>`
          : `<div class="bill"><h4>${esc(M.property().name)} — คลัง ${r.id}</h4>
          <p>รับบิลค่าเช่าทาง LINE: เพิ่มเพื่อน LINE OA ของอาคาร แล้วพิมพ์ข้อความนี้</p><p style="font-size:28px;font-family:monospace;color:#e00000"><b>${r.id}-${r.lineCode}</b></p></div>`).join(''));
      };
    };
    el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => roomForm(db.get('rooms', b.dataset.room), re));
    $e('#addRoom')?.addEventListener('click', () => roomForm(null, re));
    $e('#impf')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      let data;
      try { data = JSON.parse((await f.text()).replace(/^﻿/, '')); } catch { return toast('อ่านไฟล์ไม่ได้'); }
      if (!['rea-pms', 'map-pms'].includes(data.format)) return toast('ไม่ใช่ไฟล์ข้อมูล REA-PMS');
      const cols = db.SYNC_COLS.filter(c => Array.isArray(data[c]));
      if (!await confirmBox(`นำเข้า ${cols.map(c => `${c} ${data[c].length}`).join(', ')} รายการ? รายการที่ id ซ้ำจะถูกแทนที่`, 'นำเข้า')) return;
      for (const c of cols) await db.putMany(c, data[c]);
      await M.migrateData();
      if (getApiUrl()) { await sync.queueEverything(); sync.run(); }
      toast('นำเข้าข้อมูลแล้ว'); re();
    });
    $e('#backup').onclick = async () => { await sec.downloadBackup(); toast('ดาวน์โหลดไฟล์สำรองแล้ว — เก็บไฟล์ไว้นอกเครื่องนี้', 3500); re(); };
    // ----- ความปลอดภัย -----
    $e('#saveSec')?.addEventListener('click', async () => {
      await db.put('settings', { ...(db.get('settings', 'security') || {}), id: 'security', idleMin: num(el, 'sec-idle'), remindDays: $e('#sec-remind') ? num(el, 'sec-remind') : sc.remindDays });
      toast('บันทึกการตั้งค่าความปลอดภัยแล้ว');
    });
    const thTime = iso => new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    sec.lastBackupAt().then(async at => { const s = $e('#bkinfo'); if (s) s.textContent = at ? `ดาวน์โหลดไฟล์สำรองล่าสุดบนเครื่องนี้: ${thTime(at)}` : 'เครื่องนี้ยังไม่เคยดาวน์โหลดไฟล์สำรอง'; });
    const showStat = async force => {
      const box = $e('#secstat'); if (!box) return;
      if (!isServerMode()) { box.innerHTML = 'โหมดเครื่องเดียว: ไม่มีการสำรองอัตโนมัติ — กด "ดาวน์โหลดไฟล์สำรอง" ด้านล่างเป็นประจำ ระบบจะเตือนที่แถบด้านบนเมื่อเกินกำหนด'; return; }
      try {
        const s = await sec.serverStatus(force);
        if (!s) { box.textContent = 'อ่านสถานะสำรองอัตโนมัติไม่ได้ (ต้องออนไลน์)'; return; }
        box.innerHTML = `สำรองอัตโนมัติทุกคืน (Google Drive → REA-PMS → สำรองข้อมูล เก็บ ${s.keepDays} วัน): ${s.backupOn ? '<span class="pill ok">เปิดอยู่</span>' : '<span class="pill bad">ยังไม่ได้เปิด</span> — เปิดที่ Google Sheet เมนู REA-PMS → 5) เปิดสำรองข้อมูลอัตโนมัติทุกคืน'}<br>สำรองครั้งล่าสุด: ${s.lastBackup ? thTime(s.lastBackup) : 'ยังไม่เคย'}`;
      } catch (x) { box.textContent = x.message; }
    };
    showStat(false);
    $e('#bkNow')?.addEventListener('click', async e => {
      e.target.disabled = true; toast('กำลังสำรองข้อมูล…');
      try { const r = await sec.backupNow(); toast('สำรองแล้ว: ' + r.name, 4000); await showStat(true); } catch (x) { toast(x.message, 4000); }
      e.target.disabled = false;
    });  },
};
