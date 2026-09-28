import { redirect } from "next/navigation";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { getMaskedLlmSettings, listLlmUrlPresets } from "@/lib/settings/service";
import { LlmSettingsForm } from "@/components/settings/llm-settings-form";
import { COPY } from "@/lib/copy";
import { BackButton } from "@/components/back-button";

export const metadata = { title: COPY.settings.title };

export default async function SettingsPage() {
  // 页面在 middleware PROTECTED 名单内，这里再兜一层归属校验
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  // 服务端壳直接取掩码形态作初始值（与 GET /api/settings 同一数据源，含端点预设）
  const supabase = await createSupabaseServerClient();
  const [masked, llmUrlPresets] = await Promise.all([
    getMaskedLlmSettings(user.id),
    listLlmUrlPresets(supabase),
  ]);
  const copy = COPY.settings;

  return (
    <main className="flex min-h-screen flex-col bg-paper text-ink">
      <div className="mx-auto w-full max-w-3xl px-10 py-14">
        <BackButton className="mb-6" />
        {/* 卷首：与简历档案库同构 */}
        <header className="border-b border-ink/15 pb-8">
          <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
            {copy.headerLabel}
          </p>
          <h1 className="mt-4 font-heading text-4xl font-semibold tracking-wide">
            {copy.headerTitle}
          </h1>
          <p className="mt-3 max-w-xl border-l-2 border-ink/20 pl-4 text-sm leading-6 text-ink/70">
            {copy.headerHint}
          </p>
        </header>

        {/* 装备单：一页表单，七栏装备区（05-07 语音栏为可选装备） */}
        <LlmSettingsForm initial={{ ...masked, llmUrlPresets }} />
      </div>
    </main>
  );
}
