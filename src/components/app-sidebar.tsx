"use client";
import Link from "next/link";
import {
  Bike,
  BadgeCheck,
  Boxes,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  Settings,
  Users,
  UserRoundCog,
  Wrench,
  Building2,
  Tags,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "@/components/auth-context";
import type { Permission } from "@/lib/auth-shared";

const entries: Array<{ id: Permission | "orcamentos"; label: string; icon: typeof Bike; href?: string }> = [
  { id: "atendimento", label: "Atendimento", icon: LayoutDashboard, href: "/" },
  { id: "orcamentos", label: "Orçamentos", icon: ClipboardList },
  { id: "compras", label: "Compras", icon: PackageSearch, href: "/compras" },
  { id: "receber", label: "Contas a receber", icon: CircleDollarSign, href: "/receber" },
  { id: "conferencia", label: "Conferência", icon: BadgeCheck, href: "/conferencia" },
  { id: "financeiro", label: "Financeiro", icon: ChartNoAxesCombined, href: "/financeiro" },
  { id: "estoque", label: "Estoque", icon: Boxes, href: "/estoque" },
  { id: "clientes", label: "Clientes", icon: Users, href: "/clientes" },
  { id: "veiculos", label: "Veículos", icon: Bike, href: "/veiculos" },
  { id: "produtos", label: "Produtos e serviços", icon: Wrench, href: "/produtos" },
  { id: "mecanicos", label: "Mecânicos", icon: UserRoundCog, href: "/mecanicos" },
  { id: "fornecedores", label: "Fornecedores", icon: Building2, href: "/fornecedores" },
  { id: "categorias_financeiras", label: "Categorias financeiras", icon: Tags, href: "/categorias-financeiras" },
  { id: "configuracoes_financeiras", label: "Contas e taxas", icon: SlidersHorizontal, href: "/configuracoes-financeiras" },
];

export function AppSidebar({ active }: { active: string }) {
  const { enabled, user } = useAuth();
  const visibleEntries = entries.filter((entry) => entry.id === "orcamentos" || !enabled || user?.role === "ADMIN" || user?.permissions.includes(entry.id));
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }
  return (
    <aside className="sidebar">
      <Link className="brand-mark" href="/" aria-label="Início"><Wrench size={22} /><span>MM</span></Link>
      {enabled && user?.companyName && <span className="tenant-name" title={user.companyName}>{user.companyName}</span>}
      <nav aria-label="Navegação principal">
        {visibleEntries.map(({ id, label, icon: Icon, href }) => href ? (
          <Link className={`nav-button ${active === id ? "active" : ""}`} href={href} key={id} title={label}>
            <Icon size={20} /><span>{label}</span>
          </Link>
        ) : (
          <button className="nav-button" key={id} title={`${label} — em breve`} disabled>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">{(!enabled || user?.role === "ADMIN") && <Link className={`nav-button ${active === "usuarios" ? "active" : ""}`} href="/usuarios" title="Usuários"><Settings size={20} /><span>Usuários</span></Link>}{enabled && user && <button className="nav-button" title={`Sair de ${user.name}`} onClick={logout}><LogOut size={20} /><span>Sair</span></button>}</div>
    </aside>
  );
}
