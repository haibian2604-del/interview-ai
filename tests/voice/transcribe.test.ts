import { describe, expect, it } from "vitest";
import {
  buildTranscriptionRequest,
  extractTranscriptionText,
  MAX_AUDIO_BYTES,
  probeWavBytes,
} from "@/lib/voice/transcribe";

describe("voice/probeWavBytes", () => {
  it("RIFF 头 + 16kHz 单声道 16bit 1 秒 = 44 + 32000 字节", () => {
    const bytes = probeWavBytes();
    const header = Buffer.from(bytes.slice(0, 44)).toString("latin1");
    expect(header.slice(0, 4)).toBe("RIFF");
    expect(header.slice(8, 12)).toBe("WAVE");
    expect(bytes.byteLength).toBe(44 + 16000 * 2);
  });
});

describe("voice/buildTranscriptionRequest", () => {
  it("URL 去尾斜杠拼接 /audio/transcriptions，Authorization + model 进请求", () => {
    const { url, init } = buildTranscriptionRequest(
      { baseURL: "https://a.io/v1/", apiKey: "sk-test-abc", model: "whisper-1" },
      new Blob(["x"], { type: "audio/webm" }),
    );
    expect(url).toBe("https://a.io/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-abc");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });
});

describe("voice/extractTranscriptionText", () => {
  it("取非空 text；其余形状一律 undefined", () => {
    expect(extractTranscriptionText({ text: " 你好 " })).toBe(" 你好 ");
    expect(extractTranscriptionText({ text: "" })).toBeUndefined();
    expect(extractTranscriptionText({ text: 42 })).toBeUndefined();
    expect(extractTranscriptionText(null)).toBeUndefined();
    expect(extractTranscriptionText("nope")).toBeUndefined();
  });

  it("音频上限常量为 4MB", () => {
    expect(MAX_AUDIO_BYTES).toBe(4 * 1024 * 1024);
  });
});
