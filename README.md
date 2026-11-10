# 👶 Suivi bébé — couches & tétées

Back-office Next.js pour enregistrer les couches et les tétées d'un bébé, avec un récap et un calendrier.
Données stockées dans **Supabase**, hébergement sur **Vercel**.

## Fonctionnalités

- **Couches** : Urine et/ou Caca, intensité du caca (Faible / Moyen / Abondant), note optionnelle.
  L'heure est l'heure actuelle par défaut, modifiable manuellement.
- **Tétées** : bouton *Start* qui lance le chrono (sein gauche / droit), *Stop* qui enregistre la durée.
  La tétée en cours est stockée en base : le chrono continue si on ferme l'onglet ou si on change de téléphone.
  Ajout manuel possible (début + durée).
- **Récap** : stats du jour sélectionné, temps depuis la dernière couche / tétée,
  calendrier mensuel avec les compteurs par jour, journal du jour (modifier l'horaire / supprimer).
- Synchro automatique toutes les 30 s (pratique à deux parents).
- Accès protégé par un mot de passe partagé.

## Mise en place

### 1. Supabase

1. Créer un projet sur [supabase.com](https://supabase.com).
2. *SQL Editor* → coller et exécuter [`supabase/schema.sql`](supabase/schema.sql).
3. *Project Settings → API* : récupérer l'**URL** du projet et la clé **service_role**.

> La RLS est activée sans policy : la clé publique `anon` n'a aucun accès.
> Seul le serveur Next.js (clé `service_role`, jamais envoyée au navigateur) lit/écrit les données.

### 2. En local

```bash
cp .env.example .env.local   # puis remplir les valeurs
npm install
npm run dev
```

Ouvrir http://localhost:3000.

### 3. Vercel

1. *Add New → Project* → importer le repo GitHub.
2. Dans *Environment Variables*, ajouter `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD`, `AUTH_SECRET`.
3. *Deploy*. (Après un changement de variable, relancer un déploiement.)

## Structure

- `src/app/actions.ts` — server actions (lecture / écriture Supabase)
- `src/components/Tracker.tsx` — interface (récap, calendrier, couches, tétées)
- `src/proxy.ts` — redirection vers `/login` sans cookie valide
- `supabase/schema.sql` — tables `diapers` et `feedings`
