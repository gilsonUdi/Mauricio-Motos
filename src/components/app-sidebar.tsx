import Link from "next/link";
import {
  Bike,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  PackageSearch,
  Settings,
  Users,
  UserRoundCog,
  Wrench,
} from "lucide-react";

const entries = [
  { id: "atendimento", label: "Atendimento", icon: LayoutDashboard, href: "/" },
  { id: "orcamentos", label: "Orçamentos", icon: ClipboardList },
  { id: "compras", label: "Compras", icon: PackageSearch },
  { id: "receber", label: "Contas a receber", icon: CircleDollarSign },
  { id: "estoque", label: "Estoque", icon: Boxes },
  { id: "clientes", label: "Clientes", icon: Users, href: "/clientes" },
  { id: "veiculos", label: "Veículos", icon: Bike, href: "/veiculos" },
  { id: "produtos", label: "Produtos e serviços", icon: Wrench, href: "/produtos" },
  { id: "mecanicos", label: "Mecânicos", icon: UserRoundCog, href: "/mecanicos" },
];

export function AppSidebar({ active }: { active: string }) {
  return (
    <aside className="sidebar">
      <Link className="brand-mark" href="/" aria-label="Início"><Wrench size={22} /><span>MM</span></Link>
      <nav aria-label="Navegação principal">
        {entries.map(({ id, label, icon: Icon, href }) => href ? (
          <Link className={`nav-button ${active === id ? "active" : ""}`} href={href} key={id} title={label}>
            <Icon size={20} /><span>{label}</span>
          </Link>
        ) : (
          <button className="nav-button" key={id} title={`${label} — em breve`} disabled>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="nav-button settings" title="Configurações — em breve" disabled><Settings size={20} /><span>Configurações</span></button>
    </aside>
  );
}
