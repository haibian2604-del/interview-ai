---
name: project-grill
description: 真实面试项目题的「问穿」技能：项目题锁定简历中一条具体 Claim 深挖验证，追问只追最关键的缺失证据，按风险信号降阶。凡真实面试模式（real）生成项目题（type=project）或对其追问时必须应用；练习模式、其他题型不适用。
---

# project-grill：项目题问穿

泛泛的项目题（「讲讲你的项目」）验证不了真实掌握：候选人可以背诵准备好的故事。项目题的价值在于把简历里的主张（Claim）变成可验证的问题——暴露「简历写得比实际掌握更强」的部分。追问预算有限（每题最多 1 次，由代码状态机硬顶），所以每一次追问必须用在最关键的缺失证据上。

## 适用条件

- 仅 `mode=real` 且 `type=project` 的题目（路由判定见 lib/agents/skills/project-grill.ts 的 isProjectGrillApplicable）。
- 练习模式的一次性出卷、skill/behavioral 题型走通用链路，不注入本技能。
- 本技能只改变**问什么**，不改变**问几次**：追问次数、终止、提前收尾一律由编排器状态机决定。

## 工作流

1. **出题**：生成项目题前读取 [references/question-contract.md](references/question-contract.md) 的契约全文注入提示词——锁定一条 Claim、skillTag 用 Claim 主题去重、followupAnchor 给下一层追问方向。
2. **评估**：通用四维评分不变（分数驱动状态机的追问/换题/收尾决策），本技能不介入评分。
3. **追问**：触发追问时读取 [references/followup-directives.md](references/followup-directives.md) 的模板拼接追问指令——代入本题锚点与评估不足，只追一个最关键缺失证据。

## 硬边界

- 不替候选人补造项目事实；只依据可见证据提问与追问。
- 候选人明显卡住时降阶为最小事实问题；仍答不出就交回状态机（换题或收尾），不恋战。
- 简历画像（experiences/projects）即 Claim 池；画像未生成的档案没有 Claim 可问，自然回落通用链路。
