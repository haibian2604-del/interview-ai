"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { safeNextPath } from "@/lib/navigation/next-path";
import { COPY } from "@/lib/copy";

function LoginCover() {
  const supabase = createSupabaseBrowserClient();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [oauthError, setOauthError] = useState(false);
  const hasAuthError = searchParams.get("error") === "auth";
  // B9：登录后回跳来源页——next 校验后拼进两条登录流的回调地址。
  // 拼接必须在事件处理器内做（window.location 浏览器才有）：渲染期取 location 会让 SSR 整页崩
  const next = safeNextPath(searchParams.get("next"));
  function buildCallbackUrl(): string {
    const origin = window.location.origin;
    return next
      ? `${origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${origin}/auth/callback`;
  }

  async function sendMagicLink() {
    setEmailError(false);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: buildCallbackUrl() },
    });
    if (error) {
      setEmailError(true);
      return;
    }
    setSent(true);
  }

  async function signInWithGitHub() {
    setOauthError(false);
    try {
      // B10：OAuth 发起失败（弹窗被拦 / 网络断 / provider 报错）不再静默，落错误批注
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: buildCallbackUrl() },
      });
      if (error) setOauthError(true);
    } catch {
      setOauthError(true);
    }
  }

  // 印刷语义：红墨仅用于错误/批改时刻
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        {/* 封面左页：产品名 + 一句话 */}
        <section className="flex flex-col justify-center gap-10 border-b border-ink/15 px-10 py-16 lg:border-r lg:border-b-0">
          <div>
            <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
              {COPY.login.coverLabel}
            </p>
            <h1 className="mt-6 font-heading text-5xl leading-tight font-semibold tracking-wide">
              {COPY.login.brand}
            </h1>
            <p className="mt-5 max-w-md border-l-2 border-ink/20 pl-4 text-base leading-7 text-ink/70">
              {COPY.login.tagline}
            </p>
          </div>
          {/* 评分簿表头：细表格线承担结构 */}
          <dl className="w-full max-w-md border-t border-ink/15 text-sm">
            <div className="flex items-center justify-between border-b border-ink/15 py-3">
              <dt className="text-pencil">{COPY.login.coverUsageLabel}</dt>
              <dd>{COPY.login.coverUsageValue}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-ink/15 py-3">
              <dt className="text-pencil">{COPY.login.coverScoringLabel}</dt>
              <dd>{COPY.login.coverScoringValue}</dd>
            </div>
          </dl>
        </section>

        {/* 封面右页：登录表单（魔法链接为主、GitHub 为辅） */}
        <section className="flex flex-col justify-center px-10 py-16">
          <div className="w-full max-w-sm">
            <h2 className="font-heading text-xl font-semibold">
              {COPY.login.formTitle}
            </h2>
            <p className="mt-1 text-sm text-pencil">{COPY.login.formHint}</p>
            <div className="mt-6 space-y-3">
              {(hasAuthError || oauthError) && (
                <ErrorAnnotation text={COPY.login.authError} />
              )}
              {/* D4：有错误批注时不同屏展示「已发送」提示，避免两态同屏打架 */}
              {sent && !hasAuthError && !oauthError ? (
                <p className="border border-ink/20 bg-ink/[0.03] px-4 py-6 text-sm leading-6">
                  {COPY.login.sent}
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="login-email"
                      className="text-xs tracking-wide text-pencil"
                    >
                      {COPY.login.emailLabel}
                    </label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder={COPY.login.emailPlaceholder}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="focus-visible:border-ink-blue focus-visible:ring-ink-blue/25"
                    />
                    {emailError && (
                      <ErrorAnnotation text={COPY.login.emailError} />
                    )}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      void sendMagicLink().catch(() => setEmailError(true));
                    }}
                  >
                    {COPY.login.magicLink}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      void signInWithGitHub();
                    }}
                  >
                    {COPY.login.github}
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper" />}>
      <LoginCover />
    </Suspense>
  );
}
