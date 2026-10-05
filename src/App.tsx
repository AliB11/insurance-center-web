import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CenterCard } from './components/CenterCard';
import { DetailModal } from './components/DetailModal';
import { ImportModal } from './components/ImportModal';
import { Highlight, Icon, mapsUrl } from './components/ui';
import { tryLocal, tryRemote } from './lib/loader';
import { parseWorkbook, type Center, type SheetReport } from './lib/parser';
import { applyFilters, categoryEmoji, countBy, EMPTY_FILTERS, relevance, tokensOf, type Filters } from './lib/search';
import { clearStored, loadList, loadStored, saveData, saveList, type Meta } from './lib/storage';
import { fmtNum, norm, toFa } from './lib/text';

type Sort = 'relevance' | 'name' | 'province';
const favKey = (c: Center) => `${c.nameN}#${norm(c.address).slice(0, 30)}`;

export default function App() {
  const [centers, setCenters] = useState<Center[]>([]);
  const [report, setReport] = useState<SheetReport[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('در حال آماده‌سازی داده‌ها...');
  const [modal, setModal] = useState<null | 'import' | 'report'>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>('relevance');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [limit, setLimit] = useState(24);
  const [showFilters, setShowFilters] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const [detail, setDetail] = useState<Center | null>(null);
  const [toast, setToast] = useState('');
  const [favKeys, setFavKeys] = useState<Set<string>>(() => new Set(loadList<string[]>('sepah-favs', [])));
  const [recent, setRecent] = useState<string[]>(() => loadList<string[]>('sepah-recent', []));
  const [showTop, setShowTop] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 2400);
  }, []);

  const ingest = useCallback(
    async (buf: ArrayBuffer, name: string, source: Meta['source']) => {
      setStatus('در حال تحلیل و استخراج مراکز از تمام شیت‌ها...');
      await new Promise((r) => setTimeout(r, 30));
      const res = parseWorkbook(buf);
      if (!res.centers.length) {
        setStatus('هیچ مرکزی در فایل پیدا نشد. «گزارش بررسی اکسل» را ببینید.');
        setReport(res.report);
        return false;
      }
      const m: Meta = { fileName: name, source, loadedAt: Date.now(), size: buf.byteLength };
      setCenters(res.centers);
      setReport(res.report);
      setMeta(m);
      setFilters(EMPTY_FILTERS);
      setStatus(`${fmtNum(res.centers.length)} مرکز بارگذاری شد.`);
      await saveData({ centers: res.centers, report: res.report, meta: m });
      return true;
    },
    [],
  );

  // ---------- boot: shipped file → saved upload → online ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await loadStored();
      if (stored && stored.meta.source === 'upload' && stored.centers.length) {
        if (!alive) return;
        setCenters(stored.centers); setReport(stored.report); setMeta(stored.meta);
        setBooting(false);
        return;
      }
      setStatus('در حال جستجوی فایل داده در مسیر برنامه...');
      const local = await tryLocal();
      if (local && alive) {
        const ok = await ingest(local.buf, local.name, 'local');
        if (ok) { setBooting(false); return; }
      }
      if (stored && stored.centers.length && alive) {
        setCenters(stored.centers); setReport(stored.report); setMeta(stored.meta);
        setBooting(false);
        return;
      }
      if (!alive) return;
      setStatus('در حال تلاش برای دریافت فایل از sphbank.ir ...');
      const remote = await tryRemote(undefined, (s) => alive && setStatus(s));
      if (remote && alive) {
        const ok = await ingest(remote.buf, remote.name, 'remote');
        if (ok) { setBooting(false); return; }
      }
      if (alive) {
        setStatus('');
        setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, [ingest]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 700);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleFile = async (f: File) => {
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const ok = await ingest(buf, f.name, 'upload');
      if (ok) {
        setModal('report');
        flash('فایل با موفقیت بارگذاری شد');
      }
    } catch (e) {
      setStatus('خطا در خواندن فایل: ' + (e as Error).message);
    }
    setBusy(false);
  };

  const handleRemote = async (url: string) => {
    setBusy(true);
    setStatus('در حال اتصال...');
    const r = await tryRemote(url.trim(), setStatus);
    if (r) {
      const ok = await ingest(r.buf, r.name, 'upload');
      if (ok) setModal('report');
    } else {
      setStatus('دریافت آنلاین ناموفق بود (احتمالاً محدودیت CORS یا فیلترینگ). فایل را دانلود و بارگذاری کنید.');
    }
    setBusy(false);
  };

  const handleReset = async () => {
    await clearStored();
    setCenters([]); setReport([]); setMeta(null);
    setStatus('داده ذخیره‌شده حذف شد.');
  };

  // ---------- derived data ----------
  const favIds = useMemo(() => new Set(centers.filter((c) => favKeys.has(favKey(c))).map((c) => c.id)), [centers, favKeys]);
  const dq = useDeferredValue(filters);
  const tokens = useMemo(() => tokensOf(dq.q), [dq.q]);

  const results = useMemo(() => {
    const list = applyFilters(centers, dq, favIds);
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    if (sort === 'province') return [...list].sort((a, b) => (a.province + a.city).localeCompare(b.province + b.city, 'fa'));
    if (tokens.length) return [...list].sort((a, b) => relevance(b, tokens) - relevance(a, tokens));
    return list;
  }, [centers, dq, favIds, sort, tokens]);

  const catFacet = useMemo(() => countBy(applyFilters(centers, dq, favIds, 'category'), (c) => c.category), [centers, dq, favIds]);
  const provFacet = useMemo(() => countBy(applyFilters(centers, dq, favIds, 'province'), (c) => c.province), [centers, dq, favIds]);
  const cityFacet = useMemo(() => countBy(applyFilters(centers, dq, favIds, 'city'), (c) => c.city), [centers, dq, favIds]);
  const kindFacet = useMemo(() => countBy(applyFilters(centers, dq, favIds, 'kind'), (c) => c.kind), [centers, dq, favIds]);
  const allCats = useMemo(() => countBy(centers, (c) => c.category).sort((a, b) => b[1] - a[1]), [centers]);
  const stats = useMemo(() => ({
    total: centers.length,
    provinces: new Set(centers.map((c) => c.province).filter(Boolean)).size,
    cities: new Set(centers.map((c) => c.city).filter(Boolean)).size,
    cats: allCats.length,
  }), [centers, allCats]);

  useEffect(() => { setLimit(view === 'cards' ? 24 : 50); }, [dq, sort, view]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const setProvince = (province: string) => set({ province, city: '' });
  const toggleFav = (id: number) => {
    const c = centers[id];
    if (!c) return;
    setFavKeys((s) => {
      const n = new Set(s);
      const k = favKey(c);
      if (n.has(k)) n.delete(k); else n.add(k);
      saveList('sepah-favs', Array.from(n));
      return n;
    });
  };
  const copy = (t: string) => {
    navigator.clipboard?.writeText(t).then(() => flash('اطلاعات کپی شد'), () => flash('کپی انجام نشد'));
  };
  const commitSearch = () => {
    const q = filters.q.trim();
    if (!q) return;
    const n = [q, ...recent.filter((r) => r !== q)].slice(0, 6);
    setRecent(n);
    saveList('sepah-recent', n);
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const exportXlsx = () => {
    const rows = results.map((c, i) => ({
      ردیف: i + 1, نام: c.name, دسته: c.category, 'نوع مرکز': c.kind, 'تخصص/خدمات': c.service,
      استان: c.province, شهر: c.city, آدرس: c.address, تلفن: c.phones.map((p) => p.label).join(' / '),
      'تخفیف/قرارداد': c.discount, توضیحات: c.desc,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'مراکز');
    XLSX.writeFile(wb, 'مراکز-طرف-قرارداد-بیمه-سپه.xlsx');
  };

  const activeCount = [filters.category, filters.province, filters.city, filters.kind].filter(Boolean).length + (filters.hasPhone ? 1 : 0) + (filters.favOnly ? 1 : 0);
  const hasData = centers.length > 0;
  const visible = results.slice(0, limit);

  const Select = ({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (v: string) => void; options: [string, number][]; disabled?: boolean }) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
      >
        <option value="">همه</option>
        {value && !options.some(([k]) => k === value) && <option value={value}>{value}</option>}
        {options.map(([k, n]) => (
          <option key={k} value={k}>{k} ({toFa(n)})</option>
        ))}
      </select>
    </label>
  );

  const FilterPanel = (
    <div className="space-y-4">
      <Select label="دسته / نوع مرکز" value={filters.category} onChange={(v) => set({ category: v })} options={catFacet} />
      <Select label="استان" value={filters.province} onChange={setProvince} options={provFacet} />
      <Select label="شهر" value={filters.city} onChange={(v) => set({ city: v })} options={cityFacet} disabled={!cityFacet.length && !filters.city} />
      {kindFacet.length > 1 && kindFacet.length <= 80 && (
        <Select label="زیرگروه" value={filters.kind} onChange={(v) => set({ kind: v })} options={kindFacet} />
      )}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        <input type="checkbox" checked={filters.hasPhone} onChange={(e) => set({ hasPhone: e.target.checked })} className="h-4 w-4 accent-blue-800" />
        فقط مراکز دارای تلفن
      </label>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <input type="checkbox" checked={filters.favOnly} onChange={(e) => set({ favOnly: e.target.checked })} className="h-4 w-4 accent-amber-600" />
        فقط علاقه‌مندی‌ها ({toFa(favIds.size)})
      </label>
      {(activeCount > 0 || filters.q) && (
        <button onClick={() => setFilters(EMPTY_FILTERS)} className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          پاک کردن همه فیلترها
        </button>
      )}
    </div>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-800">
      {/* ---------- top bar ---------- */}
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-blue-950/95 text-white backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-blue-950 shadow-lg shadow-orange-900/30">
              <Icon name="shield" className="h-6 w-6" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-extrabold sm:text-base">مراکز طرف قرارداد بیمه بانک سپه</h1>
              <p className="hidden text-[11px] text-blue-200 sm:block">سامانه جستجوی هوشمند مراکز درمانی و خدمات بیمه‌ای</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => { set({ favOnly: !filters.favOnly }); resultsRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 transition ${filters.favOnly ? 'bg-amber-400 text-blue-950' : 'bg-white/10 hover:bg-white/20'}`}
            >
              <Icon name="star" className="h-4 w-4" fill={filters.favOnly} />
              <span className="hidden sm:inline">علاقه‌مندی‌ها</span>
              <span className="rounded-full bg-black/20 px-1.5 text-xs">{toFa(favIds.size)}</span>
            </button>
            {hasData && (
              <button onClick={() => setModal('report')} className="hidden items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 hover:bg-white/20 md:inline-flex">
                <Icon name="file" className="h-4 w-4" /> گزارش داده
              </button>
            )}
            <button onClick={() => setModal('import')} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 font-medium text-blue-950 hover:bg-blue-50">
              <Icon name="upload" className="h-4 w-4" /> <span className="hidden sm:inline">بارگذاری فایل</span><span className="sm:hidden">فایل</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="no-print relative overflow-hidden bg-gradient-to-bl from-blue-950 via-blue-900 to-blue-800 pb-24 pt-10 text-white sm:pt-14">
        <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <span className="mb-4 inline-block rounded-full bg-white/10 px-4 py-1 text-xs text-amber-200 ring-1 ring-white/20">
            بیمه تکمیلی درمان • همکاران و بازنشستگان
          </span>
          <h2 className="text-2xl font-extrabold leading-snug sm:text-4xl">نزدیک‌ترین مرکز درمانی طرف قرارداد را پیدا کنید</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-blue-100 sm:text-base">
            نام مرکز، پزشک، شهر، استان، تلفن یا بخشی از آدرس را بنویسید؛ نتایج هم‌زمان با تایپ فیلتر می‌شوند.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); commitSearch(); }} className="relative mx-auto mt-7 max-w-2xl">
            <Icon name="search" className="pointer-events-none absolute right-5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="مثلاً: بیمارستان رشت، آزمایشگاه شیراز، دندانپزشکی ..."
              className="w-full rounded-2xl border-0 bg-white py-4 pr-14 pl-24 text-base text-slate-900 shadow-2xl shadow-blue-950/40 outline-none ring-4 ring-transparent placeholder:text-slate-400 focus:ring-amber-400/60"
            />
            {filters.q && (
              <button type="button" onClick={() => set({ q: '' })} className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
                <Icon name="x" className="h-4 w-4" />
              </button>
            )}
          </form>
          {recent.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="text-blue-200">جستجوهای اخیر:</span>
              {recent.map((r) => (
                <button key={r} onClick={() => set({ q: r })} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">{r}</button>
              ))}
            </div>
          )}

          {hasData && (
            <div className="mx-auto mt-8 grid max-w-2xl grid-cols-4 gap-2 sm:gap-4">
              {[['مرکز', stats.total], ['استان', stats.provinces], ['شهر', stats.cities], ['دسته', stats.cats]].map(([l, v]) => (
                <div key={l as string} className="rounded-2xl bg-white/10 px-2 py-3 ring-1 ring-white/15 backdrop-blur">
                  <div className="text-xl font-extrabold text-amber-300 sm:text-2xl">{fmtNum(v as number)}</div>
                  <div className="text-[11px] text-blue-100 sm:text-xs">{l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto -mt-14 max-w-7xl px-4 pb-16">
        {/* ---------- loading / empty ---------- */}
        {booting && (
          <div className="rounded-3xl bg-white p-12 text-center shadow-xl">
            <span className="mx-auto mb-4 block h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-800" />
            <p className="font-medium text-slate-700">{status}</p>
          </div>
        )}

        {!booting && !hasData && (
          <div className="rounded-3xl bg-white p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Icon name="file" className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">فایل اطلاعات مراکز بارگذاری نشد</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-slate-500">
              دسترسی خودکار به فایل اکسل مراکز ممکن نشد. فایل اکسل مراکز طرف قرارداد را از صفحه منابع انسانی دانلود و اینجا بارگذاری کنید؛ تمام شیت‌ها (بیمارستان، آزمایشگاه، داروخانه و …) یکجا ادغام و قابل جستجو می‌شوند.
            </p>
            {status && <p className="mx-auto mt-3 max-w-xl text-sm text-rose-600">{status}</p>}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={() => setModal('import')} className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-6 py-3 font-medium text-white shadow-lg shadow-blue-900/20 hover:bg-blue-900">
                <Icon name="upload" className="h-5 w-5" /> بارگذاری فایل اکسل
              </button>
              <a href="https://sphbank.ir/hr" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-6 py-3 font-medium text-slate-700 hover:bg-slate-50">
                <Icon name="link" className="h-5 w-5" /> صفحه دانلود فایل (sphbank.ir/hr)
              </a>
            </div>
          </div>
        )}

        {hasData && (
          <>
            {/* ---------- category tiles ---------- */}
            <section className="no-print rounded-3xl bg-white p-4 shadow-xl shadow-slate-200/70 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">دسته‌بندی مراکز</h3>
                {allCats.length > 11 && (
                  <button onClick={() => setShowAllCats(!showAllCats)} className="text-xs font-medium text-blue-800 hover:underline">
                    {showAllCats ? 'نمایش کمتر' : `نمایش همه (${toFa(allCats.length)})`}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                <button
                  onClick={() => set({ category: '' })}
                  className={`flex items-center gap-2.5 rounded-2xl border p-3 text-right transition ${!filters.category ? 'border-blue-800 bg-blue-800 text-white shadow-lg shadow-blue-900/20' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}`}
                >
                  <span className="text-2xl">🗂️</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">همه مراکز</span>
                    <span className={`text-xs ${!filters.category ? 'text-blue-200' : 'text-slate-500'}`}>{fmtNum(centers.length)}</span>
                  </span>
                </button>
                {(showAllCats ? allCats : allCats.slice(0, 11)).map(([name, n]) => {
                  const on = filters.category === name;
                  return (
                    <button
                      key={name}
                      onClick={() => set({ category: on ? '' : name })}
                      className={`flex items-center gap-2.5 rounded-2xl border p-3 text-right transition ${on ? 'border-blue-800 bg-blue-800 text-white shadow-lg shadow-blue-900/20' : 'border-slate-200 bg-slate-50 hover:border-amber-300 hover:bg-amber-50/50'}`}
                    >
                      <span className="text-2xl">{categoryEmoji(name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold" title={name}>{name}</span>
                        <span className={`text-xs ${on ? 'text-blue-200' : 'text-slate-500'}`}>{fmtNum(n)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ---------- results ---------- */}
            <div ref={resultsRef} className="mt-6 grid scroll-mt-20 gap-6 lg:grid-cols-[18rem_1fr]">
              <aside className="no-print hidden lg:block">
                <div className="sticky top-20 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Icon name="filter" className="h-4 w-4 text-blue-800" /> فیلتر پیشرفته
                  </h3>
                  {FilterPanel}
                </div>
              </aside>

              <section>
                <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setShowFilters(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 lg:hidden">
                      <Icon name="filter" className="h-4 w-4" /> فیلتر {activeCount > 0 && <span className="rounded-full bg-blue-800 px-1.5 text-xs text-white">{toFa(activeCount)}</span>}
                    </button>
                    <p className="text-sm text-slate-600">
                      <b className="text-lg text-blue-900">{fmtNum(results.length)}</b> مرکز یافت شد
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
                      <option value="relevance">{tokens.length ? 'مرتبط‌ترین' : 'ترتیب فایل'}</option>
                      <option value="name">نام (الفبایی)</option>
                      <option value="province">استان و شهر</option>
                    </select>
                    <div className="flex rounded-xl bg-slate-100 p-1">
                      {([['cards', 'grid'], ['table', 'list']] as const).map(([k, ic]) => (
                        <button key={k} onClick={() => setView(k)} className={`rounded-lg p-1.5 ${view === k ? 'bg-white text-blue-900 shadow' : 'text-slate-400'}`} title={k === 'cards' ? 'کارت' : 'جدول'}>
                          <Icon name={ic} className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                    <button onClick={exportXlsx} disabled={!results.length} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      <Icon name="download" className="h-4 w-4" /> اکسل
                    </button>
                    <button onClick={() => window.print()} className="hidden items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-50 sm:inline-flex">
                      <Icon name="print" className="h-4 w-4" /> چاپ
                    </button>
                  </div>
                </div>

                {activeCount > 0 && (
                  <div className="no-print mb-4 flex flex-wrap gap-2">
                    {([['category', filters.category], ['province', filters.province], ['city', filters.city], ['kind', filters.kind]] as const)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <button key={k} onClick={() => (k === 'province' ? setProvince('') : set({ [k]: '' } as Partial<Filters>))} className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-900 hover:bg-blue-200">
                          {v} <Icon name="x" className="h-3 w-3" />
                        </button>
                      ))}
                    {filters.hasPhone && <button onClick={() => set({ hasPhone: false })} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">دارای تلفن <Icon name="x" className="h-3 w-3" /></button>}
                    {filters.favOnly && <button onClick={() => set({ favOnly: false })} className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">علاقه‌مندی‌ها <Icon name="x" className="h-3 w-3" /></button>}
                  </div>
                )}

                {results.length === 0 ? (
                  <div className="rounded-3xl bg-white p-12 text-center ring-1 ring-slate-200">
                    <div className="mb-3 text-5xl">🔍</div>
                    <p className="font-bold text-slate-800">مرکزی با این مشخصات پیدا نشد</p>
                    <p className="mt-1 text-sm text-slate-500">عبارت جستجو را کوتاه‌تر کنید یا فیلترها را بردارید.</p>
                    <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-5 rounded-xl bg-blue-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-900">نمایش همه مراکز</button>
                  </div>
                ) : view === 'cards' ? (
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {visible.map((c) => (
                      <CenterCard key={c.id} c={c} tokens={tokens} fav={favIds.has(c.id)} onFav={toggleFav} onOpen={setDetail} onCopy={copy} />
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                    <table className="w-full min-w-[760px] text-right text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          {['', 'نام مرکز', 'دسته', 'استان / شهر', 'آدرس', 'تلفن', ''].map((h, i) => <th key={i} className="px-3 py-3 font-semibold">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visible.map((c) => (
                          <tr key={c.id} className="align-top hover:bg-amber-50/40">
                            <td className="px-3 py-3">
                              <button onClick={() => toggleFav(c.id)} className={favIds.has(c.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}>
                                <Icon name="star" className="h-4 w-4" fill={favIds.has(c.id)} />
                              </button>
                            </td>
                            <td className="px-3 py-3 font-semibold text-slate-900"><button className="text-right hover:text-blue-800" onClick={() => setDetail(c)}><Highlight text={c.name} tokens={tokens} /></button></td>
                            <td className="px-3 py-3 text-xs text-slate-600">{c.category}</td>
                            <td className="px-3 py-3 text-xs">{[c.province, c.city].filter(Boolean).join('، ')}</td>
                            <td className="max-w-xs px-3 py-3 text-xs leading-6 text-slate-600"><Highlight text={c.address} tokens={tokens} /></td>
                            <td className="px-3 py-3 text-xs" dir="ltr">
                              {c.phones.slice(0, 2).map((p, i) => <a key={i} href={`tel:${p.tel}`} className="block text-slate-800 hover:text-blue-700">{toFa(p.label)}</a>)}
                            </td>
                            <td className="px-3 py-3"><a href={mapsUrl(c)} target="_blank" rel="noreferrer" className="text-blue-800 hover:text-blue-950"><Icon name="pin" className="h-4 w-4" /></a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {results.length > visible.length && (
                  <div className="no-print mt-6 text-center">
                    <button onClick={() => setLimit((l) => l + (view === 'cards' ? 24 : 50))} className="rounded-xl bg-white px-8 py-3 text-sm font-semibold text-blue-900 shadow ring-1 ring-slate-200 hover:bg-blue-50">
                      نمایش بیشتر ({fmtNum(results.length - visible.length)} مورد باقی‌مانده)
                    </button>
                  </div>
                )}
              </section>
            </div>

            {/* ---------- guide ---------- */}
            <section className="no-print mt-12 grid gap-4 md:grid-cols-3">
              {[
                ['۱', 'مرکز را پیدا کنید', 'با جستجو یا فیلتر استان، شهر و نوع مرکز، مراکز طرف قرارداد را ببینید.'],
                ['۲', 'قبل از مراجعه تماس بگیرید', 'برای اطمینان از ساعت کاری، نوع خدمات و تعهدات، با شماره درج‌شده هماهنگ کنید.'],
                ['۳', 'مدارک را همراه داشته باشید', 'کارت ملی و کارت/دفترچه بیمه‌ی درمان را همراه ببرید و جزئیات را از مرکز بپرسید.'],
              ].map(([n, t, d]) => (
                <div key={n} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 font-extrabold text-amber-700">{n}</div>
                  <h4 className="font-bold text-slate-900">{t}</h4>
                  <p className="mt-1 text-sm leading-7 text-slate-500">{d}</p>
                </div>
              ))}
            </section>
          </>
        )}
      </main>

      <footer className="no-print border-t border-slate-200 bg-white py-6 text-center text-xs leading-7 text-slate-500">
        <p>اطلاعات این سامانه مطابق آخرین فایل مراکز طرف قرارداد بارگذاری شده است و ممکن است تغییر کرده باشد؛ پیش از مراجعه، وضعیت قرارداد مرکز را استعلام کنید.</p>
        {meta && (
          <p className="mt-1">
            منبع داده: <span dir="ltr">{meta.fileName}</span> • آخرین بارگذاری: {new Date(meta.loadedAt).toLocaleDateString('fa-IR')} •{' '}
            <button onClick={() => setModal('report')} className="text-blue-800 hover:underline">گزارش بررسی اکسل</button>
          </p>
        )}
      </footer>

      {/* ---------- mobile filter drawer ---------- */}
      {showFilters && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setShowFilters(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <div onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">فیلتر پیشرفته</h3>
              <button onClick={() => setShowFilters(false)} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="x" /></button>
            </div>
            {FilterPanel}
            <button onClick={() => setShowFilters(false)} className="mt-5 w-full rounded-xl bg-blue-800 py-3 font-medium text-white">
              نمایش {fmtNum(results.length)} مرکز
            </button>
          </div>
        </div>
      )}

      {detail && <DetailModal c={detail} fav={favIds.has(detail.id)} onFav={toggleFav} onClose={() => setDetail(null)} onCopy={copy} />}
      {modal && (
        <ImportModal
          tab={modal}
          report={report}
          meta={meta}
          busy={busy}
          status={status}
          onFile={handleFile}
          onRemote={handleRemote}
          onReset={handleReset}
          onClose={() => setModal(null)}
        />
      )}

      {showTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="no-print fixed bottom-5 left-5 z-30 rounded-full bg-blue-800 p-3 text-white shadow-xl hover:bg-blue-900">
          <Icon name="arrowUp" />
        </button>
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm text-white shadow-2xl">{toast}</div>
      )}
    </div>
  );
}
