import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
// Use the package's bundled Linux shared libraries in minimal CI containers.
if (process.platform === 'linux' && !process.env.CHROMIUM_PATH) process.env.AWS_EXECUTION_ENV ??= 'AWS_Lambda_nodejs22.x';
const { default: bundledChromium } = await import('@sparticuz/chromium');
await mkdir('.check', { recursive: true });
import * as XLSX from 'xlsx';

const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || await bundledChromium.executablePath(), args: bundledChromium.args.filter((arg) => !['--disable-web-security', '--allow-running-insecure-content', '--single-process'].includes(arg)), headless: true });
let checks = 0;
const pass = (label) => { checks++; console.log('PASS ', label); };
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce', geolocation: { latitude: 35.8, longitude: 51.5 }, permissions: ['geolocation'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dataset = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(dataset, XLSX.utils.aoa_to_sheet([
  ['نام مرکز', 'استان', 'شهر', 'آدرس', 'تلفن', 'latitude', 'longitude'],
  ['مرکز تست مسیریابی', 'تهران', 'تهران', 'خیابان آزمایشی', '02112345678', 35.7, 51.4],
  ['مرکز بدون مختصات', '', '', 'بزرگراه کردستان، خیابان ۶۴ غربی', '88776655', '', ''],
]), 'مراکز');
const fixture = { name: 'centers.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(dataset, { type: 'buffer', bookType: 'xlsx' }) };
const faNumber = (text) => Number(String(text).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[,٬]/g, ''));
const openImport = async () => { await page.getByRole('button', { name: /بارگذاری اکسل|بارگذاری فایل/ }).first().click(); };
try {
  await page.goto(base);
  await page.locator('article').first().waitFor();
  assert.equal(await page.locator('article').count(), 24); pass('desktop boots with 24 demo cards');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); pass('desktop has no horizontal overflow');
  const total = faNumber((await page.locator('body').innerText()).match(/([۰-۹٬,]+)\s*مرکز یافت شد/)?.[1] ?? '0');
  assert.ok(total > 100, `demo total ${total}`);
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.locator('article').count(), total);
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await page.waitForFunction(() => document.querySelectorAll('article').length === 24); pass('print includes all filtered rows and restores pagination');
  await page.getByRole('button', { name: 'جدول', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
  const printLayout = await page.evaluate(() => {
    const hero = document.querySelector('section.bg-ink-900');
    const grid = document.querySelector('div[style*="scroll-margin-top"]');
    const main = document.querySelector('main');
    return {
      heroHidden: !hero || getComputedStyle(hero).display === 'none',
      sectionWidth: Math.round(grid?.querySelector('section')?.getBoundingClientRect().width ?? 0),
      mainWidth: Math.round(main?.getBoundingClientRect().width ?? 0),
    };
  });
  assert.equal(printLayout.heroHidden, true);
  assert.ok(printLayout.sectionWidth > printLayout.mainWidth * 0.8, `section ${printLayout.sectionWidth} of main ${printLayout.mainWidth}`);
  pass('print hides the hero and gives results the full page width');
  const printTable = await page.evaluate(() => {
    const wrap = document.querySelector('table')?.parentElement;
    return { overflow: getComputedStyle(wrap).overflowX, minWidth: getComputedStyle(document.querySelector('table')).minWidth };
  });
  assert.equal(printTable.overflow, 'visible');
  assert.ok(printTable.minWidth === '0px' || printTable.minWidth === 'auto');
  pass('print table is not clipped by the horizontal scroller');
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'کارت', exact: true }).click();
  await page.locator('article').first().getByRole('button', { name: 'مسیریابی', exact: true }).click();
  let dialog = page.getByRole('dialog');
  const demoHref = await dialog.locator('a[href*="nshn.ir"]').first().getAttribute('href');
  assert.match(demoHref ?? '', /^https:\/\/nshn\.ir\/\?lat=3\d\.\d+&lng=5\d\.\d+$/);
  assert.match(await dialog.innerText(), /تقریبی/);
  assert.equal(await dialog.locator('a[href^="neshan://"]').getAttribute('target'), '_blank');
  pass('demo centers ship approximate city coordinates wired into documented Neshan links');
  await dialog.locator('summary').click();
  await dialog.getByRole('textbox', { name: 'عرض جغرافیایی', exact: true }).fill('۹۵');
  await dialog.getByRole('textbox', { name: 'طول جغرافیایی', exact: true }).fill('۵۱');
  await dialog.getByRole('button', { name: 'تأیید مختصات مقصد' }).click();
  await dialog.getByRole('alert').waitFor(); pass('invalid manual coordinates show validation error');
  await dialog.getByRole('textbox', { name: 'عرض جغرافیایی', exact: true }).fill('۳۵٫۷');
  await dialog.getByRole('textbox', { name: 'طول جغرافیایی', exact: true }).fill('۵۱٫۴');
  await dialog.getByRole('button', { name: 'تأیید مختصات مقصد' }).click();
  assert.equal(await dialog.locator('a[href*="nshn.ir"]').getAttribute('href'), 'https://nshn.ir/?lat=35.7&lng=51.4'); pass('manual Persian coordinates create documented destination link');
  await dialog.getByRole('button', { name: 'استفاده از موقعیت من برای مبدأ نشان' }).click();
  await dialog.getByRole('link', { name: 'مسیریابی با نشان از موقعیت من' }).waitFor();
  assert.equal(await dialog.locator('a[href*="nshn.ir"]').getAttribute('href'), 'https://nshn.ir/?origin=35.8,51.5&destination=35.7,51.4&vehicle=d'); pass('permission-based location becomes route origin');
  await dialog.locator('#routing-vehicle').selectOption('m');
  assert.match(await dialog.locator('a[href*="nshn.ir"]').first().getAttribute('href') ?? '', /&vehicle=m$/);
  await dialog.locator('#routing-vehicle').selectOption('d');
  const googleHref = await dialog.locator('a[href*="google.com/maps/dir"]').getAttribute('href');
  assert.ok(googleHref && decodeURIComponent(googleHref).includes('origin=35.8,51.5'));
  assert.match(await dialog.innerText(), /فاصلهٔ مبدأ تا مقصد حدوداً/);
  pass('vehicle switch and Google directions reuse the same GPS origin');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0); pass('route modal Escape closes');

  await openImport();
  await page.locator('input[type=file]').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll('article').length === 2);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('article').count(), 2); pass('XLSX upload imports real rows');
  const second = page.locator('article').nth(1);
  assert.ok(await second.locator('a[href="tel:02188776655"]').count() > 0);
  assert.equal((await second.locator('p b.font-semibold').first().innerText()).trim(), 'تهران —');
  pass('«بزرگراه کردستان» stays a street: province Tehran, phone gains 021');
  await page.reload();
  await page.locator('article').first().waitFor();
  assert.equal(await page.locator('article').count(), 2); pass('IndexedDB data survives reload');
  await page.locator('article').first().getByRole('button', { name: 'مسیریابی', exact: true }).click();
  dialog = page.getByRole('dialog');
  assert.equal(await dialog.locator('a[href*="nshn.ir"]').getAttribute('href'), 'https://nshn.ir/?lat=35.7&lng=51.4'); pass('imported coordinates survive storage and reach routing UI');
  await context.clearPermissions();
  await dialog.getByRole('button', { name: 'استفاده از موقعیت من برای مبدأ نشان' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(), /دسترسی/); pass('GPS denial preserves destination fallback');
  await page.keyboard.press('Escape');

  await page.locator('article').nth(1).getByRole('button', { name: 'مسیریابی', exact: true }).click();
  dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /این مرکز مختصات ندارد/);
  assert.equal(await dialog.locator('a[href*="nshn.ir"]').count(), 0);
  assert.match(await dialog.innerText(), /تبدیل آدرس به مختصات/);
  const osmCalls = [];
  await page.route('**nominatim.openstreetmap.org/**', (route) => {
    osmCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([
      { lat: '35.31', lon: '47.0', display_name: 'بلوار کردستان، سنندج، استان کردستان', address: { city: 'سنندج', state: 'استان کردستان' } },
      { lat: '35.745', lon: '51.4', display_name: 'بزرگراه کردستان، تهران، استان تهران', address: { city: 'تهران', state: 'استان تهران' } },
    ]) });
  });
  await dialog.getByRole('button', { name: /جستجو با نقشهٔ آزاد OSM/ }).click();
  await dialog.getByRole('button', { name: 'تأیید و استفاده از این نقطه' }).waitFor();
  assert.match(await dialog.innerText(), /بیرون از محدودهٔ استان تهران/);
  assert.equal(await dialog.getByRole('button', { name: 'تأیید و استفاده از این نقطه' }).count(), 1);
  assert.equal(new URL(osmCalls[0]).searchParams.get('bounded'), '1');
  await dialog.getByRole('button', { name: 'تأیید و استفاده از این نقطه' }).click();
  assert.equal(await dialog.locator('a[href*="nshn.ir"]').first().getAttribute('href'), 'https://nshn.ir/?lat=35.745&lng=51.4');
  assert.match(await dialog.innerText(), /تأییدشده از جستجوی آدرس/);
  pass('unlocated center gains a confirmed point only through the vetted, Tehran-bounded candidate flow');
  await page.keyboard.press('Escape');

  await openImport();
  dialog = page.getByRole('dialog');
  const url = dialog.getByRole('textbox', { name: 'یا دریافت آنلاین از آدرس صفحه / فایل' });
  await url.fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'دریافت', exact: true }).click();
  await dialog.getByRole('status').waitFor();
  assert.match(await dialog.getByRole('status').innerText(), /فقط آدرس/);
  assert.equal(await dialog.getByRole('button', { name: 'دریافت', exact: true }).isEnabled(), true); pass('invalid remote URL recovers busy state');
  await page.route('https://example.com/bad.xlsx', (route) => route.fulfill({ status: 200, body: Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(400)]), headers: { 'access-control-allow-origin': '*' } }));
  await url.fill('https://example.com/bad.xlsx');
  await dialog.getByRole('button', { name: 'دریافت', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'خطا در دریافت فایل' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'دریافت', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('article').count(), 2); pass('corrupt remote workbook does not erase data or lock import');

  // دریافت آنلاین باید قابل لغو باشد و پاسخ دیررس نباید داده را عوض کند
  await page.route('https://example.com/slow.xlsx', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ status: 200, body: Buffer.from(XLSX.write(dataset, { type: 'buffer', bookType: 'xlsx' })), headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  });
  await url.fill('https://example.com/slow.xlsx');
  await dialog.getByRole('button', { name: 'دریافت', exact: true }).click();
  await dialog.getByRole('button', { name: 'لغو دریافت' }).waitFor();
  await dialog.getByRole('button', { name: 'لغو دریافت' }).click();
  await dialog.getByRole('status').filter({ hasText: 'لغو شد' }).waitFor();
  await page.waitForTimeout(3200);
  assert.equal(await page.locator('article').count(), 2);
  assert.equal(await dialog.getByRole('button', { name: 'دریافت', exact: true }).isEnabled(), true);
  pass('cancelling a slow remote import restores the dialog and never swaps the data');
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not an excel file') });
  await dialog.getByRole('status').filter({ hasText: 'فرمت فایل' }).waitFor();
  assert.equal(await page.locator('article').count(), 2); pass('unsupported upload rejected without losing data');
  // A re-render must not reset focus to the dialog.
  await url.focus();
  await url.fill('https://example.com/next.xlsx');
  assert.equal(await url.evaluate((el) => el === document.activeElement), true); pass('typing does not reset dialog focus');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'جدول', exact: true }).click();
  await page.getByRole('button', { name: 'انتخاب مسیریاب', exact: true }).first().click();
  assert.equal(await page.getByRole('dialog').count(), 1); pass('table opens same routing chooser');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'کارت', exact: true }).click();
  await page.locator('article').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); pass('mobile RTL layout has no overflow');
  await page.locator('article').first().getByRole('button', { name: 'مسیریابی', exact: true }).click();
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), true); pass('mobile sheet locks scroll and traps keyboard focus');
  await page.screenshot({ path: '.check/mobile-routing.png', fullPage: false });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'مسیریابی'); pass('close restores trigger focus and body scroll');
  await page.getByRole('button', { name: /فیلتر/, exact: false }).first().click();
  await page.getByRole('dialog', { name: 'فیلتر پیشرفته' }).waitFor();
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await page.keyboard.press('Escape'); pass('mobile filters use accessible modal and scroll lock');
  // نام دسترس‌پذیر دکمهٔ علاقه‌مندی‌ها باید مستقل از شمارنده باشد (در موبایل برچسب متنی پنهان است)
  assert.equal(await page.getByRole('button', { name: 'نمایش فقط علاقه‌مندی‌ها', exact: true }).count(), 1);
  assert.equal(await page.locator('[role=status][aria-live=polite]').count() >= 1, true);
  pass('favourites toggle and result counter expose accessible names and a live region');

  // «حذف داده» نباید به بن‌بست «فایلی بارگذاری نشد» برسد: بازگشت خودکار به فایل همراه/نمونه
  await page.locator('header').getByRole('button', { name: 'فایل', exact: true }).click();
  const importDialog = page.getByRole('dialog');
  await importDialog.getByRole('button', { name: /حذف دادهٔ ذخیره‌شده/ }).click();
  await importDialog.getByRole('button', { name: 'بله، حذف شود' }).click();
  await page.waitForFunction(() => document.querySelectorAll('article').length === 24);
  assert.match(await page.locator('body').innerText(), /نمونهٔ نمایشی/);
  assert.equal(await page.getByText('فایل اطلاعات مراکز بارگذاری نشد').count(), 0);
  pass('deleting stored data falls back to the bundled/demo dataset without a dead end');
  assert.deepEqual(errors, []); pass('no uncaught browser errors');
  const isolated = await browser.newContext();
  const corruptPage = await isolated.newPage();
  await corruptPage.addInitScript(() => localStorage.setItem('sepah-recent', '[{"invalid":true}]'));
  await corruptPage.route('**/data/centers.xlsx', (route) => route.fulfill({ body: Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(400)]) }));
  await corruptPage.goto(base);
  await corruptPage.locator('article').first().waitFor();
  assert.equal(await corruptPage.locator('article').count(), 24); pass('corrupt bundled workbook and malformed recent searches fall back without crashing');
  await isolated.close();

  // دادهٔ ذخیره‌شده توسط نسخهٔ قبلی (استان از نام بزرگراه/خیابان) باید هنگام ورود اصلاح شود
  const legacyContext = await browser.newContext();
  const legacyPage = await legacyContext.newPage();
  legacyPage.on('pageerror', (error) => errors.push(error.message));
  await legacyPage.goto(base);
  await legacyPage.locator('article').first().waitFor();
  const legacyCenter = (id, name, province, address, phone, tel) => ({
    id, name, category: 'مراکز', sheet: 'مراکز', province, city: '', address, phones: [{ label: phone, tel }],
    kind: '', service: '', discount: '', desc: '', extra: {}, search: `${name} ${province} ${address} ${tel}`,
    nameN: name, locN: province, catN: 'مراکز',
  });
  await legacyPage.evaluate((legacy) => new Promise((resolve, reject) => {
    const request = indexedDB.open('sepah-insurance-centers', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv'); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(legacy, 'dataset');
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), {
    centers: [
      legacyCenter(0, 'بیمارستان قدیمی الف', 'کردستان', 'بزرگراه کردستان، خیابان ۶۴', '88776655', '88776655'),
      legacyCenter(1, 'آزمایشگاه قدیمی ب', 'قزوین', 'خیابان قزوین، پلاک ۲', '021-66927008-10', '0216692700810'),
    ],
    report: [{ sheet: 'مراکز', category: 'مراکز', rows: 2, imported: 2, headerRow: 0, notes: [], mapping: [], skipped: [] }],
    meta: { fileName: 'old.xlsx', source: 'upload', loadedAt: 1, size: 10 },
  });
  await legacyPage.reload();
  await legacyPage.waitForFunction(() => document.querySelectorAll('article').length === 2);
  await legacyPage.getByText(/دادهٔ ذخیره‌شده به‌روز شد: استان ۲ مرکز به «تهران» اصلاح شد/).waitFor();
  assert.ok(await legacyPage.locator('a[href="tel:02188776655"]').count() > 0);
  assert.ok(await legacyPage.locator('a[href="tel:02166927008"]').count() > 0);
  assert.match(await legacyPage.locator('body').innerText(), /استان تهران/);
  await legacyPage.locator('article').first().click();
  const legacyDetail = await legacyPage.getByRole('dialog').innerText();
  assert.match(legacyDetail, /استان\s*تهران/);
  assert.doesNotMatch(legacyDetail, /استان\s*(کردستان|قزوین)/);
  await legacyPage.keyboard.press('Escape');
  const storedSchema = await legacyPage.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('sepah-insurance-centers', 1);
    request.onsuccess = () => {
      const get = request.result.transaction('kv').objectStore('kv').get('dataset');
      get.onsuccess = () => { resolve([get.result?.meta?.schema, get.result?.centers?.map((c) => c.province)]); request.result.close(); };
    };
  }));
  assert.deepEqual(storedSchema, [2, ['تهران', 'تهران']]);
  pass('previous-version data with street-derived provinces is repaired on load and re-saved');
  await legacyContext.close();

  // دادهٔ ذخیره‌شده‌ای که هیچ مرکز سالمی ندارد نباید بی‌صدا به دادهٔ نمونه تبدیل شود
  const brokenContext = await browser.newContext();
  const brokenPage = await brokenContext.newPage();
  await brokenPage.goto(base);
  await brokenPage.locator('article').first().waitFor();
  await brokenPage.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('sepah-insurance-centers', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv'); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ centers: [{ id: 0 }, { id: 0 }], report: [], meta: { fileName: 'x.xlsx', source: 'upload', loadedAt: 1, size: 1 } }, 'dataset');
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await brokenPage.reload();
  await brokenPage.locator('article').first().waitFor();
  await brokenPage.getByText(/قابل خواندن نبود|پاک نشد/).first().waitFor();
  const preserved = await brokenPage.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('sepah-insurance-centers', 1);
    request.onsuccess = () => {
      const get = request.result.transaction('kv').objectStore('kv').get('dataset');
      get.onsuccess = () => { resolve(get.result?.centers?.length ?? 0); request.result.close(); };
    };
  }));
  assert.equal(preserved, 2);
  pass('an unreadable stored dataset is reported and preserved, not silently replaced');
  await brokenContext.close();
  assert.deepEqual(errors, []);
  console.log(`\n${checks} browser checks passed (${base})`);
} finally { await browser.close(); }
