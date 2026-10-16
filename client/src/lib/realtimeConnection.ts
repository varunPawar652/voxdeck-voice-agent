import type { ClientEvent } from '../types/realtime.ts';

/** GA WebRTC endpoint: the browser posts its SDP offer here with the ephemeral key. */
export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export class ConnectionError extends Error {
  override name = 'ConnectionError';
  constructor(
    message: string,
    readonly kind: 'microphone' | 'network' | 'upstream' | 'closed',
  ) {
    super(message);
  }
}

export interface ConnectionHandlers {
  onEvent(event: unknown): void;
  onOpen(): void;
  /** Fired once if the peer connection or data channel fails after being established. */
  onLost(reason: string): void;
}

/**
 * One WebRTC call to the Realtime API: microphone track up, model audio track down,
 * and the `oai-events` data channel for JSON events in both directions.
 */
export class RealtimeConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private closedByUser = false;
  micStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;

  constructor(
    private readonly audioEl: HTMLAudioElement,
    private readonly handlers: ConnectionHandlers,
  ) {}

  /** Phase timings of the last connect(), for diagnostics. */
  timings = { micMs: 0, sdpMs: 0, channelMs: 0 };

  /**
   * Opens the microphone. Separate from connect() so callers can run it in parallel
   * with minting the session credential (saves up to ~1 s of connect time).
   */
  async prepareMicrophone(): Promise<void> {
    if (this.micStream) return;
    const started = performance.now();
    // Echo cancellation is essential for barge-in on laptop speakers —
    // without it the model hears itself and "interrupts" its own answer.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      throw new ConnectionError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access was blocked. Allow the microphone in your browser\'s site settings, then reconnect.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Connect one and try again.'
            : 'Could not start the microphone.',
        'microphone',
      );
    }
    this.timings.micMs = Math.round(performance.now() - started);
  }

  async connect(clientSecret: string, signal?: AbortSignal): Promise<void> {
    // 1. Microphone (usually already opened by prepareMicrophone()).
    await this.prepareMicrophone();
    if (signal?.aborted) throw new ConnectionError('Connection cancelled.', 'closed');
    const micStream = this.micStream!;

    // 2. Peer connection: our mic out, the model's voice in.
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (e) => {
      this.remoteStream = e.streams[0] ?? new MediaStream([e.track]);
      this.audioEl.srcObject = this.remoteStream;
      void this.audioEl.play().catch(() => {
        /* autoplay is allowed: connect() is always triggered by a click */
      });
    };
    for (const track of micStream.getAudioTracks()) pc.addTrack(track, micStream);

    pc.onconnectionstatechange = () => {
      if (this.closedByUser) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.handlers.onLost('The voice connection was lost.');
      }
    };

    // 3. Data channel for Realtime events. Must exist before the offer is created.
    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = (e) => {
      try {
        this.handlers.onEvent(JSON.parse(e.data as string));
      } catch {
        console.warn('[realtime] ignored non-JSON data-channel message');
      }
    };
    const opened = new Promise<void>((resolve, reject) => {
      dc.onopen = () => resolve();
      dc.onerror = () => reject(new ConnectionError('The event channel failed to open.', 'network'));
    });
    dc.onclose = () => {
      if (!this.closedByUser) this.handlers.onLost('The voice session ended.');
    };

    // 4. SDP exchange directly with OpenAI, authenticated by the short-lived secret.
    const sdpStarted = performance.now();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    let response: Response;
    try {
      response = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        signal,
      });
    } catch {
      throw new ConnectionError('Could not reach the OpenAI Realtime API. Check your network connection.', 'network');
    }
    if (!response.ok) {
      throw new ConnectionError(await describeCallFailure(response), 'upstream');
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    this.timings.sdpMs = Math.round(performance.now() - sdpStarted);

    const channelStarted = performance.now();
    await withTimeout(opened, 10_000, new ConnectionError('Timed out waiting for the voice session to open.', 'network'));
    this.timings.channelMs = Math.round(performance.now() - channelStarted);
    this.handlers.onOpen();
  }

  send(event: ClientEvent): boolean {
    if (this.dc?.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(event));
    return true;
  }

  setMicEnabled(enabled: boolean) {
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  close() {
    this.closedByUser = true;
    try {
      this.dc?.close();
    } catch {
      /* already closed */
    }
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.audioEl.srcObject = null;
    this.pc = null;
    this.dc = null;
    this.micStream = null;
    this.remoteStream = null;
  }
}

/** Turns an SDP-exchange failure into an actionable message using OpenAI's error code. */
export async function describeCallFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; type?: string } } | null;
  const code = body?.error?.code ?? body?.error?.type;
  if (response.status === 401) return 'The session credential was rejected or expired. Please reconnect.';
  if (code === 'insufficient_quota' || code === 'credit_balance_exhausted' || body?.error?.type === 'insufficient_quota') {
    return 'Your OpenAI account has no API credits left. Add credits at platform.openai.com → Settings → Billing, then reconnect.';
  }
  if (response.status === 429) return 'OpenAI rate limit reached. Wait a few seconds and reconnect.';
  return `The Realtime API refused the call (HTTP ${response.status}${code ? `: ${code}` : ''}).`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
