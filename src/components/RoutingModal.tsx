import { useEffect, useRef, useState } from 'react';
import type { Center } from '../lib/parser';
import {
  coordinateSanity, destinationText, formatCoord, googleUrl, neshanUrl,
  parseCoordinates, validCoordinates, wazeUrl, distanceKm, type Coordinates, type NeshanVehicle,
} from '../lib/routing';
import {
  loadNeshanKey, saveNeshanKey, lookupCandidates, type GeoCandidate, type GeoSource,
} from '../lib/geocode';
import { toFa } from '../lib/text';
import { Modal, ModalHeader } from './Modal';
import { Icon, Spinner } from './ui';

interface Props {
  c: Center;
  demo?: boolean;
  /** Other centers — their verified points anchor the geocode consistency check. */
  peers?: { city: string; coordinates?: Coordinates }[];
  onClose: () => void;
  onCopy: (text: string) => void;
}

export function RoutingModal({ c, demo, peers = [], onClose, onCopy }: Props) {
  const initial = validCoordinates(c.coordinates) ? c.coordinates : undefined;
  const [lat, setLat] = useState(initial ? String(formatCoord(initial.lat)) : '');
  const [lng, setLng] = useState(initial ? String(formatCoord(initial.lng)) : '');
  const [manual, setManual] = useState<Coordinates>();
  const [origin, setOrigin] = useState<Coordinates>();
  const [vehicle, setVehicle] = useState<NeshanVehicle>('d');
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [keyInput, setKeyInput] = useState(() => loadNeshanKey());
  const [keySaved, setKeySaved] = useState(() => !!loadNeshanKey());
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [geoError, setGeoError] = useState('');
  const [candidates, setCandidates] = useState<GeoCandidate[]>([]);
  const [appliedFrom, setAppliedFrom] = useState<'' | 'manual' | 'search'>('');
  const alive = useRef(true);
  const geoAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; geoAbort.current?.abort(); };
  }, []);

  const point = manual ?? initial;
  const sanity = point ? coordinateSanity(point) : null;
  const showFinder = !point || (sanity?.state !== 'ok' && !manual);
  const neshanLink = point ? neshanUrl(point, { origin, vehicle }) : '';
  const linkClass = 'flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ink-800 transition hover:border-ink-400 hover:bg-ink-50';

  const locate = () => {
    setError('');
    if (!navigator.geolocation) { setError('مکان‌یابی در این مرورگر در دسترس نیست؛ مقصد را باز کنید و مبدأ را در مسیریاب انتخاب کنید.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!alive.current) return;
      const position = { lat: coords.latitude, lng: coords.longitude };
      if (validCoordinates(position)) setOrigin(position);
      else setError('موقعیت دریافتی معتبر نیست؛ مقصد را باز کنید و مبدأ را در مسیریاب انتخاب کنید.');
      setLocating(false);
    }, () => {
      if (!alive.current) return;
      setError('دسترسی به موقعیت ممکن نشد. می‌توانید مقصد را باز کرده و مبدأ را در نشان انتخاب کنید.');
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };

  const applyPoint = (p: Coordinates, from: 'manual' | 'search') => {
    setManual(p);
    setAppliedFrom(from);
    setLat(String(formatCoord(p.lat)));
    setLng(String(formatCoord(p.lng)));
    setError('');
  };

  const runLookup = async (source: GeoSource) => {
    setGeoError(''); setCandidates([]); setGeoState('loading');
    geoAbort.current?.abort();
    const controller = new AbortController();
    geoAbort.current = controller;
    try {
      const found = await lookupCandidates(
        { name: c.name, province: c.province, city: c.city, address: c.address },
        peers,
        { source, key: keyInput.trim() || loadNeshanKey() },
      );
      if (!alive.current) return;
      setCandidates(found);
      setGeoState('done');
    } catch (e) {
      if (!alive.current || (e as Error).message === 'ABORT') return;
      setGeoError((e as Error).message || 'جستجو ناموفق بود.');
      setGeoState('idle');
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="routing-title" maxWidth="max-w-xl" sheet>
      <ModalHeader id="routing-title" title="انتخاب مسیریاب" subtitle={c.name} onClose={onClose} />
      <div className="space-y-4 overflow-y-auto p-5">
        <p className="break-words rounded-xl bg-slate-50 p-3 text-sm leading-7 text-slate-600">{destinationText(c)}</p>
        {demo && <p role="note" className="rounded-xl bg-gold-50 p-3 text-sm text-gold-700">این مرکز نمونهٔ نمایشی است؛ آدرس آن برای مراجعه تأیید نشده و مختصاتش تقریبی (نزدیک مرکز شهر) است.</p>}

        {point && sanity && sanity.state !== 'ok' && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-7 text-rose-800">
            <p className="flex items-start gap-2">
              <Icon name="alert" className="mt-1 h-4 w-4 shrink-0" />
              <span>{sanity.hint}. پیش از اعتماد به لینک‌ها، آدرس را با نقشه تطبیق دهید.</span>
            </p>
            {sanity.swapped && (
              <button onClick={() => applyPoint(sanity.swapped!, 'manual')} className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700">
                اصلاح پیشنهادی: جابه‌جایی عرض و طول
              </button>
            )}
          </div>
        )}

        {point && (
          <>
            <p className="text-xs leading-6 text-slate-500">
              مختصات {appliedFrom === 'search' ? 'تأییدشده از جستجوی آدرس' : manual ? 'واردشده توسط شما' : 'فایل مرکز'}:{' '}
              <bdi dir="ltr">{formatCoord(point.lat)}, {formatCoord(point.lng)}</bdi>
              {origin ? ` — فاصلهٔ مبدأ تا مقصد حدوداً ${toFa(Math.round(distanceKm(origin, point)))} کیلومتر (خط مستقیم)` : ''}
              {' '}— پیش از شروع مسیر، محل نشان‌داده‌شده را بررسی کنید.
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <label htmlFor="routing-vehicle" className="font-medium">وسیلهٔ نقلیه در لینک مسیر نشان:</label>
              <select
                id="routing-vehicle"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value === 'm' ? 'm' : 'd')}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="d">خودرو</option>
                <option value="m">موتوسیکلت</option>
              </select>
            </div>
            <div className="space-y-2">
              <a className={linkClass} href={neshanLink} target="_blank" rel="noopener noreferrer">
                {origin ? 'مسیریابی با نشان از موقعیت من' : 'نمایش مقصد در نشان (وب / اندروید)'}
                <Icon name="pin" />
              </a>
              <a className={linkClass} href={neshanUrl(point, { origin, vehicle, ios: true })} target="_blank" rel="noopener noreferrer">
                باز کردن در نشان آیفون (نیاز به نصب برنامه)
                <Icon name="pin" />
              </a>
              <a className={linkClass} href={wazeUrl(point)} target="_blank" rel="noopener noreferrer">مسیریابی با Waze<Icon name="pin" /></a>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={locate} disabled={locating} className="rounded-xl bg-ink-800 px-4 py-2.5 text-sm text-white transition hover:bg-ink-900 disabled:opacity-50">
                {locating ? 'در حال دریافت موقعیت…' : origin ? 'به‌روزرسانی موقعیت مبدأ' : 'استفاده از موقعیت من برای مبدأ نشان'}
              </button>
              {origin && <button onClick={() => setOrigin(undefined)} className="rounded-xl border border-slate-200 px-3 text-sm text-slate-600 transition hover:bg-slate-50">حذف مبدأ من</button>}
              <button onClick={() => onCopy(neshanLink)} className="rounded-xl border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50">کپی لینک نشان (برای ارسال به گوشی)</button>
            </div>
            <p className="text-xs leading-6 text-slate-500">موقعیت فقط با اجازهٔ شما دریافت می‌شود، ذخیره نمی‌شود و هنگام باز کردن لینک مسیر برای نشان ارسال می‌شود. بدون مبدأ، مقصد باز می‌شود و شروع مسیر را در نشان انتخاب می‌کنید. اگر پشت رایانه‌اید، لینک نشان را کپی و در گوشی باز کنید.</p>
          </>
        )}

        {!point && (
          <p className="rounded-xl border border-gold-200 bg-gold-50 p-3 text-sm leading-7 text-gold-700">
            این مرکز مختصات ندارد؛ برای لینک نشان و Waze به نقطهٔ دقیق نیاز است. آدرس را کپی و در برنامهٔ دلخواه جستجو کنید،
            نقطه را دستی وارد کنید، یا از «جستجوی آدرس» پایین همین پنجره استفاده کنید — تا شما تأیید نکنید، هیچ نقطه‌ای به لینک‌ها اضافه نمی‌شود.
          </p>
        )}

        {showFinder && (
          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
              <Icon name="target" className="h-4 w-4 text-ink-500" />
              تبدیل آدرس به مختصات (با تأیید خودتان)
            </h3>
            <p className="mt-1 text-xs leading-6 text-slate-500">
              جستجو فقط با کلیک روی دکمه‌های زیر انجام می‌شود. پاسخ‌ها باید با استان/شهر مرکز بخوانند و در صورت وجود،
              به سایر مراکز هم‌شهر نزدیک باشند؛ نتیجهٔ بیرونی یا دور، رد می‌شود. انتخاب نهایی با شماست.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex-1 min-w-[14rem] text-xs text-slate-500">
                کلید وب‌سرویس نشان (اختیاری)
                <input
                  dir="ltr"
                  type="password"
                  inputMode="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Api-Key از پنل platform.neshan.org"
                  aria-label="کلید وب‌سرویس نشان"
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
                />
              </label>
              <div className="flex flex-col gap-1.5 text-xs">
                <button
                  onClick={() => { const ok = saveNeshanKey(keyInput); setKeySaved(ok && !!keyInput.trim()); setError(ok ? '' : 'ذخیرهٔ کلید در این مرورگر ممکن نشد.'); }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-slate-700 transition hover:bg-slate-50"
                >ذخیرهٔ کلید در این مرورگر</button>
                <button
                  onClick={() => { saveNeshanKey(''); setKeyInput(''); setKeySaved(false); }}
                  className="rounded-lg px-2.5 py-1 text-slate-500 underline decoration-dotted transition hover:text-ink-900"
                >پاک کردن کلید</button>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-400">
              کلید فقط در حافظهٔ همین مرورگر می‌ماند و مستقیم به api.neshan.org ارسال می‌شود؛ برای دادهٔ حساس، کلید دامنه‌قفل و سهمیه‌کم انتخاب کنید
              {keySaved ? ' — کلید ذخیره‌شده است.' : '.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => runLookup('neshan')} disabled={geoState === 'loading' || !(keyInput.trim() || keySaved)} className="rounded-xl bg-ink-800 px-4 py-2 text-sm text-white transition hover:bg-ink-900 disabled:opacity-40">
                جستجو با سرویس نشان
              </button>
              <button onClick={() => runLookup('nominatim')} disabled={geoState === 'loading'} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-slate-50 disabled:opacity-40">
                جستجو با نقشهٔ آزاد OSM (بدون کلید)
              </button>
              {geoState === 'loading' && <span className="flex items-center gap-2 text-xs text-slate-500"><Spinner className="h-4 w-4" />در حال جستجو…</span>}
            </div>
            {geoError && <p role="alert" className="mt-2 text-sm text-rose-700">{geoError}</p>}
            {geoState === 'done' && candidates.length === 0 && !geoError && (
              <p className="mt-2 text-sm text-slate-500">نتیجه‌ای برنگشت؛ آدرس را کامل‌تر کنید یا نام مرکز را در جستجوی متنی سرویس امتحان کنید.</p>
            )}
            {candidates.length > 0 && (
              <ul className="mt-3 space-y-2">
                {candidates.map((cand, i) => (
                  <li key={i} className={`rounded-xl border p-3 text-sm ${cand.accepted ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50 opacity-80'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-medium text-ink-900">{cand.label}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          <bdi dir="ltr">{formatCoord(cand.point.lat)}, {formatCoord(cand.point.lng)}</bdi>
                          {cand.source === 'neshan' ? ' — منبع: نشان' : ' — منبع: OSM'}
                          {cand.nearPeerKm !== undefined ? ` — فاصله از نزدیک‌ترین مرکز هم‌شهر: حدوداً ${toFa(Math.round(cand.nearPeerKm))} کیلومتر` : ''}
                        </p>
                        {cand.unmatched && <p className="mt-1 text-xs text-amber-700">بخشی از آدرس تطبیق داده نشد: «{cand.unmatched}»</p>}
                        {cand.reason && <p className={`mt-1 text-xs ${cand.accepted ? 'text-amber-700' : 'text-rose-700'}`}>{cand.reason}</p>}
                      </div>
                      {cand.accepted && (
                        <button onClick={() => applyPoint(cand.point, 'search')} className="shrink-0 rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-900">
                          تأیید و استفاده از این نقطه
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <a className={linkClass} href={googleUrl(c, point, origin)} target="_blank" rel="noopener noreferrer">
          {point ? (origin ? 'مسیریابی در Google Maps از موقعیت من' : 'نمایش مقصد در Google Maps') : 'جستجوی نام و آدرس در Google Maps'}
          <Icon name="link" />
        </a>
        <button onClick={() => onCopy(destinationText(c))} className={linkClass + ' w-full'}>کپی نام و آدرس برای نشان، بلد و سایر برنامه‌ها<Icon name="copy" /></button>

        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-700">ورود دستی مختصات دقیق مقصد</summary>
          <form className="mt-3 space-y-3" onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseCoordinates(lat, lng);
            if (!parsed) { setError('عرض باید بین ۹۰− و ۹۰ و طول بین ۱۸۰− و ۱۸۰ باشد؛ هر دو مقدار لازم است.'); return; }
            if (!validCoordinates(c.coordinates) || parsed.lat !== c.coordinates.lat || parsed.lng !== c.coordinates.lng) applyPoint(parsed, 'manual');
            else { setError('این همان مختصات فایل است.'); }
          }}>
            <p className="text-xs leading-6 text-slate-500">
              ارقام فارسی، ممیز «٫» و حتی قالب درجه/دقیقه/ثانیه (۳۵°۴۲′۳۰″) پذیرفته می‌شود.
              مقادیر در مرورگر ذخیره نمی‌شوند؛ برای ماندگاری، ستون‌های latitude/longitude اکسل را تکمیل کنید.
            </p>
            <label className="block text-sm">عرض جغرافیایی (latitude)<input aria-label="عرض جغرافیایی" dir="ltr" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="35.7000" className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
            <label className="block text-sm">طول جغرافیایی (longitude)<input aria-label="طول جغرافیایی" dir="ltr" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="51.4000" className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
            <div className="flex gap-2">
              <button className="rounded-lg bg-ink-800 px-4 py-2 text-sm text-white transition hover:bg-ink-900">تأیید مختصات مقصد</button>
              {manual && <button type="button" onClick={() => { setManual(undefined); setAppliedFrom(''); setLat(initial ? String(formatCoord(initial.lat)) : ''); setLng(initial ? String(formatCoord(initial.lng)) : ''); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50">حذف مختصات {initial ? 'و بازگشت به مختصات فایل' : 'دستی'}</button>}
            </div>
          </form>
        </details>
        {error && <p role="alert" className="text-sm leading-7 text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}
