export const permissionIds = ["atendimento", "compras", "receber", "pagar", "conferencia", "financeiro", "drg", "estoque", "clientes", "veiculos", "produtos", "mecanicos", "fornecedores", "categorias_financeiras", "configuracoes_financeiras", "usuarios"] as const;
export type Permission = typeof permissionIds[number];
export type SessionIdentity = { id:string;name:string;email:string };
export type SessionUser = { id: string; name: string; email: string; role: string; permissions: Permission[]; companyId: string | null; companyName?: string | null; impersonatedBy?:SessionIdentity|null; exp: number };
export const sessionCookie = "mauricio_motos_session";
export function hasPermission(user: SessionUser, permission: Permission) { return user.role === "ADMIN" || user.permissions.includes(permission); }
