import { describe, expect, it } from "vitest";
import { formatElapsed, pickRecorderMime, supportsVoiceInput } from "@/lib/voice/recorder-core";

describe("voice/recorder-core", () => {
  it("supportsVoiceInput：mediaDevices 与 MediaRecorder 双条件", () => {
    expect(supportsVoiceInput({ mediaDevices: {} }, true)).toBe(true);
    expect(supportsVoiceInput(undefined, true)).toBe(false);
    expect(supportsVoiceInput({ mediaDevices: {} }, false)).toBe(false);
    expect(supportsVoiceInput({}, true)).toBe(false);
  });

  it("pickRecorderMime：按候选顺序取第一个被支持的；全不支持 → undefined", () => {
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime((m) => m.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime(() => false)).toBeUndefined();
  });

  it("formatElapsed：分不补零、秒补零，超一小时仍按分钟累计", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(600)).toBe("10:00");
  });
});
