"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { COPY } from "@/lib/copy";

type PutResult = { ok: true; payload: MaskedLlmSettings } | { ok: false; error: string };

/** 形状与 lib/settings/service.ts getMaskedLlmSettings 返回值一致（仅掩码，无任何 key 形态） */
export type MaskedLlmSettings = {
  hasUserConfig: boolean;
  llmBaseUrl: string;
  llmChatModel: string;
  llmEvalModel: string;
  hasKey: boolean;
  keyMask: string;
  asrBaseUrl: string;
  asrModel: string;
  asrHasKey: boolean;
  asrKeyMask: string;
};

/** 装备单的一栏：mono 眉标 + 字段标签 + 输入 + 灰字回落说明 */
function FieldSection({
  eyebrow,
  label,
  htmlFor,
  hint,
  annotation,
  children,
}: {
  eyebrow: string;
  label: string;
  htmlFor: string;
  hint: string;
  annotation?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-6 py-6">
      <p className="font-mono text-[10px] tracking-[0.35em] text-pencil uppercase">{eyebrow}</p>
      <label htmlFor={htmlFor} className="mt-4 block text-sm font-medium tracking-wide">
        {label}
      </label>
      {children}
      {annotation}
      <p className="mt-2 text-xs leading-5 text-pencil">{hint}</p>
    </section>
  );
}

/**
 * 「装备单」表单（设置页正文）：
 * - 初始值来自 GET 掩码形态；保存 = PUT，成功后就地刷新掩码形态（响应即最新值）；
 * - key 输入框 type=password：未输入时 PUT 不带该字段（保持现有），明文绝不回显；
 * - 测试连接：发送当前表单草稿（含未保存值），结果印刷语义行内展示。
 */
export function LlmSettingsForm({ initial }: { initial: MaskedLlmSettings }) {
  const copy = COPY.settings;
  const [baseUrl, setBaseUrl] = useState(initial.llmBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(initial.llmChatModel);
  const [evalModel, setEvalModel] = useState(initial.llmEvalModel);
  const [hasKey, setHasKey] = useState(initial.hasKey);
  const [keyMask, setKeyMask] = useState(initial.keyMask);

  // ASR 侧（语音识别装备区）：语义与 LLM 侧逐一同构，asrApiKey 未输入不提交
  const [asrBaseUrl, setAsrBaseUrl] = useState(initial.asrBaseUrl);
  const [asrApiKey, setAsrApiKey] = useState("");
  const [asrModel, setAsrModel] = useState(initial.asrModel);
  const [asrHasKey, setAsrHasKey] = useState(initial.asrHasKey);
  const [asrKeyMask, setAsrKeyMask] = useState(initial.asrKeyMask);

  const [saving, setSaving] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearAsrConfirmOpen, setClearAsrConfirmOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingAsr, setTestingAsr] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testAsrOk, setTestAsrOk] = useState<string | null>(null);
  const [testAsrError, setTestAsrError] = useState<string | null>(null);

  // hasKey=true 且掩码为空串 = 已存密钥无法解密（SETTINGS_SECRET 可能已更换）
  const keyUndecryptable = hasKey && keyMask === "";
  // ASR 侧同规则：解密失败（掩码空串）→ 06 栏显示「请重新填写」红墨批注
  const asrKeyUndecryptable = asrHasKey && asrKeyMask === "";

  const keyPlaceholder = hasKey
    ? keyUndecryptable
      ? copy.apiKeyPlaceholderUndecryptable
      : copy.apiKeyPlaceholderMasked.replace("{mask}", keyMask)
    : copy.apiKeyPlaceholder;

  const asrKeyPlaceholder = asrHasKey
    ? asrKeyUndecryptable
      ? copy.apiKeyPlaceholderUndecryptable
      : copy.apiKeyPlaceholderMasked.replace("{mask}", asrKeyMask)
    : copy.asrApiKeyPlaceholder;

  // 三路互斥：保存 / 测试连接 / 测试转写 任意进行中，其余按钮一律禁用
  const busy = saving || testing || testingAsr;

  /** PUT /api/settings 的共用骨架：401/业务错误归因、成功返回最新掩码形态 */
  async function putSettings(body: Record<string, string>): Promise<PutResult> {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as
        | (MaskedLlmSettings & { error?: string })
        | { error: string }
        | null;
      if (!res.ok) {
        if (res.status === 401) return { ok: false, error: COPY.api.unauthorized };
        return { ok: false, error: (payload && "error" in payload && payload.error) || copy.saveFailed };
      }
      if (payload && "hasKey" in payload) return { ok: true, payload };
      return { ok: false, error: copy.saveFailed };
    } catch {
      return { ok: false, error: copy.saveFailed };
    }
  }

  /** D5：清除已存密钥——PUT 传空串（API 空串语义 = 清除，回落系统默认 env） */
  async function clearKey() {
    if (busy || !hasKey) return;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const result = await putSettings({ llmApiKey: "" });
    if (result.ok) {
      setHasKey(result.payload.hasKey);
      setKeyMask(result.payload.keyMask);
      setSaveNotice(copy.saveSuccess);
    } else {
      setSaveError(result.error);
    }
    setSaving(false);
  }

  /** 清除已存语音密钥——PUT 传空串（API 空串语义 = 清除，回落链自动顶上） */
  async function clearAsrKey() {
    if (busy || !asrHasKey) return;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const result = await putSettings({ asrApiKey: "" });
    if (result.ok) {
      setAsrHasKey(result.payload.asrHasKey);
      setAsrKeyMask(result.payload.asrKeyMask);
      setSaveNotice(copy.saveSuccess);
    } else {
      setSaveError(result.error);
    }
    setSaving(false);
  }

  async function save() {
    if (busy) return;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const body: Record<string, string> = {
      llmBaseUrl: baseUrl.trim(),
      llmChatModel: chatModel.trim(),
      llmEvalModel: evalModel.trim(),
      asrBaseUrl: asrBaseUrl.trim(),
      asrModel: asrModel.trim(),
    };
    const key = apiKey.trim();
    if (key !== "") body.llmApiKey = key; // 未输入 key 时 PUT 不带该字段：保持现有
    const asrKey = asrApiKey.trim();
    if (asrKey !== "") body.asrApiKey = asrKey; // ASR key 同语义：未输入不提交
    const result = await putSettings(body);
    if (result.ok) {
      // PUT 成功响应即最新掩码形态：就地刷新，不落任何 key 形态
      setBaseUrl(result.payload.llmBaseUrl);
      setChatModel(result.payload.llmChatModel);
      setEvalModel(result.payload.llmEvalModel);
      setHasKey(result.payload.hasKey);
      setKeyMask(result.payload.keyMask);
      setApiKey("");
      setAsrBaseUrl(result.payload.asrBaseUrl);
      setAsrModel(result.payload.asrModel);
      setAsrHasKey(result.payload.asrHasKey);
      setAsrKeyMask(result.payload.asrKeyMask);
      setAsrApiKey("");
      setSaveNotice(copy.saveSuccess);
    } else {
      setSaveError(result.error);
    }
    setSaving(false);
  }

  async function testConnection() {
    if (busy) return;
    setTesting(true);
    setTestOk(null);
    setTestError(null);
    try {
      // 草稿语义：仅非空字段覆盖已存配置；key 未输入则不带（测已存/系统默认）
      const body: Record<string, string> = {};
      if (baseUrl.trim() !== "") body.llmBaseUrl = baseUrl.trim();
      if (apiKey.trim() !== "") body.llmApiKey = apiKey.trim();
      if (chatModel.trim() !== "") body.llmChatModel = chatModel.trim();
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        setTestError(COPY.api.unauthorized);
        return;
      }
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        model?: string;
        error?: string;
      } | null;
      if (payload?.ok && payload.model) {
        setTestOk(copy.testOkTemplate.replace("{model}", payload.model));
      } else {
        setTestError(copy.testFailedPrefix + (payload?.error ?? copy.testBroken));
      }
    } catch {
      setTestError(copy.testFailedPrefix + copy.testBroken);
    } finally {
      setTesting(false);
    }
  }

  async function testAsr() {
    if (busy) return;
    setTestingAsr(true);
    setTestAsrOk(null);
    setTestAsrError(null);
    try {
      // 草稿语义：仅非空字段覆盖已存配置；key 未输入则不带（测已存/回落链）
      const body: Record<string, string> = {};
      if (asrBaseUrl.trim() !== "") body.asrBaseUrl = asrBaseUrl.trim();
      if (asrApiKey.trim() !== "") body.asrApiKey = asrApiKey.trim();
      if (asrModel.trim() !== "") body.asrModel = asrModel.trim();
      const res = await fetch("/api/settings/test-asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        setTestAsrError(COPY.api.unauthorized);
        return;
      }
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        model?: string;
        error?: string;
      } | null;
      if (payload?.ok && payload.model) {
        setTestAsrOk(copy.testAsrOkTemplate.replace("{model}", payload.model));
      } else {
        // 「未配置」是引导性文案而非失败：免加「连接失败：」前缀，避免双重语义
        const msg = payload?.error ?? copy.testBroken;
        setTestAsrError(msg === COPY.voice.notConfigured ? msg : copy.testFailedPrefix + msg);
      }
    } catch {
      setTestAsrError(copy.testFailedPrefix + copy.testBroken);
    } finally {
      setTestingAsr(false);
    }
  }

  const focusInk = "rounded-none border-ink/20 focus-visible:border-ink-blue focus-visible:ring-ink-blue/25";

  return (
    <form
      className="mt-10"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {/* 双列：左=LLM 对话装备（01-04），右=语音识别装备（可选，05-07）；卷脚按钮横贯全宽 */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        {/* 左列 */}
        <div className="divide-y divide-ink/15 border border-ink/15">
      {/* 01 · API 端点 */}
      <FieldSection
        eyebrow={copy.sectionEndpoint}
        label={copy.baseUrlLabel}
        htmlFor="settings-base-url"
        hint={copy.fallbackHint}
      >
        <Input
          id="settings-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={copy.baseUrlPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className={`mt-2 ${focusInk}`}
        />
      </FieldSection>

      {/* 02 · API 密钥 */}
      <FieldSection
        eyebrow={copy.sectionApiKey}
        label={copy.apiKeyLabel}
        htmlFor="settings-api-key"
        hint={copy.apiKeyHint}
        annotation={
          keyUndecryptable ? (
            <div className="mt-3">
              <ErrorAnnotation text={copy.keyUndecryptable} />
            </div>
          ) : undefined
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Input
            id="settings-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyPlaceholder}
            autoComplete="new-password"
            spellCheck={false}
            className={`min-w-0 flex-1 ${focusInk}`}
          />
          {hasKey && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="relative rounded-none text-pencil hover:text-ink before:absolute before:inset-[-10px] before:max-md:content-['']"
              disabled={busy}
              onClick={() => setClearConfirmOpen(true)}
            >
              {copy.clearKeyButton}
            </Button>
          )}
        </div>
      </FieldSection>

      {/* 03 · 对话模型 */}
      <FieldSection
        eyebrow={copy.sectionChatModel}
        label={copy.chatModelLabel}
        htmlFor="settings-chat-model"
        hint={copy.fallbackHint}
      >
        <Input
          id="settings-chat-model"
          value={chatModel}
          onChange={(e) => setChatModel(e.target.value)}
          placeholder={copy.chatModelPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className={`mt-2 ${focusInk}`}
        />
      </FieldSection>

      {/* 04 · 评估模型 */}
      <FieldSection
        eyebrow={copy.sectionEvalModel}
        label={copy.evalModelLabel}
        htmlFor="settings-eval-model"
        hint={copy.evalFallbackHint}
      >
        <Input
          id="settings-eval-model"
          value={evalModel}
          onChange={(e) => setEvalModel(e.target.value)}
          placeholder={copy.evalModelPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className={`mt-2 ${focusInk}`}
        />
      </FieldSection>

        </div>

        {/* 右列 */}
        <div className="divide-y divide-ink/15 border border-ink/15">
      {/* 语音能力说明（可选装备的卷首批注） */}
      <p className="px-6 py-4 text-xs leading-5 text-pencil">{copy.asrHeaderNote}</p>

      {/* 05 · 语音识别端点 */}
      <FieldSection
        eyebrow={copy.sectionAsrEndpoint}
        label={copy.asrBaseUrlLabel}
        htmlFor="settings-asr-base-url"
        hint={copy.asrFallbackHint}
      >
        <Input
          id="settings-asr-base-url"
          value={asrBaseUrl}
          onChange={(e) => setAsrBaseUrl(e.target.value)}
          placeholder={copy.asrBaseUrlPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className={`mt-2 ${focusInk}`}
        />
      </FieldSection>

      {/* 06 · 语音识别密钥 */}
      <FieldSection
        eyebrow={copy.sectionAsrApiKey}
        label={copy.asrApiKeyLabel}
        htmlFor="settings-asr-api-key"
        hint={copy.asrApiKeyHint}
        annotation={
          asrKeyUndecryptable ? (
            <div className="mt-3">
              <ErrorAnnotation text={copy.keyUndecryptable} />
            </div>
          ) : undefined
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Input
            id="settings-asr-api-key"
            type="password"
            value={asrApiKey}
            onChange={(e) => setAsrApiKey(e.target.value)}
            placeholder={asrKeyPlaceholder}
            autoComplete="new-password"
            spellCheck={false}
            className={`min-w-0 flex-1 ${focusInk}`}
          />
          {asrHasKey && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="relative rounded-none text-pencil hover:text-ink before:absolute before:inset-[-10px] before:max-md:content-['']"
              disabled={busy}
              onClick={() => setClearAsrConfirmOpen(true)}
            >
              {copy.clearAsrKeyButton}
            </Button>
          )}
        </div>
      </FieldSection>

      {/* 07 · 语音识别模型 */}
      <FieldSection
        eyebrow={copy.sectionAsrModel}
        label={copy.asrModelLabel}
        htmlFor="settings-asr-model"
        hint={copy.asrModelFallbackHint}
      >
        <Input
          id="settings-asr-model"
          value={asrModel}
          onChange={(e) => setAsrModel(e.target.value)}
          placeholder={copy.asrModelPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className={`mt-2 ${focusInk}`}
        />
      </FieldSection>

        </div>
      </div>

      {/* 卷脚：存档 + 测试连接 + 印刷语义结果行（横贯双列全宽） */}
      <footer className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="rounded-none" disabled={busy}>
            {saving ? copy.saving : copy.saveButton}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            disabled={busy}
            onClick={() => void testConnection()}
          >
            {testing ? copy.testing : copy.testButton}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            disabled={busy}
            onClick={() => void testAsr()}
          >
            {testingAsr ? copy.testingAsr : copy.testAsrButton}
          </Button>
        </div>
        <div aria-live="polite">
          {saveNotice && (
            <p className="mt-4 border border-ink/20 bg-ink/[0.03] px-4 py-2 text-sm">
              {copy.okMark} {saveNotice}
            </p>
          )}
          {saveError && (
            <div className="mt-4">
              <ErrorAnnotation text={saveError} />
            </div>
          )}
          {testOk && (
            <p className="mt-4 font-mono text-sm tracking-wide text-ink">{copy.okMark} {testOk}</p>
          )}
          {testError && (
            <div className="mt-4">
              <ErrorAnnotation text={testError} />
            </div>
          )}
          {testAsrOk && (
            <p className="mt-4 font-mono text-sm tracking-wide text-ink">{copy.okMark} {testAsrOk}</p>
          )}
          {testAsrError && (
            <div className="mt-4">
              <ErrorAnnotation text={testAsrError} />
            </div>
          )}
        </div>
      </footer>
      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={copy.clearKeyTitle}
        description={copy.clearKeyConfirm}
        confirmLabel={copy.clearKeyButton}
        destructive
        onConfirm={() => void clearKey()}
      />
      <ConfirmDialog
        open={clearAsrConfirmOpen}
        onOpenChange={setClearAsrConfirmOpen}
        title={copy.clearAsrKeyButton}
        description={copy.clearAsrKeyConfirm}
        confirmLabel={copy.clearAsrKeyButton}
        destructive
        onConfirm={() => void clearAsrKey()}
      />
    </form>
  );
}
