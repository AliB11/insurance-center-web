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
  ['مرکز بدون مختصات', 'فارس', 'شیراز', 'خیابان زند', '07112345678', '', ''],
]), 'مراکز');
const fixture = { name: 'centers.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(dataset, { type: 'buffer', bookType: 'xlsx' }) };
const openImport = async () => { await page.getByRole('button', { name: /بارگذاری اکسل|بارگذاری فایل/ }).first().click(); };
try {
  await page.goto(base);
  await page.locator('article').first().waitFor();
  assert.equal(await page.locator('article').count(), 24); pass('desktop boots with 24 demo cards');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); pass('desktop has no horizontal overflow');
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.locator('article').count(), 177);
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await page.waitForFunction(() => document.querySelectorAll('article').length === 24); pass('print includes all filtered rows and restores pagination');
  await page.locator('article').first().getByRole('button', { name: 'مسیریابی', exact: true }).click();
  let dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /مختصات ندارد/);
  assert.equal(await dialog.locator('a[href*="nshn.ir"]').count(), 0); pass('no fabricated Neshan link for unlocated demo center');
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
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0); pass('route modal Escape closes');

  await openImport();
  await page.locator('input[type=file]').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll('article').length === 2);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('article').count(), 2); pass('XLSX upload imports real rows');
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
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('خطا در دریافت فایل'));
  assert.equal(await dialog.getByRole('button', { name: 'دریافت', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('article').count(), 2); pass('corrupt remote workbook does not erase data or lock import');
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not an excel file') });
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('فرمت فایل'));
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
  assert.deepEqual(errors, []); pass('no uncaught browser errors');
  const isolated = await browser.newContext();
  const corruptPage = await isolated.newPage();
  await corruptPage.addInitScript(() => localStorage.setItem('sepah-recent', '[{"invalid":true}]'));
  await corruptPage.route('**/data/centers.xlsx', (route) => route.fulfill({ body: Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(400)]) }));
  await corruptPage.goto(base);
  await corruptPage.locator('article').first().waitFor();
  assert.equal(await corruptPage.locator('article').count(), 24); pass('corrupt bundled workbook and malformed recent searches fall back without crashing');
  await isolated.close();
  console.log(`\n${checks} browser checks passed (${base})`);
} finally { await browser.close(); }
