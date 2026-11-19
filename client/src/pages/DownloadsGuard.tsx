import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import {
  FolderDown,
  Search,
  Loader,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trash2,
  CheckCircle2,
  FileWarning,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  agentApi,
  formatBytes,
  formatWhen,
  type QuarantineItem,
  type ScanResult,
  type ScannedFile,
  type Verdict,
} from '@/lib/agentApi';

const VERDICT_STYLES: Record<Verdict, { chip: string; border: string; icon: typeof ShieldCheck; label: string }> = {
  DANGEROUS: { chip: 'bg-red-600 text-white', border: 'border-red-200 bg-red-50/60', icon: ShieldAlert, label: 'Dangerous' },
  SUSPICIOUS: { chip: 'bg-amber-500 text-white', border: 'border-amber-200 bg-amber-50/60', icon: AlertTriangle, label: 'Be careful' },
  SAFE: { chip: 'bg-emerald-600 text-white', border: 'border-emerald-200 bg-emerald-50/60', icon: ShieldCheck, label: 'Safe' },
};

function FileCard({ file, selected, onToggle }: { file: ScannedFile; selected: boolean; onToggle: () => void }) {
  const style = VERDICT_STYLES[file.verdict];
  const Icon = style.icon;
  return (
    <label className={`flex cursor-pointer gap-4 rounded-2xl border p-5 transition ${style.border} ${selected ? 'ring-2 ring-emerald-500' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-1 h-6 w-6 shrink-0 accent-emerald-600"
        aria-label={`Select ${file.name}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon size={20} className={file.verdict === 'DANGEROUS' ? 'text-red-600' : file.verdict === 'SUSPICIOUS' ? 'text-amber-600' : 'text-emerald-600'} />
          <p className="break-all text-lg font-bold text-slate-900">{file.name}</p>
          <span className={`rounded-full px-3 py-0.5 text-sm font-bold uppercase tracking-wide ${style.chip}`}>{style.label}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {file.kind} · {formatBytes(file.size_bytes)} · added {formatWhen(file.modified_at)}
        </p>
        <ul className="mt-3 space-y-1.5">
          {file.findings.map((finding) => (
            <li key={finding} className="flex gap-2 text-base leading-relaxed text-slate-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              {finding}
            </li>
          ))}
        </ul>
      </div>
    </label>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
        <h2 className="text-2xl font-extrabold text-slate-900">{title}</h2>
        <div className="mt-3 text-base leading-relaxed text-slate-700">{body}</div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-4 text-lg font-bold text-white disabled:opacity-60 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {busy && <Loader size={20} className="animate-spin" />}
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-4 text-lg font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DownloadsGuard() {
  const search = useSearch();
  const highlightCleanup = new URLSearchParams(search).get('cleanup') === '1';

  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSafe, setShowSafe] = useState(false);
  const [quarantine, setQuarantine] = useState<{ dir: string; items: QuarantineItem[] }>({ dir: '', items: [] });
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QuarantineItem | null>(null);
  const [busy, setBusy] = useState(false);
  const cleanupRef = useRef<HTMLDivElement>(null);

  const loadQuarantine = useCallback(async () => {
    try {
      const result = await agentApi.listQuarantine();
      setQuarantine({ dir: result.quarantine_dir, items: result.items });
    } catch {
      // The main error banner already covers a stopped helper.
    }
  }, []);

  useEffect(() => {
    void loadQuarantine();
  }, [loadQuarantine]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await agentApi.scanDownloads();
      setScan(result);
      setSelected(new Set(result.files.filter((file) => file.verdict === 'DANGEROUS').map((file) => file.path)));
      if (result.counts.dangerous > 0) {
        toast.error(`${result.counts.dangerous} dangerous file${result.counts.dangerous === 1 ? '' : 's'} found.`, { duration: 6000 });
      } else {
        toast.success('No dangerous files found.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check could not finish.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (highlightCleanup && scan && scan.counts.dangerous > 0) {
      cleanupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightCleanup, scan]);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const doCleanup = async () => {
    setBusy(true);
    try {
      const result = await agentApi.quarantineFiles(Array.from(selected));
      if (result.moved.length) {
        toast.success(`${result.moved.length} file${result.moved.length === 1 ? '' : 's'} moved to quarantine. Your computer is safer now.`);
      }
      if (result.failed.length) {
        toast.error(`Some files could not be moved: ${result.failed[0].reason}`);
      }
      setConfirmCleanup(false);
      await Promise.all([loadQuarantine(), runScan()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The files could not be moved.');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (item: QuarantineItem) => {
    try {
      const result = await agentApi.restoreFiles([item.name]);
      if (result.restored.length) toast.success(`${item.original_name} was restored to Downloads.`);
      else toast.error(result.failed[0]?.reason ?? 'The file could not be restored.');
      await Promise.all([loadQuarantine(), runScan()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The file could not be restored.');
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const result = await agentApi.deleteFiles([`${quarantine.dir}/${deleteTarget.name}`]);
      if (result.deleted.length) toast.success('The file was permanently deleted.');
      else toast.error(result.failed[0]?.reason ?? 'The file could not be deleted.');
      setDeleteTarget(null);
      await loadQuarantine();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The file could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const riskyFiles = scan?.files.filter((file) => file.verdict !== 'SAFE') ?? [];
  const safeFiles = scan?.files.filter((file) => file.verdict === 'SAFE') ?? [];
  const dangerousCount = scan?.counts.dangerous ?? 0;
  const selectedDangerous = scan?.files.filter((file) => selected.has(file.path) && file.verdict === 'DANGEROUS').length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-8 sm:px-6 md:pb-12">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Downloads Guard</h1>
      <p className="mt-2 max-w-3xl text-lg leading-relaxed text-slate-600">
        Scammers send fake apps, receipts and programs by download. I check your Downloads folder and can move anything
        dangerous into a safe quarantine folder on this computer.
      </p>

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
          <AlertTriangle className="mt-0.5 shrink-0" size={24} />
          <div>
            <p className="text-lg font-bold">I could not check your Downloads.</p>
            <p className="mt-1 text-base">{error}</p>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          className="flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-70"
        >
          {scanning ? <Loader size={24} className="animate-spin" /> : <Search size={24} />}
          {scanning ? 'Checking your files…' : scan ? 'Check again' : 'Check my Downloads'}
        </button>
        {scan && (
          <p className="text-base text-slate-500">
            Checked {scan.counts.total} file{scan.counts.total === 1 ? '' : 's'} · {formatWhen(scan.scanned_at)}
          </p>
        )}
      </div>

      {scan && scan.counts.total === 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-lg text-slate-600">
          Your Downloads folder is empty. Nothing to check.
        </div>
      )}

      {scan && scan.counts.total > 0 && (
        <>
          <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-3xl font-extrabold text-red-700">{scan.counts.dangerous}</p>
              <p className="text-sm font-semibold text-red-800 sm:text-base">Dangerous</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
              <p className="text-3xl font-extrabold text-amber-700">{scan.counts.suspicious}</p>
              <p className="text-sm font-semibold text-amber-800 sm:text-base">Be careful</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <p className="text-3xl font-extrabold text-emerald-700">{scan.counts.safe}</p>
              <p className="text-sm font-semibold text-emerald-800 sm:text-base">Safe</p>
            </div>
          </div>

          {dangerousCount === 0 && (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
              <CheckCircle2 className="mt-0.5 shrink-0" size={26} />
              <div>
                <p className="text-lg font-bold">Good news. Nothing dangerous was found.</p>
                <p className="mt-1 text-base">Files marked “be careful” are unusual, but not clearly dangerous.</p>
              </div>
            </div>
          )}

          {riskyFiles.length > 0 && (
            <section className="mt-8">
              <h2 className="text-2xl font-bold text-slate-900">Files I am worried about</h2>
              <p className="mt-1 text-base text-slate-600">
                Tick the files you want to remove from your Downloads folder. Dangerous files are already ticked.
              </p>
              <div className="mt-4 space-y-3">
                {riskyFiles.map((file) => (
                  <FileCard key={file.path} file={file} selected={selected.has(file.path)} onToggle={() => toggle(file.path)} />
                ))}
              </div>

              <div ref={cleanupRef} className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
                {dangerousCount > 0 && (
                  <p className="mb-3 text-base font-semibold text-slate-800">
                    {selected.size === 0
                      ? 'Tick at least one file, or let me choose the dangerous ones.'
                      : `${selected.size} file${selected.size === 1 ? '' : 's'} selected.`}
                  </p>
                )}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setConfirmCleanup(true)}
                    disabled={selected.size === 0 || scanning}
                    className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-4 text-lg font-bold text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    <ShieldAlert size={22} />
                    Clean up selected files
                  </button>
                  {selectedDangerous > 0 && selectedDangerous < dangerousCount && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(scan.files.filter((file) => file.verdict === 'DANGEROUS').map((file) => file.path)))}
                      className="rounded-xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Tick all dangerous files
                    </button>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  Clean up moves the files to a quarantine folder. Nothing is deleted, and you can restore them later.
                </p>
              </div>
            </section>
          )}

          {safeFiles.length > 0 && (
            <section className="mt-8">
              <button
                type="button"
                onClick={() => setShowSafe((prev) => !prev)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left"
              >
                <span className="flex items-center gap-3 text-lg font-semibold text-slate-800">
                  <ShieldCheck size={22} className="text-emerald-600" />
                  {safeFiles.length} safe file{safeFiles.length === 1 ? '' : 's'} — nothing to worry about
                </span>
                {showSafe ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
              </button>
              {showSafe && (
                <ul className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                  {safeFiles.map((file) => (
                    <li key={file.path} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
                      <span className="min-w-0 break-all text-base text-slate-700">{file.name}</span>
                      <span className="shrink-0 text-sm text-slate-400">{formatBytes(file.size_bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Quarantine</h2>
            <p className="mt-1 text-base text-slate-600">Files here cannot hurt you. Restore them if you trust them.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-base font-bold text-slate-700">{quarantine.items.length}</span>
        </div>
        {quarantine.items.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-base text-slate-500">Quarantine is empty.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {quarantine.items.map((item) => (
              <li key={item.name} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all text-base font-bold text-slate-900">{item.original_name}</p>
                  <p className="text-sm text-slate-500">
                    {formatBytes(item.size_bytes)} · quarantined {formatWhen(item.quarantined_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void doRestore(item)}
                    className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw size={18} />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(item)}
                    className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-base font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 size={18} />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 flex items-start gap-2 text-base leading-relaxed text-slate-500">
        <FolderDown size={20} className="mt-0.5 shrink-0" />
        Checking: {scan?.downloads_dir ?? 'your Downloads folder on this computer'}. Files are only read on this computer.
      </p>

      {confirmCleanup && (
        <ConfirmDialog
          title="Move these files to quarantine?"
          body={
            <>
              <p>
                {selected.size} file{selected.size === 1 ? '' : 's'} will be moved out of Downloads. You can restore them
                from the Quarantine list at any time.
              </p>
              <p className="mt-2 flex items-center gap-2 font-semibold text-amber-700">
                <FileWarning size={20} />
                Do this only for files you do not trust.
              </p>
            </>
          }
          confirmLabel="Yes, move them"
          busy={busy}
          onCancel={() => setConfirmCleanup(false)}
          onConfirm={() => void doCleanup()}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this file forever?"
          body={
            <>
              <p className="break-all font-semibold">{deleteTarget.original_name}</p>
              <p className="mt-2">This cannot be undone. If you are not sure, choose Cancel and keep it in quarantine.</p>
            </>
          }
          confirmLabel="Delete forever"
          danger
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void doDelete()}
        />
      )}
    </div>
  );
}
