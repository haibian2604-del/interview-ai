# 面镜 Mirror · AI 模拟面试

> 照镜子式演练：面试是自我认知的镜子，练习即反思。

**面镜 Mirror** 是一个面向中国互联网/泛技术岗求职者的 AI 模拟面试 Agent（文字对话）：上传简历 + 粘贴目标 JD，AI 面试官逐题提问并针对性追问，面试后产出逐题四维评分 + 雷达图 + 教练式改进报告——练完一场就能明确知道「差在哪、怎么改」。

两个不可被照抄的机制：

1. **追问由代码状态机而非 LLM 自主决定**——阈值 0.65、每题最多 1 次追问，是代码常量而非模型输出，追问始终围绕预设锚点，面试官不会「顺着候选人走」。
2. **评估 Agent 与面试官 Agent 人格隔离**——评估官只看题目与回答原文，看不到面试官的语气语境，评分独立不虚高。

## 架构

五个角色 Agent + 一个纯代码编排器。Agent = 独立人格 + 独立输出 schema（Zod）+ 独立模型配置；**编排器（状态机，纯代码，不占 LLM）是唯一事实来源**，决定「下一步做什么」，Agent 只负责各自领域的内容生成，彼此不互相对话、只通过编排器传递结构化产物。

```
创建(draft) ──简历分析Agent──▶ ResumeProfile ──出题Agent──▶ 题库(ready)
      ──开始──▶ in_progress ──答完N题──▶ completed ──报告Agent──▶ 报告
                                      │
                          每题循环（编排器调度）：
                          候选人回答 → 评估Agent逐题评分（四维 rubric，0-1 分）
                          → 编排器追问决策（确定性规则）：
                              得分 ≥ 0.65 或本题已追问 1 次 → 下一题（末题则结束）
                              得分 < 0.65 且未追问       → 面试官Agent流式输出追问
                                                             （每轮重新注入人格）
                          → 每轮落盘 messages / evaluations / interviews.status
```

| Agent | 职责 | 模型分工 |
|---|---|---|
| 简历分析 `resume-analyst` | 简历文本结构化（经历/技能/亮点） | 廉价模型 |
| 出题 `question-setter` | 依据画像 + JD + 题型生成题库（含追问锚点） | 廉价模型 |
| 面试官 `interviewer` | 现场话术：提问/追问/过渡，流式输出，不做流程决策 | 廉价模型 |
| 评估 `evaluator` | 逐题按 rubric 打分 + 批注（严格考官人格） | 强模型 |
| 报告 `report-writer` | 汇总逐题评估 → 总分 + 雷达图 + 教练式建议 | 强模型 |

评分维度固定四个：relevance（相关性）/ depth（深度）/ structure（结构化）/ communication（沟通），逐题 0-1 分，报告层折算 0-100。

## 技术栈

- **Next.js 16**（App Router，TypeScript strict）
- **Tailwind CSS v4 + shadcn/ui + recharts**（评分雷达图）
- **Supabase**：Auth（邮箱 magic link + GitHub OAuth）、Postgres（全部表启用 RLS）、Storage（简历 PDF）
- **Vercel AI SDK**（`ai` + `@ai-sdk/openai-compatible`）：任何 OpenAI 兼容端点均可接入，模型按 Agent 粒度可配
- **pnpm**；部署目标 Vercel（serverless，无自建长连接）

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local` 并填写：

```bash
cp .env.example .env.local
```

| 变量 | 含义 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL（Dashboard → Project Settings → API） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名公钥，前端与服务端共享（有 RLS 兜底，不含服务端权限） |
| `LLM_BASE_URL` | LLM 的 OpenAI 兼容端点（如 `https://api.openai.com/v1`、DeepSeek、火山方舟等） |
| `LLM_API_KEY` | 该端点的 API Key |
| `LLM_CHAT_MODEL` | 廉价模型：简历分析/出题/面试官话术使用（如 `gpt-4o-mini`） |
| `LLM_EVAL_MODEL` | 可选：强模型，评估/报告专用（如 `gpt-4o`）；不配则回落到 `LLM_CHAT_MODEL` |
| `SETTINGS_SECRET` | 用户级 LLM 设置（API Key）的加密密钥：任意高熵随机串（如 `openssl rand -base64 32` 生成）。丢失或更换后，已存用户 key 无法解密（自动回落系统默认，设置页会提示重新填写），务必妥善备份 |
| `ASR_BASE_URL` | 可选，用户级 BYOK 配置的回落：语音识别的 OpenAI 兼容端点（`/audio/transcriptions`）；不配则逐字段回落用户的 LLM 端点 |
| `ASR_API_KEY` | 可选，用户级 BYOK 配置的回落：语音识别端点的 API Key；不配则逐字段回落用户的 LLM Key |
| `ASR_MODEL` | 可选，用户级 BYOK 配置的回落：语音识别模型（如 `whisper-1`）；不配则语音作答不可用 |

逐字段回落链：用户 ASR 配置 → 用户已存 LLM 配置 → 环境变量 `ASR_*` → 环境变量 `LLM_*`（模型仅认用户配置与 `ASR_MODEL`，不回落 LLM 模型）。

### 3. 初始化数据库

打开 Supabase Dashboard → **SQL Editor**，把 [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) 的全部内容粘贴进去执行。该脚本建 7 张表（profiles / resumes / interviews / questions / messages / evaluations / reports）并启用 RLS，同时创建简历 PDF 的 Storage bucket 与策略。

再依次执行 [`supabase/migrations/0002_user_settings.sql`](supabase/migrations/0002_user_settings.sql)，建 user_settings 表（用户级 LLM 设置，启用 RLS）。未执行 0002 时设置页可浏览但无法保存（保存会提示「系统尚未启用该功能」）。

继续依次执行 [`supabase/migrations/0003_asr_settings.sql`](supabase/migrations/0003_asr_settings.sql)（user_settings 增加 ASR 配置列，语音输入依赖）与 [`supabase/migrations/0004_real_mode.sql`](supabase/migrations/0004_real_mode.sql)（interviews 增加 mode 列、questions 加 (interview_id, idx) 唯一索引，真实面试模式依赖）。未执行 0004 时创建页无法开考真实面试。

### 4. 开启 Auth 提供方

- **Email（必开）**：Dashboard → Authentication → Sign In / Providers → Email 开启（magic link 模式使用）。
- **GitHub OAuth（可选）**：先在 GitHub 建 OAuth App，其 Authorization callback URL 填 `https://<your-project-ref>.supabase.co/auth/v1/callback`；再在 Supabase → Authentication → Providers → GitHub 填入 GitHub 的 Client ID / Client Secret。
- 在 Supabase → Authentication → URL Configuration 的 Redirect URLs 中加入 `http://localhost:3000/auth/callback`（生产环境加 `https://<your-domain>/auth/callback`），登录回跳由此路由换取会话。

### 5. 启动

```bash
pnpm dev
```

打开 http://localhost:3000 即可。

## 部署到 Vercel

1. 把仓库导入 Vercel（New Project → 选择 repo），框架预设 Next.js，**构建命令与安装命令保持默认**（`pnpm build`），无需改动。
2. 在 Project → Settings → Environment Variables 中添加 `.env.example` 的全部 6 个变量（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_CHAT_MODEL` / `LLM_EVAL_MODEL`）。`NEXT_PUBLIC_` 前缀的两个变量会进入浏览器 bundle，这是 Supabase 设计如此（安全由 RLS 保证）。
3. 在 Supabase → Authentication → URL Configuration 中把生产域名加入 Redirect URLs：`https://<your-vercel-domain>/auth/callback`。
4. Deploy。

## 目录结构

```
app/
  api/
    resume/parse/          # PDF 上传解析（pdf-parse，服务端）
    interview/create/      # 简历分析 + 出题（generateObject 生成题库）
    interview/start/       # 开始面试：取第一题，面试官流式开场
    interview/answer/      # 提交回答 → 评估 → 编排器决策追问/下一题（流式）
    interview/[id]/status/ # 轮询面试状态（刷新恢复）
    interview/[id]/abandon/# 放弃面试（灰章「缺考」）
    interview/report/      # 报告 Agent 汇总生成报告
    settings/              # 用户级 LLM 设置：GET 掩码形态 / PUT 保存（加密入库）
    settings/test/         # 测试连接（草稿可测，业务失败 HTTP 200）
  auth/callback/           # 登录回跳换会话
  login/ dashboard/ resumes/ settings/ interview/new/ interview/[id]/ report/[id]/   # 页面
lib/
  agents/                  # 五个角色 Agent（resume-analyst / question-setter /
                           #   interviewer / evaluator / report-writer）
  orchestrator/            # 纯代码编排器：state-machine.ts（追问决策，唯一事实来源）
                           #   + rubric.ts（四维评分定义，阈值 0.65 常量在此）
  ai/                      # provider.ts（OpenAI 兼容工厂，按 Agent 分模型）+ schemas.ts（Zod）
  supabase/                # client / server / middleware helpers
  resume/                  # pdf.ts（PDF 抽取封装）
  settings/                # crypto.ts（AES-256-GCM）+ service.ts（配置解析/掩码）+ validation.ts（入参校验）
  copy.ts                  # 全部中文文案集中管理
supabase/migrations/       # 0001_init.sql：建表 + RLS + Storage；0002_user_settings.sql：用户级 LLM 设置；0003_asr_settings.sql：ASR 配置；0004_real_mode.sql：真实面试模式
tests/                     # vitest：orchestrator / agents / ai / interview / resume / settings / api
```

## 设计语言

整站视觉是**一册考官评分簿（Examiner's Rubric）**：用户在「作答」，面试官在「批改」，系统在「记录」。三色油墨纪律——黑印刷（结构与正文）、红批改（只出现在分数、批注、雷达图等评估时刻）、蓝作答（只属于用户的输入与进行中状态），任何 UI 不引入第四种墨色；配细表格线、印章式结果标记与阻尼动效。完整规范见 [docs/superpowers/briefs/2026-09-25-mirror-v1-ux-brief.md](docs/superpowers/briefs/2026-09-25-mirror-v1-ux-brief.md)。

## 用户自带 LLM 配置（设置页）

每位用户可在 **/settings**（Dashboard 卷首「设置」入口）配置自己的 OpenAI 兼容 LLM：Base URL、API Key、对话模型、评估模型，不必依赖部署者提供的系统默认。

- **回落语义（逐字段）**：任何字段留空即回落系统默认（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_CHAT_MODEL` / `LLM_EVAL_MODEL`）；已填写的字段优先生效。评估模型留空时，评估/报告回落到对话模型（系统级同理）。
- **保存即加密入库**：API Key 由服务端以 AES-256-GCM 加密后存入 `user_settings.llm_api_key_enc`，加密密钥由 `SETTINGS_SECRET` 经 SHA-256 派生。页面与接口只回显掩码（`****` + 末 4 位），明文与密文均不回显、不写日志。
- **SETTINGS_SECRET 的作用与丢失后果**：它是唯一能解出用户 key 的密钥。丢失或更换后，已存密文无法解密——调用自动回落系统默认 LLM，设置页会显示红墨批注提示重新填写；不会影响其余功能。请生成后妥善备份（如密码管理器）。
- **测试连接**：保存前即可验证草稿配置——「测试连接」按钮把当前表单里非空的草稿字段临时覆盖到现有配置上，向该端点发一次一句话补全探测；草稿 key 仅本次请求内存使用，绝不写库、绝不回显。不带任何草稿时测试已保存配置。
- **前置条件**：需先应用 0002 迁移（见「本地开发 → 初始化数据库」）；未应用时保存接口返回「系统尚未启用该功能」。

## 已知边界（v1）

- **仅支持 PDF 简历**（扫描件/图片型 PDF 无法抽取文本，会拒收）；文本粘贴是平等兜底入口。
- **无语音**：文字对话先行，语音为二期。
- **单用户练习额度未做**：登录用户暂无练习次数上限，可无限次开卷演练（额度/配额管控属二期）。
- **移动端为降级体验**：桌面优先设计，小屏幕可用但非完整体验。
- **用户 API key 服务端 AES-256-GCM 加密存储，数据库被攻破且 SETTINGS_SECRET 泄漏时可见**：单靠其一（仅库泄露或仅密钥泄露）不可逆。

## 二期路线

- **语音面试**：客户端 WebRTC + Vapi / OpenAI Realtime，服务端仅签发 token（Vercel serverless 跑不了长连 WebSocket，不做自建 WS）。
- **多次练习成绩曲线**：跨场次的维度趋势追踪。
- **支付**：付费场次/订阅。
- **国际化（i18n）**：当前仅简体中文，文案已集中在 `lib/copy.ts`，切换成本低。
