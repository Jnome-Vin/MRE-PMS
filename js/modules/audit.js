// ประวัติการใช้งาน (Audit log) — เฉพาะ Administrator
// ใครเข้าสู่ระบบ เพิ่ม/แก้/ลบอะไร เมื่อไร ค่าเดิม → ค่าใหม่ · ดูอย่างเดียว แอปไม่มีคำสั่งแก้หรือลบประวัติ
// โหมด server: อ่านจาก Google Sheet แท็บ "ประวัติการใช้งาน" · โหมดเครื่องเดียว: อ่านจากเครื่องนี้
import * as sec from '../core/security.js';
import { isServerMode } from '../core/config.js';
import { esc, toast, downloadCsv } from '../core/ui.js';

const f = { from: '', to: '', user: '', q: '' };
const when = iso => { const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
// ชื่อช่องข้อมูลที่พบบ่อย แสดงเป็นภาษาไทย (ข้อมูลที่เก็บยังเป็นชื่อช่องเดิม)
const FIELD = { rent: 'ค่าเช่า', water: 'ค่าน้ำ/หน่วย', elec: 'ค่าไฟ/หน่วย', name: 'ชื่อ', phone: 'โทร', address: 'ที่อยู่', deposit: 'เงินประกัน', rentAdvance: 'ค่าเช่าล่วงหน้า', status: 'สถานะ', payments: 'รายการชำระ',
  wCur: 'มิเตอร์น้ำ', eCur: 'มิเตอร์ไฟ', wPrev: 'มิเตอร์น้ำครั้งก่อน', ePrev: 'มิเตอร์ไฟครั้งก่อน', wRate: 'อัตราค่าน้ำ', eRate: 'อัตราค่าไฟ', active: 'ยังเช่าอยู่', room: 'หน่วยเช่า', dueDay: 'วันครบกำหนด', dueDate: 'ครบกำหนด',
  parkingFee: 'ค่าที่จอด', fridge: 'ค่าตู้เย็น', floor: 'ชั้น/โซน', kind: 'ประเภท', type: 'ชนิด', label: 'ชื่อเรียก', since: 'วันเข้า', moveOut: 'วันย้ายออก', items: 'รายการอื่น', idleMin: 'ล็อกหน้าจอ (นาที)', remindDays: 'เตือนสำรอง (วัน)',
  idNo: 'เลขบัตร', lineCode: 'รหัสผูก LINE', idPhoto: 'รูปบัตร', plate: 'ทะเบียนรถ', invoiceNo: 'เลขที่ใบแจ้งหนี้', note: 'หมายเหตุ', maxOccupants: 'ผู้พักร่วมสูงสุด', minOn: 'ใช้ขั้นต่ำ', lang: 'ภาษา', company: 'บริษัท', birthDate: 'วันเกิด', deleted: 'ลบ', floors: 'ผัง' };
const detail = d => esc(d).split(' | ').map(s => s.replace(/^(\w+): /, (m, k) => (FIELD[k] ? FIELD[k] : k) + ': ')).join('<br>');
const tone = a => /ไม่สำเร็จ|^ล็อกบัญชี|ปฏิเสธ/.test(a) ? 'bad' : /^ลบ|ปิดบัญชี|รีเซ็ต/.test(a) ? 'warn' : /^เพิ่ม|กู้คืน|สำรอง/.test(a) ? 'ok' : 'idle';

export default {
  id: 'audit', title: 'ประวัติการใช้งาน', icon: '🧾', perm: 'audit.view',
  async render(el, nav) {
    el.innerHTML = `
    <div class="top"><h2>ประวัติการใช้งาน</h2><button class="btn" id="a-csv">⬇ Excel</button></div>
    <div class="card" style="margin-bottom:12px"><div class="toolbar">
      <label class="note">ตั้งแต่ <input class="input" type="date" id="a-from" value="${esc(f.from)}"></label>
      <label class="note">ถึง <input class="input" type="date" id="a-to" value="${esc(f.to)}"></label>
      <input class="input" id="a-user" placeholder="อีเมลผู้ใช้" value="${esc(f.user)}" style="width:200px">
      <input class="input" id="a-q" placeholder="ค้นหา เช่น รหัสคลัง ชื่อผู้เช่า ลบ" value="${esc(f.q)}" style="flex:1;min-width:180px">
      <button class="btn pri" id="a-go">ค้นหา</button><button class="btn" id="a-clear">ล้าง</button></div>
      <p class="note" style="margin:8px 0 0">${isServerMode()
        ? 'บันทึกที่ Google Sheet แท็บ "ประวัติการใช้งาน" ทุกครั้งที่ข้อมูลขึ้น server — แอปไม่มีคำสั่งแก้หรือลบประวัติ'
        : 'โหมดเครื่องเดียว: ประวัติเก็บในเบราว์เซอร์ของเครื่องนี้ ถ้าล้างข้อมูลเบราว์เซอร์ประวัติจะหายไปด้วย'}</p></div>
    <div class="card" id="a-list">กำลังโหลด…</div>`;
    const $e = s => el.querySelector(s), re = () => this.render(el, nav);
    const read = () => { f.from = $e('#a-from').value; f.to = $e('#a-to').value; f.user = $e('#a-user').value.trim(); f.q = $e('#a-q').value.trim(); };
    $e('#a-go').onclick = () => { read(); re(); };
    $e('#a-q').onkeydown = e => { if (e.key === 'Enter') { read(); re(); } };
    $e('#a-clear').onclick = () => { f.from = f.to = f.user = f.q = ''; re(); };
    let r;
    try { r = await sec.listAudit(f); }
    catch (e) { $e('#a-list').innerHTML = `<p>${esc(e.message)}</p>${isServerMode() ? '<p class="note">การดูประวัติต้องออนไลน์</p>' : ''}`; return; }
    const rows = r.rows || [];
    $e('#a-csv').onclick = () => rows.length
      ? downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, [['เวลา', 'ผู้ใช้', 'รายการ', 'ข้อมูล', 'รายละเอียด'], ...rows.map(x => [x.at, x.user, x.action, x.target, x.detail])])
      : toast('ไม่มีรายการ');
    $e('#a-list').innerHTML = rows.length ? `<p class="note" style="margin-top:0">แสดง ${rows.length} รายการล่าสุด${rows.length >= 500 ? ' (สูงสุด 500 — ใช้ตัวกรองเพื่อดูช่วงอื่น)' : ''} · ทั้งหมด ${r.total ?? rows.length} รายการ</p>
      <div class="scroll"><table class="tbl audit"><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>รายการ</th><th>ข้อมูล</th><th>รายละเอียด (ค่าเดิม → ค่าใหม่)</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td style="white-space:nowrap">${when(x.at)}</td><td>${esc(x.user)}</td><td><span class="pill ${tone(x.action)}">${esc(x.action)}</span></td><td>${esc(x.target)}</td><td class="det">${detail(x.detail)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">ไม่พบรายการตามเงื่อนไข</div>';
  },
};
