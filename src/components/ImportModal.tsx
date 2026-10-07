import { useEffect, useRef, useState } from 'react';
import { FIELD_LABEL, type SheetReport } from '../lib/parser';
import type { Meta } from '../lib/storage';
import { fmtNum } from '../lib/text';
import { Modal, ModalHeader } from './Modal';
import { Icon, Spinner } from './ui';

interface Props {
  tab: 'import' | 'report';
  report: SheetReport[];
  meta: Meta | null;
  busy: boolean;
  status: string;
  onFile: (f: File) => void;
  onRemote: (url: string) => void;
  onReset: () => void;
  onClose: () => void;
}

const FIELD_COLOR: Record<string, string> = {
  name: 'bg-ink-100 text-ink-800',
  province: 'bg-violet-100 text-violet-800',
  city: 'bg-violet-100 text-violet-800',
  address: 'bg-rose-100 text-rose-800',
  phone: 'bg-emerald-100 text-emerald-800',
  discount: 'bg-gold-100 text-gold-700',
  extra: 'bg-slate-100 text-slate-600',
};

export function ImportModal({ tab: requested, report, meta, busy, status, onFile, onRemote, onReset, onClose }: Props) {
  const [tab, setTab] = useState(requested);
  const [drag, setDrag] = useState(false);
  const [url, setUrl] = useState('https://sphbank.ir/hr');
  const [confirmReset, setConfirmReset] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const total = report.reduce((a, r) => a + r.imported, 0);
  const rawRows = report.reduce((a, r) => a + r.rows, 0);

  // اگر کاربر از نوار بالا مستقیماً «گزارش» را باز کند، تب داخلی هم باید عوض شود
  useEffect(() => setTab(requested), [requested]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" labelledBy="import-title">
      <ModalHeader id="import-title" title="داده‌های سامانه" subtitle="بارگذاری فایل اکسل مراکز طرف قرارداد یا مشاهدهٔ گزارش استخراج" onClose={onClose} />

      <div className="flex gap-1 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-6">
        {([['import', 'بارگذاری فایل'], ['report', 'گزارش بررسی اکسل']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-current={tab === k}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === k ? 'bg-white text-ink-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto p-5 sm:p-6">
        {tab === 'import' && (
          <div className="space-y-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) onFile(f);
              }}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition sm:p-10 ${
                drag ? 'border-gold-400 bg-gold-50' : 'border-slate-300 bg-slate-50 hover:border-ink-300 hover:bg-ink-50/60'
              }`}
            >
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
              />
              <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl transition ${drag ? 'bg-gold-100 text-gold-600' : 'bg-ink-100 text-ink-700'}`}>
                <Icon name="upload" className="h-7 w-7" />
              </div>
              <p className="font-bold text-ink-900">فایل اکسل مراکز را اینجا رها کنید یا کلیک کنید</p>
              <p className="mt-1 text-sm text-slate-500">فرمت‌های xlsx / xls / csv — همهٔ شیت‌ها به‌صورت خودکار بررسی و ادغام می‌شوند</p>
              {busy && (
                <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-ink-700">
                  <Spinner className="h-4 w-4" /> در حال پردازش…
                </p>
              )}
            </div>

            <div>
              <label htmlFor="remote-url" className="mb-2 block text-sm font-semibold text-slate-700">
                یا دریافت آنلاین از آدرس صفحه / فایل
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="remote-url"
                  dir="ltr"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/centers.xlsx"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-ink-400 focus:ring-4 focus:ring-ink-100"
                />
                <button
                  disabled={busy || !url.trim()}
                  onClick={() => onRemote(url)}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ink-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
                >
                  <Icon name="download" className="h-4 w-4" /> دریافت
                </button>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                اگر سرور مبدأ دسترسی بین‌دامنه‌ای (CORS) را مجاز نکرده باشد، دریافت آنلاین ممکن است ناموفق باشد؛ در این صورت فایل را دانلود و از بخش بالا بارگذاری کنید.
              </p>
            </div>

            {status && (
              <div className="flex items-start gap-3 rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-800">
                <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                <span>{status}</span>
              </div>
            )}

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
              <p className="mb-1 font-semibold text-ink-900">نکات</p>
              <ul className="list-disc space-y-1 pr-5">
                <li>داده‌ها فقط در مرورگر همین دستگاه ذخیره می‌شوند (بدون سرور و بدون دیتابیس).</li>
                <li>
                  برای انتشار دائمی برای همهٔ کاربران، فایل را با نام{' '}
                  <code dir="ltr" className="rounded bg-white px-1.5 text-xs">centers.xlsx</code> در مسیر{' '}
                  <code dir="ltr" className="rounded bg-white px-1.5 text-xs">public/data/</code> قرار دهید تا هنگام ورود خودکار خوانده شود.
                </li>
                <li>هدر ستون‌ها (نام، استان، شهر، آدرس، تلفن، …)، سلول‌های ادغام‌شده، هدرهای تکراری و ردیف‌های عنوان به‌صورت هوشمند شناسایی می‌شوند.</li>
              </ul>
            </div>

            {meta && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">
                    فایل فعلی: <span dir="ltr">{meta.fileName}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtNum(total)} مرکز — {new Date(meta.loadedAt).toLocaleString('fa-IR')}
                  </p>
                </div>
                {confirmReset ? (
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => { onReset(); setConfirmReset(false); }}
                      className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700"
                    >
                      بله، حذف شود
                    </button>
                    <button onClick={() => setConfirmReset(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
                      انصراف
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-rose-600 transition hover:bg-rose-50"
                  >
                    <Icon name="trash" className="h-4 w-4" /> حذف دادهٔ ذخیره‌شده
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'report' && (
          <div className="space-y-4">
            {report.length === 0 ? (
              <div className="py-14 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Icon name="file" className="h-7 w-7" />
                </div>
                <p className="text-slate-500">هنوز فایلی بارگذاری نشده است.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 text-center">
                  {[['تعداد شیت', report.length], ['ردیف‌های دارای داده', rawRows], ['مراکز بارگذاری‌شده', total]].map(([l, v]) => (
                    <div key={l as string} className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                      <p className="text-2xl font-extrabold text-ink-900">{fmtNum(v as number)}</p>
                      <p className="mt-1 text-xs text-slate-500">{l}</p>
                    </div>
                  ))}
                </div>
                {report.map((r, i) => (
                  <details
                    key={i}
                    className="overflow-hidden rounded-2xl border border-slate-200"
                    open={r.imported === 0 || r.notes.some((n) => n.includes('حدس'))}
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50">
                      <span className="flex items-center gap-2 font-semibold text-ink-900">
                        <Icon
                          name={r.imported === 0 ? 'alert' : 'check'}
                          className={`h-4 w-4 ${r.imported === 0 ? 'text-rose-500' : 'text-emerald-600'}`}
                        />
                        {r.sheet}
                      </span>
                      <span className="text-xs text-slate-500">
                        {fmtNum(r.imported)} مرکز از {fmtNum(r.rows)} ردیف {r.headerRow ? `• هدر: ردیف ${fmtNum(r.headerRow)}` : ''}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-1.5">
                        {r.mapping.map((m, j) => (
                          <span key={j} className={`rounded-lg px-2 py-1 text-xs ${FIELD_COLOR[m.field] || FIELD_COLOR.extra}`}>
                            {m.header} ← {FIELD_LABEL[m.field] || m.field}
                          </span>
                        ))}
                      </div>
                      {r.notes.length > 0 && (
                        <ul className="list-disc space-y-1 pr-5 text-xs leading-6 text-amber-700">
                          {r.notes.map((n, j) => <li key={j}>{n}</li>)}
                        </ul>
                      )}
                      {r.skipped.length > 0 && (
                        <details className="text-xs text-slate-500">
                          <summary className="cursor-pointer font-medium">ردیف‌های کنار گذاشته‌شده / عنوان ({fmtNum(r.skipped.length)})</summary>
                          <ul className="mt-2 space-y-1">
                            {r.skipped.map((s, j) => (
                              <li key={j}>
                                ردیف {fmtNum(s.row)} — {s.reason}: <span className="text-slate-700">{s.text}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </details>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
