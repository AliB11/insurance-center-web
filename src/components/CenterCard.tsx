import type { Center } from '../lib/parser';
import { categoryEmoji } from '../lib/search';
import { catTheme } from '../lib/theme';
import { toFa } from '../lib/text';
import { Highlight, Icon, mapsUrl } from './ui';

interface Props {
  c: Center;
  tokens: string[];
  fav: boolean;
  index?: number;
  demo?: boolean;
  onFav: (id: number) => void;
  onOpen: (c: Center) => void;
  onCopy: (text: string) => void;
}

export function CenterCard({ c, tokens, fav, index = 0, demo = false, onFav, onOpen, onCopy }: Props) {
  const loc = [c.province, c.city].filter(Boolean).join('، ');
  const theme = catTheme(c.category, c.kind);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <article
      onClick={() => onOpen(c)}
      style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
      className="group print-plain relative flex animate-rise cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-300/40"
    >
      {/* نوار رنگی دسته */}
      <span className={`absolute inset-y-0 right-0 w-1 ${theme.bar} transition-all group-hover:w-1.5`} aria-hidden="true" />

      <div className="flex items-start gap-3 p-4 pr-5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-2xl ring-1 ring-white ${theme.tile}`}
        >
          {categoryEmoji(c.category + ' ' + c.kind)}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold leading-6 text-ink-900 transition group-hover:text-ink-600">
            <Highlight text={c.name} tokens={tokens} />
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${theme.chip}`}>{c.category}</span>
            {c.kind && c.kind !== c.category && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">{c.kind}</span>
            )}
            {c.discount && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2.5 py-0.5 text-[11px] font-semibold text-gold-700">
                <Icon name="sparkles" className="h-3 w-3" />
                {c.discount}
              </span>
            )}
            {demo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">نمونه</span>}
          </div>
        </div>

        <button
          onClick={(e) => { stop(e); onFav(c.id); }}
          aria-label={fav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
          aria-pressed={fav}
          className={`-m-1 rounded-full p-2 transition ${fav ? 'text-gold-400' : 'text-slate-300 hover:text-gold-400'}`}
        >
          <Icon name="star" fill={fav} className="h-4.5 w-4.5" />
        </button>
      </div>

      <div className="space-y-2 px-4 pr-5 pb-4 text-[13px] leading-6 text-slate-600">
        {(loc || c.address) && (
          <p className="flex gap-2">
            <Icon name="pin" className="mt-1 h-4 w-4 shrink-0 text-ink-300" />
            <span className="line-clamp-2">
              {loc && (
                <b className="font-semibold text-ink-800">
                  <Highlight text={loc} tokens={tokens} />
                  {c.address ? ' — ' : ''}
                </b>
              )}
              <Highlight text={c.address} tokens={tokens} />
            </span>
          </p>
        )}
        {c.service && (
          <p className="flex gap-2">
            <Icon name="cross" className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
            <span className="line-clamp-1">{c.service}</span>
          </p>
        )}
        {c.phones.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Icon name="phone" className="h-4 w-4 shrink-0 text-emerald-500" />
            {c.phones.slice(0, 3).map((p, i) => (
              <a
                key={i}
                href={`tel:${p.tel}`}
                dir="ltr"
                onClick={stop}
                className="font-medium tabular-nums text-ink-800 underline decoration-slate-200 underline-offset-4 hover:text-emerald-600"
              >
                {toFa(p.label)}
              </a>
            ))}
            {c.phones.length > 3 && <span className="text-xs text-slate-400">+{toFa(c.phones.length - 3)}</span>}
          </p>
        )}
        {c.desc && <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">{c.desc}</p>}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 pr-5">
        {c.phones[0] && (
          <a
            href={`tel:${c.phones[0].tel}`}
            onClick={stop}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Icon name="phone" className="h-3.5 w-3.5" /> تماس
          </a>
        )}
        <a
          href={mapsUrl(c)}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-ink-900"
        >
          <Icon name="pin" className="h-3.5 w-3.5" /> مسیریابی
        </a>
        <button
          onClick={(e) => { stop(e); onCopy([c.name, loc, c.address, c.phones.map((p) => p.label).join(' / ')].filter(Boolean).join('\n')); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white hover:text-ink-800"
        >
          <Icon name="copy" className="h-3.5 w-3.5" /> کپی
        </button>
        <button
          onClick={(e) => { stop(e); onOpen(c); }}
          className="mr-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-600 transition hover:text-ink-900"
        >
          جزئیات
          <Icon name="chevronLeft" className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}
