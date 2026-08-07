/* Friendship Stock — Service Worker
 * ระดับ 1: เปิดแอปได้แม้เน็ตหลุด (offline app shell)
 *
 * กลยุทธ์ (สำคัญ — อ่านก่อนแก้):
 *  1) Supabase (ข้อมูลสด: สต๊อก/ราคา/สินค้า/บันทึก) = "ไม่แตะเลย" ปล่อยผ่าน network ปกติ
 *     → ห้าม cache เด็ดขาด ไม่งั้นพนักงานเห็นสต๊อก/ราคาเก่าค้าง = อันตราย
 *  2) หน้าแอป (เปิด/รีเฟรช) = "เน็ตมาก่อน" (network-first)
 *     → มีเน็ต = ได้เวอร์ชันล่าสุดเสมอ (Ball push แล้วพนักงานได้ของใหม่ทันที)
 *     → เน็ตหลุด = ใช้หน้าเดิมที่เก็บไว้ (เปิดแอปได้ ไม่ขาวจอ)
 *  3) Libraries + ฟอนต์ (CDN) = "ใช้ที่เก็บไว้ก่อน" (cache-first) + อัปเดตเบื้องหลัง
 *     → เร็ว + สแกนเนอร์/Excel ทำงานแม้ CDN ล่มหรือเน็ตหลุด
 *
 * อัปเดต SW: เปลี่ยนเลข CACHE (v1 → v2) เมื่อต้องล้างของเก่าทิ้งทั้งหมด
 */
const CACHE = 'fs-app-v1';

// ไฟล์หลักที่ต้องมีเพื่อให้แอปเปิดได้ตอนออฟไลน์ (โหลด synchronous ใน index.html)
const CORE = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // cache ทีละตัว — CDN ตัวใดล่ม ไม่ทำให้การติดตั้งล้มทั้งหมด
    await Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // ลบ cache เวอร์ชันเก่าทิ้ง (เหลือแค่ CACHE ปัจจุบัน)
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 1) Supabase = ข้อมูลสด ห้ามแตะ (ปล่อยผ่านไป network ตามปกติ)
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  // ข้าม request ที่ไม่ใช่ http/https (เช่น chrome-extension)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 2) หน้าแอป (เปิด/รีเฟรช) = เน็ตมาก่อน, หลุดค่อยใช้ที่เก็บไว้
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        // เก็บหน้าล่าสุดไว้เผื่อเน็ตหลุดครั้งหน้า
        c.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = (await c.match(req)) || (await c.match('./index.html')) || (await c.match('./'));
        return cached || Response.error();
      }
    })());
    return;
  }

  // 3) Libraries/ฟอนต์/asset อื่น = ใช้ที่เก็บไว้ก่อน + โหลดใหม่เบื้องหลัง (stale-while-revalidate)
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
