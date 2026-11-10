"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Rend ses enfants uniquement dans le navigateur : l'app dépend de l'heure
 * et du fuseau horaire local, qu'on ne peut pas connaître côté serveur.
 */
export default function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  return isClient ? children : fallback;
}
