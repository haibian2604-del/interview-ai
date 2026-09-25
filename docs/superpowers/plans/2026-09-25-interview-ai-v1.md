# AI 模拟面试 Agent v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 B2C AI 模拟面试 Agent v1：简历+JD 定制出题、文字对话面试（逐题推进 + 最多 1 次追问）、逐题评分 + 综合报告。

**Architecture:** 五个角色 Agent（简历分析/出题/面试官/评估/报告）由纯代码编排器（状态机）调度，Agent 间不直接通信，只传递结构化产物；每轮对话落盘 Postgres。面试官 Agent 只生成话术，流程决策全部在编排器的确定性规则里。

**Tech Stack:** Next.js 15 (App Router, TS strict) · Tailwind v4 + shadcn/ui + recharts · Supabase (Auth + Postgres + Storage + RLS) · Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) · Zod · pdf-parse · vitest

**Spec:** `docs/PLAN.md`（实现方案 v1，本计划按其实现；两者一起阅读）

## Global Constraints

- 包管理器：npm；Node ≥ 20
- TypeScript `strict: true`，不动摇
- 路由保护：未登录访问受保护页 → 重定向 `/login`（middleware 统一处理）
- 所有 Supabase 表启用 RLS，策略为 `user_id = auth.uid()`
- LLM 全部走 OpenAI 兼容接口，env 驱动：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_CHAT_MODEL` / `LLM_EVAL_MODEL`（EVAL 未配置时回落 CHAT）
- 评估/报告 Agent 用 EVAL 模型，其余 Agent 用 CHAT 模型
- 追问阈值常量 `FOLLOWUP_THRESHOLD = 0.65`；每题最多追问 1 次
- 评分四个维度固定：`relevance / depth / structure / communication`，取值 0–1
- UI 文案集中放 `lib/copy.ts`（中文），不散落在组件里
- 数据库 migration 是普通 SQL 文件，手写，放 `supabase/migrations/`
- 提交遵循 Conventional Commits；每个 Task 至少一次提交
- 涉及网络/LLM 的函数不写单测（mock 除外）；纯逻辑（状态机、schema、prompt 构造、模型选择）必须 TDD

---

### Task 1: 项目脚手架（Next.js + Tailwind + shadcn/ui + vitest）

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`（由脚手架生成后微调）

**Interfaces:**
- Produces: 可运行的 Next.js 应用；`@/*` import alias；`npm run test`（vitest 单测）

- [ ] **Step 1: 在临时目录生成 Next.js 应用并迁入仓库**

```bash
cd /Users/kk/code/project/interview-ai
npx create-next-app@latest tmp-scaffold --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
rsync -a tmp-scaffold/ ./ && rm -rf tmp-scaffold
npm install
```

注意：仓库非空（有 `docs/`、`.git`），create-next-app 拒绝原地生成，所以先在 `tmp-scaffold` 生成再 rsync 进来。`.gitignore` 保留我们已有的版本（不要用脚手架的覆盖）。

- [ ] **Step 2: 安装运行时依赖**

```bash
npm install ai @ai-sdk/openai-compatible zod @supabase/supabase-js @supabase/ssr pdf-parse recharts
npm install -D vitest @types/pdf-parse
```

- [ ] **Step 3: 初始化 shadcn/ui 并添加基础组件**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input textarea label badge progress sonner
```

- [ ] **Step 4: 配置 vitest**

创建 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

`package.json` scripts 增加：`"test": "vitest run"`。

- [ ] **Step 5: 验证**

Run: `npm run build && npm run test`
Expected: build 成功（无 ESLint 错误）；vitest 输出 "No test files found" 可接受（exit code 需为 0，若 vitest 因无测试报错，先建占位测试 `tests/smoke.test.ts`：`import { expect, test } from "vitest"; test("smoke", () => expect(1).toBe(1));`）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 + Tailwind + shadcn/ui + vitest"
```

---

### Task 2: 环境变量与 LLM provider 工厂（TDD）

**Files:**
- Create: `lib/env.ts`
- Create: `lib/ai/provider.ts`
- Create: `.env.example`
- Test: `tests/ai/provider.test.ts`

**Interfaces:**
- Produces: `type AgentKind = "resume-analyst" | "question-setter" | "interviewer" | "evaluator" | "report-writer"`；`getModel(kind: AgentKind): LanguageModel`（`import type { LanguageModel } from "ai"`）；`requireEnv(key: string): string`

- [ ] **Step 1: 写失败测试**

`tests/ai/provider.test.ts`：

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("getModel / requireEnv", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    process.env.LLM_BASE_URL = "https://api.example.com/v1";
    process.env.LLM_API_KEY = "sk-test";
    process.env.LLM_CHAT_MODEL = "cheap-model";
    process.env.LLM_EVAL_MODEL = "strong-model";
  });
  afterEach(() => { process.env = { ...ORIG }; });

  it("廉价 Agent 使用 CHAT 模型", async () => {
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("interviewer") as unknown as { modelId: string };
    expect(m.modelId).toBe("cheap-model");
  });

  it("评估/报告 Agent 使用 EVAL 模型", async () => {
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("evaluator") as unknown as { modelId: string };
    expect(m.modelId).toBe("strong-model");
  });

  it("EVAL 未配置时回落 CHAT", async () => {
    delete process.env.LLM_EVAL_MODEL;
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("report-writer") as unknown as { modelId: string };
    expect(m.modelId).toBe("cheap-model");
  });

  it("缺必需 env 时抛出带 key 名的错误", async () => {
    delete process.env.LLM_API_KEY;
    const { requireEnv } = await import("@/lib/env");
    expect(() => requireEnv("LLM_API_KEY")).toThrow(/LLM_API_KEY/);
  });
});
```

（`createOpenAICompatible(...)(modelId)` 返回的对象带 `modelId` 属性，直接读它断言。）

- [ ] **Step 2: 运行确认失败**

Run: `npm run test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`lib/env.ts`：

```ts
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env: ${key}`);
  return value;
}

export function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === "" ? undefined : value;
}
```

`lib/ai/provider.ts`：

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { optionalEnv, requireEnv } from "@/lib/env";

export type AgentKind =
  | "resume-analyst"
  | "question-setter"
  | "interviewer"
  | "evaluator"
  | "report-writer";

/** 评估/报告用强模型，其余用廉价模型（Global Constraints） */
const STRONG_KINDS: AgentKind[] = ["evaluator", "report-writer"];

export function getModel(kind: AgentKind) {
  const baseURL = requireEnv("LLM_BASE_URL");
  const apiKey = requireEnv("LLM_API_KEY");
  const chatModel = requireEnv("LLM_CHAT_MODEL");
  const modelId =
    STRONG_KINDS.includes(kind)
      ? (optionalEnv("LLM_EVAL_MODEL") ?? chatModel)
      : chatModel;
  const provider = createOpenAICompatible({ name: "llm", baseURL, apiKey });
  return provider(modelId);
}
```

- [ ] **Step 4: 测试通过**

Run: `npm run test`
Expected: PASS (4 tests)

- [ ] **Step 5: 写 `.env.example`**

```bash
# Supabase（Supabase Dashboard → Project Settings → API）
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# LLM（任何 OpenAI 兼容端点）
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_CHAT_MODEL=gpt-4o-mini
# 可选：评估/报告用强模型，不配则用 LLM_CHAT_MODEL
LLM_EVAL_MODEL=gpt-4o
```

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/ai/provider.ts tests/ai/provider.test.ts .env.example
git commit -m "feat(ai): env-driven provider factory with per-agent model routing"
```

---

### Task 3: 领域 Zod schema（TDD）

**Files:**
- Create: `lib/ai/schemas.ts`
- Test: `tests/ai/schemas.test.ts`

**Interfaces:**
- Produces（后续所有 Agent 与 API 依赖这些精确名字）:
  - `ResumeProfileSchema` / `ResumeProfile`：`{ summary: string; skills: string[]; experiences: { company: string; title: string; highlights: string[] }[]; projects: { name: string; highlights: string[] }[] }`
  - `QuestionSchema` / `Question` + `QuestionSetSchema`：`Question = { content: string; type: "skill" | "project" | "behavioral"; skillTag: string; followupAnchor: string }`；`QuestionSetSchema = { questions: Question[] }`（3–10 题）
  - `EvaluationSchema` / `Evaluation`：`{ scores: { relevance: number; depth: number; structure: number; communication: number }; starCompleteness: number; strengths: string; improvements: string }`（分数 0–1）
  - `ReportSchema` / `Report`：`{ overallScore: number; dimensionScores: { relevance: number; depth: number; structure: number; communication: number }; summary: string; strengths: string; improvements: string }`（分数 0–100）

- [ ] **Step 1: 写失败测试**

`tests/ai/schemas.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  EvaluationSchema,
  QuestionSetSchema,
  ReportSchema,
} from "@/lib/ai/schemas";

describe("QuestionSetSchema", () => {
  const q = {
    content: "介绍一个你负责的项目",
    type: "project" as const,
    skillTag: "项目管理",
    followupAnchor: "技术选型理由",
  };
  it("接受 3-10 题", () => {
    expect(() => QuestionSetSchema.parse({ questions: [q, q, q] })).not.toThrow();
  });
  it("拒绝少于 3 题", () => {
    expect(() => QuestionSetSchema.parse({ questions: [q] })).toThrow();
  });
  it("拒绝未知题型", () => {
    expect(() =>
      QuestionSetSchema.parse({
        questions: [{ ...q, type: "coding" }, q, q],
      }),
    ).toThrow();
  });
});

describe("EvaluationSchema", () => {
  it("接受合法评分", () => {
    const e = {
      scores: { relevance: 0.8, depth: 0.6, structure: 0.7, communication: 0.9 },
      starCompleteness: 0.5,
      strengths: "思路清晰",
      improvements: "缺少量化结果",
    };
    expect(() => EvaluationSchema.parse(e)).not.toThrow();
  });
  it("拒绝超出 0-1 的分数", () => {
    expect(() =>
      EvaluationSchema.parse({
        scores: { relevance: 1.5, depth: 0.6, structure: 0.7, communication: 0.9 },
        starCompleteness: 0.5,
        strengths: "s",
        improvements: "i",
      }),
    ).toThrow();
  });
});

describe("ReportSchema", () => {
  const base = {
    dimensionScores: { relevance: 80, depth: 70, structure: 90, communication: 75 },
    summary: "总体良好",
    strengths: "沟通",
    improvements: "深度",
  };
  it("overallScore 与维度分必须在 0-100", () => {
    expect(() => ReportSchema.parse({ ...base, overallScore: 82 })).not.toThrow();
    expect(() => ReportSchema.parse({ ...base, overallScore: 120 })).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test`
Expected: FAIL

- [ ] **Step 3: 实现**

`lib/ai/schemas.ts`：

```ts
import { z } from "zod";

const score01 = z.number().min(0).max(1);
const score100 = z.number().min(0).max(100);

export const ResumeProfileSchema = z.object({
  summary: z.string(),
  skills: z.array(z.string()),
  experiences: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      highlights: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({ name: z.string(), highlights: z.array(z.string()) }),
  ),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

export const QuestionSchema = z.object({
  content: z.string(),
  type: z.enum(["skill", "project", "behavioral"]),
  skillTag: z.string(),
  followupAnchor: z.string(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionSetSchema = z.object({
  questions: z.array(QuestionSchema).min(3).max(10),
});

const evalScores = z.object({
  relevance: score01,
  depth: score01,
  structure: score01,
  communication: score01,
});

export const EvaluationSchema = z.object({
  scores: evalScores,
  starCompleteness: score01,
  strengths: z.string(),
  improvements: z.string(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const ReportSchema = z.object({
  overallScore: score100,
  dimensionScores: z.object({
    relevance: score100,
    depth: score100,
    structure: score100,
    communication: score100,
  }),
  summary: z.string(),
  strengths: z.string(),
  improvements: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;
```

- [ ] **Step 4: 测试通过**

Run: `npm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai/schemas.ts tests/ai/schemas.test.ts
git commit -m "feat(ai): zod domain schemas for profile/questions/evaluation/report"
```

---

### Task 4: 编排器状态机 + rubric（TDD）

**Files:**
- Create: `lib/orchestrator/rubric.ts`
- Create: `lib/orchestrator/state-machine.ts`
- Test: `tests/orchestrator/state-machine.test.ts`

**Interfaces:**
- Produces:
  - `FOLLOWUP_THRESHOLD = 0.65`；`DIMENSIONS = ["relevance", "depth", "structure", "communication"] as const`；`type Dimension`；`RUBRIC: Record<Dimension, string>`（评分 rubric 中文描述）
  - `averageScore(scores: Record<Dimension, number>): number`（四维平均）
  - `decideNextAction(params: { score: number; followupCount: number; isLastQuestion: boolean }): NextAction`，`NextAction = { action: "followup" } | { action: "next_question" } | { action: "finish" }`

- [ ] **Step 1: 写失败测试**

`tests/orchestrator/state-machine.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  averageScore,
  decideNextAction,
  FOLLOWUP_THRESHOLD,
} from "@/lib/orchestrator/state-machine";

const dims = { relevance: 0.8, depth: 0.6, structure: 0.7, communication: 0.9 };

describe("averageScore", () => {
  it("返回四维平均", () => {
    expect(averageScore(dims)).toBeCloseTo(0.75);
  });
});

describe("decideNextAction", () => {
  it("低分且未追问 → followup", () => {
    expect(decideNextAction({ score: 0.4, followupCount: 0, isLastQuestion: false })).toEqual({ action: "followup" });
  });
  it("低分但已追问过 → next_question", () => {
    expect(decideNextAction({ score: 0.4, followupCount: 1, isLastQuestion: false })).toEqual({ action: "next_question" });
  });
  it("低分且是最后一题且已追问 → finish", () => {
    expect(decideNextAction({ score: 0.4, followupCount: 1, isLastQuestion: true })).toEqual({ action: "finish" });
  });
  it("低分、最后一题、未追问 → 仍先追问（追问优先于结束）", () => {
    expect(decideNextAction({ score: 0.4, followupCount: 0, isLastQuestion: true })).toEqual({ action: "followup" });
  });
  it(`评分恰在阈值 ${FOLLOWUP_THRESHOLD} 时不追问（严格小于才追问）`, () => {
    expect(decideNextAction({ score: FOLLOWUP_THRESHOLD, followupCount: 0, isLastQuestion: false })).toEqual({ action: "next_question" });
  });
  it("高分最后一题 → finish", () => {
    expect(decideNextAction({ score: 0.9, followupCount: 0, isLastQuestion: true })).toEqual({ action: "finish" });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test`
Expected: FAIL

- [ ] **Step 3: 实现**

`lib/orchestrator/rubric.ts`：

```ts
export const FOLLOWUP_THRESHOLD = 0.65;

export const DIMENSIONS = [
  "relevance",
  "depth",
  "structure",
  "communication",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const RUBRIC: Record<Dimension, string> = {
  relevance: "相关性：回答是否切题，是否回应了问题的核心考察点",
  depth: "深度：是否展示底层原理、权衡取舍、量化结果，而非停留在表面",
  structure: "结构化：是否条理清晰（如 STAR），有论点有论据",
  communication: "沟通：表达是否简洁准确、术语使用是否得当",
};
```

`lib/orchestrator/state-machine.ts`：

```ts
import { DIMENSIONS, FOLLOWUP_THRESHOLD, type Dimension } from "./rubric";

export type NextAction =
  | { action: "followup" }
  | { action: "next_question" }
  | { action: "finish" };

export function averageScore(scores: Record<Dimension, number>): number {
  return DIMENSIONS.reduce((sum, d) => sum + scores[d], 0) / DIMENSIONS.length;
}

/**
 * 编排器的确定性追问规则（唯一事实来源，模型不得决策）：
 * score < 0.65 且本题未追问过 → 追问（即使已是最后一题，也要先追问再结束）
 */
export function decideNextAction(params: {
  score: number;
  followupCount: number;
  isLastQuestion: boolean;
}): NextAction {
  if (params.score < FOLLOWUP_THRESHOLD && params.followupCount < 1) {
    return { action: "followup" };
  }
  return params.isLastQuestion
    ? { action: "finish" }
    : { action: "next_question" };
}
```

- [ ] **Step 4: 测试通过**

Run: `npm run test`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/orchestrator/ tests/orchestrator/
git commit -m "feat(orchestrator): deterministic follow-up state machine + rubric"
```

---

### Task 5: Supabase migration（建表 + RLS）

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: 数据库表 `profiles / resumes / interviews / questions / messages / evaluations / reports`，字段与 `docs/PLAN.md` 第五节一致；`interviews.status` 取值 `draft | generating | ready | in_progress | completed | abandoned`；Storage 桶 `resumes`（私有）

- [ ] **Step 1: 写 migration SQL**

`supabase/migrations/0001_init.sql`：

```sql
-- profiles：扩展 auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text,
  raw_text text not null,
  structured_json jsonb,
  created_at timestamptz not null default now()
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  position text not null,
  jd_text text,
  interview_type text not null check (interview_type in ('skill','project','behavioral','mixed')),
  question_count int not null default 6,
  status text not null default 'draft' check (status in ('draft','generating','ready','in_progress','completed','abandoned')),
  current_question_index int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  idx int not null,
  content text not null,
  type text not null check (type in ('skill','project','behavioral')),
  skill_tag text not null,
  followup_anchor text not null,
  created_at timestamptz not null default now(),
  unique (interview_id, idx)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  role text not null check (role in ('interviewer','candidate','followup')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  scores jsonb not null,
  star_completeness numeric not null,
  strengths text not null,
  improvements text not null,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null unique references public.interviews(id) on delete cascade,
  overall_score numeric not null,
  dimension_scores jsonb not null,
  summary_md text not null,
  strengths_md text not null,
  improvements_md text not null,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.interviews enable row level security;
alter table public.questions enable row level security;
alter table public.messages enable row level security;
alter table public.evaluations enable row level security;
alter table public.reports enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own resumes" on public.resumes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own interviews" on public.interviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own questions" on public.questions
  for all using (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()));
create policy "own messages" on public.messages
  for all using (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()));
create policy "own evaluations" on public.evaluations
  for all using (exists (select 1 from public.questions q join public.interviews i on i.id = q.interview_id where q.id = question_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.questions q join public.interviews i on i.id = q.interview_id where q.id = question_id and i.user_id = auth.uid()));
create policy "own reports" on public.reports
  for all using (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()));

-- 新用户自动建 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage：简历 PDF 桶 + 策略（路径约定 ${user_id}/${uuid}.pdf）
insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false)
on conflict (id) do nothing;
create policy "own resume files" on storage.objects
  for all using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);
```

- [ ] **Step 2: 应用到数据库（需要用户提供的 Supabase 项目；若尚未提供，此步延后并在提交信息中注明）**

```bash
# 方式 A：Supabase Dashboard SQL Editor 粘贴执行
# 方式 B：supabase CLI（若已登录）
npx supabase link --project-ref <ref> && npx supabase db push
```

验证：Supabase Dashboard → Table Editor 能看到 7 张表；Storage 出现 `resumes` 桶。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): schema migration with RLS for interview domain"
```

---

### Task 6: Supabase 客户端封装 + 认证 + 路由保护

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`
- Create: `middleware.ts`（仓库根目录）
- Create: `app/login/page.tsx`, `app/auth/callback/route.ts`
- Create: `lib/copy.ts`（最小骨架）
- Modify: `app/page.tsx`（重定向到 `/dashboard`）

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（Task 2 的 `.env.example`）
- Produces:
  - `createSupabaseBrowserClient()`（浏览器端）
  - `createSupabaseServerClient(): Promise<SupabaseClient>`（RSC/Route Handler，cookie 处理）
  - `requireUser(): Promise<User>`（未登录抛 `UNAUTHORIZED`）
  - middleware：未登录访问 `/dashboard|/resumes|/interview|/report` → 重定向 `/login`；已登录访问 `/login` → 重定向 `/dashboard`

- [ ] **Step 1: 客户端封装**

`lib/supabase/client.ts`：

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`lib/supabase/server.ts`：

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component 中的只读场景；session 刷新由 middleware 兜底
          }
        },
      },
    },
  );
}

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("UNAUTHORIZED");
  return data.user;
}
```

`lib/supabase/middleware.ts`（`@supabase/ssr` 标准模式）：

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/resumes", "/interview", "/report"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isLoggedIn = !!data.user;
  if (!isLoggedIn && PROTECTED.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (isLoggedIn && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}
```

`middleware.ts`（仓库根）：

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: 登录页 + OAuth 回调 + 文案骨架**

`app/login/page.tsx`：

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { COPY } from "@/lib/copy";

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function sendMagicLink() {
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setSent(true);
  }

  async function signInWithGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{COPY.login.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sent ? (
            <p className="text-sm text-muted-foreground">{COPY.login.sent}</p>
          ) : (
            <>
              <Input
                type="email"
                placeholder={COPY.login.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button className="w-full" onClick={sendMagicLink}>
                {COPY.login.magicLink}
              </Button>
              <Button variant="outline" className="w-full" onClick={signInWithGitHub}>
                {COPY.login.github}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

`app/auth/callback/route.ts`：

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/dashboard`);
}
```

`lib/copy.ts`（最小骨架，后续任务往里加节点）：

```ts
export const COPY = {
  login: {
    title: "登录 · AI 模拟面试",
    emailPlaceholder: "输入邮箱",
    magicLink: "发送登录链接",
    github: "使用 GitHub 登录",
    sent: "登录链接已发送，请查收邮箱。",
  },
} as const;
```

`app/page.tsx` 整体替换为：

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 3: 验证**

Run: `npm run build`
Expected: 成功。本地 `npm run dev`（`.env.local` 配好 Supabase 后），未登录访问 `/dashboard` 应重定向到 `/login`。

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/ middleware.ts app/login/ app/auth/ app/page.tsx lib/copy.ts
git commit -m "feat(auth): supabase auth with magic link + github oauth and route guard"
```

---

### Task 7: 五个 Agent 的 prompt 构造器与执行器（TDD 纯逻辑部分）

**Files:**
- Create: `lib/agents/resume-analyst.ts`
- Create: `lib/agents/question-setter.ts`
- Create: `lib/agents/interviewer.ts`
- Create: `lib/agents/evaluator.ts`
- Create: `lib/agents/report-writer.ts`
- Test: `tests/agents/prompts.test.ts`

**Interfaces:**
- Consumes: `getModel`（Task 2）、`ResumeProfile/Question/Evaluation/Report` schema（Task 3）、`RUBRIC/DIMENSIONS`（Task 4）
- Produces（后续 API 任务依赖的精确签名）:
  - `analyzeResume(rawText: string): Promise<ResumeProfile>`
  - `generateQuestions(input: { profile: ResumeProfile; jdText: string; position: string; interviewType: "skill" | "project" | "behavioral" | "mixed"; count: number }): Promise<Question[]>`
  - `buildInterviewerMessages(mode: "ask" | "followup" | "transition", payload: { question: Question; history: { role: "interviewer" | "candidate" | "followup"; content: string }[]; followupText: string | null; nextQuestion?: Question })` → `{ role, content }[]`
  - `streamInterviewer(mode, payload)` → AI SDK `streamText` 结果（Route Handler 中 `.toTextStreamResponse()`）
  - `evaluateAnswer(input: { question: Question; transcript: { role: string; content: string }[] }): Promise<Evaluation>`
  - `generateReport(input: { position: string; questionContents: string[]; evaluations: Evaluation[] }): Promise<Report>`
  - 每个模块导出 `build*Messages(...)` 纯函数（可测）+ `run` 包装（薄，不测）

- [ ] **Step 1: 写失败测试（只测 prompt 构造纯函数）**

`tests/agents/prompts.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildQuestionSetterMessages } from "@/lib/agents/question-setter";
import { buildEvaluatorMessages } from "@/lib/agents/evaluator";
import { buildReportMessages } from "@/lib/agents/report-writer";
import { buildInterviewerMessages } from "@/lib/agents/interviewer";
import { buildResumeAnalystMessages } from "@/lib/agents/resume-analyst";

const profile = {
  summary: "5 年后端",
  skills: ["Go", "K8s"],
  experiences: [{ company: "A", title: "后端", highlights: ["高并发网关"] }],
  projects: [{ name: "P", highlights: ["性能提升 30%"] }],
};

describe("buildQuestionSetterMessages", () => {
  it("包含简历画像、JD、岗位与题数要求", () => {
    const msgs = buildQuestionSetterMessages({
      profile,
      jdText: "负责支付网关",
      position: "后端工程师",
      interviewType: "mixed",
      count: 6,
    });
    const text = JSON.stringify(msgs);
    expect(text).toContain("Go");
    expect(text).toContain("支付网关");
    expect(text).toContain("后端工程师");
    expect(text).toContain("6");
  });
});

describe("buildEvaluatorMessages", () => {
  it("包含 rubric 维度、题目与回答原文", () => {
    const msgs = buildEvaluatorMessages({
      question: { content: "讲讲高并发网关", type: "skill", skillTag: "Go", followupAnchor: "qps 估算" },
      transcript: [
        { role: "interviewer", content: "讲讲高并发网关" },
        { role: "candidate", content: "我用了 Go + 限流" },
      ],
    });
    const text = JSON.stringify(msgs);
    expect(text).toContain("relevance");
    expect(text).toContain("深度");
    expect(text).toContain("限流");
  });
});

describe("buildReportMessages", () => {
  it("包含全部逐题评估", () => {
    const msgs = buildReportMessages({
      position: "后端工程师",
      questionContents: ["Q1", "Q2"],
      evaluations: [
        { scores: { relevance: 0.9, depth: 0.8, structure: 0.7, communication: 0.9 }, starCompleteness: 0.8, strengths: "s1", improvements: "i1" },
        { scores: { relevance: 0.5, depth: 0.4, structure: 0.6, communication: 0.7 }, starCompleteness: 0.4, strengths: "s2", improvements: "i2" },
      ],
    });
    const text = JSON.stringify(msgs);
    expect(text).toContain("Q1");
    expect(text).toContain("i2");
  });
});

describe("buildInterviewerMessages", () => {
  const q = { content: "介绍项目", type: "project" as const, skillTag: "x", followupAnchor: "技术选型" };
  it("ask 模式注入人格与题目", () => {
    const msgs = buildInterviewerMessages("ask", { question: q, history: [], followupText: null });
    const text = JSON.stringify(msgs);
    expect(text).toContain("面试官");
    expect(text).toContain("介绍项目");
  });
  it("followup 模式包含追问文案", () => {
    const msgs = buildInterviewerMessages("followup", {
      question: q,
      history: [{ role: "candidate", content: "回答" }],
      followupText: "你提到技术选型，为什么选它？",
    });
    expect(JSON.stringify(msgs)).toContain("技术选型");
  });
  it("transition 模式包含下一题", () => {
    const next = { ...q, content: "下一题内容" };
    const msgs = buildInterviewerMessages("transition", { question: q, history: [], followupText: null, nextQuestion: next });
    expect(JSON.stringify(msgs)).toContain("下一题内容");
  });
});

describe("buildResumeAnalystMessages", () => {
  it("包含简历原文", () => {
    expect(JSON.stringify(buildResumeAnalystMessages("十年架构经验"))).toContain("十年架构经验");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test`
Expected: FAIL

- [ ] **Step 3: 实现**

`lib/agents/resume-analyst.ts`：

```ts
import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { ResumeProfileSchema, type ResumeProfile } from "@/lib/ai/schemas";

const PERSONA =
  "你是资深 HR 顾问，擅长从简历原文中提取结构化职业画像。只依据原文提取，不编造。";

export function buildResumeAnalystMessages(rawText: string) {
  return [
    { role: "system" as const, content: PERSONA },
    { role: "user" as const, content: `简历原文：\n${rawText}` },
  ];
}

export async function analyzeResume(rawText: string): Promise<ResumeProfile> {
  const { object } = await generateObject({
    model: getModel("resume-analyst"),
    schema: ResumeProfileSchema,
    messages: buildResumeAnalystMessages(rawText),
  });
  return object;
}
```

`lib/agents/question-setter.ts`：

```ts
import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { QuestionSetSchema, type Question, type ResumeProfile } from "@/lib/ai/schemas";

const TYPE_HINT: Record<string, string> = {
  skill: "考察技能栈掌握深度",
  project: "深挖简历项目经历",
  behavioral: "行为面试题（STAR）",
  mixed: "混合：技能、项目、行为题搭配",
};

export function buildQuestionSetterMessages(input: {
  profile: ResumeProfile;
  jdText: string;
  position: string;
  interviewType: string;
  count: number;
}) {
  return [
    {
      role: "system" as const,
      content:
        "你是严格的面试出题官。根据候选人画像和目标 JD 出题。每题必须给出 skillTag（考察点）和 followupAnchor（如果回答含糊，最值得追问的具体方向）。不要出与 JD 和简历无关的泛泛题。",
    },
    {
      role: "user" as const,
      content: `目标岗位：${input.position}
题型要求：${TYPE_HINT[input.interviewType] ?? input.interviewType}
题目数量：${input.count}

候选人画像：
${JSON.stringify(input.profile, null, 2)}

目标 JD：
${input.jdText || "（未提供，按岗位常识出题）"}`,
    },
  ];
}

export async function generateQuestions(input: {
  profile: ResumeProfile;
  jdText: string;
  position: string;
  interviewType: "skill" | "project" | "behavioral" | "mixed";
  count: number;
}): Promise<Question[]> {
  const { object } = await generateObject({
    model: getModel("question-setter"),
    schema: QuestionSetSchema,
    messages: buildQuestionSetterMessages(input),
  });
  return object.questions;
}
```

`lib/agents/interviewer.ts`：

```ts
import { streamText } from "ai";
import { getModel } from "@/lib/ai/provider";
import type { Question } from "@/lib/ai/schemas";

export const INTERVIEWER_PERSONA =
  "你是一位专业、友好的中文面试官。语气自然口语化，一次只问一个问题，不透露评分标准，不替候选人回答。";

type InterviewerMode = "ask" | "followup" | "transition";

export function buildInterviewerMessages(
  mode: InterviewerMode,
  payload: {
    question: Question;
    history: { role: "interviewer" | "candidate" | "followup"; content: string }[];
    followupText: string | null;
    nextQuestion?: Question;
  },
) {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: INTERVIEWER_PERSONA },
  ];
  for (const m of payload.history) {
    messages.push({
      role: m.role === "candidate" ? "user" : "assistant",
      content: m.content,
    });
  }
  if (mode === "ask") {
    messages.push({ role: "user", content: `请向候选人提出这道题：${payload.question.content}` });
  } else if (mode === "followup") {
    messages.push({ role: "user", content: `用你自己的话向候选人追问（不要逐字念）：${payload.followupText}` });
  } else {
    messages.push({
      role: "user",
      content: payload.nextQuestion
        ? `感谢候选人上一题的回答，简短过渡（一句话），然后提出下一题：${payload.nextQuestion.content}`
        : `面试已全部结束，向候选人致谢并简短收尾（两三句话）。`,
    });
  }
  return messages;
}

export function streamInterviewer(
  mode: InterviewerMode,
  payload: Parameters<typeof buildInterviewerMessages>[1],
) {
  return streamText({
    model: getModel("interviewer"),
    messages: buildInterviewerMessages(mode, payload),
  });
}
```

`lib/agents/evaluator.ts`：

```ts
import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { DIMENSIONS, RUBRIC } from "@/lib/orchestrator/rubric";
import { EvaluationSchema, type Evaluation, type Question } from "@/lib/ai/schemas";

const PERSONA =
  "你是一位以严格著称的面试评估官。独立评估候选人的回答，与面试官话术无关。避免普遍给高分：只有真正出色的回答才配高分。";

export function buildEvaluatorMessages(input: {
  question: Question;
  transcript: { role: string; content: string }[];
}) {
  const rubricText = DIMENSIONS.map((d) => `- ${d}: ${RUBRIC[d]}`).join("\n");
  const transcriptText = input.transcript
    .map((m) => `${m.role === "candidate" ? "候选人" : "面试官"}：${m.content}`)
    .join("\n");
  return [
    {
      role: "system" as const,
      content: `${PERSONA}\n评分维度与标准（每维 0-1 分）：\n${rubricText}`,
    },
    {
      role: "user" as const,
      content: `题目（考察点：${input.question.skillTag}；追问锚点：${input.question.followupAnchor}）：\n${input.question.content}\n\n对话记录：\n${transcriptText}`,
    },
  ];
}

export async function evaluateAnswer(input: {
  question: Question;
  transcript: { role: string; content: string }[];
}): Promise<Evaluation> {
  const { object } = await generateObject({
    model: getModel("evaluator"),
    schema: EvaluationSchema,
    messages: buildEvaluatorMessages(input),
  });
  return object;
}
```

`lib/agents/report-writer.ts`：

```ts
import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { DIMENSIONS, RUBRIC } from "@/lib/orchestrator/rubric";
import { ReportSchema, type Evaluation, type Report } from "@/lib/ai/schemas";

const PERSONA =
  "你是面试教练，基于逐题评估数据撰写综合报告：总分（0-100）、四维分、优势、改进建议（教练式、可执行）。";

export function buildReportMessages(input: {
  position: string;
  questionContents: string[];
  evaluations: Evaluation[];
}) {
  const perQuestion = input.questionContents
    .map((q, i) => {
      const e = input.evaluations[i];
      return `题${i + 1}：${q}\n评分：${JSON.stringify(e.scores)}\nSTAR 完整度：${e.starCompleteness}\n亮点：${e.strengths}\n不足：${e.improvements}`;
    })
    .join("\n\n");
  const rubricText = DIMENSIONS.map((d) => `${d}=${RUBRIC[d]}`).join("；");
  return [
    { role: "system" as const, content: `${PERSONA}\n维度说明：${rubricText}` },
    { role: "user" as const, content: `岗位：${input.position}\n\n逐题评估：\n${perQuestion}` },
  ];
}

export async function generateReport(input: {
  position: string;
  questionContents: string[];
  evaluations: Evaluation[];
}): Promise<Report> {
  const { object } = await generateObject({
    model: getModel("report-writer"),
    schema: ReportSchema,
    messages: buildReportMessages(input),
  });
  return object;
}
```

- [ ] **Step 4: 测试通过**

Run: `npm run test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agents/ tests/agents/
git commit -m "feat(agents): five role agents with testable prompt builders"
```

---

### Task 8: 简历上传解析（Storage + pdf-parse + 页面）

**Files:**
- Create: `lib/resume/pdf.ts`
- Create: `app/api/resume/parse/route.ts`
- Create: `app/resumes/page.tsx`
- Modify: `lib/copy.ts`（加 `resumes` 节点）

**Interfaces:**
- Consumes: `createSupabaseServerClient` / `requireUser`（Task 6）、Storage 桶 `resumes`（Task 5）
- Produces: `extractPdfText(buffer: Buffer): Promise<string>`；`POST /api/resume/parse`（multipart，字段 `file`）→ `{ resumeId, rawText }`，写入 `resumes` 表（`structured_json` 留空待 Task 9）；页面 `/resumes`（上传 + 列表 + 删除 + 纯文本粘贴兜底）

- [ ] **Step 1: 实现 pdf 封装（注意 pdf-parse 的已知导入坑）**

`lib/resume/pdf.ts`：

```ts
// pdf-parse 的主入口会执行调试代码，必须从 lib 子路径导入
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
) => Promise<{ text: string }>;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { text } = await pdfParse(buffer);
  return text.replace(/[ \t]+\n/g, "\n").trim();
}
```

- [ ] **Step 2: API Route**

`app/api/resume/parse/route.ts`（默认 nodejs runtime，禁止设 edge）：

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { extractPdfText } from "@/lib/resume/pdf";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await requireUser();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "仅支持 PDF" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const rawText = await extractPdfText(buffer);
  if (rawText.length < 50) {
    return NextResponse.json({ error: "PDF 文本过少，可能是扫描件" }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const path = `${user.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: "application/pdf" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("resumes")
    .insert({ user_id: user.id, storage_path: path, raw_text: rawText })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ resumeId: data.id, rawText });
}
```

- [ ] **Step 3: 页面**

`app/resumes/page.tsx`：客户端组件。一个 Card 放上传（PDF 文件选择 + 可选「粘贴简历文本」textarea——填了就跳过 PDF，直接 insert `raw_text`，`storage_path` 为 null）；一个 Card 放列表（`supabase.from("resumes").select("id, created_at").order("created_at", { ascending: false })`，显示序号/时间 + 删除按钮）。上传成功后 `router.refresh()` 重新拉列表。文案加进 `lib/copy.ts` 的 `resumes` 节点。

- [ ] **Step 4: 验证**

Run: `npm run build`
Expected: 成功。dev 环境上传一份真实 PDF → `resumes` 表出现记录、Storage 出现文件、页面列表可见；粘贴文本路径同样可建简历。

- [ ] **Step 5: Commit**

```bash
git add lib/resume/ app/api/resume/ app/resumes/ lib/copy.ts
git commit -m "feat(resume): pdf upload, text extraction and resume library page"
```

---

### Task 9: 创建面试 + 出题链路（简历分析 Agent → 出题 Agent）

**Files:**
- Create: `app/api/interview/create/route.ts`
- Create: `app/interview/new/page.tsx`
- Modify: `lib/copy.ts`（加 `interviewNew` 节点）

**Interfaces:**
- Consumes: `analyzeResume`、`generateQuestions`（Task 7）、`requireUser`（Task 6）
- Produces: `POST /api/interview/create`（JSON body: `{ resumeId, position, jdText?, interviewType, questionCount? }`）→ `{ interviewId }`；流程：读简历 →（无 `structured_json` 则）`analyzeResume` 并回写 → `generateQuestions` 写 `questions` 表（idx 从 0）→ interview `draft→generating→ready`；失败回滚到 `draft`
- 页面 `/interview/new`：选简历（下拉）+ 岗位输入 + JD textarea + 题型（技能/项目/行为/混合）+ 题数（默认 6）→ 成功后跳 `/interview/[id]`

- [ ] **Step 1: API Route**

`app/api/interview/create/route.ts`：

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { analyzeResume } from "@/lib/agents/resume-analyst";
import { generateQuestions } from "@/lib/agents/question-setter";
import type { ResumeProfile } from "@/lib/ai/schemas";

export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await requireUser();
  const body = (await request.json()) as {
    resumeId: string;
    position: string;
    jdText?: string;
    interviewType: "skill" | "project" | "behavioral" | "mixed";
    questionCount?: number;
  };
  const supabase = await createSupabaseServerClient();

  const { data: resume } = await supabase
    .from("resumes")
    .select("id, raw_text, structured_json")
    .eq("id", body.resumeId)
    .eq("user_id", user.id)
    .single();
  if (!resume) return NextResponse.json({ error: "简历不存在" }, { status: 404 });

  const { data: interview, error } = await supabase
    .from("interviews")
    .insert({
      user_id: user.id,
      resume_id: resume.id,
      position: body.position,
      jd_text: body.jdText ?? null,
      interview_type: body.interviewType,
      question_count: body.questionCount ?? 6,
      status: "generating",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const profile = (resume.structured_json as ResumeProfile | null) ??
      await analyzeResume(resume.raw_text);
    await supabase
      .from("resumes")
      .update({ structured_json: profile })
      .eq("id", resume.id);

    const questions = await generateQuestions({
      profile,
      jdText: body.jdText ?? "",
      position: body.position,
      interviewType: body.interviewType,
      count: body.questionCount ?? 6,
    });
    await supabase.from("questions").insert(
      questions.map((q, idx) => ({ interview_id: interview.id, idx, ...q })),
    );
    await supabase
      .from("interviews")
      .update({ status: "ready" })
      .eq("id", interview.id);
    return NextResponse.json({ interviewId: interview.id });
  } catch (e) {
    await supabase
      .from("interviews")
      .update({ status: "draft" })
      .eq("id", interview.id);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "出题失败" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: 创建页**

`app/interview/new/page.tsx`：客户端受控表单（不引 react-hook-form，保持简单）。简历下拉从 `resumes` 表拉取；提交成功 `router.push("/interview/" + interviewId)`。**出题需 10-30 秒**：提交期间按钮 loading + 明确的等待文案（「AI 正在分析简历并出题…」）。文案入 `lib/copy.ts`。

- [ ] **Step 3: 验证**

Run: `npm run build` → 成功。dev：选简历 + 贴 JD 创建 → `questions` 表出现 N 行、interview 状态 `ready`、页面跳转（面试页此时 404，属预期）。

- [ ] **Step 4: Commit**

```bash
git add app/api/interview/create/ app/interview/new/ lib/copy.ts
git commit -m "feat(interview): creation flow wiring resume-analyst and question-setter agents"
```

---

### Task 10: 面试现场页 + 编排 API（start / answer / status）

**Files:**
- Create: `app/interview/[id]/page.tsx`
- Create: `components/interview/chat-stream.tsx`, `components/interview/question-progress.tsx`
- Create: `app/api/interview/start/route.ts`
- Create: `app/api/interview/answer/route.ts`
- Create: `app/api/interview/[id]/status/route.ts`
- Modify: `lib/copy.ts`

**Interfaces:**
- Consumes: `evaluateAnswer`、`streamInterviewer`、`buildInterviewerMessages`（Task 7）；`decideNextAction`、`averageScore`（Task 4）；`requireUser`（Task 6）
- Produces:
  - `POST /api/interview/start`（body `{ interviewId }`）：`ready→in_progress`，流式输出第一题（`streamInterviewer("ask", ...)`）并落盘 interviewer 消息。幂等：已 `in_progress` 时返回已有第一条消息文本（直接 JSON `{ resumed: true, firstMessage }`），不重复开播。
  - `POST /api/interview/answer`（body `{ interviewId, answer }`）→ 流式文本响应（面试官话术）。每轮副作用：candidate/followup 消息落盘 → 评估 Agent 打分 → `evaluations` upsert（`onConflict: "question_id"`）→ 编排器决策 → `current_question_index` 推进 / `status=completed` → 流结束后 interviewer 话术落盘。
  - `GET /api/interview/[id]/status` → `{ status, currentIndex, questionCount }`（客户端用于判断跳转报告页与刷新进度）
  - `POST /api/interview/[id]/abandon` → `status=abandoned`（中途放弃）
  - 页面 `/interview/[id]`：QuestionProgress（第 X/N 题 + skillTag + Progress）+ ChatStream（打字机气泡 + 输入框 + 「放弃面试」按钮）

- [ ] **Step 1: answer 路由（核心编排）**

`app/api/interview/answer/route.ts`：

```ts
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { evaluateAnswer } from "@/lib/agents/evaluator";
import { streamInterviewer } from "@/lib/agents/interviewer";
import { averageScore, decideNextAction } from "@/lib/orchestrator/state-machine";
import type { Evaluation, Question } from "@/lib/ai/schemas";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await requireUser();
  const { interviewId, answer } = (await request.json()) as {
    interviewId: string;
    answer: string;
  };
  const supabase = await createSupabaseServerClient();

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, status, current_question_index, question_count")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .single();
  if (!interview || interview.status !== "in_progress") {
    return new Response("面试不在进行中", { status: 409 });
  }

  const idx = interview.current_question_index;
  const [{ data: question }, { data: history }] = await Promise.all([
    supabase.from("questions").select("*").eq("interview_id", interviewId).eq("idx", idx).single(),
    supabase.from("messages").select("role, content").eq("interview_id", interviewId).order("created_at"),
  ]);
  if (!question) return new Response("题目不存在", { status: 404 });

  const followupCount = (history ?? []).filter((m) => m.role === "followup").length;
  await supabase.from("messages").insert({
    interview_id: interviewId,
    question_id: question.id,
    role: followupCount > 0 ? "followup" : "candidate",
    content: answer,
  });

  // 评估 Agent（独立人格，只看题目与回答原文）
  const evaluation: Evaluation = await evaluateAnswer({
    question: question as unknown as Question,
    transcript: [
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "candidate", content: answer },
    ],
  });
  await supabase.from("evaluations").upsert({
    question_id: question.id,
    scores: evaluation.scores,
    star_completeness: evaluation.starCompleteness,
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
  }, { onConflict: "question_id" });

  // 编排器确定性决策（唯一事实来源）
  const next = decideNextAction({
    score: averageScore(evaluation.scores),
    followupCount,
    isLastQuestion: idx === interview.question_count - 1,
  });

  if (next.action === "finish") {
    await supabase.from("interviews")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", interviewId);
  } else if (next.action === "next_question") {
    await supabase.from("interviews")
      .update({ current_question_index: idx + 1 })
      .eq("id", interviewId);
  }

  // 组装面试官话术 payload
  const typedHistory = (history ?? []) as { role: "interviewer" | "candidate" | "followup"; content: string }[];
  const payload = {
    question: question as unknown as Question,
    history: [...typedHistory, { role: "candidate" as const, content: answer }],
    followupText: `针对回答的不足（${evaluation.improvements}），围绕追问锚点「${question.followup_anchor}」提出一个具体追问。`,
  };
  if (next.action === "next_question") {
    const { data: nextQuestion } = await supabase
      .from("questions").select("*")
      .eq("interview_id", interviewId).eq("idx", idx + 1).single();
    payload.nextQuestion = (nextQuestion ?? undefined) as unknown as Question | undefined;
  }

  const result = streamInterviewer(
    next.action === "followup" ? "followup" : "transition",
    payload,
  );

  // 旁路累积全文，流结束后落盘面试官消息；同时通过自定义头告知编排结果
  const [textStreamForClient, persistStream] = result.textStream.tee();
  void (async () => {
    let full = "";
    for await (const chunk of persistStream) full += chunk;
    await supabase.from("messages").insert({
      interview_id: interviewId,
      question_id: question.id,
      role: "interviewer",
      content: full,
    });
  })();

  return new Response(textStreamForClient, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Interview-Action": next.action,
    },
  });
}
```

实现注意（执行者必读）：

1. `textStream.tee()` 旁路持久化：`void` 异步写库不阻塞响应；若运行环境对 `tee()` 有兼容问题，改为先 `await (async () => { let full = ""; for await (const c of result.textStream) full += c; ... })()` 包装成 `ReadableStream` 再返回，效果等价。
2. `finish` 分支不推进 index、不带 `nextQuestion`，transition 模式会输出告别语（见 Task 7 interviewer 实现）。
3. `start` 路由结构与 answer 类似但更简单：校验 `status === "ready"` → 更新为 `in_progress` → `streamInterviewer("ask", { question: 第一题, history: [], followupText: null })` → 旁路落盘 → 返回流。幂等处理见 Interfaces 描述。
4. `status` 路由是普通 GET JSON。
5. 新建 `app/api/interview/[id]/abandon/route.ts`：POST → 校验归属与状态非 `completed` → `update({ status: "abandoned" })` → 返回 `{ ok: true }`。ChatStream 的「放弃面试」按钮点击后先 `confirm()` 再调用，成功后 `router.push("/dashboard")`。

- [ ] **Step 2: 前端组件**

`components/interview/question-progress.tsx`：props `{ currentIndex, questionCount, skillTag }`，渲染 `第 X / N 题`、当前题 skillTag Badge、shadcn Progress 条。

`components/interview/chat-stream.tsx`：客户端组件，props `{ interviewId, initialMessages, initialStatus }`。逻辑：

1. 挂载时若 `status === "ready"` 自动 `POST /api/interview/start` 并流式渲染第一题；若 `in_progress` 且无历史消息（中断恢复）同样调 start（幂等分支返回首条消息）。
2. 提交回答：`POST /api/interview/answer`，`response.body.getReader()` 逐 chunk 追加到面试官气泡（打字机效果）。
3. 流结束后 `GET /api/interview/{id}/status`；`status === "completed"` 时展示「查看报告」并 `router.push(/report/${interviewId})`，否则用返回的 `currentIndex` 更新进度。
4. 输入框 `Enter` 发送（Shift+Enter 换行），流式期间禁用输入。

`app/interview/[id]/page.tsx`：服务端组件，校验登录与归属（`.eq("user_id", user.id)`）→ 查 interview + questions + messages → 组合两个组件。

- [ ] **Step 3: 验证**

Run: `npm run build` → 成功。dev 完整跑一场 3 题小面试（创建时题数填 3）：

1. 高质量回答应直接进下一题（`X-Interview-Action: next_question`）；
2. 故意答「不知道」应触发追问（`followup`），追问后再答进入下一题；
3. 同一题回答两次（1 次追问）后 `evaluations` 表仍是每题 1 行（upsert 验证）；
4. 答完最后一题 status 变 `completed`，页面跳报告页（此时报告页 404，属预期）；
5. 面试中途刷新页面，历史消息还在且可继续（落盘验证）。

- [ ] **Step 4: Commit**

```bash
git add "app/interview/[id]" components/interview/ app/api/interview/ lib/copy.ts
git commit -m "feat(interview): live interview loop with orchestrator, evaluator and streaming interviewer"
```

---

### Task 11: 报告 Agent + 报告页

**Files:**
- Create: `app/api/interview/report/route.ts`
- Create: `app/report/[id]/page.tsx`
- Create: `components/report/score-radar.tsx`
- Modify: `lib/copy.ts`（加 `report` 节点）

**Interfaces:**
- Consumes: `generateReport`（Task 7）、`requireUser`（Task 6）
- Produces: `POST /api/interview/report`（body `{ interviewId }`）→ `{ reportId }`；幂等（已有报告直接返回）。报告页 `/report/[id]`：总分大数字 + recharts 雷达图（四维 0-100）+ 逐题卡（题目、四维分、strengths/improvements）+ summary/strengths/improvements 三段

- [ ] **Step 1: API Route**

`app/api/interview/report/route.ts`：

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { generateReport } from "@/lib/agents/report-writer";
import type { Evaluation } from "@/lib/ai/schemas";

export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await requireUser();
  const { interviewId } = (await request.json()) as { interviewId: string };
  const supabase = await createSupabaseServerClient();

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, position, status")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .single();
  if (!interview) return NextResponse.json({ error: "面试不存在" }, { status: 404 });

  // 幂等：已有报告直接返回
  const { data: existing } = await supabase
    .from("reports").select("id").eq("interview_id", interviewId).maybeSingle();
  if (existing) return NextResponse.json({ reportId: existing.id });

  // 先查题目（带 id），再按 question_id 查评估，按 idx 对齐
  const { data: questions } = await supabase
    .from("questions").select("id, idx, content")
    .eq("interview_id", interviewId).order("idx");
  const qIds = (questions ?? []).map((q) => q.id);
  const { data: evalRows } = await supabase
    .from("evaluations")
    .select("question_id, scores, star_completeness, strengths, improvements")
    .in("question_id", qIds);

  const byQuestion = new Map((evalRows ?? []).map((e) => [e.question_id, e]));
  const aligned: Evaluation[] = [];
  for (const q of questions ?? []) {
    const e = byQuestion.get(q.id);
    if (!e) return NextResponse.json({ error: "存在未评估的题目，面试尚未完成" }, { status: 409 });
    aligned.push({
      scores: e.scores as Evaluation["scores"],
      starCompleteness: Number(e.star_completeness),
      strengths: e.strengths,
      improvements: e.improvements,
    });
  }

  const report = await generateReport({
    position: interview.position,
    questionContents: (questions ?? []).map((q) => q.content),
    evaluations: aligned,
  });

  const { data: inserted, error } = await supabase
    .from("reports")
    .insert({
      interview_id: interviewId,
      overall_score: report.overallScore,
      dimension_scores: report.dimensionScores,
      summary_md: report.summary,
      strengths_md: report.strengths,
      improvements_md: report.improvements,
    })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reportId: inserted.id });
}
```

- [ ] **Step 2: 报告页 + 雷达图**

`components/report/score-radar.tsx`：recharts `RadarChart`（`RadarChart > PolarGrid + PolarAngleAxis + PolarRadiusAxis + Radar`），四个维度中文标签映射：`relevance=相关性 / depth=深度 / structure=结构化 / communication=沟通`，数据 0-100，`PolarRadiusAxis domain={[0, 100]}`。

`app/report/[id]/page.tsx`：服务端组件查 `reports`（join `interviews` 校验归属）。无报告 → 渲染「生成报告」按钮（客户端小组件调 POST 后 `router.refresh()`）；有报告 → 渲染：顶部总分（大数字）+ ScoreRadar，中部逐题卡（从 `evaluations` join `questions` 按 idx 取，展示题目、四维分、亮点、不足），底部 summary/strengths/improvements 三段（`whitespace-pre-wrap`）。

- [ ] **Step 3: 验证**

Run: `npm run build` → 成功。dev：打开 Task 10 完成的那场面试的报告页 → 生成报告 → 总分/雷达图/逐题卡齐全；刷新数据仍在；重复点「生成报告」不重复写表（幂等）。

- [ ] **Step 4: Commit**

```bash
git add app/api/interview/report/ "app/report/[id]" components/report/ lib/copy.ts
git commit -m "feat(report): report-writer agent and score report page with radar chart"
```

---

### Task 12: Dashboard 历史列表

**Files:**
- Create: `app/dashboard/page.tsx`
- Modify: `lib/copy.ts`（加 `dashboard` 节点）

**Interfaces:**
- Consumes: `createSupabaseServerClient` / `requireUser`（Task 6）
- Produces: 服务端组件 `/dashboard`：面试历史列表（岗位、类型、状态 Badge、时间、总分若有）+「新建面试」按钮 + 顶部导航（简历管理 / 退出登录）

- [ ] **Step 1: 实现**

服务端组件直接查库：

```tsx
const { data: interviews } = await supabase
  .from("interviews")
  .select("id, position, interview_type, status, created_at, completed_at, reports(overall_score)")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false });
```

状态 → 行为映射：`ready`/`in_progress` → 点击进入 `/interview/[id]`（Badge「待开始」「进行中」）；`completed` → 点击进入 `/report/[id]`（Badge「已完成」+ 总分）；`draft`/`generating`/`abandoned` → 灰色 Badge 不可点。空态文案引导「创建第一场模拟面试」。顶部导航含「简历管理」链接和退出登录按钮（`supabase.auth.signOut()` → 跳 `/login`）。

- [ ] **Step 2: 验证**

Run: `npm run build` → 成功。dev：此前所有测试场景在列表可见、状态正确、可跳转。

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/ lib/copy.ts
git commit -m "feat(dashboard): interview history list with status and scores"
```

---

### Task 13: 收尾 — 全量回归 + README

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: 可部署到 Vercel 的完整仓库

- [ ] **Step 1: 全量回归**

Run: `npm run build && npm run test`
Expected: 全部通过

- [ ] **Step 2: 写 README**

内容：项目简介；架构（五个 Agent + 编排器的文字图，摘自 `docs/PLAN.md`）；本地开发（env 配置、Supabase migration 执行方式、`npm run dev`）；部署到 Vercel（导入 repo + 填 `.env.example` 全部变量）；已知边界（仅 PDF、无语音）；二期路线（语音 WebRTC、评分曲线、支付、i18n）。

- [ ] **Step 3: Commit + Push**

```bash
git add README.md
git commit -m "docs: readme with architecture and deployment guide"
git push
```

---

## 实施前外部依赖（阻塞项：Task 1-4、7 可先行；Task 5-6、8-13 需要）

1. **Supabase 项目**：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（Task 6 起）
2. **LLM API Key**：OpenAI 兼容端点的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_CHAT_MODEL`（Task 9 起联调）
3. Supabase Auth 开启 Email 提供方；GitHub OAuth 需建 OAuth App 并配置回调
