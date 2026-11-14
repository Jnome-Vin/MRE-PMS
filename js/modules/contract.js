// หน้าต่างทำสัญญาเช่า: ข้อมูลผู้เช่า (อ่านจากบัตร/Passport) + รายละเอียดสัญญา + รูปแนบ → Word / PDF / พิมพ์ / ส่ง LINE
// เปิดอัตโนมัติหลังบันทึกผู้เช่าเข้าใหม่ และกด "📝 สัญญาเช่า" ที่ผังคลัง / ประวัติผู้เช่า เพื่อทำหรือพิมพ์ใหม่
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import { esc, toast, openModal, closeModal, uid, bahtText } from '../core/ui.js';
import { readIdDocument, occ as occOf } from '../core/idcard.js';
import * as K from '../core/contract.js';
import { compress, fileToDataUrl } from './tenants.js';
import { editImage, dropZone } from '../core/imgedit.js';
import { readMeter, canUseClaude } from '../core/meter.js';
import { pdfPages } from '../core/layout.js';
import { isServerMode } from '../core/config.js';
import * as api from '../core/api.js';

// เอกสารผู้เช่าคลัง: นิติบุคคล = หนังสือรับรองบริษัท (ไม่เกิน 6 เดือน) + บัตรกรรมการ · ลงนามโดยผู้รับมอบอำนาจ = หนังสือมอบอำนาจ + บัตรผู้รับมอบอำนาจ
export const WH_DOCS = [
  ['cert', 'หนังสือรับรองบริษัท (ออกไม่เกิน 6 เดือน)', C => C.tenantType !== 'person'],
  ['dirId', 'สำเนาบัตรประชาชนกรรมการผู้มีอำนาจลงนาม', C => C.tenantType !== 'person'],
  ['poa', 'หนังสือมอบอำนาจ', C => !!C.proxy],
  ['proxyId', 'สำเนาบัตรประชาชนผู้รับมอบอำนาจ', C => !!C.proxy],
];
// หนังสือรับรองออกเกิน 6 เดือนก่อนวันทำสัญญา?
export const certTooOld = C => { if (!C.certDate) return false; const d = new Date(C.date || Date.now()); d.setMonth(d.getMonth() - 6); return new Date(C.certDate) < d; };

const CSS = `
.wh-sw{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#fafcfe;cursor:pointer;margin-bottom:8px}
.wh-sw input{display:none}.wh-sw i{flex:none;width:42px;height:24px;border-radius:999px;background:#cbd5e1;position:relative;transition:.15s}
.wh-sw i::after{content:'';position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s}
.wh-sw input:checked+i{background:#16a34a}.wh-sw input:checked+i::after{left:21px}
.wh-back{border:1px solid #fdba74;background:#fff7ed;border-radius:10px;padding:8px 10px;margin-bottom:8px}
.wh-h{margin:6px 0 2px;font-size:14px}.wh-cnt{display:flex;align-items:center;gap:10px;margin-bottom:4px}.wh-cnt b{min-width:20px;text-align:center}
.wh-m{display:grid;grid-template-columns:1.1fr 1fr;gap:6px}
#c-ebox.off{opacity:.5}#c-ebox.off input,#c-ebox.off button{pointer-events:none;background:#eef1f4}
.wh-docs{display:grid;gap:8px;margin-top:8px}.wh-doc{border:1px dashed var(--line);border-radius:10px;padding:8px 10px}
.wh-doc.miss{border-color:#f59e0b;background:#fffbeb}.wh-doc .hd{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
.wh-doc .th{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.wh-doc .th span{position:relative}
.wh-doc .th img{width:64px;height:84px;object-fit:cover;border:1px solid var(--line);border-radius:4px;cursor:zoom-in;background:#fff}
.wh-doc .th button{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:0;background:#dc2626;color:#fff;font-size:12px;line-height:20px;padding:0;cursor:pointer}
.ctm{display:grid;grid-template-columns:minmax(360px,440px) 1fr;gap:14px;align-items:start}
.ctm .frm{max-height:72vh;overflow:auto;padding-right:4px}
.ctm .sec{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.ctm .sec h4{margin:0 0 8px;font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ctm .sec h4 small{font-weight:400;color:var(--muted);font-size:12px}
.ctm .g2{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}.ctm .full{grid-column:1/-1}
.ctm label.l{display:block;font-size:12.5px;color:var(--muted);margin-bottom:2px}
.ctm input,.ctm select{width:100%;font:inherit;font-size:14px;padding:6px 8px;border:1px solid #cdd5de;border-radius:7px;background:#fff}
.ctm .f-blue{color:#0070C0}.ctm .f-red{color:#EE0000}.ctm .f-lblue{color:#4472C4}.ctm .f-orange{color:#ED7D31}
.ctm .auto{font-size:11.5px;color:#2e8b57;margin-top:2px}
.ctm .lang{display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:10px;padding:9px 12px;background:#f4f8fb;border:1px solid #d6e2ec;margin-bottom:12px;cursor:pointer}
.ctm .lang small{display:block;color:var(--muted);font-size:12px}
.ctm .sw{position:relative;width:46px;height:26px;flex:none}.ctm .sw input{opacity:0;width:0;height:0}
.ctm .sw span{position:absolute;inset:0;background:#c5cfd9;border-radius:20px;transition:.2s}
.ctm .sw span::after{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.ctm .sw input:checked+span{background:var(--brand)}.ctm .sw input:checked+span::after{left:23px}
.ctm .idbox{display:flex;gap:10px;align-items:center;border:1.5px dashed #b8c4d0;border-radius:10px;padding:8px;background:#fafcfe;margin-bottom:8px}
.ctm .idbox .ph{width:110px;height:70px;border-radius:6px;background:#e7eef5;display:flex;align-items:center;justify-content:center;font-size:11px;color:#5a6c7e;flex:none;text-align:center;overflow:hidden}
.ctm .idbox .ph img{width:100%;height:100%;object-fit:cover}
.ctm .msg{font-size:12px;color:#2e8b57;margin-top:4px}
.ctm .idbox,.ctm .thumbs{transition:background .15s,border-color .15s}
.ctm .drop-on{background:#e3f0fb!important;border-color:#1f5f8b!important;outline:2px dashed #1f5f8b;outline-offset:2px}
.ctm .idbox .ph small{display:block;font-size:10px;color:#8a99a8;margin-top:2px}
.ctm .xrow{display:grid;grid-template-columns:1fr 90px 34px;gap:6px;margin-top:6px}
.ctm .thumbs{display:flex;gap:8px;flex-wrap:wrap}
.ctm .thumbs .t{width:76px;text-align:center;font-size:11px;color:var(--muted)}
.ctm .thumbs .t .im{width:76px;height:64px;border-radius:7px;background:#eef2f6;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;font-size:24px;cursor:pointer;border:1.5px dashed transparent}
.ctm .thumbs .t .im.add{border-color:#b8c4d0;background:#fff;font-size:13px}
.ctm .thumbs .t .im img{width:100%;height:100%;object-fit:cover}
.ctm .thumbs .t .rm{position:absolute;right:2px;top:2px;background:#fff;border-radius:50%;width:20px;height:20px;line-height:18px;font-size:12px;color:#c0392b;border:1px solid #ddd}
.ctm .pv{max-height:72vh;overflow:auto;background:#e9edf2;border-radius:10px;padding:6px}
.ctm .pv .zm{zoom:.62}
.ctm .seg button{flex:1}
@media (max-width:900px){.ctm{grid-template-columns:1fr}.ctm .pv{display:none}}
`;
const FRIDGE = `<svg width="30" height="38" viewBox="0 0 38 46" aria-hidden="true"><defs><linearGradient id="fzf" x1="0" x2="1"><stop offset="0" stop-color="#ff9a7a"/><stop offset=".55" stop-color="#f4643f"/><stop offset="1" stop-color="#e2502d"/></linearGradient><linearGradient id="fzc" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c9d1d8"/><stop offset="1" stop-color="#8d99a4"/></linearGradient></defs><ellipse cx="18" cy="43.2" rx="15" ry="2.2" opacity=".16"/><path d="M27 4 L33 1.5 V38 L27 41 Z" fill="#b73a1d"/><path d="M4 4 L10 1.5 H33 L27 4 Z" fill="#ffb59e"/><rect x="4" y="4" width="23" height="37" rx="2.2" fill="url(#fzf)"/><rect x="4" y="16" width="23" height="1.6" fill="#a8341a"/><rect x="21.5" y="7" width="2.4" height="6.5" rx="1.2" fill="url(#fzc)"/><rect x="21.5" y="20" width="2.4" height="11" rx="1.2" fill="url(#fzc)"/></svg>`;

// tIn = ผู้เช่าเดิม (ทำสัญญาใหม่ / พิมพ์ซ้ำ) หรือ { room } = ผู้เช่าเข้าใหม่: กรอกครั้งเดียวในหน้าต่างนี้ บันทึกแล้วได้ทั้งข้อมูลผู้เช่าและสัญญา
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export async function openContract(tIn = {}, done) {
  if (K.WH) return openContractWH(tIn, done);   // โครงการประเภทคลัง → สัญญาเช่าคลังสินค้า
  let isNew = !(tIn.id && db.get('tenants', tIn.id));
  const vacant = M.rooms().filter(r => !M.tenantOf(r.id));
  if (isNew && !vacant.length) return toast('ไม่มีคลังว่าง');
  const blank = room => { const r = db.get('rooms', room) || {}; const rent = Number(r.rent) || 0;
    return { id: uid('t-'), room, rent, deposit: rent, fridge: 0, parkingFee: 0, occupants: [], lang: 'th', since: todayIso(), active: true }; };
  const firstRoom = (vacant.find(r => r.kind === 'room') || vacant[0]).id;   // คลังว่างคลังแรก (ไม่ใช่สำนักงาน/ซักผ้า)
  let t = isNew ? { ...blank(vacant.some(r => r.id === tIn.room) ? tIn.room : firstRoom), ...tIn, id: uid('t-') } : db.get('tenants', tIn.id);
  const C = { ...K.defaults(t), birthDate: t.birthDate || '', address: t.address || '', ...(t.contract || {}) };
  C.extras = (C.extras || []).map(x => ({ ...x }));
  C.photos = (C.photos || []).map(x => ({ ...x }));
  const maxOcc = Number(M.rates().maxOccupants ?? 2);
  let occs = (t.occupants || []).map(occOf).map(o => ({ ...o }));
  let newId = null;                 // รูปบัตรผู้เช่าใหม่ (ยังไม่บันทึก)
  const newPhotos = {};             // id → dataUrl ของรูปแนบใหม่
  const cache = {};                 // id → dataUrl (แสดงตัวอย่าง)

  const field = (k, label, cls = 'f-blue', attrs = '') => `<div><label class="l">${label}</label><input class="${cls}" data-k="${k}" value="${esc(C[k] ?? '')}" ${attrs}></div>`;
  const title = () => `${isNew ? '🏠 ผู้เช่าเข้าใหม่ · ทำสัญญาเช่า' : '📝 สัญญาเช่า'} · คลัง ${esc(C.room)}`;
  const box = openModal(`<style>${CSS}</style><h3 style="margin-bottom:6px" id="c-title">${title()}</h3>
    <div class="ctm"><div class="frm" id="cf">
      <label class="lang"><span><b>🌐 ผู้เช่าเป็นชาวต่างชาติ</b><small>เปิด = สัญญาภาษาอังกฤษ · อ่าน Passport แทนบัตรประชาชน</small></span>
        <span class="sw"><input type="checkbox" id="c-en" ${C.lang === 'en' ? 'checked' : ''}><span></span></span></label>
      <div class="sec"><h4>🪪 1. <span id="c-idt">${C.lang === 'en' ? 'Passport' : 'บัตรประชาชน'}</span> <small>อ่านด้วยตัวอ่านในเครื่อง (ฟรี) แล้วตรวจแก้ได้</small></h4>
        <div class="idbox" id="c-idbox"><div class="ph" id="c-ph">${t.idPhoto ? 'กำลังโหลด…' : 'ยังไม่มีรูป<br><small>ลากรูปมาวางที่กรอบนี้ได้</small>'}</div>
          <div style="flex:1"><div style="display:flex;gap:6px;flex-wrap:wrap"><label class="btn sm" for="c-idf">📎 แนบรูป</label><input id="c-idf" type="file" accept="image/*" hidden>
            <label class="btn sm" for="c-idc">📷 ถ่ายรูป</label><input id="c-idc" type="file" accept="image/*" capture="environment" hidden>
            <button class="btn sm" type="button" id="c-idedit" title="หมุน / ครอปรูป">✏️ ปรับรูป</button></div>
            <div class="msg" id="c-idmsg"></div></div></div>
        <div class="g2">
          <div class="full"><label class="l">🔐 รหัสเครื่องสแกนใบหน้า</label><input class="f-blue" data-k="faceCode" value="${esc(C.faceCode)}" placeholder="รหัสสำหรับลงทะเบียนสแกนใบหน้า"></div>
          <div class="full"><label class="l" id="c-nml">${C.lang === 'en' ? 'ชื่อ-นามสกุล (ภาษาอังกฤษ ตาม Passport)' : 'ชื่อ-นามสกุล ผู้เช่า (= ผู้ลงลายมือชื่อ)'}</label><input class="f-blue" data-k="tenantName" value="${esc(C.tenantName)}"></div>
          ${field('tenantId', C.lang === 'en' ? 'เลข Passport' : 'เลขบัตรประชาชน')}${field('phone', 'เบอร์โทร')}
          ${field('birthDate', 'วันเดือนปีเกิด', 'f-blue', `type="date" max="${todayIso()}"`)}
          <div class="full"><label class="l">ที่อยู่ (ตามบัตร)</label><input class="f-blue" data-k="address" value="${esc(C.address)}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;border-top:1px dashed var(--line);padding-top:8px"><b style="font-size:13.5px">ผู้อาศัยร่วม <span class="note">(ไม่เกิน ${maxOcc} คน)</span></b><button class="btn sm" type="button" id="c-occadd">+ เพิ่มผู้อาศัย</button></div>
        <div id="c-occs"></div>
      </div>
      <div class="sec"><h4>🏠 2. รายละเอียดสัญญา <small>เติมจากข้อมูลผู้เช่าให้ก่อน แก้ได้</small></h4>
        <div class="g2">
          <div><label class="l">คลัง</label>${isNew ? `<select class="f-red" id="c-room">${vacant.map(r => `<option ${r.id === C.room ? 'selected' : ''}>${r.id}</option>`).join('')}</select>` : `<input class="f-red" value="${esc(C.room)}" disabled>`}</div>
          ${field('date', 'วันที่ทำสัญญา', 'f-blue', 'type="date"')}
          <div><label class="l">จำนวนผู้พักอาศัย (คน)</label><input class="f-blue" id="c-occn" disabled><div class="auto">อัตโนมัติ: ผู้เช่า + ผู้อาศัยร่วม</div></div>
          ${field('minMonths', 'สัญญาขั้นต่ำ (เดือน)', 'f-red', 'inputmode="numeric"')}
          <div>${field('rent', 'ค่าเช่า/เดือน (บาท)', 'f-red', 'inputmode="numeric"').slice(5, -6)}<div class="auto" id="c-words"></div></div>
          ${field('firstMonth', 'ค่าเช่าเดือนแรก: เดือน', 'f-lblue', 'type="month"')}
          ${field('eRate', '⚡ ค่าไฟ (บาท/หน่วย)', 'f-blue', 'inputmode="decimal"')}${field('wRate', '💧 ค่าน้ำ (บาท/หน่วย)', 'f-blue', 'inputmode="decimal"')}
          <div class="full"><label class="l">4.1 คิดค่าเช่าเดือนแรกแบบ</label><div class="seg" id="c-mode"><button type="button" data-m="month">เต็มเดือน</button><button type="button" data-m="day">คิดรายวัน (ตามวันเข้าพัก)</button></div></div>
          <div class="dayrow">${field('moveIn', 'วันเข้าพัก', 'f-blue', 'type="date"').slice(5, -6)}</div>
          <div class="dayrow">${field('firstDays', 'จำนวนวัน', 'f-blue', 'inputmode="numeric"').slice(5, -6)}<div class="auto">อัตโนมัติ: ถึงสิ้นเดือน · แก้ได้</div></div>
          <div class="full">${field('firstAmount', '4.1 ค่าเช่าเดือนแรก (บาท)', 'f-blue', 'inputmode="numeric"').slice(5, -6)}<div class="auto" id="c-pro"></div></div>
          <div class="full">${field('depositNote', '4.2 ข้อความในวงเล็บ (ไม่บังคับ · ว่าง = เส้นไข่ปลา)').slice(5, -6)}</div>
          ${field('deposit', '4.2 ประกันความเสียหาย (บาท)', 'f-blue', 'inputmode="numeric"')}${field('clean', '4.3 ประกันความสะอาด (บาท)', 'f-blue', 'inputmode="numeric"')}
          ${field('fridgeDoors', '4.4 ตู้เย็น (ประตู)', 'f-blue', 'placeholder="ไม่มี"')}${field('fridgeFee', '4.4 ค่าเช่าตู้เย็น (บาท)', 'f-blue', 'inputmode="numeric"')}
          ${field('motoKeys', '4.5 กุญแจที่จอดมอไซค์ (ดอก)', 'f-blue', 'placeholder="ไม่มี"')}${field('plate', '4.5 ทะเบียนรถ')}
          ${field('motoFee', '4.5 ค่ากุญแจ (บาท)', 'f-blue', 'inputmode="numeric"')}
          <div><label class="l">กุญแจคลัง / ห้องน้ำ (ดอก)</label><div style="display:flex;gap:6px"><input class="f-blue" data-k="keyRoom" value="${esc(C.keyRoom)}"><input class="f-blue" data-k="keyBath" value="${esc(C.keyBath)}"></div></div>
          <div class="full"><div style="display:flex;justify-content:space-between;align-items:center"><label class="l" style="margin:0">ค่าเช่าอื่นๆ (4.6 เป็นต้นไป)</label><button class="btn sm" type="button" id="c-xadd">+ เพิ่มค่าเช่าอื่น</button></div><div id="c-xs"></div><div class="auto">เช่น ค่าที่จอดรถยนต์ · รวมในยอดข้อ 2 ให้อัตโนมัติ</div></div>
          ${field('meterE', 'มิเตอร์ไฟเริ่มต้น', 'f-orange', 'inputmode="numeric" placeholder="จดวันเข้าพัก"').slice(0, -6)}<div class="auto" id="c-m-meterE">แนบรูปมิเตอร์ไฟ (ข้อ 3) → อ่านเลขให้อัตโนมัติ</div></div>
          ${field('meterW', 'มิเตอร์น้ำเริ่มต้น', 'f-lblue', 'inputmode="numeric" placeholder="จดวันเข้าพัก"').slice(0, -6)}<div class="auto" id="c-m-meterW">แนบรูปมิเตอร์น้ำ (ข้อ 3) → อ่านเลขให้อัตโนมัติ</div></div>
          <div class="full"><label class="l">ยอดรวมวันทำสัญญา (ข้อ 2)</label><input class="f-red" id="c-total" disabled><div class="auto">อัตโนมัติ = 4.1 + 4.2 + 4.3 + 4.4 + 4.5 + ค่าเช่าอื่นๆ</div></div>
        </div>
      </div>
      <div class="sec"><h4>🖼️ 3. รูปแนบ <small>ไม่บังคับ · ลากรูปมาวางได้ · กดรูปเพื่อหมุน/ครอป · ใบตรวจสภาพคลังแนบให้อัตโนมัติ</small></h4>
        <div class="thumbs" id="c-ph3"></div>
        <input id="c-pf" type="file" accept="image/*" multiple hidden>
      </div>
      <p class="note" style="margin:0 0 8px">ช่องจอดรถ (เลือกช่อง/ทะเบียน) ค่าเช่าล่วงหน้า และหมายเหตุ แก้เพิ่มได้ที่ปุ่ม "แก้ไขผู้เช่า" ในผังคลัง</p>
      <div class="err" id="c-err"></div>
    </div>
    <div class="pv"><div class="zm" id="c-pv"><p class="note" style="padding:20px">กำลังสร้างตัวอย่างสัญญา…</p></div></div></div>
    <div class="form-acts">
      <button class="btn" id="c-x">ปิด</button><button class="btn" id="c-save">💾 บันทึก</button>
      <button class="btn" id="c-word">📄 Word</button><button class="btn" id="c-pdf">📕 PDF</button><button class="btn pri" id="c-print">🖨️ พิมพ์</button>
      <button class="btn line" id="c-line" ${M.lineLinkOf(C.room) ? '' : `title="คลัง ${esc(C.room)} ยังไม่ผูก LINE OA"`}>💬 ส่ง LINE</button></div>`, { wide: true, sticky: true });
  box.style.maxWidth = '1320px'; box.style.width = '96vw';
  // ปุ่ม ✕ ปิด มุมขวาบน (ข้างปุ่มพิมพ์) — หน้าต่างนี้ปิดได้ด้วยปุ่มปิดเท่านั้น
  box.querySelector('.modal-print').style.right = '86px';
  box.querySelector('#c-title').style.paddingRight = '150px';
  box.insertAdjacentHTML('afterbegin', '<button type="button" id="c-xtop" title="ปิดหน้าต่าง" style="position:absolute;top:14px;right:14px;border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:14px;line-height:1.2;z-index:2">✕ ปิด</button>');
  const q = s => box.querySelector(s);
  const inp = k => box.querySelector(`[data-k="${k}"]`);

  // ---------- รูป (แคชไว้แสดงตัวอย่าง) ----------
  // รูปที่ยังไม่บันทึกใช้ id ชั่วคราว (__new = บัตรผู้เช่า, __oN = บัตรผู้อาศัย) — ตัวสร้างเอกสารขอรูปผ่าน photoUrl
  const photoUrl = async id => {
    if (id === '__new') return newId || '';
    if (/^__o\d+$/.test(id)) return occs[+id.slice(3)]?._new || '';
    return cache[id] || newPhotos[id] || (cache[id] = await K.photoDataDb(id));
  };
  const tenantView = () => ({ ...t, idPhoto: newId ? '__new' : t.idPhoto, occupants: occs.filter(o => o.name || o.photo || o._new).map(o => ({ ...o, photo: o._new ? '__o' + occs.indexOf(o) : o.photo })) });
  const docOf = (forLine = false) => K.build(C, tenantView(), { forLine, getPhoto: photoUrl });

  // ---------- ตัวอย่างสัญญา ----------
  let pvTimer, pvSeq = 0;
  const preview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(async () => {
    const seq = ++pvSeq, html = await K.pagesHtml(await docOf());
    if (seq === pvSeq && q('#c-pv')) q('#c-pv').innerHTML = `<style>${K.previewCss()}</style>${html}`;
  }, 350); };
  if (!document.getElementById('ct-font')) document.head.insertAdjacentHTML('beforeend', '<link id="ct-font" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">');

  // ---------- คำนวณ ----------
  const occCount = () => 1 + occs.filter(o => o.name || o.photo || o._new).length;
  const calc = () => {
    q('#c-occn').value = occCount(); C.occCount = String(occCount());
    const words = v => (C.lang === 'en' ? K.enWords(v) : bahtText(v));
    q('#c-total').value = `${K.total(C).toLocaleString('en-US')} บาท (${words(K.total(C))})`;
    q('#c-words').textContent = words(C.rent);
    box.querySelectorAll('.dayrow').forEach(d => d.hidden = C.mode !== 'day');
    box.querySelectorAll('#c-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === C.mode));
    const p = C.mode === 'day' ? K.prorate(C.rent, C.moveIn) : null;
    q('#c-pro').textContent = C.mode === 'day' && p ? `${Number(C.rent).toLocaleString()} ÷ ${p.dim} วัน × ${C.firstDays || p.days} วัน ≈ ${Math.round(Number(C.rent) / p.dim * (Number(C.firstDays) || p.days)).toLocaleString()} บาท (แก้ได้)` : 'เต็มเดือน = ค่าเช่า 1 เดือน';
    preview();
  };
  const setVal = (k, v) => { C[k] = v; const el = inp(k); if (el) el.value = v; };
  const reprorate = () => { const p = K.prorate(C.rent, C.moveIn); if (!p) return; setVal('firstMonth', C.moveIn.slice(0, 7)); setVal('firstDays', String(p.days)); setVal('firstAmount', String(p.amount)); };

  q('#cf').addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    C[k] = e.target.value;
    if (k === 'rent') { if (!t.contract) setVal('deposit', C.rent); if (C.mode === 'month') setVal('firstAmount', C.rent); else reprorate(); }
    if (C.mode === 'day' && k === 'moveIn') reprorate();
    if (C.mode === 'day' && k === 'firstDays') { const p = K.prorate(C.rent, C.moveIn); if (p) setVal('firstAmount', String(Math.round(Number(C.rent) / p.dim * (Number(C.firstDays) || 0)))); }
    calc();
  });
  // ผู้เช่าเข้าใหม่: เปลี่ยนคลัง → ค่าเช่า ประกัน อัตราน้ำไฟ และเลขมิเตอร์ตามคลังใหม่
  q('#c-room')?.addEventListener('change', e => {
    const d = K.defaults({ ...t, room: e.target.value, rent: Number(db.get('rooms', e.target.value)?.rent) || 0, wRate: null, eRate: null });
    C.room = t.room = e.target.value;
    for (const k of ['rent', 'deposit', 'firstAmount', 'wRate', 'eRate', 'meterE', 'meterW']) setVal(k, String(d[k] ?? ''));
    if (C.mode === 'day') reprorate();
    q('#c-title').innerHTML = title();
    q('#c-line').title = M.lineLinkOf(C.room) ? '' : `คลัง ${C.room} ยังไม่ผูก LINE OA`;
    calc();
  });
  box.querySelectorAll('#c-mode button').forEach(b => b.onclick = () => { C.mode = b.dataset.m; if (C.mode === 'day') reprorate(); else { setVal('firstDays', ''); setVal('firstAmount', C.rent); setVal('firstMonth', (C.moveIn || C.date).slice(0, 7)); } calc(); });
  q('#c-en').onchange = e => {
    C.lang = e.target.checked ? 'en' : 'th';
    q('#c-idt').textContent = C.lang === 'en' ? 'Passport' : 'บัตรประชาชน';
    q('#c-nml').textContent = C.lang === 'en' ? 'ชื่อ-นามสกุล (ภาษาอังกฤษ ตาม Passport)' : 'ชื่อ-นามสกุล ผู้เช่า (= ผู้ลงลายมือชื่อ)';
    inp('tenantId').previousElementSibling.textContent = C.lang === 'en' ? 'เลข Passport' : 'เลขบัตรประชาชน';
    calc();
  };

  // ---------- บัตรผู้เช่า: แนบ/ถ่าย → อ่านชื่อ เลขบัตร ----------
  const showIdThumb = url => { q('#c-ph').innerHTML = url ? `<img src="${url}" alt="">` : 'ยังไม่มีรูป'; };
  if (t.idPhoto) photoUrl(t.idPhoto).then(u => q('#c-ph') && showIdThumb(u));
  const readCard = async (url, onDone, msgEl) => {
    msgEl.textContent = '🔍 กำลังอ่านข้อมูลจากบัตร…';
    try {
      const r = await readIdDocument(url, p => { msgEl.textContent = `🔍 กำลังอ่านข้อมูลจากบัตร… ${p}%`; });
      if (!r) { msgEl.textContent = '⚠️ อ่านข้อมูลไม่ได้ — กรอกเอง (รูปควรชัด ไม่เอียง ไม่สะท้อนแสง)'; return; }
      onDone(r);
      msgEl.innerHTML = `✅ อ่านจาก${r.type === 'passport' ? ' Passport' : 'บัตรประชาชน'}แล้ว${r.type === 'thai-id' && r.idNo && !r.validId ? ' · <span style="color:var(--bad)">⚠️ เลขบัตรไม่ผ่านเลขตรวจสอบ</span>' : ''} — กรุณาตรวจทาน`;
    } catch (x) { msgEl.textContent = 'อ่านไม่สำเร็จ: ' + x.message + ' — กรอกเองได้'; }
  };
  // รูปใหม่ (เลือกไฟล์ / ถ่าย / ลากมาวาง) → ปรับรูป (หมุน ครอป) ก่อนใช้
  const pick = async (file, title) => editImage(await compress(await fileToDataUrl(file)), { title });
  const useId = url => {
    newId = url; showIdThumb(newId); preview();
    readCard(newId, r => {
      if (r.name) setVal('tenantName', r.name); if (r.idNo) setVal('tenantId', r.idNo);
      if (r.birthDate) setVal('birthDate', r.birthDate); if (r.address) setVal('address', r.address);
      if (r.type === 'passport' && r.nationality && r.nationality !== 'THA' && C.lang !== 'en') { q('#c-en').checked = true; q('#c-en').onchange({ target: q('#c-en') }); }
      calc();
    }, q('#c-idmsg'));
  };
  const onIdFile = async f => { if (!f) return; const u = await pick(f, 'ปรับรูปบัตรผู้เช่า'); if (u) useId(u); };
  q('#c-idf').onchange = e => { onIdFile(e.target.files[0]); e.target.value = ''; };
  q('#c-idc').onchange = e => { onIdFile(e.target.files[0]); e.target.value = ''; };
  dropZone(q('#c-idbox'), fs => onIdFile(fs[0]));
  q('#c-idedit').onclick = async () => {
    const cur = newId || (t.idPhoto ? await photoUrl(t.idPhoto) : '');
    if (!cur) return toast('ยังไม่มีรูปบัตร — แนบหรือลากรูปมาวางก่อน');
    const u = await editImage(cur, { title: 'ปรับรูปบัตรผู้เช่า' }); if (u) useId(u);
  };

  // ---------- ผู้อาศัยร่วม ----------
  const drawOccs = () => {
    q('#c-occs').innerHTML = occs.map((o, i) => `<div class="idbox" data-odrop="${i}" style="margin-top:8px"><div class="ph" data-oph="${i}">${o._new ? `<img src="${o._new}">` : o.photo ? '…' : `ผู้อาศัย ${i + 1}<br><small>ลากรูปมาวาง</small>`}</div>
      <div style="flex:1"><input class="f-blue" data-on="${i}" value="${esc(o.name)}" placeholder="ชื่อผู้อาศัย ${i + 1}">
        <input class="f-blue" data-ofc="${i}" value="${esc(o.faceCode || '')}" placeholder="🔐 รหัสเครื่องสแกนใบหน้า" style="margin-top:6px">
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><label class="btn sm" for="c-of${i}">📎 แนบบัตร</label><input id="c-of${i}" data-of="${i}" type="file" accept="image/*" hidden>
        <label class="btn sm" for="c-oc${i}">📷</label><input id="c-oc${i}" data-of="${i}" type="file" accept="image/*" capture="environment" hidden>
        <button class="btn sm" type="button" data-oed="${i}" title="หมุน / ครอปรูป">✏️ ปรับรูป</button>
        <button class="btn sm" type="button" data-orm="${i}" title="ลบ">✕</button></div><div class="msg" data-omsg="${i}"></div></div></div>`).join('');
    occs.forEach((o, i) => { if (o.photo && !o._new) photoUrl(o.photo).then(u => { const el = q(`[data-oph="${i}"]`); if (el && u) el.innerHTML = `<img src="${u}">`; }); });
    box.querySelectorAll('[data-on]').forEach(x => x.oninput = () => { occs[+x.dataset.on].name = x.value; calc(); });
    box.querySelectorAll('[data-ofc]').forEach(x => x.oninput = () => { occs[+x.dataset.ofc].faceCode = x.value; calc(); });
    box.querySelectorAll('[data-orm]').forEach(x => x.onclick = () => { occs.splice(+x.dataset.orm, 1); drawOccs(); calc(); });
    const useOcc = (i, url) => {
      occs[i]._new = url; drawOccs(); calc();
      readCard(url, r => { if (r.name) occs[i].name = r.name; if (r.idNo) occs[i].idNo = r.idNo; const n = q(`[data-on="${i}"]`); if (n) n.value = occs[i].name; calc(); }, q(`[data-omsg="${i}"]`));
    };
    const onOccFile = async (i, f) => { if (!f) return; const u = await pick(f, `ปรับรูปบัตรผู้อาศัย ${i + 1}`); if (u) useOcc(i, u); };
    box.querySelectorAll('[data-of]').forEach(x => x.onchange = e => { onOccFile(+x.dataset.of, e.target.files[0]); e.target.value = ''; });
    box.querySelectorAll('[data-odrop]').forEach(x => dropZone(x, fs => onOccFile(+x.dataset.odrop, fs[0])));
    box.querySelectorAll('[data-oed]').forEach(x => x.onclick = async () => {
      const i = +x.dataset.oed, o = occs[i], cur = o._new || (o.photo ? await photoUrl(o.photo) : '');
      if (!cur) return toast('ยังไม่มีรูปบัตร — แนบหรือลากรูปมาวางก่อน');
      const u = await editImage(cur, { title: `ปรับรูปบัตรผู้อาศัย ${i + 1}` }); if (u) useOcc(i, u);
    });
    q('#c-occadd').disabled = occs.length >= maxOcc;
  };
  q('#c-occadd').onclick = () => { if (occs.length < maxOcc) { occs.push({ name: '', idNo: '', photo: null }); drawOccs(); } };
  drawOccs();

  // ---------- ค่าเช่าอื่นๆ ----------
  const drawExtras = () => {
    q('#c-xs').innerHTML = C.extras.map((x, i) => `<div class="xrow"><input class="f-blue" data-xn="${i}" value="${esc(x.name)}" placeholder="ชื่อรายการ เช่น ค่าที่จอดรถยนต์"><input class="f-blue" data-xa="${i}" value="${esc(x.amt)}" placeholder="บาท" inputmode="numeric"><button class="btn sm" type="button" data-xr="${i}" style="color:var(--bad)">✕</button></div>`).join('');
    box.querySelectorAll('[data-xn]').forEach(x => x.oninput = () => { C.extras[+x.dataset.xn].name = x.value; calc(); });
    box.querySelectorAll('[data-xa]').forEach(x => x.oninput = () => { C.extras[+x.dataset.xa].amt = x.value.replace(/[^\d.]/g, ''); calc(); });
    box.querySelectorAll('[data-xr]').forEach(x => x.onclick = () => { C.extras.splice(+x.dataset.xr, 1); drawExtras(); calc(); });
  };
  q('#c-xadd').onclick = () => { C.extras.push({ name: '', amt: '' }); drawExtras(); box.querySelector(`[data-xn="${C.extras.length - 1}"]`)?.focus(); };
  drawExtras();

  // ---------- รูปแนบ: มิเตอร์ไฟ / มิเตอร์น้ำ / รูปอื่นๆ ----------
  const SLOTS = [['meterE', '⚡', 'มิเตอร์ไฟ'], ['meterW', '💧', 'มิเตอร์น้ำ'], ['fridge', FRIDGE, 'ตู้เย็น']];
  let pickFor = null;
  const drawPhotos = async () => {
    const byTag = tag => C.photos.find(p => p.tag === tag);
    const others = C.photos.filter(p => !SLOTS.some(s => s[0] === p.tag));
    const cell = (p, icon, label, tag) => `<div class="t"><div class="im ${p ? '' : 'add'}" data-pick="${tag}" ${tag === 'fridge' && !p ? 'style="background:#fff1e8"' : ''}>${p ? `<img data-pimg="${p.id}"><button type="button" class="rm" data-prm="${p.id}">✕</button>` : icon}</div>${label}</div>`;
    q('#c-ph3').innerHTML = SLOTS.map(([tag, icon, label]) => cell(byTag(tag), icon, label, tag)).join('') + others.map(p => cell(p, '', p.label || 'รูป', 'x')).join('') + `<div class="t"><div class="im add" data-pick="other">+ เพิ่ม</div>รูปอื่นๆ</div>`;
    for (const img of box.querySelectorAll('[data-pimg]')) img.src = await photoUrl(img.dataset.pimg);
    box.querySelectorAll('[data-pick]').forEach(x => x.onclick = async e => {
      if (e.target.closest('[data-prm]')) return;
      const img = x.querySelector('img[data-pimg]');
      if (img) {   // กดรูปที่มีอยู่ → ปรับรูป (หมุน / ครอป) แล้วแทนรูปเดิม
        const u = await editImage(img.src, { title: 'ปรับรูปแนบ' }); if (!u) return;
        const old = C.photos.find(p => p.id === img.dataset.pimg), id = uid('ct-');
        newPhotos[id] = u; delete newPhotos[old.id]; old.id = id; drawPhotos(); preview();
        if (old.tag === 'meterE' || old.tag === 'meterW') runMeter(old.tag, u);
        return;
      }
      pickFor = x.dataset.pick; q('#c-pf').multiple = pickFor === 'other'; q('#c-pf').click();
    });
    box.querySelectorAll('[data-prm]').forEach(x => x.onclick = e => { e.stopPropagation(); C.photos = C.photos.filter(p => p.id !== x.dataset.prm); delete newPhotos[x.dataset.prm]; drawPhotos(); preview(); });
  };
  const LBL = { meterE: 'มิเตอร์ไฟ', meterW: 'มิเตอร์น้ำ', fridge: 'ตู้เย็น' };
  const addPhotos = async files => {
    for (const f of files) {
      const id = uid('ct-'), url = await pick(f, `ปรับรูปแนบ${LBL[pickFor] ? ' · ' + LBL[pickFor] : ''}`);
      if (!url) continue;
      newPhotos[id] = url;
      if (pickFor !== 'other') C.photos = C.photos.filter(p => p.tag !== pickFor);
      const item = { id, tag: pickFor === 'other' ? '' : pickFor, label: LBL[pickFor] || '' };
      // รูปมิเตอร์ไว้ก่อนรูปอื่น
      pickFor === 'other' ? C.photos.push(item) : C.photos.splice(['meterE', 'meterW', 'fridge'].indexOf(pickFor), 0, item);
      if (pickFor === 'meterE' || pickFor === 'meterW') runMeter(pickFor, url);
    }
    drawPhotos(); preview();
  };
  // อ่านเลขมิเตอร์จากรูป → ใส่ในช่องให้ (แก้ได้) · เทียบกับเลขครั้งก่อนของคลัง
  // ปกติอ่านด้วยตัวอ่านฟรีในเครื่อง · ปุ่ม "ให้ Claude อ่าน" (มีค่าใช้จ่าย) แสดงเฉพาะเมื่อเปิดไว้ในตั้งค่า และกดเองเท่านั้น
  const prevMeter = { meterE: C.meterE, meterW: C.meterW }, meterSeq = {}, meterUrl = {};
  const aiBtn = tag => (M.property().claudeSlip && canUseClaude()
    ? ` <button type="button" class="btn sm" data-mai="${tag}" title="แม่นกว่า มีค่าใช้จ่ายเล็กน้อยต่อรูป">🤖 ให้ Claude อ่าน</button>` : '');
  const runMeter = async (tag, url, ai = false) => {
    meterUrl[tag] = url;
    const st = q(`#c-m-${tag}`), seq = meterSeq[tag] = (meterSeq[tag] || 0) + 1, before = String(C[tag] ?? '');
    if (st) st.innerHTML = ai ? '🤖 Claude กำลังอ่านเลขมิเตอร์…' : '🔍 กำลังอ่านเลขมิเตอร์จากรูป (ฟรี)…';
    let r;
    try { r = await readMeter(url, tag === 'meterE' ? 'electric' : 'water', { ai }); }
    catch (e) { if (seq === meterSeq[tag] && st) { st.innerHTML = `อ่านเลขไม่สำเร็จ (${esc(e.message)}) — กรุณากรอกเอง${aiBtn(tag)}`; bindAi(); } return; }
    if (seq !== meterSeq[tag] || !q(`#c-m-${tag}`)) return;
    if (r.notMeter) { st.innerHTML = '<span style="color:#b45309">⚠️ รูปนี้ไม่น่าจะเป็นมิเตอร์ — กรุณาตรวจรูปหรือกรอกเอง</span>'; return; }
    if (!r.reading) { st.innerHTML = `<span style="color:#b45309">อ่านเลขจากรูปไม่ออก — กรุณากรอกเอง</span>${ai ? '' : aiBtn(tag)}`; bindAi(); return; }
    if (String(C[tag] ?? '') !== before) { st.innerHTML = `อ่านจากรูปได้ <b>${esc(r.reading)}</b> — ไม่ได้ใส่ให้ เพราะแก้ช่องนี้ระหว่างอ่าน`; return; }
    setVal(tag, r.reading); dirty = true; preview();
    const prev = Number(prevMeter[tag]), hasPrev = prevMeter[tag] !== '' && Number.isFinite(prev), v = Number(r.reading);
    const low = hasPrev && v < prev, high = hasPrev && v > prev * 2 + 1000;
    st.innerHTML = `${ai ? '🤖' : '🔍'} อ่านจากรูปได้ <b>${esc(r.reading)}</b> ${ai ? '(Claude)' : '(ตัวอ่านฟรีในเครื่อง)'} · <b>ตรวจกับรูปแล้วแก้ได้</b>${ai ? '' : aiBtn(tag)}`
      + (r.unclear && ai ? '<br><span style="color:#b45309">⚠️ บางหลักไม่ชัด กรุณาตรวจ</span>' : '')
      + (low ? `<br><span style="color:#c00">⚠️ น้อยกว่าเลขครั้งก่อนของคลังนี้ (${esc(prevMeter[tag])}) — ตรวจอีกครั้ง</span>` : '')
      + (high ? `<br><span style="color:#c00">⚠️ สูงกว่าเลขครั้งก่อนของคลังนี้ (${esc(prevMeter[tag])}) มากผิดปกติ — ตรวจอีกครั้ง</span>` : '');
    bindAi();
  };
  const bindAi = () => box.querySelectorAll('[data-mai]').forEach(b => b.onclick = () => meterUrl[b.dataset.mai] && runMeter(b.dataset.mai, meterUrl[b.dataset.mai], true));
  q('#c-pf').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await addPhotos(fs); };
  // ลากรูปมาวางที่ช่องรูปแนบ: วางบนช่องมิเตอร์/ตู้เย็น = ใส่ช่องนั้น · วางที่อื่น = รูปอื่นๆ
  dropZone(q('#c-ph3'), fs => addPhotos(fs));
  q('#c-ph3').addEventListener('drop', e => { pickFor = e.target.closest('[data-pick]')?.dataset.pick; if (!pickFor || pickFor === 'x') pickFor = 'other'; }, true);
  drawPhotos();

  // ---------- บันทึก ----------
  const save = async () => {
    if (!String(C.tenantName).trim()) { q('#c-err').textContent = 'กรุณากรอกชื่อผู้เช่า'; q('[data-k=tenantName]').focus(); return false; }
    if (isNew && M.tenantOf(C.room)) { q('#c-err').textContent = `คลัง ${C.room} มีผู้เช่าแล้ว กรุณาเลือกคลังอื่น`; return false; }
    const rec = { ...db.get('tenants', t.id) || t, room: C.room };
    if (newId) {
      const pid = uid('id-');
      await db.putPhoto({ id: pid, dataUrl: newId, name: `${rec.room}-${C.tenantName}-บัตรประชาชน.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: pid }); rec.idPhoto = pid; cache[pid] = newId; newId = null;
    }
    const outOcc = [];
    for (const o of occs) {
      if (!o.name && !o.photo && !o._new) continue;
      const { _new, ...rest } = o;
      if (_new) { rest.photo = uid('id-'); cache[rest.photo] = _new;
        await db.putPhoto({ id: rest.photo, dataUrl: _new, name: `${rec.room}-${o.name || 'ผู้พัก'}-บัตร.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
        await db.queue({ kind: 'photo', photoId: rest.photo }); }
      outOcc.push({ ...rest, name: String(rest.name || '').trim(), idNo: String(rest.idNo || '').trim() });
    }
    occs = outOcc.map(o => ({ ...o }));
    for (const [id, url] of Object.entries(newPhotos)) {
      const p = C.photos.find(x => x.id === id); if (!p) continue;
      await db.putPhoto({ id, dataUrl: url, name: `${rec.room}-สัญญา-${p.label || 'รูป'}.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: id, folder: 'contract' }); cache[id] = url; delete newPhotos[id];
    }
    // ข้อมูลในสัญญาที่ตรงกับข้อมูลผู้เช่า → อัปเดตผู้เช่าให้ตรงกัน
    Object.assign(rec, { name: C.tenantName.trim(), idNo: String(C.tenantId).trim(), phone: String(C.phone).trim(), faceCode: String(C.faceCode || '').trim(), lang: C.lang,
      occupants: outOcc, rent: Number(C.rent) || 0, deposit: Number(C.deposit) || 0, fridge: Number(C.fridgeFee) || 0,
      birthDate: C.birthDate || '', address: String(C.address || '').trim(),
      wRate: C.wRate === '' ? null : Number(C.wRate), eRate: C.eRate === '' ? null : Number(C.eRate),
      contract: { ...C, savedAt: new Date().toISOString() } });
    if (isNew) {
      // ผู้เช่าเข้าใหม่: วันเข้าพัก = วันเข้าพักในสัญญา · ค่าที่จอดรายเดือนจากรายการ "ค่าที่จอด…" ในค่าเช่าอื่นๆ
      rec.active = true; rec.since = C.moveIn || C.date;
      rec.parkingFee = C.extras.filter(x => /จอด|park/i.test(x.name)).reduce((a, x) => a + (Number(x.amt) || 0), 0);
    }
    await db.put('tenants', rec); t = rec; drawOccs();
    if (isNew) {
      isNew = false; q('#c-title').innerHTML = title();
      const sel = q('#c-room'); if (sel) sel.disabled = true;
      toast(`บันทึกผู้เช่าคลัง ${rec.room} แล้ว`);
    }
    q('#c-err').textContent = '';
    dirty = false;
    return true;
  };
  const busy = async (btn, label, fn) => {
    const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { if (await save()) await fn(); } catch (e) { toast('ทำไม่สำเร็จ: ' + e.message, 5000); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
  };
  // ปิด: ถ้ามีข้อมูลที่ยังไม่บันทึก ถามก่อน (ซ้อนบนหน้าต่าง ไม่ปิดฟอร์มทิ้ง)
  let dirty = false;
  q('#cf').addEventListener('input', () => { dirty = true; });
  q('#cf').addEventListener('change', () => { dirty = true; });
  q('#c-x').onclick = () => {
    if (dirty || newId || Object.keys(newPhotos).length || occs.some(o => o._new)) {
      if (!window.confirm('ยังไม่ได้บันทึกข้อมูลในหน้าต่างนี้\nปิดโดยไม่บันทึกใช่ไหม?')) return;
    }
    closeModal(); done?.();
  };
  q('#c-xtop').onclick = () => q('#c-x').onclick();
  q('#c-save').onclick = () => busy(q('#c-save'), 'กำลังบันทึก…', async () => toast('บันทึกสัญญาแล้ว'));
  q('#c-print').onclick = () => busy(q('#c-print'), 'กำลังเตรียม…', async () => K.printContract(await docOf()));
  q('#c-pdf').onclick = () => busy(q('#c-pdf'), 'กำลังสร้าง PDF…', async () => { const pdf = await K.contractPdf(await docOf()); K.download(pdf.output('blob'), K.fileName(C, 'pdf')); toast('ดาวน์โหลด PDF แล้ว'); });
  q('#c-word').onclick = () => busy(q('#c-word'), 'กำลังสร้าง Word…', async () => { K.download(await K.contractDocx(await docOf()), K.fileName(C, 'docx')); toast('ดาวน์โหลดไฟล์ Word แล้ว'); });
  q('#c-line').onclick = () => busy(q('#c-line'), 'กำลังส่ง LINE…', async () => {
    const r = await K.sendContractLine(C, tenantView(), photoUrl);
    const rec = db.get('tenants', t.id);   // ผู้เช่าใหม่ที่ยังไม่กดบันทึกจะยังไม่มีในฐานข้อมูล
    if (rec) await db.put('tenants', { ...rec, contract: { ...rec.contract, lineSentAt: new Date().toISOString(), pdfUrl: r.pdfUrl || '' } });
    toast(r.sent ? `ส่งสัญญาเข้า LINE คลัง ${C.room} แล้ว` : `คลัง ${C.room} ยังไม่ผูก LINE OA — เก็บ PDF ไว้ใน Drive แล้ว`, 4000);
  });
  calc();
}

// ---------- สัญญาเช่าคลังสินค้า (โครงการประเภทคลัง): ผู้เช่าเป็นนิติบุคคลหรือบุคคลธรรมดา · ระยะเวลาเช่า · เงินประกัน · อัตราน้ำไฟขั้นต่ำ ----------
async function openContractWH(tIn = {}, done) {
  let isNew = !(tIn.id && db.get('tenants', tIn.id));
  const vacant = M.rooms().filter(r => !M.tenantOf(r.id));
  if (isNew && !vacant.length) return toast('ไม่มีคลังว่าง');
  let t = isNew ? { id: uid('t-'), room: vacant.some(r => r.id === tIn.room) ? tIn.room : vacant[0].id, rent: 0, deposit: 0, occupants: [], lang: 'th', active: true, ...tIn, id: uid('t-') } : db.get('tenants', tIn.id);
  if (isNew && !tIn.rent) t.rent = Number(db.get('rooms', t.room)?.rent) || 0;
  const C = { ...K.defaultsWH(t), ...(t.contract?.kind === 'wh' ? t.contract : {}) };
  C.photos = (C.photos || []).map(x => ({ ...x }));
  const f = (k, label, cls = 'f-blue', attrs = '', full = false) => `<div${full ? ' class="full"' : ''}><label class="l">${label}</label><input class="${cls}" data-k="${k}" value="${esc(C[k] ?? '')}" ${attrs}></div>`;
  const num = 'inputmode="decimal"';
  const title = () => `${isNew ? '🏭 ผู้เช่าใหม่ · ทำสัญญาเช่าคลังสินค้า' : '📝 สัญญาเช่าคลังสินค้า'} · คลัง ${esc(C.room)}`;
  const box = openModal(`<style>${CSS}</style><h3 style="margin-bottom:6px" id="c-title">${title()}</h3>
    <div class="ctm"><div class="frm" id="cf">
      <div class="sec"><h4>🏢 1. ผู้เช่า</h4>
        <div class="seg" id="c-type" style="display:flex;margin-bottom:8px"><button type="button" class="btn" data-t="company">นิติบุคคล (บริษัท / หจก.)</button><button type="button" class="btn" data-t="person">บุคคลธรรมดา</button></div>
        <div class="g2">
          ${f('tenantName', '<span id="c-nml">ชื่อนิติบุคคล</span>', 'f-blue', '', true)}
          <div><label class="l" id="c-taxl">เลขประจำตัวผู้เสียภาษี</label><input class="f-blue" data-k="tenantTaxId" value="${esc(C.tenantTaxId)}" inputmode="numeric"></div>
          ${f('phone', 'เบอร์โทร')}
          ${f('tenantAddress', '<span id="c-addrl">ที่ตั้งสำนักงานใหญ่</span>', 'f-blue', '', true)}
          <div class="full co-only">${f('tenantSigner', 'กรรมการผู้มีอำนาจลงนาม (ฝ่ายผู้เช่า)').slice(5, -6)}</div>
          <div class="full"><label class="wh-sw"><input type="checkbox" id="c-proxy" ${C.proxy ? 'checked' : ''}><i></i><span><b>ลงนามโดยผู้รับมอบอำนาจ</b><br><span class="note">ต้องแนบหนังสือมอบอำนาจ + สำเนาบัตรผู้รับมอบอำนาจ</span></span></label></div>
          <div class="full px-only">${f('proxyName', 'ชื่อผู้รับมอบอำนาจ (ลงนามแทนผู้เช่า)').slice(5, -6)}</div>
          <div class="full co-only"><label class="l">วันที่ออกหนังสือรับรองบริษัท</label><input class="f-blue" type="date" data-k="certDate" value="${esc(C.certDate || '')}"><div class="auto" id="c-certw"></div></div>
        </div>
        <div id="c-docs" class="wh-docs"></div></div>
      <div class="sec"><h4>📄 2. รายละเอียดสัญญา</h4>
        <div class="g2">
          ${f('contractNo', 'เลขที่สัญญา', 'f-blue', 'placeholder="เช่น RAD-MRE69-07"')}${f('date', 'วันที่ทำสัญญา', 'f-blue', 'type="date"')}
          <div><label class="l">คลัง</label>${isNew ? `<select class="f-red" id="c-room">${vacant.map(r => `<option ${r.id === C.room ? 'selected' : ''}>${r.id}</option>`).join('')}</select>` : `<input class="f-red" value="${esc(C.room)}" disabled>`}</div>
          ${f('area', 'เนื้อที่ (ตารางเมตร)', 'f-red', num)}
          ${f('start', 'วันเริ่มเช่า', 'f-red', 'type="date"')}${f('end', 'วันสิ้นสุดสัญญา', 'f-red', 'type="date"')}
          <div>${f('rent', 'ค่าเช่า/เดือน (บาท)', 'f-red', num).slice(5, -6)}<div class="auto" id="c-words"></div></div>
          ${f('dueDay', 'ชำระภายในวันที่ (ของทุกเดือน)', 'f-red', 'inputmode="numeric"')}
          <div class="full">${f('penalty', 'ค่าปรับต่อเดือน กรณีไม่ขนย้ายออกเมื่อสิ้นสุดสัญญา (บาท)', 'f-red', num).slice(5, -6)}<div class="auto">ตั้งต้น = ค่าเช่า 1 เดือน ตามสัญญาเดิม</div></div>
          ${f('deposit', 'เงินประกันความเสียหาย (บาท)', 'f-blue', num)}${f('clean', 'เงินประกันการทำความสะอาด (บาท)', 'f-blue', num)}
          <div class="full"><label class="l">รวมเงินประกัน (ข้อ 3)</label><input class="f-red" id="c-total" disabled></div>
        </div></div>
      <div class="sec"><h4>💧⚡ 3. ค่าน้ำ ค่าไฟ และมิเตอร์ (ข้อ 8)</h4>
        <label class="wh-sw"><input type="checkbox" id="c-self" ${C.selfElec ? 'checked' : ''}><i></i><span><b>ผู้เช่าขอไฟฟ้าจากการไฟฟ้าเอง</b><br><span class="note">ไม่คิดค่าไฟในบิล · ไม่มีช่องจดมิเตอร์ไฟ · ข้อ 8.2 เปลี่ยนเป็นเงื่อนไขโอนมิเตอร์คืนก่อนรับเงินประกัน</span></span></label>
        <div id="c-back" class="wh-back" hidden><b>🔁 รับโอนมิเตอร์ไฟฟ้าคืน</b> <span class="note">— ปิดสวิตช์ในสัญญาที่ผู้เช่าเคยขอไฟฟ้าเอง ต้องกรอกวันที่และเลขมิเตอร์ ณ วันรับโอน · บิลถัดไปคิดค่าไฟจากเลขนี้</span>
          <div class="g2"><div><label class="l">วันที่รับโอน *</label><input class="f-orange" type="date" id="c-backdate" value="${esc(C.elecBack?.date || '')}"></div><div id="c-backrd"></div></div></div>
        <div class="g2">
          <div><h5 class="wh-h">💧 น้ำประปา</h5>
            <label class="l">จำนวนมิเตอร์น้ำ (มาตร)</label><div class="wh-cnt"><button type="button" class="btn sm" data-cnt="w:-1">−</button><b id="c-nW">1</b><button type="button" class="btn sm" data-cnt="w:1">+</button></div>
            <div id="c-mw"></div>
            ${f('wRate', 'ค่าน้ำ บาท/หน่วย (เกินขั้นต่ำ)', 'f-blue', num)}${f('wMinUnits', 'ค่าน้ำขั้นต่ำ: 0 ถึง (หน่วย)', 'f-blue', 'inputmode="numeric"')}
            ${f('wMinAmount', 'ค่าน้ำเหมาจ่ายขั้นต่ำ (บาท)', 'f-blue', num)}</div>
          <div id="c-ebox"><h5 class="wh-h">⚡ ไฟฟ้า</h5>
            <label class="l">จำนวนมิเตอร์ไฟฟ้า (มาตร)</label><div class="wh-cnt"><button type="button" class="btn sm" data-cnt="e:-1">−</button><b id="c-nE">1</b><button type="button" class="btn sm" data-cnt="e:1">+</button></div>
            <div id="c-me"></div>
            ${f('eRate', 'ค่าไฟ บาท/หน่วย (ตั้งแต่ 21 หน่วย)', 'f-blue', num)}
            ${f('eTable', 'ตารางค่าไฟ 0–20 หน่วย (บาท 21 ค่า คั่นด้วย ,)', 'f-blue').slice(0, -6)}<div class="auto" id="c-etab"></div></div></div>
        </div>
        <p class="note" style="margin:6px 0 0">มีหลายมิเตอร์: ตอนออกบิลรวมหน่วยทุกมิเตอร์ของชนิดเดียวกันก่อน แล้วคิดตามขั้นต่ำ/ตารางของสัญญานี้</p></div>
      <div class="sec"><h4>✍️ 4. ผู้ลงนาม</h4>
        <div class="g2">
          ${f('lessorSigner', 'กรรมการผู้มีอำนาจลงนาม (ฝ่ายผู้ให้เช่า)', 'f-blue', '', true)}
          ${f('witness1', 'พยานคนที่ 1')}${f('witness2', 'พยานคนที่ 2')}
        </div></div>
      <p class="note" style="margin:0 0 8px">แผนผังบริเวณ (เอกสารที่ 1) แนบท้ายสัญญาให้อัตโนมัติจากหน้า "ผังคลัง" พร้อมกรอบสีแดงที่คลังที่เช่า · ข้อความสัญญาตามแบบสัญญาเช่าคลังเดิม ควรให้ผู้รู้กฎหมายตรวจก่อนใช้จริง</p>
      <div class="err" id="c-err"></div>
    </div>
    <div class="pv"><div class="zm" id="c-pv"><p class="note" style="padding:20px">กำลังสร้างตัวอย่างสัญญา…</p></div></div></div>
    <div class="form-acts">
      <button class="btn" id="c-x">ปิด</button><button class="btn" id="c-save">💾 บันทึก</button>
      <button class="btn" id="c-word">📄 Word</button><button class="btn" id="c-pdf">📕 PDF</button><button class="btn pri" id="c-print">🖨️ พิมพ์</button>
      <button class="btn line" id="c-line" ${M.lineLinkOf(C.room) ? '' : `title="คลัง ${esc(C.room)} ยังไม่ผูก LINE OA"`}>💬 ส่ง LINE</button></div>`, { wide: true, sticky: true });
  box.style.maxWidth = '1320px'; box.style.width = '96vw';
  const q = s => box.querySelector(s), inp = k => box.querySelector(`[data-k="${k}"]`);
  const setVal = (k, v) => { C[k] = v; const el = inp(k); if (el) el.value = v; };
  const docOf = (forLine = false) => K.build(C, t, { forLine });
  let pvTimer, pvSeq = 0;
  const preview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(async () => { const seq = ++pvSeq, html = await K.pagesHtml(await docOf()); if (seq === pvSeq && q('#c-pv')) q('#c-pv').innerHTML = `<style>${K.previewCss()}</style>${html}`; }, 350); };
  if (!document.getElementById('ct-font')) document.head.insertAdjacentHTML('beforeend', '<link id="ct-font" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">');
  const calc = () => {
    const co = C.tenantType !== 'person';
    box.querySelectorAll('#c-type button').forEach(b => b.classList.toggle('pri', b.dataset.t === (co ? 'company' : 'person')));
    q('#c-nml').textContent = co ? 'ชื่อนิติบุคคล' : 'ชื่อ-นามสกุล ผู้เช่า';
    q('#c-taxl').textContent = co ? 'เลขประจำตัวผู้เสียภาษี' : 'เลขประจำตัวประชาชน';
    q('#c-addrl').textContent = co ? 'ที่ตั้งสำนักงานใหญ่' : 'ที่อยู่';
    box.querySelectorAll('.co-only').forEach(d => d.hidden = !co);
    box.querySelectorAll('.px-only').forEach(d => d.hidden = !C.proxy);
    const cw = q('#c-certw'); if (cw) { cw.textContent = !C.certDate ? 'ต้องออกไม่เกิน 6 เดือนก่อนวันทำสัญญา' : certTooOld(C) ? '⛔ หนังสือรับรองออกเกิน 6 เดือนแล้ว — ขอฉบับใหม่จากผู้เช่า' : '✅ ไม่เกิน 6 เดือน'; cw.style.color = certTooOld(C) ? '#dc2626' : ''; }
    const tot = K.total(C); q('#c-total').value = `${tot.toLocaleString('en-US')} บาท (${bahtText(tot)})`;
    q('#c-words').textContent = Number(C.rent) ? bahtText(C.rent) : '';
    const n = String(C.eTable || '').split(/[,\s]+/).filter(Boolean).length;
    q('#c-etab').textContent = n === 21 ? 'ครบ 21 ค่า (0–20 หน่วย)' : `⚠️ มี ${n} ค่า ต้องมี 21 ค่า (0 ถึง 20 หน่วย)`;
    preview();
  };
  let dirty = false;
  // ---- มิเตอร์: จำนวน 1 = ช่องเลขเริ่มต้นช่องเดียว · มากกว่า 1 = ชื่อ + เลขเริ่มต้นทีละตัว ----
  let wasSelf = !!(t.contract?.kind === 'wh' && t.contract.selfElec);   // สัญญาที่บันทึกไว้ ผู้เช่าขอไฟฟ้าเองอยู่
  const meterRows = k => {
    const n = K.meterCount(C, k), list = K.meterList(C, k), cls = k === 'w' ? 'f-lblue' : 'f-orange', w = k === 'w' ? 'น้ำ' : 'ไฟ';
    q(k === 'w' ? '#c-nW' : '#c-nE').textContent = n;
    q(k === 'w' ? '#c-mw' : '#c-me').innerHTML = n === 1
      ? `<label class="l">มิเตอร์${w}เริ่มต้น</label><input class="${cls}" data-mt="${k}:0:start" value="${esc(list[0].start)}" inputmode="numeric" placeholder="เลขมิเตอร์ ณ วันทำสัญญา">`
      : list.map((m, i) => `<div class="wh-m"><div><label class="l">ชื่อมิเตอร์ ${i + 1}</label><input class="${cls}" data-mt="${k}:${i}:name" value="${esc(m.name)}"></div>
          <div><label class="l">เลขเริ่มต้น</label><input class="${cls}" data-mt="${k}:${i}:start" value="${esc(m.start)}" inputmode="numeric"></div></div>`).join('')
        + '<div class="auto">ชื่อตั้งให้อัตโนมัติ พิมพ์ทับได้ เช่น "ไฟหน้าคลัง" หรือเลขมิเตอร์ของการไฟฟ้า</div>';
  };
  const setMt = (k, i, fld, v) => {
    if (fld === 'start' && i === 0) { C[k === 'w' ? 'meterW' : 'meterE'] = v; return; }
    const key = k + (fld === 'name' ? 'Names' : 'Starts'), arr = [...(C[key] || [])]; arr[i] = v; C[key] = arr;
  };
  const paintElec = () => {
    q('#c-ebox').classList.toggle('off', !!C.selfElec);
    const back = wasSelf && !C.selfElec; q('#c-back').hidden = !back;
    if (back) {
      if (!C.elecBack) C.elecBack = { date: new Date().toISOString().slice(0, 10), readings: [] };
      q('#c-backdate').value = C.elecBack.date || '';
      q('#c-backrd').innerHTML = K.meterList(C, 'e').map((m, i) => `<label class="l">เลขมิเตอร์ไฟ${K.meterCount(C, 'e') > 1 ? ` (${esc(m.name)})` : ''} ณ วันรับโอน *</label><input class="f-orange" data-bk="${i}" value="${esc(C.elecBack.readings?.[i] ?? '')}" inputmode="numeric">`).join('');
    }
  };
  meterRows('w'); meterRows('e'); paintElec();
  // ---- เอกสารผู้เช่า (รูป หรือ PDF แปลงเป็นรูปทีละหน้า) — เก็บจริงตอนกดบันทึก ----
  C.docs = (C.docs || []).map(d => ({ ...d }));
  const newDocs = {}, docCache = {};
  const docSrc = async id => {
    if (newDocs[id] || docCache[id]) return newDocs[id] || docCache[id];
    let p = await db.getPhoto(id);
    if (!p && isServerMode() && navigator.onLine) { try { const r = await api.call('getPhoto', { id }); p = { id, dataUrl: r.dataUrl, driveId: r.fileId, name: r.name }; await db.putPhoto(p); } catch {} }
    return (docCache[id] = p?.dataUrl || '');
  };
  const drawDocs = () => {
    const need = WH_DOCS.filter(([, , on]) => on(C));
    q('#c-docs').innerHTML = need.length ? `<label class="l" style="margin:0">📎 เอกสารประกอบสัญญา</label>` + need.map(([tag, label]) => {
      const list = C.docs.filter(d => d.tag === tag);
      return `<div class="wh-doc ${list.length ? '' : 'miss'}"><div class="hd"><span>${list.length ? '✅' : '⚠️'} <b>${label}</b>${list.length ? ` <span class="note">${list.length} หน้า</span>` : ' <span class="note">ยังไม่แนบ</span>'}</span>
        <label class="btn sm">📎 เลือกไฟล์ (รูป / PDF)<input type="file" accept="image/*,application/pdf" multiple hidden data-doc="${tag}"></label></div>
        ${list.length ? `<div class="th">${list.map(d => `<span><img data-dimg="${d.id}" alt="${esc(label)}"><button type="button" data-drm="${d.id}" title="ลบหน้านี้">✕</button></span>`).join('')}</div>` : ''}</div>`;
    }).join('') : '';
    q('#c-docs').querySelectorAll('[data-dimg]').forEach(async img => { img.src = await docSrc(img.dataset.dimg); img.onclick = () => { const w = window.open(); if (w) w.document.write(`<img src="${img.src}" style="max-width:100%">`); }; });
    q('#c-docs').querySelectorAll('[data-drm]').forEach(b => b.onclick = () => { C.docs = C.docs.filter(d => d.id !== b.dataset.drm); delete newDocs[b.dataset.drm]; dirty = true; drawDocs(); });
    q('#c-docs').querySelectorAll('[data-doc]').forEach(inp => inp.onchange = async () => {
      const tag = inp.dataset.doc, files = [...inp.files]; if (!files.length) return;
      const lbl = inp.closest('label'); lbl.firstChild.textContent = 'กำลังอ่านไฟล์…';
      try {
        for (const file of files) {
          let pages;
          if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { const r = await pdfPages(file); pages = r.pages; if (r.total > r.pages.length) toast(`PDF มี ${r.total} หน้า เก็บไว้ ${r.pages.length} หน้าแรก`, 4000); }
          else pages = [await compress(await fileToDataUrl(file))];
          for (const url of pages) { const id = uid('doc-'); newDocs[id] = url; C.docs.push({ id, tag }); }
        }
        dirty = true;
      } catch (e) { toast('อ่านไฟล์ไม่ได้: ' + e.message, 5000); }
      drawDocs();
    });
  };
  drawDocs();
  q('#c-proxy').onchange = e => { C.proxy = e.target.checked; dirty = true; drawDocs(); calc(); };
  box.querySelectorAll('[data-cnt]').forEach(b => b.onclick = () => {
    const [k, d] = b.dataset.cnt.split(':'), key = k === 'w' ? 'nW' : 'nE';
    C[key] = Math.min(6, Math.max(1, K.meterCount(C, k) + Number(d))); dirty = true; meterRows(k); if (k === 'e') paintElec(); calc();
  });
  q('#c-self').onchange = e => { C.selfElec = e.target.checked; if (C.selfElec) C.elecBack = null; dirty = true; paintElec(); calc(); };
  q('#cf').addEventListener('input', e => {
    const d = e.target.dataset;
    if (d.mt) { const [k, i, fld] = d.mt.split(':'); setMt(k, +i, fld, e.target.value); dirty = true; calc(); return; }
    if (d.bk != null || e.target.id === 'c-backdate') { C.elecBack = { date: q('#c-backdate').value, readings: [...box.querySelectorAll('[data-bk]')].map(x => x.value) }; dirty = true; return; }
    const k = d.k; if (!k) return;
    const before = C[k]; C[k] = e.target.value; dirty = true;
    if (k === 'rent' && (!C.penalty || C.penalty === before)) setVal('penalty', C.rent);
    if (k === 'start' && C.start) setVal('end', K.oneYearEnd(C.start));
    calc();
  });
  box.querySelectorAll('#c-type button').forEach(b => b.onclick = () => { C.tenantType = b.dataset.t; dirty = true; drawDocs(); calc(); });
  q('#c-room')?.addEventListener('change', e => {
    const r = db.get('rooms', e.target.value) || {}; C.room = t.room = e.target.value;
    setVal('rent', String(Number(r.rent) || 0)); setVal('penalty', C.rent); setVal('area', r.area ? String(r.area) : C.area);
    const last = M.readings(C.room)[0]; C.meterE = last?.e != null ? String(last.e) : ''; C.meterW = last?.w != null ? String(last.w) : ''; meterRows('w'); meterRows('e');
    q('#c-title').innerHTML = title(); q('#c-line').title = M.lineLinkOf(C.room) ? '' : `คลัง ${C.room} ยังไม่ผูก LINE OA`; calc();
  });
  const save = async () => {
    if (!String(C.tenantName).trim()) { q('#c-err').textContent = 'กรุณากรอกชื่อผู้เช่า'; inp('tenantName').focus(); return false; }
    if (isNew && M.tenantOf(C.room)) { q('#c-err').textContent = `คลัง ${C.room} มีผู้เช่าแล้ว กรุณาเลือกคลังอื่น`; return false; }
    if (C.tenantType !== 'person' && certTooOld(C)) { q('#c-err').textContent = 'หนังสือรับรองบริษัทออกเกิน 6 เดือนก่อนวันทำสัญญา — ขอฉบับใหม่จากผู้เช่า'; inp('certDate')?.focus(); return false; }
    if (C.proxy && !String(C.proxyName || '').trim()) { q('#c-err').textContent = 'กรุณากรอกชื่อผู้รับมอบอำนาจ'; inp('proxyName')?.focus(); return false; }
    if (wasSelf && !C.selfElec) {   // รับโอนมิเตอร์ไฟคืน: ต้องมีวันที่และเลขมิเตอร์ครบทุกตัว
      const rd = C.elecBack?.readings || [];
      if (!C.elecBack?.date || K.meterList(C, 'e').some((_, i) => String(rd[i] ?? '').trim() === '' || isNaN(rd[i]))) { q('#c-err').textContent = 'กรุณากรอกวันที่รับโอนและเลขมิเตอร์ไฟฟ้า ณ วันรับโอนให้ครบ'; q('#c-back').scrollIntoView({ block: 'center' }); return false; }
    }
    const rec = { ...db.get('tenants', t.id) || t, room: C.room };
    Object.assign(rec, { name: C.tenantName.trim(), phone: String(C.phone).trim(), address: String(C.tenantAddress || '').trim(),
      taxId: C.tenantType !== 'person' ? String(C.tenantTaxId).trim() : '', idNo: C.tenantType === 'person' ? String(C.tenantTaxId).trim() : (rec.idNo || ''),
      signer: String(C.tenantSigner || '').trim(), rent: Number(C.rent) || 0, deposit: (Number(C.deposit) || 0) + (Number(C.clean) || 0),
      wRate: C.wRate === '' ? null : Number(C.wRate), eRate: C.eRate === '' ? null : Number(C.eRate),
      // มิเตอร์และไฟฟ้า: ใช้ตอนออกบิล (core/model.js meterSetup)
      selfElec: !!C.selfElec, meters: { w: K.meterList(C, 'w').map(m => m.name), e: K.meterList(C, 'e').map(m => m.name) },
      company: C.tenantType !== 'person' ? C.tenantName.trim() : '',
      docs: WH_DOCS.filter(([, , on]) => on(C)).map(([tag]) => tag).filter(tag => C.docs.some(d => d.tag === tag)),   // เอกสารที่แนบแล้ว (ใช้เตือน "ข้อมูลไม่ครบ")
      docsNeed: WH_DOCS.filter(([, , on]) => on(C)).map(([tag]) => tag),
      elecBack: C.selfElec ? null : wasSelf ? C.elecBack : (rec.elecBack || null),
      contract: { ...C, wNames: K.meterList(C, 'w').map(m => m.name), eNames: K.meterList(C, 'e').map(m => m.name), savedAt: new Date().toISOString() } });
    if (isNew) { rec.active = true; rec.since = C.start || C.date; }
    // เอกสารที่เพิ่งแนบ → เก็บในเครื่อง แล้วเข้าคิวอัปโหลด Google Drive (โฟลเดอร์ contract) เหมือนรูปบัตร
    const LBL = Object.fromEntries(WH_DOCS.map(([k, l]) => [k, l.replace(/\s*\(.*\)$/, '')]));
    for (const d of rec.contract.docs || []) {
      const url = newDocs[d.id]; if (!url) continue;
      const n = rec.contract.docs.filter(x => x.tag === d.tag).indexOf(d) + 1;
      await db.putPhoto({ id: d.id, dataUrl: url, name: `${rec.room}-${C.tenantName.trim()}-${LBL[d.tag] || 'เอกสาร'}-${n}.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: d.id, folder: 'contract' }); docCache[d.id] = url; delete newDocs[d.id];
    }
    await db.put('tenants', rec); t = rec; wasSelf = !!C.selfElec;
    if (isNew) { isNew = false; q('#c-title').innerHTML = title(); const s = q('#c-room'); if (s) s.disabled = true; toast(`บันทึกผู้เช่าคลัง ${rec.room} แล้ว`); }
    q('#c-err').textContent = ''; dirty = false; return true;
  };
  const busy = async (btn, label, fn) => { const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { if (await save()) await fn(); } catch (e) { toast('ทำไม่สำเร็จ: ' + e.message, 5000); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = old; } } };
  q('#c-x').onclick = () => { if (dirty && !window.confirm('ยังไม่ได้บันทึกข้อมูลในหน้าต่างนี้\nปิดโดยไม่บันทึกใช่ไหม?')) return; closeModal(); done?.(); };
  q('#c-save').onclick = () => busy(q('#c-save'), 'กำลังบันทึก…', async () => toast('บันทึกสัญญาแล้ว'));
  q('#c-print').onclick = () => busy(q('#c-print'), 'กำลังเตรียม…', async () => K.printContract(await docOf()));
  q('#c-pdf').onclick = () => busy(q('#c-pdf'), 'กำลังสร้าง PDF…', async () => { const pdf = await K.contractPdf(await docOf()); K.download(pdf.output('blob'), K.fileName(C, 'pdf')); toast('ดาวน์โหลด PDF แล้ว'); });
  q('#c-word').onclick = () => busy(q('#c-word'), 'กำลังสร้าง Word…', async () => { K.download(await K.contractDocx(await docOf()), K.fileName(C, 'docx')); toast('ดาวน์โหลดไฟล์ Word แล้ว'); });
  q('#c-line').onclick = () => busy(q('#c-line'), 'กำลังส่ง LINE…', async () => {
    const r = await K.sendContractLine(C, t);
    const rec = db.get('tenants', t.id); if (rec) await db.put('tenants', { ...rec, contract: { ...rec.contract, lineSentAt: new Date().toISOString(), pdfUrl: r.pdfUrl || '' } });
    toast(r.sent ? `ส่งสัญญาเข้า LINE คลัง ${C.room} แล้ว` : `คลัง ${C.room} ยังไม่ผูก LINE OA — เก็บ PDF ไว้ใน Drive แล้ว`, 4000);
  });
  calc();
}
