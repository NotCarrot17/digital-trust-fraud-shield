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
const TARGET_SAMPLE_RATE = 16000;

type Capture = {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
};

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export default function CallGuard() {
  const [consent, setConsent] = useState(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [statusText, setStatusText] = useState('Not listening.');
  const [assessment, setAssessment] = useState<VoiceAssessment | null>(null);
  const [samples, setSamples] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<Capture | null>(null);
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
    const capture = captureRef.current;
    if (capture) {
      try {
        capture.processor.disconnect();
        capture.source.disconnect();
        capture.sink.disconnect();
      } catch {
        // Nodes may already be disconnected.
      }
      void capture.ctx.close().catch(() => undefined);
      captureRef.current = null;
    }
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

  const checkSample = (stream: MediaStream, sessionId: number, ctx: AudioContext) => {
    if (sessionRef.current !== sessionId || !stream.active) return;

    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch {
      setError('This browser cannot listen for voice checks. Please try Chrome or Edge.');
      setActive(false);
      return;
    }
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    const chunks: Float32Array[] = [];

    processor.onaudioprocess = (event) => {
      if (sessionRef.current !== sessionId) return;
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);
    captureRef.current = { ctx, source, processor, sink };
    setStatusText('Listening and checking…');

    stopTimerRef.current = window.setTimeout(() => {
      if (sessionRef.current !== sessionId) return;
      try {
        processor.disconnect();
        source.disconnect();
        sink.disconnect();
      } catch {
        // Nodes may already be disconnected.
      }
      if (captureRef.current?.processor === processor) captureRef.current = null;

      void (async () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (total < ctx.sampleRate * 0.5) {
          timerRef.current = window.setTimeout(() => checkSample(stream, sessionId, ctx), PAUSE_MS);
          return;
        }
        const merged = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        const pcm = downsample(merged, ctx.sampleRate, TARGET_SAMPLE_RATE);
        const blob = encodeWav(pcm, TARGET_SAMPLE_RATE);

        setStatusText('Sending a voice sample to the checker…');
        let response: Response;
        try {
          const form = new FormData();
          form.append('audio_file', blob, 'call-sample.wav');
          response = await fetch(`${FRAUD_API_BASE_URL}/voice-authenticity`, { method: 'POST', body: form });
        } catch {
          if (sessionRef.current !== sessionId) return;
          setError('The voice checker is not reachable. Make sure the Shield helper is running on this computer.');
          setStatusText('Check paused. I will try again.');
          timerRef.current = window.setTimeout(() => checkSample(stream, sessionId, ctx), 4000);
          return;
        }

        if (!response.ok) {
          if (sessionRef.current !== sessionId) return;
          setError('The voice checker had trouble with that sound. Please try again.');
          setStatusText('Check paused. I will try again.');
          timerRef.current = window.setTimeout(() => checkSample(stream, sessionId, ctx), 4000);
          return;
        }

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

        if (sessionRef.current === sessionId) {
          timerRef.current = window.setTimeout(() => checkSample(stream, sessionId, ctx), PAUSE_MS);
        }
      })();
    }, SAMPLE_MS);
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    setAssessment(null);
    setSamples(0);
    spokenRef.current = false;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      setError('This browser cannot listen for voice checks. Please try Chrome or Edge.');
      setStarting(false);
      return;
    }
    // Create the audio context inside the click so browsers allow it to run.
    const ctx = new AudioCtor();
    void ctx.resume().catch(() => undefined);
    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (sessionRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close().catch(() => undefined);
        return;
      }
      streamRef.current = stream;
      setActive(true);
      setStatusText('Starting the microphone…');
      checkSample(stream, sessionId, ctx);
    } catch {
      void ctx.close().catch(() => undefined);
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
