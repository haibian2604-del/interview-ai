/**
 * 面试官流式响应的旁路持久化（brief「实现注意 1」的等价实现）：
 * - tee() 出一条旁路流累积全文，流结束后经 onFlush 落盘，不阻塞响应；
 * - 客户端分支经 TextEncoderStream 转为 Uint8Array 块
 *   （undici Response 拒绝 string 块：Received non-Uint8Array chunk）。
 * 返回可直接交给 new Response() 的流。
 */
export function teeWithPersist(
  source: ReadableStream<string>,
  onFlush: (fullText: string) => Promise<void>,
  label: string,
): ReadableStream<Uint8Array> {
  const [clientBranch, persistBranch] = source.tee();

  void (async () => {
    const reader = persistBranch.getReader();
    let full = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += value;
      }
    } catch (e) {
      // 流式中途失败：不落盘半句话，只记日志（客户端已展示流式断流错误态）
      console.error(`[${label}] interviewer stream failed:`, e);
      return;
    } finally {
      reader.releaseLock();
    }
    if (!full) {
      console.error(`[${label}] interviewer stream produced no text`);
      return;
    }
    try {
      await onFlush(full);
    } catch (e) {
      // 响应已开始流式输出，无法再改状态码：记日志，刷新页面时由卷面还原兜底
      console.error(`[${label}] persist interviewer message failed:`, e);
    }
  })();

  return clientBranch.pipeThrough(new TextEncoderStream());
}
