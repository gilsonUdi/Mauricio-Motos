import { OrdersDashboard } from "@/components/orders-dashboard";
import { getDashboardData } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();
  return <OrdersDashboard initialData={data} />;
}
