/**
 * AI SDK v7 不允许 messages 里携带 role:"system"（报错
 * "System messages are not allowed… Use the instructions option instead"），
 * 系统 prompt 必须走 instructions 选项。各 Agent 的 build*Messages 仍按
 * 「system + 对话」的直觉形状构造（且为已测契约），由本函数在喂给 SDK 前拆分。
 */
export function splitInstructions(
  messages: { role: string; content: string }[],
): { instructions: string | undefined; messages: { role: "user" | "assistant"; content: string }[] } {
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return {
    instructions: instructions === "" ? undefined : instructions,
    messages: messages
      .filter((m): m is { role: "user" | "assistant"; content: string } => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  };
}
