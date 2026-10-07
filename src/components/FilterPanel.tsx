import type { Filters } from '../lib/search';
import { toFa } from '../lib/text';
import { Icon } from './ui';

interface Props {
  filters: Filters;
  catFacet: [string, number][];
  provFacet: [string, number][];
  cityFacet: [string, number][];
  kindFacet: [string, number][];
  favCount: number;
  onPatch: (patch: Partial<Filters>) => void;
  onReset: () => void;
}

/**
 * این کامپوننت عمداً بیرون از بدنهٔ App تعریف شده است؛ اگر داخل
 * تابع render ساخته شود، هر بار که App رندر می‌شود از نو mount شده
 * و فوکوس/حالت باز بودن <select> از بین می‌رود.
 */
function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, number][];
  disabled?: boolean;
  icon: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Icon name={icon} className="h-3.5 w-3.5 text-ink-400" />
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-ink-400 focus:ring-4 focus:ring-ink-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">همه</option>
          {value && !options.some(([k]) => k === value) && <option value={value}>{value}</option>}
          {options.map(([k, n]) => (
            <option key={k} value={k}>
              {k} ({toFa(n)})
            </option>
          ))}
        </select>
        <Icon name="chevron" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  tone,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  tone: 'ink' | 'gold';
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-right text-sm transition ${
        checked
          ? tone === 'gold'
            ? 'border-gold-300 bg-gold-50 text-gold-700'
            : 'border-ink-300 bg-ink-50 text-ink-800'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span className="flex items-baseline gap-2">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          checked ? (tone === 'gold' ? 'bg-gold-400' : 'bg-ink-600') : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? 'right-4.5' : 'right-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function FilterPanel({ filters, catFacet, provFacet, cityFacet, kindFacet, favCount, onPatch, onReset }: Props) {
  const dirty =
    !!filters.category || !!filters.province || !!filters.city || !!filters.kind || filters.hasPhone || filters.favOnly || !!filters.q;

  return (
    <div className="space-y-4">
      <SelectField label="دسته / نوع مرکز" icon="layers" value={filters.category} onChange={(v) => onPatch({ category: v })} options={catFacet} />
      <SelectField
        label="استان"
        icon="map"
        value={filters.province}
        onChange={(v) => onPatch({ province: v, city: '' })}
        options={provFacet}
      />
      <SelectField
        label="شهر"
        icon="pin"
        value={filters.city}
        onChange={(v) => onPatch({ city: v })}
        options={cityFacet}
        disabled={!cityFacet.length && !filters.city}
      />
      {kindFacet.length > 1 && kindFacet.length <= 80 && (
        <SelectField label="زیرگروه" icon="target" value={filters.kind} onChange={(v) => onPatch({ kind: v })} options={kindFacet} />
      )}

      <div className="space-y-2 pt-1">
        <Toggle
          checked={filters.hasPhone}
          onChange={(v) => onPatch({ hasPhone: v })}
          label="فقط مراکز دارای تلفن"
          tone="ink"
        />
        <Toggle
          checked={filters.favOnly}
          onChange={(v) => onPatch({ favOnly: v })}
          label="فقط علاقه‌مندی‌ها"
          hint={toFa(favCount)}
          tone="gold"
        />
      </div>

      {dirty && (
        <button
          onClick={onReset}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
        >
          <Icon name="refresh" className="h-4 w-4" />
          پاک کردن همه فیلترها
        </button>
      )}
    </div>
  );
}
