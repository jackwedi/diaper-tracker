"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addDiaper, addFeedingManual, deleteDiaper, deleteFeeding, fetchBaby, fetchLatest, fetchRange, updateBaby,
  logout, startFeeding, stopFeeding, updateDiaper, updateFeeding,
} from "@/app/actions";
import { unwrap } from "@/lib/unwrap";
import WeeklyData from "@/components/WeeklyData";
import type { Baby, Diaper, Feeding } from "@/lib/types";
import {
  addMonths, dayKey, formatAge, formatClock, formatDuration, formatTime, gridDays, gridStart,
  localInputToIso, parseDayKey, startOfMonth, timeAgo, toLocalInput,
} from "@/lib/dates";

type Side = "G" | "D" | null;
const LEVELS = { 1: "Faible", 2: "Moyen", 3: "Abondant" } as const;
const SIDES = { G: "Gauche", D: "Droit" } as const;
const POLL_MS = 30_000;

const isFailure = (r: unknown): r is { ok: false; error: string } =>
  typeof r === "object" && r !== null && "ok" in r && r.ok === false;

type Entry =
  | { kind: "diaper"; at: string; item: Diaper }
  | { kind: "feeding"; at: string; item: Feeding };

type Editing =
  | { kind: "diaper"; item: Diaper }
  | { kind: "feeding"; item: Feeding }
  | null;

export default function Tracker({ canLogout }: { canLogout: boolean }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [diapers, setDiapers] = useState<Diaper[]>([]);
  const [feedings, setFeedings] = useState<Feeding[]>([]);
  const [active, setActive] = useState<Feeding | null>(null);
  const [latest, setLatest] = useState<{ lastDiaper: Diaper | null; lastFeeding: Feeding | null; lastPoo: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"track" | "data">("track");
  const [baby, setBaby] = useState<Baby | null>(null);
  const [editingBaby, setEditingBaby] = useState(false);
  const [journalTab, setJournalTab] = useState<"diaper" | "feeding">("feeding");

  // ----- Chargement -----
  const load = useCallback(async () => {
    const start = gridStart(month);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
    try {
      const [range, last, b] = await Promise.all([
        unwrap(fetchRange(start.toISOString(), end.toISOString())),
        unwrap(fetchLatest()),
        unwrap(fetchBaby()),
      ]);
      setBaby(b);
      setDiapers(range.diapers);
      setFeedings(range.feedings);
      setActive(range.active);
      setLatest(last);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoaded(true);
    }
  }, [month]);

  // Chargement initial + rafraîchissement périodique (synchro entre téléphones)
  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(first); clearInterval(poll); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // Horloge : chaque seconde pendant une tétée, sinon chaque minute
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), active ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [active]);

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      try {
        const r = await fn();
        if (isFailure(r)) throw new Error(r.error);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });

  // ----- Agrégats par jour -----
  const byDay = useMemo(() => {
    const map = new Map<string, { pee: number; poo: number; feeds: number; feedSec: number; entries: Entry[] }>();
    const get = (k: string) => {
      let v = map.get(k);
      if (!v) { v = { pee: 0, poo: 0, feeds: 0, feedSec: 0, entries: [] }; map.set(k, v); }
      return v;
    };
    for (const d of diapers) {
      const v = get(dayKey(d.occurred_at));
      if (d.pee) v.pee++;
      if (d.poo) v.poo++;
      v.entries.push({ kind: "diaper", at: d.occurred_at, item: d });
    }
    for (const f of feedings) {
      const v = get(dayKey(f.started_at));
      v.feeds++;
      v.feedSec += f.duration_seconds ?? 0;
      v.entries.push({ kind: "feeding", at: f.started_at, item: f });
    }
    for (const v of map.values()) v.entries.sort((a, b) => b.at.localeCompare(a.at));
    return map;
  }, [diapers, feedings]);

  const day = byDay.get(selected);
  const dayDiapers = day?.entries.filter((e) => e.kind === "diaper").length ?? 0;
  const pooLevels = useMemo(() => {
    const c = { 1: 0, 2: 0, 3: 0 };
    for (const d of diapers) if (d.poo && d.poo_level && dayKey(d.occurred_at) === selected) c[d.poo_level]++;
    return c;
  }, [diapers, selected]);

  const journalEntries = day?.entries.filter((e) => e.kind === journalTab) ?? [];

  // Écart avec l'entrée précédente du même type (tétée : de début à début ; y compris la veille)
  const gaps = useMemo(() => {
    const map = new Map<string, number>();
    const fill = (items: { id: string; at: string }[]) => {
      const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
      for (let i = 1; i < sorted.length; i++) {
        const sec = Math.round((new Date(sorted[i].at).getTime() - new Date(sorted[i - 1].at).getTime()) / 1000);
        if (sec > 0) map.set(sorted[i].id, sec);
      }
    };
    fill(feedings.map((f) => ({ id: f.id, at: f.started_at })));
    fill(diapers.map((d) => ({ id: d.id, at: d.occurred_at })));
    return map;
  }, [feedings, diapers]);

  const today = dayKey(new Date(now));
  const selectedDate = parseDayKey(selected);
  const selectedLabel = selected === today
    ? "aujourd'hui"
    : selectedDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  const changeMonth = (delta: number) => {
    const next = addMonths(month, delta);
    setMonth(next);
    const isCurrent = dayKey(startOfMonth(new Date())) === dayKey(next);
    setSelected(isCurrent ? dayKey(new Date()) : dayKey(next));
  };

  return (
    <>
      <header className="topbar">
        <h1>👶 Suivi bébé</h1>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "track"} className={tab === "track" ? "on" : ""}
            onClick={() => setTab("track")}>Suivi</button>
          <button role="tab" aria-selected={tab === "data"} className={tab === "data" ? "on" : ""}
            onClick={() => setTab("data")}>Données</button>
        </nav>
        <div className="topbar-actions">
          {pending && <span className="sync">…</span>}
          {tab === "track" && <button className="ghost small" onClick={() => run(load)}>Rafraîchir</button>}
          {canLogout && <button className="ghost small" onClick={() => logout()}>Déconnexion</button>}
        </div>
      </header>

      <main>
        {error && (
          <div className="banner" role="alert">
            {error}
            <button className="ghost small" onClick={() => setError(null)}>OK</button>
          </div>
        )}

        {tab === "data" ? <WeeklyData onError={setError} /> : (<>
        {/* ===== ÂGE ===== */}
        {loaded && <BabyCard baby={baby} now={now} onEdit={() => setEditingBaby(true)} />}

        {/* ===== DERNIÈRES ===== */}
        <LastEvents latest={latest} active={active} now={now} loaded={loaded} />

        {/* ===== RÉCAP ===== */}
        <section className="card recap">
          <div className="recap-head">
            <h2>Récap · <span className="muted">{selectedLabel}</span></h2>
          </div>

          <div className="stats">
            <Stat label="Couches" value={dayDiapers} />
            <Stat label="💧 Urine" value={day?.pee ?? 0} tone="pee" />
            <Stat
              label="💩 Caca" value={day?.poo ?? 0} tone="poo"
              sub={day?.poo ? `${pooLevels[1]} faible · ${pooLevels[2]} moyen · ${pooLevels[3]} abondant` : undefined}
            />
            <Stat label="🍼 Tétées" value={day?.feeds ?? 0} tone="feed" />
            <Stat label="⏱ Durée totale" value={day?.feedSec ? formatDuration(day.feedSec) : "—"} tone="feed" />
          </div>

          <div className="recap-body">
            <div className="calendar">
              <div className="cal-head">
                <button className="icon" aria-label="Mois précédent" onClick={() => changeMonth(-1)}>‹</button>
                <span>{month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
                <button className="icon" aria-label="Mois suivant" onClick={() => changeMonth(1)}>›</button>
              </div>
              <div className="cal-grid cal-weekdays">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <span key={d}>{d}</span>)}
              </div>
              <div className="cal-grid">
                {gridDays(month).map((d) => {
                  const k = dayKey(d);
                  const info = byDay.get(k);
                  const cls = [
                    "cal-day",
                    d.getMonth() !== month.getMonth() && "out",
                    k === today && "today",
                    k === selected && "selected",
                  ].filter(Boolean).join(" ");
                  return (
                    <button key={k} className={cls} onClick={() => setSelected(k)}>
                      <span className="num">{d.getDate()}</span>
                      {info && (
                        <span className="counts">
                          {info.pee > 0 && <span className="c pee">{info.pee}</span>}
                          {info.poo > 0 && <span className="c poo">{info.poo}</span>}
                          {info.feeds > 0 && <span className="c feed">{info.feeds}</span>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="cal-legend">
                <span><i className="dot pee" />Urine</span>
                <span><i className="dot poo" />Caca</span>
                <span><i className="dot feed" />Tétées</span>
              </div>
            </div>

            <div className="day-detail">
              <h3>Journal · {selectedLabel}</h3>
              <div className="subtabs" role="tablist" aria-label="Type d'entrée">
                {([["feeding", "🍼 Tétées", day?.feeds ?? 0], ["diaper", "🧷 Couches", dayDiapers]] as const).map(([k, label, n]) => (
                  <button key={k} role="tab" aria-selected={journalTab === k}
                    className={`${k} ${journalTab === k ? "on" : ""}`} onClick={() => setJournalTab(k)}>
                    {label} <span className="count">{n}</span>
                  </button>
                ))}
              </div>
              {!loaded ? (
                <p className="muted">Chargement…</p>
              ) : !journalEntries.length ? (
                <p className="muted">{journalTab === "diaper" ? "Aucune couche" : "Aucune tétée"} ce jour-là.</p>
              ) : (
                <ul className="entries">
                  {journalEntries.map((e) => {
                    const gap = gaps.get(e.item.id);
                    return (
                    <Fragment key={e.item.id}>
                    <li className={`entry ${e.kind}`}>
                      <span className="time">{formatTime(e.at)}</span>
                      <span className="what">
                        {e.kind === "diaper" ? <DiaperLabel d={e.item} /> : <FeedingLabel f={e.item} />}
                      </span>
                      <span className="entry-actions">
                        <button className="icon small" aria-label="Modifier"
                          onClick={() => setEditing(e.kind === "diaper" ? { kind: "diaper", item: e.item } : { kind: "feeding", item: e.item })}>✎</button>
                        <button className="icon small" aria-label="Supprimer"
                          onClick={() => {
                            if (!confirm("Supprimer cette entrée ?")) return;
                            run(() => (e.kind === "diaper" ? deleteDiaper(e.item.id) : deleteFeeding(e.item.id)));
                          }}>🗑</button>
                      </span>
                    </li>
                    {gap !== undefined && (
                      <li className={`entry-gap ${e.kind}`} aria-label="Temps écoulé depuis l'entrée précédente">
                        ↕ {formatDuration(gap)} depuis la précédente
                      </li>
                    )}
                    </Fragment>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <div className="two-cols">
          <DiaperForm pending={pending} onSubmit={(input) => run(() => addDiaper(input))} />
          <FeedingPanel
            active={active}
            now={now}
            pending={pending}
            onStart={(side) => run(async () => setActive(await unwrap(startFeeding(side))))}
            onStop={() => active && run(() => stopFeeding(active.id))}
            onCancel={() => active && confirm("Annuler la tétée en cours sans l'enregistrer ?") && run(() => deleteFeeding(active.id))}
            onManual={(input) => run(() => addFeedingManual(input))}
          />
        </div>
        </>)}
      </main>

      {editingBaby && (
        <BabyDialog
          baby={baby}
          onClose={() => setEditingBaby(false)}
          onSave={(v) => { setEditingBaby(false); run(() => updateBaby(v)); }}
        />
      )}

      {editing && (
        <EditDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(v) => {
            const target = editing;
            setEditing(null);
            run(() => target.kind === "diaper"
              ? updateDiaper(target.item.id, { occurred_at: v.time, pee: v.pee, poo: v.poo, poo_level: v.level })
              : updateFeeding(target.item.id, v.time, v.minutes, v.side));
          }}
        />
      )}
    </>
  );
}

// ======================================================================

function BabyCard({ baby, now, onEdit }: { baby: Baby | null; now: number; onEdit: () => void }) {
  const name = baby?.name || "Bébé";
  if (!baby?.born_at) {
    return (
      <section className="baby-card empty">
        <span>👶 Ajoute la date de naissance pour suivre l&apos;âge de {name.toLowerCase() === "bébé" ? "bébé" : name}.</span>
        <button className="ghost small" onClick={onEdit}>Ajouter</button>
      </section>
    );
  }
  const age = formatAge(baby.born_at, now);
  const born = new Date(baby.born_at);
  return (
    <section className="baby-card">
      <span className="baby-emoji" aria-hidden>👶</span>
      <div className="baby-info">
        <span className="baby-name">{name}</span>
        <span className="baby-age">{age.main}</span>
        <span className="baby-detail">
          {age.detail && <>{age.detail} · </>}
          naissance le {born.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} à {formatTime(baby.born_at)}
        </span>
      </div>
      <button className="icon small" aria-label="Modifier la naissance" onClick={onEdit}>✎</button>
    </section>
  );
}

function BabyDialog({ baby, onClose, onSave }: {
  baby: Baby | null;
  onClose: () => void;
  onSave: (v: { name: string; born_at: string | null }) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(baby?.name ?? "");
  const [born, setBorn] = useState(baby?.born_at ? toLocalInput(new Date(baby.born_at)) : "");
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ name, born_at: born ? localInputToIso(born) : null }); }}>
        <h3>Bébé</h3>
        <label className="field">
          <span>Prénom (optionnel)</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bébé" />
        </label>
        <label className="field">
          <span>Date & heure de naissance</span>
          <input type="datetime-local" value={born} required onChange={(e) => setBorn(e.target.value)} />
        </label>
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">Enregistrer</button>
        </div>
      </form>
    </dialog>
  );
}

function LastEvents({ latest, active, now, loaded }: {
  latest: { lastDiaper: Diaper | null; lastFeeding: Feeding | null; lastPoo: string | null } | null;
  active: Feeding | null;
  now: number;
  loaded: boolean;
}) {
  const f = latest?.lastFeeding ?? null;
  const d = latest?.lastDiaper ?? null;
  const nextSide = f?.side === "G" ? "Droit" : f?.side === "D" ? "Gauche" : null;
  const elapsed = active ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 1000)) : 0;

  return (
    <section className="last-events" aria-label="Derniers événements">
      <div className={`last-card feed ${active ? "running" : ""}`}>
        <span className="last-label">🍼 {active ? "Tétée en cours" : "Dernière tétée"}</span>
        {active ? (
          <>
            <span className="last-big">{formatClock(elapsed)}</span>
            <span className="last-sub">depuis {formatTime(active.started_at)}{active.side ? ` · ${SIDES[active.side]}` : ""}</span>
          </>
        ) : f ? (
          <>
            <span className="last-big">{timeAgo(f.started_at, now)}</span>
            <span className="last-sub">
              à {formatTime(f.started_at)}
              {f.duration_seconds != null && ` · ${formatDuration(f.duration_seconds)}`}
              {f.side && ` · ${SIDES[f.side]}`}
            </span>
            {nextSide && <span className="last-hint">Prochain sein : <strong>{nextSide}</strong></span>}
          </>
        ) : (
          <span className="last-big muted">{loaded ? "—" : "…"}</span>
        )}
      </div>

      <div className="last-card diaper">
        <span className="last-label">🧷 Dernière couche</span>
        {d ? (
          <>
            <span className="last-big">{timeAgo(d.occurred_at, now)}</span>
            <span className="last-sub">
              à {formatTime(d.occurred_at)} · {[d.pee && "💧 Urine", d.poo && `💩 Caca${d.poo_level ? ` ${LEVELS[d.poo_level].toLowerCase()}` : ""}`].filter(Boolean).join(" + ")}
            </span>
            {latest?.lastPoo && !d.poo && (
              <span className="last-hint">Dernier caca : <strong>{timeAgo(latest.lastPoo, now)}</strong></span>
            )}
          </>
        ) : (
          <span className="last-big muted">{loaded ? "—" : "…"}</span>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: string }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function DiaperLabel({ d }: { d: Diaper }) {
  return (
    <>
      {d.pee && <span className="tag pee">💧 Urine</span>}
      {d.poo && <span className="tag poo">💩 Caca{d.poo_level ? ` · ${LEVELS[d.poo_level]}` : ""}</span>}
      {d.note && <span className="note">{d.note}</span>}
    </>
  );
}

function FeedingLabel({ f }: { f: Feeding }) {
  return (
    <span className="tag feed">
      🍼 Tétée {f.duration_seconds != null ? formatDuration(f.duration_seconds) : ""}
      {f.side ? ` · ${SIDES[f.side]}` : ""}
    </span>
  );
}

function DiaperForm({ pending, onSubmit }: {
  pending: boolean;
  onSubmit: (input: { occurred_at: string; pee: boolean; poo: boolean; poo_level: number | null; note: string }) => void;
}) {
  const [pee, setPee] = useState(false);
  const [poo, setPoo] = useState(false);
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [time, setTime] = useState(() => toLocalInput());
  const [timeTouched, setTimeTouched] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(false);

  // Tant que l'utilisateur n'a pas modifié l'heure, elle suit l'heure actuelle
  useEffect(() => {
    if (timeTouched) return;
    const t = setInterval(() => setTime(toLocalInput()), 20_000);
    return () => clearInterval(t);
  }, [timeTouched]);

  return (
    <section className="card">
      <h2>🧷 Couche</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!pee && !poo) { setErr(true); return; }
          onSubmit({ occurred_at: localInputToIso(time), pee, poo, poo_level: poo ? level : null, note });
          setPee(false); setPoo(false); setLevel(2); setNote(""); setErr(false);
          setTime(toLocalInput()); setTimeTouched(false);
        }}
      >
        <div className="toggles">
          <button type="button" className={`toggle pee ${pee ? "on" : ""}`} aria-pressed={pee}
            onClick={() => { setPee(!pee); setErr(false); }}>💧 Urine</button>
          <button type="button" className={`toggle poo ${poo ? "on" : ""}`} aria-pressed={poo}
            onClick={() => { setPoo(!poo); setErr(false); }}>💩 Caca</button>
        </div>

        <fieldset className="levels" disabled={!poo}>
          <legend>Intensité du caca</legend>
          {([1, 2, 3] as const).map((l) => (
            <label key={l} className={level === l ? "on" : ""}>
              <input type="radio" name="level" checked={level === l} onChange={() => setLevel(l)} />
              <span>{"●".repeat(l)}{"○".repeat(3 - l)} {LEVELS[l]}</span>
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span>Date & heure</span>
          <span className="row">
            <input type="datetime-local" value={time} required
              onChange={(e) => { setTime(e.target.value); setTimeTouched(true); }} />
            <button type="button" className="ghost small"
              onClick={() => { setTime(toLocalInput()); setTimeTouched(false); }}>Maintenant</button>
          </span>
        </label>

        <label className="field">
          <span>Note (optionnel)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex : érythème, couleur…" />
        </label>

        {err && <p className="error">Coche au moins Urine ou Caca.</p>}
        <button type="submit" className="primary" disabled={pending}>Enregistrer la couche</button>
      </form>
    </section>
  );
}

function FeedingPanel({ active, now, pending, onStart, onStop, onCancel, onManual }: {
  active: Feeding | null;
  now: number;
  pending: boolean;
  onStart: (side: Side) => void;
  onStop: () => void;
  onCancel: () => void;
  onManual: (input: { started_at: string; minutes: number; side: Side }) => void;
}) {
  const [side, setSide] = useState<Side>("G");
  const [manualTime, setManualTime] = useState(() => toLocalInput());
  const [minutes, setMinutes] = useState(15);

  const elapsed = active ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 1000)) : 0;

  return (
    <section className="card">
      <h2>🍼 Tétée</h2>

      <div className="side-picker" role="radiogroup" aria-label="Sein">
        {([["G", "Gauche"], ["D", "Droit"], [null, "—"]] as const).map(([v, label]) => (
          <button key={label} type="button" role="radio" aria-checked={side === v}
            className={side === v ? "on" : ""} disabled={!!active} onClick={() => setSide(v)}>{label}</button>
        ))}
      </div>

      <div className={`timer ${active ? "running" : ""}`}>{formatClock(elapsed)}</div>
      <p className="timer-sub muted">
        {active
          ? `En cours depuis ${formatTime(active.started_at)}${active.side ? ` · ${SIDES[active.side]}` : ""}`
          : "Pas de tétée en cours"}
      </p>

      <div className="timer-actions">
        {!active ? (
          <button className="primary big" disabled={pending} onClick={() => onStart(side)}>▶ Start tétée</button>
        ) : (
          <>
            <button className="danger big" disabled={pending} onClick={onStop}>■ Stop & enregistrer</button>
            <button className="ghost small" disabled={pending} onClick={onCancel}>Annuler</button>
          </>
        )}
      </div>

      <details className="manual">
        <summary>Ajouter une tétée manuellement</summary>
        <form onSubmit={(e) => {
          e.preventDefault();
          onManual({ started_at: localInputToIso(manualTime), minutes, side });
          setManualTime(toLocalInput());
        }}>
          <label className="field">
            <span>Début</span>
            <span className="row">
              <input type="datetime-local" value={manualTime} required onChange={(e) => setManualTime(e.target.value)} />
              <button type="button" className="ghost small" onClick={() => setManualTime(toLocalInput())}>Maintenant</button>
            </span>
          </label>
          <label className="field">
            <span>Durée (minutes)</span>
            <input type="number" min={1} max={240} value={minutes} required
              onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <button type="submit" className="primary" disabled={pending}>Ajouter</button>
        </form>
      </details>
    </section>
  );
}

function EditDialog({ editing, onClose, onSave }: {
  editing: NonNullable<Editing>;
  onClose: () => void;
  onSave: (v: { time: string; minutes: number; side: Side; pee: boolean; poo: boolean; level: 1 | 2 | 3 | null }) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initialIso = editing.kind === "diaper" ? editing.item.occurred_at : editing.item.started_at;
  const [time, setTime] = useState(() => toLocalInput(new Date(initialIso)));
  const [minutes, setMinutes] = useState(() =>
    editing.kind === "feeding" ? Math.max(1, Math.round((editing.item.duration_seconds ?? 60) / 60)) : 0);
  const [side, setSide] = useState<Side>(() => (editing.kind === "feeding" ? editing.item.side : null));
  const [pee, setPee] = useState(() => (editing.kind === "diaper" ? editing.item.pee : false));
  const [poo, setPoo] = useState(() => (editing.kind === "diaper" ? editing.item.poo : false));
  const [level, setLevel] = useState<1 | 2 | 3 | null>(() => (editing.kind === "diaper" ? editing.item.poo_level : null));
  const [err, setErr] = useState(false);

  useEffect(() => { ref.current?.showModal(); }, []);

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (editing.kind === "diaper" && !pee && !poo) { setErr(true); return; }
        onSave({ time: localInputToIso(time), minutes, side, pee, poo, level: poo ? level : null });
      }}>
        <h3>Modifier {editing.kind === "diaper" ? "la couche" : "la tétée"}</h3>
        <label className="field">
          <span>{editing.kind === "diaper" ? "Date & heure" : "Début"}</span>
          <input type="datetime-local" value={time} required onChange={(e) => setTime(e.target.value)} />
        </label>
        {editing.kind === "diaper" && (
          <>
            <div className="toggles">
              <button type="button" className={`toggle pee ${pee ? "on" : ""}`} aria-pressed={pee}
                onClick={() => { setPee(!pee); setErr(false); }}>💧 Urine</button>
              <button type="button" className={`toggle poo ${poo ? "on" : ""}`} aria-pressed={poo}
                onClick={() => { setPoo(!poo); setErr(false); }}>💩 Caca</button>
            </div>
            <fieldset className="levels levels-4" disabled={!poo}>
              <legend>Intensité du caca</legend>
              {([1, 2, 3, null] as const).map((l) => (
                <label key={String(l)} className={level === l ? "on" : ""}>
                  <input type="radio" name="edit-level" checked={level === l} onChange={() => setLevel(l)} />
                  <span>{l ? LEVELS[l] : "—"}</span>
                </label>
              ))}
            </fieldset>
            {err && <p className="error">Coche au moins Urine ou Caca.</p>}
          </>
        )}
        {editing.kind === "feeding" && (
          <label className="field">
            <span>Durée (minutes)</span>
            <input type="number" min={1} max={240} value={minutes} required onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        )}
        {editing.kind === "feeding" && (
          <div className="field">
            <span>Sein</span>
            <div className="side-picker" role="radiogroup" aria-label="Sein">
              {([["G", "Gauche"], ["D", "Droit"], [null, "—"]] as const).map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={side === v}
                  className={side === v ? "on" : ""} onClick={() => setSide(v)}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">Enregistrer</button>
        </div>
      </form>
    </dialog>
  );
}
