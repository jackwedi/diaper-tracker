"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AUTH_COOKIE, authEnabled, expectedToken } from "@/lib/auth";
import type { Diaper, Feeding } from "@/lib/types";

async function requireAuth() {
  if (!authEnabled()) return;
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (token !== (await expectedToken())) throw new Error("Non autorisé");
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function isoOrThrow(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Date invalide");
  return d.toISOString();
}

// ---------- Auth ----------
export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const password = String(formData.get("password") ?? "");
  if (!authEnabled() || password !== process.env.APP_PASSWORD) return "Mot de passe incorrect";
  (await cookies()).set(AUTH_COOKIE, await expectedToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/login");
}

// ---------- Lecture ----------
export async function fetchRange(fromIso: string, toIso: string) {
  await requireAuth();
  const from = isoOrThrow(fromIso);
  const to = isoOrThrow(toIso);
  const db = supabase();
  const [diapers, feedings, active] = await Promise.all([
    db.from("diapers").select("id,occurred_at,pee,poo,poo_level,note")
      .gte("occurred_at", from).lt("occurred_at", to).order("occurred_at", { ascending: false }),
    db.from("feedings").select("id,started_at,ended_at,duration_seconds,side")
      .not("ended_at", "is", null)
      .gte("started_at", from).lt("started_at", to).order("started_at", { ascending: false }),
    db.from("feedings").select("id,started_at,ended_at,duration_seconds,side")
      .is("ended_at", null).maybeSingle(),
  ]);
  return {
    diapers: check(diapers) as Diaper[],
    feedings: check(feedings) as Feeding[],
    active: check(active) as Feeding | null,
  };
}

// ---------- Couches ----------
export async function addDiaper(input: {
  occurred_at: string; pee: boolean; poo: boolean; poo_level: number | null; note: string;
}) {
  await requireAuth();
  if (!input.pee && !input.poo) throw new Error("Coche au moins Urine ou Caca");
  const level = input.poo ? Math.min(3, Math.max(1, Number(input.poo_level) || 2)) : null;
  check(await supabase().from("diapers").insert({
    occurred_at: isoOrThrow(input.occurred_at),
    pee: input.pee,
    poo: input.poo,
    poo_level: level,
    note: input.note.trim() || null,
  }));
}

export async function updateDiaperTime(id: string, occurred_at: string) {
  await requireAuth();
  check(await supabase().from("diapers").update({ occurred_at: isoOrThrow(occurred_at) }).eq("id", id));
}

export async function deleteDiaper(id: string) {
  await requireAuth();
  check(await supabase().from("diapers").delete().eq("id", id));
}

// ---------- Tétées ----------
export async function startFeeding(side: "G" | "D" | null): Promise<Feeding> {
  await requireAuth();
  const res = await supabase().from("feedings")
    .insert({ started_at: new Date().toISOString(), side })
    .select("id,started_at,ended_at,duration_seconds,side").single();
  if (res.error?.code === "23505") throw new Error("Une tétée est déjà en cours");
  return check(res) as Feeding;
}

export async function stopFeeding(id: string) {
  await requireAuth();
  const db = supabase();
  const row = check(await db.from("feedings").select("started_at").eq("id", id).single()) as { started_at: string };
  const end = new Date();
  const duration = Math.max(0, Math.round((end.getTime() - new Date(row.started_at).getTime()) / 1000));
  check(await db.from("feedings").update({ ended_at: end.toISOString(), duration_seconds: duration }).eq("id", id));
}

export async function addFeedingManual(input: { started_at: string; minutes: number; side: "G" | "D" | null }) {
  await requireAuth();
  const start = new Date(isoOrThrow(input.started_at));
  const seconds = Math.round(Math.min(240, Math.max(1, Number(input.minutes) || 0)) * 60);
  check(await supabase().from("feedings").insert({
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + seconds * 1000).toISOString(),
    duration_seconds: seconds,
    side: input.side,
  }));
}

export async function updateFeeding(id: string, started_at: string, minutes: number) {
  await requireAuth();
  const start = new Date(isoOrThrow(started_at));
  const seconds = Math.round(Math.min(240, Math.max(1, Number(minutes) || 0)) * 60);
  check(await supabase().from("feedings").update({
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + seconds * 1000).toISOString(),
    duration_seconds: seconds,
  }).eq("id", id));
}

export async function deleteFeeding(id: string) {
  await requireAuth();
  check(await supabase().from("feedings").delete().eq("id", id));
}

export async function fetchLatest() {
  await requireAuth();
  const db = supabase();
  const [d, f] = await Promise.all([
    db.from("diapers").select("occurred_at").order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("feedings").select("started_at,side").not("ended_at", "is", null)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    lastDiaper: (check(d) as { occurred_at: string } | null)?.occurred_at ?? null,
    lastFeeding: check(f) as { started_at: string; side: "G" | "D" | null } | null,
  };
}
