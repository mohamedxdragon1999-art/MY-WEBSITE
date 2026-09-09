"use client";
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("opencrm_token");
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/** Multipart uploads (no JSON content-type — the browser sets the boundary). */
export async function apiForm<T = any>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

async function toApiError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({} as any));
  const raw = body?.message;
  const msg = (Array.isArray(raw) ? raw.join("; ") : (raw ?? res.statusText));
  const err = new Error(String(msg).slice(0, 500)) as any;
  err.status = body?.statusCode ?? res.status;
  return err;
}
