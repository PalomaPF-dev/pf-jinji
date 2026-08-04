import { requireJinjiSession } from "@/lib/session";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import EmployeeForm from "@/components/EmployeeForm";
import { createEmployeeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  await requireJinjiSession();
  const today = todayJST();
  const [orgUnits, counts] = await Promise.all([listOrgUnits(), memberCountsByOrg()]);
  const orgOptions = flattenTree(buildOrgTree(activeOn(orgUnits, today), counts, new Map()));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="社員の新規登録" backHref="/employees" backLabel="社員台帳へ戻る" />
      <EmployeeForm action={createEmployeeAction} orgOptions={orgOptions} />
    </div>
  );
}
