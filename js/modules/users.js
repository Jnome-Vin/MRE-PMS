// จัดการผู้ใช้ (Administrator เท่านั้น): เพิ่มผู้ใช้ + รหัสชั่วคราว, เปลี่ยนระดับ, รีเซ็ตรหัส, ปิดบัญชี, ปลดล็อกบัญชีที่ใส่รหัสผิดหลายครั้ง
import * as auth from '../core/auth.js';
import { isServerMode, FLOOR, UNIT, feature } from '../core/config.js';
import * as db from '../core/db.js';
import { HIDEABLE } from '../core/access.js';
import { esc, toast, openModal, closeModal, confirmBox, thDate } from '../core/ui.js';

function showTemp(email, temp) {
  const box = openModal(`<h3>รหัสผ่านชั่วคราว</h3>
    <p>แจ้งรหัสนี้ให้ <b>${esc(email)}</b> — ผู้ใช้จะถูกบังคับให้ตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งแรก</p>
    <p style="font-size:24px;font-family:monospace;background:#f0f3f6;padding:12px;border-radius:8px;text-align:center;user-select:all">${esc(temp)}</p>
    <p class="note">รหัสนี้จะแสดงครั้งเดียว ถ้าลืมให้กด "รีเซ็ตรหัส" ใหม่</p>
    <div class="form-acts"><button class="btn" id="cp">คัดลอก</button><button class="btn pri" id="ok">เสร็จ</button></div>`);
  box.querySelector('#cp').onclick = () => navigator.clipboard?.writeText(temp).then(() => toast('คัดลอกแล้ว'));
  box.querySelector('#ok').onclick = closeModal;
}

// สิทธิ์การมองเห็นรายคน: เมนูที่ซ่อน · ข้อมูลส่วนบุคคลของผู้เช่า · ชั้น/โซนที่รับผิดชอบ (Administrator เห็นทั้งหมดเสมอ)
const MENU = { dashboard: 'ภาพรวม', floorplan: 'ผัง' + UNIT, parking: 'ผังที่จอดรถ', billing: 'จดมิเตอร์ / ออกบิล', tenants: 'ผู้เช่า', reports: 'รายงาน' };
function accessForm(u, done) {
  const a = u.access, floors = [...new Set(db.all('rooms', { raw: true }).map(r => Number(r.floor)).filter(Boolean))].sort((x, y) => x - y);
  const menus = HIDEABLE.filter(m => m !== 'parking' || feature('parking'));
  const box = openModal(`<h3>สิทธิ์การมองเห็น</h3><p class="note" style="margin-top:-6px">${esc(u.name)} · ${esc(u.email)} · ${esc(auth.ROLES[u.role])}</p>
    <b>เมนูที่เห็น</b>
    <div class="chips" style="margin:8px 0 14px">${menus.map(m => `<label class="chip"><input type="checkbox" data-menu="${m}" ${a.hide.includes(m) ? '' : 'checked'}> ${esc(MENU[m])}</label>`).join('')}</div>
    <b>ข้อมูลส่วนบุคคลของผู้เช่า</b>
    <label style="display:flex;gap:8px;align-items:center;margin:8px 0 14px"><input type="checkbox" id="ac-personal" ${a.personal ? 'checked' : ''}> เห็นเลขบัตร รูปบัตร วันเกิด และที่อยู่ของผู้เช่า</label>
    <b>${FLOOR}ที่รับผิดชอบ</b> <span class="note">(ไม่ติ๊กเลย = ทุก${FLOOR})</span>
    <div class="chips" style="margin:8px 0 6px">${floors.map(f => `<label class="chip"><input type="checkbox" data-floor="${f}" ${a.floors.includes(f) ? 'checked' : ''}> ${FLOOR} ${f}</label>`).join('')}</div>
    <p class="note">เมื่อระบุ${FLOOR} ผู้ใช้จะเห็นและแก้ได้เฉพาะ${UNIT} ผู้เช่า บิล และที่จอดของ${FLOOR}นั้น · ซ่อนเมนู "รายงาน" จะซ่อนยอดรายรับรวมในหน้าภาพรวมด้วย<br>
      ${isServerMode() ? 'server เป็นผู้บังคับสิทธิ์: ข้อมูลที่ไม่มีสิทธิ์จะไม่ถูกส่งไปที่เครื่องของผู้ใช้ · มีผลเมื่อผู้ใช้เข้าสู่ระบบครั้งถัดไป' : 'โหมดเครื่องเดียว: เป็นการซ่อนบนหน้าจอเท่านั้น เพราะข้อมูลทั้งหมดอยู่ในเครื่องนี้ · มีผลเมื่อผู้ใช้เข้าสู่ระบบครั้งถัดไป'}</p>
    <div class="err" id="acerr"></div>
    <div class="form-acts"><button class="btn" id="acx">ยกเลิก</button><button class="btn pri" id="acok">บันทึกสิทธิ์</button></div>`);
  box.querySelector('#acx').onclick = closeModal;
  box.querySelector('#acok').onclick = async () => {
    const access = { hide: [...box.querySelectorAll('[data-menu]')].filter(c => !c.checked).map(c => c.dataset.menu), personal: box.querySelector('#ac-personal').checked,
      floors: [...box.querySelectorAll('[data-floor]')].filter(c => c.checked).map(c => Number(c.dataset.floor)) };
    try { await auth.updateUser(u.email, { access }); closeModal(); toast('บันทึกสิทธิ์แล้ว'); done(); } catch (e) { box.querySelector('#acerr').textContent = e.message; }
  };
}

function addForm(done) {
  const box = openModal(`<h3>เพิ่มผู้ใช้</h3>
    <form class="form" id="uf">
      <label class="req">อีเมล</label><input id="u-em" type="email" required>
      <label class="req">ชื่อ</label><input id="u-nm" required>
      <label class="req">ระดับ</label><select id="u-role">${Object.entries(auth.ROLES).map(([k, v]) => `<option value="${k}" ${k === 'operator' ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="full note">Administrator: ทำได้ทุกอย่าง · Manager: เพิ่มผู้ใช้และเพิ่มคลังไม่ได้ · Operator: ลบข้อมูลไม่ได้ และไม่เห็นเมนูตั้งค่า · Viewer: ดูได้อย่างเดียว<br>กำหนดเมนู ข้อมูล และชั้น/โซนที่แต่ละคนเห็นได้ที่ปุ่ม "สิทธิ์" ในตารางหลังสร้างผู้ใช้</div>
      <div class="err full" id="uerr"></div></form>
    <div class="form-acts"><button class="btn" id="ux">ยกเลิก</button><button class="btn pri" id="uok">สร้างผู้ใช้</button></div>`);
  box.querySelector('#ux').onclick = closeModal;
  box.querySelector('#uok').onclick = async () => {
    try {
      const email = box.querySelector('#u-em').value, name = box.querySelector('#u-nm').value.trim();
      if (!name) throw new Error('กรุณากรอกชื่อ');
      const temp = await auth.addUser({ email, name, role: box.querySelector('#u-role').value });
      showTemp(email.trim().toLowerCase(), temp); done();
    } catch (e) { box.querySelector('#uerr').textContent = e.message; }
  };
}

export default {
  id: 'users', title: 'ผู้ใช้งาน', icon: '🔐', perm: 'users.manage',
  async render(el, nav) {
    el.innerHTML = `<div class="top"><h2>ผู้ใช้งาน</h2><button class="btn pri" id="add">+ เพิ่มผู้ใช้</button></div><div class="card" id="ul">กำลังโหลด…</div>`;
    const re = () => this.render(el, nav);
    el.querySelector('#add').onclick = () => addForm(re);
    let list;
    try { list = await auth.listUsers(); }
    catch (e) { el.querySelector('#ul').innerHTML = `<p>${esc(e.message)}</p>${isServerMode() ? '<p class="note">การจัดการผู้ใช้ต้องออนไลน์</p>' : ''}`; return; }
    const me = auth.current().email;
    el.querySelector('#ul').outerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>อีเมล</th><th>ชื่อ</th><th>ระดับ</th><th>สิทธิ์การมองเห็น</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr data-u="${esc(u.email)}"><td>${esc(u.email)}${u.email === me ? ' <span class="pill info">คุณ</span>' : ''}</td><td>${esc(u.name)}</td>
        <td><select class="input" data-role ${u.email === me ? 'disabled' : ''}>${Object.entries(auth.ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="note" style="white-space:normal;max-width:220px">${esc(auth.accessText(u.access))}${u.role !== 'admin' && u.email !== me ? ' <button class="btn sm" data-access>สิทธิ์</button>' : ''}</td>
        <td>${!u.active ? '<span class="pill idle">ปิดใช้งาน</span>' : u.locked ? '<span class="pill bad" title="ใส่รหัสผ่านผิดหลายครั้ง">🔒 ถูกล็อก</span>' : u.mustChange ? '<span class="pill warn">รอตั้งรหัสใหม่</span>' : '<span class="pill ok">ใช้งาน</span>'}</td>
        <td>${u.lastLogin ? thDate(u.lastLogin) : '-'}</td>
        <td>${u.email === me ? '' : `${u.locked ? '<button class="btn sm pri" data-unlock>ปลดล็อก</button> ' : ''}<button class="btn sm" data-reset>รีเซ็ตรหัส</button> <button class="btn sm ${u.active ? 'danger' : ''}" data-toggle>${u.active ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
    el.querySelectorAll('tr[data-u]').forEach(tr => {
      const email = tr.dataset.u, u = list.find(x => x.email === email);
      tr.querySelector('[data-role]').onchange = async e => { try { await auth.updateUser(email, { role: e.target.value }); toast('เปลี่ยนระดับแล้ว'); re(); } catch (x) { toast(x.message); re(); } };
      tr.querySelector('[data-reset]')?.addEventListener('click', async () => {
        if (!await confirmBox(`รีเซ็ตรหัสผ่านของ ${email}?`, 'รีเซ็ต')) return;
        try { showTemp(email, await auth.resetPassword(email)); re(); } catch (x) { toast(x.message); }
      });
      tr.querySelector('[data-access]')?.addEventListener('click', () => accessForm(u, re));
      tr.querySelector('[data-unlock]')?.addEventListener('click', async () => { try { await auth.unlockUser(email); toast('ปลดล็อกแล้ว'); re(); } catch (x) { toast(x.message); } });
      tr.querySelector('[data-toggle]')?.addEventListener('click', async () => {
        try { await auth.updateUser(email, { active: !u.active }); re(); } catch (x) { toast(x.message); }
      });
    });
  },
};
