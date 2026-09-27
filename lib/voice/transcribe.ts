import type { AsrConfig } from "@/lib/settings/service";
import { COPY } from "@/lib/copy";

/** Vercel Serverless 请求体上限约 4.5MB，音频上限收紧到 4MB（opus 约 20 分钟） */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/**
 * 测试转写探针：16kHz 单声道 16bit、1 秒静音的最小合法 WAV（44 字节头 + 32000 数据字节）。
 * 足够让 /audio/transcriptions 返回空转写文本，用于验证端点/密钥/模型三件套可达。
 */
export function probeWavBytes(): Uint8Array {
  const sampleRate = 16000;
  const numSamples = sampleRate; // 1 秒
  const dataSize = numSamples * 2; // 16bit
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率 = 采样率 × 块对齐
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  // 数据段全零 = 静音，无需逐字节写
  return bytes;
}

/** 把 ASR 配置 + 音频组装成上游请求（OpenAI 兼容 POST /audio/transcriptions） */
export function buildTranscriptionRequest(
  cfg: AsrConfig,
  audio: Blob,
  filename = "answer.webm",
): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", cfg.model);
  return {
    url: `${cfg.baseURL.replace(/\/+$/, "")}/audio/transcriptions`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(55_000),
    },
  };
}

/** 上游响应里取转写文本（非空字符串）；其余形状一律 undefined */
export function extractTranscriptionText(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" && text.trim() !== "" ? text : undefined;
}

/** 转写路由的音频守卫：返回错误文案或 null（放行） */
export function validateAudioUpload(audio: FormDataEntryValue | null): string | null {
  if (!audio || typeof audio === "string") return COPY.voice.errNoAudio;
  if (audio.size <= 0) return COPY.voice.errNoAudio;
  if (audio.size > MAX_AUDIO_BYTES) return COPY.voice.errTooLarge;
  return null;
}
