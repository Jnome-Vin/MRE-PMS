// ค่าตั้งต้นของแอป — ข้อมูลเฉพาะโครงการอยู่ใน app/site.js (ตัวติดตั้งสร้างให้)
import { SITE } from '../../site.js';
export { SITE };

export const APP = {
  name: SITE.name,
  product: SITE.product || 'REA-PMS',
  version: '1.2.0',
  hashIterations: 5000,          // รอบ hash ของรหัสผ่านที่ตั้งใหม่ — ต้องตรงกับ HASH_ITER ใน backend/Auth.gs
  hashIterationsOld: 1000,       // บัญชีเดิมที่ยังไม่ได้เปลี่ยนรหัส
  maxFails: 5, lockMinutes: 15,  // ใส่รหัสผิดกี่ครั้งจึงล็อก / ล็อกกี่นาที — ต้องตรงกับ backend/Security.gs
  sessionHours: 12,
  minPasswordLength: 8,
};

// คีย์เก็บค่าในเบราว์เซอร์ แยกตามโครงการ (กันข้อมูลปนกันเมื่อมีหลายโครงการในเครื่องเดียว)
export const KEY = name => `${SITE.storageKey || 'reapms'}.${name}`;
export const feature = name => SITE.features?.[name] !== false;
// คำเรียกหน่วยเช่า เช่น ห้อง / โกดัง / คูหา
export const UNIT = SITE.unit || 'ห้อง';
export const FLOOR = SITE.floorWord || 'ชั้น';

// URL ของ Apps Script: ตัวติดตั้งใส่ไว้ใน site.js → เครื่องใหม่เชื่อมอัตโนมัติ (URL นี้เปิดเผยได้ — ทุกคำสั่งต้องเข้าสู่ระบบก่อน)
export const DEFAULT_API_URL = SITE.apiUrl || '';
const LOCAL_ONLY = '-';   // ผู้ใช้กด "ยกเลิกการเชื่อม" → ใช้โหมดเครื่องเดียว

export function getApiUrl() {
  try {
    const v = localStorage.getItem(KEY('apiUrl'));
    return v === LOCAL_ONLY ? '' : (v || DEFAULT_API_URL);
  } catch { return DEFAULT_API_URL; }
}
export function setApiUrl(url) {
  try { localStorage.setItem(KEY('apiUrl'), url ? url.trim() : LOCAL_ONLY); } catch {}
}
// โหมด local = ยังไม่เชื่อม Google (ข้อมูลอยู่ในเครื่องนี้เท่านั้น)
export const isServerMode = () => !!getApiUrl();
