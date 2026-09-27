/** 语音录音的可测纯逻辑（MediaRecorder 交互本体在 use-voice-recorder.ts，不进测试） */

export const VOICE_MAX_SECONDS = 180;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function supportsVoiceInput(
  nav: { mediaDevices?: unknown } | undefined,
  hasMediaRecorder: boolean,
): boolean {
  return !!nav && typeof nav.mediaDevices === "object" && nav.mediaDevices !== null && hasMediaRecorder;
}

export function pickRecorderMime(isSupported: (m: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find(isSupported);
}

export function formatElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
