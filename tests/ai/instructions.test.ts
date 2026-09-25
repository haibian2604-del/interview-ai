import { describe, expect, it } from "vitest";
import { splitInstructions } from "@/lib/ai/instructions";

describe("splitInstructions（AI SDK v7：system 消息必须走 instructions 选项）", () => {
  it("抽出 system 内容，其余按原序保留", () => {
    const r = splitInstructions([
      { role: "system", content: "人格A" },
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
      { role: "user", content: "追问" },
    ]);
    expect(r.instructions).toBe("人格A");
    expect(r.messages).toEqual([
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
      { role: "user", content: "追问" },
    ]);
  });

  it("多条 system 合并；无 system 时 instructions 为 undefined", () => {
    expect(splitInstructions([{ role: "system", content: "A" }, { role: "system", content: "B" }]).instructions).toBe(
      "A\n\nB",
    );
    const r = splitInstructions([{ role: "user", content: "hi" }]);
    expect(r.instructions).toBeUndefined();
    expect(r.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
