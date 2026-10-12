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
import { validStoredData, loadList, type StoredData } from '../src/lib/storage';
import { detectProvince, exactProvince, explicitProvince } from '../src/lib/geo';
import { canonicalCity, detectScopeCity, TEHRAN_SCOPE } from '../src/lib/scope';
import { DATA_SCHEMA, migrateStored } from '../src/lib/migrate';
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
  const far = vetHits([{ lat: 35.7, lng: 51.9, label: 'تهران، ورامین', city: 'تهران', province: 'تهران' }], tehran, peers, 'neshan');
  assert.equal(far[0].accepted, true);
  assert.match(far[0].reason ?? '', /نسبتاً دور/);
  const cityMiss = vetHits([{ lat: 35.7, lng: 51.39, label: 'البرز، کرج، کمیل', city: 'کرج', province: 'البرز' }], tehran, [], 'nominatim');
  assert.equal(cityMiss[0].accepted, false);
  assert.match(cityMiss[0].reason ?? '', /شهر/);
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
    geoConfig.timeoutMs = 12_000;
  } finally { globalThis.fetch = original; }
  console.log(`\n${count} regression checks passed`);
}
networkTests().catch((error) => { console.error(error); process.exitCode = 1; });
