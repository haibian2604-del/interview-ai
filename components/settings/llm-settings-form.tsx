"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
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
    <section className="border-b border-ink/15 px-6 py-6">
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

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // hasKey=true 且掩码为空串 = 已存密钥无法解密（SETTINGS_SECRET 可能已更换）
  const keyUndecryptable = hasKey && keyMask === "";

  const keyPlaceholder = hasKey
    ? keyUndecryptable
      ? copy.apiKeyPlaceholderUndecryptable
      : copy.apiKeyPlaceholderMasked.replace("{mask}", keyMask)
    : copy.apiKeyPlaceholder;

  const busy = saving || testing;

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
    if (!window.confirm(copy.clearKeyConfirm)) return;
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

  async function save() {
    if (busy) return;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    const body: Record<string, string> = {
      llmBaseUrl: baseUrl.trim(),
      llmChatModel: chatModel.trim(),
      llmEvalModel: evalModel.trim(),
    };
    const key = apiKey.trim();
    if (key !== "") body.llmApiKey = key; // 未输入 key 时 PUT 不带该字段：保持现有
    const result = await putSettings(body);
    if (result.ok) {
      // PUT 成功响应即最新掩码形态：就地刷新，不落任何 key 形态
      setBaseUrl(result.payload.llmBaseUrl);
      setChatModel(result.payload.llmChatModel);
      setEvalModel(result.payload.llmEvalModel);
      setHasKey(result.payload.hasKey);
      setKeyMask(result.payload.keyMask);
      setApiKey("");
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

  const focusInk = "rounded-none border-ink/20 focus-visible:border-ink-blue focus-visible:ring-ink-blue/25";

  return (
    <form
      className="mt-10 border border-ink/15"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
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
              className="rounded-none text-pencil hover:text-ink"
              disabled={busy}
              onClick={() => void clearKey()}
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

      {/* 卷脚：存档 + 测试连接 + 印刷语义结果行 */}
      <footer className="px-6 py-6">
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
        </div>
      </footer>
    </form>
  );
}
