import { useRef, useState } from 'react';
import type { SheetReport } from '../lib/parser';
import { FIELD_LABEL } from '../lib/parser';
import type { Meta } from '../lib/storage';
import { fmtNum } from '../lib/text';
import { Icon } from './ui';

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
  name: 'bg-blue-100 text-blue-800',
  province: 'bg-violet-100 text-violet-800',
  city: 'bg-violet-100 text-violet-800',
  address: 'bg-rose-100 text-rose-800',
  phone: 'bg-emerald-100 text-emerald-800',
  discount: 'bg-amber-100 text-amber-800',
  extra: 'bg-slate-100 text-slate-600',
};

export function ImportModal({ tab: initial, report, meta, busy, status, onFile, onRemote, onReset, onClose }: Props) {
  const [tab, setTab] = useState(initial);
  const [drag, setDrag] = useState(false);
  const [url, setUrl] = useState('https://sphbank.ir/hr');
  const input = useRef<HTMLInputElement>(null);
  const total = report.reduce((a, r) => a + r.imported, 0);
  const rawRows = report.reduce((a, r) => a + r.rows, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
            {([['import', 'بارگذاری فایل داده'], ['report', 'گزارش بررسی اکسل']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-1.5 font-medium transition ${tab === k ? 'bg-white text-blue-900 shadow' : 'text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
            <Icon name="x" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
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
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${drag ? 'border-amber-500 bg-amber-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50'}`}
              >
                <input ref={input} type="file" accept=".xlsx,.xls,.xlsm,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
                  <Icon name="upload" className="h-7 w-7" />
                </div>
                <p className="font-bold text-slate-800">فایل اکسل مراکز را اینجا رها کنید یا کلیک کنید</p>
                <p className="mt-1 text-sm text-slate-500">فرمت‌های xlsx / xls / csv — همه شیت‌ها به‌صورت خودکار بررسی و ادغام می‌شوند</p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">یا دریافت آنلاین از آدرس صفحه / فایل</label>
                <div className="flex gap-2">
                  <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
                  <button disabled={busy} onClick={() => onRemote(url)} className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-5 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-50">
                    <Icon name="download" className="h-4 w-4" /> دریافت
                  </button>
                </div>
                <p className="mt-2 text-xs leading-6 text-slate-400">
                  اگر سرور مبدأ دسترسی بین‌دامنه‌ای (CORS) را مجاز نکرده باشد، دریافت آنلاین ممکن است ناموفق باشد؛ در این صورت فایل را دانلود و از بخش بالا بارگذاری کنید.
                </p>
              </div>

              {(busy || status) && (
                <div className="flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-800" />}
                  {status}
                </div>
              )}

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                <p className="mb-1 font-semibold text-slate-800">نکات</p>
                <ul className="list-disc space-y-1 pr-5">
                  <li>داده‌ها فقط در مرورگر همین دستگاه ذخیره می‌شوند (بدون سرور و بدون دیتابیس).</li>
                  <li>برای انتشار دائمی برای همه کاربران، فایل را با نام <code dir="ltr" className="rounded bg-white px-1.5">centers.xlsx</code> در مسیر <code dir="ltr" className="rounded bg-white px-1.5">public/data/</code> قرار دهید تا هنگام ورود خودکار خوانده شود.</li>
                  <li>هدر ستون‌ها (نام، استان، شهر، آدرس، تلفن، …)، سلول‌های ادغام‌شده، هدرهای تکراری و ردیف‌های عنوان به‌صورت هوشمند شناسایی می‌شوند.</li>
                </ul>
              </div>

              {meta && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-sm">
                  <div>
                    <p className="font-semibold text-slate-800">فایل فعلی: <span dir="ltr">{meta.fileName}</span></p>
                    <p className="text-xs text-slate-500">{fmtNum(total)} مرکز — {new Date(meta.loadedAt).toLocaleString('fa-IR')}</p>
                  </div>
                  <button onClick={onReset} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-rose-600 hover:bg-rose-50">
                    <Icon name="trash" className="h-4 w-4" /> حذف داده ذخیره‌شده
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'report' && (
            <div className="space-y-4">
              {report.length === 0 ? (
                <p className="py-10 text-center text-slate-400">هنوز فایلی بارگذاری نشده است.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[['تعداد شیت', report.length], ['ردیف‌های دارای داده', rawRows], ['مراکز بارگذاری‌شده', total]].map(([l, v]) => (
                      <div key={l as string} className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-2xl font-extrabold text-blue-900">{fmtNum(v as number)}</p>
                        <p className="text-xs text-slate-500">{l}</p>
                      </div>
                    ))}
                  </div>
                  {report.map((r, i) => (
                    <details key={i} className="group rounded-2xl border border-slate-200" open={r.imported === 0 || r.notes.some((n) => n.includes('حدس'))}>
                      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                        <span className="flex items-center gap-2 font-semibold text-slate-800">
                          <Icon name={r.imported === 0 ? 'alert' : 'check'} className={`h-4 w-4 ${r.imported === 0 ? 'text-rose-500' : 'text-emerald-600'}`} />
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
                            <summary className="cursor-pointer">ردیف‌های کنار گذاشته‌شده / عنوان ({fmtNum(r.skipped.length)})</summary>
                            <ul className="mt-2 space-y-1">
                              {r.skipped.map((s, j) => (
                                <li key={j}>ردیف {fmtNum(s.row)} — {s.reason}: <span className="text-slate-700">{s.text}</span></li>
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
      </div>
    </div>
  );
}
