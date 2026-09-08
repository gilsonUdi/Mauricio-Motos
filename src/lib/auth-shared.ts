export const permissionIds = ["atendimento", "compras", "receber", "conferencia", "financeiro", "estoque", "clientes", "veiculos", "produtos", "mecanicos", "usuarios"] as const;
export type Permission = typeof permissionIds[number];
export type SessionUser = { id: string; name: string; email: string; role: string; permissions: Permission[]; companyId: string | null; companyName?: string | null; exp: number };
export const sessionCookie = "mauricio_motos_session";
export function hasPermission(user: SessionUser, permission: Permission) { return user.role === "ADMIN" || user.permissions.includes(permission); }
