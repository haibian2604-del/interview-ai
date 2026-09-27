# 实现方案：真实面试模式（v1.2）

> 状态：**待用户确认**。grill-me 三轮已锁定全部决策，本文是共识的书面化。
> 确认后按 SDD 流程拆 Task 实施。

## 一、已确认决策（grill 三轮）

| # | 决策 | 结论 |
|---|------|------|
| 1 | 出题机制 | **渐进生成**：题目不预先存在，出题 Agent 根据简历+JD+已问历史逐题生成 |
| 2 | 追问强度 | 与练习模式一致：每题最多 1 次追问（阈值 0.65 不变） |
| 3 | 创建页交互 | 顶部两张模式卡；选「真实面试」后题型/题数控件整体隐藏，显示说明文字 |
| 4 | 命名 | 「真实面试」/「练习试卷」 |
| 5 | 结束规则 | **性能驱动终止**（详见第三节），10 题是目标值不是硬标准 |
| 6 | 衔接体验 | **自动接续**：答完自动显示「考官翻阅你的档案…」并静默生成下一题，无需点击 |
| 7 | 状态机 | 不新增状态；提前结束以徽章呈现（报告页 + Dashboard 列表） |
| 8 | 管线复用 | 恢复/放弃/评估/报告/语音输入全部复用现有机制 |

## 二、体验流程（真实面试）

```
创建（选「真实面试」卡） → start：开场白 + 第一题（现场生成）
  → 用户作答 → 评估 → 追问？（≤1 次） → 面试官点评/转场
  → 【考官翻阅你的档案…】自动生成下一题 → 流式题干 → 下一题 …
  → 终止规则命中（提前收尾话术）或答满 10 题（常规收尾话术）
  → completed → 报告（标注模式与实答题数）
```

与练习试卷的本质区别：题目不预先存在；后面的问题踩着你前面的回答走（历史感知出题）；结束时机由你的表现决定。

## 三、终止规则引擎（编排器确定性常量，与 FOLLOWUP_THRESHOLD=0.65 同性质）

新增 `lib/orchestrator/real-mode.ts`，常量 + 纯函数：

```ts
export const REAL_MODE = {
  target: 10,            // 目标题数，答满正常收尾
  minBeforeEarlyStop: 5, // 提前终止下限：少于 5 题样本无报告价值
  consecutiveLimit: 3,   // 连续 3 题综合分低于阈值 → 提前终止
  consecutiveScore: 0.4,
  averageScore: 0.45,    // 或累计均值 < 0.45（且已答 ≥ 5）→ 提前终止
  maxQuestions: 15,      // 绝对上限（防御性兜底，未来规则扩展用）
} as const;

/** 输入：已完成题的综合分列表（四维均值，0-1）。输出：是否终止 + 原因 */
export function checkTermination(scores: number[]): { terminate: boolean; reason: "target" | "early" | null }
```

判定逻辑：`scores.length >= 10` → target；`length >= 5 && (末尾连续 3 个 < 0.4 || 均值 < 0.45)` → early；否则继续。

综合分定义：单题评估四维（relevance/depth/structure/communication）的算术均值，数据源为 evaluations 表（现有，每题评估已落库）。

## 四、数据模型

**migration 0004_interview_mode.sql**（用户在 Supabase SQL Editor 手动执行）：

```sql
alter table public.interviews
  add column mode text not null default 'practice';
-- check 约束
alter table public.interviews
  add constraint interviews_mode_check check (mode in ('practice', 'real'));
```

存量数据自动为 `practice`，无需回填。

**`question_count` 语义分叉**（关键）：practice 模式不变（出卷后 = 实际题数）；real 模式下 = **实际已生成题数**，创建时为 0、每生成一题 +1。目标值 10 来自 `REAL_MODE.target` 常量（服务端渲染传给前端，与 DB 无关）。「提前结束」可推导：`mode = 'real' && status = 'completed' && question_count < 10`，不落库。

## 五、Agent 层改动

**新增渐进出题 Agent**（`lib/agents/question-setter.ts` 扩展）：

- `buildRealtimeQuestionMessages({ profile, jdText, position, askedQuestions, recentContext })`：系统指令 = 综合面试官视角，基于候选人画像、目标 JD、**已问过的题目与考察点列表**（避免重复）、最近回答摘要（可顺延回答中暴露的点深挖），生成**恰好 1 道**新题（content/type/skillTag/followupAnchor）。type 仅在 skill/project/behavioral 内自然选择（真实模式 = 综合）。
- `generateNextQuestion(userId, input): Promise<Question>`：`generateObject` + `QuestionSchema`（单题）+ `withSchemaRetry`（`maxOutputTokens` 仍 4096——单题输出极短，无截断风险）+ shapeHint 单题骨架 + **salvage 复用**：单题版抢救 = `salvageQuestionSet` 收割后取第一题。

现有批量出题（练习模式）零改动。

## 六、编排器与 API 改动

| 路由 | 改动 |
|------|------|
| `POST /api/interview/create` | body 增 `mode`（缺省 practice）。real 分支：**跳过出卷**，`interview_type` 强制 `'mixed'`，`question_count: 0`，status `ready`。practice 分支零改动 |
| `POST /api/interview/start` | real 分支：生成开场白 + **第一题**（realtime Agent）→ insert question → `question_count: 1` → 流式开场白+题干。幂等语义照旧（已有题则返回现有第一条消息） |
| `POST /api/interview/answer` | 评估与 followup 分支**零改动**。`next_question` 决策后分叉：practice = 现有（流下一题干，题在库里）；real = 流完点评/转场话术即结束响应，前置**终止检查**——命中 target/early 则走现有 finish 收尾路径（话术略调：「今天先到这里」语气），响应头 `X-Interview-Action: finish`、`X-Interview-End: early`（early 时）；未命中则响应头 `X-Interview-Action: next_question` + `X-Interview-Next: generate`，**题干不在本响应内**（60s maxDuration 约束：评估+话术已占大半，出题拆到下一请求） |
| `POST /api/interview/[id]/next-question`（新增） | real 专用：double-check 终止规则 → realtime Agent 生成下一题 → insert → `question_count` +1 → 响应头携带新题元数据（`X-Question-Index` / `X-Question-Tag` JSON），body 流式题干。completed/abandoned → 409。practice 调用 → 409 |
| `GET /api/interview/[id]/status`、`abandon`、report | 零改动（报告路由读 `mode` + `question_count` 供徽章推导） |

**编排器状态机不变**：追问/收尾决策规则原样；新增的只是 real 模式下 `next_question` 的题干来源与终止检查入口。

## 七、前端改动

| 页面/组件 | 改动 |
|-----------|------|
| 创建页 | 顶部两张模式卡（选中态 = 蓝墨描边）。「练习试卷」= 现有全部控件；「真实面试」= 隐藏题型/题数，显示说明（「综合题型 · 目标 10 题 · 考官将根据你的回答追问与渐进出题，表现低迷会提前收尾」） |
| 面试页 ChatStream | real 模式：① `action === 'next_question'` 流结束后自动显示「考官翻阅你的档案…」加载气泡 → fetch next-question → 流入新题干气泡，失败显示「继续」重试按钮；② 进度展示「第 N 题 · 目标 10」（question_count 渐进增长，答题卡圆点按目标 10 固定渲染）；③ 提前结束走现有 completed 分支跳报告 |
| Dashboard | 列表记录加模式徽章（真实面试 / 练习试卷）；real + completed + count<10 加「提前结束 · N 题」 |
| 报告页 | 顶部模式徽章 + 同款提前结束标注 |

文案全部进 `lib/copy.ts`（`realMode` 段 + 现有段扩展）。

## 八、测试

- `checkTermination` 纯函数：边界全覆盖（恰好 5 题、恰好 10 题、连 2 不触发、连 3 触发、均值边界 0.45/0.40、混合规则优先级）。
- `buildRealtimeQuestionMessages` 纯函数：历史感知（askedQuestions 进 prompt）、去重指令存在性。
- 单题 salvage：嵌套/截断/缺字段输出 → 抢救出 1 题。
- 路由分支：create real 跳过出卷 / start real 首题生成 / answer real 终止触发 finish / next-question practice 409。沿用「路由薄、纯函数下沉 lib」风格。

## 九、风险与对策

| 风险 | 对策 |
|------|------|
| next-question 生成耗时（5-15s） | 前端明确 loading 态（「考官翻阅你的档案…」），语义化等待 |
| 历史感知 prompt 膨胀 | 只带已问题目 content+skillTag 列表与最近 1 轮回答摘要，15 题上限内 token 可控 |
| 模型重复考察点 | prompt 硬指令「不得与已问考察点重复」+ skillTag 列表白名单式排除 |
| 每请求 60s maxDuration | 出题独立成请求，单请求负载与现有一致 |
| 存量数据 | mode 默认 practice，question_count 语义在 practice 分支零改动 |

## 十、任务切分（SDD 供参考，确认后细化）

1. 0004 迁移 + real-mode 常量/终止规则引擎 + 测试
2. 渐进出题 Agent + 单题 salvage + 测试
3. create / start 路由 real 分支
4. answer 路由 real 分支 + next-question 新路由
5. 创建页模式卡
6. 面试页接续 + 进度 + 三处徽章
7. 全量验证 + 冒烟清单
