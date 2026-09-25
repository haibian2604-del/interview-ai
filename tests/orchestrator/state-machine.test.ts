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
