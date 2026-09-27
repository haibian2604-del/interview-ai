import { describe, expect, it } from "vitest";
import {
  CLAIM_TAXONOMY,
  PROJECT_GRILL,
  isProjectGrillApplicable,
  projectGrillFollowupDirectives,
  projectGrillQuestionContract,
} from "@/lib/agents/skills/project-grill";
import { buildRealtimeQuestionMessages } from "@/lib/agents/question-setter";

describe("isProjectGrillApplicable（仅真实面试的项目题启用）", () => {
  it("real + project 命中", () => {
    expect(isProjectGrillApplicable("real", "project")).toBe(true);
  });
  it("非项目题 / 非真实面试 / 未知模式不命中", () => {
    expect(isProjectGrillApplicable("real", "skill")).toBe(false);
    expect(isProjectGrillApplicable("real", "behavioral")).toBe(false);
    expect(isProjectGrillApplicable("practice", "project")).toBe(false);
    expect(isProjectGrillApplicable("unknown", "project")).toBe(false);
  });
});

describe("projectGrillQuestionContract（出题侧契约）", () => {
  it("五类 Claim 齐备且各有验证重点", () => {
    expect(CLAIM_TAXONOMY).toHaveLength(5);
    const kinds = CLAIM_TAXONOMY.map((c) => c.kind).join();
    for (const key of ["Ownership", "Metric", "Technical", "Architecture", "Result"]) {
      expect(kinds).toContain(key);
    }
    for (const c of CLAIM_TAXONOMY) {
      expect(c.probe.length).toBeGreaterThan(5);
    }
  });

  it("契约要求锁定 Claim、skillTag 去重、followupAnchor 给下一层追问", () => {
    const contract = projectGrillQuestionContract();
    expect(contract).toContain(PROJECT_GRILL.name);
    expect(contract).toContain("锁定简历中的一条具体 Claim");
    expect(contract).toContain("skillTag");
    expect(contract).toContain("followupAnchor");
    expect(contract).toContain("下一层最值得追问");
  });

  it("已接入真实面试单题生成的 system 提示词", () => {
    const built = buildRealtimeQuestionMessages({
      profile: { summary: "s", skills: [], experiences: [], projects: [{ name: "风控引擎", highlights: [] }] },
      jdText: "",
      position: "后端",
      askedQuestions: [],
      stage: "deep",
      difficulty: "hard",
      target: 10,
    });
    const system = built[0].content;
    expect(system).toContain("项目题问穿契约");
    expect(system).toContain("Ownership");
  });
});

describe("projectGrillFollowupDirectives（追问侧指令）", () => {
  const directives = projectGrillFollowupDirectives({
    anchor: "分库分表改造",
    improvements: "说不清个人负责边界",
  });

  it("携带本题 Claim 锚点与评估不足", () => {
    expect(directives).toContain("分库分表改造");
    expect(directives).toContain("说不清个人负责边界");
  });

  it("一次只追一个关键证据，且覆盖风险信号与降阶停止", () => {
    expect(directives).toContain("只追一个最关键的缺失证据");
    expect(directives).toContain("一次只问一个问题");
    expect(directives).toContain("口径");
    expect(directives).toContain("个人边界");
    expect(directives).toContain("happy path");
    expect(directives).toContain("降阶为最小事实问题");
    expect(directives).toContain("不要替候选人补造项目事实");
  });
});
