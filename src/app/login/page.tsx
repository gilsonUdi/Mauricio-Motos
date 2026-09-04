import { LoginPage } from "@/components/login-page";
export default async function LoginRoute({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) { const params = await searchParams; return <LoginPage returnTo={params.returnTo || "/"} />; }
