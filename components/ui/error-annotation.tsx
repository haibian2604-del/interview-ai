// 印刷语义错误批注：红墨 #a63a2f 仅用于错误/批改时刻
export function ErrorAnnotation({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="-rotate-1 border-l-2 border-ink-red bg-ink-red/[0.04] px-3 py-2 text-sm leading-6 text-ink-red"
    >
      {text}
    </p>
  );
}
