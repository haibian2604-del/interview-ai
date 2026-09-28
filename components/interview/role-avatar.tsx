/** 面试对话的角色头像（svg-logo 规范裁剪稿）：
 * 考官 = 方框眼镜（黑印刷——阅卷人；方形呼应评分簿方角世界）
 * 候选人 = 头肩剪影（蓝作答墨——作答者；实心面不用线，小尺寸不糊）
 * 颜色走主题 token（fill-ink / fill-ink-blue），跟随油墨纪律而非写死 hex。 */

export function ExaminerAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={className}>
      <g
        fill="none"
        className="stroke-ink"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="15" y="33" width="30" height="30" rx="8" />
        <rect x="55" y="33" width="30" height="30" rx="8" />
        <path d="M45 42 h10" />
      </g>
    </svg>
  );
}

export function CandidateAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={className}>
      <g className="fill-ink-blue">
        <circle cx="50" cy="33" r="17" />
        <path d="M18 87c0-19.5 14.5-29 32-29s32 9.5 32 29z" />
      </g>
    </svg>
  );
}
