// สิทธิ์การมองเห็นของผู้ใช้ 1 คนใน 1 โครงการ ("access profile") — รูปแบบเดียวกันทั้งแอป, backend และศูนย์รวม login ในอนาคต
//   { role, hide: [รหัสเมนูที่ซ่อน], personal: เห็นข้อมูลส่วนบุคคลของผู้เช่าหรือไม่, floors: [ชั้น/โซนที่รับผิดชอบ] (ว่าง = ทุกชั้น) }
// ตอนนี้ profile มาจากบัญชีผู้ใช้ของโครงการ · เมื่อมีศูนย์รวม profile เดียวกันนี้จะมากับ "ตั๋ว" จากศูนย์รวม (ดู HUB-DESIGN.md)
// กติกาในไฟล์นี้ต้องตรงกับ backend/Store.gs (inScope_, stripPersonal_, keepPersonal_) — server เป็นผู้บังคับจริง แอปกรองซ้ำเพื่อให้หน้าจอตรงกัน
// ไฟล์นี้ไม่ import ไฟล์อื่น (db.js และ auth.js เป็นฝ่ายเรียกใช้)

export const ROLE_IDS = ['admin', 'manager', 'operator', 'viewer'];
// เมนูที่ซ่อนรายคนได้ (เมนูผู้ใช้งาน / ประวัติ / ตั้งค่า คุมด้วยระดับผู้ใช้อยู่แล้ว)
export const HIDEABLE = ['dashboard', 'floorplan', 'parking', 'billing', 'tenants', 'reports'];
// ข้อมูลส่วนบุคคลของผู้เช่า — ผู้ที่ไม่มีสิทธิ์จะไม่ได้รับค่าเหล่านี้เลย
export const PERSONAL_FIELDS = ['idNo', 'idPhoto', 'birthDate', 'address'];
const FULL = Object.freeze({ role: 'admin', hide: [], personal: true, floors: [] });

export function normalize(a) {
  const role = ROLE_IDS.includes(a?.role) ? a.role : 'operator';
  if (role === 'admin') return { ...FULL, hide: [], floors: [] };   // Administrator เห็นทุกอย่างเสมอ
  const list = v => (Array.isArray(v) ? v : []);
  return { role, hide: list(a.hide).map(String).filter(x => HIDEABLE.includes(x)), personal: a.personal !== false,
    floors: [...new Set(list(a.floors).map(Number).filter(n => n >= 1))].sort((x, y) => x - y) };
}

let cur = FULL;
export const set = a => { cur = a ? normalize(a) : FULL; };
export const current = () => cur;
export const isViewer = () => cur.role === 'viewer';
export const dataRestricted = () => !cur.personal || cur.floors.length > 0;
// ลายเซ็นของ "ข้อมูลที่เครื่องนี้ได้รับ" — ถ้าเปลี่ยน ต้องล้างข้อมูลในเครื่องแล้วดึงใหม่ (ดู auth.js)
export const cacheSig = (a = cur) => (a.personal && !a.floors.length ? 'full' : JSON.stringify([a.personal, a.floors]));

// อยู่ในชั้น/โซนที่รับผิดชอบหรือไม่ · floorOf(roomId) = เลขชั้นของหน่วยเช่า (null = ไม่พบ)
export function inScope(col, rec, floorOf) {
  if (!cur.floors.length || col === 'settings') return true;
  if (col === 'rooms') return cur.floors.includes(Number(rec.floor));
  if (col === 'slots' && !rec.room) return true;                     // ช่องจอดว่าง เห็นได้ทุกคน
  const f = floorOf(rec.room);
  return f != null && cur.floors.includes(Number(f));
}

const occName = o => (typeof o === 'string' ? o : o?.name || '');
export function strip(col, rec) {
  if (cur.personal || col !== 'tenants') return rec;
  const o = { ...rec };
  for (const k of PERSONAL_FIELDS) delete o[k];
  if (Array.isArray(o.occupants)) o.occupants = o.occupants.map(occName);
  return o;
}
// ผู้ที่ไม่เห็นข้อมูลส่วนบุคคลบันทึกผู้เช่า → คงค่าที่ซ่อนไว้ตามเดิม (ไม่ให้หายเพราะหน้าจอไม่มีค่านั้น)
export function keepPersonal(col, rec, raw) {
  if (cur.personal || col !== 'tenants') return rec;
  const o = { ...rec };
  for (const k of PERSONAL_FIELDS) { if (raw && raw[k] !== undefined) o[k] = raw[k]; else delete o[k]; }
  if (Array.isArray(o.occupants)) {
    const old = Array.isArray(raw?.occupants) ? raw.occupants : [];
    o.occupants = o.occupants.map(x => old.find(y => typeof y === 'object' && y && y.name === occName(x)) || occName(x));
  }
  return o;
}
// เหตุผลที่บันทึกไม่ได้ ('' = บันทึกได้)
export function writeProblem(col, rec, raw, floorOf) {
  if (cur.role === 'viewer') return 'บัญชีนี้เป็นแบบดูอย่างเดียว (Viewer) แก้ไขข้อมูลไม่ได้';
  if ((raw && !inScope(col, raw, floorOf)) || !inScope(col, rec, floorOf)) return 'ข้อมูลนี้อยู่นอกชั้น/โซนที่คุณรับผิดชอบ';
  return '';
}
