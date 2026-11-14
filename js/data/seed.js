// โครงสร้างตั้งต้นของโครงการ สร้างจาก app/site.js (ไม่มีข้อมูลส่วนบุคคล — ไฟล์นี้เผยแพร่พร้อมแอป)
// ใช้เฉพาะตอนเปิดแอปครั้งแรกในเครื่องที่ยังไม่มีข้อมูล · ถ้าเชื่อม Google แล้ว ข้อมูลบน server ชนะเสมอ
import { SITE } from '../../site.js';

export const rooms = (SITE.floors || []).flatMap(f => (f.units || []).map(id =>
  ({ id: String(id), floor: Number(f.no) || 1, kind: 'room', label: '', type: SITE.unitType || '', rent: 0 })));

export const slots = (SITE.features?.parking === false ? [] : SITE.slots || [])
  .map(id => ({ id: String(id), zone: String(id).split('-')[0], room: '', plate: '', vehicle: '' }));

const R = SITE.rates || {};
export const settings = [
  { id: 'rates', water: R.water ?? 18, elec: R.elec ?? 8, dueDay: R.dueDay ?? 5, parkingFee: R.parkingFee ?? 0, fridgeFee: R.fridgeFee ?? 0,
    minOn: false, minWaterUnits: 1, minWaterAmount: R.water ?? 18, minElecUnits: 1, minElecAmount: R.elec ?? 8 },
  { id: 'property', name: SITE.name, nameEn: SITE.nameEn || SITE.name, address: '', addressEn: '', phone: '', taxId: '', promptpay: '', bankText: '',
    billNote: `กรุณาโอนเงินมาชำระภายในวันที่ ${R.dueDay ?? 5} ของเดือน`, billNoteEn: `PLEASE PAY YOUR BILL BY DAY ${R.dueDay ?? 5} OF THE MONTH`, showQr: true },
];
