import type { PresenterStatus } from '../lib/presenterController.ts';

export const statusMeta: Record<PresenterStatus, { label: string; hint: string; dot: string; text: string }> = {
  idle: { label: 'Offline', hint: 'Start the presenter to begin a live voice session.', dot: 'bg-ink-400', text: 'text-ink-300' },
  connecting: { label: 'Connecting', hint: 'Opening a secure voice session…', dot: 'bg-violet animate-pulse', text: 'text-violet' },
  listening: { label: 'Listening', hint: 'Ask a question — just start talking.', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  thinking: { label: 'Thinking', hint: 'Choosing the right slide and answer…', dot: 'bg-violet animate-pulse', text: 'text-violet' },
  speaking: { label: 'Speaking', hint: 'Talk at any time to interrupt.', dot: 'bg-accent', text: 'text-accent' },
  interrupted: { label: 'Interrupted', hint: 'Stopped — handling your new question.', dot: 'bg-warn', text: 'text-warn' },
  error: { label: 'Error', hint: 'Something went wrong — see details below.', dot: 'bg-danger', text: 'text-danger' },
};
