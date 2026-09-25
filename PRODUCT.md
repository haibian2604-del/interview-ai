# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16（App Router，TypeScript strict）+ Tailwind v4 + shadcn/ui + Supabase（Auth/Postgres/Storage）+ Vercel AI SDK（OpenAI 兼容，模型可配）+ pnpm；部署目标 Vercel。多 Agent 架构（简历分析/出题/面试官/评估/报告五个角色 Agent + 纯代码编排器），详见 docs/PLAN.md 与 docs/superpowers/plans/2026-09-25-interview-ai-v1.md。

## Users

主用户：中国互联网/泛技术岗位的求职者（应届生与 1-3 年经验为主，软件、算法、产品、运营等），正在准备或即将进入面试，需要一个随叫随到、有真实追问感的练习对手。核心场景：投递前用目标 JD + 简历定制一场模拟面试，练完拿评分报告改进。

## Product Purpose

AI 模拟面试 Agent（文字对话）：上传简历 + 粘贴目标 JD，AI 面试官逐题提问并针对性追问（每题最多 1 次，由确定性规则驱动），面试后产出逐题评分 + 四维雷达图 + 教练式改进报告。成功标准：用户练完一场能明确知道「差在哪、怎么改」，并愿意再练一场。

## Positioning

不可被竞品照抄的机制：**追问由代码状态机而非 LLM 自主决定**（阈值 0.65、每题最多 1 次）+ **评估 Agent 与面试官 Agent 人格隔离、只看题目与回答原文**。这保证追问始终围绕预设锚点、评分独立不虚高——同类开源项目普遍败在「面试官顺着候选人走」和「普遍给高分」。

## Operating Context

- 面试结构：创建时按简历画像 + JD 一次生成题库（默认 6 题，3-10 可调），题型分技能/项目/行为/混合
- 评分维度固定四个：relevance（相关性）/ depth（深度）/ structure（结构化）/ communication（沟通），逐题 0-1 分，报告层折算 0-100
- 每轮对话实时落盘（可刷新恢复），面试可中途放弃（abandoned）
- LLM 供应商可切换（OpenAI 兼容端点）：出题/话术用廉价模型，评估/报告用强模型
- MVP 不做支付、不做语音（语音为二期：客户端 WebRTC + Vapi/Realtime，服务端仅签 token）

## Capabilities and Constraints

- 已确认功能：邮箱 magic link + GitHub OAuth 登录；简历 PDF 上传解析（+文本粘贴兜底）；简历结构化画像（JSON）；定制出题；文字面试对话（打字机流式）；逐题评分；综合报告（雷达图）；历史列表
- 明确未定（二期候选）：语音面试、多次练习成绩曲线、支付、国际化（当前仅中文，文案集中 lib/copy.ts）
- 技术约束：TypeScript strict；全部表 RLS；Vercel serverless（不能跑长连接 WebSocket）；评估阈值是代码常量而非模型输出

## Brand Commitments

- 产品名：**面镜 Mirror**（登录页标题、Dashboard、报告页等所有 UI 使用此名；寓意「照镜子式演练」——面试是自我认知的镜子，练习即反思）
- 界面语言：简体中文；口吻面向互联网求职者，专业但不端着（面试官人格友好、评估官人格严格——两套 Agent 人格差异要能从文案读出来）

## Evidence on Hand

- 无真实用户数据、无案例、无佐证素材；报告中不得虚构用户评价或成功率数据
- 可用资产：完整实现方案 docs/PLAN.md、执行计划 docs/superpowers/plans/2026-09-25-interview-ai-v1.md、GitHub 同类项目调研（在会话与 PLAN.md 中）

## Product Principles

1. **真实感优先**：追问像真人面试官（围绕锚点、不逐字念稿），这是产品生死线，宁可牺牲「评分好看」。
2. **反馈可执行**：每条批评都要配具体改法（教练式），不给「加强深度」这种空话。
3. **严格但不打击**：评估官人格严格（防虚高），报告表达面向行动（优势先说、短板给路径）。
4. **状态是事实来源**：面试进度、评分、报告全部以落盘数据为准，UI 永远反映真实状态（含中断恢复）。
5. **中文互联网求职语境**：术语、示例、岗位模板默认贴合国内技术岗招聘现实（如「八股文」「项目深挖」「STAR」）。

## Accessibility & Inclusion

无用户群体确认的特殊需求；遵循 shadcn/ui 自带的无障碍基线（键盘可达、焦点可见、对比度达标）。
