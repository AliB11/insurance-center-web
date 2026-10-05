import type { Center } from '../lib/parser';
import { categoryEmoji } from '../lib/search';
import { toFa } from '../lib/text';
import { Highlight, Icon, mapsUrl } from './ui';

interface Props {
  c: Center;
  tokens: string[];
  fav: boolean;
  onFav: (id: number) => void;
  onOpen: (c: Center) => void;
  onCopy: (text: string) => void;
}

export function CenterCard({ c, tokens, fav, onFav, onOpen, onCopy }: Props) {
  const loc = [c.province, c.city].filter(Boolean).join('، ');
  return (
    <article className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-amber-50 text-2xl ring-1 ring-slate-100">
          {categoryEmoji(c.category + ' ' + c.kind)}
        </div>
        <div className="min-w-0 flex-1">
          <button onClick={() => onOpen(c)} className="block w-full text-right">
            <h3 className="text-[15px] font-bold leading-6 text-slate-900 group-hover:text-blue-800">
              <Highlight text={c.name} tokens={tokens} />
            </h3>
          </button>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-800">{c.category}</span>
            {c.kind && c.kind !== c.category && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">{c.kind}</span>
            )}
            {c.service && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-700">{c.service}</span>
            )}
            {c.discount && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">{c.discount}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => onFav(c.id)}
          title={fav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
          className={`rounded-full p-1.5 transition ${fav ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
        >
          <Icon name="star" fill={fav} />
        </button>
      </div>

      <div className="mt-3 space-y-2 text-[13px] leading-6 text-slate-600">
        {(loc || c.address) && (
          <p className="flex gap-2">
            <Icon name="pin" className="mt-1 h-4 w-4 shrink-0 text-rose-500" />
            <span>
              {loc && <b className="font-semibold text-slate-800"><Highlight text={loc} tokens={tokens} />{c.address ? ' — ' : ''}</b>}
              <Highlight text={c.address} tokens={tokens} />
            </span>
          </p>
        )}
        {c.phones.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Icon name="phone" className="h-4 w-4 shrink-0 text-emerald-600" />
            {c.phones.slice(0, 3).map((p, i) => (
              <a key={i} href={`tel:${p.tel}`} dir="ltr" className="font-medium text-slate-800 hover:text-blue-700">
                {toFa(p.label)}
              </a>
            ))}
            {c.phones.length > 3 && <span className="text-xs text-slate-400">+{toFa(c.phones.length - 3)}</span>}
          </p>
        )}
        {c.desc && <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">{c.desc}</p>}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {c.phones[0] && (
          <a href={`tel:${c.phones[0].tel}`} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
            <Icon name="phone" className="h-3.5 w-3.5" /> تماس
          </a>
        )}
        <a href={mapsUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-900">
          <Icon name="pin" className="h-3.5 w-3.5" /> مسیریابی
        </a>
        <button
          onClick={() => onCopy([c.name, loc, c.address, c.phones.map((p) => p.label).join(' / ')].filter(Boolean).join('\n'))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <Icon name="copy" className="h-3.5 w-3.5" /> کپی
        </button>
        <button onClick={() => onOpen(c)} className="mr-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-50">
          جزئیات
        </button>
      </div>
    </article>
  );
}
