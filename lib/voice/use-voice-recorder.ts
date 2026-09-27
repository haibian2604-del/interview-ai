"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COPY } from "@/lib/copy";
import { VOICE_MAX_SECONDS, pickRecorderMime, supportsVoiceInput } from "@/lib/voice/recorder-core";

export type VoiceRecorderState = "idle" | "recording" | "transcribing";

type UseVoiceRecorderOpts = {
  /** 转写成功：把文本交给调用方（chat-stream 负责并进答题草稿） */
  onTranscribed: (text: string) => void;
  /** 任何失败：调用方把文案放进 ErrorAnnotation */
  onError: (message: string) => void;
};

/**
 * 录音 + 转写一体 hook：
 * toggle() = idle→开始录音 / recording→停录并转写；cancel() = 丢弃当前录音不转写。
 * 录音上限 VOICE_MAX_SECONDS，到点自动停录转写；卸载时释放麦克风与定时器。
 * MediaRecorder/Blob 交互不做单测（jsdom 无实现），可测逻辑已下沉 recorder-core。
 */
export function useVoiceRecorder(opts: UseVoiceRecorderOpts) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [supportsVoice] = useState(() =>
    typeof window === "undefined"
      ? false
      : supportsVoiceInput(window.navigator, typeof MediaRecorder !== "undefined"),
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  // getUserMedia 授权等待窗口内 state 仍是 "idle"，仅靠 UI 禁用挡不住双击起两路流
  const startingRef = useRef(false);
  const optsRef = useRef(opts);
  // 每次渲染后同步回调，保持最新，避免 effect 依赖链（渲染期写 ref 会被 react-hooks/refs 拦截）
  useEffect(() => {
    optsRef.current = opts;
  });

  const releaseStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    // 卸载兜底（StrictMode 双挂载安全）：先置取消标记——轨道停止后 MediaRecorder 仍会异步触发
    // onstop，若不置位它会带着已卸载实例的 chunks 进入转写分支；随后关麦克风、清定时器。
    // 下次 startRecording 会重置 cancelledRef，不影响正常录音流程。
    cancelledRef.current = true;
    return releaseStream;
  }, [releaseStream]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, "answer.webm");
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        if (res.status === 401) {
          optsRef.current.onError(COPY.api.unauthorized);
          return;
        }
        if (res.status === 409) {
          optsRef.current.onError(COPY.voice.notConfigured);
          return;
        }
        if (res.status === 400) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          optsRef.current.onError(payload?.error ?? COPY.voice.errTooLarge);
          return;
        }
        if (!res.ok) {
          optsRef.current.onError(COPY.voice.transcribeFailed);
          return;
        }
        const payload = (await res.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        if (!text) {
          optsRef.current.onError(COPY.voice.transcribeFailed);
          return;
        }
        optsRef.current.onTranscribed(text);
      } catch {
        optsRef.current.onError(COPY.voice.transcribeFailed);
      } finally {
        setState("idle");
        setElapsedSeconds(0);
      }
    },
    [],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    // onstop 里组装 Blob 并进入转写（或取消分支）
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!supportsVoice) {
      optsRef.current.onError(COPY.voice.unsupported);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      optsRef.current.onError(COPY.voice.micDenied);
      return;
    }
    streamRef.current = stream;
    const mimeType = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    cancelledRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      releaseStream();
      if (cancelledRef.current || blob.size === 0) {
        setState("idle");
        setElapsedSeconds(0);
        return;
      }
      void transcribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    setElapsedSeconds(0);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(sec);
      if (sec >= VOICE_MAX_SECONDS) {
        optsRef.current.onError(COPY.voice.recordingMax);
        stopRecording();
      }
    }, 1000);
  }, [releaseStream, stopRecording, supportsVoice, transcribe]);

  const toggle = useCallback(() => {
    if (state === "idle") {
      // 授权等待窗口内二连点会起两路 getUserMedia（孤儿流），startingRef 兜住
      if (startingRef.current) return;
      startingRef.current = true;
      void startRecording().finally(() => {
        startingRef.current = false;
      });
    } else if (state === "recording") stopRecording();
  }, [state, startRecording, stopRecording]);

  const cancel = useCallback(() => {
    if (state !== "recording") return;
    cancelledRef.current = true;
    stopRecording();
  }, [state, stopRecording]);

  return { state, elapsedSeconds, supportsVoice, toggle, cancel };
}
