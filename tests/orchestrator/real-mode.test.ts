import { describe, expect, it } from "vitest";
import {
  REAL_MODE,
  checkTermination,
  decideRealNextAction,
  parseDifficulty,
  parseMode,
  parseTargetQuestions,
  questionStage,
} from "@/lib/orchestrator/real-mode";

describe("orchestrator/parseMode", () => {
  it("仅 'real' 判为 real，其余（缺省/undefined/乱值）一律 practice", () => {
    expect(parseMode("real")).toBe("real");
    expect(parseMode("practice")).toBe("practice");
    expect(parseMode(undefined)).toBe("practice");
    expect(parseMode(42)).toBe("practice");
  });
});

describe("orchestrator/parseTargetQuestions / parseDifficulty", () => {
  it("题数仅认 10/15/20，其余回落 10", () => {
    expect(parseTargetQuestions(10)).toBe(10);
    expect(parseTargetQuestions(15)).toBe(15);
    expect(parseTargetQuestions(20)).toBe(20);
    expect(parseTargetQuestions(undefined)).toBe(10);
    expect(parseTargetQuestions(12)).toBe(10);
    expect(parseTargetQuestions("15")).toBe(10);
  });

  it("难度仅认 easy/hard，medium 为缺省", () => {
    expect(parseDifficulty("easy")).toBe("easy");
    expect(parseDifficulty("hard")).toBe("hard");
    expect(parseDifficulty("medium")).toBe("medium");
    expect(parseDifficulty(undefined)).toBe("medium");
    expect(parseDifficulty("简单")).toBe("medium");
  });
});

describe("orchestrator/questionStage（难度阶梯）", () => {
  it("前 30%（0-2 题）→ opening 基础热身", () => {
    expect(questionStage(0)).toBe("opening");
    expect(questionStage(1)).toBe("opening");
    expect(questionStage(2)).toBe("opening");
  });

  it("中段（3-6 题）→ core 核心考察", () => {
    expect(questionStage(3)).toBe("core");
    expect(questionStage(6)).toBe("core");
  });

  it("收尾（7 题起）→ deep 项目深挖/最高难度", () => {
    expect(questionStage(7)).toBe("deep");
    expect(questionStage(9)).toBe("deep");
    expect(questionStage(9, 10)).toBe("deep");
    expect(questionStage(12, 15)).toBe("deep");
    expect(questionStage(16, 20)).toBe("deep");
  });
});

describe("orchestrator/checkTermination", () => {
  it("答满目标题数 → target 终止", () => {
    const scores = Array.from({ length: REAL_MODE.target }, () => 0.9);
    expect(checkTermination(scores)).toEqual({ terminate: true, reason: "target" });
  });

  it("达到防御性上限（target + maxOverrun）→ target 终止", () => {
    const scores = Array.from({ length: 10 + REAL_MODE.maxOverrun }, () => 0.9);
    expect(checkTermination(scores).reason).toBe("target");
  });

  it("不足下限（< 5 题）即使全低分也不终止", () => {
    expect(checkTermination([0.1, 0.1, 0.1, 0.1])).toEqual({ terminate: false, reason: null });
  });

  it("连续 3 题低于 0.4 且已答 ≥ 5 → early 终止", () => {
    // 前 2 题高分铺垫到 5 题下限，后 3 题连崩
    const scores = [0.9, 0.9, 0.3, 0.2, 0.1];
    expect(checkTermination(scores)).toEqual({ terminate: true, reason: "early" });
  });

  it("连续仅 2 题低分 → 不终止", () => {
    const scores = [0.9, 0.9, 0.9, 0.3, 0.2];
    expect(checkTermination(scores)).toEqual({ terminate: false, reason: null });
  });

  it("累计均值 < 0.45 且已答 ≥ 5 → early 终止（即使无连崩）", () => {
    const scores = [0.45, 0.44, 0.45, 0.44, 0.45]; // 均值 0.446
    expect(checkTermination(scores)).toEqual({ terminate: true, reason: "early" });
  });

  it("均值恰为 0.45 → 不终止（严格小于）", () => {
    const scores = [0.45, 0.45, 0.45, 0.45, 0.45];
    expect(checkTermination(scores)).toEqual({ terminate: false, reason: null });
  });

  it("边界：恰好 5 题且连崩 → early；恰好 5 题健康 → 继续", () => {
    expect(checkTermination([0.9, 0.9, 0.1, 0.1, 0.1]).reason).toBe("early");
    expect(checkTermination([0.9, 0.9, 0.9, 0.9, 0.9])).toEqual({ terminate: false, reason: null });
  });

  it("空数组 → 不终止", () => {
    expect(checkTermination([])).toEqual({ terminate: false, reason: null });
  });
});

describe("orchestrator/decideRealNextAction", () => {
  it("本题该追问时追问优先于终止（与 practice「追问优先于结束」同语义）", () => {
    // 连崩 3 题应 early 终止，但当前题 < 0.65 且未追问 → 先追问
    const r = decideRealNextAction({ score: 0.3, followupCount: 0, composites: [0.9, 0.9, 0.3, 0.2, 0.1] });
    expect(r.action).toEqual({ action: "followup" });
    expect(r.endEarly).toBe(false);
  });

  it("已追问过且命中提前终止 → finish + endEarly", () => {
    const r = decideRealNextAction({ score: 0.3, followupCount: 1, composites: [0.9, 0.9, 0.3, 0.2, 0.1] });
    expect(r.action).toEqual({ action: "finish" });
    expect(r.endEarly).toBe(true);
  });

  it("答满目标 → finish + endEarly=false", () => {
    const r = decideRealNextAction({
      score: 0.9,
      followupCount: 0,
      composites: Array.from({ length: REAL_MODE.target }, () => 0.9),
    });
    expect(r.action).toEqual({ action: "finish" });
    expect(r.endEarly).toBe(false);
  });

  it("健康进行中 → next_question（real 模式永不因索引见底而 finish）", () => {
    const r = decideRealNextAction({ score: 0.9, followupCount: 0, composites: [0.9, 0.9] });
    expect(r.action).toEqual({ action: "next_question" });
  });
});
