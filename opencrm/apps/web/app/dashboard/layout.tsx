"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Globe, Settings, LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { Logo } from "@/components/Logo";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/contacts", label: "Contacts", icon: Users },
  { href: "/dashboard/sites", label: "Sites & Funnels", icon: Globe },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("opencrm_token")) { router.push("/login"); return; }
    setReady(true);
    api<{ email: string }>("/auth/me").then((m) => setEmail(m.email)).catch(() => {});
  }, [router]);

  if (!ready) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-ink-950 text-white">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="border-b border-ink-800 px-5 py-4">
          <Logo />
        </div>
        <nav className="thin-scroll flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-brand/15 font-medium text-white shadow-[inset_0_0_0_1px_rgba(124,108,255,0.35)]"
                    : "text-ink-300 hover:bg-ink-800 hover:text-white"
                }`}>
                <Icon size={16} className={active ? "text-brand-hover" : ""} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-ink-800 p-3">
          {email && <div className="truncate px-3 pb-2 text-xs text-ink-400" title={email}>{email}</div>}
          <button onClick={() => { localStorage.removeItem("opencrm_token"); router.push("/login"); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-400 transition hover:bg-ink-800 hover:text-white">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="oc-main flex-1 overflow-auto">{children}</main>
    </div>
  );
}
