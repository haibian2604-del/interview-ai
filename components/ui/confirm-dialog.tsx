"use client";

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { COPY } from "@/lib/copy";

/**
 * 评分簿弹窗（替代 window.confirm/alert）：方角、hairline、纸面，
 * 破坏性确认按钮用红墨（批改/错误时刻的合法用色）。
 * ConfirmDialog = 双按钮确认；NoticeDialog = 单按钮告知。
 * 受控组件：调用方持有 open 状态，onConfirm 后自行关闭并执行动作。
 */
type DialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
};

function AlertDialogShell({
  open,
  onOpenChange,
  title,
  description,
  actions,
}: DialogShellProps & { actions: React.ReactNode }) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogContent className="rounded-none border border-ink/25 bg-paper p-6 shadow-lg">
          <AlertDialogTitle className="font-heading text-lg font-semibold tracking-wide text-ink">
            {title}
          </AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="mt-2 text-sm leading-6 text-ink/70">
              {description}
            </AlertDialogDescription>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">{actions}</div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: DialogShellProps & {
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      actions={
        <>
          <AlertDialogCancel className="rounded-none border-ink/30 bg-transparent px-4 py-2 font-mono text-sm text-ink/70 hover:border-ink/50 hover:text-ink focus-visible:border-ink-blue focus-visible:outline-none">
            {COPY.common.dialogCancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={`rounded-none border px-4 py-2 font-mono text-sm tracking-widest focus-visible:outline-none focus-visible:border-ink-blue ${
              destructive
                ? "border-ink-red/60 bg-transparent text-ink-red hover:bg-ink-red/[0.06]"
                : "border-ink bg-ink text-paper hover:bg-ink/85"
            }`}
          >
            {confirmLabel}
          </AlertDialogAction>
        </>
      }
    />
  );
}

export function NoticeDialog({
  open,
  onOpenChange,
  title,
  description,
}: DialogShellProps) {
  return (
    <AlertDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      actions={
        <AlertDialogAction className="rounded-none border border-ink bg-ink px-4 py-2 font-mono text-sm tracking-widest text-paper hover:bg-ink/85 focus-visible:outline-none focus-visible:border-ink-blue">
          {COPY.common.dialogOk}
        </AlertDialogAction>
      }
    />
  );
}
