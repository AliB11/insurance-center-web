import type { Center } from '../lib/parser';
import { categoryEmoji } from '../lib/search';
import { catTheme } from '../lib/theme';
import { toFa } from '../lib/text';
import { Modal } from './Modal';
import { Icon } from './ui';

interface Props {
  c: Center;
  fav: boolean;
  onFav: (id: number) => void;
  onClose: () => void;
  onRoute: () => void;
  onCopy: (t: string) => void;
}

export function DetailModal({ c, fav, onFav, onClose, onCopy, onRoute }: Props) {
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
  const visible = rows.filter(([k, v]) => v && !(k === 'نوع مرکز' && v === c.category));
  const text = [c.name, [c.province, c.city].filter(Boolean).join('، '), c.address, c.phones.map((p) => p.label).join(' / ')]
    .filter(Boolean)
    .join('\n');
  const theme = catTheme(c.category, c.kind);

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl" sheet labelledBy="detail-title">
      <div className="relative overflow-hidden bg-ink-900 p-6 text-white">
        <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-ink-400/30 blur-3xl" />
        <button
          onClick={onClose}
          aria-label="بستن"
          className="absolute left-4 top-4 z-10 rounded-full bg-white/10 p-2 transition hover:bg-white/20"
        >
          <Icon name="x" className="h-5 w-5" />
        </button>
        <div className="relative flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-3xl ring-1 ring-white/20 ${theme.tile}`}>
            {categoryEmoji(c.category + ' ' + c.kind)}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-ink-200">{c.category}</p>
            <h2 id="detail-title" className="mt-1 text-lg font-bold leading-8 sm:text-xl">
              {c.name}
            </h2>
            {(c.province || c.city) && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-200">
                <Icon name="pin" className="h-3.5 w-3.5 text-gold-300" />
                {[c.province, c.city].filter(Boolean).join('، ')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-h-[55vh] space-y-4 overflow-y-auto p-5 sm:p-6">
        {c.phones.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {c.phones.map((p, i) => (
              <a
                key={i}
                href={`tel:${p.tel}`}
                dir="ltr"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold tabular-nums text-emerald-800 transition hover:bg-emerald-100"
              >
                <Icon name="phone" className="h-4 w-4" /> {toFa(p.label)}
              </a>
            ))}
          </div>
        )}

        {c.discount && (
          <p className="flex items-start gap-2 rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-700">
            <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{c.discount}</span>
          </p>
        )}

        {visible.length > 0 && (
          <dl className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
            {visible.map(([k, v], i) => (
              <div key={i} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm odd:bg-slate-50/50">
                <dt className="text-slate-500">{k}</dt>
                <dd className="col-span-2 leading-7 text-ink-900">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className="text-xs text-slate-400">منبع: شیت «{c.sheet}» فایل مراکز طرف قرارداد</p>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 p-4">
        <button
          onClick={onRoute}
          className="inline-flex items-center gap-2 rounded-xl bg-ink-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-900"
        >
          <Icon name="pin" className="h-4 w-4" /> انتخاب مسیریاب
        </button>
        <button
          onClick={() => onCopy(text)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          <Icon name="copy" className="h-4 w-4" /> کپی اطلاعات
        </button>
        <button
          onClick={() => onFav(c.id)}
          aria-pressed={fav}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
            fav ? 'border-gold-300 bg-gold-50 text-gold-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Icon name="star" className="h-4 w-4" fill={fav} /> {fav ? 'در علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی'}
        </button>
      </div>
    </Modal>
  );
}
