import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/lib/parser';
import { parseCoordinates, neshanUrl, googleUrl, wazeUrl, validCoordinates } from '../src/lib/routing';
import { validStoredData, loadList } from '../src/lib/storage';
import { tryRemote, tryLocal, remoteUrl } from '../src/lib/loader';
import { parsePhones } from '../src/lib/text';
import { applyFilters, EMPTY_FILTERS } from '../src/lib/search';

let count = 0;
const check = (name: string, action: () => void) => { action(); count++; console.log('PASS ', name); };
function workbook(rows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'مراکز');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
const bytes = workbook([
  ['نام مرکز', 'استان', 'شهر', 'آدرس', 'تلفن', 'latitude', 'longitude', 'دسته', 'نوع مرکز'],
  ['بیمارستان الف', 'تهران', 'تهران', 'خیابان آزادی', '+98 21 12345678', '۳۵٫۷', '۵۱٫۴', 'درمانی', 'بیمارستان'],
  ['داروخانه ب', 'فارس', '', 'خیابان زند', '', '100', '51', 'داروخانه', ''],
]);
const parsed = parseWorkbook(bytes);
check('UTF-8 Persian CSV without BOM remains readable', () => {
  const csv = new TextEncoder().encode('نام,استان,شهر,آدرس\nمرکز امید,تهران,تهران,خیابان آزادی');
  const result = parseWorkbook(csv.buffer);
  assert.equal(result.centers.length, 1);
  assert.equal(result.centers[0].name, 'مرکز امید');
  assert.equal(result.centers[0].province, 'تهران');
});
check('rows survive short names and empty phones', () => assert.equal(parsed.centers.length, 2));
check('Persian decimal coordinates imported', () => assert.deepEqual(parsed.centers[0].coordinates, { lat: 35.7, lng: 51.4 }));
check('bad coordinates excluded and reported', () => { assert.equal(parsed.centers[1].coordinates, undefined); assert.match(parsed.report[0].notes.join(' '), /مختصات/); });
check('city never carries into another province', () => assert.equal(parsed.centers[1].city, ''));
check('category and kind kept separately', () => { assert.equal(parsed.centers[0].category, 'درمانی'); assert.equal(parsed.centers[0].kind, 'بیمارستان'); });
check('valid store accepted', () => assert.ok(validStoredData({ ...parsed, meta: { fileName: 'test.xlsx', source: 'upload', loadedAt: 1, size: 200 } })));
check('corrupt store rejected', () => assert.equal(validStoredData({ centers: [null], report: [], meta: {} }), false));
check('duplicate IDs rejected', () => assert.equal(validStoredData({ centers: [parsed.centers[0], parsed.centers[0]], report: [], meta: { fileName: 'test', source: 'upload', loadedAt: 1, size: 1 } }), false));
check('recent search objects rejected', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '[{"bad":true}]' } });
  assert.deepEqual(loadList('recent', []), []);
});
check('blank and nonnumeric coordinates rejected', () => {
  for (const value of ['', 'NaN', 'Infinity', '1e2', '0x20']) assert.equal(parseCoordinates(value, '51'), undefined);
  assert.equal(validCoordinates({ lat: '35', lng: 51 }), false);
});
check('boundaries and Arabic digits handled', () => { assert.deepEqual(parseCoordinates('٣٥.٧', '٥١.٤'), { lat: 35.7, lng: 51.4 }); assert.ok(parseCoordinates('-90', '180')); });
check('Neshan documented point URL and lat/lng order', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }), 'https://nshn.ir/?lat=35.7&lng=51.4'));
check('Neshan route URL uses explicit origin and vehicle', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }, { lat: 35.8, lng: 51.5 }), 'https://nshn.ir/?origin=35.8,51.5&destination=35.7,51.4&vehicle=d'));
check('iOS documented scheme', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }, undefined, true), 'neshan://?ll=35.7,51.4'));
check('providers reject invalid points', () => { assert.throws(() => neshanUrl({ lat: NaN, lng: 51 })); assert.throws(() => wazeUrl({ lat: 200, lng: 51 })); });
check('Waze coordinate order', () => assert.equal(wazeUrl({ lat: 35.7, lng: 51.4 }), 'https://www.waze.com/ul?ll=35.7,51.4&navigate=yes'));
check('Google fallback safely encodes Persian text', () => {
  const url = new URL(googleUrl({ name: 'مرکز & تست', city: 'تهران', province: 'تهران', address: 'آزادی' }));
  assert.equal(url.searchParams.get('query'), 'تهران، آزادی، مرکز & تست');
  assert.equal(url.searchParams.size, 2);
});
check('international numbers retain plus and deduplicate', () => assert.deepEqual(parsePhones('+98 21 12345678 / +98 21 12345678').map((p) => p.tel), ['+982112345678']));
check('exclude boolean facets works', () => assert.equal(applyFilters(parsed.centers, { ...EMPTY_FILTERS, hasPhone: true }, new Set(), 'hasPhone').length, 2));
check('province section clears previous city', () => {
  const result = parseWorkbook(workbook([
    ['نام', 'استان', 'شهر', 'آدرس'], ['مرکز الف', 'تهران', 'تهران', 'آزادی'],
    ['استان فارس'], ['مرکز ب', '', '', 'زند'],
  ]));
  assert.equal(result.centers[1].province, 'فارس'); assert.equal(result.centers[1].city, '');
});
check('short data row is not a second header', () => {
  const result = parseWorkbook(workbook([['نام', 'نوع مرکز', 'آدرس'], ['مرکز امید', 'بیمارستان', 'آزادی'], ['مرکز مهر', 'کلینیک', 'زند']]));
  assert.equal(result.centers.length, 2);
});
check('total row skipped in Persian', () => {
  assert.equal(parseWorkbook(workbook([['نام', 'آدرس'], ['مرکز تست', 'آزادی'], ['جمع کل', '۲']])).centers.length, 1);
});
check('oversized sparse sheet rejected before expansion', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, { A1: { t: 's', v: 'نام' }, XFD1000: { t: 's', v: 'bad' }, '!ref': 'A1:XFD1000' }, 'مراکز');
  const result = parseWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  assert.equal(result.centers.length, 0); assert.match(result.report[0].notes[0], /ابعاد/);
});
check('unsafe remote schemes and embedded credentials rejected', () => {
  for (const input of ['javascript:alert(1)', 'file:///data.xlsx', 'https://user:pass@example.com/a.xlsx']) assert.throws(() => remoteUrl(input));
});

async function networkTests() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => { calls.push(String(input)); return new Response(bytes); };
    const result = await tryRemote('https://example.com/%ZZ.xlsx?token=private');
    assert.equal(result?.name, '%ZZ.xlsx');
    assert.equal(calls.length, 1);
    console.log('PASS  malformed URL escape is safe; no public relay'); count++;
    calls.length = 0;
    globalThis.fetch = async (input) => { calls.push(String(input)); return new Response('not found', { status: 404 }); };
    assert.equal(await tryRemote('https://example.com/centers.xlsx'), null);
    assert.equal(calls.length, 1);
    assert.equal(await tryLocal(), null);
    console.log('PASS  remote and local failures resolve gracefully'); count++;
    globalThis.fetch = async () => new Response(bytes, { headers: { 'content-length': String(30 * 1024 * 1024) } });
    assert.equal(await tryRemote('https://example.com/centers.xlsx'), null);
    console.log('PASS  large downloads rejected'); count++;
    globalThis.fetch = async (input) => String(input).includes('/page')
      ? new Response('<a href="/centers.xlsx?a=1&amp;b=2">Download</a>') : new Response(bytes);
    assert.equal((await tryRemote('https://example.com/page'))?.name, 'centers.xlsx');
    console.log('PASS  relative spreadsheet URL discovered'); count++;
  } finally { globalThis.fetch = original; }
  console.log(`\n${count} regression checks passed`);
}
networkTests().catch((error) => { console.error(error); process.exitCode = 1; });
