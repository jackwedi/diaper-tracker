"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRange } from "@/app/actions";
import { unwrap } from "@/lib/unwrap";
import { dayKey, formatDuration } from "@/lib/dates";
import type { Diaper, Feeding } from "@/lib/types";

const HISTORY_WEEKS = 8;
const DAY_MS = 86_400_000;

/** Lundi 00:00 (heure locale) de la semaine contenant `d`. */
function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const from = monday.toLocaleDateString("fr-FR", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const to = sunday.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return `${from} – ${to}`;
}

type WeekStats = {
  monday: Date;
  days: number; // jours écoulés (fractionnaires pour la semaine en cours) pris en compte pour les moyennes
  empty: boolean;
  diapers: number;
  pee: number;
  poo: number;
  pooLevels: { 1: number; 2: number; 3: number };
  feeds: number;
  feedSec: number;
  avgFeedSec: number | null;
  avgGapSec: number | null;
  perDay: { key: string; date: Date; diapers: number; pee: number; poo: number; feeds: number; feedSec: number }[];
};

function computeWeek(monday: Date, diapers: Diaper[], feedings: Feeding[], now: Date): WeekStats {
  const start = monday.getTime();
  const end = addDays(monday, 7).getTime();
  const inWeek = (iso: string) => { const t = new Date(iso).getTime(); return t >= start && t < end; };
  const ds = diapers.filter((d) => inWeek(d.occurred_at));
  const fs = feedings.filter((f) => inWeek(f.started_at)).sort((a, b) => a.started_at.localeCompare(b.started_at));

  const perDay = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { key: dayKey(date), date, diapers: 0, pee: 0, poo: 0, feeds: 0, feedSec: 0 };
  });
  const idx = new Map(perDay.map((d, i) => [d.key, i]));
  const pooLevels = { 1: 0, 2: 0, 3: 0 };
  for (const d of ds) {
    const p = perDay[idx.get(dayKey(d.occurred_at))!];
    p.diapers++;
    if (d.pee) p.pee++;
    if (d.poo) { p.poo++; if (d.poo_level) pooLevels[d.poo_level]++; }
  }
  for (const f of fs) {
    const p = perDay[idx.get(dayKey(f.started_at))!];
    p.feeds++;
    p.feedSec += f.duration_seconds ?? 0;
  }

  // Intervalle moyen entre deux débuts de tétée (on ignore les trous > 12 h, ex. oubli de saisie)
  const gaps: number[] = [];
  for (let i = 1; i < fs.length; i++) {
    const g = (new Date(fs[i].started_at).getTime() - new Date(fs[i - 1].started_at).getTime()) / 1000;
    if (g > 0 && g <= 12 * 3600) gaps.push(g);
  }

  const feedSec = fs.reduce((s, f) => s + (f.duration_seconds ?? 0), 0);
  // Semaine en cours : la journée entamée compte au prorata (au moins 1 jour pour éviter des moyennes absurdes)
  const elapsed = (Math.min(now.getTime(), end) - start) / DAY_MS;
  return {
    monday,
    days: elapsed <= 0 ? 0 : Math.min(7, Math.max(1, elapsed)),
    empty: ds.length === 0 && fs.length === 0,
    diapers: ds.length,
    pee: ds.filter((d) => d.pee).length,
    poo: ds.filter((d) => d.poo).length,
    pooLevels,
    feeds: fs.length,
    feedSec,
    avgFeedSec: fs.length ? Math.round(feedSec / fs.length) : null,
    avgGapSec: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    perDay,
  };
}

const perDay = (v: number, days: number) => (days ? v / days : 0);
const fmt1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

export default function WeeklyData({ onError }: { onError: (msg: string) => void }) {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [data, setData] = useState<{ diapers: Diaper[]; feedings: Feeding[] } | null>(null);

  const load = useCallback(async () => {
    const from = addDays(week, -7 * (HISTORY_WEEKS - 1));
    const to = addDays(week, 7);
    try {
      const r = await unwrap(fetchRange(from.toISOString(), to.toISOString()));
      setData({ diapers: r.diapers, feedings: r.feedings });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, [week, onError]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: HISTORY_WEEKS }, (_, i) =>
      computeWeek(addDays(week, -7 * i), data.diapers, data.feedings, now));
  }, [data, week, now]);

  const current = weeks[0];
  const previous = weeks[1];
  const isThisWeek = dayKey(week) === dayKey(mondayOf(new Date()));
  const maxDayFeedSec = current ? Math.max(1, ...current.perDay.map((d) => d.feedSec)) : 1;
  const maxDayDiapers = current ? Math.max(1, ...current.perDay.map((d) => d.diapers)) : 1;

  return (
    <>
      <section className="card">
        <div className="week-head">
          <button className="icon" aria-label="Semaine précédente" onClick={() => setWeek(addDays(week, -7))}>‹</button>
          <div className="week-title">
            <h2>Semaine du {weekLabel(week)}</h2>
            {isThisWeek && <span className="muted">Semaine en cours · moyennes sur {fmt1(current?.days ?? 0)} j</span>}
          </div>
          <button className="icon" aria-label="Semaine suivante" disabled={isThisWeek}
            onClick={() => setWeek(addDays(week, 7))}>›</button>
        </div>

        {!current ? (
          <p className="muted">Chargement…</p>
        ) : (
          <>
            <div className="stats">
              <WeekStat label="Couches / jour" value={fmt1(perDay(current.diapers, current.days))}
                sub={`${current.diapers} au total`}
                delta={previous && deltaPct(perDay(current.diapers, current.days), perDay(previous.diapers, previous.days))} />
              <WeekStat label="💧 Urine / jour" tone="pee" value={fmt1(perDay(current.pee, current.days))}
                sub={`${current.pee} au total`}
                delta={previous && deltaPct(perDay(current.pee, current.days), perDay(previous.pee, previous.days))} />
              <WeekStat label="💩 Caca / jour" tone="poo" value={fmt1(perDay(current.poo, current.days))}
                sub={`${current.pooLevels[1]} faible · ${current.pooLevels[2]} moyen · ${current.pooLevels[3]} abondant`}
                delta={previous && deltaPct(perDay(current.poo, current.days), perDay(previous.poo, previous.days))} />
              <WeekStat label="🍼 Tétées / jour" tone="feed" value={fmt1(perDay(current.feeds, current.days))}
                sub={`${current.feeds} au total`}
                delta={previous && deltaPct(perDay(current.feeds, current.days), perDay(previous.feeds, previous.days))} />
              <WeekStat label="⏱ Durée moy. tétée" tone="feed"
                value={current.avgFeedSec != null ? formatDuration(current.avgFeedSec) : "—"}
                sub={current.feedSec ? `${formatDuration(Math.round(perDay(current.feedSec, current.days)))} / jour` : undefined}
                delta={previous && current.avgFeedSec != null && previous.avgFeedSec != null
                  ? deltaPct(current.avgFeedSec, previous.avgFeedSec) : undefined} />
              <WeekStat label="↔ Intervalle moyen" tone="feed"
                value={current.avgGapSec != null ? formatDuration(current.avgGapSec) : "—"}
                sub="entre deux tétées" />
            </div>

            <h3>Jour par jour</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Jour</th><th>Couches</th><th>💧</th><th>💩</th><th>Tétées</th><th>Durée tétées</th></tr>
                </thead>
                <tbody>
                  {current.perDay.map((d) => {
                    const future = d.date.getTime() > now.getTime();
                    return (
                      <tr key={d.key} className={future ? "future" : ""}>
                        <td className="day-name">{d.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}</td>
                        <td><Bar value={d.diapers} max={maxDayDiapers} tone="neutral" label={String(d.diapers)} /></td>
                        <td>{d.pee}</td>
                        <td>{d.poo}</td>
                        <td>{d.feeds}</td>
                        <td><Bar value={d.feedSec} max={maxDayFeedSec} tone="feed"
                          label={d.feedSec ? formatDuration(d.feedSec) : "—"} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Évolution sur {HISTORY_WEEKS} semaines</h2>
        {!weeks.length ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Semaine</th><th>Couches/j</th><th>💩/j</th><th>Tétées/j</th>
                  <th>Durée moy.</th><th>Tétée/j</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={dayKey(w.monday)} className={`clickable ${w === current ? "selected" : ""}`}
                    onClick={() => setWeek(w.monday)}>
                    <td className="day-name">{weekLabel(w.monday)}</td>
                    <td>{!w.empty && w.days ? fmt1(perDay(w.diapers, w.days)) : "—"}</td>
                    <td>{!w.empty && w.days ? fmt1(perDay(w.poo, w.days)) : "—"}</td>
                    <td>{!w.empty && w.days ? fmt1(perDay(w.feeds, w.days)) : "—"}</td>
                    <td>{w.avgFeedSec != null ? formatDuration(w.avgFeedSec) : "—"}</td>
                    <td>{w.days && w.feedSec ? formatDuration(Math.round(perDay(w.feedSec, w.days))) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted hint">Clique sur une semaine pour voir son détail. Les moyennes de la semaine en cours portent sur les jours déjà écoulés.</p>
      </section>
    </>
  );
}

function deltaPct(cur: number, prev: number): number | undefined {
  if (!prev) return undefined;
  return Math.round(((cur - prev) / prev) * 100);
}

function WeekStat({ label, value, sub, tone, delta }: {
  label: string; value: string; sub?: string; tone?: string; delta?: number;
}) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {delta !== undefined && delta !== 0 && (
          <span className={`delta ${delta > 0 ? "up" : "down"}`} title="vs semaine précédente">
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} %
          </span>
        )}
      </span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function Bar({ value, max, tone, label }: { value: number; max: number; tone: string; label: string }) {
  return (
    <span className="bar-cell">
      <span className={`bar ${tone}`} style={{ width: `${(value / max) * 100}%` }} />
      <span className="bar-label">{label}</span>
    </span>
  );
}
