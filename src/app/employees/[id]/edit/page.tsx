import { notFound } from "next/navigation";
import { requireJinjiSession } from "@/lib/session";
import { getEmployee } from "@/lib/employees";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import EmployeeForm from "@/components/EmployeeForm";
import { updateEmployeeAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) notFound();

  const today = todayJST();
  const [orgUnits, counts] = await Promise.all([listOrgUnits(), memberCountsByOrg()]);
  const orgOptions = flattenTree(buildOrgTree(activeOn(orgUnits, today), counts, new Map()));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title={`${employee.name} の編集`}
        description={employee.employeeNo}
        backHref={`/employees/${employee.id}`}
        backLabel="社員カードへ戻る"
      />
      <EmployeeForm action={updateEmployeeAction} employee={employee} orgOptions={orgOptions} />
    </div>
  );
}
