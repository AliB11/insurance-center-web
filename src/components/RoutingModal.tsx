import { useEffect, useRef, useState } from 'react';
import type { Center } from '../lib/parser';
import { destinationText, googleUrl, neshanUrl, parseCoordinates, validCoordinates, wazeUrl, type Coordinates } from '../lib/routing';
import { Modal, ModalHeader } from './Modal';
import { Icon } from './ui';

interface Props { c: Center; demo?: boolean; onClose: () => void; onCopy: (text: string) => void }

export function RoutingModal({ c, demo, onClose, onCopy }: Props) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [manual, setManual] = useState<Coordinates>();
  const [origin, setOrigin] = useState<Coordinates>();
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const point = manual ?? (validCoordinates(c.coordinates) ? c.coordinates : undefined);
  const linkClass = 'flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ink-800 transition hover:border-ink-400 hover:bg-ink-50';

  const locate = () => {
    setError('');
    if (!navigator.geolocation) { setError('مکان‌یابی در این مرورگر در دسترس نیست؛ نقطهٔ مقصد را باز کنید.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!alive.current) return;
      const position = { lat: coords.latitude, lng: coords.longitude };
      if (validCoordinates(position)) setOrigin(position);
      else setError('موقعیت دریافتی معتبر نیست؛ نقطهٔ مقصد را باز کنید.');
      setLocating(false);
    }, () => {
      if (!alive.current) return;
      setError('دسترسی به موقعیت ممکن نشد. می‌توانید مقصد را باز کرده و مبدأ را در مسیریاب انتخاب کنید.');
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };

  return (
    <Modal onClose={onClose} labelledBy="routing-title" maxWidth="max-w-xl" sheet>
      <ModalHeader id="routing-title" title="انتخاب مسیریاب" subtitle={c.name} onClose={onClose} />
      <div className="space-y-4 overflow-y-auto p-5">
        <p className="break-words rounded-xl bg-slate-50 p-3 text-sm leading-7 text-slate-600">{destinationText(c)}</p>
        {demo && <p role="note" className="rounded-xl bg-gold-50 p-3 text-sm text-gold-700">این مرکز نمونهٔ نمایشی است؛ آدرس آن برای مراجعه تأیید نشده است.</p>}
        {point ? (
          <>
            <p className="text-xs leading-6 text-slate-500">مختصات {manual ? 'واردشده توسط شما' : 'فایل مرکز'}: <bdi dir="ltr">{point.lat}, {point.lng}</bdi> — پیش از شروع مسیر، محل نشان‌داده‌شده را بررسی کنید.</p>
            <div className="space-y-2">
              <a className={linkClass} href={neshanUrl(point, origin)} target="_blank" rel="noopener noreferrer">{origin ? 'مسیریابی با نشان از موقعیت من' : 'نمایش مقصد در نشان (وب / اندروید)'}<Icon name="pin" /></a>
              <a className={linkClass} href={neshanUrl(point, origin, true)}>باز کردن در نشان آیفون (نیاز به نصب)<Icon name="pin" /></a>
              <a className={linkClass} href={wazeUrl(point)} target="_blank" rel="noopener noreferrer">مسیریابی با Waze<Icon name="pin" /></a>
            </div>
            <button onClick={locate} disabled={locating} className="rounded-xl bg-ink-800 px-4 py-2.5 text-sm text-white disabled:opacity-50">{locating ? 'در حال دریافت موقعیت…' : 'استفاده از موقعیت من برای مبدأ نشان'}</button>
            {origin && <button onClick={() => setOrigin(undefined)} className="mr-3 text-sm text-slate-600 underline">حذف مبدأ من</button>}
            <p className="text-xs leading-6 text-slate-500">موقعیت فقط با اجازهٔ شما دریافت می‌شود، ذخیره نمی‌شود و هنگام باز کردن لینک مسیر برای نشان ارسال می‌شود. بدون مبدأ، مقصد باز می‌شود و شروع مسیر را در نشان انتخاب می‌کنید.</p>
          </>
        ) : (
          <p className="rounded-xl border border-gold-200 bg-gold-50 p-3 text-sm leading-7 text-gold-700">این مرکز مختصات ندارد. برای نشان و Waze باید نقطهٔ دقیق مقصد مشخص باشد. آدرس را کپی و در برنامهٔ دلخواه جستجو کنید، یا از جستجوی گوگل استفاده کنید؛ هیچ مختصات حدسی ارسال نمی‌شود.</p>
        )}
        <a className={linkClass} href={googleUrl(c, point)} target="_blank" rel="noopener noreferrer">{point ? 'نمایش مقصد در Google Maps' : 'جستجوی نام و آدرس در Google Maps'}<Icon name="link" /></a>
        <button onClick={() => onCopy(destinationText(c))} className={linkClass + ' w-full'}>کپی نام و آدرس برای نشان، بلد و سایر برنامه‌ها<Icon name="copy" /></button>
        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-700">ورود دستی مختصات دقیق مقصد</summary>
          <form className="mt-3 space-y-3" onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseCoordinates(lat, lng);
            if (!parsed) { setError('عرض باید بین ۹۰− و ۹۰ و طول بین ۱۸۰− و ۱۸۰ باشد؛ هر دو مقدار لازم است.'); return; }
            setManual(parsed); setError('');
          }}>
            <p className="text-xs leading-6 text-slate-500">فقط مختصات معتبر همان مرکز را وارد کنید؛ مقادیر در مرورگر ذخیره نمی‌شوند. در اکسل نیز ستون‌های latitude و longitude یا «عرض جغرافیایی» و «طول جغرافیایی» قابل استفاده‌اند.</p>
            <label className="block text-sm">عرض جغرافیایی (latitude)<input aria-label="عرض جغرافیایی" dir="ltr" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="35.7000" className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
            <label className="block text-sm">طول جغرافیایی (longitude)<input aria-label="طول جغرافیایی" dir="ltr" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="51.4000" className="mt-1 w-full rounded-lg border border-slate-300 p-2" /></label>
            <button className="rounded-lg bg-ink-800 px-4 py-2 text-sm text-white">تأیید مختصات مقصد</button>
            {manual && <button type="button" onClick={() => { setManual(undefined); setLat(''); setLng(''); }} className="mr-3 text-sm underline">حذف مختصات دستی</button>}
          </form>
        </details>
        {error && <p role="alert" className="text-sm leading-7 text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}
