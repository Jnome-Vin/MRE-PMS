// หน้าจอล็อก: ขึ้นเมื่อไม่ได้ใช้งานเกินเวลาที่ตั้งไว้ หรือกด "ล็อกหน้าจอ" เอง — ต้องใส่รหัสผ่านของผู้ที่เข้าสู่ระบบอยู่จึงจะใช้ต่อได้
// ขณะล็อก หน้าจอของแอปถูกซ่อนทั้งหมด (body.locked) · ใส่รหัสผิดครบจำนวนครั้ง → ออกจากระบบ
import * as auth from '../core/auth.js';
import * as sec from '../core/security.js';
import { APP } from '../core/config.js';
import { esc } from '../core/ui.js';

export function showLock() {
  const s = auth.current();
  if (!s || document.getElementById('lockscreen')) return;
  sec.setLocked(true);
  document.body.classList.add('locked');
  const ov = document.createElement('div');
  ov.id = 'lockscreen';
  ov.innerHTML = `<form class="card lock-card" autocomplete="off">
      <div class="lock-ic">🔒</div>
      <h2>ล็อกหน้าจออยู่</h2>
      <p class="note">${esc(s.name || s.email)} · ${esc(s.email)}<br>ใส่รหัสผ่านเพื่อใช้งานต่อ</p>
      <input id="lk-pw" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" required>
      <div class="err" id="lk-err"></div>
      <button class="btn pri" type="submit">ปลดล็อก</button>
      <button class="btn" type="button" id="lk-out">ออกจากระบบ (เปลี่ยนผู้ใช้)</button>
    </form>`;
  document.body.appendChild(ov);
  const pw = ov.querySelector('#lk-pw'), err = ov.querySelector('#lk-err');
  setTimeout(() => pw.focus(), 50);
  let fails = 0;
  const out = () => { auth.logout(); location.reload(); };
  ov.querySelector('#lk-out').onclick = out;
  ov.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const btn = ov.querySelector('button[type=submit]'); btn.disabled = true;
    const ok = await auth.verifyPassword(pw.value);
    btn.disabled = false;
    if (ok) {
      sec.setLocked(false); document.body.classList.remove('locked'); ov.remove();
      sec.log('ปลดล็อกหน้าจอ');
      return;
    }
    fails++; pw.value = ''; pw.focus();
    await sec.log('ปลดล็อกหน้าจอไม่สำเร็จ', '', `ครั้งที่ ${fails}`);
    if (fails >= APP.maxFails) return out();
    err.textContent = `รหัสผ่านไม่ถูกต้อง (เหลืออีก ${APP.maxFails - fails} ครั้ง แล้วจะออกจากระบบ)`;
  };
}
