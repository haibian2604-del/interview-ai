import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { COPY } from "@/lib/copy";

type InterviewRow = {
  id: string;
  position: string;
  interview_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  // reports 按 interview_id unique：PostgREST 可能给对象或单元素数组，两种形状都兼容
  reports: { overall_score: number } | { overall_score: number }[] | null;
};

// 题型标签沿用「考前登记表」的文案：目录与登记表是同一册书
const TYPE_LABELS: Record<string, string> = {
  skill: COPY.interviewNew.typeSkill,
  project: COPY.interviewNew.typeProject,
  behavioral: COPY.interviewNew.typeBehavioral,
  mixed: COPY.interviewNew.typeMixed,
};

// 状态章油墨纪律：进行中=蓝墨、已完成=黑墨、待开始=黑墨细框、出卷中/出卷失败/缺考=灰章
const STATUS_STAMPS: Record<string, { label: string; className: string }> = {
  ready: { label: COPY.dashboard.statusReady, className: "border-ink/40 text-ink/70" },
  in_progress: {
    label: COPY.dashboard.statusInProgress,
    className: "border-ink-blue bg-ink-blue/[0.06] text-ink-blue",
  },
  completed: {
    label: COPY.dashboard.statusCompleted,
    className: "border-ink bg-ink/[0.05] text-ink",
  },
  generating: { label: COPY.dashboard.statusGenerating, className: "border-pencil/60 text-pencil" },
  draft: { label: COPY.dashboard.statusDraft, className: "border-pencil/60 text-pencil" },
  abandoned: { label: COPY.dashboard.statusAbandoned, className: "border-pencil/60 text-pencil" },
};

function statusStamp(status: string) {
  return (
    STATUS_STAMPS[status] ?? { label: status, className: "border-pencil/60 text-pencil" }
  );
}

// 点击行为：未阅卷的卷（待开始/进行中）回面试现场续答；阅卷完成的看批注；其余章封存不可点
function rowHref(status: string, id: string): string | null {
  if (status === "ready" || status === "in_progress") return `/interview/${id}`;
  if (status === "completed") return `/report/${id}`;
  return null;
}

function reportScore(row: InterviewRow): number | null {
  const r = row.reports;
  if (!r) return null;
  const first = Array.isArray(r) ? r[0] : r;
  return first && first.overall_score != null ? Number(first.overall_score) : null;
}

// 日期：等宽表格数字，印刷品节奏
function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 目录编号：新卷在前，最早开卷的是 No.001
function entryNo(total: number, indexDesc: number) {
  return `No.${String(total - indexDesc).padStart(3, "0")}`;
}

// 目录行的六栏栅格：编号 / 岗位 / 题型 / 日期 / 状态章 / 总分章
const ROW_GRID =
  "grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_6.5rem_8rem_5rem] items-center gap-x-4";

export const metadata = { title: COPY.dashboard.title };

export default async function DashboardPage() {
  // 页面在 middleware PROTECTED 名单内，这里再兜一层归属校验
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, position, interview_type, status, created_at, completed_at, reports(overall_score)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const interviews = (data ?? []) as InterviewRow[];
  const copy = COPY.dashboard;

  return (
    <main className="flex min-h-screen flex-col bg-paper text-ink">
      {/* 卷首：产品名 + 简历库入口 + 新建面试 + 退出登录 */}
      <header className="border-b border-ink/15 px-10 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-8 gap-y-3">
          <p className="font-heading text-xl font-semibold tracking-wide">{copy.brand}</p>
          <p className="hidden font-mono text-xs tracking-[0.35em] text-pencil uppercase sm:block">
            {copy.headerLabel}
          </p>
          <nav className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              href="/resumes"
              className="text-sm text-ink/70 underline decoration-ink/30 underline-offset-4 hover:text-ink"
            >
              {copy.navResumes}
            </Link>
            <Link href="/interview/new" className={buttonVariants({ className: "rounded-none" })}>
              {copy.navNewInterview}
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-10 pb-16 pt-10">
        {error ? (
          /* 查库失败：错误态渲染，不 crash */
          <ErrorAnnotation text={copy.loadFailed} />
        ) : interviews.length === 0 ? (
          /* 空态：评分簿还是空白册，一支笔引导开卷 */
          <div className="border border-dashed border-ink/20 px-6 py-16 text-center">
            <svg
              aria-hidden
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              className="mx-auto h-9 w-9 text-pencil"
            >
              <g transform="rotate(45 16 16)">
                <rect x="13.2" y="3.5" width="5.6" height="16" />
                <path d="M13.2 19.5 16 27l2.8-7.5z" />
                <path d="M16 19.5v4.5" />
              </g>
            </svg>
            <h1 className="mt-5 font-heading text-2xl font-semibold tracking-wide">
              {copy.emptyTitle}
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-pencil">{copy.emptyHint}</p>
            <div className="mt-7 flex justify-center">
              <Link
                href="/interview/new"
                className={buttonVariants({ className: "h-10 rounded-none px-6 text-base" })}
              >
                {copy.emptyButton}
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 目录页头 */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b-2 border-ink pb-3">
              <h1 className="font-heading text-2xl font-semibold tracking-wide">
                {copy.headerTitle}
              </h1>
              <p className="font-mono text-xs text-pencil">{copy.headerHint}</p>
            </div>

            {/* 目录表：hairline 行线承担结构，整行可点的条目 hover 走纸感 */}
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                {/* 表头栏目 */}
                <div
                  className={`${ROW_GRID} border-b border-ink/15 pb-2 pt-6 font-mono text-[10px] tracking-[0.3em] text-pencil uppercase`}
                >
                  <span>{copy.colNo}</span>
                  <span>{copy.colPosition}</span>
                  <span>{copy.colType}</span>
                  <span>{copy.colDate}</span>
                  <span>{copy.colStatus}</span>
                  <span className="text-right">{copy.colScore}</span>
                </div>
                <ul>
                  {interviews.map((row, i) => {
                    const no = entryNo(interviews.length, i);
                    const href = rowHref(row.status, row.id);
                    const stamp = statusStamp(row.status);
                    const score = reportScore(row);
                    // 印章逐行缓入落章：目录翻开时的印刷节奏
                    const delay = { animationDelay: `${(i * 0.05).toFixed(2)}s` };
                    const cells = (
                      <>
                        <span className="font-mono text-sm tracking-widest">{no}</span>
                        <span className="min-w-0 truncate font-heading text-lg font-semibold tracking-wide group-hover:underline group-hover:decoration-ink/30 group-hover:underline-offset-4">
                          {row.position}
                        </span>
                        <span className="font-mono text-xs text-pencil">
                          {TYPE_LABELS[row.interview_type] ?? row.interview_type}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-pencil">
                          {formatDate(row.created_at)}
                        </span>
                        <span>
                          <span
                            className={`mirror-stamp-in inline-block border px-2.5 py-1 font-mono text-xs tracking-[0.25em] ${stamp.className}`}
                            style={delay}
                          >
                            {stamp.label}
                          </span>
                        </span>
                        <span className="text-right">
                          {score != null ? (
                            <span
                              className="mirror-stamp-in inline-block border border-ink-red/70 px-2 py-0.5 font-mono text-base leading-6 tabular-nums text-ink-red"
                              style={delay}
                            >
                              {Math.round(score)}
                            </span>
                          ) : (
                            <span className="font-mono text-sm text-pencil/70">—</span>
                          )}
                        </span>
                      </>
                    );
                    return (
                      <li key={row.id} className="list-none">
                        {href ? (
                          <Link
                            href={href}
                            className={`${ROW_GRID} group border-b border-ink/15 py-4 transition-colors hover:bg-ink/[0.03] focus-visible:bg-ink/[0.04] focus-visible:outline-none`}
                          >
                            {cells}
                          </Link>
                        ) : (
                          <div className={`${ROW_GRID} border-b border-ink/15 py-4`}>{cells}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
