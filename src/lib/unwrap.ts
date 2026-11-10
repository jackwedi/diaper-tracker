import type { Result } from "@/app/actions";

/** Transforme le résultat d'une server action en valeur (ou lève l'erreur côté client). */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
