"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { AuthShell, AuthField, AuthError } from "@/components/AuthShell";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      localStorage.setItem("opencrm_token", res.accessToken);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.status === 429 ? err.message + " Please wait before retrying." : (err.message ?? "Invalid credentials"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Welcome back" sub="Sign in to your CRM workspace"
      footer={{ text: "Don't have an account?", link: "Create one", href: "/signup" }}>
      <form onSubmit={submit} className="space-y-4">
        <AuthField label="Email" icon={Mail} type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} placeholder="you@company.com" required />
        <AuthField label="Password" icon={Lock} type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Your password" required />
        {error && <AuthError message={error} />}
        <button type="submit" disabled={loading}
          className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-deep to-brand font-semibold text-white transition-all hover:shadow-lg hover:shadow-brand/30 disabled:opacity-60">
          {loading ? "Signing in..." : "Sign in"}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </form>
    </AuthShell>
  );
}
