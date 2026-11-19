import { useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import {
  ShieldCheck,
  Loader,
  AlertTriangle,
  XCircle,
  HelpCircle,
  CheckCircle2,
  KeyRound,
  Link2,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
} from 'lucide-react';
import { agentApi, formatWhen, type AgentStatus, type AuditCheck, type AuditResult, type LinkResult, type PasswordResult } from '@/lib/agentApi';

function checkIcon(status: AuditCheck['status']) {
  if (status === 'pass') return <CheckCircle2 size={24} className="text-emerald-600" />;
  if (status === 'warn') return <AlertTriangle size={24} className="text-amber-600" />;
  if (status === 'fail') return <XCircle size={24} className="text-red-600" />;
  return <HelpCircle size={24} className="text-slate-400" />;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const color = score >= 90 ? '#059669' : score >= 70 ? '#d97706' : '#dc2626';
  return (
    <div className="relative h-40 w-40 shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="12" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-extrabold text-slate-900">{score}</span>
        <span className="text-sm font-semibold text-slate-500">out of 100</span>
      </div>
    </div>
  );
}

export default function SecurityChecks() {
  const search = useSearch();
  const highlight = new URLSearchParams(search).get('highlight');

  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [lastAudit, setLastAudit] = useState<{ at: string | null; score: number | null }>({ at: null, score: null });

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordResult, setPasswordResult] = useState<PasswordResult | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [link, setLink] = useState('');
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const passwordRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status: AgentStatus = await agentApi.status();
        setLastAudit({ at: status.last_audit, score: status.last_score });
      } catch {
        // The run button reports service errors.
      }
    })();
  }, []);

  useEffect(() => {
    if (highlight === 'password') passwordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlight === 'link') linkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  const runAudit = async () => {
    setAuditing(true);
    setAuditError(null);
    try {
      setAudit(await agentApi.securityAudit());
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'The safety check could not finish.');
    } finally {
      setAuditing(false);
    }
  };

  const checkPassword = async () => {
    if (!password) {
      setPasswordError('Please type a password first.');
      return;
    }
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordResult(null);
    try {
      setPasswordResult(await agentApi.checkPassword(password));
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'The password could not be checked.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const checkLink = async () => {
    if (!link.trim()) {
      setLinkError('Please paste a link first.');
      return;
    }
    setLinkBusy(true);
    setLinkError(null);
    setLinkResult(null);
    try {
      setLinkResult(await agentApi.checkLink(link));
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'The link could not be checked.');
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-8 sm:px-6 md:pb-12">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Safety Check</h1>
      <p className="mt-2 max-w-3xl text-lg leading-relaxed text-slate-600">
        One button checks your computer, and the two boxes below help with suspicious passwords and links from messages.
      </p>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Full safety check</h2>
            <p className="mt-1 text-base text-slate-600">
              Checks your Downloads, virus protection, firewall and Windows. Last check: {formatWhen(lastAudit.at)}
              {lastAudit.score !== null ? ` (score ${lastAudit.score})` : ''}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runAudit()}
            disabled={auditing}
            className="flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-70"
          >
            {auditing ? <Loader size={24} className="animate-spin" /> : <ShieldCheck size={24} />}
            {auditing ? 'Checking…' : audit ? 'Check again' : 'Run my safety check'}
          </button>
        </div>

        {auditError && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
            <AlertTriangle className="mt-0.5 shrink-0" size={22} />
            <p className="text-base font-medium">{auditError}</p>
          </div>
        )}

        {audit && (
          <div className="mt-7">
            <div className="flex flex-col items-center gap-6 rounded-2xl bg-slate-50 p-6 sm:flex-row">
              <ScoreRing score={audit.score} />
              <div>
                <h3 className="text-2xl font-extrabold text-slate-900">{audit.headline}</h3>
                <p className="mt-1 text-base text-slate-600">Checked {formatWhen(audit.audited_at)}</p>
                <ul className="mt-4 space-y-2.5">
                  {audit.checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-3">
                      {checkIcon(check.status)}
                      <div>
                        <p className="text-base font-bold text-slate-800">{check.label}</p>
                        <p className="text-base leading-relaxed text-slate-600">{check.message}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="flex items-center gap-2 text-lg font-bold text-amber-900">
                <Sparkles size={20} />
                What to do next
              </p>
              <ul className="mt-2 space-y-1.5">
                {audit.recommendations.map((recommendation) => (
                  <li key={recommendation} className="flex gap-2 text-base leading-relaxed text-amber-900">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {recommendation}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section ref={passwordRef} className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
              <KeyRound size={26} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Is my password safe?</h2>
              <p className="text-base text-slate-600">I check if it has appeared in known data breaches.</p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void checkPassword();
                }}
                placeholder="Type your password"
                className="h-14 w-full rounded-xl border border-slate-300 px-4 pr-14 text-lg text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                aria-label="Password to check"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void checkPassword()}
              disabled={passwordBusy}
              className="flex h-14 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {passwordBusy ? <Loader size={20} className="animate-spin" /> : <Lock size={20} />}
              Check
            </button>
          </div>

          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <Lock size={14} /> Your password is never stored. Only a scrambled code is sent for the check.
          </p>

          {passwordError && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-base text-red-800">{passwordError}</p>
          )}
          {passwordResult && (
            <div
              className={`mt-3 rounded-2xl border p-4 text-base leading-relaxed ${
                passwordResult.breached ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <p className="font-bold">{passwordResult.breached ? 'This password is not safe.' : 'This password looks safe.'}</p>
              <p className="mt-1">{passwordResult.message}</p>
            </div>
          )}
        </section>

        <section ref={linkRef} className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
              <Link2 size={26} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Is this link safe?</h2>
              <p className="text-base text-slate-600">Paste a link from a message before you open it.</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void checkLink();
              }}
              placeholder="Paste the link here"
              className="h-14 flex-1 rounded-xl border border-slate-300 px-4 text-lg text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              aria-label="Link to check"
            />
            <button
              type="button"
              onClick={() => void checkLink()}
              disabled={linkBusy}
              className="flex h-14 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {linkBusy ? <Loader size={20} className="animate-spin" /> : <ShieldCheck size={20} />}
              Check
            </button>
          </div>

          {linkError && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-base text-red-800">{linkError}</p>
          )}
          {linkResult && (
            <div
              className={`mt-3 rounded-2xl border p-4 ${
                linkResult.verdict === 'DANGEROUS'
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : linkResult.verdict === 'SUSPICIOUS'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <p className="text-base font-bold">
                {linkResult.verdict === 'DANGEROUS' ? 'Do not open this link.' : linkResult.verdict === 'SUSPICIOUS' ? 'Be careful with this link.' : 'This link looks safe.'}
              </p>
              <p className="mt-1 break-all text-sm opacity-80">{linkResult.host}</p>
              <p className="mt-1 text-base leading-relaxed">{linkResult.advice}</p>
              {linkResult.reasons.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {linkResult.reasons.slice(0, 4).map((reason) => (
                    <li key={reason} className="flex gap-2 text-base leading-relaxed">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
        <h2 className="text-2xl font-bold text-slate-900">Good to remember</h2>
        <ul className="mt-3 grid gap-3 text-base leading-relaxed text-slate-700 sm:grid-cols-2">
          <li className="rounded-2xl bg-slate-50 p-4">Banks never ask for your password or the code sent to your phone.</li>
          <li className="rounded-2xl bg-slate-50 p-4">Do not install apps from links in messages. Use the official app store.</li>
          <li className="rounded-2xl bg-slate-50 p-4">If a call feels urgent or scary, hang up and call someone you trust first.</li>
          <li className="rounded-2xl bg-slate-50 p-4">Check your computer with this page every week.</li>
        </ul>
      </section>
    </div>
  );
}
