import type { Center } from './parser';
import { norm, type Phone } from './text';

/**
 * دادهٔ نمونهٔ نمایشی (Demo)
 * ------------------------------------------------------------------
 * مخزن هیچ فایل اکسلی همراه ندارد، بنابراین بدون این مجموعه برنامه
 * همیشه با صفحهٔ «فایلی بارگذاری نشد» باز می‌شود و هیچ‌چیز برای دیدن
 * وجود ندارد. این داده‌ها فقط برای نمایش رابط کاربری ساخته شده‌اند:
 *   • شمارهٔ تلفن‌ها عمداً با الگوی ۰۰۰۰۰۰۰ ساخته شده‌اند (واقعی نیستند)
 *   • نام مراکز ترکیبی و ساختگی است
 * با بارگذاری فایل واقعی مراکز طرف قرارداد، این مجموعه کنار گذاشته می‌شود.
 */

const REGIONS: { province: string; city: string; code: string }[] = [
  { province: 'تهران', city: 'تهران', code: '021' },
  { province: 'تهران', city: 'کرج', code: '026' },
  { province: 'تهران', city: 'ورامین', code: '021' },
  { province: 'اصفهان', city: 'اصفهان', code: '031' },
  { province: 'اصفهان', city: 'کاشان', code: '031' },
  { province: 'فارس', city: 'شیراز', code: '071' },
  { province: 'فارس', city: 'جهرم', code: '071' },
  { province: 'خراسان رضوی', city: 'مشهد', code: '051' },
  { province: 'خراسان رضوی', city: 'نیشابور', code: '051' },
  { province: 'آذربایجان شرقی', city: 'تبریز', code: '041' },
  { province: 'آذربایجان غربی', city: 'ارومیه', code: '044' },
  { province: 'البرز', city: 'کرج', code: '026' },
  { province: 'گیلان', city: 'رشت', code: '013' },
  { province: 'مازندران', city: 'ساری', code: '011' },
  { province: 'مازندران', city: 'آمل', code: '011' },
  { province: 'کرمان', city: 'کرمان', code: '034' },
  { province: 'خوزستان', city: 'اهواز', code: '061' },
  { province: 'خوزستان', city: 'دزفول', code: '061' },
  { province: 'گلستان', city: 'گرگان', code: '017' },
  { province: 'هرمزگان', city: 'بندرعباس', code: '076' },
  { province: 'همدان', city: 'همدان', code: '081' },
  { province: 'کردستان', city: 'سنندج', code: '087' },
  { province: 'لرستان', city: 'خرم‌آباد', code: '066' },
  { province: 'کرمانشاه', city: 'کرمانشاه', code: '083' },
  { province: 'مرکزی', city: 'اراک', code: '086' },
  { province: 'قم', city: 'قم', code: '025' },
  { province: 'قزوین', city: 'قزوین', code: '028' },
  { province: 'زنجان', city: 'زنجان', code: '024' },
  { province: 'یزد', city: 'یزد', code: '035' },
  { province: 'اردبیل', city: 'اردبیل', code: '045' },
  { province: 'بوشهر', city: 'بوشهر', code: '077' },
  { province: 'سمنان', city: 'شاهرود', code: '023' },
  { province: 'سیستان و بلوچستان', city: 'زاهدان', code: '054' },
  { province: 'ایلام', city: 'ایلام', code: '084' },
  { province: 'چهارمحال و بختیاری', city: 'شهرکرد', code: '038' },
  { province: 'کهگیلویه و بویراحمد', city: 'یاسوج', code: '074' },
  { province: 'خراسان شمالی', city: 'بجنورد', code: '058' },
  { province: 'خراسان جنوبی', city: 'بیرجند', code: '056' },
];

interface Spec {
  category: string;
  kind: string;
  service: string;
  prefix: string[];
  streets: string[];
  discount: string;
}

const SPECS: Spec[] = [
  {
    category: 'بیمارستان',
    kind: 'بیمارستان عمومی و تخصصی',
    service: 'اورژانس، جراحی، داخلی',
    prefix: ['بیمارستان سینا', 'بیمارستان میلاد', 'بیمارستان فارابی', 'بیمارستان الزهرا', 'بیمارستان امام رضا', 'بیمارستان شهید بهشتی'],
    streets: ['خیابان آزادی، نبش کوچهٔ نرگس', 'بلوار کشاورز، روبروی پارک', 'خیابان شریعتی، بالاتر از میدان', 'خیابان انقلاب، پلاک ۱۲۰', 'بلوار پاسداران، کوچهٔ بهار'],
    discount: 'طبق تعرفهٔ بیمهٔ تکمیلی درمان',
  },
  {
    category: 'داروخانه',
    kind: 'داروخانهٔ شبانه‌روزی',
    service: 'دارو، ملزومات بهداشتی',
    prefix: ['داروخانهٔ دکتر احمدی', 'داروخانهٔ دکتر کریمی', 'داروخانهٔ مرکزی', 'داروخانهٔ دکتر موسوی', 'داروخانهٔ دکتر رستمی', 'داروخانهٔ دکتر نوری'],
    streets: ['خیابان طالقانی، جنب درمانگاه', 'خیابان امام خمینی، پلاک ۴۵', 'میدان شهرداری، ساختمان سپهر', 'خیابان سعدی، روبروی بانک'],
    discount: '۱۰٪ تخفیف اقلام غیربیمه‌ای',
  },
  {
    category: 'آزمایشگاه',
    kind: 'آزمایشگاه تشخیص طبی',
    service: 'بیوشیمی، هورمون، ژنتیک',
    prefix: ['آزمایشگاه پاستور', 'آزمایشگاه رازی', 'آزمایشگاه ابن‌سینا', 'آزمایشگاه بوعلی', 'آزمایشگاه دکتر حسینی'],
    streets: ['خیابان فردوسی، کوچهٔ گلستان', 'بلوار امیرکبیر، پلاک ۸', 'خیابان مولوی، ساختمان پزشکان', 'خیابان هفت تیر، طبقهٔ همکف'],
    discount: 'بدون فرانشیز برای آزمایش‌های پایه',
  },
  {
    category: 'تصویربرداری پزشکی',
    kind: 'رادیولوژی و سونوگرافی',
    service: 'ام‌آر‌آی، سی‌تی‌اسکن، ماموگرافی',
    prefix: ['مرکز تصویربرداری پارس', 'مرکز رادیولوژی نگار', 'مرکز سونوگرافی مهر', 'مرکز تصویربرداری آتیه'],
    streets: ['خیابان ولیعصر، برج نگین', 'بلوار شهید صدوقی، پلاک ۲۲', 'خیابان دانشگاه، نبش کوچهٔ مهر'],
    discount: '۱۵٪ تخفیف ام‌آر‌آی',
  },
  {
    category: 'دندانپزشکی',
    kind: 'کلینیک دندانپزشکی',
    service: 'ارتودنسی، ایمپلنت، ترمیم',
    prefix: ['کلینیک دندانپزشکی لبخند', 'مرکز دندانپزشکی سپید', 'کلینیک دندانپزشکی دکتر شریفی', 'مرکز تخصصی دندانپزشکی آرمان'],
    streets: ['خیابان مدرس، ساختمان دندان', 'بلوار گلستان، پلاک ۱۴', 'خیابان شهید باهنر، طبقهٔ دوم'],
    discount: '۲۰٪ تخفیف خدمات ترمیمی',
  },
  {
    category: 'فیزیوتراپی و توانبخشی',
    kind: 'مرکز فیزیوتراپی',
    service: 'فیزیوتراپی، کاردرمانی',
    prefix: ['مرکز فیزیوتراپی توان', 'مرکز توانبخشی امید', 'کلینیک فیزیوتراپی دکتر یوسفی', 'مرکز توانبخشی سلامت'],
    streets: ['خیابان کاشانی، نبش خیابان بهار', 'بلوار جانبازان، پلاک ۳۰', 'خیابان فلسطین، ساختمان سلامت'],
    discount: '۱۲ جلسه با تعهد بیمهٔ تکمیلی',
  },
  {
    category: 'کلینیک تخصصی',
    kind: 'کلینیک و درمانگاه',
    service: 'قلب، داخلی، اطفال',
    prefix: ['کلینیک تخصصی مهرگان', 'درمانگاه حضرت زهرا', 'کلینیک تخصصی سپاهان', 'پلی‌کلینیک شهر', 'درمانگاه بوعلی'],
    streets: ['خیابان جمهوری، روبروی بیمارستان', 'بلوار قائم، پلاک ۶۰', 'خیابان شهید رجایی، کوچهٔ یاس'],
    discount: 'ویزیت طبق تعرفهٔ دولتی',
  },
  {
    category: 'دیالیز',
    kind: 'مرکز دیالیز',
    service: 'همودیالیز، پیوند',
    prefix: ['مرکز دیالیز کوثر', 'مرکز دیالیز حضرت ابوالفضل', 'مرکز دیالیز نور'],
    streets: ['خیابان بیمارستان، جنب بخش کلیه', 'بلوار امام رضا، پلاک ۹'],
    discount: 'کاملاً تحت پوشش بیمهٔ تکمیلی',
  },
  {
    category: 'عینک و اپتیک',
    kind: 'بینایی‌سنجی و اپتومتری',
    service: 'بینایی‌سنجی، ساخت عینک',
    prefix: ['مرکز بینایی‌سنجی نور', 'اپتیک دیدبان', 'مرکز چشم‌پزشکی بصیر'],
    streets: ['خیابان چهارباغ، پاساژ نور', 'بلوار معلم، پلاک ۱۷'],
    discount: '۱۰٪ تخفیف فریم و شیشه',
  },
  {
    category: 'روان‌شناسی و مشاوره',
    kind: 'مرکز مشاوره',
    service: 'روان‌درمانی، مشاورهٔ خانواده',
    prefix: ['مرکز مشاورهٔ آرامش', 'کلینیک روان‌شناسی همیار', 'مرکز مشاورهٔ رها'],
    streets: ['خیابان شهید مطهری، ساختمان روان', 'بلوار ارم، پلاک ۱۱'],
    discount: 'هر جلسه ۵۰ دقیقه با تعرفهٔ توافقی',
  },
];

/** شماره‌های ساختگی با الگوی ۰۰۰۰۰۰۰ — عمداً غیرواقعی */
function fakePhone(code: string, n: number): Phone {
  const tail = String(1000 + (n % 8999));
  return { label: `${code}-000${tail}`, tel: `${code}000${tail}` };
}

function build(): Center[] {
  const list: Center[] = [];
  let n = 0;
  for (const region of REGIONS) {
    // هر شهر بین ۳ تا ۹ مرکز می‌گیرد تا توزیع طبیعی‌تری داشته باشیم
    const howMany = 3 + (n % 7);
    for (let k = 0; k < howMany; k++) {
      const spec = SPECS[(n + k * 3) % SPECS.length];
      const base = spec.prefix[(n * 7 + k * 5) % spec.prefix.length];
      const name = `${base} ${region.city}`;
      const street = spec.streets[(n + k) % spec.streets.length];
      const address = `${street}، ${region.city}، ${region.province}`;
      const phones: Phone[] = [fakePhone(region.code, n * 3 + k)];
      if ((n + k) % 3 === 0) phones.push(fakePhone(region.code, n * 5 + k + 4000));
      const desc = (n + k) % 5 === 0 ? 'پیش از مراجعه، هماهنگی تلفنی لازم است.' : '';
      n++;
      const search = norm(
        [name, spec.category, spec.kind, spec.service, region.province, region.city, address,
          phones.map((p) => p.tel).join(' '), spec.discount, desc].join(' '),
      );
      list.push({
        id: list.length,
        name,
        category: spec.category,
        sheet: 'دادهٔ نمونه',
        province: region.province,
        city: region.city,
        address,
        phones,
        kind: spec.kind,
        service: spec.service,
        discount: spec.discount,
        desc,
        extra: {},
        search,
        nameN: norm(name),
        locN: norm(`${region.province} ${region.city}`),
        catN: norm(`${spec.category} ${spec.kind} ${spec.service}`),
      });
    }
  }
  return list;
}

let cache: Center[] | null = null;

export function demoCenters(): Center[] {
  if (!cache) {
    cache = build();
    cache.forEach((c, i) => (c.id = i));
  }
  return cache;
}

export const DEMO_FILE_NAME = 'دادهٔ نمونهٔ نمایشی (Demo)';
