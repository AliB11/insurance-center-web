import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as XLSX from 'xlsx';
import { CenterCard } from './components/CenterCard';
import { RoutingModal } from './components/RoutingModal';
import { Modal } from './components/Modal';
import { DetailModal } from './components/DetailModal';
import { FilterPanel } from './components/FilterPanel';
import { ImportModal } from './components/ImportModal';
import { Highlight, Icon, Kbd, Spinner, Wave } from './components/ui';
import { DEMO_FILE_NAME, demoCenters } from './lib/demo';
import { tryLocal, tryRemote } from './lib/loader';
import { MAX_FILE_BYTES, parseWorkbook, type Center, type SheetReport } from './lib/parser';
import { applyFilters, categoryEmoji, countBy, EMPTY_FILTERS, relevance, tokensOf, type Filters } from './lib/search';
import { catTheme } from './lib/theme';
import { clearStored, loadList, loadStored, saveData, saveList, type Meta } from './lib/storage';
import { fmtNum, norm, toFa } from './lib/text';

type Sort = 'relevance' | 'name' | 'province';
const favKey = (c: Center) => `${c.nameN}#${norm(c.address).slice(0, 30)}`;
const SOURCE_LABEL: Record<Meta['source'], string> = {
  local: 'فایل همراه برنامه',
  upload: 'بارگذاری دستی',
  remote: 'دریافت آنلاین',
  demo: 'دادهٔ نمونهٔ نمایشی',
};

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
  const [printing, setPrinting] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [limit, setLimit] = useState(24);
  const [showFilters, setShowFilters] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const [routing, setRouting] = useState<Center | null>(null);
  const operation = useRef(false);
  const [detail, setDetail] = useState<Center | null>(null);
  const [toast, setToast] = useState('');
  const [favKeys, setFavKeys] = useState<Set<string>>(() => new Set(loadList('sepah-favs', [])));
  const [recent, setRecent] = useState<string[]>(() => loadList('sepah-recent', []));
  const [showTop, setShowTop] = useState(false);
  const [compact, setCompact] = useState(false);
  const [barH, setBarH] = useState(64);

  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const compactRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const ingest = useCallback(async (buf: ArrayBuffer, name: string, source: Meta['source']) => {
    setStatus('در حال تحلیل و استخراج مراکز از تمام شیت‌ها...');
    await new Promise((r) => setTimeout(r, 30));
    const res = parseWorkbook(buf);
    if (!res.centers.length) {
      const notes = res.report.flatMap((r) => r.notes).slice(0, 3).join(' ');
      setStatus('هیچ مرکزی در فایل پیدا نشد؛ دادهٔ فعلی تغییر نکرد. ' + notes);
      return false;
    }
    const m: Meta = { fileName: name, source, loadedAt: Date.now(), size: buf.byteLength };
    setCenters(res.centers);
    setReport(res.report);
    setMeta(m);
    setFilters(EMPTY_FILTERS);
    setStatus(`${fmtNum(res.centers.length)} مرکز بارگذاری شد.`);
    const saved = await saveData({ centers: res.centers, report: res.report, meta: m });
    flash(saved ? 'فایل با موفقیت بارگذاری و ذخیره شد' : 'فایل بارگذاری شد، اما ذخیرهٔ مرورگر ممکن نشد؛ پس از بستن صفحه باید دوباره بارگذاری شود.');
    return true;
  }, [flash]);

  /** دادهٔ نمونه فقط برای اینکه رابط کاربری بدون فایل اکسل هم قابل دیدن باشد */
  const useDemo = useCallback(() => {
    const list = demoCenters();
    const m: Meta = { fileName: DEMO_FILE_NAME, source: 'demo', loadedAt: Date.now(), size: 0 };
    setCenters(list);
    setReport([]);
    setMeta(m);
    setFilters(EMPTY_FILTERS);
    setStatus(`${fmtNum(list.length)} مرکز نمونه بارگذاری شد.`);
    setBooting(false);
  }, []);

  // ---------- boot: فایل ذخیره‌شده → فایل همراه برنامه → دادهٔ نمونه ----------
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    (async () => {
      try {
        const stored = await loadStored();
        if (alive && stored?.centers.length && stored.meta?.source && stored.meta.source !== 'demo') {
          setCenters(stored.centers);
          setReport(stored.report);
          setMeta(stored.meta);
          setStatus(`${fmtNum(stored.centers.length)} مرکز از حافظهٔ مرورگر بازیابی شد.`);
          setBooting(false);
          return;
        }
        if (!alive) return;
        setStatus('در حال جستجوی فایل داده در مسیر برنامه...');
        const local = await tryLocal(controller.signal);
        if (!alive) return;
        if (local) {
          const ok = await ingest(local.buf, local.name, 'local');
          if (ok) { setBooting(false); return; }
        }
        useDemo();
      } catch {
        if (alive) { useDemo(); flash('فایل همراه برنامه قابل خواندن نبود؛ دادهٔ نمونه نمایش داده شد.'); }
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [ingest, useDemo, flash]);

  // ---------- ارتفاع نوار بالا (برای چسبندگی صحیح لایه‌ها) ----------
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setBarH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- نوار جستجوی چسبان بعد از عبور از بنر ----------
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), {
      rootMargin: `-${barH + 24}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [barH]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 700);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ---------- میان‌برهای کیبورد ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        (compact ? compactRef : searchRef).current?.focus();
      }
      if (e.key === 'Escape') {
        if (showFilters) setShowFilters(false);
        else if (typing) (e.target as HTMLElement).blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, showFilters]);

  const handleFile = async (f: File) => {
    if (operation.current || booting) return;
    operation.current = true;
    setBusy(true);
    try {
      if (!/\.(xlsx|xls|xlsm|csv)$/i.test(f.name)) throw new Error('فرمت فایل باید اکسل یا CSV باشد');
      if (!f.size || f.size > MAX_FILE_BYTES) throw new Error('فایل باید غیرخالی و حداکثر ۲۰ مگابایت باشد');
      const buf = await f.arrayBuffer();
      const ok = await ingest(buf, f.name, 'upload');
      if (ok) {
        setModal('report');
      }
    } catch (err) {
      setStatus('خطا در خواندن فایل: ' + (err as Error).message);
      flash('خواندن فایل ناموفق بود');
    } finally { setBusy(false); operation.current = false; }
  };

  const handleRemote = async (url: string) => {
    if (operation.current || booting) return;
    operation.current = true;
    setBusy(true);
    setStatus('در حال اتصال...');
    try {
      const r = await tryRemote(url.trim(), setStatus);
      if (r) {
        const ok = await ingest(r.buf, r.name, 'remote');
        if (ok) setModal('report');
      } else {
        setStatus('دریافت آنلاین ناموفق بود (محدودیت CORS، شبکه یا فایل نامعتبر). فایل را دانلود و بارگذاری کنید.');
      }
    } catch (error) {
      setStatus('خطا در دریافت فایل: ' + (error as Error).message);
      flash('دریافت فایل ناموفق بود');
    } finally { setBusy(false); operation.current = false; }
  };

  const handleReset = async () => {
    if (operation.current || booting) return;
    operation.current = true;
    setBusy(true);
    try {
      const cleared = await clearStored();
      if (!cleared) { flash('حذف حافظهٔ مرورگر ممکن نشد؛ داده‌ها تغییری نکردند.'); return; }
      setCenters([]); setReport([]); setMeta(null); setDetail(null); setRouting(null);
      setFilters(EMPTY_FILTERS);
      setStatus('دادهٔ ذخیره‌شده حذف شد.');
      flash('دادهٔ ذخیره‌شده حذف شد');
    } finally { setBusy(false); operation.current = false; }
  };

  // ---------- derived data ----------
  const byId = useMemo(() => new Map(centers.map((c) => [c.id, c])), [centers]);
  const favIds = useMemo(
    () => new Set(centers.filter((c) => favKeys.has(favKey(c))).map((c) => c.id)),
    [centers, favKeys],
  );
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
  const provFacet = useMemo(() => countBy(applyFilters(centers, { ...dq, city: '' }, favIds, 'province'), (c) => c.province), [centers, dq, favIds]);
  const cityFacet = useMemo(() => countBy(applyFilters(centers, dq, favIds, 'city'), (c) => c.city), [centers, dq, favIds]);
  const kindFacet = useMemo(() => countBy(applyFilters(centers, dq, favIds, 'kind'), (c) => c.kind), [centers, dq, favIds]);
  const allCats = useMemo(() => countBy(centers, (c) => c.category).sort((a, b) => b[1] - a[1]), [centers]);
  const stats = useMemo(
    () => ({
      total: centers.length,
      provinces: new Set(centers.map((c) => c.province).filter(Boolean)).size,
      cities: new Set(centers.map((c) => c.city).filter(Boolean)).size,
      cats: allCats.length,
    }),
    [centers, allCats],
  );

  useEffect(() => { setLimit(view === 'cards' ? 24 : 50); }, [dq, sort, view]);

  const set = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const toggleFav = (id: number) => {
    const c = byId.get(id);
    if (!c) return;
    setFavKeys((s) => {
      const n = new Set(s);
      const k = favKey(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      saveList('sepah-favs', Array.from(n));
      return n;
    });
  };
  const copy = (t: string) => {
    if (!navigator.clipboard) {
      flash('کپی در این مرورگر پشتیبانی نمی‌شود');
      return;
    }
    navigator.clipboard.writeText(t).then(
      () => flash('اطلاعات کپی شد'),
      () => flash('کپی انجام نشد'),
    );
  };
  const runSearch = (q: string) => {
    set({ q });
    const trimmed = q.trim();
    if (!trimmed) return;
    const n = [trimmed, ...recent.filter((r) => r !== trimmed)].slice(0, 6);
    setRecent(n);
    saveList('sepah-recent', n);
  };
  const scrollToResults = () => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const exportXlsx = () => {
    const rows = results.map((c, i) => ({
      ردیف: i + 1,
      نام: c.name,
      دسته: c.category,
      'نوع مرکز': c.kind,
      'تخصص/خدمات': c.service,
      استان: c.province,
      شهر: c.city,
      آدرس: c.address,
      تلفن: c.phones.map((p) => p.label).join(' / '),
      'تخفیف/قرارداد': c.discount,
      توضیحات: c.desc,
      latitude: c.coordinates?.lat ?? '',
      longitude: c.coordinates?.lng ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'مراکز');
    XLSX.writeFile(wb, 'مراکز-طرف-قرارداد-بیمه-سپه.xlsx');
    flash(`${fmtNum(rows.length)} ردیف در فایل اکسل ذخیره شد`);
  };

  const activeCount =
    [filters.category, filters.province, filters.city, filters.kind].filter(Boolean).length +
    (filters.hasPhone ? 1 : 0) +
    (filters.favOnly ? 1 : 0);
  const hasData = centers.length > 0;
  const isDemo = meta?.source === 'demo';
  const visible = printing ? results : results.slice(0, limit);

  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  const searchInput = (ref: React.RefObject<HTMLInputElement | null>, placeholder: string, onCommit: boolean) => (
    <form
      onSubmit={(e) => { e.preventDefault(); if (onCommit) scrollToResults(); }}
      className="relative w-full"
      role="search"
    >
      <Icon name="search" className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      <input
        ref={ref}
        value={filters.q}
        onChange={(e) => set({ q: e.target.value })}
        placeholder={placeholder}
        aria-label="جستجوی مراکز طرف قرارداد"
        className="w-full rounded-2xl border-0 bg-white py-3.5 pl-24 pr-12 text-[15px] text-ink-900 shadow-lg shadow-ink-950/10 outline-none ring-2 ring-transparent transition placeholder:text-slate-400 focus:ring-gold-300"
      />
      <span className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {filters.q && (
          <button
            type="button"
            onClick={() => set({ q: '' })}
            aria-label="پاک کردن جستجو"
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        )}
        <span className="hidden items-center gap-1 text-slate-400 sm:flex">
          <Kbd>/</Kbd>
        </span>
      </span>
    </form>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-mist text-ink-900">
      <div className="hidden p-4 text-sm print:block">
        مراکز طرف قرارداد بیمه بانک سپه — {fmtNum(results.length)} نتیجه
        {isDemo ? " — دادهٔ نمونه؛ برای مراجعه معتبر نیست" : ` — منبع: ${meta?.fileName || "بدون داده"}`}
      </div>

      {/* ======================= نوار بالای برنامه ======================= */}
      <header
        ref={headerRef}
        className="no-print sticky top-0 z-40 border-b border-white/10 bg-ink-950/90 text-white backdrop-blur-md"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[4.25rem]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 shadow-lg shadow-gold-500/25">
              <Icon name="shield" className="h-6 w-6" />
            </div>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-sm font-extrabold sm:text-base">مراکز طرف قرارداد بیمه بانک سپه</h1>
              <p className="hidden truncate text-[11px] text-ink-200 sm:block">جستجوی هوشمند مراکز درمانی و خدمات بیمهٔ تکمیلی</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-sm">
            <button
              onClick={() => { set({ favOnly: !filters.favOnly }); scrollToResults(); }}
              aria-pressed={filters.favOnly}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 transition ${
                filters.favOnly ? 'bg-gold-300 text-ink-950' : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <Icon name="star" className="h-4 w-4" fill={filters.favOnly} />
              <span className="hidden sm:inline">علاقه‌مندی‌ها</span>
              <span className={`rounded-full px-1.5 text-xs ${filters.favOnly ? 'bg-ink-950/15' : 'bg-black/25'}`}>{toFa(favIds.size)}</span>
            </button>
            {hasData && (
              <button
                onClick={() => setModal('report')}
                className="hidden items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 transition hover:bg-white/20 md:inline-flex"
              >
                <Icon name="file" className="h-4 w-4" /> گزارش داده
              </button>
            )}
            <button
              onClick={() => setModal('import')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 font-semibold text-ink-900 transition hover:bg-gold-100"
            >
              <Icon name="upload" className="h-4 w-4" />
              <span className="hidden sm:inline">بارگذاری فایل</span>
              <span className="sm:hidden">فایل</span>
            </button>
          </div>
        </div>
      </header>

      {/* ======================= نوار جستجوی چسبان ======================= */}
      <div
        style={{ top: barH }}
        inert={!(compact && hasData && !booting)}
        aria-hidden={!(compact && hasData && !booting)}
        className={`no-print fixed inset-x-0 z-30 border-b border-slate-200/80 bg-mist/85 backdrop-blur-md transition-all duration-300 ${
          compact && hasData && !booting ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <div className="w-full max-w-xl">{searchInput(compactRef, 'جستجو در نام مرکز، شهر، استان یا تلفن...', false)}</div>
          <p className="hidden shrink-0 whitespace-nowrap text-xs text-slate-500 sm:block">
            <b className="text-base text-ink-800">{fmtNum(results.length)}</b> مرکز
          </p>
          <button
            onClick={() => setShowFilters(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-800 transition hover:bg-slate-50 lg:hidden"
          >
            <Icon name="filter" className="h-4 w-4" /> فیلتر
            {activeCount > 0 && <span className="rounded-full bg-ink-800 px-1.5 text-xs text-white">{toFa(activeCount)}</span>}
          </button>
        </div>
      </div>

      {/* ======================= بنر ======================= */}
      <section className="relative isolate overflow-hidden bg-ink-900 pb-32 pt-10 text-white sm:pb-40 sm:pt-14">
        {/* بافت و نورهای پس‌زمینه */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              'linear-gradient(to left, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)',
          }}
        />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 animate-drift rounded-full bg-gold-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 bottom-0 h-96 w-96 animate-drift-slow rounded-full bg-ink-400/30 blur-3xl" />

        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs text-gold-200 ring-1 ring-inset ring-white/20">
            <Icon name="shield" className="h-3.5 w-3.5" />
            بیمهٔ تکمیلی درمان • همکاران و بازنشستگان
          </span>

          <h2 className="text-2xl font-extrabold leading-snug sm:text-4xl sm:leading-[1.4]">
            نزدیک‌ترین مرکز درمانی
            <span className="bg-gradient-to-l from-gold-200 to-gold-400 bg-clip-text text-transparent"> طرف قرارداد </span>
            را پیدا کنید
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-ink-100 sm:text-base">
            نام مرکز، پزشک، شهر، استان، تلفن یا بخشی از آدرس را بنویسید؛ نتایج هم‌زمان با تایپ فیلتر می‌شوند.
          </p>

          <div className="mx-auto mt-8 max-w-2xl">{searchInput(searchRef, 'مثلاً: بیمارستان رشت، آزمایشگاه شیراز، دندانپزشکی...', true)}</div>

          {recent.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 text-ink-200">
                <Icon name="clock" className="h-3.5 w-3.5" /> جستجوهای اخیر:
              </span>
              {recent.map((r) => (
                <button
                  key={r}
                  onClick={() => runSearch(r)}
                  className="rounded-full bg-white/10 px-3 py-1 transition hover:bg-white/20"
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => { setRecent([]); saveList('sepah-recent', []); }}
                className="rounded-full px-2 py-1 text-ink-200 underline decoration-dotted underline-offset-4 hover:text-white"
              >
                پاک کردن
              </button>
            </div>
          )}

          {hasData && (
            <div className="mx-auto mt-9 grid max-w-2xl grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
              {([['مرکز طرف قرارداد', stats.total], ['استان', stats.provinces], ['شهر', stats.cities], ['دسته‌بندی', stats.cats]] as const).map(
                ([l, v]) => (
                  <div key={l} className="rounded-2xl bg-white/10 px-3 py-3.5 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
                    <div className="text-2xl font-extrabold text-gold-300 tabular-nums">{fmtNum(v)}</div>
                    <div className="mt-0.5 text-[11px] text-ink-100 sm:text-xs">{l}</div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* موج انتهایی بنر؛ هم‌رنگ پس‌زمینهٔ صفحه */}
        <Wave className="absolute inset-x-0 bottom-0 h-24 w-full text-mist sm:h-32" />
      </section>
      <div ref={sentinelRef} aria-hidden="true" />

      {/* ======================= محتوای اصلی =======================
          کارت محتوا با فاصلهٔ منفی روی موج بنر می‌نشیند؛ چون ارتفاع
          موج از میزان بالا‌کشیدن بیشتر است، هیچ‌وقت روی متن بنر
          (جستجو/آمار) نمی‌افتد.                                       */}
      <main className="relative z-10 mx-auto -mt-20 max-w-7xl px-4 pb-20 sm:-mt-24">
        {booting && (
          <div className="rounded-3xl bg-white p-10 shadow-xl shadow-slate-200/70 ring-1 ring-slate-100">
            <p className="mb-6 flex items-center justify-center gap-3 font-medium text-slate-700">
              <Spinner className="h-5 w-5 text-ink-600" />
              {status}
            </p>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-48 rounded-2xl border border-slate-100 p-4">
                  <div className="skeleton mb-3 h-11 w-11 rounded-xl" />
                  <div className="skeleton mb-2 h-4 w-2/3 rounded" />
                  <div className="skeleton mb-4 h-3 w-1/3 rounded" />
                  <div className="skeleton mb-2 h-3 w-full rounded" />
                  <div className="skeleton h-3 w-4/5 rounded" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!booting && !hasData && (
          <div className="rounded-3xl bg-white p-8 text-center shadow-xl shadow-slate-200/70 ring-1 ring-slate-100 sm:p-12">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-100 text-gold-600">
              <Icon name="file" className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-ink-900">فایل اطلاعات مراکز بارگذاری نشد</h3>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-500">
              دسترسی خودکار به فایل اکسل مراکز ممکن نشد. فایل اکسل مراکز طرف قرارداد را از صفحهٔ منابع انسانی دانلود و اینجا بارگذاری کنید؛
              تمام شیت‌ها (بیمارستان، آزمایشگاه، داروخانه و …) یکجا ادغام و قابل جستجو می‌شوند.
            </p>
            {status && <p className="mx-auto mt-3 max-w-xl text-sm text-rose-600">{status}</p>}
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button
                onClick={() => setModal('import')}
                className="inline-flex items-center gap-2 rounded-xl bg-ink-800 px-6 py-3 font-medium text-white shadow-lg shadow-ink-900/20 transition hover:bg-ink-900"
              >
                <Icon name="upload" className="h-5 w-5" /> بارگذاری فایل اکسل
              </button>
              <a
                href="https://sphbank.ir/hr"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-6 py-3 font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Icon name="link" className="h-5 w-5" /> صفحهٔ دانلود فایل (sphbank.ir/hr)
              </a>
            </div>
          </div>
        )}

        {hasData && (
          <>
            {isDemo && (
              <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-700">
                <p className="flex items-center gap-2">
                  <Icon name="info" className="h-4 w-4 shrink-0" />
                  <span>
                    دادهٔ فعلی <b>نمونهٔ نمایشی</b> است (شماره‌ها واقعی نیستند) و فقط برای نشان دادن امکانات سامانه ساخته شده.
                  </span>
                </p>
                <button
                  onClick={() => setModal('import')}
                  className="inline-flex items-center gap-2 rounded-xl bg-gold-400 px-4 py-2 font-semibold text-ink-950 transition hover:bg-gold-500"
                >
                  <Icon name="upload" className="h-4 w-4" /> بارگذاری فایل واقعی
                </button>
              </div>
            )}

            {/* ---------- دسته‌بندی ---------- */}
            <section className="no-print print-plain rounded-3xl bg-white p-4 shadow-xl shadow-slate-200/70 ring-1 ring-slate-100 sm:p-5">
              <div className="mb-3.5 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
                  <Icon name="layers" className="h-4 w-4 text-gold-500" />
                  دسته‌بندی مراکز
                </h3>
                {allCats.length > 11 && (
                  <button
                    onClick={() => setShowAllCats(!showAllCats)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 transition hover:text-ink-900"
                  >
                    {showAllCats ? 'نمایش کمتر' : `نمایش همه (${toFa(allCats.length)})`}
                    <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${showAllCats ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                <button
                  onClick={() => set({ category: '' })}
                  className={`flex items-center gap-2.5 rounded-2xl border p-3 text-right transition ${
                    !filters.category
                      ? 'border-transparent bg-gradient-to-bl from-ink-800 to-ink-950 text-white shadow-lg shadow-ink-900/20'
                      : 'border-slate-200 bg-slate-50 hover:border-gold-300 hover:bg-gold-50/60'
                  }`}
                >
                  <span className="text-2xl">🗂️</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">همهٔ مراکز</span>
                    <span className={`text-xs tabular-nums ${!filters.category ? 'text-gold-300' : 'text-slate-500'}`}>{fmtNum(centers.length)}</span>
                  </span>
                </button>

                {(showAllCats ? allCats : allCats.slice(0, 11)).map(([name, n]) => {
                  const on = filters.category === name;
                  const t = catTheme(name);
                  return (
                    <button
                      key={name}
                      onClick={() => set({ category: on ? '' : name })}
                      aria-pressed={on}
                      className={`flex items-center gap-2.5 rounded-2xl border p-3 text-right transition ${
                        on
                          ? 'border-transparent bg-gradient-to-bl from-ink-800 to-ink-950 text-white shadow-lg shadow-ink-900/20'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white hover:shadow-sm'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xl ${t.tile}`}>
                        {categoryEmoji(name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold" title={name}>{name}</span>
                        <span className={`text-xs tabular-nums ${on ? 'text-gold-300' : 'text-slate-500'}`}>{fmtNum(n)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ---------- نتایج ---------- */}
            <div
              ref={resultsRef}
              style={{ scrollMarginTop: barH + 76 }}
              className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]"
            >
              <aside className="no-print hidden lg:block">
                <div className="sticky rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200" style={{ top: barH + 16 }}>
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900">
                    <Icon name="filter" className="h-4 w-4 text-gold-500" /> فیلتر پیشرفته
                  </h3>
                  <FilterPanel
                    filters={filters}
                    catFacet={catFacet}
                    provFacet={provFacet}
                    cityFacet={cityFacet}
                    kindFacet={kindFacet}
                    favCount={favIds.size}
                    onPatch={set}
                    onReset={() => setFilters(EMPTY_FILTERS)}
                  />
                </div>
              </aside>

              <section>
                <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowFilters(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm font-medium text-ink-800 transition hover:bg-ink-100 lg:hidden"
                    >
                      <Icon name="filter" className="h-4 w-4" /> فیلتر
                      {activeCount > 0 && <span className="rounded-full bg-ink-800 px-1.5 text-xs text-white">{toFa(activeCount)}</span>}
                    </button>
                    <p className="text-sm text-slate-600">
                      <b className="text-lg tabular-nums text-ink-900">{fmtNum(results.length)}</b> مرکز یافت شد
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <div className="relative">
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as Sort)}
                        aria-label="ترتیب نمایش"
                        className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm outline-none transition focus:border-ink-400 focus:ring-4 focus:ring-ink-100"
                      >
                        <option value="relevance">{tokens.length ? 'مرتبط‌ترین' : 'ترتیب فایل'}</option>
                        <option value="name">نام (الفبایی)</option>
                        <option value="province">استان و شهر</option>
                      </select>
                      <Icon name="chevron" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>

                    <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="حالت نمایش">
                      {([['cards', 'grid', 'کارت'], ['table', 'list', 'جدول']] as const).map(([k, ic, label]) => (
                        <button
                          key={k}
                          onClick={() => setView(k)}
                          aria-pressed={view === k}
                          title={label}
                          className={`rounded-lg p-1.5 transition ${view === k ? 'bg-white text-ink-900 shadow' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          <Icon name={ic} className="h-4 w-4" />
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={exportXlsx}
                      disabled={!results.length}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      <Icon name="download" className="h-4 w-4" /> اکسل
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="hidden items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-slate-700 transition hover:bg-slate-50 sm:inline-flex"
                    >
                      <Icon name="print" className="h-4 w-4" /> چاپ
                    </button>
                  </div>
                </div>

                {(activeCount > 0 || filters.q) && (
                  <div className="no-print mb-4 flex flex-wrap items-center gap-2">
                    {filters.q && (
                      <button
                        onClick={() => set({ q: '' })}
                        className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1 text-xs font-medium text-white transition hover:bg-ink-900"
                      >
                        <Icon name="search" className="h-3 w-3" /> «{filters.q}»
                        <Icon name="x" className="h-3 w-3" />
                      </button>
                    )}
                    {([['category', filters.category], ['province', filters.province], ['city', filters.city], ['kind', filters.kind]] as const)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <button
                          key={k}
                          onClick={() => (k === 'province' ? set({ province: '', city: '' }) : set({ [k]: '' } as Partial<Filters>))}
                          className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-800 transition hover:bg-ink-200"
                        >
                          {v} <Icon name="x" className="h-3 w-3" />
                        </button>
                      ))}
                    {filters.hasPhone && (
                      <button
                        onClick={() => set({ hasPhone: false })}
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-200"
                      >
                        دارای تلفن <Icon name="x" className="h-3 w-3" />
                      </button>
                    )}
                    {filters.favOnly && (
                      <button
                        onClick={() => set({ favOnly: false })}
                        className="inline-flex items-center gap-1.5 rounded-full bg-gold-100 px-3 py-1 text-xs font-medium text-gold-700 transition hover:bg-gold-200"
                      >
                        علاقه‌مندی‌ها <Icon name="x" className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {results.length === 0 ? (
                  <div className="print-plain rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200 sm:p-14">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                      <Icon name="search" className="h-8 w-8" />
                    </div>
                    <p className="font-bold text-ink-900">مرکزی با این مشخصات پیدا نشد</p>
                    <p className="mt-2 text-sm text-slate-500">عبارت جستجو را کوتاه‌تر کنید یا فیلترها را بردارید.</p>
                    <button
                      onClick={() => setFilters(EMPTY_FILTERS)}
                      className="mt-6 rounded-xl bg-ink-800 px-6 py-3 text-sm font-medium text-white transition hover:bg-ink-900"
                    >
                      نمایش همهٔ مراکز
                    </button>
                  </div>
                ) : view === 'cards' ? (
                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {visible.map((c, i) => (
                      <CenterCard
                        key={c.id}
                        c={c}
                        index={i}
                        demo={isDemo}
                        tokens={tokens}
                        fav={favIds.has(c.id)}
                        onFav={toggleFav}
                        onOpen={setDetail}
                        onRoute={setRouting}
                        onCopy={copy}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="print-plain overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                    <table className="w-full min-w-[760px] text-right text-sm">
                      <thead className="sticky bg-slate-50 text-xs text-slate-500" style={{ top: barH + 62 }}>
                        <tr>
                          {['', 'نام مرکز', 'دسته', 'استان / شهر', 'آدرس', 'تلفن', ''].map((h, i) => (
                            <th key={i} className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visible.map((c) => (
                          <tr key={c.id} className="align-top transition hover:bg-gold-50/50">
                            <td className="px-3 py-3">
                              <button
                                onClick={() => toggleFav(c.id)}
                                aria-label={favIds.has(c.id) ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
                                className={favIds.has(c.id) ? 'text-gold-400' : 'text-slate-300 hover:text-gold-400'}
                              >
                                <Icon name="star" className="h-4 w-4" fill={favIds.has(c.id)} />
                              </button>
                            </td>
                            <td className="px-3 py-3 font-semibold text-ink-900">
                              <button className="text-right transition hover:text-ink-600" onClick={() => setDetail(c)}>
                                <Highlight text={c.name} tokens={tokens} />
                              </button>
                            </td>
                            <td className="px-3 py-3 text-xs text-slate-600">{c.category}</td>
                            <td className="px-3 py-3 text-xs">{[c.province, c.city].filter(Boolean).join('، ')}</td>
                            <td className="max-w-xs px-3 py-3 text-xs leading-6 text-slate-600">
                              <Highlight text={c.address} tokens={tokens} />
                            </td>
                            <td className="px-3 py-3 text-xs" dir="ltr">
                              {c.phones.slice(0, 2).map((p, i) => (
                                <a key={i} href={`tel:${p.tel}`} className="block tabular-nums text-slate-800 transition hover:text-ink-600">
                                  {toFa(p.label)}
                                </a>
                              ))}
                            </td>
                            <td className="px-3 py-3">
                              <button onClick={() => setRouting(c)} aria-label="انتخاب مسیریاب" className="text-ink-600 transition hover:text-ink-950">
                                <Icon name="pin" className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {results.length > visible.length && (
                  <div className="no-print mt-6 text-center">
                    <button
                      onClick={() => setLimit((l) => l + (view === 'cards' ? 24 : 50))}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3 text-sm font-semibold text-ink-800 shadow ring-1 ring-slate-200 transition hover:bg-ink-50"
                    >
                      <Icon name="plus" className="h-4 w-4" />
                      نمایش بیشتر
                      <span className="text-slate-400">({fmtNum(results.length - visible.length)} مورد باقی‌مانده)</span>
                    </button>
                  </div>
                )}
              </section>
            </div>

            {/* ---------- راهنما ---------- */}
            <section className="no-print mt-14">
              <h3 className="mb-4 text-center text-sm font-bold text-ink-900">چطور از این سامانه استفاده کنیم؟</h3>
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  ['۱', 'مرکز را پیدا کنید', 'با جستجو یا فیلتر استان، شهر و نوع مرکز، مراکز طرف قرارداد را ببینید.'],
                  ['۲', 'قبل از مراجعه تماس بگیرید', 'برای اطمینان از ساعت کاری، نوع خدمات و تعهدات، با شمارهٔ درج‌شده هماهنگ کنید.'],
                  ['۳', 'مدارک را همراه داشته باشید', 'کارت ملی و کارت/دفترچهٔ بیمهٔ درمان را همراه ببرید و جزئیات را از مرکز بپرسید.'],
                ].map(([n, t, d]) => (
                  <div key={n} className="print-plain relative overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                    <span className="absolute -left-6 -top-6 h-20 w-20 rounded-full bg-gold-50" aria-hidden="true" />
                    <div className="relative mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gold-100 font-extrabold text-gold-700">
                      {n}
                    </div>
                    <h4 className="relative font-bold text-ink-900">{t}</h4>
                    <p className="relative mt-1.5 text-sm leading-7 text-slate-500">{d}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="no-print border-t border-slate-200 bg-white py-8 text-center text-xs leading-7 text-slate-500">
        <div className="mx-auto max-w-3xl px-4">
          <p className="flex items-center justify-center gap-2 font-semibold text-ink-800">
            <Icon name="shield" className="h-4 w-4 text-gold-500" />
            سامانهٔ جستجوی مراکز طرف قرارداد بیمهٔ تکمیلی درمان
          </p>
          <p className="mt-3">
            اطلاعات این سامانه مطابق آخرین فایل مراکز طرف قرارداد بارگذاری‌شده است و ممکن است تغییر کرده باشد؛ پیش از مراجعه، وضعیت قرارداد
            مرکز را استعلام کنید.
          </p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            {meta && (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5">
                  <Icon name="file" className="h-3 w-3" />
                  {meta.source === 'demo' ? meta.fileName : <span dir="ltr">{meta.fileName}</span>}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5">
                  <Icon name="refresh" className="h-3 w-3" />
                  {meta.source === 'demo' ? 'جایگزین با بارگذاری فایل واقعی' : SOURCE_LABEL[meta.source]} •{' '}
                  {new Date(meta.loadedAt).toLocaleDateString('fa-IR')}
                </span>
              </>
            )}
            <button onClick={() => setModal('report')} className="rounded-full px-2.5 py-0.5 font-medium text-ink-600 underline decoration-dotted underline-offset-4 hover:text-ink-900">
              گزارش بررسی اکسل
            </button>
          </p>
          <p className="mt-4 hidden items-center justify-center gap-2 text-slate-400 sm:flex">
            <Icon name="keyboard" className="h-3.5 w-3.5" />
            میان‌بر: <Kbd>/</Kbd> برای جستجو، <Kbd>Esc</Kbd> برای بستن پنجره‌ها
          </p>
        </div>
      </footer>

      {/* ---------- کشوی فیلتر موبایل ---------- */}
      {showFilters && (
        <Modal onClose={() => setShowFilters(false)} sheet labelledBy="filter-title" maxWidth="max-w-xl">
          <div className="overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="filter-title" className="flex items-center gap-2 font-bold text-ink-900">
                <Icon name="filter" className="h-4 w-4 text-gold-500" /> فیلتر پیشرفته
              </h3>
              <button onClick={() => setShowFilters(false)} aria-label="بستن" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"><Icon name="x" /></button>
            </div>
            <FilterPanel
              filters={filters}
              catFacet={catFacet}
              provFacet={provFacet}
              cityFacet={cityFacet}
              kindFacet={kindFacet}
              favCount={favIds.size}
              onPatch={set}
              onReset={() => setFilters(EMPTY_FILTERS)}
            />
            <button
              onClick={() => setShowFilters(false)}
              className="mt-5 w-full rounded-xl bg-ink-800 py-3 font-medium text-white transition hover:bg-ink-900"
            >
              نمایش {fmtNum(results.length)} مرکز
            </button>
          </div>
        </Modal>
      )}

      {detail && <DetailModal c={detail} fav={favIds.has(detail.id)} onFav={toggleFav} onClose={() => setDetail(null)} onCopy={copy} onRoute={() => { setDetail(null); setRouting(detail); }} />}

      {routing && <RoutingModal key={routing.id} c={routing} demo={isDemo} onClose={() => setRouting(null)} onCopy={copy} />}

      {modal && (
        <ImportModal
          tab={modal}
          report={report}
          meta={meta}
          busy={busy || booting}
          status={status}
          onFile={handleFile}
          onRemote={handleRemote}
          onReset={handleReset}
          onClose={() => setModal(null)}
        />
      )}

      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="بازگشت به بالا"
          className="no-print fixed bottom-5 left-5 z-30 animate-pop rounded-full bg-ink-800 p-3 text-white shadow-xl transition hover:bg-ink-950"
        >
          <Icon name="arrowUp" />
        </button>
      )}

      {toast && (
        <div
          role="status"
          className="no-print fixed bottom-6 left-1/2 z-[60] flex animate-toast items-center gap-2 rounded-xl bg-ink-950 px-5 py-3 text-sm text-white shadow-2xl"
        >
          <Icon name="check" className="h-4 w-4 text-gold-300" />
          {toast}
        </div>
      )}
    </div>
  );
}
