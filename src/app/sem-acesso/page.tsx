import Link from "next/link";
export default function NoAccessPage() { return <main className="login-screen"><section className="login-card no-access"><h1>Acesso não autorizado</h1><p>Seu perfil não possui permissão para abrir esta área.</p><Link className="primary-button" href="/">Voltar ao início</Link></section></main>; }
