# 面镜 Mirror — 打磨轮清单（v1.1 后，2026-09-26 重建）

> **状态：已完成**（2026-09-26，两批实施 + 审查通过，commits f9aef26..49a0423，88 用例全绿）。本文转为存档。

来源：SDD 13 任务审查台账 + 最终全分支审查 triage + v1.1（Task 14/15）审查。
标记：🔧 本轮修 / ⛔ 记录性不修（有裁决）。

## 批次 1：文案集中 + 测试补强（机械性，一次实施）

- 🔧 A1 API 路由硬编码中文收口（约 10 处）：answer:26,73 / start:22,78 / create:33,86 / report:26,40,52 / abandon:32 → `COPY.api`（或 interview 节点）
- 🔧 A2 前端硬编码收口：chat-stream「Enter 发送 · Shift+Enter 换行」、question-progress aria 文案与「追」、interview/[id] 与 report/[id]「卷号」
- 🔧 A3 死键清理：`report.radarTitle`、`interview.title`（未引用）
- 🔧 A4 README「单用户练习额度未做：未做练习额度。」措辞重复 → 改为有信息量表述
- 🔧 A5 设置页失效 key placeholder 空括号「已配置（），留空保持不变」→ keyMask 为空时改用「已存密钥无法解密」专用 placeholder
- 🔧 A6 「✓」符号进 copy.ts（llm-settings-form 两处）
- 🔧 C1 schemas 测试补强：dimensionScores 越界（如 120）被拒、11 题被拒
- 🔧 C2 decryptSecret 格式化错误：缺段/空段抛 `unsupported secret format` 而非 TypeError；补对应测试
- ⛔ C3 keyMask 失效路径自动化测试（DB 耦合，getMaskedLlmSettings 依赖服务端 client）——记录
- ⛔ C4 provider 测试对 SDK 内部形状（config.url/headers）的依赖——记录（升级时误报可接受）

## 批次 2：API 硬化 + UI/a11y 打磨

- 🔧 B1 error.message 直通客户端（500/502 多处）→ 统一换通用文案，原始 message 进 console.error（保留 create 路由已有的 raw output 头部诊断，那是 schema 诊断不是泄漏面）
- 🔧 B2 answer 路由 catch 内回滚 update 检查 error（失败 console.error，不吞）
- 🔧 B3 create 路由 `request.json()` 兜底 → 非法 body 400（对齐 answer/start 先例）
- 🔧 B4 start 路由状态条件守卫：`.eq("status", "ready")`，双标签页竞态防护
- 🔧 B5 report 路由 catch PostgREST 23505 → 回读已有 report 返回幂等结果
- 🔧 B6 resumes 销档顺序：先删行、Storage 尽力而为（失败仅日志，避免孤儿行）
- 🔧 B7 resumes 文件大小上限校验（≤10MB，422）
- 🔧 B8 middleware startsWith 收紧为按段匹配（/report-xxx 不再误保护）
- 🔧 B9 登录后回跳来源页：middleware 重定向带 `?next=`，callback/登录成功消费
- 🔧 B10 signInWithGitHub 加 .catch → 错误批注
- 🔧 B11 structured_json 已存在时 create 路由跳过重复回写
- 🔧 B12 简历卡展示已生成画像摘要（structured_json 存在时渲染 skills 前 N 个 + summary；当前恒为「画像待生成」占位）
- 🔧 D1 Dashboard 移动端单列化（目录行改为纵向堆叠卡，替代横向滚动）
- 🔧 D2 整行焦点态加可见轮廓（outline，不只 4% 墨底）
- 🔧 D3 灰章对比度：pencil 用色在章文字处加深一档（≥4.5:1）
- 🔧 D4 登录页 error=auth 与 sent 态不同屏（有错时隐藏 sent 提示）
- 🔧 D5 设置页表单加「清除已存密钥」按钮（调 PUT 传空串，API 已支持）
- 🔧 D6 创建页简历 radiogroup 方向键切换（↑↓ 选择）
- 🔧 D7 宋体跨平台回退：标题字体栈加 Noto Serif SC webfont（next/font/google，swap）
- ⛔ B13 status 轮询失败进度停摆——记录（低概率，客户端已有本地降级；改提示反而添噪）
- ⛔ 评估 Agent 全场对话口径（M-2）——维持原裁决（评估器 prompt 按对话 transcript 设计）
- ⛔ interviews.resume_id composite FK / messages.question_id 跨卷——RLS 已挡跨用户，纵深防御延后
- ⛔ pnpm-workspace sharp 构建禁用——部署图片优化报错时第一排查点
- ⛔ 连续两条 user 消息 / buildReportMessages 长度防御 / 400 文案映射 / 状态文案两处重复——契约内不可达或语境正确

## 验收

每批次：`pnpm exec tsc --noEmit` + `pnpm test` 全绿 + `pnpm build` 通过；文案零硬编码中文（grep 自查）；提交 Conventional Commits。
