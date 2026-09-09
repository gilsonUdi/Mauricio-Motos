import { redirect } from "next/navigation";
import { OrdersDashboard } from "@/components/orders-dashboard";
import { getTenantScope } from "@/lib/auth";
import { getDashboardData } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const scope = await getTenantScope();
  if (!scope) redirect("/admin/empresas");
  const data = await getDashboardData(scope.companyId);
  return <OrdersDashboard initialData={data} mode="orcamentos" />;
}
