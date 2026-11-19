import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Bot, X, Send, MessageCircleHeart, Loader, ArrowRight } from 'lucide-react';
import { agentApi, type ChatAction } from '@/lib/agentApi';

type AssistantContextValue = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  suggestions?: string[];
  action?: ChatAction;
};

const GREETING =
  'Hello. I am your Shield Helper. I can check your Downloads for dangerous apps, guard a phone call, or run a safety check on this computer. What would you like me to do?';

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', text: GREETING, suggestions: ['Check my downloads', 'Run a safety check', 'Is this link safe?'] },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  const value: AssistantContextValue = {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: trimmed }]);
      setInput('');
      setSending(true);
      try {
        const response = await agentApi.chat(trimmed);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: response.reply,
            suggestions: response.suggestions,
            action: response.action,
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            text: error instanceof Error ? error.message : 'I could not answer just now. Please try again.',
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  const runAction = (action: ChatAction | undefined) => {
    if (!action) return;
    if (action.type === 'navigate') {
      setLocation(action.highlight ? `${action.target}?highlight=${action.highlight}` : action.target);
      setIsOpen(false);
    } else if (action.type === 'quarantine_prompt') {
      setLocation('/downloads?cleanup=1');
      setIsOpen(false);
    }
  };

  const latestSuggestions = [...messages].reverse().find((m) => m.role === 'assistant' && m.suggestions?.length)?.suggestions;

  return (
    <AssistantContext.Provider value={value}>
      {children}

      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-5 py-4 text-base font-bold text-white shadow-lg shadow-slate-900/25 hover:bg-slate-800 md:bottom-6 md:right-6"
          aria-label="Open Shield Helper"
        >
          <MessageCircleHeart size={24} />
          <span className="hidden sm:inline">Ask for help</span>
        </button>
      )}

      {isOpen && (
        <div className="fixed inset-x-3 bottom-24 z-50 flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:w-[420px]">
          <div className="flex items-center justify-between gap-3 bg-slate-900 px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                <Bot size={22} />
              </span>
              <div className="leading-tight">
                <p className="text-lg font-bold">Shield Helper</p>
                <p className="text-sm text-slate-300">Always here to help</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-2 text-slate-200 hover:bg-white/10"
              aria-label="Close helper"
            >
              <X size={22} />
            </button>
          </div>

          <div ref={listRef} className="flex max-h-[52vh] min-h-[220px] flex-col gap-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-emerald-600 text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {message.text}
                  {message.role === 'assistant' && message.action && (
                    <button
                      type="button"
                      onClick={() => runAction(message.action)}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-base font-bold text-white hover:bg-emerald-700"
                    >
                      {message.action.type === 'quarantine_prompt' ? 'Go to Downloads' : 'Take me there'}
                      <ArrowRight size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-base text-slate-500">
                  <Loader size={18} className="animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {latestSuggestions && !sending && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-white px-4 py-3">
              {latestSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type your question…"
              className="h-12 flex-1 rounded-xl border border-slate-300 px-4 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              aria-label="Message"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      )}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error('useAssistant must be used inside AssistantProvider');
  }
  return context;
}
