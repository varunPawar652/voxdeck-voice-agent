/**
 * Minimal, deliberately loose shapes for the GA Realtime server events we consume.
 * Everything arriving over the data channel is untrusted JSON, so the controller
 * reads fields defensively instead of trusting these types blindly.
 */

export interface FunctionCallItem {
  type: 'function_call';
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: 'completed' | 'in_progress' | 'incomplete';
}

export interface RealtimeResponse {
  id: string;
  status: 'completed' | 'cancelled' | 'failed' | 'incomplete' | 'in_progress';
  status_details?: { reason?: string; type?: string; error?: { message?: string; code?: string } } | null;
  output?: Array<FunctionCallItem | { type: string; [key: string]: unknown }>;
}

export type ServerEvent =
  | { type: 'session.created' | 'session.updated'; session?: unknown }
  | { type: 'input_audio_buffer.speech_started'; item_id?: string; audio_start_ms?: number }
  | { type: 'input_audio_buffer.speech_stopped'; item_id?: string }
  | { type: 'conversation.item.input_audio_transcription.delta'; item_id: string; delta: string }
  | { type: 'conversation.item.input_audio_transcription.completed'; item_id: string; transcript: string }
  | { type: 'conversation.item.input_audio_transcription.failed'; item_id: string }
  | { type: 'response.created'; response: RealtimeResponse }
  | { type: 'response.done'; response: RealtimeResponse }
  | { type: 'response.output_audio_transcript.delta'; response_id: string; item_id: string; delta: string }
  | { type: 'response.output_audio_transcript.done'; response_id: string; item_id: string; transcript: string }
  | { type: 'output_audio_buffer.started' | 'output_audio_buffer.stopped' | 'output_audio_buffer.cleared'; response_id?: string }
  | { type: 'error'; error: { type?: string; code?: string; message?: string; event_id?: string } }
  | { type: string; [key: string]: unknown };

export type ClientEvent =
  | { type: 'response.create'; response?: Record<string, unknown> }
  | { type: 'response.cancel'; response_id?: string }
  | { type: 'output_audio_buffer.clear' }
  | {
      type: 'conversation.item.create';
      item:
        | { type: 'function_call_output'; call_id: string; output: string }
        | { type: 'message'; role: 'system' | 'user'; content: Array<{ type: 'input_text'; text: string }> };
    };
