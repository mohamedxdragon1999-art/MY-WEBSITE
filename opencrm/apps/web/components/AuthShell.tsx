"use client";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export function AuthShell({
  title, sub, children, footer,
}: {
  title: string; sub: string; children: React.ReactNode;
  footer: { text: string; link: string; href: string };
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06060b] text-white antialiased">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-brand/15 blur-[120px]" />
        <div className="absolute -bottom-32 -right-24 h-[380px] w-[380px] rounded-full bg-brand-deep/20 blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]" />
      </div>
      <div className="relative z-10 mx-auto flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-in">
          <div className="mb-8 flex flex-col items-center text-center">
            <Logo />
            <h1 className="mt-5 font-display text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-ink-400">{sub}</p>
          </div>
          <div className="rounded-2xl border border-ink-700 bg-ink-900/80 p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-8">
            {children}
            <div className="mt-6 border-t border-ink-800 pt-4 text-center text-sm text-ink-400">
              {footer.text}{" "}
              <Link href={footer.href} className="font-medium text-brand-hover hover:text-white">
                {footer.link}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export function AuthField({ label, icon: Icon, ...props }: any) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-ink-300">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
        <input
          {...props}
          className="w-full rounded-xl border border-ink-700 bg-ink-800 py-3 pl-11 pr-3 text-sm text-white placeholder-ink-500 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
      </div>
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{message}</div>
  );
}
