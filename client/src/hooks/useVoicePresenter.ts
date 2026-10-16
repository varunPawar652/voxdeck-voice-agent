import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SLIDE_COUNT } from '@voxdeck/shared';
import { requestSession } from '../lib/api.ts';
import { PresenterController } from '../lib/presenterController.ts';
import { RealtimeConnection } from '../lib/realtimeConnection.ts';

export type NavigationSource = 'agent' | 'user';

export function useVoicePresenter() {
  // The deck: React state is the single source of truth for what is on screen.
  const [currentSlide, setCurrentSlide] = useState(1);
  const [lastSource, setLastSource] = useState<NavigationSource>('user');
  const slideRef = useRef(1);
  const [micEnabled, setMicEnabled] = useState(true);
  const [streams, setStreams] = useState<{ mic: MediaStream | null; remote: MediaStream | null }>({ mic: null, remote: null });

  const connectionRef = useRef<RealtimeConnection | null>(null);
  const attemptRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queuedQuestionRef = useRef<string | undefined>(undefined);

  const applySlide = useCallback((slide: number, source: NavigationSource) => {
    slideRef.current = slide;
    setCurrentSlide(slide);
    setLastSource(source);
  }, []);

  // The refs below are only dereferenced inside callbacks the controller invokes later
  // (on data-channel events), never during render — the lint rule can't see that.
  const [controller] = useState(
    // eslint-disable-next-line react-hooks/refs
    () =>
      new PresenterController((event) => connectionRef.current?.send(event) ?? false, {
        getCurrentSlide: () => slideRef.current,
        goTo: (slide, source) => applySlide(slide, source),
      }),
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  const teardown = useCallback(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setStreams({ mic: null, remote: null });
  }, []);

  const connect = useCallback(async () => {
    if (connectionRef.current) return;
    const attempt = ++attemptRef.current;
    const isCurrent = () => attempt === attemptRef.current;
    controller.markConnecting();

    audioRef.current ??= Object.assign(new Audio(), { autoplay: true });
    const connection = new RealtimeConnection(audioRef.current, {
      onEvent: (event) => isCurrent() && controller.handleServerEvent(event),
      onOpen: () => {
        if (!isCurrent()) return;
        setStreams({ mic: connection.micStream, remote: connection.remoteStream });
        const question = queuedQuestionRef.current;
        queuedQuestionRef.current = undefined;
        controller.markConnected(question);
      },
      onLost: (reason) => {
        if (!isCurrent()) return;
        teardown();
        controller.markError(`${reason} Reconnect to continue.`);
      },
    });
    connectionRef.current = connection;

    try {
      const session = await requestSession(slideRef.current);
      if (!isCurrent()) return;
      await connection.connect(session.clientSecret);
      if (!isCurrent()) connection.close();
      else connection.setMicEnabled(micEnabled);
    } catch (err) {
      if (!isCurrent()) return;
      teardown();
      controller.markError(err instanceof Error ? err.message : 'Could not start the voice session.');
    }
  }, [controller, micEnabled, teardown]);

  const disconnect = useCallback(() => {
    attemptRef.current++;
    teardown();
    controller.markDisconnected();
  }, [controller, teardown]);

  const goToSlide = useCallback(
    (slide: number) => {
      const clamped = Math.min(SLIDE_COUNT, Math.max(1, slide));
      if (clamped === slideRef.current) return;
      applySlide(clamped, 'user');
      controller.notifyManualNavigation(clamped);
    },
    [applySlide, controller],
  );

  const toggleMic = useCallback(() => {
    setMicEnabled((enabled) => {
      connectionRef.current?.setMicEnabled(!enabled);
      return !enabled;
    });
  }, []);

  const interrupt = useCallback(() => controller.interrupt(), [controller]);

  /** Ask by text; if no session is live yet, start one and ask as soon as it opens. */
  const ask = useCallback(
    (question: string) => {
      if (connectionRef.current && controller.getSnapshot().status !== 'connecting') {
        controller.askText(question);
        return;
      }
      queuedQuestionRef.current = question;
      void connect();
    },
    [connect, controller],
  );

  // Close the call when the component unmounts (or the page is refreshed).
  useEffect(() => {
    const onUnload = () => connectionRef.current?.close();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      connectionRef.current?.close();
    };
  }, []);

  const connected = !['idle', 'connecting', 'error'].includes(snapshot.status);

  return {
    ...snapshot,
    currentSlide,
    lastSource,
    connected,
    micEnabled,
    micStream: streams.mic,
    remoteStream: streams.remote,
    connect,
    disconnect,
    interrupt,
    ask,
    toggleMic,
    goToSlide,
  };
}

export type VoicePresenter = ReturnType<typeof useVoicePresenter>;
