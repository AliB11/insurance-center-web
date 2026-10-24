import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook, searchIndex, type Center } from '../src/lib/parser';
import {
  parseCoordinates, neshanUrl, googleUrl, wazeUrl, validCoordinates,
  coordinateSanity, formatCoord, distanceKm, type Destination,
} from '../src/lib/routing';
import {
  parseNeshanGeocode, parseNominatimHits, vetHits, neshanAddressQuery, neshanErrorMessage, lookupCandidates, geoConfig,
} from '../src/lib/geocode';
import { validStoredData, normalizeStoredData, loadList, type StoredData } from '../src/lib/storage';
import { detectProvince, exactProvince, explicitProvince } from '../src/lib/geo';
import { canonicalCity, citiesInScope, detectScopeCity, TEHRAN_SCOPE } from '../src/lib/scope';
import { DATA_SCHEMA, migrateStored } from '../src/lib/migrate';
import { tryRemote, tryLocal, remoteUrl, parseManifest, isManifestNewer, fetchManifest } from '../src/lib/loader';
import { parsePhones, highlightRanges, phonesFromText, compactTerm } from '../src/lib/text';
import { applyFilters, EMPTY_FILTERS, matchesTerm, tokensOf } from '../src/lib/search';

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
  ['کلینیک ج', 'تهران', 'تهران', 'خیابان ولیعصر', '02198765432', '51.4', '35.7', 'کلینیک', ''],
]);
const parsed = parseWorkbook(bytes);
/** حالت سراسری: منطق استان/شهر بدون دامنهٔ تهران (برای آزمون قواعد انتقال شهر بین استان‌ها) */
const parsedNationwide = parseWorkbook(bytes, { scope: null });
check('UTF-8 Persian CSV without BOM remains readable', () => {
  const csv = new TextEncoder().encode('نام,استان,شهر,آدرس\nمرکز امید,تهران,تهران,خیابان آزادی');
  const result = parseWorkbook(csv.buffer);
  assert.equal(result.centers.length, 1);
  assert.equal(result.centers[0].name, 'مرکز امید');
  assert.equal(result.centers[0].province, 'تهران');
});
check('rows survive short names and empty phones', () => assert.equal(parsed.centers.length, 3));
check('Persian decimal coordinates imported', () => assert.deepEqual(parsed.centers[0].coordinates, { lat: 35.7, lng: 51.4 }));
check('bad coordinates excluded and reported', () => { assert.equal(parsed.centers[1].coordinates, undefined); assert.match(parsed.report[0].notes.join(' '), /مختصات/); });
check('implausible but parseable point kept with a routing warning note', () => {
  assert.deepEqual(parsed.centers[2].coordinates, { lat: 51.4, lng: 35.7 });
  assert.match(parsed.report[0].notes.join(' '), /با نقشهٔ ایران هم‌خوان نیست/);
});
check('city never carries into another province (nationwide mode)', () => assert.equal(parsedNationwide.centers[1].city, ''));
check('Tehran scope: explicit other province is overridden, defaulted city filled, both reported', () => {
  assert.equal(parsed.centers[1].province, 'تهران');
  assert.equal(parsed.centers[1].city, 'تهران');
  const notes = parsed.report[0].notes.join(' ');
  assert.match(notes, /«فارس»/);
  assert.match(notes, /شهر «تهران» در نظر گرفته شد/);
});
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
check('degrees/minutes/seconds and hemisphere letters parse', () => {
  assert.deepEqual(parseCoordinates('۳۵°۴۲′', '51°24′'), { lat: 35.7, lng: 51.4 });
  assert.deepEqual(parseCoordinates('35°42′30″', '51°24′0″'), { lat: 35.708333333333336, lng: 51.4 });
  assert.deepEqual(parseCoordinates('35.7S', '51.4W'), { lat: -35.7, lng: -51.4 });
  assert.equal(parseCoordinates('35°42′', '51°70′'), undefined);
});
check('URL coordinates are short and float-noise-free', () => {
  assert.equal(formatCoord(35.7), '35.7');
  assert.equal(formatCoord(51.400000000000006), '51.4');
  assert.equal(formatCoord(35.844218357081935), '35.8442184');
  assert.equal(formatCoord(-0.00000004), '0');
});
check('Neshan documented point URL and lat/lng order', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }), 'https://nshn.ir/?lat=35.7&lng=51.4'));
check('Neshan route URL uses explicit origin and vehicle', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }, { origin: { lat: 35.8, lng: 51.5 } }), 'https://nshn.ir/?origin=35.8,51.5&destination=35.7,51.4&vehicle=d'));
check('Neshan route vehicle m for motorcycle', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }, { origin: { lat: 35.8, lng: 51.5 }, vehicle: 'm' }), 'https://nshn.ir/?origin=35.8,51.5&destination=35.7,51.4&vehicle=m'));
check('iOS documented scheme', () => assert.equal(neshanUrl({ lat: 35.7, lng: 51.4 }, { ios: true }), 'neshan://?ll=35.7,51.4'));
check('iOS route carries origin and vehicle', () => assert.equal(
  neshanUrl({ lat: 35.7, lng: 51.4 }, { origin: { lat: 35.8, lng: 51.5 }, vehicle: 'b', ios: true }),
  'neshan://?origin=35.8,51.5&destination=35.7,51.4&vehicle=b',
));
check('providers reject invalid points', () => {
  assert.throws(() => neshanUrl({ lat: NaN, lng: 51 }));
  assert.throws(() => neshanUrl({ lat: 35.7, lng: 51.4 }, { origin: { lat: 999, lng: 1 } }));
  assert.throws(() => wazeUrl({ lat: 200, lng: 51 }));
});
check('Waze coordinate order', () => assert.equal(wazeUrl({ lat: 35.7, lng: 51.4 }), 'https://www.waze.com/ul?ll=35.7,51.4&navigate=yes'));
check('Google directions URL when origin known', () => {
  const url = new URL(googleUrl({ name: 'الف', province: 'تهران', city: 'تهران', address: 'آزادی' }, { lat: 35.7, lng: 51.4 }, { lat: 35.8, lng: 51.5 }));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('origin'), '35.8,51.5');
  assert.equal(url.searchParams.get('destination'), '35.7,51.4');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
});
check('Google fallback safely encodes Persian text', () => {
  const url = new URL(googleUrl({ name: 'مرکز & تست', city: 'تهران', province: 'تهران', address: 'آزادی' }));
  assert.equal(url.searchParams.get('query'), 'تهران، آزادی، مرکز & تست');
  assert.equal(url.searchParams.size, 2);
});
check('sanity flags swap, null island and foreign points', () => {
  assert.equal(coordinateSanity({ lat: 35.7, lng: 51.4 }).state, 'ok');
  assert.deepEqual(coordinateSanity({ lat: 51.4, lng: 35.7 }).swapped, { lat: 35.7, lng: 51.4 });
  assert.equal(coordinateSanity({ lat: 51.4, lng: 35.7 }).state, 'probable-swap');
  assert.equal(coordinateSanity({ lat: 0, lng: 0 }).state, 'null-island');
  assert.equal(coordinateSanity({ lat: 48.8, lng: 2.3 }).state, 'outside-iran');
  assert.equal(coordinateSanity({ lat: 24.0, lng: 43.3 }).state, 'ok');
});
check('haversine distance is region-sane', () => {
  const km = distanceKm({ lat: 35.6892, lng: 51.389 }, { lat: 35.8327, lng: 50.9915 });
  assert.ok(km > 30 && km < 50, `Tehran–Karaj ${km}`);
  assert.equal(distanceKm({ lat: 35, lng: 51 }, { lat: 35, lng: 51 }), 0);
});
check('international numbers retain plus and deduplicate', () => assert.deepEqual(parsePhones('+98 21 12345678 / +98 21 12345678').map((p) => p.tel), ['+982112345678']));
check('exclude boolean facets works', () => assert.equal(applyFilters(parsed.centers, { ...EMPTY_FILTERS, hasPhone: true }, new Set(), 'hasPhone').length, 3));
check('province section clears previous city (nationwide mode)', () => {
  const result = parseWorkbook(workbook([
    ['نام', 'استان', 'شهر', 'آدرس'], ['مرکز الف', 'تهران', 'تهران', 'آزادی'],
    ['استان فارس'], ['مرکز ب', '', '', 'زند'],
  ]), { scope: null });
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
  // ۱۶۳۸۴×۷۰ ≈ ۱٫۱۵ میلیون خانه > سقف ۱ میلیون؛ کوچک‌تر از قبل تا ساخت فایلِ آزمون ۸ ثانیه طول نکشد
  XLSX.utils.book_append_sheet(wb, { A1: { t: 's', v: 'نام' }, XFD70: { t: 's', v: 'bad' }, '!ref': 'A1:XFD70' }, 'مراکز');
  const result = parseWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  assert.equal(result.centers.length, 0); assert.match(result.report[0].notes[0], /ابعاد/);
});
check('unsafe remote schemes and embedded credentials rejected', () => {
  for (const input of ['javascript:alert(1)', 'file:///data.xlsx', 'https://user:pass@example.com/a.xlsx']) assert.throws(() => remoteUrl(input));
});

check('descriptive name header is promoted to the name column (real sphbank file shape)', () => {
  // هدر واقعی فایل مراکز: «بیمارستان و مرکز جراحی (بستری)»/« داروخانه» با الگوی دقیق نام match نمی‌شود
  const result = parseWorkbook(workbook([
    ['رديف', 'بیمارستان و مرکز جراحی (بستری)', 'کد', 'آدرس', 'شماره تلفن'],
    ['1', 'اقبال', '1000', 'خیابان آزادی، نبش خیابان میمنت', '66001126-9'],
    ['2', 'لاله', '1001', 'خیابان ولیعصر', '88775799-88789039'],
  ]));
  assert.deepEqual(result.centers.map((c) => c.name), ['اقبال', 'لاله']);
  assert.ok(!result.report[0].mapping.some((m) => m.field === 'name' && m.header === 'کد'), 'code column never becomes the name');
  assert.deepEqual(result.centers.map((c) => c.phones.map((p) => p.tel)), [['02166001126'], ['02188775799', '02188789039']]);
});

console.log('\n--- به‌روزرسانی خودکار هفتگی (manifest فایل همراه) ---');
const manifestFixture = {
  updatedAt: '2026-10-24T06:00:00.000Z',
  publishedAt: '2026-09-26T04:52:01.000Z',
  sha256: 'a'.repeat(64),
  source: 'https://sphbank.ir/Upload/Modules/Contents/asset55/1405.07.01مراکز درمانی.xlsx',
  fileName: '1405.07.01مراکز درمانی.xlsx',
};
check('manifest: strict parsing accepts the real shape and rejects tampering', () => {
  const parsed = parseManifest(manifestFixture);
  assert.ok(parsed);
  assert.equal(parsed!.sha256, 'a'.repeat(64));
  assert.equal(parsed!.publishedAt, manifestFixture.publishedAt);
  assert.equal(parseManifest({ ...manifestFixture, sha256: 'nothex' }), null);
  assert.equal(parseManifest({ ...manifestFixture, sha256: 'A'.repeat(63) }), null);
  assert.equal(parseManifest({ ...manifestFixture, updatedAt: 'yesterday' }), null);
  assert.equal(parseManifest({ ...manifestFixture, publishedAt: 'nonsense' }), null);
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest('<html>gateway error</html>'), null);
  assert.equal(parseManifest({ ...manifestFixture, fileName: '' })!.fileName, 'centers.xlsx', 'fallback file name');
});
check('manifest freshness: published date decides, loadedAt ties go to stored data', () => {
  const manifest = parseManifest(manifestFixture)!;
  const published = Date.parse(manifestFixture.publishedAt!);
  assert.equal(isManifestNewer(manifest, { loadedAt: published - 1 }), true, 'stored data predates the file');
  assert.equal(isManifestNewer(manifest, { loadedAt: published }), false, 'same instant is not newer');
  assert.equal(isManifestNewer(manifest, { loadedAt: published + 1000 }), false);
  assert.equal(isManifestNewer(manifest, null), true, 'no stored data yet');
  assert.equal(isManifestNewer({ ...manifest, publishedAt: null }, { loadedAt: Date.parse(manifestFixture.updatedAt) }), false, 'falls back to updatedAt');
  assert.equal(isManifestNewer({ ...manifest, publishedAt: null, updatedAt: 'bad' }, null), false, 'unreadable dates never update');
});

console.log('\n--- دامنهٔ داده: همهٔ مراکز در استان تهران ---');
/** آدرس‌های واقعی‌نمای تهران که نام استان دیگری در خود دارند (باگ گزارش‌شدهٔ کاربر) */
const TRAPS: [string, string][] = [
  ['بزرگراه کردستان، خیابان ۶۴ غربی، پلاک ۱۰', 'کردستان'],
  ['تهران، بزرگراه کردستان، نبش کوچه ۵', 'کردستان'],
  ['کردستان، بعد از پل همت، ساختمان پزشکان', 'کردستان'],
  ['خیابان قزوین، نرسیده به میدان قزوین', 'قزوین'],
  ['بزرگراه خلیج فارس، جنب پمپ بنزین', 'فارس'],
  ['دفتر مرکزی، خیابان ولیعصر', 'مرکزی'],
  ['شهرک گلستان، بلوار اصلی', 'گلستان'],
  ['خیابان البرز، کوچه دوم', 'البرز'],
  ['جاده قدیم قم، کهریزک', 'قم'],
  ['خیابان زنجان شمالی، پلاک ۴', 'زنجان'],
  ['خیابان همدان، پلاک ۳', 'همدان'],
  ['خیابان کرمان، کوچه ۱۲', 'کرمان'],
  ['خیابان اردبیل، پلاک ۸', 'اردبیل'],
  ['جاده مخصوص کرج، کیلومتر ۵', 'البرز'],
  ['اتوبان تهران-قم، عوارضی', 'قم'],
];
const trapBook = workbook([['ردیف', 'نام مرکز', 'آدرس', 'تلفن'], ...TRAPS.map(([address], i) => [i + 1, `مرکز ${i + 1}`, address, '88776655'])]);
check('Tehran streets/highways named after provinces never change the province', () => {
  const result = parseWorkbook(trapBook);
  assert.equal(result.centers.length, TRAPS.length);
  for (const c of result.centers) assert.equal(c.province, 'تهران', c.address);
  assert.ok(result.centers.every((c) => c.city === 'تهران'), 'no satellite city guessed from a street name');
  assert.match(result.report[0].notes.join(' '), /حدس زده نمی‌شود/);
});
check('nationwide mode never reads the province from an address either', () => {
  const result = parseWorkbook(trapBook, { scope: null });
  for (const c of result.centers) assert.equal(c.province, '', c.address);
});
check('explicit province values: earliest non-street mention wins (no longest-match)', () => {
  assert.equal(detectProvince('تهران - بزرگراه کردستان'), 'تهران');
  assert.equal(detectProvince('بزرگراه کردستان'), '');
  assert.equal(detectProvince('خلیج فارس'), '');
  assert.equal(detectProvince('استان تهران'), 'تهران');
  assert.equal(detectProvince('سیستان و بلوچستان'), 'سیستان و بلوچستان');
  assert.equal(exactProvince('استان: تهران'), 'تهران');
  assert.equal(exactProvince('خیابان قزوین'), '');
  assert.equal(explicitProvince('مراکز طرف قرارداد استان تهران'), 'تهران');
  assert.equal(explicitProvince('داروخانه البرز'), '');
});
check('header-less sheet: a column of province-named streets is not a province column', () => {
  const result = parseWorkbook(workbook([
    ['بیمارستان الف', 'بزرگراه کردستان', '88776655'],
    ['آزمایشگاه ب', 'خیابان قزوین', '66554433'],
    ['داروخانه ج', 'خیابان زنجان', '55443322'],
  ]), { scope: null });
  assert.equal(result.centers.length, 3);
  assert.ok(result.centers.every((c) => c.province === ''));
  assert.ok(!result.report[0].mapping.some((m) => m.field === 'province'));
  assert.ok(result.centers[0].search.includes('کردستان'), 'street text stays searchable');
});
check('single-cell row «داروخانه البرز» is a center, not a province title', () => {
  const result = parseWorkbook(workbook([
    ['نام', 'آدرس', 'تلفن'], ['مرکز الف', 'خیابان آزادی', '021-66001122'],
    ['داروخانه البرز'], ['مرکز ب', 'خیابان انقلاب', '021-66001133'],
  ]));
  assert.deepEqual(result.centers.map((c) => c.name), ['مرکز الف', 'داروخانه البرز', 'مرکز ب']);
  assert.ok(result.centers.every((c) => c.province === 'تهران'));
});
check('single-cell category headings («بیمارستان‌ها») are not centers', () => {
  const result = parseWorkbook(workbook([
    ['نام مرکز', 'آدرس', 'تلفن'],
    ['بیمارستان‌ها'],
    ['بیمارستان الف', 'خیابان آزادی', '88776655'],
    ['داروخانه ها'],
    ['داروخانه ب', 'خیابان ولیعصر', '66554433'],
    ['مراکز تصویربرداری'],
    ['مرکز تصویربرداری پارس', 'خیابان ونک', '88776600'],
    ['آزمایشگاهها'],
    ['آزمایشگاه رازی', 'خیابان کارگر', '66551122'],
  ]));
  assert.deepEqual(result.centers.map((c) => c.name), [
    'بیمارستان الف', 'داروخانه ب', 'مرکز تصویربرداری پارس', 'آزمایشگاه رازی',
  ]);
  assert.match(result.report[0].notes.join(' '), /عنوانِ دسته/);
  // عنوان‌ها باید به‌عنوان زمینه در گزارش بیایند، نه داده
  assert.ok(result.report[0].skipped.some((s) => s.text === 'بیمارستان‌ها'));
});
check('a real center named like a category («داروخانه رها») is still a row', () => {
  const result = parseWorkbook(workbook([
    ['نام', 'آدرس', 'تلفن'],
    ['داروخانه رها'],
    ['مرکز ب', 'خیابان انقلاب', '021-66001133'],
  ]));
  assert.ok(result.centers.some((c) => c.name === 'داروخانه رها'));
});
check('header-less sheet: short street addresses still land in the address column', () => {
  const result = parseWorkbook(workbook([
    ['بیمارستان الف', 'خیابان آزادی، پلاک ۲', '88776655'],
    ['داروخانه ب', 'خیابان ولیعصر، پلاک ۹', '66554433'],
  ]));
  const mapping = result.report[0].mapping;
  assert.ok(mapping.some((m) => m.field === 'address'), 'address column found by street words');
  assert.deepEqual(result.centers.map((c) => c.address), ['خیابان آزادی، پلاک ۲', 'خیابان ولیعصر، پلاک ۹']);
});
check('stored data missing new fields is repaired instead of discarded', () => {
  const legacy = {
    centers: [{
      id: 0, name: 'مرکز قدیمی', category: '', sheet: 'مراکز', province: 'تهران', city: 'تهران',
      address: 'خیابان آزادی', phones: [{ label: '88776655', tel: '88776655' }],
      kind: '', service: '', discount: '', desc: '', extra: {},
      // فیلدهای مشتق‌شده اصلاً وجود ندارند (مثل افزودن فیلد تازه به Center در آینده)
    }],
    report: [{ sheet: 'مراکز', category: 'مراکز', rows: 1, imported: 1, headerRow: null, notes: [], mapping: [], skipped: [] }],
    meta: { fileName: 'old.xlsx', source: 'upload', loadedAt: 1, size: 1 },
  };
  assert.equal(validStoredData(legacy), false, 'missing derived fields fail strict validation');
  const fixed = normalizeStoredData(legacy);
  assert.ok(fixed, 'normalizer recovers the record');
  assert.equal(fixed!.centers[0].category, 'سایر');
  assert.equal(fixed!.centers[0].nameN, 'مرکز قدیمی');
  assert.ok(fixed!.centers[0].search.includes('خیابان'), 'search index rebuilt from the fields');
  assert.equal(fixed!.centers[0].locN, 'تهران تهران');
  assert.equal(normalizeStoredData({ centers: [null, 'x'] }), null, 'nothing usable stays unreadable');
});
check('citiesInScope does not confuse the province prefix with a city', () => {
  assert.deepEqual(citiesInScope('تهران، ورامین، محله', TEHRAN_SCOPE), ['تهران', 'ورامین']);
  assert.deepEqual(citiesInScope('شهر قدس', TEHRAN_SCOPE), ['قدس']);
  assert.deepEqual(citiesInScope('کرج', TEHRAN_SCOPE), []);
  assert.deepEqual(citiesInScope('خیابان شهریار', TEHRAN_SCOPE), ['شهریار'], 'named after a city, still a token');
});
check('workbook-wide limits: too many sheets are rejected', () => {
  const book = XLSX.utils.book_new();
  for (let i = 0; i < 61; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['نام', 'آدرس'], ['مرکز', 'خیابان آزادی']]), `s${i}`);
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  assert.throws(() => parseWorkbook(buffer), /تعداد شیت/);
});
check('city comes from the start of the address only when explicit', () => {
  const cases: [string, string][] = [
    ['شهریار، خیابان ولیعصر', 'شهریار'],
    ['خیابان شهریار، پلاک ۲', ''],
    ['اسلامشهر خیابان امام خمینی', 'اسلامشهر'],
    ['استان تهران، ورامین، میدان شهدا', 'ورامین'],
    ['استان تهران - دماوند - خیابان امام', 'دماوند'],
    ['دماوند، نرسیده به چهارراه', ''],
    ['شهرستان دماوند، خیابان امام', 'دماوند'],
    ['شهر قدس، بلوار انقلاب', 'قدس'],
    ['خیابان انقلاب، خیابان قدس', ''],
    ['شهرری، خیابان فداییان اسلام', 'شهر ری'],
    ['تهران، اسلامشهر، بلوار امام', 'اسلامشهر'],
    ['تهران، بزرگراه کردستان', 'تهران'],
    ['تهرانپارس، فلکه اول', ''],
    ['شهریار، اندیشه، فاز ۳', 'اندیشه'],
    ['پردیس فاز ۲، خیابان فرهنگ', 'پردیس'],
    ['فاز ۲ پردیس، خیابان فرهنگ', 'پردیس'],
    ['رباط کریم، بلوار امام', 'رباط‌کریم'],
    ['استان البرز، کرج، خیابان بهار', ''],
    ['جاده قدیم قم، کهریزک', ''],
  ];
  for (const [address, city] of cases) assert.equal(detectScopeCity(address, TEHRAN_SCOPE), city, address);
  assert.equal(canonicalCity('اسلام شهر', TEHRAN_SCOPE), 'اسلامشهر');
  assert.equal(canonicalCity('شهر قدس', TEHRAN_SCOPE), 'قدس');
  assert.equal(canonicalCity('کرج', TEHRAN_SCOPE), 'کرج');
});
check('explicit city column wins over the address and is spelled canonically', () => {
  const result = parseWorkbook(workbook([['نام', 'شهر', 'آدرس'], ['مرکز الف', 'اسلام شهر', 'شهریار، خیابان ولیعصر'], ['مرکز ب', '', 'شهریار، خیابان ولیعصر']]));
  assert.deepEqual(result.centers.map((c) => c.city), ['اسلامشهر', 'شهریار']);
});
check('explicit city outside Tehran province is kept but flagged in the report', () => {
  const result = parseWorkbook(workbook([['نام', 'شهر', 'آدرس'], ['مرکز الف', 'شیراز', 'خیابان زند'], ['مرکز ب', 'ورامین', 'میدان شهدا']]));
  assert.deepEqual(result.centers.map((c) => c.city), ['شیراز', 'ورامین']);
  assert.match(result.report[0].notes.join(' '), /شهرِ ۱ مرکز در فهرست شهرهای استان تهران نیست \(«شیراز»\)/);
});
check('phones: Tehran numbers become dialable from a mobile phone', () => {
  const tels = (raw: string, area = '021') => parsePhones(raw, area).map((p) => p.tel);
  assert.deepEqual(tels('88776655'), ['02188776655']);
  assert.deepEqual(tels('021-66927008-10'), ['02166927008']);
  assert.deepEqual(tels('۰۲۱-۶۶۹۲۷۰۰۸ الی ۱۰'), ['02166927008']);
  assert.deepEqual(tels('55001122 داخلی 12'), ['02155001122']);
  assert.deepEqual(tels('66927008 66927009'), ['02166927008', '02166927009']);
  assert.deepEqual(tels('0912 123 4567'), ['09121234567']);
  assert.deepEqual(tels('9121234567'), ['09121234567']);
  assert.deepEqual(tels('88-77-66-55'), ['02188776655']);
  assert.deepEqual(tels('88776655', ''), ['88776655']);
  assert.equal(parsePhones('021-66927008-10', '021')[0].label, '021-66927008-10');
});
check('labelled local numbers inside the address are found; bare numbers (plaque, postal code) are not', () => {
  const result = parseWorkbook(workbook([['نام', 'آدرس'], ['مرکز الف', 'خیابان آزادی، پلاک ۱۲۳۴۵۶۷۸، تلفن: ۶۶۰۰۱۱۲۲'], ['مرکز ب', 'خیابان انقلاب، کد پستی ۱۴۱۵۶۷۸۹۰۱']]));
  assert.deepEqual(result.centers[0].phones.map((p) => p.tel), ['02166001122']);
  assert.deepEqual(result.centers[1].phones, []);
  assert.deepEqual(parseWorkbook(workbook([['نام', 'آدرس'], ['مرکز الف', 'تلفن: ۶۶۰۰۱۱۲۲']]), { scope: null }).centers[0].phones, []);
});
check('parser applies the 021 area code and says so in the report', () => {
  const result = parseWorkbook(workbook([['نام', 'آدرس', 'تلفن'], ['مرکز الف', 'خیابان آزادی', '88776655'], ['مرکز ب', 'خیابان انقلاب', '021-66001133']]));
  assert.deepEqual(result.centers.map((c) => c.phones[0].tel), ['02188776655', '02166001133']);
  assert.match(result.report[0].notes.join(' '), /پیش‌شمارهٔ ۰۲۱ به ۱ شماره/);
});
check('search: street type is optional («اتوبان کردستان» finds «بزرگراه کردستان»)', () => {
  const list = parseWorkbook(trapBook).centers;
  const hits = applyFilters(list, { ...EMPTY_FILTERS, q: 'اتوبان کردستان' }, new Set());
  assert.equal(hits.length, 3);
  assert.equal(applyFilters(list, { ...EMPTY_FILTERS, q: 'کوچه ۱۲' }, new Set()).length, 1, 'numbers keep the street word');
});
check('search: spacing/hyphen variance matches (شهرقدس ↔ شهر قدس، 021-66927008 ↔ 02166927008)', () => {
  const list = parseWorkbook(workbook([
    ['نام مرکز', 'شهر', 'آدرس', 'تلفن'],
    ['داروخانه قدس', 'قدس', 'شهر قدس، بلوار انقلاب', '66927008'],
    ['درمانگاه حسن‌آباد', 'تهران', 'حسن‌آباد، خیابان گلستان', ''],
  ])).centers;
  // نیم‌فاصله در فایل، تایپ بدون نیم‌فاصله در جستجو
  assert.equal(applyFilters(list, { ...EMPTY_FILTERS, q: 'حسناباد' }, new Set()).length, 1);
  // فاصله در فایل، تایپ چسبیده در جستجو
  assert.equal(applyFilters(list, { ...EMPTY_FILTERS, q: 'شهرقدس' }, new Set()).length, 1);
  // شماره با خط تیره، دقیقاً همان شکلی که روی کارت نمایش داده می‌شود
  assert.equal(applyFilters(list, { ...EMPTY_FILTERS, q: '021-66927008' }, new Set()).length, 1);
  assert.equal(applyFilters(list, { ...EMPTY_FILTERS, q: '۶۶۹۲۷۰۰۸' }, new Set()).length, 1);
  // جستجوی دقیق همچنان کار می‌کند و نتیجهٔ بی‌ربط نمی‌دهد
  assert.equal(applyFilters(list, { ...EMPTY_FILTERS, q: 'کهریزک' }, new Set()).length, 0);
  assert.ok(matchesTerm(list[0], tokensOf('شهرقدس')[0]));
  assert.equal(compactTerm('021-66927008'), '02166927008');
});
check('highlight covers spacing-variance matches too', () => {
  const ranges = highlightRanges('شهر قدس، بلوار انقلاب', ['شهرقدس']);
  assert.deepEqual(ranges, [[0, 7]]);
  const phone = highlightRanges('تلفن: 021-66927008', ['02166927008']);
  assert.deepEqual(phone, [[6, 18]]);
  assert.deepEqual(highlightRanges('متن', []), []);
});
check('bare numbers inside long digit runs are not phones in free text', () => {
  assert.equal(phonesFromText('کد رهگیری 14001234567890').length, 0);
  assert.equal(phonesFromText('کد 198765432101234').length, 0);
  assert.deepEqual(phonesFromText('خیابان آزادی، تلفن: 88776655', '021').map((p) => p.tel), ['02188776655']);
  assert.deepEqual(phonesFromText('021 88776655').map((p) => p.tel), ['02188776655']);
});

/** دادهٔ ذخیره‌شده با منطق نسخهٔ قبل: استان از نام خیابان، تلفن بدون پیش‌شماره، بدون schema */
function legacyStore(): StoredData {
  const fresh = parseWorkbook(workbook([
    ['مراکز درمانی'],
    ['نام', 'آدرس', 'تلفن'],
    ['بیمارستان الف', 'بزرگراه کردستان، خیابان ۶۴', '88776655'],
    ['آزمایشگاه ب', 'خیابان قزوین، پلاک ۲', '021-66927008-10'],
    ['داروخانه ج', 'شهریار، بلوار ولیعصر', '021-65001122'],
  ]), { scope: null });
  const legacy: Record<string, [string, { label: string; tel: string }[]]> = {
    'بیمارستان الف': ['کردستان', [{ label: '88776655', tel: '88776655' }]],
    'آزمایشگاه ب': ['قزوین', [{ label: '021-66927008-10', tel: '0216692700810' }]],
    'داروخانه ج': ['', [{ label: '021-65001122', tel: '02165001122' }]],
  };
  const centers = fresh.centers.map((c): Center => {
    const [province, phones] = legacy[c.name];
    const old = { ...c, province, city: '', phones };
    return { ...old, search: searchIndex(old, 'مراکز درمانی'), locN: province };
  });
  return { centers, report: fresh.report, meta: { fileName: 'old.xlsx', source: 'upload', loadedAt: 1, size: 10 } };
}
check('stored data from the previous version is repaired on load', () => {
  const old = legacyStore();
  assert.ok(validStoredData(old));
  const { data, changed, summary } = migrateStored(old);
  assert.equal(changed, true);
  assert.equal(data.meta.schema, DATA_SCHEMA);
  assert.ok(validStoredData(data));
  assert.deepEqual(data.centers.map((c) => c.province), ['تهران', 'تهران', 'تهران']);
  assert.deepEqual(data.centers.map((c) => c.city), ['تهران', 'تهران', 'شهریار']);
  assert.deepEqual(data.centers.map((c) => c.phones[0].tel), ['02188776655', '02166927008', '02165001122']);
  assert.deepEqual(summary, { centers: 3, provinces: 3, cities: 3, phones: 2 });
  const fixed = data.centers[0];
  assert.equal(fixed.locN, 'تهران تهران');
  assert.ok(fixed.search.includes('02188776655') && fixed.search.endsWith('مراکز درمانی'), 'section context survives the rebuild');
  assert.ok(!data.centers[1].search.includes('0216692700810'), 'stale wrong number removed from the index');
  assert.match(data.report[0].notes[0], /استان ۳ مرکز به «تهران» اصلاح شد/);
});
check('migration also finds labelled numbers in the address of phoneless centers', () => {
  const old = legacyStore();
  old.centers[2] = { ...old.centers[2], phones: [], address: 'شهریار، بلوار ولیعصر، تلفن: ۶۵۰۰۱۱۲۲' };
  old.centers[2].search = searchIndex(old.centers[2], 'مراکز درمانی');
  const fixed = migrateStored(old).data.centers[2];
  assert.deepEqual(fixed.phones.map((p) => p.tel), ['02165001122']);
  assert.ok(fixed.search.includes('02165001122'));
});
check('migration is idempotent and skips current data', () => {
  const once = migrateStored(legacyStore()).data;
  assert.equal(migrateStored(once).changed, false);
  const again = migrateStored({ ...once, meta: { ...once.meta, schema: 1 } });
  assert.equal(again.summary.centers, 0);
  assert.deepEqual(again.data.centers, once.centers);
});
check('schema field validated in stored meta', () => {
  const meta = { fileName: 'a', source: 'upload', loadedAt: 1, size: 1 };
  assert.ok(validStoredData({ centers: [], report: [], meta: { ...meta, schema: 2 } }));
  assert.equal(validStoredData({ centers: [], report: [], meta: { ...meta, schema: 'x' } }), false);
});

console.log('\n--- ژئوکدینگ و سنجش پاسخ ---');
const tehran: Destination = { name: 'بیمارستان مهرگان', province: 'تهران', city: 'تهران', address: 'خیابان کمیل، پلاک ۹' };
check('Neshan address query keeps province/city/address and drops the center name', () => {
  assert.equal(neshanAddressQuery({ ...tehran }), 'تهران تهران خیابان کمیل، پلاک ۹');
});
check('Neshan geocode items parse with labels and unmatched terms', () => {
  const hits = parseNeshanGeocode({ items: [{ location: { latitude: 35.7, longitude: 51.4 }, province: 'تهران', city: 'تهران', neighbourhood: 'خانی‌آباد', unMatchedTerm: 'پلاک ۹' }] });
  assert.equal(hits.length, 1);
  assert.deepEqual({ lat: hits[0].lat, lng: hits[0].lng }, { lat: 35.7, lng: 51.4 });
  assert.equal(hits[0].label, 'تهران، تهران، خانی‌آباد');
  assert.equal(hits[0].unmatched, 'پلاک ۹');
});
check('legacy v4 shape guards x=lng / y=lat swap', () => {
  const hits = parseNeshanGeocode({ status: 'OK', location: { x: 51.4, y: 35.7 } });
  assert.deepEqual({ lat: hits[0].lat, lng: hits[0].lng }, { lat: 35.7, lng: 51.4 });
});
check('Nominatim jsonv2 array parses', () => {
  const hits = parseNominatimHits([{ lat: '29.59', lon: '52.58', display_name: 'فارس، شیراز، زند', address: { city: 'شیراز', state: 'فارس' } }, { bad: 1 }]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].city, 'شیراز');
});
check('vet rejects foreign answers and other-city peers', () => {
  const peers = [{ lat: 35.69, lng: 51.4 }];
  const sari = vetHits([{ lat: 36.56, lng: 53.06, label: 'مازندران، ساری، خیابان کمیل', city: 'ساری' }], tehran, peers, 'nominatim');
  assert.equal(sari[0].accepted, false);
  assert.match(sari[0].reason ?? '', /شهر دیگری/);
  const paris = vetHits([{ lat: 48.85, lng: 2.35, label: 'پاریس', city: 'پاریس' }], tehran, [], 'nominatim');
  assert.equal(paris[0].accepted, false);
  assert.match(paris[0].reason ?? '', /خارج از ایران/);
  const zero = vetHits([{ lat: 0, lng: 0, label: '—' }], tehran, [], 'neshan');
  assert.equal(zero[0].accepted, false);
});
check('vet accepts same-city answer near peers and warns when far-ish', () => {
  const peers = [{ lat: 35.69, lng: 51.4 }];
  const good = vetHits([{ lat: 35.7, lng: 51.39, label: 'تهران، خیابان کمیل', city: 'تهران', province: 'تهران' }], tehran, peers, 'neshan');
  assert.equal(good[0].accepted, true);
  assert.equal(good[0].reason, undefined);
  // ~14km within Tehran: accepted but flagged; ~43km belongs to another settlement
  const far = vetHits([{ lat: 35.7, lng: 51.55, label: 'تهران، تهران', city: 'تهران', province: 'تهران' }], tehran, peers, 'neshan');
  assert.equal(far[0].accepted, true);
  assert.match(far[0].reason ?? '', /نسبتاً دور/);
  const tooFar = vetHits([{ lat: 35.7, lng: 51.9, label: 'تهران، تهران', city: 'تهران', province: 'تهران' }], tehran, peers, 'neshan');
  assert.equal(tooFar[0].accepted, false);
  assert.match(tooFar[0].reason ?? '', /فاصله دارد/);
  const cityMiss = vetHits([{ lat: 35.7, lng: 51.39, label: 'البرز، کرج، کمیل', city: 'کرج', province: 'البرز' }], tehran, [], 'nominatim');
  assert.equal(cityMiss[0].accepted, false);
  assert.match(cityMiss[0].reason ?? '', /شهر/);
});
check('vet rejects another city of the same province (province prefix is not a city match)', () => {
  const peers = [{ lat: 35.69, lng: 51.4 }];
  // برچسب Nominatim با نام استان شروع می‌شود؛ قبلاً همین برای تطبیق «تهران» کافی بود
  const labelOnly = vetHits([{ lat: 35.35, lng: 51.65, label: 'تهران، ورامین، محلهٔ نمونه', province: 'تهران' }], tehran, peers, 'nominatim');
  assert.equal(labelOnly[0].cityMatch, false);
  assert.equal(labelOnly[0].accepted, false);
  const withCity = vetHits([{ lat: 35.35, lng: 51.65, label: 'تهران، ورامین', city: 'ورامین', province: 'تهران' }], tehran, [], 'nominatim');
  assert.equal(withCity[0].accepted, false);
  // همان پاسخ برای مرکز ورامین پذیرفته است
  const varamin = vetHits(
    [{ lat: 35.35, lng: 51.65, label: 'تهران، ورامین', city: 'ورامین', province: 'تهران' }],
    { name: 'مرکز ورامین', province: 'تهران', city: 'ورامین', address: 'خیابان شهدا' },
    [],
    'nominatim',
  );
  assert.equal(varamin[0].accepted, true);
  // نام مستعار «شهر قدس» با شهر «قدس» یکی است
  const qods = vetHits(
    [{ lat: 35.72, lng: 51.11, label: 'تهران، شهر قدس', city: 'شهر قدس', province: 'تهران' }],
    { name: 'مرکز قدس', province: 'تهران', city: 'قدس', address: 'بلوار انقلاب' },
    [],
    'nominatim',
  );
  assert.equal(qods[0].accepted, true);
});
check('vet: an answer outside Tehran province is rejected even without peers', () => {
  const highway = { name: 'بیمارستان الف', province: 'تهران', city: 'تهران', address: 'بزرگراه کردستان، خیابان ۶۴' };
  const sanandaj = vetHits([{ lat: 35.31, lng: 47.0, label: 'کردستان، سنندج، بلوار کردستان', city: 'سنندج', province: 'کردستان' }], highway, [], 'nominatim');
  assert.equal(sanandaj[0].accepted, false);
  assert.match(sanandaj[0].reason ?? '', /بیرون از محدودهٔ استان تهران/);
  const inTehran = vetHits([{ lat: 35.745, lng: 51.4, label: 'تهران، بزرگراه کردستان', city: 'تهران', province: 'تهران' }], highway, [], 'nominatim');
  assert.equal(inTehran[0].accepted, true);
  const nationwide = vetHits([{ lat: 35.31, lng: 47.0, label: 'کردستان، سنندج', city: 'سنندج', province: 'کردستان' }], { ...highway, province: 'کردستان', city: 'سنندج' }, [], 'nominatim');
  assert.equal(nationwide[0].accepted, true, 'other provinces keep the old behaviour');
});
check('Neshan error codes map to understandable Persian', () => {
  assert.match(neshanErrorMessage('480'), /کلید/);
  assert.match(neshanErrorMessage('482'), /دقیقه/);
  assert.match(neshanErrorMessage('0'), /اتصال/);
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

    const csvText = 'نام مرکز,شهر,آدرس\nداروخانه مهر,تهران,خیابان آزادی';
    globalThis.fetch = async (input) => String(input).includes('/page')
      ? new Response('<a href="/centers.csv">CSV</a>') : new Response(csvText);
    assert.equal((await tryRemote('https://example.com/page'))?.name, 'centers.csv');
    globalThis.fetch = async () => new Response(csvText);
    assert.equal((await tryRemote('https://example.com/centers.csv'))?.name, 'centers.csv');
    console.log('PASS  remote CSV (direct URL and discovered link) is accepted as a data file'); count++;

    globalThis.fetch = async () => new Response('<html><body>404 page</body></html>');
    assert.equal(await tryRemote('https://example.com/data.csv'), null);
    globalThis.fetch = async () => new Response('not found');
    assert.equal(await tryRemote('https://example.com/centers.csv'), null);
    console.log('PASS  HTML/plain error pages are never mistaken for CSV data'); count++;

    // پاسخ بسیار بزرگ نباید بی‌نهایت حافظه بگیرد؛ سقف ۴۰۰KB پیش از JSON.parse اعمال می‌شود
    globalThis.fetch = async () => new Response('x'.repeat(450_000), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(() => lookupCandidates(tehran, [], { source: 'nominatim' }), /نقشهٔ آزاد/);
    globalThis.fetch = async () => {
      const stream = new ReadableStream({
        start(controller) {
          const chunk = new TextEncoder().encode('x'.repeat(60_000));
          for (let i = 0; i < 10; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(stream);
    };
    await assert.rejects(() => lookupCandidates(tehran, [], { source: 'nominatim' }), /نقشهٔ آزاد/);
    console.log('PASS  oversized geocoder responses abort before parsing (declared and streamed)'); count++;

    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ items: [{ location: { latitude: 35.7, longitude: 51.4 }, province: 'تهران', city: 'تهران', neighbourhood: 'خانی‌آباد' }] }));
    };
    calls.length = 0;
    const viaNeshan = await lookupCandidates(tehran, [], { source: 'neshan', key: 'demo-key' });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://api.neshan.org/geocoding/v1?json='));
    const sent = JSON.parse(decodeURIComponent(new URL(calls[0]).searchParams.get('json')!));
    assert.deepEqual(sent, { address: 'تهران تهران خیابان کمیل، پلاک ۹', province: 'تهران', city: 'تهران' });
    assert.equal(viaNeshan.length, 1);
    assert.equal(viaNeshan[0].accepted, true);
    console.log('PASS  geocoding request carries documented json payload and lands vetted'); count++;

    globalThis.fetch = async () => new Response('quota', { status: 481 });
    await assert.rejects(() => lookupCandidates(tehran, [], { source: 'neshan', key: 'demo-key' }), /سقف تعداد/);
    console.log('PASS  key quota errors are explained'); count++;

    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response('[{"lat":"29.59","lon":"52.58","display_name":"فارس، شیراز، خیابان زند","address":{"city":"شیراز","state":"فارس"}}]');
    };
    calls.length = 0;
    const shiraz = { name: 'داروخانه ب', province: 'فارس', city: 'شیراز', address: 'خیابان زند' };
    const viaOsm = await lookupCandidates(shiraz, [{ city: 'شیراز', coordinates: { lat: 29.6, lng: 52.55 } }], { source: 'nominatim' });
    assert.ok(calls[0].startsWith('https://nominatim.openstreetmap.org/search?'));
    assert.ok(calls[0].includes('countrycodes=ir'));
    assert.equal(viaOsm.length, 1);
    assert.equal(viaOsm[0].accepted, true);
    console.log('PASS  keyless OSM fallback works with Iran restriction'); count++;
    calls.length = 0;
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response('[{"lat":"35.745","lon":"51.40","display_name":"بزرگراه کردستان، تهران، استان تهران","address":{"city":"تهران","state":"استان تهران"}}]');
    };
    const viaBox = await lookupCandidates({ name: 'بیمارستان الف', province: 'تهران', city: 'تهران', address: 'بزرگراه کردستان' }, [], { source: 'nominatim' });
    const sentUrl = new URL(calls[0]);
    assert.equal(sentUrl.searchParams.get('viewbox'), '50.3,36.35,53.2,34.85');
    assert.equal(sentUrl.searchParams.get('bounded'), '1');
    assert.equal(viaBox[0].accepted, true);
    assert.ok(!calls.some((url) => url.includes('viewbox') && url.includes('%D8%B4%DB%8C%D8%B1%D8%A7%D8%B2')), 'Shiraz lookup stayed unbounded');
    console.log('PASS  Tehran OSM lookups are bounded to the province box'); count++;

    globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    });
    geoConfig.timeoutMs = 30;
    await assert.rejects(() => lookupCandidates(tehran, [], { source: 'nominatim' }), /پاسخی از سرویس/);
    await assert.rejects(() => lookupCandidates(tehran, [], { source: 'neshan', key: 'demo-key' }), /پاسخی از سرویس/);
    geoConfig.timeoutMs = 60_000;
    const cancel = new AbortController();
    const pending = lookupCandidates(tehran, [], { source: 'nominatim', signal: cancel.signal });
    cancel.abort();
    await assert.rejects(() => pending, /^Error: ABORT$/);
    console.log('PASS  geocode timeout is explained; user cancel stays silent'); count++;

    // manifest فایل همراه: JSON معتبر پذیرفته، ۴۰۴/HTML/شبکهٔ قطع بی‌صدا نادیده گرفته می‌شود
    globalThis.fetch = async () => new Response(JSON.stringify(manifestFixture), { headers: { 'content-type': 'application/json' } });
    const bundledManifest = await fetchManifest();
    assert.ok(bundledManifest && /^[0-9a-f]{64}$/.test(bundledManifest.sha256));
    assert.equal(bundledManifest!.fileName, manifestFixture.fileName);
    globalThis.fetch = async () => new Response('not found', { status: 404 });
    assert.equal(await fetchManifest(), null);
    globalThis.fetch = async () => new Response('<html><body>gateway error</body></html>');
    assert.equal(await fetchManifest(), null, 'HTML error page is never parsed as a manifest');
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await fetchManifest(), null);
    console.log('PASS  bundled manifest fetch: valid JSON accepted, 404/HTML/offline silently ignored'); count++;
    geoConfig.timeoutMs = 12_000;
  } finally { globalThis.fetch = original; }
  console.log(`\n${count} regression checks passed`);
}
networkTests().catch((error) => { console.error(error); process.exitCode = 1; });
