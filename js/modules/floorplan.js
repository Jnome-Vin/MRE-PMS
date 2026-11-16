// ผังหน่วยเช่า (คลัง / โกดัง / คูหา) — ผังปรับได้: รูปแบบแปลนเป็นพื้นหลัง + กรอบหน่วยเช่าวางทับ (ดู core/layout.js)
// ผู้ดูแลระบบกด "ปรับผัง" เพื่ออัปโหลดแบบแปลน (รูป/PDF) แล้วลากวาง หรือให้ Claude Desktop สร้างไฟล์ app/layout/layout.json
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import * as L from '../core/layout.js';
import * as acc from '../core/access.js';
import { UNIT, FLOOR, feature, SITE } from '../core/config.js';
import { esc, fmt0, thDate, periodLabel, toast, confirmBox, openModal, closeModal } from '../core/ui.js';
// โครงการประเภทคลัง: คลิกคลังว่าง = ทำสัญญาใหม่ทันที · คลิกคลังที่มีผู้เช่า = ป๊อปอัปรายละเอียดกลางจอ (ไม่มีแผงด้านขวา)
const WH = SITE.kind === 'warehouse';
import { openTenantForm, moveOut, photoThumb, openTenantHistory, cancelMoveOut, printRefund, compress, fileToDataUrl } from './tenants.js';
import { openPayment, openPaymentDetail, hasSlipIssue } from './billing.js';
import { occ } from '../core/idcard.js';

let floor = null, sel = null;
let draft = null;   // สำเนาผังที่กำลังแก้ในโหมด "ปรับผัง" (null = โหมดใช้งานปกติ)

// ⚠️ ยังไม่มีรูปบัตร / ข้อมูลไม่ครบ (ชี้เมาส์เพื่อดูว่าขาดอะไร)
const warn = t => { const m = M.missingText(t); return m ? `<span class="warn-ic" title="${esc(m)}">⚠️</span>` : ''; };

function cell(r) {
  if (!r) return '<div></div>';
  const st = M.roomState(r), t = M.tenantOf(r.id), sl = M.slotsOf(r.id);
  const car = sl.some(s => s.zone === 'CAR'), moto = sl.filter(s => s.zone !== 'CAR').length;
  const x = M.contractExpiry(t);   // สัญญาเหลือน้อยกว่า 3 เดือน → กรอบแดงกระพริบ + ป้าย
  return `<div class="room ${M.ROOM_TXT[st][2]} ${sel === r.id && !WH ? 'sel' : ''} ${x?.soon ? 'exp' : ''}" data-room="${r.id}" title="${M.ROOM_TXT[st][0]}">
    <div><div class="no">${r.id}</div><div class="nm">${esc(t?.name || r.label || '— ว่าง —')}</div>${x?.soon ? `<div class="exp-tag">${esc(x.short)}</div>` : ''}</div>
    <div class="ic">${r.type === 'พัดลม' ? '<span title="คลังพัดลม">🌀<small>พัดลม</small></span>' : ''}${feature('fridge') && t?.fridge ? '<span title="เช่าตู้เย็น">🧊</span>' : ''}${moto ? `<span title="ที่จอดมอไซค์">🏍️${moto > 1 ? `<small>×${moto}</small>` : ''}</span>` : ''}${car ? '<span title="ที่จอดรถยนต์">🚗</span>' : ''}${warn(t)}</div></div>`;
}

function detail(id) {
  if (!id) return `<div class="empty">👆 คลิก${UNIT}เพื่อดูรายละเอียด<br>ผู้เช่า · ค่าเช่า · ตู้เย็น · ที่จอดรถ · บิล</div>`;
  const r = db.get('rooms', id), t = M.tenantOf(id), st = M.roomState(r), sl = M.slotsOf(id);
  const last = db.all('bills').filter(b => b.room === id).sort((a, b) => b.period.localeCompare(a.period))[0];
  const link = M.lineLinkOf(id);
  return `<div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><h3>${UNIT} ${id}</h3><div class="note">${esc(r.label || r.type)}${r.floor ? ' · ' + FLOOR + ' ' + r.floor : ''}</div></div>
    <span class="pill ${M.ROOM_TXT[st][1]}">${M.ROOM_TXT[st][0]}</span></div>
  ${M.missingText(t) ? `<div class="missing-box">⚠️ <b>${esc(M.missingText(t))}</b> <a href="#" data-a="fill">กรอกเพิ่ม →</a></div>` : ''}
  <dl>
    <dt>ผู้เช่า</dt><dd>${esc(t?.name || '-')}</dd>
    <dt>โทร</dt><dd>${t?.phone ? `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>` : '-'}</dd>
    ${t?.occupants?.length ? `<dt>ผู้พักร่วม</dt><dd>${t.occupants.map(o => { o = occ(o); return `${esc(o.name || '-')}${o.idNo ? ` <span class="note">${esc(o.idNo)}</span>` : ''}${o.photo ? ' 📄' : ''}`; }).join('<br>')}</dd>` : ''}
    <dt>เข้าพัก</dt><dd>${thDate(t?.since)}${t?.since ? ` <span class="note">(${M.stayText(t.since)})</span>` : ''}</dd>
    ${t && !t.company && !t.taxId ? `<dt>วันเกิด</dt><dd>${t.birthDate ? thDate(t.birthDate) + (+t.birthDate.slice(5, 7) === new Date().getMonth() + 1 ? ' 🎂' : '') : '<span class="pill warn">ยังไม่ระบุ</span>'}</dd>` : ''}
    <dt>ค่าเช่า</dt><dd>฿${fmt0(t?.rent ?? r.rent)}</dd>
    <dt>น้ำ / ไฟ</dt><dd>฿${M.roomRates(r, t).water} / ฿${M.roomRates(r, t).elec} ต่อหน่วย${t && (t.wRate != null || t.eRate != null) ? ' <span class="note">(ตามสัญญา)</span>' : ''}</dd>
    ${t ? `<dt>เงินประกัน</dt><dd>฿${fmt0(t.deposit)}${M.depositUsed(t) ? ` <span class="note">(หักชำระบิลแล้ว ฿${fmt0(M.depositUsed(t))} · คงเหลือ ฿${fmt0(M.depositLeft(t))})</span>` : ''}${t.rentAdvance ? ` · ล่วงหน้า ฿${fmt0(t.rentAdvance)}` : ''}</dd>` : ''}
    ${t?.note ? `<dt>หมายเหตุ</dt><dd class="note">${esc(t.note)}</dd>` : ''}
    ${feature('fridge') ? `<dt>ตู้เย็น</dt><dd>${t?.fridge ? `🧊 เช่า ฿${fmt0(t.fridge)}/เดือน` : 'ไม่ได้เช่า'}</dd>` : ''}
    <dt>ค่าที่จอด</dt><dd>${t?.parkingFee ? `฿${fmt0(t.parkingFee)}/เดือน` : '-'}</dd>
    <dt>ที่จอดรถ</dt><dd><div class="chips">${sl.length ? sl.map(s => `<button class="chip" data-slot="${s.id}">${s.zone === 'CAR' ? '🚗' : '🏍️'} ${s.id}${s.plate ? ' · ' + esc(s.plate) : ''}</button>`).join('') : '-'}</div></dd>
    <dt>บิลล่าสุด</dt><dd>${last ? `${periodLabel(last.period, true)} · ฿${fmt0(M.calcBill(last).total)} ${M.billState(last) === 'internal' ? `<span class="pill idle">ส่วนกลาง</span>`
      : `<button class="pill ${M.BILL_TXT[M.billState(last)][1]} pay-btn" data-a="lastbill" title="${['paid', 'partial'].includes(M.billState(last)) ? 'ดูรายละเอียดการโอน / แก้ไข' : 'รับชำระเงิน'}">${M.BILL_TXT[M.billState(last)][0]} ${hasSlipIssue(last) ? '⚠️ ตรวจสลิป' : ['paid', 'partial'].includes(M.billState(last)) ? '🔍' : '💰'}</button>`}` : '-'}</dd>
    <dt>LINE</dt><dd>${link ? `✅ ${esc(link.displayName || M.lineName(id))}` : `<span class="note">ยังไม่ผูก (${esc(M.lineName(id))})</span>`}</dd>
    ${t ? `<dt>บัตร ปชช.</dt><dd id="idthumb">${t.idPhoto ? 'กำลังโหลด…' : '<span class="pill bad">ยังไม่แนบ</span>'}</dd>` : ''}
  </dl>
  ${M.stays(id).length ? `<details open><summary><b>ประวัติการเช่าคลังนี้</b> <span class="note">${M.stays(id).length} ราย · กดชื่อเพื่อดูรายละเอียด/บิล</span></summary>
    <div class="scroll" style="max-height:220px;margin-top:6px"><table class="tbl">${M.stays(id).map(p =>
    `<tr class="click" data-past="${p.id}"><td style="white-space:normal">${esc(p.name)}${p.active ? ' <span class="pill ok">ปัจจุบัน</span>' : ''}</td>
      <td class="note" style="white-space:normal">${thDate(p.since)} – ${p.active ? 'ปัจจุบัน' : thDate(p.moveOut)}<br>${M.stayText(p.since, p.active ? null : p.moveOut)}</td></tr>`).join('')}</table></div></details>` : ''}
  <div class="acts">${t ? (WH ? `<button class="btn pri" data-a="contract">✏️ แก้ไข / 🖨️ พิมพ์สัญญา</button><button class="btn" data-a="bill">🧾 ออกบิล / จดมิเตอร์</button><button class="btn" data-a="edit">ข้อมูลผู้เช่าอื่น ๆ</button><button class="btn" data-a="out">ย้ายออก</button>`
      : `<button class="btn pri" data-a="bill">บิลของคลังนี้</button><button class="btn" data-a="edit">แก้ไขผู้เช่า</button><button class="btn" data-a="contract">📝 สัญญาเช่า</button><button class="btn" data-a="out">ย้ายออก</button>`)
    : `<button class="btn pri" data-a="in">+ ผู้เช่าเข้าใหม่</button>${r.kind !== 'room' ? '<button class="btn" data-a="bill">บิล/มิเตอร์</button>' : ''}${M.pastTenantsOf(id)[0] ? `<button class="btn" data-a="undo" title="ใช้เมื่อกดย้ายออกผิด">↩ ยกเลิกการย้ายออก (${esc(M.pastTenantsOf(id)[0].name)})</button>` : ''}${M.pastTenantsOf(id)[0]?.moveOutDoc ? '<button class="btn" data-a="refund">🖨️ เอกสารคืนเงิน</button>' : ''}`}</div>`;
}

// ---------- ป๊อปอัปรายละเอียดคลัง (โครงการประเภทคลัง): ผู้เช่า + สัญญา + เงินประกัน + มิเตอร์ + บิลล่าสุด ----------
function popupHtml(id) {
  const t = M.tenantOf(id), c = t?.contract?.kind === 'wh' ? t.contract : null, r = db.get('rooms', id) || {};
  let html = detail(id);
  if (t) {
    const x = M.contractExpiry(t), dep = Number(c?.deposit) || 0, cln = Number(c?.clean) || 0, key = Number(c?.keyDep) || 0, area = Number(r.area) || Number(c?.area);
    const mt = k => (t.meters?.[k] || []).length > 1 ? t.meters[k].map(esc).join(' · ') : (t.meters?.[k]?.length ? '1 มาตร' : '-');
    const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
    const block = `<div class="fp-ct"><h4>📝 สัญญาเช่า</h4><dl>
      ${row('เลขที่สัญญา', c ? esc(c.contractNo || '-') : '<span class="pill warn">ยังไม่ได้ทำสัญญาในระบบ</span>')}
      ${row('เนื้อที่', area ? `${fmt0(area)} ตร.ม.` : '')}
      ${c ? row('เริ่มเช่า', thDate(c.start)) + row('สิ้นสุดสัญญา', `<span class="${x?.soon ? 'blink-red' : ''}">${thDate(c.end)}</span> <span class="note ${x?.soon ? 'blink-red' : ''}">(${esc(x?.label || '')})</span>`) : ''}
      ${c ? row('เงินประกัน', `ความเสียหาย ฿${fmt0(dep)} + ทำความสะอาด ฿${fmt0(cln)}${key ? ` + กุญแจ ฿${fmt0(key)}` : ''} = <b>฿${fmt0(dep + cln + key)}</b>`) : ''}
      ${row('มิเตอร์น้ำ', mt('w'))}${row('ไฟฟ้า', t.selfElec ? '<span class="pill idle">⚡ ผู้เช่าขอไฟฟ้าจากการไฟฟ้าเอง</span>' : mt('e'))}
    </dl></div>`;
    html = html.replace('<dl>', block + '<dl>');
  }
  return html;
}

// ---------- การ์ดข้อมูลเมื่อชี้เมาส์ที่หน่วยเช่าบนผัง (ข้อมูลผู้เช่า + สัญญาที่บันทึกไว้) ----------
// แสดงเฉพาะเมาส์ (มือถือ/แท็บเล็ตใช้การแตะ → แผงรายละเอียดด้านข้างเหมือนเดิม) · อ่านผ่าน db/model จึงเคารพสิทธิ์การมองเห็น
const addMonths = (iso, n) => { const d = new Date(iso); if (isNaN(d) || !Number(n)) return ''; d.setMonth(d.getMonth() + Number(n)); return d.toISOString().slice(0, 10); };
function hoverHtml(id) {
  const r = db.get('rooms', id); if (!r) return '';
  const t = M.tenantOf(id), st = M.roomState(r), c = t?.contract || {};
  const area = Number(r.area) || Number(c.area);   // พื้นที่ที่ตั้งไว้ใน ตั้งค่า → จัดการคลัง
  const head = `<div class="hv-h"><b>${UNIT} ${esc(id)}</b><span class="pill ${M.ROOM_TXT[st][1]}">${M.ROOM_TXT[st][0]}</span></div>`
    + (area ? `<div class="hv-area">พื้นที่ ${fmt0(area)} ตร.ม.</div>` : '');
  if (!t) return head + `<div class="hv-e">${WH && r.kind === 'room' ? 'ว่าง · คลิกเพื่อทำสัญญาผู้เช่าใหม่' : 'ว่าง · คลิก แล้วกด "+ ผู้เช่าเข้าใหม่" เพื่อทำและพิมพ์สัญญา'}</div>`;
  const x = M.contractExpiry(t);
  const start = c.date || t.since, end = addMonths(start, c.minMonths);
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  return head + `<dl>${row('ผู้เช่า', esc(c.tenantName || t.name || ''))}${row('โทร', esc(t.phone || c.phone || ''))}`
    + (c.kind === 'wh'   // สัญญาเช่าคลัง: เลขที่สัญญา + ระยะเวลาเช่า
      ? `${row('เลขที่สัญญา', esc(c.contractNo || ''))}${row('ระยะเวลาเช่า', c.start ? `${thDate(c.start)} – <span class="${x?.soon ? 'blink-red' : ''}">${thDate(c.end)}</span>${x?.soon ? ` <small class="blink-red">(${esc(x.label)})</small>` : ''}` : '')}`
      : `${row('วันทำสัญญา', start ? thDate(start) : '')}${row('สัญญาขั้นต่ำ', Number(c.minMonths) ? `${esc(c.minMonths)} เดือน${end ? ` · ถึง ${thDate(end)}` : ''}` : '')}`)
    + `${row('ค่าเช่า', `฿${fmt0(t.rent ?? c.rent)} / เดือน`)}${row('เงินประกัน', Number(t.deposit) ? `฿${fmt0(t.deposit)}` : '')}</dl>`
    + (t.contract ? '' : '<div class="hv-e">ยังไม่ได้บันทึกสัญญาในระบบ</div>');
}
function bindHover(el) {
  const fp = el.querySelector('#fp'); if (!fp) return;
  const tip = document.createElement('div'); tip.className = 'fp-tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip'); fp.appendChild(tip);
  const place = e => {
    const B = fp.getBoundingClientRect(), z = (B.width / fp.offsetWidth) || 1;   // z = ซูมหน้าจอ (ปุ่มมุมขวาล่าง)
    const cx = (e.clientX - B.left) / z, cy = (e.clientY - B.top) / z, R = { width: fp.offsetWidth, height: fp.offsetHeight };
    let x = cx + 14, y = cy + 14;
    if (x + tip.offsetWidth > R.width) x = Math.max(0, cx - tip.offsetWidth - 14);
    if (y + tip.offsetHeight > R.height) y = Math.max(0, cy - tip.offsetHeight - 14);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  fp.querySelectorAll('.fp-room').forEach(n => {
    n.removeAttribute('title');   // การ์ดนี้แทน tooltip เดิมของเบราว์เซอร์
    n.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; tip.innerHTML = hoverHtml(n.dataset.room); tip.hidden = false; place(e); });
    n.addEventListener('pointermove', e => { if (!tip.hidden) place(e); });
    n.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}

// ชื่อหน่วยบนผังที่มีรูปพื้นหลัง: ขนาดเดียวกันทุกหน่วย = ขนาดใหญ่ที่สุดที่ทุกหน่วยยังไม่ล้นพื้นที่ของตัวเอง (คำนวณใหม่เมื่อหน้าจอเปลี่ยนขนาด)
let fitRO = null;
function fitLabels(el) {
  fitRO?.disconnect(); fitRO = null;
  const fp = el.querySelector('#fp.has-img'); if (!fp) return;
  const run = () => {
    const rooms = [...fp.querySelectorAll('.fp-room')]; if (!rooms.length) return;
    fp.style.setProperty('--fp-no', '100px');
    let k = Infinity;
    for (const n of rooms) {
      const no = n.querySelector('.no'); if (!no || !no.scrollWidth) continue;
      const cs = getComputedStyle(n);
      const w = n.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = n.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      k = Math.min(k, (w * 0.9) / no.scrollWidth, (h * 0.5) / no.scrollHeight);   // ครึ่งบนของความสูงให้ชื่อหน่วย ที่เหลือให้ชื่อผู้เช่า
    }
    if (!isFinite(k)) return;
    const px = Math.max(10, Math.min(34, Math.floor(100 * k)));
    fp.style.setProperty('--fp-no', px + 'px');
    fp.style.setProperty('--fp-nm', Math.max(10, Math.round(px * 0.55)) + 'px');
  };
  run();
  fitRO = new ResizeObserver(run); fitRO.observe(fp);
}

// ---------- ผัง ----------
const pos = b => `left:${b[0]}%;top:${b[1]}%;width:${b[2]}%;height:${b[3]}%${b[4] ? `;transform:rotate(${b[4]}deg)` : ''}`;
const floorsCfg = () => draft || L.get().floors || {};
const floorCfg = f => floorsCfg()[String(f)] || null;
const floorName = f => floorCfg(f)?.name || `${FLOOR} ${f}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = v => Math.round(v * 2) / 2;
function draftFloor() {
  const k = String(floor);
  if (!draft[k]) draft[k] = { name: '', image: '', ratio: 1.6, boxes: {}, notes: [] };
  draft[k].boxes = draft[k].boxes || {}; draft[k].notes = draft[k].notes || [];
  return draft[k];
}

function planHtml(all) {
  const cfg = floorCfg(floor) || {}, list = all.filter(r => r.floor === floor);
  const boxes = cfg.boxes || {}, placed = list.filter(r => boxes[r.id]), rest = list.filter(r => !boxes[r.id]);
  const hasCanvas = !!(draft || placed.length || cfg.image || cfg.notes?.length);
  const handle = draft ? '<i class="fp-h"></i>' : '';
  const canvas = hasCanvas ? `<div class="fp ${draft ? 'edit' : ''} ${cfg.image ? 'has-img' : ''}" id="fp" style="aspect-ratio:${cfg.ratio || 1.6}">
      <img class="fp-bg" id="fp-bg" alt="" hidden>
      ${(cfg.notes || []).map((n, i) => `<div class="fp-note" data-note="${i}" style="${pos(n.box)}">${esc(n.text)}${handle}</div>`).join('')}
      ${placed.map(r => cell(r).replace('<div class="room ', `<div style="${pos(boxes[r.id])}" class="room fp-room `).replace(/<\/div>\s*$/, handle + '</div>')).join('')}
    </div>` : '';
  const tray = rest.length ? `${hasCanvas ? `<p class="note" style="margin:12px 0 0">${draft ? `ยังไม่ได้วางบนผัง — กดที่${UNIT}เพื่อวางลงผัง` : `${UNIT}ที่ยังไม่ได้วางบนผัง`}</p>` : ''}<div class="ground">${rest.map(cell).join('')}</div>` : '';
  return `<div>${canvas}${tray}${!hasCanvas && !rest.length ? `<div class="card empty">${FLOOR}นี้ยังไม่มี${UNIT} — เพิ่มได้ที่ ตั้งค่า → จัดการ${UNIT}</div>` : ''}</div>`;
}

const toolsHtml = () => `<div class="card fp-tools"><b>✏️ ปรับผัง — ${esc(floorName(floor))}</b>
  <div class="toolbar" style="margin-top:10px">
    <label class="btn">🖼️ อัปโหลดแบบแปลน (รูป / PDF)<input type="file" id="fp-file" accept="image/*,application/pdf" hidden></label>
    <button class="btn" id="fp-auto">▦ วางทุก${UNIT}อัตโนมัติ</button>
    <button class="btn" id="fp-note">＋ ป้ายข้อความ</button>
    <button class="btn" id="fp-name">ตั้งชื่อ${FLOOR}</button>
    <button class="btn" id="fp-noimg">ลบรูปพื้นหลัง</button>
    <button class="btn" id="fp-exp">⬇️ ส่งออกไฟล์ผัง</button>
    <label class="btn">⬆️ นำเข้าไฟล์ผัง<input type="file" id="fp-imp" accept=".json,application/json" hidden></label>
    <span style="flex:1"></span>
    <button class="btn" id="fp-cancel">ยกเลิก</button><button class="btn pri" id="fp-save">💾 บันทึกผัง</button>
  </div>
  <p class="note" style="margin-bottom:0">ลากกรอบเพื่อย้าย · ลากมุมขวาล่างเพื่อย่อ/ขยาย · ดับเบิลคลิกกรอบเพื่อเอาออกจากผัง (ข้อมูล${UNIT}ไม่ถูกลบ) · ดับเบิลคลิกป้ายข้อความเพื่อแก้/ลบ<br>
  ต้องการให้ Claude ช่วยวาดจากแบบแปลน: วางไฟล์แบบแปลนในโฟลเดอร์ <code>layout-input</code> แล้วเปิดโฟลเดอร์โครงการด้วย Claude Desktop (ดูไฟล์ CLAUDE.md)</p></div>`;

function bindEdit(el, re) {
  const cfg = draftFloor(), fp = el.querySelector('#fp');
  // กดหน่วยเช่าที่ยังไม่ได้วาง → วางกลางผัง
  el.querySelectorAll('.ground [data-room]').forEach(b => b.onclick = () => { cfg.boxes[b.dataset.room] = [40, 40, 18, 18]; re(); });
  fp?.querySelectorAll('.fp-room,.fp-note').forEach(node => {
    const isNote = node.dataset.note != null;
    const b = isNote ? cfg.notes[+node.dataset.note].box : cfg.boxes[node.dataset.room];
    node.onclick = e => e.stopPropagation();
    node.onpointerdown = e => {
      e.preventDefault(); node.setPointerCapture(e.pointerId);
      const R = fp.getBoundingClientRect(), resize = e.target.classList.contains('fp-h'), s = [...b], x0 = e.clientX, y0 = e.clientY;
      node.onpointermove = ev => {
        const dx = (ev.clientX - x0) / R.width * 100, dy = (ev.clientY - y0) / R.height * 100;
        if (resize) { b[2] = snap(clamp(s[2] + dx, 2, 100 - s[0])); b[3] = snap(clamp(s[3] + dy, 2, 100 - s[1])); }
        else { b[0] = snap(clamp(s[0] + dx, 0, 100 - s[2])); b[1] = snap(clamp(s[1] + dy, 0, 100 - s[3])); }
        node.style.cssText = pos(b);
      };
      node.onpointerup = node.onpointercancel = () => { node.onpointermove = null; };
    };
    node.ondblclick = () => {
      if (isNote) {
        const i = +node.dataset.note, t = prompt('ข้อความบนป้าย (ลบข้อความทั้งหมดเพื่อลบป้าย)', cfg.notes[i].text);
        if (t === null) return;
        if (t.trim()) cfg.notes[i].text = t.trim(); else cfg.notes.splice(i, 1);
      } else delete cfg.boxes[node.dataset.room];
      re();
    };
  });

  const $e = s => el.querySelector(s);
  $e('#fp-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast('กำลังเตรียมรูปแบบแปลน…');
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const dataUrl = isPdf ? await L.pdfToImage(f) : await compress(await fileToDataUrl(f), 1800);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
      cfg.image = await L.storeImage(floor, dataUrl); cfg.ratio = Math.round(img.width / img.height * 1000) / 1000;
      toast(isPdf ? 'ใช้หน้าแรกของ PDF เป็นพื้นหลังแล้ว' : 'ใส่รูปแบบแปลนแล้ว'); re();
    } catch (x) { toast('อ่านไฟล์ไม่ได้: ' + (x.message || x)); }
  };
  $e('#fp-auto').onclick = async () => {
    const ids = M.rooms().filter(r => r.floor === floor).map(r => r.id);
    if (Object.keys(cfg.boxes).length && !await confirmBox(`จัดเรียงทุก${UNIT}ของ${floorName(floor)}ใหม่เป็นตาราง? (ตำแหน่งที่วางไว้จะถูกแทนที่)`, 'จัดเรียงใหม่')) return;
    cfg.boxes = L.autoBoxes(ids, cfg.ratio || 1.6); re();
  };
  $e('#fp-note').onclick = () => { const t = prompt('ข้อความบนป้าย เช่น ทางเข้า / ลานจอด / สำนักงาน'); if (t?.trim()) { cfg.notes.push({ text: t.trim(), box: [42, 44, 16, 8] }); re(); } };
  $e('#fp-name').onclick = () => { const t = prompt(`ชื่อที่แสดงบนแท็บ (เว้นว่าง = "${FLOOR} ${floor}")`, cfg.name || ''); if (t !== null) { cfg.name = t.trim(); re(); } };
  $e('#fp-noimg').onclick = () => { cfg.image = ''; re(); };
  $e('#fp-exp').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ format: 'rea-pms-layout', updatedAt: new Date().toISOString(), floors: draft }, null, 2)], { type: 'application/json' }));
    a.download = 'layout.json'; a.click();
  };
  $e('#fp-imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()), fl = L.normalize(j);
      if (!Object.keys(fl).length) throw new Error('ไม่พบข้อมูลผังในไฟล์');
      draft = fl; toast('นำเข้าไฟล์ผังแล้ว — ตรวจดูแล้วกด "บันทึกผัง"'); re();
    } catch (x) { toast('ไฟล์ผังไม่ถูกต้อง: ' + x.message); }
  };
  $e('#fp-cancel').onclick = () => { draft = null; re(); };
  $e('#fp-save').onclick = async () => { await L.save(draft); draft = null; toast('บันทึกผังแล้ว'); re(); };
}

export default {
  id: 'floorplan', title: 'ผัง' + UNIT, icon: '🏢',
  render(el, nav, arg) {
    const all = M.rooms();
    if (arg?.room) { sel = arg.room; floor = db.get('rooms', arg.room)?.floor || floor; arg.room = null; }
    const floors = [...new Set([...all.map(r => r.floor), ...Object.keys(floorsCfg()).map(Number)])].filter(f => f >= 1 && (!acc.current().floors.length || acc.current().floors.includes(f))).sort((a, b) => a - b);   // ผู้ใช้ที่จำกัดชั้น/โซน เห็นเฉพาะแท็บของตัวเอง
    if (!floors.includes(floor)) floor = floors[0] ?? 1;
    const re = () => this.render(el, nav);
    const canEdit = auth.can('rooms.manage');
    const icons = [feature('fridge') && '🧊 ตู้เย็น', feature('parking') && '🏍️ มอไซค์ · 🚗 รถยนต์', '⚠️ ข้อมูลผู้เช่าไม่ครบ'].filter(Boolean).join(' · ');

    el.innerHTML = `
    <div class="top"><h2>ผัง${UNIT}</h2>
      <div class="seg">${floors.map(f => `<button data-f="${f}" class="${f === floor ? 'on' : ''}">${esc(floorName(f))}</button>`).join('')}</div>
      ${canEdit && !draft ? '<button class="btn" id="fp-edit">✏️ ปรับผัง</button>' : ''}</div>
    ${draft ? toolsHtml() : `<div class="legend"><span><i style="background:var(--ok-soft);border:1px solid var(--ok)"></i>ไม่มีค้าง</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>รอชำระ</span><span><i style="background:var(--bad-soft);border:1px solid var(--bad)"></i>ค้างชำระ</span><span><i style="background:var(--idle-soft);border:1px solid var(--idle)"></i>ว่าง / ส่วนกลาง</span><span>${icons}</span></div>`}
    <div class="${draft || WH ? '' : 'layout'}">${planHtml(all)}${draft || WH ? '' : `<div class="card detail">${detail(sel)}</div>`}</div>`;

    const cfg = floorCfg(floor);
    if (cfg?.image) L.imageSrc(cfg.image).then(src => { const i = el.querySelector('#fp-bg'); if (i && src) { i.src = src; i.hidden = false; } });
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { floor = +b.dataset.f; sel = null; re(); });
    el.querySelector('#fp-edit')?.addEventListener('click', () => { draft = JSON.parse(JSON.stringify(L.get().floors || {})); sel = null; re(); });
    if (draft) return bindEdit(el, re);

    bindHover(el);
    fitLabels(el);
    if (WH) {   // คลิกคลังว่าง → ฟอร์มสัญญาใหม่ · คลังที่มีผู้เช่า (หรือส่วนกลาง) → ป๊อปอัปรายละเอียด
      const open = id => {
        const r = db.get('rooms', id);
        if (!M.tenantOf(id) && r?.kind === 'room') return import('./contract.js').then(m => m.openContract({ room: id }, re));
        const box = openModal(`<div class="detail fp-pop"><button class="btn sm fp-x" data-a="x" title="ปิด">✕</button>${popupHtml(id)}</div>`, { wide: true });
        box.querySelector('[data-a="x"]').onclick = closeModal;
        wire(box, id, () => { closeModal(); re(); }, nav, true);
      };
      el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => open(b.dataset.room));
      if (sel) { const id = sel; sel = null; if (db.get('rooms', id)) open(id); }   // มาจากหน้าอื่นพร้อมรหัสคลัง
      return;
    }
    el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => { sel = b.dataset.room; re(); });
    wire(el, sel, re, nav);
  },
};

// ผูกปุ่มในแผงรายละเอียด/ป๊อปอัปของคลัง id (root = แผงด้านขวา หรือกล่องป๊อปอัป)
function wire(root, id, re, nav, inModal = false) {
  const go = (page, arg) => { if (inModal) closeModal(); nav.go(page, arg); };
  root.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => go('parking', { highlight: [b.dataset.slot] }));
  const t = id && M.tenantOf(id);
  if (t?.idPhoto) photoThumb(t.idPhoto).then(h => { const d = root.querySelector('#idthumb'); if (d) d.innerHTML = h; });
  const act = a => root.querySelector(`[data-a="${a}"]`);
  const then = fn => () => { if (inModal) closeModal(); fn(); };   // ฟอร์มอื่นใช้หน้าต่างเดียวกัน → ปิดป๊อปอัปก่อน
  act('bill')?.addEventListener('click', () => go('billing', { room: id }));
  act('edit')?.addEventListener('click', then(() => openTenantForm(t, re)));
  act('fill')?.addEventListener('click', e => { e.preventDefault(); then(() => openTenantForm(t, re))(); });
  act('in')?.addEventListener('click', then(() => import('./contract.js').then(m => m.openContract({ room: id }, re))));
  act('out')?.addEventListener('click', then(() => moveOut(t, re)));
  act('contract')?.addEventListener('click', then(() => import('./contract.js').then(m => m.openContract(t, re))));
  act('lastbill')?.addEventListener('click', then(() => {
    const lb = db.all('bills').filter(b => b.room === id).sort((a, b) => b.period.localeCompare(a.period))[0];
    ['paid', 'partial'].includes(M.billState(lb)) ? openPaymentDetail(lb, re) : openPayment(lb, re);
  }));
  act('undo')?.addEventListener('click', then(() => cancelMoveOut(M.pastTenantsOf(id)[0], re)));
  act('refund')?.addEventListener('click', () => printRefund(M.pastTenantsOf(id)[0]));
  root.querySelectorAll('[data-past]').forEach(tr => tr.onclick = then(() => openTenantHistory(db.get('tenants', tr.dataset.past), re)));
}
