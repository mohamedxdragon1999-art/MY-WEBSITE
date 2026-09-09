"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Mail, Lock, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { AuthShell, AuthField, AuthError } from "@/components/AuthShell";

export default function SignupPage() {
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", agencyName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api("/auth/signup", { method: "POST", body: JSON.stringify(form) });
      localStorage.setItem("opencrm_token", res.accessToken);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Failed to create account");
      setLoading(false);
    }
  }

  const fields = [
    { label: "Email", icon: Mail, name: "email", type: "email", placeholder: "you@company.com", required: true },
    { label: "Password", icon: Lock, name: "password", type: "password", placeholder: "At least 8 characters", required: true },
    { label: "First name", icon: User, name: "firstName", placeholder: "Jane", required: true },
    { label: "Last name", icon: User, name: "lastName", placeholder: "Doe", required: true },
    { label: "Agency name", icon: Building2, name: "agencyName", placeholder: "My Agency", required: true },
  ];

  return (
    <AuthShell title="Create your account" sub="Websites, contacts and AI — one workspace"
      footer={{ text: "Already have an account?", link: "Sign in", href: "/login" }}>
      <form onSubmit={submit} className="space-y-4">
        {fields.map((f) => (
          <AuthField key={f.name} label={f.label} icon={f.icon} type={f.type} name={f.name}
            value={form[f.name as keyof typeof form]} onChange={(e: any) => setForm({ ...form, [f.name]: e.target.value })}
            placeholder={f.placeholder} required={f.required} minLength={f.name === "password" ? 8 : undefined} />
        ))}
        {error && <AuthError message={error} />}
        <button type="submit" disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-deep to-brand font-semibold text-white transition-all hover:shadow-lg hover:shadow-brand/30 disabled:opacity-60">
          {loading ? "Creating your workspace..." : "Create free account"}
        </button>
      </form>
    </AuthShell>
  );
}
