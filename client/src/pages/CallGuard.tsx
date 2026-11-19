import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { PhoneCall, Mic, MicOff, Loader, Volume2, AlertTriangle, ShieldCheck, Info } from 'lucide-react';
import { FRAUD_API_BASE_URL } from '@/const';

type VoiceAssessment = {
  suspected: boolean;
  score: number;
  confidence: string;
  reasons: string[];
  heard_voice?: boolean;
};

const SAMPLE_MS = 6000;
const PAUSE_MS = 1500;

export default function CallGuard() {
  const [consent, setConsent] = useState(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [statusText, setStatusText] = useState('Not listening.');
  const [assessment, setAssessment] = useState<VoiceAssessment | null>(null);
  const [samples, setSamples] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const sessionRef = useRef(0);
  const spokenRef = useRef(false);

  const cleanup = () => {
    sessionRef.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    timerRef.current = null;
    stopTimerRef.current = null;
    try {
      recorderRef.current?.stop();
    } catch {
      // Recorder may already be stopped.
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    window.speechSynthesis?.cancel();
  };

  useEffect(() => {
    return () => cleanup();
  }, []);

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  };

  const risk = assessment ? Math.round(Math.min(1, Math.max(0, assessment.score)) * 100) : 0;

  const verdict = (() => {
    if (!assessment) {
      return { tone: 'neutral', title: 'Waiting for the first check', detail: 'Keep the call on speaker, or hold your phone near the computer.' };
    }
    if (assessment.heard_voice === false) {
      return {
        tone: 'neutral',
        title: 'I need a clearer sound',
        detail: 'Move the phone closer to the computer, or turn the call volume up. Nothing is wrong so far — I just cannot hear the voice well yet.',
      };
    }
    if (risk >= 70) {
      return {
        tone: 'danger',
        title: 'Be very careful. This voice sounds artificial.',
        detail: 'Hang up now and call your family or your bank using the official number. Do not send money.',
      };
    }
    if (risk >= 40) {
      return {
        tone: 'warning',
        title: 'Something sounds unusual.',
        detail: 'Ask a question only your family would know. Never share passwords or bank codes.',
      };
    }
    return {
      tone: 'safe',
      title: 'No strong robot-voice signs yet.',
      detail: 'Still stay alert: scammers can sound completely normal. Never share bank codes.',
    };
  })();

  const checkSample = async (stream: MediaStream, sessionId: number) => {
    if (sessionRef.current !== sessionId || !stream.active) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('This browser cannot listen for voice checks. Please try Chrome or Edge.');
      setActive(false);
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      setError('This browser cannot listen for voice checks. Please try Chrome or Edge.');
      setActive(false);
      return;
    }
    recorderRef.current = recorder;
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = async () => {
      if (sessionRef.current !== sessionId) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1000) {
        timerRef.current = window.setTimeout(() => void checkSample(stream, sessionId), PAUSE_MS);
        return;
      }
      setStatusText('Sending a voice sample to the checker…');
      try {
        const form = new FormData();
        form.append('audio_file', blob, 'call-sample.webm');
        const response = await fetch(`${FRAUD_API_BASE_URL}/voice-authenticity`, { method: 'POST', body: form });
        if (!response.ok) throw new Error('voice check failed');
        const result = (await response.json()) as VoiceAssessment;
        if (sessionRef.current !== sessionId) return;
        setAssessment(result);
        setSamples((count) => count + 1);
        setError(null);
        setStatusText(result.heard_voice === false ? 'I need a clearer sound. Move the phone closer.' : 'Listening…');

        if (result.heard_voice !== false && result.suspected && !spokenRef.current) {
          spokenRef.current = true;
          speak('Warning. This voice may be artificial. Please hang up and check with someone you trust.');
        }
        if (!result.suspected) {
          spokenRef.current = false;
        }
      } catch {
        if (sessionRef.current === sessionId) {
          setError('The voice checker is not reachable. Make sure the Shield helper is running on this computer.');
          setStatusText('Check paused.');
        }
        return;
      }

      if (sessionRef.current === sessionId) {
        timerRef.current = window.setTimeout(() => void checkSample(stream, sessionId), PAUSE_MS);
      }
    };

    recorder.start();
    stopTimerRef.current = window.setTimeout(() => {
      try {
        recorder.stop();
      } catch {
        // Already stopped.
      }
    }, SAMPLE_MS);
    setStatusText('Listening and checking…');
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    setAssessment(null);
    setSamples(0);
    spokenRef.current = false;
    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (sessionRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setActive(true);
      setStatusText('Starting the microphone…');
      void checkSample(stream, sessionId);
    } catch {
      setError('I cannot use the microphone. Please allow microphone access for this page, then try again.');
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    cleanup();
    setActive(false);
    setStatusText('Not listening.');
  };

  const verdictStyles: Record<string, string> = {
    danger: 'border-red-200 bg-red-50 text-red-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    safe: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    neutral: 'border-slate-200 bg-white text-slate-900',
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-8 sm:px-6 md:pb-12">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Call Guard</h1>
      <p className="mt-2 max-w-3xl text-lg leading-relaxed text-slate-600">
        If someone you do not know calls and asks for money, turn this on. I listen while the call is on speaker and warn
        you when the voice sounds like a fake robot voice.
      </p>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
        <Info className="mt-0.5 shrink-0" size={24} />
        <div className="text-base leading-relaxed">
          <p className="font-bold">Your privacy is protected.</p>
          <p className="mt-1">I only listen while you press Start. Your call is not recorded or saved. The check happens on this computer.</p>
        </div>
      </div>

      {!active && (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-bold text-slate-900">Before you start</h2>
          <ul className="mt-3 space-y-2 text-base leading-relaxed text-slate-700">
            <li>1. Put your phone on speaker, or hold it near this computer.</li>
            <li>2. Press the big green button below.</li>
            <li>3. Allow the microphone when your browser asks.</li>
          </ul>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 h-6 w-6 shrink-0 accent-emerald-600"
            />
            <span className="text-base leading-relaxed text-slate-700">
              I understand that the microphone will listen to this call while the guard is on.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!consent || starting}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-5 text-xl font-extrabold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {starting ? <Loader size={26} className="animate-spin" /> : <Mic size={26} />}
            {starting ? 'Starting…' : 'Start listening'}
          </button>
          {error && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
              <AlertTriangle className="mt-0.5 shrink-0" size={22} />
              <p className="text-base font-medium">{error}</p>
            </div>
          )}
        </section>
      )}

      {active && (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-200 opacity-60" />
                <Mic size={26} className="relative" />
              </span>
              <div>
                <p className="text-xl font-bold text-slate-900">Listening</p>
                <p className="text-base text-slate-500">{statusText}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 text-lg font-bold text-white hover:bg-slate-800"
            >
              <MicOff size={22} />
              Stop listening
            </button>
          </div>

          <div className="mt-6">
            <div className="flex items-end justify-between">
              <p className="text-base font-semibold uppercase tracking-wide text-slate-500">Live risk</p>
              <p className={`text-5xl font-extrabold ${risk >= 70 ? 'text-red-600' : risk >= 40 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {risk}
                <span className="text-2xl text-slate-400">%</span>
              </p>
            </div>
            <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-700 ${risk >= 70 ? 'bg-red-500' : risk >= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.max(risk, 2)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {samples} voice sample{samples === 1 ? '' : 's'} checked · updates every few seconds
            </p>
          </div>

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
              <AlertTriangle className="mt-0.5 shrink-0" size={22} />
              <p className="text-base font-medium">{error}</p>
            </div>
          )}
        </section>
      )}

      <section className={`mt-6 rounded-3xl border p-6 ${verdictStyles[verdict.tone]}`}>
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/70">
            {verdict.tone === 'danger' ? <AlertTriangle size={30} /> : verdict.tone === 'safe' ? <ShieldCheck size={30} /> : <PhoneCall size={30} />}
          </span>
          <div>
            <h2 className="text-2xl font-extrabold">{verdict.title}</h2>
            <p className="mt-1 text-lg leading-relaxed opacity-90">{verdict.detail}</p>
            {assessment && (
              <button
                type="button"
                onClick={() => speak(`${verdict.title} ${verdict.detail}`)}
                className="mt-4 flex items-center gap-2 rounded-xl border border-black/10 bg-white/80 px-4 py-2.5 text-base font-bold hover:bg-white"
              >
                <Volume2 size={20} />
                Read this aloud
              </button>
            )}
          </div>
        </div>

        {assessment && assessment.reasons.length > 0 && (
          <div className="mt-5 rounded-2xl bg-white/70 p-4">
            <p className="text-base font-bold text-slate-800">What I noticed</p>
            <ul className="mt-2 space-y-1.5">
              {assessment.reasons.slice(0, 4).map((reason) => (
                <li key={reason} className="flex gap-2 text-base leading-relaxed text-slate-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="mt-6 rounded-2xl bg-slate-100 p-4 text-base leading-relaxed text-slate-600">
        Remember: banks, the police and government offices never ask for your password or a code sent to your phone. If
        you feel pressured, hang up and call a family member. You can also{' '}
        <Link href="/checks">
          <span className="cursor-pointer font-bold text-emerald-700 underline">check a link</span>
        </Link>{' '}
        or a phone number with someone you trust.
      </p>
    </div>
  );
}
