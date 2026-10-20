/**
 * اجرای واقعی App در jsdom: افکت‌ها (boot، IntersectionObserver،
 * ResizeObserver) واقعاً اجرا می‌شوند و رابط کاربریِ «بعد از بارگذاری
 * داده» رندر می‌شود؛ سپس چند تعامل کاربر بررسی می‌شود.
 */
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { demoCenters } from '../src/lib/demo';
import { toFa } from '../src/lib/text';

const dom = new JSDOM('<!doctype html><html lang="fa" dir="rtl"><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const g = globalThis as any;
// در Node 22 این‌ها فقط getter دارند
const define = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('localStorage', dom.window.localStorage);

g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = dom.window.requestAnimationFrame;
g.cancelAnimationFrame = dom.window.cancelAnimationFrame;

g.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom این‌ها را ندارد
g.ResizeObserver = class {
  cb: any;
  constructor(cb: any) { this.cb = cb; }
  observe(el: any) { this.cb([{ target: el, contentRect: { height: 68 } }]); }
  unobserve() {}
  disconnect() {}
};
g.IntersectionObserver = class {
  cb: any;
  constructor(cb: any) { this.cb = cb; }
  observe(el: any) { this.cb([{ isIntersecting: true, target: el }]); }
  unobserve() {}
  disconnect() {}
};
dom.window.ResizeObserver = g.ResizeObserver;
dom.window.IntersectionObserver = g.IntersectionObserver;
// ارتفاع هدر در jsdom صفر است؛ برای محاسبهٔ sticky یک عدد بدهید
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { get: () => 68, configurable: true });

const must = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { default: App } = await import('../src/App');

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  await act(async () => { root.render(createElement(App)); });
  // اجازه بده جریان boot (localStorage → فایل محلی → دادهٔ نمونه) تمام شود
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

  const html = () => dom.window.document.body.innerHTML;
  const text = () => dom.window.document.body.textContent || '';
  const count = (sel: string) => dom.window.document.querySelectorAll(sel).length;

  console.log('--- رندر با داده ---');
  must('اسپینر بارگذاری رفت', !html().includes('animate-spin'));
  must('بنر نمونه (Demo) نمایش داده می‌شود', text().includes('نمونهٔ نمایشی'));
  must('کارت‌های مرکز رندر شدند: ' + count('article'), count('article') === 24);
  must('کاشی دسته‌بندی ساخته شد: ' + count('section button'), count('section button') > 5);
  must('دامنهٔ «استان تهران» در بنر و سربرگ هست', text().includes('استان تهران'));
  must('کاشی‌های آمار: شهر و «دارای تلفن» (به‌جای شمارش بی‌معنای یک استان)', text().includes('دارای تلفن') && !/[۰-۹]+استان(?!\s)/.test(text()));
  must('کارت محل تکراری «تهران، تهران» ندارد', !text().includes('تهران، تهران'));
  must('موج انتهای بنر رندر شده', count('svg[viewBox="0 0 1440 120"]') === 1);
  must('نوار جستجوی چسبان وجود دارد', count('[role="search"]') === 2);
  must('نتایج: «مرکز یافت شد» در صفحه است', text().includes('مرکز یافت شد'));

  // ----- تعامل ۱: تایپ در کادر جستجو -----
  const input = dom.window.document.querySelectorAll<HTMLInputElement>('input[role="search"], form[role="search"] input')[0];
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, 'بیمارستان پاسداران');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  must('جستجو نتایج را فیلتر کرد: ' + count('article'), count('article') < 24 && count('article') >= 1);
  must('چیپ عبارت جستجو ظاهر شد', text().includes('«بیمارستان پاسداران»'));
  must('هایلایت نتایج ساخته شد: ' + count('mark'), count('mark') > 0);

  // ----- تعامل ۲: پاک کردن جستجو با دکمهٔ ضربدر -----
  const clearBtn = Array.from(dom.window.document.querySelectorAll('button[aria-label="پاک کردن جستجو"]'))[0] as HTMLButtonElement;
  await act(async () => { clearBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  must('پاک کردن جستجو نتایج را برگرداند: ' + count('article'), count('article') === 24);

  // ----- تعامل ۳: انتخاب یک دسته -----
  const catBtn = Array.from(dom.window.document.querySelectorAll('section button')).find((b) =>
    (b.textContent || '').includes('داروخانه'),
  ) as HTMLButtonElement;
  await act(async () => { catBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  const counter = dom.window.document.querySelector('section b.tabular-nums, section b.text-lg') as HTMLElement;
  const pharmacies = toFa(demoCenters().filter((c) => c.category === 'داروخانه').length);
  must(`شمارندهٔ نتایج بعد از فیلتر دستهٔ داروخانه = ${pharmacies}: ` + counter?.textContent, counter?.textContent === pharmacies);
  must('چیپ فیلتر فعال نشان داده شد: ' + count('button.rounded-full.bg-ink-100'), count('button.rounded-full.bg-ink-100') === 1);
  must('فیلتر دسته اعمال شد و کارت‌ها رندر شدند: ' + count('article'), count('article') === 24);

  // ----- تعامل ۴: باز کردن جزئیات یک کارت -----
  const firstCard = dom.window.document.querySelector('article') as HTMLElement;
  await act(async () => { firstCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  must('مودال جزئیات باز شد', count('[role="dialog"][aria-modal="true"]') === 1);
  must('بدنه با اسکرول قفل شد', dom.window.document.body.style.overflow === 'hidden');

  // ----- تعامل ۵: بستن با Escape -----
  await act(async () => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  must('مودال با Escape بسته شد', count('[role="dialog"][aria-modal="true"]') === 0);
  must('قفل اسکرول برداشته شد', dom.window.document.body.style.overflow !== 'hidden');

  // ----- تعامل ۵.۵: پنجرهٔ مسیریابی، مختصات تقریبی و اصلاح جابه‌جایی -----
  const routeBtn = Array.from(dom.window.document.querySelectorAll('article button'))
    .find((b) => (b.textContent || '').trim() === 'مسیریابی') as HTMLButtonElement;
  await act(async () => { routeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const dlg = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
  must('مودال مسیریابی باز شد', !!dlg);
  must('برای مرکز نمونه لینک نشان ساخته می‌شود (مختصات تقریبی شهر)', /href="https:\/\/nshn\.ir\/\?lat=3/.test(dlg.innerHTML));
  must('متن توضیح دادهٔ نمونه به تقریبی‌بودن مختصات اشاره می‌کند', (dlg.textContent || '').includes('تقریبی'));
  const iosLinks = Array.from(dlg.querySelectorAll('a[href^="neshan://"]'));
  must('لینک iOS (neshan://) هست و در سربرگ جدید باز می‌شود', iosLinks.length > 0 && iosLinks.every((a) => a.getAttribute('target') === '_blank'));
  must('دکمهٔ کپی لینک نشان برای ارسال به گوشی هست', (dlg.textContent || '').includes('کپی لینک نشان'));
  const detailsEl = dlg.querySelector('details') as HTMLDetailsElement;
  await act(async () => { detailsEl.open = true; }); // jsdom روی کلیک summary همیشه toggle نمی‌کند
  const latInput = dlg.querySelector('input[aria-label="عرض جغرافیایی"]') as HTMLInputElement;
  const lngInput = dlg.querySelector('input[aria-label="طول جغرافیایی"]') as HTMLInputElement;
  await act(async () => {
    setter.call(latInput, '۵۱');
    latInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    setter.call(lngInput, '۳۵');
    lngInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    (dlg.querySelector('form button') as HTMLButtonElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  must('هشدار جابه‌جایی عرض/طول نمایش داده می‌شود', (dlg.textContent || '').includes('جابه‌جا'));
  const fixBtn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').includes('اصلاح پیشنهادی')) as HTMLButtonElement;
  await act(async () => { fixBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const nshnAnchor = dlg.querySelector('a[href*="nshn.ir"]') as HTMLAnchorElement;
  must('پس از اصلاح، لینک نشان به نقطهٔ درست‌شده اشاره می‌کند', /lat=35&lng=51$/.test(nshnAnchor.getAttribute('href') || ''));
  const gpsBtn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').includes('موقعیت من')) as HTMLButtonElement;
  await act(async () => { gpsBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  must('عدم GPS در محیط تست پیام راهنما می‌گیرد', (dlg.textContent || '').includes('مکان‌یابی در این مرورگر در دسترس نیست'));
  await act(async () => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  must('پنجرهٔ مسیریابی با Escape بسته شد', count('[role="dialog"][aria-modal="true"]') === 0);

  // ----- تعامل ۶: تغییر حالت نمایش به جدول -----
  const tableBtn = dom.window.document.querySelector('button[title="جدول"]') as HTMLButtonElement;
  await act(async () => { tableBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  must('نمای جدول رندر شد', count('table') === 1 && count('table tbody tr') > 0);

  // ----- تعامل ۷: علاقه‌مندی -----
  const starBtn = dom.window.document.querySelector('button[aria-label="افزودن به علاقه‌مندی‌ها"]') as HTMLButtonElement;
  await act(async () => { starBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  // علاقه‌مندی‌ها اکنون به مجموعهٔ داده (منبع+نام فایل) محدود و نسخه‌دار ذخیره می‌شوند
  const favStore = JSON.parse(dom.window.localStorage.getItem('sepah-favs-v2') || 'null');
  const favLists = favStore && typeof favStore === 'object' ? Object.entries(favStore) : [];
  must(
    'علاقه‌مندی در کلید نسخه‌دار و برای همین مجموعه ذخیره شد: ' + favLists.map(([k, v]) => `${k}=${(v as string[]).length}`).join(', '),
    favStore !== null && favLists.length === 1 && (favLists[0][0] as string).startsWith('demo:')
      && (favLists[0][1] as string[]).length === 1,
  );

  await act(async () => { root.unmount(); });
  must('unmount بدون خطا', true);
}

main().catch((e) => {
  console.error('FAIL  خطای زمان اجرا:\n', e);
  process.exitCode = 1;
});
