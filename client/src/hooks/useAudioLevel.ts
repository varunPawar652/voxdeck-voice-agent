import { useEffect, useState } from 'react';

let sharedContext: AudioContext | null = null;

/** Smoothed 0–1 loudness of a MediaStream, sampled ~20×/s (cheap enough for a status meter). */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    sharedContext ??= new AudioContext();
    const ctx = sharedContext;
    void ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let smoothed = 0;

    const interval = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      smoothed = smoothed * 0.6 + Math.min(1, rms * 4) * 0.4;
      setLevel(smoothed < 0.01 ? 0 : smoothed);
    }, 50);

    return () => {
      clearInterval(interval);
      source.disconnect();
    };
  }, [stream]);

  return stream ? level : 0;
}
