import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  ShieldCheck,
  FolderDown,
  PhoneCall,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  KeyRound,
  Link2,
  Trash2,
} from 'lucide-react';
import { agentApi, formatWhen, type AgentStatus } from '@/lib/agentApi';

const ACTIVITY_ICONS: Record<string, typeof FolderDown> = {
  scan: FolderDown,
  quarantine: ShieldCheck,
  delete: Trash2,
  audit: ShieldCheck,
  link: Link2,
  password: KeyRound,
};

function statusSummary(status: AgentStatus | null) {
  if (!status) {
    return {
      tone: 'neutral' as const,
      title: 'Ready when you are',
      detail: 'Run your first check and I will tell you if anything needs attention.',
    };
  }
  const dangerous = status.last_scan_counts?.dangerous ?? 0;
  if (dangerous > 0) {
    return {
      tone: 'danger' as const,
      title: 'Something needs your attention',
      detail: `${dangerous} dangerous file${dangerous === 1 ? '' : 's'} found in your Downloads folder. I can clean it up for you.`,
    };
  }
  if (status.last_score !== null && status.last_score !== undefined) {
    if (status.last_score >= 90) {
      return { tone: 'safe' as const, title: 'You are well protected', detail: `Your last safety check scored ${status.last_score} out of 100. Keep it up.` };
    }
    if (status.last_score >= 70) {
      return { tone: 'warning' as const, title: 'Mostly safe', detail: `Your last safety check scored ${status.last_score} out of 100. There are a few things to fix.` };
    }
    return { tone: 'danger' as const, title: 'Your computer needs attention', detail: `Your last safety check scored ${status.last_score} out of 100. Please look at the items below.` };
  }
  return {
    tone: 'neutral' as const,
    title: 'Ready when you are',
    detail: 'Your computer has not been checked yet. It only takes a minute.',
  };
}

const TONES = {
  safe: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-slate-200 bg-white text-slate-900',
};

const ACTIONS = [
  {
    href: '/downloads',
    icon: FolderDown,
    title: 'Check my Downloads',
    detail: 'Look for dangerous apps and files, and clean them up.',
    color: 'bg-blue-50 text-blue-700',
  },
  {
    href: '/calls',
    icon: PhoneCall,
    title: 'Guard a phone call',
    detail: 'Listen for a fake robot voice while you are on a suspicious call.',
    color: 'bg-violet-50 text-violet-700',
  },
  {
    href: '/checks',
    icon: ShieldCheck,
    title: 'Run a safety check',
    detail: 'Check your computer, your passwords and links in messages.',
    color: 'bg-emerald-50 text-emerald-700',
  },
];

export default function Home() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await agentApi.status());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the Shield helper.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const summary = statusSummary(status);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-8 sm:px-6 md:pb-12">
      <p className="text-lg font-semibold text-slate-500">Welcome back</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
        Let&apos;s keep you safe.
      </h1>

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
          <AlertTriangle className="mt-0.5 shrink-0" size={24} />
          <div className="text-base">
            <p className="font-bold">The Shield helper is not running.</p>
            <p className="mt-1">{error}</p>
            <p className="mt-1">Start it on this computer, then press Refresh.</p>
          </div>
        </div>
      )}

      <section className={`mt-6 rounded-3xl border p-6 sm:p-8 ${TONES[summary.tone]}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/70">
              {summary.tone === 'safe' ? <ShieldCheck size={34} /> : summary.tone === 'danger' ? <AlertTriangle size={34} /> : <Clock size={34} />}
            </span>
            <div>
              <h2 className="text-2xl font-extrabold sm:text-3xl">{summary.title}</h2>
              <p className="mt-1 max-w-2xl text-lg leading-relaxed opacity-90">{summary.detail}</p>
              <p className="mt-2 text-base opacity-70">
                Last full check: {formatWhen(status?.last_audit ?? null)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white/80 px-5 py-3 text-base font-bold hover:bg-white"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <Link href="/checks">
              <div className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-base font-bold text-white hover:bg-slate-800">
                Run a check
                <ArrowRight size={20} />
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Things you can do">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.href} href={action.href}>
              <div className="flex h-full cursor-pointer flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-300 hover:shadow-md">
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${action.color}`}>
                  <Icon size={28} strokeWidth={2.2} />
                </span>
                <h3 className="mt-4 text-xl font-bold text-slate-900">{action.title}</h3>
                <p className="mt-2 flex-1 text-base leading-relaxed text-slate-600">{action.detail}</p>
                <span className="mt-4 flex items-center gap-2 text-base font-bold text-emerald-700">
                  Open <ArrowRight size={18} />
                </span>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-bold text-slate-900">What I did recently</h2>
        {status?.activity?.length ? (
          <ul className="mt-5 space-y-4">
            {status.activity.map((item) => {
              const Icon = ACTIVITY_ICONS[item.kind] ?? CheckCircle2;
              const tone = item.tone === 'danger' ? 'text-red-600 bg-red-50' : item.tone === 'warning' ? 'text-amber-600 bg-amber-50' : item.tone === 'success' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-500 bg-slate-100';
              return (
                <li key={item.id} className="flex items-start gap-4">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                    <Icon size={22} />
                  </span>
                  <div>
                    <p className="text-base font-medium leading-relaxed text-slate-800">{item.message}</p>
                    <p className="mt-0.5 text-sm text-slate-500">{formatWhen(item.time)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-5 rounded-2xl bg-slate-50 p-6 text-center">
            <p className="text-lg font-medium text-slate-600">Nothing yet.</p>
            <p className="mt-1 text-base text-slate-500">Start with a Downloads check or a full safety check.</p>
          </div>
        )}
      </section>

      <p className="mt-8 text-center text-base leading-relaxed text-slate-500">
        Everything runs on this computer with a small helper app. Your files never leave your computer.
      </p>
    </div>
  );
}
