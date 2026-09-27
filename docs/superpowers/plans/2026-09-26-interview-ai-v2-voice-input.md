# 面镜 Mirror 二期：用户语音输入（BYOK 服务端转写）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在面试现场可以用麦克风语音作答：录音 → 服务端转发到用户自配的 ASR 接口转写 → 文字回填答题框，用户可编辑后提交。

**Architecture:** 沿用 v1.1 的 BYOK 架构——设置页新增「语音识别」装备区（Base URL / API Key / 模型，AES-256-GCM 加密存库，逐字段回落：用户 ASR 配置 → 用户 LLM 同字段 → env `ASR_*` → env `LLM_*`）。新增 `POST /api/voice/transcribe` 路由做纯转发（服务端不落音频、不落转写文本）。客户端用 MediaRecorder 录音（点击开始/结束），转写结果追加进答题草稿框，用户保留最终编辑权。

**Tech Stack:** Next.js 16 App Router route handler、Supabase（user_settings 扩列）、MediaRecorder + getUserMedia（浏览器原生）、OpenAI 兼容 `/audio/transcriptions` 上游、vitest 纯函数测试。

**Spec:** 本会话决策（2026-09-26，AskUserQuestion 确认）：①技术路线 = 服务端 BYOK 转写（浏览器 Web Speech API 依赖 Google 服务器国内不可用，弃）；②范围 = 二期只做语音输入，TTS/语音输出留三期。既有契约见 `PRODUCT.md`、`docs/superpowers/briefs/2026-09-25-mirror-v1-ux-brief.md`。

## Global Constraints

- 包管理只用 **pnpm**；测试跑 `pnpm vitest run`，类型 `pnpm tsc --noEmit`，构建 `pnpm build`。
- 本仓库是 **Next.js 16**（与训练数据可能不同）：改路由/配置前先看 `node_modules/next/dist/docs/` 的对应文档，留意 deprecation。
- 中文文案一律进 `lib/copy.ts`，组件/路由里不写硬编码中文（打磨轮已收口，勿破）。
- DB 列 snake_case ↔ service 层 camelCase 的映射铁律（`lib/settings/service.ts` 注释）。
- **Key 安全红线**：明文 key 绝不回显出库、绝不进日志/响应体；库中只存 `encryptSecret`（AES-256-GCM）密文；上游错误摘要先 scrub 再出站。
- 500/502 统一走 `serverErrorResponse(scope, error, status)`（`lib/api/server-error.ts`）；自查类端点（settings/test 系列）可返回结构化 `{ ok, error }` 但摘要须 scrub。
- 三色油墨纪律：录音进行中 = **蓝墨**（ink-blue，与「作答/进行中」同语义）；错误 = 红墨 `ErrorAnnotation`；纸白底、方角、hairline 边框。
- **Vercel Serverless 请求体上限约 4.5MB** → 音频上限 `MAX_AUDIO_BYTES = 4MB`（约 20 分钟 opus，足够单题作答）。
- 路由必须自己兜鉴权（`requireUser()` → 401，`/api/*` 不在 middleware PROTECTED 名单）。
- 测试为纯函数风格（route 逻辑切薄、可测部分下沉 lib），沿用 `tests/settings/config.test.ts`、`tests/api/settings-validation.test.ts` 的写法。
- 产品原则：无真实用户数据不得虚构案例；语音功能是**可选能力**，未配置时优雅降级（不阻塞打字作答）。
- 每个 Task 结束：测试绿 + tsc 零错误 + commit；全部 Task 完成后 build + push（用户规矩：commit 后必 push）。

---

### Task 1: 0003 迁移 + ASR 配置服务层（resolveAsrConfig / getAsrConfig / 掩码扩展）

**Files:**
- Create: `supabase/migrations/0003_asr_settings.sql`
- Modify: `lib/settings/service.ts`
- Test: `tests/settings/config.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `safeDecrypt`、`optionalEnv`（service.ts 内已有）、`createSupabaseServerClient`。
- Produces:
  - `type AsrConfig = { baseURL: string; apiKey: string; model: string }`
  - `resolveAsrConfig(input: { user: (UserAsrSettings & { llmBaseUrl: string | null; llmApiKeyEnc: string | null }) | null; env: AsrEnv }): AsrConfig | null`（null = 功能未配置）
  - `getAsrConfig(userId: string): Promise<AsrConfig | null>`
  - `collectAsrEnv(): AsrEnv`（导出，供 Task 3 测试草稿覆盖用）
  - `getMaskedLlmSettings` 返回值新增 `asrBaseUrl: string; asrModel: string; asrHasKey: boolean; asrKeyMask: string`

- [x] **Step 1: 写迁移文件**

`supabase/migrations/0003_asr_settings.sql`（RLS 沿用 0002 的整表策略，无需新 policy；**用户需在 Supabase SQL Editor 手动执行**，交付时提醒）：

```sql
-- 二期语音输入：user_settings 增加 ASR（语音识别）配置列。
-- 密文列由 lib/settings/crypto.ts 的 AES-256-GCM 写入，语义同 llm_api_key_enc。
alter table public.user_settings
  add column asr_base_url text,
  add column asr_api_key_enc text,
  add column asr_model text;
```

- [x] **Step 2: 写 resolveAsrConfig 的失败测试**

`tests/settings/config.test.ts` 追加（import 处补 `resolveAsrConfig`；`safeDecrypt` 依赖 SETTINGS_SECRET，仓库既有 config 测试只测纯逻辑，解密失败分支由 review 人工核对，这里只测 env 链与 null 路径）：

```ts
import { resolveAsrConfig } from "@/lib/settings/service";

describe("settings/resolveAsrConfig", () => {
  const base = {
    asrBaseUrl: null,
    asrApiKeyEnc: null,
    asrModel: null,
    llmBaseUrl: null,
    llmApiKeyEnc: null,
  };

  it("用户 ASR 配置齐全 → 优先使用", () => {
    const cfg = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://asr.example.com/v1", asrModel: "whisper-1" },
      env: { asrApiKey: "env-asr-key" },
    });
    expect(cfg).toEqual({ baseURL: "https://asr.example.com/v1", apiKey: "env-asr-key", model: "whisper-1" });
  });

  it("baseURL 逐级回落：用户 ASR → 用户 LLM → env ASR → env LLM", () => {
    const viaLlm = resolveAsrConfig({
      user: { ...base, llmBaseUrl: "https://llm.example.com/v1", asrModel: "m" },
      env: {},
    });
    expect(viaLlm?.baseURL).toBe("https://llm.example.com/v1");
    const viaEnvAsr = resolveAsrConfig({ user: { ...base, asrModel: "m" }, env: { asrBaseUrl: "https://a.io" } });
    expect(viaEnvAsr?.baseURL).toBe("https://a.io");
    const viaEnvLlm = resolveAsrConfig({ user: { ...base, asrModel: "m" }, env: { llmBaseUrl: "https://l.io" } });
    expect(viaEnvLlm?.baseURL).toBe("https://l.io");
  });

  it("apiKey 逐级回落：env ASR → env LLM（密文解密链路不在纯函数测试覆盖内）", () => {
    const viaEnvAsr = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://a.io", asrModel: "m" },
      env: { asrApiKey: "k1" },
    });
    expect(viaEnvAsr?.apiKey).toBe("k1");
    const viaEnvLlm = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://a.io", asrModel: "m" },
      env: { llmApiKey: "k2" },
    });
    expect(viaEnvLlm?.apiKey).toBe("k2");
  });

  it("model 只认用户配置与 env ASR_MODEL，缺 model → null（功能未配置）", () => {
    expect(
      resolveAsrConfig({
        user: { ...base, asrBaseUrl: "https://a.io" },
        env: { asrApiKey: "k" },
      }),
    ).toBeNull();
  });

  it("user 为 null 且 env 不足三项 → null；env 三项齐全 → 可用", () => {
    expect(resolveAsrConfig({ user: null, env: { asrApiKey: "k" } })).toBeNull();
    const cfg = resolveAsrConfig({
      user: null,
      env: { asrBaseUrl: "https://a.io", asrApiKey: "k", asrModel: "m" },
    });
    expect(cfg).toEqual({ baseURL: "https://a.io", apiKey: "k", model: "m" });
  });
});
```

- [x] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/settings/config.test.ts`
Expected: FAIL（`resolveAsrConfig` 未导出）

- [x] **Step 4: 实现 service 层**

`lib/settings/service.ts` 追加（复用文件内已有 `safeDecrypt`）：

```ts
export type AsrConfig = { baseURL: string; apiKey: string; model: string };

/** user_settings 行 ASR 列的 camelCase 形状（连同 LLM 同行字段一起传入，供回落链使用） */
export type UserAsrSettings = {
  asrBaseUrl: string | null;
  asrApiKeyEnc: string | null;
  asrModel: string | null;
};

/** env 侧 ASR 兜底值；LLM 两项用于「用户没单配 ASR 时回落到同一网关」 */
export type AsrEnv = {
  asrBaseUrl?: string;
  asrApiKey?: string;
  asrModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
};

/**
 * 纯合并逻辑（语音是可选能力，解析不出必填项 → null = 功能未配置，不抛错）：
 * baseURL/apiKey 逐字段回落链：用户 ASR → 用户 LLM → env ASR_* → env LLM_*；
 * model 只认用户 asrModel 与 env ASR_MODEL（不做默认值猜测，避免指向不存在的模型）。
 */
export function resolveAsrConfig(input: {
  user: (UserAsrSettings & { llmBaseUrl: string | null; llmApiKeyEnc: string | null }) | null;
  env: AsrEnv;
}): AsrConfig | null {
  const u = input.user;
  const userKey = u?.asrApiKeyEnc ? safeDecrypt(u.asrApiKeyEnc) : undefined;
  const userLlmKey = u?.llmApiKeyEnc ? safeDecrypt(u.llmApiKeyEnc) : undefined;
  const baseURL = u?.asrBaseUrl || u?.llmBaseUrl || input.env.asrBaseUrl || input.env.llmBaseUrl;
  const apiKey = userKey || userLlmKey || input.env.asrApiKey || input.env.llmApiKey;
  const model = u?.asrModel || input.env.asrModel;
  if (!baseURL || !apiKey || !model) return null;
  return { baseURL, apiKey, model };
}

/** 从 process.env 收集 ASR 兜底值（导出：test-asr 路由的草稿覆盖也要用同一 env 集） */
export function collectAsrEnv(): AsrEnv {
  return {
    asrBaseUrl: optionalEnv("ASR_BASE_URL"),
    asrApiKey: optionalEnv("ASR_API_KEY"),
    asrModel: optionalEnv("ASR_MODEL"),
    llmBaseUrl: optionalEnv("LLM_BASE_URL"),
    llmApiKey: optionalEnv("LLM_API_KEY"),
  };
}

export async function getAsrConfig(userId: string): Promise<AsrConfig | null> {
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("asr_base_url, asr_api_key_enc, asr_model, llm_base_url, llm_api_key_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[settings] load user_settings(asr) failed, treat as unconfigured:", error.message);
  }
  return resolveAsrConfig({
    user: settings
      ? {
          asrBaseUrl: settings.asr_base_url,
          asrApiKeyEnc: settings.asr_api_key_enc,
          asrModel: settings.asr_model,
          llmBaseUrl: settings.llm_base_url,
          llmApiKeyEnc: settings.llm_api_key_enc,
        }
      : null,
    env: collectAsrEnv(),
  });
}
```

并扩展 `getMaskedLlmSettings`：select 列表追加 `asr_base_url, asr_api_key_enc, asr_model`；返回对象追加：

```ts
    let asrKeyMask = "";
    if (settings?.asr_api_key_enc) {
      const plaintext = safeDecrypt(settings.asr_api_key_enc);
      if (plaintext !== undefined) asrKeyMask = maskSecret(plaintext);
    }
    return {
      // ……既有五个字段不动……
      asrBaseUrl: settings?.asr_base_url ?? "",
      asrModel: settings?.asr_model ?? "",
      asrHasKey: !!settings?.asr_api_key_enc,
      asrKeyMask,
    };
```

- [x] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/settings/config.test.ts`
Expected: PASS（既有用例不回归）

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/0003_asr_settings.sql lib/settings/service.ts tests/settings/config.test.ts
git commit -m "feat(voice): 0003 迁移 + ASR 配置服务层（逐字段回落链）"
```

---

### Task 2: 设置读写链路扩展（validation + PUT/GET 的 ASR 字段）

**Files:**
- Modify: `lib/settings/validation.ts`
- Modify: `app/api/settings/route.ts`
- Test: `tests/api/settings-validation.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `getMaskedLlmSettings` 扩展（PUT 成功响应自动带上 ASR 掩码字段）。
- Produces:
  - `LlmSettingsInputBody` / `SanitizedLlmSettings` 新增可选字段 `asrBaseUrl?`、`asrApiKey?`、`asrModel?`（语义与 LLM 字段一致：缺省=保持、空串=清除、非空=覆盖）
  - PUT 落库列：`asr_base_url` / `asr_api_key_enc`（加密）/ `asr_model`

- [x] **Step 1: 写校验测试**

`tests/api/settings-validation.test.ts` 追加：

```ts
describe("settings/validateLlmSettingsInput（ASR 字段）", () => {
  it("ASR 三字段合法输入：trim 放行", () => {
    const result = validateLlmSettingsInput({
      asrBaseUrl: " https://asr.example.com/v1 ",
      asrApiKey: " sk-asr-123456 ",
      asrModel: " whisper-1 ",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({
      asrBaseUrl: "https://asr.example.com/v1",
      asrApiKey: "sk-asr-123456",
      asrModel: "whisper-1",
    });
  });

  it("ASR 字段部分提交：未提交字段不出现在 value", () => {
    const result = validateLlmSettingsInput({ asrModel: "whisper-1" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({ asrModel: "whisper-1" });
    expect("asrBaseUrl" in result.value).toBe(false);
  });

  it("ASR 空串 = 清除语义，原样放行空串", () => {
    const result = validateLlmSettingsInput({ asrBaseUrl: "", asrApiKey: "", asrModel: "" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({ asrBaseUrl: "", asrApiKey: "", asrModel: "" });
  });

  it("ASR 非法 URL / key 过短 / key 过长 → 报错（文案与 LLM 字段同源）", () => {
    expect(validateLlmSettingsInput({ asrBaseUrl: "ftp://a.io" }).ok).toBe(false);
    expect(validateLlmSettingsInput({ asrApiKey: "short" }).ok).toBe(false);
    expect(validateLlmSettingsInput({ asrApiKey: "a".repeat(501) }).ok).toBe(false);
    expect(validateLlmSettingsInput({ asrModel: "m".repeat(201) }).ok).toBe(false);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/api/settings-validation.test.ts`
Expected: FAIL（ASR 字段被忽略，第一条 `expected ok` 处 value 为空对象断言失败）

- [x] **Step 3: 实现校验（顺带 DRY 重构）**

`lib/settings/validation.ts`：body/value 类型加三个可选字段后，把逐字段内联校验抽成共享助手（行为不变，既有测试必须全绿）：

```ts
type FieldKind = "url" | "key" | "model";

/** 单字段净化：非字符串 → 类型错；空串放行（清除语义）；其余按类型规则 */
function sanitizeField(kind: FieldKind, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: COPY.settings.errInvalidType };
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" };
  if (kind === "url") {
    if (!/^https?:\/\//.test(value)) return { ok: false, error: COPY.settings.errBaseUrlFormat };
    try {
      new URL(value);
    } catch {
      return { ok: false, error: COPY.settings.errBaseUrlFormat };
    }
    if (value.length > LLM_SETTINGS_LIMITS.baseUrlMax) return { ok: false, error: COPY.settings.errBaseUrlTooLong };
  } else if (kind === "key") {
    if (value.length < LLM_SETTINGS_LIMITS.apiKeyMin) return { ok: false, error: COPY.settings.errApiKeyLength };
    if (value.length > LLM_SETTINGS_LIMITS.apiKeyMax) return { ok: false, error: COPY.settings.errApiKeyLength };
  } else if (value.length > LLM_SETTINGS_LIMITS.modelMax) {
    return { ok: false, error: COPY.settings.errModelTooLong };
  }
  return { ok: true, value };
}

const FIELD_RULES = [
  ["llmBaseUrl", "url"],
  ["llmApiKey", "key"],
  ["llmChatModel", "model"],
  ["llmEvalModel", "model"],
  ["asrBaseUrl", "url"],
  ["asrApiKey", "key"],
  ["asrModel", "model"],
] as const;

export function validateLlmSettingsInput(body: unknown): ValidateLlmSettingsResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: COPY.settings.errInvalidBody };
  }
  const raw = body as LlmSettingsInputBody;
  const value: SanitizedLlmSettings = {};
  for (const [key, kind] of FIELD_RULES) {
    const input = raw[key];
    if (input === undefined) continue; // 键不存在 = 保持不变
    const result = sanitizeField(kind, input);
    if (!result.ok) return result;
    value[key] = result.value;
  }
  return { ok: true, value };
}
```

> 注意：错误文案 key 以 `lib/copy.ts` settings 段现存的为准（`errApiKeyLength` 等若名字不同，用现存名；重构后逐条跑旧测试对齐）。重构后先跑 `pnpm vitest run tests/api/settings-validation.test.ts` 确认旧用例零回归，再继续。

- [x] **Step 4: PUT 路由落库扩展**

`app/api/settings/route.ts` 的 PUT 中，在既有 llm 字段写入之后追加：

```ts
  if (fields.asrBaseUrl !== undefined) record.asr_base_url = fields.asrBaseUrl;
  if (fields.asrApiKey !== undefined) {
    // 空串 = 清除用户 ASR key（回落链自动顶上）；非空 = AES-GCM 加密覆盖
    try {
      record.asr_api_key_enc = fields.asrApiKey === "" ? "" : encryptSecret(fields.asrApiKey);
    } catch (e) {
      console.error("[settings] encrypt asr key failed:", e);
      return NextResponse.json({ error: COPY.settings.saveFailed }, { status: 500 });
    }
  }
  if (fields.asrModel !== undefined) record.asr_model = fields.asrModel;
```

GET 无需改动（Task 1 已让 `getMaskedLlmSettings` 返回 ASR 掩码字段）。

- [x] **Step 5: 跑测试 + 类型**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: 全绿

- [x] **Step 6: Commit**

```bash
git add lib/settings/validation.ts app/api/settings/route.ts tests/api/settings-validation.test.ts
git commit -m "feat(voice): 设置读写链路支持 ASR 字段（校验 DRY 重构 + 加密落库）"
```

---

### Task 3: 转写共享库 + POST /api/settings/test-asr（测试转写探针）

**Files:**
- Create: `lib/voice/transcribe.ts`
- Create: `app/api/settings/test-asr/route.ts`
- Test: `tests/voice/transcribe.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolveAsrConfig` / `collectAsrEnv`。
- Produces（Task 4 复用）:
  - `MAX_AUDIO_BYTES = 4 * 1024 * 1024`
  - `probeWavBytes(): Uint8Array`（16kHz 单声道 16bit 1 秒静音 WAV）
  - `buildTranscriptionRequest(cfg: AsrConfig, audio: Blob, filename?: string): { url: string; init: RequestInit }`
  - `extractTranscriptionText(payload: unknown): string | undefined`
  - `validateAudioUpload(audio: FormDataEntryValue | null): string | null`（返回 COPY.voice 错误文案或 null）
  - 路由响应：`{ ok: true, model: string } | { ok: false, error: string }`

- [x] **Step 1: 写失败测试**

`tests/voice/transcribe.test.ts`：

```ts
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
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/voice/transcribe.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 3: 实现 lib/voice/transcribe.ts**

```ts
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
```

同时 `lib/copy.ts` 新增 `voice` 段（本 Task 只需路由用到的键，其余键 Task 5/6 补）：

```ts
  voice: {
    notConfigured: "语音作答尚未配置：请到「装备单」登记语音识别端点、密钥与模型",
    errNoAudio: "未收到有效录音，请重试",
    errTooLarge: "录音过大（上限 4MB）：请控制单次作答时长",
    transcribeFailed: "转写失败：上游语音识别服务未正常响应，可改用键盘作答",
    // Task 5/6 追加：unsupported / micDenied / recordingMax / startRecording / stopAndTranscribe /
    //               cancelRecording / transcribing / recordedHint
  },
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/voice/transcribe.test.ts`
Expected: PASS

- [x] **Step 5: 实现 test-asr 路由**

`app/api/settings/test-asr/route.ts`（模式对照 `app/api/settings/test/route.ts`：草稿覆盖 + scrub 摘要）：

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { collectAsrEnv, resolveAsrConfig } from "@/lib/settings/service";
import { buildTranscriptionRequest, extractTranscriptionText, probeWavBytes } from "@/lib/voice/transcribe";
import { COPY } from "@/lib/copy";

export const maxDuration = 60;

type TestAsrDraft = { asrBaseUrl?: unknown; asrApiKey?: unknown; asrModel?: unknown };

/** 草稿字段：仅「非空字符串」覆盖已存配置；未传/空串/非字符串均视同未覆盖 */
function draftOverride(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** 错误摘要：截断 + 抹去一切 key 形态（明文 key 绝不进响应体/日志） */
function scrubSummary(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out.slice(0, 300);
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  let body: TestAsrDraft = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as TestAsrDraft;
    }
  } catch {
    // 空 body = 用已存配置测
  }

  const supabase = await createSupabaseServerClient();
  const { data: settings } = await supabase
    .from("user_settings")
    .select("asr_base_url, asr_api_key_enc, asr_model, llm_base_url, llm_api_key_enc")
    .eq("user_id", user.id)
    .maybeSingle();

  const draftKey = draftOverride(body.asrApiKey);
  const cfg = resolveAsrConfig({
    user: {
      asrBaseUrl: draftOverride(body.asrBaseUrl) ?? settings?.asr_base_url ?? null,
      // 草稿 key 明文无法走密文列：塞进 asrApiKeyEnc 会被 safeDecrypt 当密文解失败，
      // 改为把明文草稿 key 直接并入 env 层优先级最高的位置由 resolveAsrConfig 兜住——
      // 见下方 env 组装（draftKeyAsEnv）
      asrApiKeyEnc: null,
      asrModel: draftOverride(body.asrModel) ?? settings?.asr_model ?? null,
      llmBaseUrl: settings?.llm_base_url ?? null,
      llmApiKeyEnc: settings?.llm_api_key_enc ?? null,
    },
    env: { ...collectAsrEnv(), ...(draftKey ? { asrApiKey: draftKey } : {}) },
  });
  if (!cfg) {
    return NextResponse.json({ ok: false, error: COPY.voice.notConfigured });
  }

  try {
    const { url, init } = buildTranscriptionRequest(cfg, new Blob([probeWavBytes()], { type: "audio/wav" }), "probe.wav");
    const res = await fetch(url, init);
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      console.error("[settings/test-asr] upstream", res.status, raw.slice(0, 300));
      return NextResponse.json({ ok: false, error: scrubSummary(raw || `HTTP ${res.status}`, [cfg.apiKey, draftKey]) });
    }
    const payload: unknown = await res.json().catch(() => null);
    if (extractTranscriptionText(payload) === undefined) {
      // 空转写文本也算端点正常（探针就是静音），但形状怪异视为不可用
      console.error("[settings/test-asr] upstream payload missing text field");
      return NextResponse.json({ ok: false, error: COPY.voice.transcribeFailed });
    }
    return NextResponse.json({ ok: true, model: cfg.model });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: scrubSummary(message, [cfg.apiKey, draftKey]) });
  }
}
```

- [x] **Step 6: 全量测试 + 类型**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: 全绿

- [x] **Step 7: Commit**

```bash
git add lib/voice/transcribe.ts lib/copy.ts app/api/settings/test-asr/route.ts tests/voice/transcribe.test.ts
git commit -m "feat(voice): 转写共享库 + ASR 测试转写探针端点"
```

---

### Task 4: POST /api/voice/transcribe（转写转发路由）

**Files:**
- Create: `app/api/voice/transcribe/route.ts`

**Interfaces:**
- Consumes: Task 1 `getAsrConfig`；Task 3 `validateAudioUpload` / `buildTranscriptionRequest` / `extractTranscriptionText`；`serverErrorResponse`。
- Produces: `POST /api/voice/transcribe`，请求 `multipart/form-data` 字段 `audio`（Blob）；响应 `{ text: string }`；错误：401 未登录 / 400 无有效音频或超 4MB / 409 未配置（`COPY.voice.notConfigured`）/ 502 上游失败。

- [x] **Step 1: 实现路由**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getAsrConfig } from "@/lib/settings/service";
import {
  buildTranscriptionRequest,
  extractTranscriptionText,
  validateAudioUpload,
} from "@/lib/voice/transcribe";
import { serverErrorResponse } from "@/lib/api/server-error";
import { COPY } from "@/lib/copy";

export const maxDuration = 60;

/**
 * 语音作答转写（纯转发）：音频只在内存过路，服务端不落盘、不记录内容；
 * 转写文本进响应体后由前端回填答题框，用户保留最终编辑权。
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: COPY.voice.errNoAudio }, { status: 400 });
  }
  const guard = validateAudioUpload(form.get("audio"));
  if (guard) {
    return NextResponse.json({ error: guard }, { status: 400 });
  }

  const cfg = await getAsrConfig(user.id);
  if (!cfg) {
    return NextResponse.json({ error: COPY.voice.notConfigured }, { status: 409 });
  }

  try {
    const { url, init } = buildTranscriptionRequest(cfg, form.get("audio") as Blob);
    const res = await fetch(url, init);
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      console.error("[voice/transcribe] upstream", res.status, raw.slice(0, 300));
      return NextResponse.json({ error: COPY.voice.transcribeFailed }, { status: 502 });
    }
    const payload: unknown = await res.json().catch(() => null);
    const text = extractTranscriptionText(payload);
    if (text === undefined) {
      console.error("[voice/transcribe] upstream payload missing text field");
      return NextResponse.json({ error: COPY.voice.transcribeFailed }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (e) {
    return serverErrorResponse("voice/transcribe: upstream failed", e, 502);
  }
}
```

- [x] **Step 2: 类型 + 全量测试 + 构建**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: 全绿（build 确认 route 被正确识别为动态路由）

- [x] **Step 3: Commit**

```bash
git add app/api/voice/transcribe/route.ts
git commit -m "feat(voice): /api/voice/transcribe 转写转发路由（内存过路不落盘）"
```

---

### Task 5: 客户端录音 hook（useVoiceRecorder）+ 纯函数助手

**Files:**
- Create: `lib/voice/recorder-core.ts`
- Create: `lib/voice/use-voice-recorder.ts`
- Test: `tests/voice/recorder-core.test.ts`

**Interfaces:**
- Consumes: Task 3 的 COPY.voice 错误文案键。
- Produces:
  - `supportsVoiceInput(nav: { mediaDevices?: unknown } | undefined, hasMediaRecorder: boolean): boolean`
  - `pickRecorderMime(isSupported: (m: string) => boolean): string | undefined`（候选 `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4`）
  - `formatElapsed(seconds: number): string`（`m:ss`，秒补零）
  - `VOICE_MAX_SECONDS = 180`
  - `type VoiceRecorderState = "idle" | "recording" | "transcribing"`
  - `useVoiceRecorder(opts: { onTranscribed: (text: string) => void; onError: (message: string) => void }): { state: VoiceRecorderState; elapsedSeconds: number; supportsVoice: boolean; toggle: () => void; cancel: () => void }`

- [x] **Step 1: 写失败测试**

`tests/voice/recorder-core.test.ts`：

```ts
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
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/voice/recorder-core.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 3: 实现 recorder-core**

`lib/voice/recorder-core.ts`：

```ts
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
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/voice/recorder-core.test.ts`
Expected: PASS

- [x] **Step 5: 实现 hook**

`lib/voice/use-voice-recorder.ts`：

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COPY } from "@/lib/copy";
import {
  VOICE_MAX_SECONDS,
  formatElapsed,
  pickRecorderMime,
  supportsVoiceInput,
} from "@/lib/voice/recorder-core";

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
  const optsRef = useRef(opts);
  optsRef.current = opts; // 回调保持最新，避免 effect 依赖链

  const releaseStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => releaseStream, [releaseStream]); // 卸载兜底：关麦克风、清定时器

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
    if (state === "idle") void startRecording();
    else if (state === "recording") stopRecording();
  }, [state, startRecording, stopRecording]);

  const cancel = useCallback(() => {
    if (state !== "recording") return;
    cancelledRef.current = true;
    stopRecording();
  }, [state, stopRecording]);

  return { state, elapsedSeconds, supportsVoice, toggle, cancel, formatElapsed };
}
```

`lib/copy.ts` 的 `voice` 段补齐其余键：

```ts
    unsupported: "当前浏览器不支持语音输入，请改用键盘作答",
    micDenied: "麦克风权限被拒绝：请在浏览器地址栏允许麦克风后重试",
    recordingMax: "已达单次录音上限（3 分钟），自动进入转写",
    startRecording: "语音作答",
    stopAndTranscribe: "结束并转写",
    cancelRecording: "放弃",
    transcribing: "转写中……",
```

- [x] **Step 6: 类型 + 测试**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: 全绿

- [x] **Step 7: Commit**

```bash
git add lib/voice/recorder-core.ts lib/voice/use-voice-recorder.ts lib/copy.ts tests/voice/recorder-core.test.ts
git commit -m "feat(voice): 录音 hook 与纯函数助手（MediaRecorder + 转写调用）"
```

---

### Task 6: VoiceInputButton 组件 + 面试现场集成

**Files:**
- Create: `components/voice/voice-input-button.tsx`
- Modify: `components/interview/chat-stream.tsx`（输入区，约 517-540 行）

**Interfaces:**
- Consumes: Task 5 的 `useVoiceRecorder` 全部返回值、`formatElapsed`。
- Produces: `VoiceInputButton({ state, elapsedSeconds, disabled, onToggle, onCancel }): JSX.Element`（纯展示组件）；chat-stream 中转写文本并进 `draft`。

- [x] **Step 1: 实现 VoiceInputButton**

`components/voice/voice-input-button.tsx`（纯展示；录音中 = 蓝墨，与「作答进行中」同一语义）：

```tsx
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
```

- [x] **Step 2: 集成进 chat-stream**

`components/interview/chat-stream.tsx`：

1. import `useVoiceRecorder` 与 `VoiceInputButton`；
2. 组件体内（`error` state 附近）接入：

```ts
  const voice = useVoiceRecorder({
    onTranscribed: (text) =>
      setDraft((prev) => (prev.trim() === "" ? text : `${prev.trimEnd()}\n${text}`)),
    onError: (message) => setError(message),
  });
```

3. 底部操作行（`{copy.shortcutHint}` 与发送按钮之间）改为三段布局：

```tsx
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-pencil">{copy.shortcutHint}</p>
            <div className="flex items-center gap-3">
              {voice.supportsVoice && (
                <VoiceInputButton
                  state={voice.state}
                  elapsedSeconds={voice.elapsedSeconds}
                  disabled={inputDisabled}
                  onToggle={voice.toggle}
                  onCancel={voice.cancel}
                />
              )}
              <Button
                type="button"
                className="rounded-none"
                disabled={inputDisabled || !draft.trim()}
                onClick={() => void submitAnswer()}
              >
                {copy.sendButton}
              </Button>
            </div>
          </div>
```

> 细节：`!voice.supportsVoice` 时整个按钮不渲染（优雅降级，不占版面）；`inputDisabled`（提交中/已结束/未开考）时录音按钮同样禁用，防止作答流中间插入转写文本。录音/转写中不阻塞发送键之外的操作（转写文本只是并入草稿，不影响乐观气泡逻辑）。

- [x] **Step 3: 类型 + 全量测试 + 构建**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: 全绿

- [x] **Step 4: 手动冒烟（本地 dev）**

Run: `pnpm dev`，登录后进面试页：
- 未配置 ASR 时点「语音作答」→ 红墨批注「语音作答尚未配置……」；
- 设置页配好后（或 env 配齐）→ 录音按钮变蓝墨计时 → 结束转写 → 文本落入答题框（可编辑）→ 提交流程与键盘作答一致。

- [x] **Step 5: Commit**

```bash
git add components/voice/voice-input-button.tsx components/interview/chat-stream.tsx
git commit -m "feat(voice): 面试现场语音作答入口（录音/转写/回填草稿）"
```

---

### Task 7: 设置页「语音识别」装备区

**Files:**
- Modify: `components/settings/llm-settings-form.tsx`
- Modify: `lib/copy.ts`（settings 段追加键）
- Modify: `README.md`（env 表加 `ASR_*` 三行可选说明，如已有 env 表）

**Interfaces:**
- Consumes: Task 1 的掩码字段（`asrBaseUrl/asrModel/asrHasKey/asrKeyMask`）、Task 2 的 PUT 扩展、Task 3 的 `POST /api/settings/test-asr`。
- Produces: 设置页新增 05/06/07 三栏（ASR 端点 / 密钥 / 模型）+「测试转写」按钮 + ASR 密钥清除（ConfirmDialog 复用）。

- [x] **Step 1: copy.ts settings 段追加键**

```ts
    sectionAsrEndpoint: "05 · 语音识别端点",
    sectionAsrApiKey: "06 · 语音识别密钥",
    sectionAsrModel: "07 · 语音识别模型",
    asrHeaderNote: "语音作答为可选项：不登记则面试现场不显示语音按钮。",
    asrFallbackHint: "未登记时逐字段回落：已存 LLM 端点/密钥 → 系统默认 ASR → 系统默认 LLM。",
    asrBaseUrlLabel: "语音识别 Base URL（OpenAI 兼容 /audio/transcriptions）",
    asrBaseUrlPlaceholder: "如 https://api.example.com/v1（留空回落 LLM 端点）",
    asrApiKeyLabel: "语音识别 API Key",
    asrApiKeyHint: "保存即加密入卷；明文绝不回显。",
    asrModelLabel: "语音识别模型",
    asrModelPlaceholder: "如 whisper-1",
    clearAsrKeyButton: "清除已存语音密钥",
    clearAsrKeyConfirm: "将删除已登记的语音识别密钥（加密形式），清除后按回落链取用系统配置。确定清除？",
    testAsrButton: "测试转写",
    testAsrOkTemplate: "转写链路可用（模型：{model}）",
```

（`keyUndecryptable` 复用既有键；ASR 密钥解密失败时在 06 栏复用同一红墨批注组件。）

- [x] **Step 2: 表单扩展**

`llm-settings-form.tsx`：

1. `MaskedLlmSettings` 类型加 `asrBaseUrl: string; asrModel: string; asrHasKey: boolean; asrKeyMask: string;`；
2. state 追加 `asrBaseUrl / asrModel / asrHasKey / asrKeyMask / asrApiKey`（语义同 LLM key：未输入不提交）与 `clearAsrConfirmOpen`；
3. `save()` body 追加 `asrBaseUrl: asrBaseUrl.trim()`、`asrModel: asrModel.trim()`，`asrApiKey` 仅在输入非空时携带；成功回调同步刷新 ASR 四个掩码 state；
4. 新增 `clearAsrKey()`（照 `clearKey()` 抄，PUT `{ asrApiKey: "" }`）与 `testAsr()`（照 `testConnection()` 抄，`POST /api/settings/test-asr`，body 仅携带非空草稿字段，成功行用 `testAsrOkTemplate`）；
5. 表单 04 栏之后加三个 `FieldSection`（05/06/07，照既有栏目结构；06 栏带清除按钮 + `keyUndecryptable` 同款解密失败批注）；
6. footer 按钮行追加「测试转写」outline 按钮；footer 追加第二个 `ConfirmDialog`（`clearAsrKeyConfirm`，destructive）。

- [x] **Step 3: 类型 + 全量测试 + 构建**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: 全绿

- [x] **Step 4: 手动冒烟（本地 dev）**

- 保存 ASR 配置 → 刷新后回显掩码（key 显示掩码不回明文）；
- 「测试转写」分别验证：全部未配置（提示未配置）/ 草稿 key 测试 / 已存配置测试；
- 清除语音密钥 → ConfirmDialog → 掩码清空；
- 面试页语音按钮按回落链生效（只配 LLM 也应能用，前提上游网关支持 audio）。

- [x] **Step 5: Commit**

```bash
git add components/settings/llm-settings-form.tsx lib/copy.ts README.md
git commit -m "feat(voice): 设置页语音识别装备区（登记/清除/测试转写）"
```

---

### Task 8: 端到端验证 + 交付收尾

**Files:**
- Modify: `README.md`（如 Task 7 未覆盖）
- Modify: `docs/superpowers/plans/2026-09-26-interview-ai-v2-voice-input.md`（勾掉完成项）

- [x] **Step 1: 全量机器验证**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: 全绿。另跑检查：`grep -rn "window.confirm\|window.alert" components app lib` 应为空；`grep -rn "[\u4e00-\u9fff]" app/api lib --include="*.ts" | grep -v copy.ts | grep -v test` 应无新增硬编码中文（既有豁免清单除外）。

- [x] **Step 2: 用户手动步骤清单（交付说明，写进最终汇报）**

1. Supabase SQL Editor 执行 `supabase/migrations/0003_asr_settings.sql`；
2. `.env.local` / Vercel 可选新增 `ASR_BASE_URL` / `ASR_API_KEY` / `ASR_MODEL`（不配则纯走用户 BYOK）；
3. 设置页登记（或依赖 LLM 配置回落）→「测试转写」；
4. 浏览器需支持 MediaRecorder（Chrome/Edge/Safari/Firefox 均可），首次使用允许麦克风权限；
5. 面试现场点「语音作答」→ 说话 →「结束并转写」→ 编辑后提交。

- [x] **Step 3: Commit + Push**

```bash
git add -A
git commit -m "docs(voice): 二期语音输入交付收尾"
git push
```

---

## Self-Review 记录

- **Spec 覆盖**：语音输入全链路（录音→转写→回填）= Task 4-6；BYOK 配置与回落 = Task 1-3、7；错误兜底（权限/不支持/超时/未配置/上游失败）= Task 5 copy + Task 6 集成 + Task 4 路由状态码。语音输出（TTS）明确不在本计划（三期）。评分曲线/支付/i18n 不在本期。
- **已知取舍**：① Task 1 测试不 mock `safeDecrypt` 的解密失败路径（遵循仓库既有 config 测试只测纯逻辑的做法），回落链的解密分支由 review 人工核对；② 转写 language 参数不传（上游自动检测），若实测中文识别差再加；③ 草稿 key 的 test-asr 通过 env 层注入而非密文列（明文不能进 resolveAsrConfig 的密文通道），代码注释已说明。
- **类型一致性**：`AsrConfig` 三字段在 Task 1 定义、Task 3/4 消费；`VoiceRecorderState` 在 Task 5 定义、Task 6 消费；`MaskedLlmSettings` 扩展字段 Task 1（service）→ Task 7（表单）同名。
