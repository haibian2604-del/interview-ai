"use client";

import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import { formatElapsed } from "@/lib/voice/recorder-core";
import type { VoiceRecorderState } from "@/lib/voice/use-voice-recorder";

export function VoiceInputButton({
  state,
  elapsedSeconds,
  disabled,
  onToggle,
  onCancel,
}: {
  state: VoiceRecorderState;
  elapsedSeconds: number;
  disabled: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const copy = COPY.voice;
  if (state === "transcribing") {
    return (
      <Button type="button" variant="outline" size="sm" className="rounded-none" disabled>
        {copy.transcribing}
      </Button>
    );
  }
  if (state === "recording") {
    return (
      <span className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed="true"
          className="rounded-none border-ink-blue text-ink-blue"
          onClick={onToggle}
        >
          {copy.stopAndTranscribe}
        </Button>
        <span className="font-mono text-xs tabular-nums text-ink-blue" aria-live="off">
          {formatElapsed(elapsedSeconds)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-none text-pencil hover:text-ink before:absolute before:inset-[-10px] before:max-md:content-['']"
          onClick={onCancel}
        >
          {copy.cancelRecording}
        </Button>
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-none border-ink/25 text-ink/60 hover:text-ink"
      disabled={disabled}
      onClick={onToggle}
    >
      {copy.startRecording}
    </Button>
  );
}
