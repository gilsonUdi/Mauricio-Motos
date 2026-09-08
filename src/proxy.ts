import { NextRequest, NextResponse } from "next/server";
import { hasPermission, type Permission, sessionCookie } from "@/lib/auth-shared";
import { verifySessionToken } from "@/lib/auth-token";

const rules: Array<[RegExp, Permission]> = [
  [/^\/$/, "atendimento"], [/^\/api\/orders/, "atendimento"],
  [/^\/compras/, "compras"], [/^\/api\/purchases/, "compras"],
  [/^\/receber/, "receber"], [/^\/conferencia/, "conferencia"],
  [/^\/pagar/, "pagar"], [/^\/api\/payables/, "pagar"],
  [/^\/financeiro/, "financeiro"], [/^\/api\/finance(?:\/|$)/, "financeiro"],
  [/^\/estoque/, "estoque"], [/^\/api\/inventory/, "estoque"],
  [/^\/clientes/, "clientes"], [/^\/veiculos/, "veiculos"], [/^\/produtos/, "produtos"], [/^\/mecanicos/, "mecanicos"],
  [/^\/fornecedores/, "fornecedores"], [/^\/api\/registries\/suppliers/, "fornecedores"],
  [/^\/categorias-financeiras/, "categorias_financeiras"], [/^\/api\/financial-categories/, "categorias_financeiras"],
  [/^\/configuracoes-financeiras/, "configuracoes_financeiras"], [/^\/api\/financial-settings/, "configuracoes_financeiras"],
  [/^\/api\/registries\/customers/, "clientes"], [/^\/api\/registries\/vehicles/, "veiculos"], [/^\/api\/registries\/products/, "produtos"], [/^\/api\/registries\/mechanics/, "mecanicos"],
  [/^\/usuarios/, "usuarios"], [/^\/api\/users/, "usuarios"],
];

export function proxy(request: NextRequest) {
  if (!process.env.AUTH_SECRET || !process.env.DATABASE_URL) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path.startsWith("/login") || path.startsWith("/api/auth")) return NextResponse.next();
  const user = verifySessionToken(request.cookies.get(sessionCookie)?.value);
  if (!user) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const login = new URL("/login", request.url); login.searchParams.set("returnTo", path); return NextResponse.redirect(login);
  }
  if (user.role === "SUPER_ADMIN" && !path.startsWith("/admin") && !path.startsWith("/api/admin")) return NextResponse.redirect(new URL("/admin/empresas", request.url));
  if ((path.startsWith("/admin") || path.startsWith("/api/admin")) && user.role !== "SUPER_ADMIN") {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Acesso restrito ao administrador da plataforma." }, { status: 403 });
    return NextResponse.redirect(new URL("/sem-acesso", request.url));
  }
  if (path.startsWith("/api/receivables") && !hasPermission(user, "receber") && !hasPermission(user, "conferencia")) return NextResponse.json({ error: "Você não tem acesso a esta área." }, { status: 403 });
  const permission = rules.find(([pattern]) => pattern.test(path))?.[1];
  if (permission && !hasPermission(user, permission)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Você não tem acesso a esta área." }, { status: 403 });
    return NextResponse.redirect(new URL("/sem-acesso", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
