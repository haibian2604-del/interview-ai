import { describe, expect, it } from "vitest";
import {
  QUESTION_COUNT_DEFAULT,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  clampQuestionCount,
} from "@/lib/interview/count";

describe("clampQuestionCount（I-1：服务端题量钳制）", () => {
  it("区间内原样返回", () => {
    expect(clampQuestionCount(3)).toBe(3);
    expect(clampQuestionCount(6)).toBe(6);
    expect(clampQuestionCount(10)).toBe(10);
  });
  it("低于下界钳到 3，高于上界钳到 10", () => {
    expect(clampQuestionCount(1)).toBe(QUESTION_COUNT_MIN);
    expect(clampQuestionCount(99)).toBe(QUESTION_COUNT_MAX);
  });
  it("缺省与非法值回默认 6", () => {
    expect(clampQuestionCount(undefined)).toBe(QUESTION_COUNT_DEFAULT);
    expect(clampQuestionCount(null)).toBe(QUESTION_COUNT_DEFAULT);
    expect(clampQuestionCount(Number.NaN)).toBe(QUESTION_COUNT_DEFAULT);
  });
  it("小数取整到区间内", () => {
    expect(clampQuestionCount(5.7)).toBe(6);
    expect(clampQuestionCount(2.2)).toBe(3);
  });
});
