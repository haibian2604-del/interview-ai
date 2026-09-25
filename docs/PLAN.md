# AI 模拟面试 Agent — 实现方案（v1 待确认）

> 状态：**待用户确认**。确认后才进入实施。
> 决策依据：GitHub 同类项目调研（2026-09）+ 已确认的需求决策（见文末）。

## 一、调研结论摘要

对 8 个代表性开源项目（interview-coder、cheetah、Snailclimb/interview-guide、liftoff、offerPilot、Prepwise、IliaLarchenko/Interviewer、XUZIAa/Multi-Agent-Mock-Interview）的调研得出对本项目直接可用的结论：

**要借鉴的：**
1. **先出结构化题库、再逐题面试**——不要让 LLM 面试中自由发挥（XUZIAa、interview-guide 的共同做法）。
2. **追问由确定性代码控制，模型只生成话术**——状态机是唯一事实来源，每轮重新注入面试官人格，防止「顺着候选人走」的人格漂移（XUZIAa 的核心设计）。
3. **评分必须结构化 rubric + 逐题独立评估**，不要一次 prompt 打总分（LLM 打分方差大、普遍给高分）。
4. **每轮对话落盘**，会话可恢复——教程类项目（Prepwise/liftoff）刷新即丢是被诟病最多的点。
5. **供应商抽象层**（IliaLarchenko/Interviewer 的亮点）：换 provider 零成本。
6. **向量存储轻量化**：用 pgvector 而非独立向量库（interview-guide）。

**要避开的坑：**
1. **Vercel serverless 跑不了长连接 WebSocket**（alading 项目实测踩坑）→ 二期语音不能走自建 WebSocket，走客户端 WebRTC（Vapi 或 OpenAI Realtime，服务端只签发 token）。
2. 语音面试 token 成本是文字的数倍 → 模型分工：便宜模型做出题/话术，强模型只做评分/报告。
3. 避免重 agent 框架：本场景是线性状态流，显式状态机比 LangGraph 更可调试、更省 token。

## 二、技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 15（App Router）+ TypeScript strict | 需求指定；Vercel 原生 |
| UI | Tailwind CSS + shadcn/ui + recharts（评分雷达图） | 已确认 Q5 |
| 数据库 | Supabase Postgres（含 pgvector 扩展，二期 RAG 预留） | 需求指定 |
| 认证 | Supabase Auth（邮箱 magic link + GitHub OAuth） | 已确认 Q6，MVP 不做支付 |
| 文件存储 | Supabase Storage（简历 PDF） | 与数据库同生态，免自建 |
| LLM 接入 | Vercel AI SDK（`ai` 包）+ OpenAI 兼容 provider | 已确认 Q4：base URL/model 全部 env 可配，默认可指向 OpenAI / DeepSeek / 火山方舟 |
| 结构化输出 | AI SDK `generateObject` + Zod schema | 出题、评分、报告都需要强 schema |
| PDF 解析 | `pdf-parse`（服务端 Route Handler 内） | 已确认 Q3 |
| 校验/表单 | react-hook-form + Zod | — |
| 部署 | Vercel + Supabase Cloud | 需求指定 |

## 三、Agent 架构（多 Agent 分工）

每个模块由一个独立 Agent 负责。Agent = 独立系统人格 + 独立输出 schema + 独立模型配置，统一实现 `Agent` 接口，由**编排器（状态机，纯代码，不占 LLM）**调度——编排器决定「下一步做什么」，Agent 只负责「各自领域的内容生成」。

| Agent | 职责 | 输入（最小上下文） | 输出（Zod schema） | 模型 |
|---|---|---|---|---|
| **简历分析 Agent**<br>`resume-analyst` | 简历文本结构化（经历/技能/亮点），供出题聚焦 | 简历纯文本 | `ResumeProfile`（jsonb 存 resumes.structured_json） | 廉价模型 |
| **出题 Agent**<br>`question-setter` | 依据简历画像 + JD + 题型生成结构化题库（含追问锚点） | ResumeProfile + JD + 配置 | `QuestionSet[]` | 廉价模型 |
| **面试官 Agent**<br>`interviewer` | 面试现场话术：提问、追问、过渡。**每轮重新注入人格**，只生成话术，不做任何流程决策 | 当前题 + 本题对话 + 追问指令（来自编排器） | 流式文本 | 廉价模型 |
| **评估 Agent**<br>`evaluator` | 逐题按 rubric 打分 + 批注。独立人格（严格考官），与面试官隔离避免「自己夸自己」 | 单题 + 候选人回答 + rubric | `Evaluation` | 强模型 |
| **报告 Agent**<br>`report-writer` | 汇总逐题评估生成总报告 + 教练式改进建议 | 全部 Evaluation | `Report` | 强模型 |

设计约束（来自调研教训）：

1. **Agent 之间不互相对话**，只通过编排器传递结构化产物——防止多 Agent 链路放大漂移和 token。
2. **每个 Agent 只拿到自己的最小上下文**（如评估 Agent 看不到面试官的语气语境，只看题目和回答原文），既省钱又保证评分独立性。
3. 模型按 Agent 粒度配置（`MODEL_QUESTION` / `MODEL_INTERVIEWER` / `MODEL_EVAL` / `MODEL_REPORT`），都缺省回落到 `LLM_CHAT_MODEL`。
4. 编排器是唯一事实来源；面试官 Agent 被明确禁止决策「是否追问/换题」（见流程图中的确定性规则）。

## 四、模块划分

```
interview-ai/
├── app/
│   ├── (auth)/login/              # 登录页
│   ├── (app)/
│   │   ├── dashboard/             # 面试历史 + 发起入口
│   │   ├── resumes/               # 简历管理（上传/列表/删除）
│   │   ├── interview/new/         # 创建面试（选简历、贴 JD、岗位、题型、题数）
│   │   ├── interview/[id]/        # 面试对话现场（核心页）
│   │   └── report/[id]/           # 面试报告页（雷达图 + 逐题批注）
│   └── api/
│       ├── resume/parse/          # PDF 上传解析
│       ├── interview/create/      # 出题（generateObject 生成题库）
│       ├── interview/answer/      # 提交回答 → 评分 → 追问/下一题（流式）
│       └── interview/finish/      # 生成总报告
├── lib/
│   ├── agents/                    # 多 Agent 实现（接口 + 各角色）
│   │   ├── types.ts               # Agent 统一接口（name/persona/schema/model/run）
│   │   ├── resume-analyst/
│   │   ├── question-setter/
│   │   ├── interviewer/
│   │   ├── evaluator/
│   │   └── report-writer/
│   │   └── (每个子目录: index.ts + prompt.ts)
│   ├── orchestrator/
│   │   ├── state-machine.ts       # 编排器：状态流转 + 追问决策（确定性规则，唯一事实来源）
│   │   └── rubric.ts              # 评分维度定义（技术深度/相关性/结构化/沟通）
│   ├── ai/
│   │   ├── provider.ts            # OpenAI 兼容 provider 工厂（env 驱动，按 Agent 粒度选模型）
│   │   └── schemas.ts             # Zod：ResumeProfile / QuestionSet / Evaluation / Report
│   ├── supabase/                  # client / server / middleware helpers
│   └── resume/pdf.ts              # pdf-parse 封装
├── components/
│   ├── interview/                 # 对话流（打字机）、题目卡、进度条、计时器
│   ├── report/                    # 雷达图、逐题批注卡
│   └── ui/                        # shadcn
└── supabase/
    ├── migrations/                # 建表 SQL
    └── config.toml
```

## 五、数据模型（Postgres）

```
profiles        id(=auth.users) · display_name · quota_used · quota_reset_at
resumes         id · user_id · storage_path · raw_text · structured_json(jsonb,预留) · created_at
interviews      id · user_id · resume_id · position · jd_text · interview_type
                · question_count · status(draft|generating|in_progress|completed|abandoned)
                · current_question_index · created_at · completed_at
questions       id · interview_id · idx · content · type(skill|project|behavioral)
                · skill_tag · followup_anchor(预设追问锚点) · created_at
messages        id · interview_id · question_id · role(interviewer|candidate|followup) · content · created_at
evaluations     id · question_id · scores(jsonb: {relevance, depth, structure, communication})
                · strengths · improvements · star_completeness · created_at
reports         id · interview_id · overall_score · dimension_scores(jsonb)
                · summary_md · strengths_md · improvements_md · created_at
```

- 全部表启用 RLS（`user_id = auth.uid()`），这是 Supabase 直接暴露给前端的防线。
- evaluations 按题逐条落盘 → 报告页直接读，总报告只是一次汇总调用。

## 六、核心流程（编排器状态机 × 多 Agent）

```
创建(draft) ──简历分析Agent──▶ ResumeProfile ──出题Agent──▶ 题库(ready)
      ──开始──▶ in_progress ──答完N题──▶ completed ──报告Agent──▶ 报告
                                      │
                          每题循环（编排器调度）：
                          候选人回答 → 评估Agent逐题评分(generateObject)
                          → 编排器追问决策（确定性规则）：
                              得分 ≥ 0.65 或已追问1次 → 下一题
                              得分 < 0.65 且未追问   → 面试官Agent流式输出追问（每轮重新注入人格）
                          → 每轮落盘 messages/evaluations/interviews.status
```

追问决策阈值是代码常量而非模型输出——这是从 XUZIAa 学来的抗漂移核心。**模型分工**（按 Agent 粒度 env 配置，成本优化）：简历分析/出题/面试官话术用廉价模型；评估/报告用强模型。

## 七、页面清单（MVP）

1. 登录页（magic link / GitHub OAuth）
2. Dashboard：历史面试列表（状态、岗位、总分）、新建按钮
3. 简历管理：上传 PDF → 抽取文本 → 预览
4. 创建面试：选简历 + 贴 JD + 岗位 + 类型（技术/行为/项目深挖）+ 题数（默认 6）
5. 面试现场：左侧题目进度，右侧对话流（流式打字机），支持中途放弃
6. 报告页：总分 + 四维雷达图 + 逐题评分批注 + 改进建议

## 八、里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| M1 | 骨架：Next.js + shadcn + Supabase（auth/建表/RLS）+ git init | 0.5 天 |
| M2 | 简历上传解析 + 简历分析 Agent + 创建面试 + 出题 Agent | 1 天 |
| M3 | 面试对话流 + 编排器状态机 + 面试官/评估 Agent（核心难点） | 1.5 天 |
| M4 | 逐题评分 + 报告页（雷达图） | 1 天 |
| M5 | Dashboard、错误处理、加载态、Vercel 部署上线 | 0.5 天 |
| 二期 | 语音（客户端 WebRTC + Vapi/Realtime，服务端仅签 token）、评分曲线、支付、i18n | — |

## 九、实施前需要你提供的

1. Supabase 项目（或我给出建项目步骤，env：`NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`）
2. LLM API Key（OpenAI 兼容即可）：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_CHAT_MODEL`（简历分析/出题/面试官用）+ `LLM_EVAL_MODEL`（评估/报告用，不配则同 `LLM_CHAT_MODEL`）

## 十、已确认的需求决策（记录）

B2C 求职练习 · 文字先行（语音二期）· 简历+JD 定制出题（不做代码判题）· Vercel AI SDK 供应商可切换 · **多 Agent 分工（简历分析/出题/面试官/评估/报告五个角色 Agent + 纯代码编排器，不用 LangGraph 等重框架）** · 逐题评分+综合报告（曲线二期）· MVP 无支付 · 中文界面（文案集中管理）· 逐题推进+每题最多 1 次追问 · 简历 PDF 上传+文本兜底 · shadcn/ui · TS strict + App Router + ESLint + git 初始化。
