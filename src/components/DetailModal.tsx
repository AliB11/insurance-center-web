import type { Center } from '../lib/parser';
import { categoryEmoji } from '../lib/search';
import { toFa } from '../lib/text';
import { Icon, mapsUrl } from './ui';

interface Props {
  c: Center;
  fav: boolean;
  onFav: (id: number) => void;
  onClose: () => void;
  onCopy: (t: string) => void;
}

export function DetailModal({ c, fav, onFav, onClose, onCopy }: Props) {
  const rows: [string, string][] = [
    ['دسته', c.category],
    ['نوع مرکز', c.kind],
    ['تخصص / خدمات', c.service],
    ['استان', c.province],
    ['شهر', c.city],
    ['آدرس', c.address],
    ['تخفیف / شرایط قرارداد', c.discount],
    ['توضیحات', c.desc],
    ...Object.entries(c.extra),
  ];
  const text = [c.name, [c.province, c.city].filter(Boolean).join('، '), c.address, c.phones.map((p) => p.label).join(' / ')]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div className="relative bg-gradient-to-l from-blue-950 to-blue-800 p-6 text-white">
          <button onClick={onClose} className="absolute left-4 top-4 rounded-full bg-white/10 p-1.5 hover:bg-white/20">
            <Icon name="x" className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-3xl">{categoryEmoji(c.category + c.kind)}</div>
            <div>
              <p className="text-xs text-blue-200">{c.category}</p>
              <h2 className="text-xl font-bold leading-8">{c.name}</h2>
            </div>
          </div>
        </div>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto p-6">
          {c.phones.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {c.phones.map((p, i) => (
                <a key={i} href={`tel:${p.tel}`} dir="ltr" className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                  <Icon name="phone" className="h-4 w-4" /> {toFa(p.label)}
                </a>
              ))}
            </div>
          )}
          <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
            {rows.filter(([, v]) => v).map(([k, v], i) => (
              <div key={i} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
                <dt className="text-slate-500">{k}</dt>
                <dd className="col-span-2 leading-7 text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-400">منبع: شیت «{c.sheet}» فایل مراکز طرف قرارداد</p>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 p-4">
          <a href={mapsUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-4 py-2 text-sm font-medium text-white hover:bg-blue-900">
            <Icon name="pin" className="h-4 w-4" /> مسیریابی روی نقشه
          </a>
          <button onClick={() => onCopy(text)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            <Icon name="copy" className="h-4 w-4" /> کپی اطلاعات
          </button>
          <button onClick={() => onFav(c.id)} className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium ${fav ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}>
            <Icon name="star" className="h-4 w-4" fill={fav} /> {fav ? 'در علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی'}
          </button>
        </div>
      </div>
    </div>
  );
}
