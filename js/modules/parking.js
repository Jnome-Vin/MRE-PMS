// ผังที่จอดรถแบบตาราง แยกตามโซน — เชื่อมกับหน่วยเช่า (คลิกช่อง → กำหนดผู้เช่า/ทะเบียน, เลือกหน่วยเช่า → ไฮไลต์ช่อง)
// รหัสช่องจอด = "โซน-ลำดับ" เช่น A-1, CAR-2 (โซนชื่อ CAR = รถยนต์ นอกนั้นถือเป็นมอเตอร์ไซค์)
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import { esc, toast, openModal, closeModal, confirmBox } from '../core/ui.js';

let hl = [];
function editSlot(s, done) {
  const rooms = M.rooms().filter(r => M.tenantOf(r.id));
  const car = s.zone === 'CAR', t = s.room && M.tenantOf(s.room);
  const box = openModal(`<h3>${car ? '🚗' : '🏍️'} ช่องจอด ${s.id}</h3>
    <p class="note" style="margin-top:-8px">${s.room ? `ปัจจุบัน: คลัง ${s.room}${t ? ' · ' + esc(t.name) : ''}` : 'ช่องนี้ว่างอยู่'}</p>
    <form class="form" id="sf" onsubmit="return false">
      <label>คลัง</label><select id="s-room"><option value="">— ว่าง —</option>${rooms.map(r => `<option value="${r.id}" ${r.id === s.room ? 'selected' : ''}>${r.id} · ${esc(M.tenantOf(r.id).name)}</option>`).join('')}</select>
      <label>เลขทะเบียน</label><input id="s-plate" value="${esc(s.plate)}" placeholder="เช่น 1กข-1234">
      <label>ยี่ห้อ/รุ่น/สี</label><input id="s-veh" value="${esc(s.vehicle)}" placeholder="เช่น Honda Wave สีน้ำเงิน">
    </form>
    <p class="note">ค่าที่จอดรายเดือนตั้งที่ข้อมูลผู้เช่า (แก้ไขผู้เช่า → ค่าที่จอดรถ/เดือน)</p>
    <div class="form-acts">${s.room ? '<button class="btn danger" id="sclear" style="margin-right:auto">ยกเลิกการจอด</button>' : ''}
      ${!s.room && auth.can('rooms.manage') ? '<button class="btn danger" id="sdel" style="margin-right:auto">ลบช่องจอดนี้</button>' : ''}<button class="btn" id="sx">ปิด</button><button class="btn pri" id="sok">บันทึก</button></div>`);
  box.querySelector('#s-room').focus();
  box.querySelector('#sx').onclick = closeModal;
  box.querySelector('#sok').onclick = async () => {
    const room = box.querySelector('#s-room').value;
    await db.put('slots', { ...s, room, plate: room ? box.querySelector('#s-plate').value.trim() : '', vehicle: room ? box.querySelector('#s-veh').value.trim() : '' });
    closeModal(); toast(room ? `ช่อง ${s.id} → คลัง ${room}` : `ช่อง ${s.id} ว่างแล้ว`); done();
  };
  box.querySelector('#sdel')?.addEventListener('click', async () => { if (!await confirmBox(`ลบช่องจอด ${s.id}?`, 'ลบช่องจอด')) return; await db.remove('slots', s.id); toast('ลบแล้ว'); done(); });
  box.querySelector('#sclear')?.addEventListener('click', async () => {
    if (!await confirmBox(`ยกเลิกการจอดช่อง ${s.id} ของคลัง ${s.room}?`, 'ยกเลิกการจอด')) return;
    await db.put('slots', { ...s, room: '', plate: '', vehicle: '' });
    toast(`ช่อง ${s.id} ว่างแล้ว`); done();
  });
}

export default {
  id: 'parking', title: 'ผังที่จอดรถ', icon: '🏍️',
  render(el, nav, arg) {
    if (arg?.highlight) { hl = arg.highlight; arg.highlight = null; }
    const slots = db.all('slots').sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const room = hl.find(h => db.get('rooms', h)), admin = auth.can('rooms.manage');
    const zones = [...new Set(slots.map(s => s.zone))];
    const re = () => this.render(el, nav);
    el.innerHTML = `
    <div class="top"><h2>ผังที่จอดรถ</h2>
      <select class="input" id="pick"><option value="">ไฮไลต์ที่จอดของคลัง…</option>${M.rooms().filter(r => M.tenantOf(r.id)).map(r => `<option ${r.id === room ? 'selected' : ''}>${r.id}</option>`).join('')}</select>
      ${admin ? '<button class="btn" id="addslot">+ เพิ่มช่องจอด</button>' : ''}</div>
    <div class="legend"><span><i style="background:#dbeafa;border:1px solid #7f8c99"></i>มอเตอร์ไซค์ (มีเจ้าของ)</span><span><i style="background:#d9efe2;border:1px solid #7f8c99"></i>รถยนต์ (โซน CAR)</span><span><i style="background:#fff;border:1px dashed #7f8c99"></i>ช่องว่าง</span></div>
    <div class="card">${slots.length ? zones.map(z => `<div class="pk-zone">โซน ${esc(z)}</div><div class="pk-grid">${slots.filter(s => s.zone === z).map(s => {
      const t = s.room && M.tenantOf(s.room);
      return `<button class="pk-slot ${s.zone === 'CAR' ? 'car' : ''} ${s.room ? 'used' : ''} ${hl.includes(s.id) ? 'hl' : ''}" data-slot="${esc(s.id)}"><b>${s.zone === 'CAR' ? '🚗' : '🏍️'} ${esc(s.id)}</b><span>${s.room ? `คลัง ${esc(s.room)}${t ? ' · ' + esc(t.name) : ''}${s.plate ? '<br>' + esc(s.plate) : ''}` : 'ว่าง'}</span></button>`;
    }).join('')}</div>`).join('') : '<div class="empty">ยังไม่มีช่องจอด' + (admin ? ' — กด "+ เพิ่มช่องจอด"' : '') + '</div>'}</div>`;
    el.querySelector('#pick').onchange = e => { const r = e.target.value; hl = r ? [r, ...M.slotsOf(r).map(s => s.id)] : []; re(); };
    el.querySelectorAll('[data-slot]').forEach(g => g.onclick = () => { const id = g.dataset.slot; hl = [id]; re(); editSlot(db.get('slots', id), re); });
    el.querySelector('#addslot')?.addEventListener('click', async () => {
      const id = (prompt('รหัสช่องจอดใหม่ รูปแบบ โซน-ลำดับ เช่น A-12 หรือ CAR-3 (โซน CAR = รถยนต์)') || '').trim().toUpperCase();
      if (!id) return;
      if (!/^[A-Z0-9]{1,6}-\d{1,3}$/.test(id)) return toast('รูปแบบไม่ถูกต้อง ตัวอย่าง: A-12');
      if (db.get('slots', id)) return toast('มีช่องจอดนี้อยู่แล้ว');
      await db.put('slots', { id, zone: id.split('-')[0], room: '', plate: '', vehicle: '' }); toast('เพิ่มช่อง ' + id + ' แล้ว'); re();
    });
  },
};