/** 一覧が0件のときの表示。 */
export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#e5e5e5] bg-white px-6 py-12 text-center">
      <p className="font-medium text-[#555555]">{title}</p>
      {description && <p className="mt-1 text-sm text-[#909090]">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
