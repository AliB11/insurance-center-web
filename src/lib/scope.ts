import { clean, norm } from './text';

/**
 * دامنهٔ جغرافیایی داده
 * ------------------------------------------------------------------
 * فهرست مراکز طرف قرارداد این سامانه فقط مربوط به «استان تهران» است.
 *
 * بسیاری از خیابان‌ها و بزرگراه‌های تهران نام استان‌های دیگر را دارند
 * (بزرگراه کردستان، خیابان قزوین، بزرگراه خلیج فارس، خیابان زنجان،
 * شهرک گلستان، خیابان البرز، جادهٔ قدیم قم، خیابان همدان، دفتر «مرکزی» …).
 * نسخهٔ قبلی استان را از ابتدای آدرس حدس می‌زد و همین مراکز تهران را در
 * کردستان، قزوین، فارس و … ثبت می‌کرد. از این پس:
 *   • استان هرگز از متن آدرس حدس زده نمی‌شود؛
 *   • با دامنهٔ فعال، استان همهٔ مراکز «تهران» ثبت می‌شود و اگر فایل مقدار
 *     دیگری داشته باشد، در گزارش واردسازی اعلام می‌شود؛
 *   • شهر فقط وقتی از آدرس برداشته می‌شود که آدرس صریحاً با نام یکی از
 *     شهرهای همین استان شروع شود («شهریار، …»)؛ «خیابان شهریار» شهر نیست.
 *
 * برای فهرست سراسری، DATA_SCOPE را null کنید: استان فقط از ستون «استان»،
 * سطر عنوان «استان …» یا نام شیت خوانده می‌شود (باز هم نه از آدرس).
 */

export interface ScopeCity {
  name: string;
  aliases?: string[];
  /**
   * نام خیابان/میدان/محلهٔ شناخته‌شده‌ای در شهر تهران هم هست (خیابان دماوند،
   * خیابان قدس، میدان حسن‌آباد، …)؛ فقط با «شهر/شهرستان …» یا بعد از
   * «استان تهران،» به‌عنوان شهر پذیرفته می‌شود.
   */
  ambiguous?: boolean;
}

export interface DataScope {
  /** استان همهٔ مراکز */
  province: string;
  /** شهر مراکزی که فایل شهرشان را ندارد و آدرسشان با نام شهر دیگری از استان شروع نمی‌شود */
  defaultCity: string;
  /** پیش‌شمارهٔ تلفن ثابت؛ به شماره‌های ۸ رقمی افزوده می‌شود تا تماس از تلفن همراه برقرار شود */
  areaCode: string;
  cities: ScopeCity[];
  /** محدودهٔ تقریبی استان (WGS84) برای رد پاسخ‌های ژئوکد از شهرهای هم‌نام؛ مرز رسمی نیست */
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export const TEHRAN_SCOPE: DataScope = {
  province: 'تهران',
  defaultCity: 'تهران',
  areaCode: '021',
  box: { minLat: 34.85, maxLat: 36.35, minLng: 50.3, maxLng: 53.2 },
  cities: [
    { name: 'تهران' },
    { name: 'شهر ری', aliases: ['شهرری'] },
    { name: 'اسلامشهر', aliases: ['اسلام شهر'] },
    { name: 'شهریار' },
    { name: 'قدس', aliases: ['شهر قدس', 'شهرقدس'], ambiguous: true },
    { name: 'ملارد' },
    { name: 'صفادشت', aliases: ['صفا دشت'] },
    { name: 'رباط‌کریم', aliases: ['رباط کریم', 'رباطکریم'] },
    { name: 'پرند' },
    { name: 'نصیرشهر', aliases: ['نصیر شهر'] },
    { name: 'نسیم‌شهر', aliases: ['نسیم شهر', 'نسیمشهر'] },
    { name: 'صالحیه' },
    { name: 'گلستان', ambiguous: true },
    { name: 'اندیشه' },
    { name: 'باغستان' },
    { name: 'شاهدشهر', aliases: ['شاهد شهر'] },
    { name: 'صباشهر', aliases: ['صبا شهر'] },
    { name: 'فردوسیه' },
    { name: 'وحیدیه', ambiguous: true },
    { name: 'چهاردانگه', aliases: ['چهار دانگه'] },
    { name: 'احمدآباد مستوفی', aliases: ['احمد آباد مستوفی'] },
    { name: 'کهریزک' },
    { name: 'باقرشهر', aliases: ['باقر شهر'] },
    { name: 'حسن‌آباد', aliases: ['حسن آباد', 'حسن آباد فشافویه'], ambiguous: true },
    { name: 'قلعه‌نو', aliases: ['قلعه نو'], ambiguous: true },
    { name: 'ورامین' },
    { name: 'جوادآباد', aliases: ['جواد آباد'] },
    { name: 'پیشوا' },
    { name: 'قرچک' },
    { name: 'پاکدشت' },
    { name: 'شریف‌آباد', aliases: ['شریف آباد'], ambiguous: true },
    { name: 'فرون‌آباد', aliases: ['فرون آباد'] },
    { name: 'دماوند', ambiguous: true },
    { name: 'رودهن' },
    { name: 'آبسرد' },
    { name: 'کیلان' },
    { name: 'آبعلی' },
    { name: 'پردیس' },
    { name: 'بومهن' },
    { name: 'فیروزکوه' },
    { name: 'ارجمند', ambiguous: true },
    { name: 'لواسان' },
    { name: 'فشم' },
    { name: 'شمشک' },
  ],
};

/** دامنهٔ فعال برنامه: فهرست فعلی فقط استان تهران است. */
export const DATA_SCOPE: DataScope | null = TEHRAN_SCOPE;

export const scopeLabel = (scope: DataScope | null = DATA_SCOPE) => (scope ? `استان ${scope.province}` : '');

export function inScopeBox(p: { lat: number; lng: number }, scope: DataScope): boolean {
  const b = scope.box;
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/**
 * واژه‌هایی که نشان می‌دهند ادامهٔ متن نام معبر/مکان است، نه شهر یا استان.
 * (به‌صورت نرمال‌شده: «آ» → «ا»، نیم‌فاصله → فاصله)
 */
export const STREET_WORDS = [
  'خیابان', 'خ', 'بلوار', 'بلو', 'میدان', 'م', 'بزرگراه', 'اتوبان', 'ازادراه', 'جاده', 'کوچه', 'ک', 'کوی',
  'فاز', 'شهرک', 'بن بست', 'بنبست', 'چهارراه', 'چهار راه', 'سه راه', 'سهراه', 'پل', 'تقاطع', 'نبش', 'فلکه',
  'ابتدای', 'انتهای', 'ضلع', 'روبروی', 'روبرو', 'جنب', 'نرسیده', 'بعد', 'بالاتر', 'پایین تر', 'خلیج', 'محله',
  'منطقه', 'ناحیه', 'بازار', 'پاساژ', 'مجتمع', 'ساختمان', 'برج', 'پلاک', 'طبقه', 'واحد', 'بوستان', 'پارک',
  'ایستگاه', 'مترو', 'بیمارستان', 'درمانگاه', 'کلینیک', 'دفتر', 'شعبه', 'کیلومتر',
];

export function startsWithStreetWord(text: string): boolean {
  const t = text.replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  return STREET_WORDS.some((w) => t === w || t.startsWith(`${w} `));
}

interface CityKey { key: string; city: ScopeCity; explicit: boolean }
const keyCache = new WeakMap<DataScope, CityKey[]>();

function cityKeys(scope: DataScope): CityKey[] {
  const cached = keyCache.get(scope);
  if (cached) return cached;
  const keys: CityKey[] = [];
  for (const city of scope.cities) {
    const nameKey = norm(city.name);
    keys.push({ key: nameKey, city, explicit: false });
    for (const alias of city.aliases || []) {
      const key = norm(alias);
      // «شهر قدس»/«شهرقدس» خودشان نشانهٔ صریح شهرند؛ «شهریار» نه (خودِ نام با «شهر» شروع می‌شود)
      keys.push({ key, city, explicit: /^شهر/.test(key) && !/^شهر/.test(nameKey) });
    }
  }
  keys.sort((a, b) => b.key.length - a.key.length);
  keyCache.set(scope, keys);
  return keys;
}

function matchKey(text: string, keys: CityKey[]): { hit: CityKey; rest: string } | null {
  for (const hit of keys) {
    if (text === hit.key) return { hit, rest: '' };
    if (text.startsWith(`${hit.key} `)) return { hit, rest: text.slice(hit.key.length + 1).trim() };
  }
  return null;
}

/** شهرِ یک «بخش» از آدرس؛ فقط وقتی بخش با نام شهر شروع شود و ادامه‌اش نام معبر باشد. */
function citySegment(segment: string, keys: CityKey[], allowAmbiguous: boolean): ScopeCity | null {
  if (!segment || startsWithStreetWord(segment)) return null;
  const okRest = (rest: string) => rest === '' || startsWithStreetWord(rest);
  const direct = matchKey(segment, keys);
  if (direct && okRest(direct.rest) && (!direct.hit.city.ambiguous || direct.hit.explicit || allowAmbiguous)) {
    return direct.hit.city;
  }
  const marker = /^(?:شهرستان|شهر)\s+(.+)$/.exec(segment);
  if (marker) {
    const viaMarker = matchKey(marker[1], keys);
    // «شهر قدس»، «شهرستان دماوند»: نشانهٔ صریح، حتی نام‌های دوپهلو را می‌پذیرد
    if (viaMarker && okRest(viaMarker.rest)) return viaMarker.hit.city;
  }
  return null;
}

/**
 * تشخیص محافظه‌کارانهٔ شهر از ابتدای آدرس، فقط میان شهرهای استان دامنه.
 *   «شهریار، خیابان ولیعصر»          → شهریار
 *   «استان تهران، دماوند، …»          → دماوند (بافت استان، نام دوپهلو را روشن می‌کند)
 *   «تهران، اسلامشهر، …»              → اسلامشهر (جزئی‌تر)
 *   «خیابان شهریار، …»، «دماوند، …»   → '' (نام معبر یا دوپهلو؛ تصمیم با شهر پیش‌فرض)
 * خروجی خالی یعنی «نامشخص»؛ هرگز استان یا شهری خارج از دامنه برنمی‌گرداند.
 */
export function detectScopeCity(address: string, scope: DataScope | null = DATA_SCOPE): string {
  if (!scope || !address) return '';
  const keys = cityKeys(scope);
  const segments = address
    .replace(/[:：]/g, ' ')
    .split(/[،,؛;|/()\-–—]+/)
    .map((s) => norm(s).replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!segments.length) return '';

  let afterProvince = false;
  const provinceMatch = /^استان\s+(.+)$/.exec(segments[0]);
  if (provinceMatch) {
    const provinceKey = norm(scope.province);
    const rest = provinceMatch[1];
    if (rest !== provinceKey && !rest.startsWith(`${provinceKey} `)) return ''; // استان دیگری صریحاً آمده؛ شهری حدس نزن
    afterProvince = true;
    const tail = rest.slice(provinceKey.length).trim();
    if (tail) segments[0] = tail;
    else segments.shift();
    if (!segments.length) return '';
  }

  // «فاز ۲ پردیس، …»: فازبندی شهرهای جدید پیش از نام شهر
  const phase = /^فاز\s+\d+\s+(.+)$/.exec(segments[0]);
  if (phase && matchKey(phase[1], keys)?.rest === '') segments[0] = phase[1];

  const county = /^شهرستان\s/.test(segments[0]);
  const first = citySegment(segments[0], keys, afterProvince);
  if (!first && !county) return '';
  const second = segments[1] ? citySegment(segments[1], keys, county) : null;
  return (second && second !== first ? second : first)?.name ?? '';
}

/** نام (یکسان‌شده) یکی از شهرهای شناخته‌شدهٔ دامنه است؟ برای هشدار کیفیت داده در گزارش. */
export function isScopeCity(name: string, scope: DataScope | null = DATA_SCOPE): boolean {
  if (!scope || !name) return true;
  return name === scope.defaultCity || scope.cities.some((c) => c.name === name);
}

/** یکسان‌سازی املای شهر در ستون صریح «شهر» («اسلام شهر» → «اسلامشهر»، «شهرری» → «شهر ری»). */
export function canonicalCity(value: string, scope: DataScope | null = DATA_SCOPE): string {
  const cleaned = clean(value);
  if (!scope || !cleaned) return cleaned;
  const keys = cityKeys(scope);
  const n = norm(cleaned).replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  const direct = matchKey(n, keys);
  if (direct && direct.rest === '') return direct.hit.city.name;
  const marker = /^(?:شهرستان|شهر)\s+(.+)$/.exec(n);
  const viaMarker = marker ? matchKey(marker[1], keys) : null;
  if (viaMarker && viaMarker.rest === '') return viaMarker.hit.city.name;
  return cleaned;
}

/**
 * شهرهای دامنه که در متن آمده‌اند (با مرز واژه، شامل نام‌های مستعار).
 * برای سنجش پاسخ ژئوکد لازم است: «تهران، ورامین» دو شهر است و نباید با
 * «تهران» به‌عنوان شهر مرکز تطبیق داده شود (استان در ابتدای برچسب همهٔ پاسخ‌ها هست).
 */
export function citiesInScope(text: string, scope: DataScope | null = DATA_SCOPE): string[] {
  if (!scope || !text) return [];
  const keys = cityKeys(scope);
  const padded = ` ${norm(text).replace(/[.،,؛;|/()\-–—:：]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const found: { name: string; index: number; len: number }[] = [];
  for (const k of keys) {
    const at = padded.indexOf(` ${k.key} `);
    if (at < 0) continue;
    found.push({ name: k.city.name, index: at, len: k.key.length });
  }
  found.sort((a, b) => a.index - b.index || b.len - a.len);
  return [...new Set(found.map((f) => f.name))];
}
