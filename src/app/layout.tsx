import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-context";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald" });

export const metadata: Metadata = {
  title: "Maurício Motos | Gestão da Oficina",
  description: "Atendimento, ordens de serviço, estoque e financeiro da Maurício Motos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${oswald.variable}`}><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
