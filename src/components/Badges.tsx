import {
  EMPLOYMENT_STATUS_LABEL,
  TRANSFER_STATUS_LABEL,
  EVALUATION_STATUS_LABEL,
  type EmploymentStatus,
  type EvaluationStatus,
  type TransferStatus,
} from "@/lib/types";

function Pill({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {text}
    </span>
  );
}

const EMPLOYMENT_STATUS_STYLE: Record<EmploymentStatus, string> = {
  active: "bg-[#e8f3ec] text-[#1c7a4d]",
  leave: "bg-[#fdf3e0] text-[#a06a12]",
  loaned: "bg-[#eef1fb] text-[#3b4fa8]",
  retired: "bg-[#f0f0f0] text-[#707070]",
};

export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  return <Pill text={EMPLOYMENT_STATUS_LABEL[status]} className={EMPLOYMENT_STATUS_STYLE[status]} />;
}

const TRANSFER_STATUS_STYLE: Record<TransferStatus, string> = {
  draft: "bg-[#f0f0f0] text-[#707070]",
  submitted: "bg-[#fdf3e0] text-[#a06a12]",
  approved: "bg-[#eef1fb] text-[#3b4fa8]",
  issued: "bg-[#e8f3ec] text-[#1c7a4d]",
  rejected: "bg-[#fdecec] text-[#b91c1c]",
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <Pill text={TRANSFER_STATUS_LABEL[status]} className={TRANSFER_STATUS_STYLE[status]} />;
}

const EVALUATION_STATUS_STYLE: Record<EvaluationStatus, string> = {
  draft: "bg-[#f0f0f0] text-[#707070]",
  primary_done: "bg-[#fdf3e0] text-[#a06a12]",
  secondary_done: "bg-[#eef1fb] text-[#3b4fa8]",
  finalized: "bg-[#e8f3ec] text-[#1c7a4d]",
};

export function EvaluationStatusBadge({ status }: { status: EvaluationStatus }) {
  return <Pill text={EVALUATION_STATUS_LABEL[status]} className={EVALUATION_STATUS_STYLE[status]} />;
}

/**
 * 資格の有効期限バッジ。残り日数で色を変える（期限切れ=赤、90日以内=橙）。
 */
export function ExpiryBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft == null) return <span className="text-xs text-[#909090]">—</span>;
  if (daysLeft < 0) return <Pill text={`期限切れ ${-daysLeft}日`} className="bg-[#fdecec] text-[#b91c1c]" />;
  if (daysLeft <= 90) return <Pill text={`あと${daysLeft}日`} className="bg-[#fdf3e0] text-[#a06a12]" />;
  return <Pill text={`あと${daysLeft}日`} className="bg-[#f0f0f0] text-[#707070]" />;
}
