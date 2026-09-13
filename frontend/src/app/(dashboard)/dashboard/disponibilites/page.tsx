"use client";

/**
 * Dispos & plannings de l'équipe — la vue admin des deux écrans membre.
 *
 * L'admin voyait jusqu'ici les disponibilités uniquement sous forme de
 * comptes agrégés (grille de couleurs du planning) : impossible de répondre à
 * « qu'a déclaré Untel cette semaine ? » ou « sur quoi est-il affecté ? » sans
 * se connecter à son compte. Cette page rejoue, en lecture seule, exactement
 * les deux onglets de /dashboard/availability — « Mes disponibilités » et
 * « Mon planning » — pour n'importe quel examinateur, plus une vue d'ensemble
 * de toute l'équipe.
 *
 * Aucune écriture : l'admin observe, il ne saisit pas à la place des membres
 * (les affectations se modifient depuis le planning, créneau par créneau).
 *
 * Aucune route API nouvelle : tout vient de /members, /availability/all et
 * /slots/all, déjà réservées au staff.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import TimeBandGrid, { type Overlay } from "@/components/planning/TimeBandGrid";
import {
  rowsToBands,
  localYmd,
  type AvailabilityRow,
} from "@/lib/availability-bands";
import {
  GRID_END_MIN,
  GRID_START_MIN,
  formatDuration,
  hhmmToMinutes,
  minutesToHHMM,
  type Band,
} from "@/lib/time-bands";

const STATUS_LABELS: Record<string, string> = {
  draft: "Pas encore publié",
  open: "En attente de complément de jury",
  ready: "Jury complet — en attente de publication",
  published: "Publié aux candidats",
  full: "Complet",
  closed: "Clôturé",
};

/** Palette stable par épreuve — identique à la vue membre, pour que l'admin
 *  et l'examinateur décrivent le même créneau avec la même couleur. */
const EPREUVE_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#16a34a",
  "#db2777",
];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return EPREUVE_COLORS[h % EPREUVE_COLORS.length];
}

/** Pas d'échantillonnage de la vue d'ensemble. 15 min = le pas de tracé de la
 *  grille : aucune plage déclarée ne peut être coupée en deux par l'agrégat. */
const STEP_MIN = 15;

/** Plus c'est foncé, plus il y a de monde. Le rouge isole le cas critique
 *  (un seul examinateur dispo : aucun jury possible à deux). */
function countColor(n: number): string {
  if (n <= 1) return "#f87171";
  if (n === 2) return "#fbbf24";
  if (n === 3) return "#60a5fa";
  if (n === 4) return "#3b82f6";
  return "#1d4ed8";
}

interface Member {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  pole?: string;
  isAdmin?: boolean;
}

interface SlotDetail {
  id: string;
  epreuveName: string;
  date: string;
  startMin: number;
  endMin: number;
  room?: string;
  status?: string;
  candidateNames: string[];
  juryNames: string[];
}

/** Ce qu'on sait d'un examinateur pour la semaine affichée. */
interface MemberWeek {
  member: Member;
  bands: Band[];
  availMin: number;
  slots: any[];
  slotMin: number;
}

function fullName(p: {
  first_name?: string;
  last_name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}) {
  const name = `${p.first_name ?? p.firstName ?? ""} ${
    p.last_name ?? p.lastName ?? ""
  }`.trim();
  return name || p.email || "";
}

type Tab = "dispo" | "planning";
const ALL = "__all__";

export default function TeamAvailabilityPage() {
  const { user, isInitialized } = useAuth();
  const isAdmin = user?.isAdmin === true;

  const [tab, setTab] = useState<Tab>("dispo");
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [availRows, setAvailRows] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);

  const [selectedId, setSelectedId] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [sortByLeast, setSortByLeast] = useState(false);
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  /** Bloc de la vue d'ensemble ouvert (qui est dispo à ce moment-là). */
  const [openBlock, setOpenBlock] = useState<{
    dayIndex: number;
    startMin: number;
    endMin: number;
    people: { name: string; range: string | null }[];
  } | null>(null);

  const days = useMemo(() => {
    const monday = addDays(
      startOfWeek(new Date(), { weekStartsOn: 1 }),
      weekOffset * 7,
    );
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  }, [weekOffset]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = localYmd(days[0]);
      const end = localYmd(days[4]);
      const noCache = {
        headers: { "Cache-Control": "no-store" },
        params: { t: Date.now() },
      };

      const [membersRes, availRes, slotsRes] = await Promise.all([
        api.get("/members", noCache),
        api.get("/availability/all", {
          ...noCache,
          params: { ...noCache.params, start, end },
        }),
        api.get("/slots/all", {
          ...noCache,
          params: { ...noCache.params, start, end },
        }),
      ]);

      setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      setAvailRows(Array.isArray(availRes.data) ? availRes.data : []);
      setSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
    } catch (e: any) {
      if (e?.response?.status === 403) setForbidden(true);
      else setError("Impossible de charger les disponibilités de l'équipe.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAdmin) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    load();
  }, [isInitialized, isAdmin, load]);

  // ─── Agrégation par membre pour la semaine affichée ────────────────

  const weeks: MemberWeek[] = useMemo(() => {
    const rowsByMember = new Map<string, AvailabilityRow[]>();
    for (const r of availRows) {
      const mid = r.member_id || r.member?.id;
      if (!mid || !r.date) continue;
      const list = rowsByMember.get(mid) ?? [];
      list.push(r);
      rowsByMember.set(mid, list);
    }

    const slotsByMember = new Map<string, any[]>();
    for (const s of slots) {
      for (const a of s.members || []) {
        const mid = a.member_id || a.member?.id;
        if (!mid) continue;
        const list = slotsByMember.get(mid) ?? [];
        list.push(s);
        slotsByMember.set(mid, list);
      }
    }

    return members.map((m) => {
      const bands = rowsToBands(rowsByMember.get(m.id) ?? [], days);
      const mine = (slotsByMember.get(m.id) ?? []).sort(
        (a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          String(a.start_time || "").localeCompare(String(b.start_time || "")),
      );
      return {
        member: m,
        bands,
        availMin: bands.reduce((s, b) => s + (b.endMin - b.startMin), 0),
        slots: mine,
        slotMin: mine.reduce((sum, s) => {
          if (!s.start_time || !s.end_time) return sum;
          return (
            sum +
            Math.max(
              0,
              hhmmToMinutes(String(s.end_time)) -
                hhmmToMinutes(String(s.start_time)),
            )
          );
        }, 0),
      };
    });
  }, [members, availRows, slots, days]);

  const weekById = useMemo(
    () => new Map(weeks.map((w) => [w.member.id, w])),
    [weeks],
  );

  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = weeks.filter((w) => {
      if (!q) return true;
      const hay =
        `${w.member.firstName ?? ""} ${w.member.lastName ?? ""} ${w.member.email} ${w.member.pole ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    return list.sort((a, b) => {
      if (sortByLeast && a.availMin !== b.availMin) return a.availMin - b.availMin;
      return fullName(a.member).localeCompare(fullName(b.member), "fr");
    });
  }, [weeks, query, sortByLeast]);

  const selected = selectedId === ALL ? null : weekById.get(selectedId) ?? null;

  // ─── Vue d'ensemble : combien de monde, minute par minute ──────────

  const teamOverlays: Overlay[] = useMemo(() => {
    if (selectedId !== ALL) return [];
    const out: Overlay[] = [];
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      // On fusionne sur l'EFFECTIF, pas sur la composition : à composition
      // identique exigée, la grille se brisait en blocs de 15 min dès qu'une
      // personne entrait ou sortait — illisible. Ici, la couleur dit « combien
      // de jurys je peux monter à ce moment-là » ; le clic dit qui, avec les
      // horaires de chacun quand ils ne couvrent pas tout le bloc.
      let run: { start: number; end: number; count: number } | null = null;
      const flush = () => {
        if (!run || run.count === 0) return;
        out.push({
          id: `agg-${dayIndex}-${run.start}`,
          dayIndex,
          laneId: "",
          startMin: run.start,
          endMin: run.end,
          label: `${run.count} dispo`,
          color: countColor(run.count),
          hideCheck: true,
        });
      };

      for (let t = GRID_START_MIN; t < GRID_END_MIN; t += STEP_MIN) {
        const count = weeks.filter((w) =>
          w.bands.some(
            (b) =>
              b.dayIndex === dayIndex &&
              b.startMin <= t &&
              b.endMin >= t + STEP_MIN,
          ),
        ).length;
        if (run && run.count === count) {
          run.end = t + STEP_MIN;
        } else {
          flush();
          run = { start: t, end: t + STEP_MIN, count };
        }
      }
      flush();
    }
    return out;
  }, [selectedId, weeks, days.length]);

  /** Qui est là sur [start, end[, et sur quelle portion exactement. */
  const whoIsFree = useCallback(
    (dayIndex: number, start: number, end: number) =>
      weeks
        .flatMap((w) => {
          const segs = w.bands
            .filter((b) => b.dayIndex === dayIndex)
            .map((b) => ({
              s: Math.max(b.startMin, start),
              e: Math.min(b.endMin, end),
            }))
            .filter((x) => x.e > x.s);
          if (segs.length === 0) return [];
          const whole = segs.some((x) => x.s <= start && x.e >= end);
          return [
            {
              name: fullName(w.member),
              range: whole
                ? null
                : segs
                    .map((x) => `${minutesToHHMM(x.s)}–${minutesToHHMM(x.e)}`)
                    .join(", "),
            },
          ];
        })
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [weeks],
  );

  // ─── Onglet planning : les affectations du membre sélectionné ──────

  const { overlays, details } = useMemo(() => {
    const list: Overlay[] = [];
    const map = new Map<string, SlotDetail>();
    if (!selected) return { overlays: list, details: map };

    const dayIndexOf = new Map(days.map((d, i) => [localYmd(d), i]));
    for (const s of selected.slots) {
      const idx = dayIndexOf.get(String(s.date).slice(0, 10));
      if (idx === undefined || !s.start_time || !s.end_time) continue;

      const candidateNames = ((s.enrollments || []) as any[])
        .map((e) => fullName(e.candidate || {}))
        .filter(Boolean);
      const juryNames = ((s.members || []) as any[])
        .filter((m) => (m.member_id || m.member?.id) !== selected.member.id)
        .map((m) => fullName(m.member || {}))
        .filter(Boolean);

      const parts: string[] = [];
      if (s.room) parts.push(`salle ${s.room}`);
      if (candidateNames.length === 1) parts.push(candidateNames[0]);
      else if (candidateNames.length > 1)
        parts.push(`${candidateNames.length} candidats`);

      list.push({
        id: s.id,
        dayIndex: idx,
        laneId: "",
        startMin: hhmmToMinutes(String(s.start_time)),
        endMin: hhmmToMinutes(String(s.end_time)),
        label: s.epreuve?.name?.trim() || "Épreuve",
        sublabel: parts.join(" · ") || undefined,
        color: colorFor(s.epreuve?.id || s.id),
        hasCandidates: candidateNames.length > 0,
      });
      map.set(s.id, {
        id: s.id,
        epreuveName: s.epreuve?.name?.trim() || "Épreuve",
        date: String(s.date).slice(0, 10),
        startMin: hhmmToMinutes(String(s.start_time)),
        endMin: hhmmToMinutes(String(s.end_time)),
        room: s.room || undefined,
        status: s.status,
        candidateNames,
        juryNames,
      });
    }
    return { overlays: list, details: map };
  }, [selected, days]);

  const sansDispo = weeks.filter((w) => w.availMin === 0).length;

  // ─── Rendu ─────────────────────────────────────────────────────────

  if (forbidden) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Cette page est réservée aux administrateurs.
        </div>
      </div>
    );
  }

  return (
    <div className="px-0 py-1 sm:p-6 max-w-[1600px] mx-auto">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Dispos &amp; plannings de l&apos;équipe
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Ce que chaque examinateur a déclaré, et ce sur quoi il est affecté.
            Lecture seule.
          </p>
        </div>

        <div className="flex items-center justify-between gap-1 rounded-lg border border-gray-200 p-0.5">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="shrink-0 rounded-md p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-gray-500 hover:bg-gray-50"
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
            className="px-2 text-sm font-medium text-gray-700 whitespace-nowrap disabled:cursor-default"
            title="Revenir à la semaine en cours"
          >
            {format(days[0], "d MMM", { locale: fr })} –{" "}
            {format(days[4], "d MMM yyyy", { locale: fr })}
          </button>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="shrink-0 rounded-md p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-gray-500 hover:bg-gray-50"
            aria-label="Semaine suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* ─── Colonne gauche : l'équipe ─── */}
          <aside className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un examinateur…"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-gray-500">
                  {visibleMembers.length} membre
                  {visibleMembers.length > 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => setSortByLeast((s) => !s)}
                  className={`rounded-full px-2 py-1 font-medium transition-colors ${
                    sortByLeast
                      ? "bg-amber-100 text-amber-800"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {sortByLeast ? "Moins dispo d'abord" : "Ordre alphabétique"}
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              <button
                onClick={() => setSelectedId(ALL)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  selectedId === ALL
                    ? "bg-blue-50 font-semibold text-blue-800 ring-1 ring-blue-200"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Users className="h-4 w-4 shrink-0" />
                <span className="flex-1">Toute l&apos;équipe</span>
                {sansDispo > 0 && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                    title={`${sansDispo} membre(s) sans aucune dispo cette semaine`}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {sansDispo}
                  </span>
                )}
              </button>

              {visibleMembers.map((w) => {
                const active = selectedId === w.member.id;
                return (
                  <button
                    key={w.member.id}
                    onClick={() => setSelectedId(w.member.id)}
                    className={`mb-0.5 w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      active
                        ? "bg-blue-50 ring-1 ring-blue-200"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${active ? "font-semibold text-blue-900" : "font-medium text-gray-800"}`}
                      >
                        {fullName(w.member)}
                      </span>
                      {w.slots.length > 0 && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                          {w.slots.length} créneau
                          {w.slots.length > 1 ? "x" : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                      {w.availMin > 0 ? (
                        <span className="text-gray-500">
                          {formatDuration(w.availMin)} déclarées
                        </span>
                      ) : (
                        <span className="font-medium text-rose-600">
                          aucune dispo
                        </span>
                      )}
                      {w.member.pole && (
                        <span className="truncate text-gray-400">
                          · {w.member.pole}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* ─── Colonne droite : la vue ─── */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="scroll-x flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-0.5">
                <button
                  onClick={() => setTab("dispo")}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-2 min-h-[40px] text-sm font-medium transition-colors ${
                    tab === "dispo"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Disponibilités
                </button>
                <button
                  onClick={() => setTab("planning")}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-2 min-h-[40px] text-sm font-medium transition-colors ${
                    tab === "planning"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Planning
                  {selected && selected.slots.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                      {selected.slots.length}
                    </span>
                  )}
                </button>
              </div>

              <p className="text-sm text-gray-500">
                {selected ? (
                  <>
                    <strong className="text-gray-900">
                      {fullName(selected.member)}
                    </strong>{" "}
                    · {formatDuration(selected.availMin)} déclarées ·{" "}
                    {selected.slots.length} affectation
                    {selected.slots.length > 1 ? "s" : ""} (
                    {formatDuration(selected.slotMin)})
                  </>
                ) : (
                  <>
                    <strong className="text-gray-900">{weeks.length}</strong>{" "}
                    examinateurs · {weeks.length - sansDispo} ont déclaré des
                    dispos
                  </>
                )}
              </p>
            </div>

            {/* ── Onglet Disponibilités ── */}
            {tab === "dispo" &&
              (selected ? (
                selected.bands.length === 0 ? (
                  <EmptyState
                    icon={<CalendarCheck className="h-6 w-6" />}
                    text={`${fullName(selected.member)} n'a déclaré aucune disponibilité cette semaine.`}
                  />
                ) : (
                  <TimeBandGrid days={days} bands={selected.bands} readOnly />
                )
              ) : teamOverlays.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-6 w-6" />}
                  text="Personne n'a déclaré de disponibilité cette semaine."
                />
              ) : (
                <>
                  <TimeBandGrid
                    days={days}
                    bands={[]}
                    overlays={teamOverlays}
                    onOverlayClick={(o) => {
                      const ids = weeks
                        .filter((w) =>
                          w.bands.some(
                            (b) =>
                              b.dayIndex === o.dayIndex &&
                              b.startMin <= o.startMin &&
                              b.endMin >= o.endMin,
                          ),
                        )
                        .map((w) => fullName(w.member))
                        .sort((a, b) => a.localeCompare(b, "fr"));
                      setOpenBlock({
                        dayIndex: o.dayIndex,
                        startMin: o.startMin,
                        endMin: o.endMin,
                        names: ids,
                      });
                    }}
                    readOnly
                    pxPerMin={1.3}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span>Nombre d&apos;examinateurs disponibles :</span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} className="flex items-center gap-1">
                        <span
                          className="h-3 w-3 rounded-sm"
                          style={{ backgroundColor: countColor(n) }}
                        />
                        {n === 5 ? "5 et +" : n}
                      </span>
                    ))}
                    <span className="text-gray-400">
                      · cliquez un bloc pour voir qui
                    </span>
                  </div>
                </>
              ))}

            {/* ── Onglet Planning ── */}
            {tab === "planning" &&
              (selected ? (
                overlays.length === 0 ? (
                  <EmptyState
                    icon={<CalendarCheck className="h-6 w-6" />}
                    text={`${fullName(selected.member)} n'est affecté(e) à aucun créneau cette semaine.`}
                  />
                ) : (
                  <TimeBandGrid
                    days={days}
                    bands={[]}
                    overlays={overlays}
                    onOverlayClick={(o) => setOpenSlotId(o.id)}
                    readOnly
                    pxPerMin={1.3}
                  />
                )
              ) : (
                <TeamLoadTable
                  weeks={visibleMembers}
                  onSelect={(id) => setSelectedId(id)}
                />
              ))}
          </section>
        </div>
      )}

      {/* Détail d'un créneau — même contenu que la modale côté membre. */}
      {openSlotId &&
        (() => {
          const d = details.get(openSlotId);
          if (!d) return null;
          const dateLabel = new Date(`${d.date}T12:00:00`).toLocaleDateString(
            "fr-FR",
            { weekday: "long", day: "numeric", month: "long" },
          );
          return (
            <Modal onClose={() => setOpenSlotId(null)} title={d.epreuveName}>
              <p className="-mt-3 mb-4 text-xs text-gray-500">
                {dateLabel} · {minutesToHHMM(d.startMin)}–
                {minutesToHHMM(d.endMin)}
                {d.room ? ` · salle ${d.room}` : ""}
              </p>
              {d.status && (
                <span className="mb-4 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {STATUS_LABELS[d.status] || d.status}
                </span>
              )}
              <NameList
                title={`Candidat${d.candidateNames.length > 1 ? "s" : ""} (${d.candidateNames.length})`}
                names={d.candidateNames}
                empty="Personne inscrit pour l'instant."
              />
              <NameList
                title="Reste du jury"
                names={d.juryNames}
                empty="Seul(e) affecté(e) pour l'instant."
              />
            </Modal>
          );
        })()}

      {/* Qui est disponible sur ce bloc ? */}
      {openBlock && (
        <Modal
          onClose={() => setOpenBlock(null)}
          title={`${format(days[openBlock.dayIndex], "EEEE d MMMM", { locale: fr })}`}
        >
          <p className="-mt-3 mb-4 text-xs text-gray-500">
            {minutesToHHMM(openBlock.startMin)}–
            {minutesToHHMM(openBlock.endMin)} ·{" "}
            {openBlock.names.length} examinateur
            {openBlock.names.length > 1 ? "s" : ""} disponible
            {openBlock.names.length > 1 ? "s" : ""}
          </p>
          <ul className="space-y-1 text-sm text-gray-800">
            {openBlock.names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  text,
}: {
  icon: ReactNode;
  text: string;
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 text-gray-400">
      {icon}
      <p className="px-4 text-center text-sm">{text}</p>
    </div>
  );
}

function NameList({
  title,
  names,
  empty,
}: {
  title: string;
  names: string[];
  empty: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
        <Users className="h-3.5 w-3.5" />
        {title}
      </p>
      {names.length > 0 ? (
        <ul className="space-y-1 text-sm text-gray-800">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">{empty}</p>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
          <h3 className="font-semibold capitalize text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 pt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Charge de la semaine, membre par membre : qui passe combien de temps sur
 * quelles épreuves. C'est la lecture « examinateurs » du planning — le
 * tableau des inscriptions du planning admin, lui, est orienté créneaux.
 */
function TeamLoadTable({
  weeks,
  onSelect,
}: {
  weeks: MemberWeek[];
  onSelect: (id: string) => void;
}) {
  const rows = weeks
    .slice()
    .sort((a, b) => b.slots.length - a.slots.length || b.slotMin - a.slotMin);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-100 bg-gray-50 text-gray-600">
          <tr>
            <th className="px-4 py-2 font-medium">Examinateur</th>
            <th className="px-4 py-2 text-center font-medium">Créneaux</th>
            <th className="px-4 py-2 text-center font-medium">Temps</th>
            <th className="px-4 py-2 text-center font-medium">Dispos</th>
            <th className="px-4 py-2 font-medium">Épreuves</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((w) => {
            const epreuves = Array.from(
              new Set(
                w.slots
                  .map((s: any) => s.epreuve?.name?.trim())
                  .filter(Boolean) as string[],
              ),
            );
            return (
              <tr
                key={w.member.id}
                onClick={() => onSelect(w.member.id)}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className="px-4 py-2 font-medium text-gray-800">
                  {fullName(w.member)}
                </td>
                <td className="px-4 py-2 text-center">
                  {w.slots.length > 0 ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                      {w.slots.length}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-center text-xs text-gray-600">
                  {w.slotMin > 0 ? formatDuration(w.slotMin) : "—"}
                </td>
                <td className="px-4 py-2 text-center text-xs">
                  {w.availMin > 0 ? (
                    <span className="text-gray-600">
                      {formatDuration(w.availMin)}
                    </span>
                  ) : (
                    <span className="font-medium text-rose-600">0</span>
                  )}
                </td>
                <td className="max-w-xs truncate px-4 py-2 text-xs text-gray-500">
                  {epreuves.join(" · ") || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
