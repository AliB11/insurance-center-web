import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/lib/parser';
import {
  parseCoordinates, neshanUrl, googleUrl, wazeUrl, validCoordinates,
  coordinateSanity, formatCoord, distanceKm, type Destination,
} from '../src/lib/routing';
import {
  parseNeshanGeocode, parseNominatimHits, vetHits, neshanAddressQuery, neshanErrorMessage, lookupCandidates,
} from '../src/lib/geocode';
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
  ['کلینیک ج', 'تهران', 'تهران', 'خیابان ولیعصر', '02198765432', '51.4', '35.7', 'کلینیک', ''],
]);
const parsed = parseWorkbook(bytes);
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
  } finally { globalThis.fetch = original; }
  console.log(`\n${count} regression checks passed`);
}
networkTests().catch((error) => { console.error(error); process.exitCode = 1; });
