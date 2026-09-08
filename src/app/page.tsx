import { OrdersDashboard } from "@/components/orders-dashboard";
import { getDashboardData } from "@/lib/orders";
import { getTenantScope } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const scope = await getTenantScope();
  if (!scope) redirect("/admin/empresas");
  const data = await getDashboardData(scope.companyId);
  return <OrdersDashboard initialData={data} />;
}
