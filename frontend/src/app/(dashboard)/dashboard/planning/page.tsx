"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import MemberAvailabilityGrid from "@/app/(dashboard)/dashboard/availability/page";
import RoomOpeningsGrid from "@/components/planning/RoomOpeningsGrid";
import TourOpeningsPanel from "@/components/planning/TourOpeningsPanel";
import EnrollmentsTable from "@/components/planning/EnrollmentsTable";
import EpreuveSlotsSummary from "@/components/planning/EpreuveSlotsSummary";
import UnderstaffedBanner from "@/components/planning/UnderstaffedBanner";
import { CalendarColumn } from "@/components/calendar/CalendarColumn";
import { startOfWeek, addDays } from "date-fns";
import { generateICS, downloadICS } from "@/lib/icsGenerator";
import { lockReasonLabel } from "@/lib/slot-lock";
import { slotLinkHost } from "@/lib/slot-links";
import { availabilityMatchesSlot } from "@/lib/dispatch-core";
import { roomChoicesForSlot } from "@/lib/room-choices";
import { POLL, startPolling } from "@/lib/poll";

// Chargement lazy de CalendarAdminBuilder (FullCalendar ~300kB) pour
// ne pas alourdir le bundle initial de la page planning.
const CalendarAdminBuilder = dynamic(
  () => import("@/components/calendar/CalendarAdminBuilder"),
  { ssr: false, loading: () => <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Chargement du calendrier…</div> }
);

interface Epreuve {
  id: string;
  name: string;
  type: string;
  tour: string;
  isCommune: boolean;
  dateDebut?: string;
  dateFin?: string;
  durationMinutes?: number;
  duration_minutes?: number;
  roulementMinutes?: number;
  roulement_minutes?: number;
  isGroupEpreuve?: boolean;
  groupSize?: number;
}

interface SlotAvailability {
  [key: string]: boolean;
}

interface MySlot {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  label: string;
  status: string;
  epreuve?: { name: string; tour: string; type: string };
  /**
   * Lien du business game, servi par /api/slots/my-slots aux seuls
   * examinateurs affectés à ce créneau. null quand l'admin n'en a pas posé.
   */
  link?: { url: string; label: string | null; updatedAt: string | null } | null;
  enrollments?: {
    candidate: { id: string; first_name: string; last_name: string };
  }[];
  members?: { member: { id: string; email: string } }[];
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const TIME_SLOTS = ["09h", "10h", "11h", "12h", "13h", "14h", "15h", "16h"];

function getAvailBg(count: number): string {
  if (count >= 3) return "#EFF6FF";
  if (count === 2) return "#FEF9C3";
  return "#FFF0F3";
}

function getAvailBorder(count: number): string {
  if (count >= 3) return "#BFDBFE";
  if (count === 2) return "#FDE68A";
  return "#FECDD3";
}

function getStatusBadge(status: string) {
  if (status === "Complet")
    return { bg: "#DCFCE7", text: "#166534", border: "#BBF7D0" };
  if (status === "Disponible")
    return { bg: "#EFF6FF", text: "#1E40AF", border: "#BFDBFE" };
  return { bg: "#FFF0F3", text: "#9F1239", border: "#FECDD3" };
}

/**
 * Statut d'affectation du membre courant sur un créneau, pour le code couleur
 * de "Mon emploi du temps" :
 *   • vert   = vous êtes titulaire confirmé (c'est vous qui évaluez)
 *   • orange = en attente (titulaire mais le créneau n'est pas encore publié/figé)
 *   • rouge  = surplus → vous êtes au-delà du nombre d'examinateurs requis,
 *              quasi sûr de ne pas être retenu.
 */
function getMyAssignmentStatus(
  slot: MySlot,
  userId?: string,
): {
  side: string;
  cardClass: string;
  timeClass: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  label: string;
} {
  const minMembers = (slot as any).min_members || (slot as any).minMembers || 2;
  const ordered = [...(slot.members || [])].sort((a: any, b: any) =>
    String(a.created_at || "").localeCompare(String(b.created_at || "")),
  );
  const myIndex = ordered.findIndex(
    (m: any) => (m.member?.id || m.member_id) === userId,
  );
  const isConfirmedSlot = ["ready", "published", "full", "closed"].includes(
    slot.status,
  );

  const GREEN = {
    side: "#22c55e",
    cardClass: "bg-green-50/30",
    timeClass: "text-green-900",
    badgeBg: "#dcfce7",
    badgeText: "#166534",
    badgeBorder: "#bbf7d0",
    label: "Confirmé — vous évaluez",
  };
  const ORANGE = {
    side: "#f59e0b",
    cardClass: "bg-amber-50/30",
    timeClass: "text-amber-900",
    badgeBg: "#fef3c7",
    badgeText: "#92400e",
    badgeBorder: "#fde68a",
    label: "En attente de confirmation",
  };
  const RED = {
    side: "#ef4444",
    cardClass: "bg-red-50/30",
    timeClass: "text-red-900",
    badgeBg: "#fee2e2",
    badgeText: "#991b1b",
    badgeBorder: "#fecaca",
    label: "Peu probable d'être retenu",
  };

  // Au-delà du quota → surplus, sera vraisemblablement écarté.
  if (myIndex >= 0 && myIndex >= minMembers) return RED;
  // Titulaire sur un créneau figé/publié → confirmé.
  if (isConfirmedSlot) return GREEN;
  // Titulaire mais créneau pas encore confirmé → en attente.
  return ORANGE;
}

export default function PlanningPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  // Les admins non-super sont aussi des membres : ils peuvent basculer vers
  // leur espace membre (saisir leurs dispos, s'inscrire sur des créneaux).
  // Le super-admin garde la vue admin pure.
  const isRealAdmin = user?.isAdmin === true;
  const isSuperAdmin = user?.isSuperAdmin === true;
  const [memberMode, setMemberMode] = useState(false);
  const isAdmin = isRealAdmin && !memberMode;
  const canToggleMode = isRealAdmin && !isSuperAdmin;

  const ModeToggle = canToggleMode ? (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
      <button
        onClick={() => setMemberMode(false)}
        className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${!memberMode ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
      >
        Vue admin
      </button>
      <button
        onClick={() => setMemberMode(true)}
        className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${memberMode ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
      >
        Mes disponibilités
      </button>
    </div>
  ) : null;

  const [epreuves, setEpreuves] = useState<Epreuve[]>([]);
  const [selectedEpreuveId, setSelectedEpreuveId] = useState<string>("");
  /**
   * Effectif du TOUR de l'épreuve sélectionnée — candidats attendus / marge
   * vivent au niveau du tour (partagés entre ses épreuves), pas de l'épreuve.
   * Rechargé à chaque changement d'épreuve ; la grille d'ouvertures et le
   * panneau du tour en dérivent tous les deux leur estimation.
   */
  const [tourCapacity, setTourCapacity] = useState<{
    candidatsAttendus: number | null;
    margePct: number;
  }>({ candidatsAttendus: null, margePct: 25 });
  const [loading, setLoading] = useState(true);

  // Admin state
  const [availabilityData, setAvailabilityData] = useState<
    Record<string, number>
  >({});
  const [availabilityDetails, setAvailabilityDetails] = useState<
    Record<string, any[]>
  >({});
  const [selectedDispoCell, setSelectedDispoCell] = useState<{
    key: string;
    label: string;
    members: any[];
  } | null>(null);
  const [sallesParCreneau, setSallesParCreneau] = useState(2);
  const [evalParSalle, setEvalParSalle] = useState(3);
  const [inscriptionData, setInscriptionData] = useState<
    { creneau: string; inscrits: number; capacite: number; statut: string }[]
  >([]);
  const [saisiOuverte, setSaisiOuverte] = useState(false);
  const [inscriptionsOuvertes, setInscriptionsOuvertes] = useState(false);
  const [existingSlots, setExistingSlots] = useState<any[]>([]);
  const [allSlotsGlobal, setAllSlotsGlobal] = useState<any[]>([]); // Tous les créneaux de toutes les épreuves pour la vue globale

  // ── Liens de business game ──
  // slotId → { url, label, updatedAt }. Chargé pour l'admin seul : c'est la
  // seule vue qui montre les liens hors du périmètre d'un jury (un examinateur
  // reçoit le lien de SES créneaux par /slots/my-slots).
  const [slotLinks, setSlotLinks] = useState<Record<string, any>>({});
  const [linksMigrationPending, setLinksMigrationPending] = useState(false);
  // Éditeur de lien de la modale de détail (« + Ajouter » / « ✏️ Modifier »).
  const [linkEditOpen, setLinkEditOpen] = useState(false);
  const [linkEditUrl, setLinkEditUrl] = useState("");
  const [linkEditLabel, setLinkEditLabel] = useState("");
  const [linkEditNotify, setLinkEditNotify] = useState(true);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [globalEvents, setGlobalEvents] = useState<any[]>([]); // NEW STATE for global admin calendar
  // Modal détail créneau cliqué dans la vue calendrier globale
  const [globalDetailSlot, setGlobalDetailSlot] = useState<any | null>(null);
  // Créneau dont le verrou est en cours de bascule (évite le double-clic).
  const [lockBusyId, setLockBusyId] = useState<string | null>(null);
  // Sélecteur « + examinateur » de la modale de détail.
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberPickerQuery, setMemberPickerQuery] = useState("");
  const [memberPickerBusy, setMemberPickerBusy] = useState<string | null>(null);
  // Dispos de TOUS les membres pour la seule journée du créneau ouvert :
  // elles servent à distinguer « disponible » de « à forcer » dans la liste.
  const [dayAvailabilities, setDayAvailabilities] = useState<any[]>([]);
  // Sélecteur « + candidat » de la modale de détail.
  //
  // Contrairement aux examinateurs (une trentaine, déjà en mémoire), les
  // candidats se comptent en centaines : la liste complète ne serait ni
  // lisible ni utile. On interroge donc le serveur à la frappe et on
  // n'affiche RIEN tant que la recherche n'a pas commencé.
  const [candPickerOpen, setCandPickerOpen] = useState(false);
  const [candQuery, setCandQuery] = useState("");
  const [candResults, setCandResults] = useState<any[]>([]);
  const [candSearching, setCandSearching] = useState(false);
  const [candBusy, setCandBusy] = useState<string | null>(null);
  const [candNotify, setCandNotify] = useState(true);
  const [repartitionLoading, setRepartitionLoading] = useState(false);
  const [repartitionResult, setRepartitionResult] = useState<any>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Planning visibility for candidates
  const [planningVisible, setPlanningVisible] = useState(false);
  // ViewMode state
  const [activeTab, setActiveTab] = useState<
    "creation" | "evaluators" | "candidates"
  >("creation");

  // Éditeur de salle de la modale de détail (« ✏️ Changer »).
  const [roomEditOpen, setRoomEditOpen] = useState(false);
  const [roomEditValue, setRoomEditValue] = useState("");
  // Saisie libre : une salle peut n'avoir encore jamais servi sur le planning.
  const [roomEditCustom, setRoomEditCustom] = useState(false);
  const [roomEditNotify, setRoomEditNotify] = useState(true);
  const [roomEditSaving, setRoomEditSaving] = useState(false);

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapAKey, setSwapAKey] = useState("");
  const [swapBKey, setSwapBKey] = useState("");
  const [swapLoading, setSwapLoading] = useState(false);
  // Tous les membres (pour le sélecteur dans la modale)
  const [allMembers, setAllMembers] = useState<
    { id: string; email: string; firstName?: string; lastName?: string }[]
  >([]);

  // Member state
  const [memberAvailabilities, setMemberAvailabilities] = useState<
    Record<string, SlotAvailability>
  >({});
  const [saisieOuverteMember, setSaisieOuverteMember] = useState<
    boolean | null
  >(null); // null = loading
  const [planningGenerated, setPlanningGenerated] = useState<boolean | null>(
    null,
  ); // null = loading
  const [mySlots, setMySlots] = useState<MySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<MySlot | null>(null); // pour la modale

  // Compteur pour forcer le re-fetch du calendrier de contrôle après
  // une mutation d'ouverture (création/modif/suppression/duplication)
  const [calRefreshKey, setCalRefreshKey] = useState(0);
  // Deux façons de déclarer les ouvertures de salles : la grille à bandes
  // (nouvelle) et le formulaire historique, gardé le temps de valider.

  // Calendrier admin — vue propre (même design que candidat)
  const [adminCalView, setAdminCalView] = useState<"month" | "week">("month");
  const [adminCalDate, setAdminCalDate] = useState(new Date());

  // Legacy (conservé pour compatibilité avec le reste du code)
  const [adminWeekOffset, setAdminWeekOffset] = useState(0);
  const adminWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const currentAdminWeek = addDays(adminWeekStart, adminWeekOffset * 7);

  const fetchEpreuves = useCallback(async () => {
    try {
      const res = await api.get("/epreuves");
      const nonCommune = (res.data || []).filter((e: Epreuve) => !e.isCommune);
      setEpreuves(nonCommune);
      if (nonCommune.length > 0 && !selectedEpreuveId) {
        setSelectedEpreuveId(nonCommune[0].id);
      }
    } catch (e) {
      console.error("Erreur chargement epreuves:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedEpreuveId]);

  const fetchGlobalCalendarEvents = useCallback(async () => {
    try {
      const res = await api.get("/calendar");
      const globals = (res.data || []).filter(
        (ev: any) => ev.is_global === true,
      );
      setGlobalEvents(globals);
    } catch (e) {
      console.error("Erreur global events:", e);
    }
  }, []);

  // Fetch ALL slots (all épreuves) for the global admin overview calendar
  const fetchAllSlotsGlobal = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get("/slots/all");
      setAllSlotsGlobal(res.data || []);
    } catch (e) {
      console.error("Erreur chargement créneaux globaux:", e);
    }
  }, [isAdmin]);

  // Liens de BG de tous les créneaux (admin) : sert à badger le planning et
  // à repérer les groupes qui n'ont pas encore leur lien.
  const fetchSlotLinks = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get("/slots/links");
      setSlotLinks(res.data?.links || {});
      setLinksMigrationPending(res.data?.migrationPending === true);
    } catch (e) {
      console.error("Erreur chargement des liens BG:", e);
      setSlotLinks({});
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchEpreuves();
    fetchGlobalCalendarEvents();
    fetchAllSlotsGlobal();
    fetchSlotLinks();
  }, [fetchEpreuves, fetchGlobalCalendarEvents, fetchAllSlotsGlobal, fetchSlotLinks]);

  // ══════════════════════════════════════════════════════════════════
  // PERSISTANCE : Charger l'état admin depuis les settings au montage
  // ══════════════════════════════════════════════════════════════════
  const fetchAdminSettings = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get("/settings");
      const saisieVal = res.data?.saisie_dispos_ouverte;
      setSaisiOuverte(saisieVal === "true" || saisieVal === true);
      const planningVisibleVal = res.data?.planning_visible_candidats;
      setPlanningVisible(
        planningVisibleVal === "true" || planningVisibleVal === true,
      );
    } catch {
      console.error("Erreur chargement settings admin");
    }
  }, [isAdmin]);

  // Fetch tous les membres pour le sélecteur dans la modale
  const fetchAllMembers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get("/members");
      setAllMembers(
        (res.data || []).map((m: any) => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName || m.first_name || "",
          lastName: m.lastName || m.last_name || "",
        })),
      );
    } catch {
      setAllMembers([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchAdminSettings();
    fetchAllMembers();
  }, [fetchAdminSettings, fetchAllMembers]);

  // Fetch real availability data from API
  const fetchAvailabilityData = useCallback(async () => {
    if (!isAdmin || !selectedEpreuveId) return;
    try {
      const res = await api.get("/availability/all");
      const data: Record<string, number> = {};
      const details: Record<string, any[]> = {};
      // Initialize all cells to 0
      DAYS.forEach((day) => {
        TIME_SLOTS.forEach((slot) => {
          const key = `${day}-${slot}`;
          data[key] = 0;
          details[key] = [];
        });
      });
      // Count availabilities per day/slot
      (res.data || []).forEach((a: any) => {
        const dayMap: Record<string, string> = {
          monday: "Lun",
          tuesday: "Mar",
          wednesday: "Mer",
          thursday: "Jeu",
          friday: "Ven",
          mon: "Lun",
          tue: "Mar",
          wed: "Mer",
          thu: "Jeu",
          fri: "Ven",
        };
        const dayLabel = dayMap[a.weekday?.toLowerCase()] || "";
        if (!dayLabel) return;
        const startHour = parseInt(a.start_time || a.startTime || "0");
        const slotLabel = `${startHour.toString().padStart(2, "0")}h`;
        const key = `${dayLabel}-${slotLabel}`;
        if (data[key] !== undefined) {
          data[key] = (data[key] || 0) + 1;
          details[key].push(a);
        }
      });
      setAvailabilityData(data);
      setAvailabilityDetails(details);
    } catch (e) {
      console.error("Erreur chargement dispos:", e);
      // Fallback to empty data
      const data: Record<string, number> = {};
      const details: Record<string, any[]> = {};
      DAYS.forEach((day) => {
        TIME_SLOTS.forEach((slot) => {
          const key = `${day}-${slot}`;
          data[key] = 0;
          details[key] = [];
        });
      });
      setAvailabilityData(data);
      setAvailabilityDetails(details);
    }
  }, [isAdmin, selectedEpreuveId]);

  // Fetch slots for inscription data + reconstruct repartition from DB
  const fetchSlotData = useCallback(async () => {
    if (!isAdmin || !selectedEpreuveId) return;
    try {
      // Filtre côté SERVEUR : cet appel est rejoué en boucle par le polling.
      // Sans `epreuve`, PostgREST renvoyait les 1000+ créneaux de toutes les
      // épreuves (avec leurs jointures) pour n'en garder qu'une poignée ici.
      const res = await api.get("/slots/all", {
        params: { epreuve: selectedEpreuveId },
      });
      const allSlots = (res.data || []).filter(
        (s: any) =>
          s.epreuve_id === selectedEpreuveId ||
          s.epreuveId === selectedEpreuveId,
      );

      // Stocker les slots bruts pour la répartition persistée
      setExistingSlots(allSlots);

      // Détecter si des inscriptions sont ouvertes (au moins 1 slot published)
      const hasPublished = allSlots.some((s: any) => s.status === "published");
      setInscriptionsOuvertes(hasPublished);

      // Table d'inscriptions (exclure les drafts pour éviter les fantômes)
      const activeSlots = allSlots.filter(
        (s: any) => s.status !== "draft" || s.members?.length > 0,
      );
      const mapped = activeSlots.map((s: any) => {
        const inscrits = s.enrollments?.length || 0;
        const capacite = s.max_candidates || s.maxCandidates || 1;
        const memberCount = s.members?.length || 0;
        let statut = "Disponible";
        if (inscrits >= capacite) statut = "Complet";
        else if (inscrits === 0 && memberCount === 0) statut = "Incomplet";
        return {
          creneau: `${s.start_time || s.startTime || ""} - ${s.end_time || s.endTime || ""}`,
          inscrits,
          capacite,
          statut,
        };
      });
      setInscriptionData(mapped);

      // Reconstruire repartitionResult depuis les slots en base (persistance)
      if (allSlots.length > 0 && !repartitionResult) {
        const assignments = allSlots
          .filter((s: any) => s.members?.length > 0)
          .map((s: any) => ({
            slotId: s.id,
            room: s.room || "Salle",
            day: s.start_time || "",
            time: `${s.start_time || ""} - ${s.end_time || ""}`,
            status: s.status,
            members: (s.members || []).map(
              (m: any) => m.member?.email || m.email || "",
            ),
            enrollments: (s.enrollments || [])
              .map((e: any) =>
                e.candidate
                  ? `${e.candidate.first_name} ${e.candidate.last_name}`
                  : "",
              )
              .filter(Boolean),
          }));

        if (assignments.length > 0) {
          setRepartitionResult({
            fromDB: true,
            summary: {
              totalSlots: allSlots.length,
              totalAssignments: assignments.reduce(
                (sum: number, a: any) => sum + a.members.length,
                0,
              ),
              sallesParCreneau,
              evalParSalle,
              creneauxDisponibles: allSlots.length,
            },
            assignments,
          });
        }
      }
    } catch {
      setInscriptionData([]);
    }
  }, [
    isAdmin,
    selectedEpreuveId,
    repartitionResult,
    sallesParCreneau,
    evalParSalle,
  ]);

  /**
   * Figer / déverrouiller un créneau.
   *
   * Le déverrouillage d'un créneau à candidats inscrits revient avec un 409
   * « confirmation_requise » : on repose alors la question à l'admin avant de
   * renvoyer `force`. Rouvrir un rendez-vous pris au rebrassage de
   * l'algorithme ne doit jamais être un clic anodin.
   */
  const toggleSlotLock = useCallback(
    async (slot: any) => {
      if (!slot?.id) return;
      const next = !slot.is_locked;
      setLockBusyId(slot.id);
      try {
        const send = (force: boolean) =>
          api.post(`/slots/${slot.id}/lock`, { locked: next, force });

        try {
          await send(false);
        } catch (err: any) {
          const data = err?.response?.data;
          if (err?.response?.status === 409 && data?.error === "confirmation_requise") {
            if (!window.confirm(data.message)) return;
            await send(true);
          } else {
            throw err;
          }
        }

        // La modale affiche l'objet créneau reçu au clic : sans cette mise à
        // jour locale, elle continuerait d'afficher l'ancien état du verrou.
        setGlobalDetailSlot((prev: any) =>
          prev?.raw?.id === slot.id
            ? {
                ...prev,
                raw: {
                  ...prev.raw,
                  is_locked: next,
                  locked_reason: next ? "manuel" : null,
                },
              }
            : prev,
        );
        toast(next ? "Créneau figé 🔒" : "Créneau déverrouillé 🔓", "success");
        fetchSlotData();
      } catch (err: any) {
        toast(
          err?.response?.data?.error || "Échec du verrouillage",
          "error",
        );
      } finally {
        setLockBusyId(null);
      }
    },
    [fetchSlotData, toast],
  );

  /**
   * Recharge le créneau ouvert dans la modale après modification du jury.
   *
   * La modale garde une COPIE du créneau prise au clic (raw + compteurs) :
   * sans ce rafraîchissement, ajouter un examinateur ne changerait rien à
   * l'écran tant qu'on ne referme pas le panneau.
   */
  const refreshDetailSlot = useCallback(async (slotId: string) => {
    try {
      const res = await api.get("/slots/all");
      const updated = (res.data || []).find((s: any) => s.id === slotId);
      if (!updated) return;
      setGlobalDetailSlot((prev: any) =>
        prev?.raw?.id === slotId
          ? {
              ...prev,
              raw: updated,
              memberCount: updated.members?.length || 0,
              candCount: updated.enrollments?.length || 0,
              minMembers: updated.min_members || 2,
              maxCands: updated.max_candidates || 1,
            }
          : prev,
      );
    } catch {
      /* le toast d'erreur de l'appelant suffit */
    }
  }, []);

  /**
   * Ouvre le sélecteur d'examinateurs et charge les disponibilités du JOUR
   * du créneau — uniquement ce jour-là : la route /availability/all n'est pas
   * paginée, et PostgREST tronque toute réponse à 1000 lignes sans le dire
   * (cf. supabase-paging.ts). Sur une seule journée on reste très en dessous.
   */
  const openMemberPicker = useCallback(async (slot: any) => {
    setMemberPickerOpen(true);
    setMemberPickerQuery("");
    const day = String(slot?.date || "").substring(0, 10);
    if (!day) return;
    try {
      const res = await api.get(`/availability/all?start=${day}&end=${day}`);
      setDayAvailabilities(res.data || []);
    } catch {
      // Pas de dispos chargées : la liste reste utilisable, tout le monde
      // apparaît simplement dans « non déclarés disponibles ».
      setDayAvailabilities([]);
    }
  }, []);

  /**
   * Ajoute ou retire un examinateur sur un créneau (admin).
   *
   * Côté serveur, une affectation posée par un admin est marquée `is_manual` :
   * le dispatch ne la défera pas au prochain recalcul. Les refus (conflit
   * horaire, autre salle prioritaire en sous-effectif, sur-effectif candidats)
   * reviennent en 409 avec leur explication — on l'affiche telle quelle.
   */
  const toggleMemberOnSlot = useCallback(
    async (slot: any, memberId: string, action: "add" | "remove") => {
      setMemberPickerBusy(memberId);
      try {
        await api.post("/slots/toggle-member", {
          slotId: slot.id,
          memberId,
          action,
        });
        await refreshDetailSlot(slot.id);
        setRepartitionResult(null);
        fetchSlotData();
        fetchAllSlotsGlobal();
        toast(
          action === "add" ? "Examinateur ajouté" : "Examinateur retiré",
          "success",
        );
      } catch (e: any) {
        toast(
          e?.response?.data?.error || "Modification impossible",
          "error",
        );
      } finally {
        setMemberPickerBusy(null);
      }
    },
    [refreshDetailSlot, fetchSlotData, fetchAllSlotsGlobal, toast],
  );

  /**
   * Recherche de candidats à la frappe (250 ms de répit), côté serveur.
   *
   * En dessous de 2 caractères on ne cherche pas : la liste complète des
   * candidats n'a rien à faire dans un sélecteur, et un échantillon
   * arbitraire de 12 noms ne rendrait service à personne.
   */
  useEffect(() => {
    if (!candPickerOpen) return;
    const q = candQuery.trim();
    const slotId = globalDetailSlot?.raw?.id;
    if (q.length < 2 || !slotId) {
      setCandResults([]);
      setCandSearching(false);
      return;
    }
    setCandSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(
          `/candidates/search?q=${encodeURIComponent(q)}&creneauId=${slotId}`,
        );
        // Une réponse lente ne doit pas écraser le résultat d'une frappe
        // plus récente.
        if (!cancelled) setCandResults(res.data?.data || []);
      } catch {
        if (!cancelled) setCandResults([]);
      } finally {
        if (!cancelled) setCandSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candQuery, candPickerOpen, globalDetailSlot?.raw?.id]);

  /**
   * Pose un candidat sur un créneau (admin) — ou l'y DÉPLACE.
   *
   * S'il était déjà inscrit sur un autre créneau de la même épreuve, le
   * serveur libère l'ancien tout seul : c'est l'intention même du geste.
   * Deux refus sont forçables (créneau complet, candidat déjà attendu
   * ailleurs au même moment) — on les pose en question plutôt que de les
   * opposer à l'admin, qui sait souvent pourquoi il insiste.
   */
  const assignCandidateToSlot = useCallback(
    async (slot: any, cand: any) => {
      const name =
        `${cand.first_name || ""} ${cand.last_name || ""}`.trim() || "Ce candidat";

      const attempt = async (force: boolean): Promise<void> => {
        setCandBusy(cand.id);
        try {
          const res = await api.post("/creneaux/affecter-candidat", {
            creneauId: slot.id,
            candidateId: cand.id,
            force,
            notify: candNotify,
          });
          toast(res.data?.message || `${name} inscrit(e)`, "success");
          setCandQuery("");
          setCandResults([]);
          setCandPickerOpen(false);
          await refreshDetailSlot(slot.id);
          setRepartitionResult(null);
          fetchSlotData();
          fetchAllSlotsGlobal();
        } catch (e: any) {
          const data = e?.response?.data;
          const forcable =
            data?.code === "SLOT_FULL" || data?.code === "TIME_CONFLICT";
          if (forcable && !force) {
            setCandBusy(null);
            if (
              window.confirm(
                `${data.error}\n\nInscrire ${name} sur ce créneau quand même ?`,
              )
            ) {
              await attempt(true);
            }
            return;
          }
          toast(data?.error || "Inscription impossible", "error");
        } finally {
          setCandBusy(null);
        }
      };

      await attempt(false);
    },
    [
      candNotify,
      refreshDetailSlot,
      fetchSlotData,
      fetchAllSlotsGlobal,
      toast,
    ],
  );

  /**
   * Retire un candidat d'un créneau (admin), depuis la modale de détail.
   * Le serveur rouvre le créneau et lève le verrou « inscription » si plus
   * personne n'y est attendu.
   */
  const unenrollCandidate = useCallback(
    async (slot: any, candidateId: string, name: string) => {
      if (!window.confirm(`Désinscrire ${name} de ce créneau ?`)) return;
      setCandBusy(candidateId);
      try {
        await api.delete(`/slots/enroll/${slot.id}?candidateId=${candidateId}`);
        await refreshDetailSlot(slot.id);
        setRepartitionResult(null);
        fetchSlotData();
        fetchAllSlotsGlobal();
        toast(`${name} a été désinscrit(e)`, "success");
      } catch (e: any) {
        toast(
          e?.response?.data?.error || "Désinscription impossible",
          "error",
        );
      } finally {
        setCandBusy(null);
      }
    },
    [refreshDetailSlot, fetchSlotData, fetchAllSlotsGlobal, toast],
  );

  // Un autre créneau ouvert, c'est un autre contexte : refermer les éditeurs
  // plutôt que de proposer sur ce créneau-ci la salle saisie pour le précédent
  // ou une recherche de candidat entamée ailleurs.
  useEffect(() => {
    setRoomEditOpen(false);
    setCandPickerOpen(false);
    setCandQuery("");
    setCandResults([]);
  }, [globalDetailSlot?.raw?.id]);

  // Salles proposées pour déplacer le créneau ouvert dans la modale (logique
  // et tests dans room-choices.ts).
  const roomChoices = useMemo(
    () => roomChoicesForSlot(allSlotsGlobal, globalDetailSlot?.raw),
    [allSlotsGlobal, globalDetailSlot],
  );

  /**
   * Déplace un créneau dans une autre salle (admin) — l'horaire ne bouge pas.
   *
   * Les deux côtés du rendez-vous sont prévenus par le serveur : message privé
   * + email aux candidats inscrits, notification + email aux examinateurs
   * affectés. Prévenir les seuls candidats laisserait le jury dans l'ancienne
   * salle. `roomEditNotify` permet la correction silencieuse d'une coquille
   * sur un créneau que personne n'a encore vu.
   *
   * Deux refus possibles côté serveur : la salle d'arrivée a déjà un créneau
   * sur cet horaire (message affiché tel quel) et le créneau est figé — celui-
   * là est une question, pas une erreur : on la pose à l'admin avant de forcer.
   */
  const saveSlotRoom = useCallback(
    async (slot: any) => {
      const room = roomEditValue.trim();
      if (!room) {
        toast("Indiquez une salle", "error");
        return;
      }
      if (room === String(slot.room || "").trim()) {
        setRoomEditOpen(false);
        return;
      }

      const attempt = async (force: boolean): Promise<void> => {
        try {
          const res = await api.put(`/slots/${slot.id}`, {
            room,
            notify: roomEditNotify,
            ...(force ? { force: true } : {}),
          });
          const n = res.data?._notified || {};
          setRoomEditOpen(false);
          await refreshDetailSlot(slot.id);
          setRepartitionResult(null);
          fetchSlotData();
          fetchAllSlotsGlobal();
          const prevenus = [
            n.candidates ? `${n.candidates} candidat(s)` : null,
            n.members ? `${n.members} examinateur(s)` : null,
          ]
            .filter(Boolean)
            .join(" et ");
          // L'échange n'est pas un détail : un second créneau a bougé, et
          // l'admin doit savoir lequel avant de s'étonner de le voir ailleurs.
          const echange = res.data?._swappedWith
            ? ` (échange : le créneau vide de ${room} passe en ${res.data._swappedWith.room})`
            : "";
          toast(
            prevenus
              ? `Salle → ${room}${echange} · ${prevenus} prévenu(s)${n.emails ? `, ${n.emails} email(s) envoyé(s)` : ""}`
              : `Salle → ${room}${echange}`,
            "success",
          );
        } catch (e: any) {
          const data = e?.response?.data;
          if (data?.error === "creneau_fige" && !force) {
            if (window.confirm(`${data.message}\n\nChanger la salle quand même ?`)) {
              return attempt(true);
            }
            return;
          }
          toast(
            data?.error || data?.message || "Changement de salle impossible",
            "error",
          );
        }
      };

      setRoomEditSaving(true);
      try {
        await attempt(false);
      } finally {
        setRoomEditSaving(false);
      }
    },
    [
      roomEditValue,
      roomEditNotify,
      refreshDetailSlot,
      fetchSlotData,
      fetchAllSlotsGlobal,
      toast,
    ],
  );

  /**
   * Pose (ou remplace) le lien du business game ouvert dans la modale.
   *
   * Le serveur revalide l'URL et refuse les créneaux qui ne sont pas des
   * épreuves de groupe : ce qui est fait ici n'est qu'un confort de saisie.
   */
  const saveSlotLink = useCallback(
    async (slot: any) => {
      const url = linkEditUrl.trim();
      if (!url) {
        setLinkError("Indiquez un lien.");
        return;
      }
      setLinkSaving(true);
      setLinkError(null);
      try {
        const res = await api.put(`/slots/${slot.id}/link`, {
          url,
          label: linkEditLabel.trim() || null,
          notify: linkEditNotify,
        });
        const link = res.data?.link;
        setSlotLinks((prev) => ({ ...prev, [slot.id]: link }));
        setLinkEditOpen(false);
        const n = res.data?._notified || 0;
        toast(
          n > 0
            ? `Lien enregistré · ${n} examinateur(s) prévenu(s)`
            : "Lien enregistré",
          "success",
        );
      } catch (e: any) {
        setLinkError(
          e?.response?.data?.error || "Enregistrement du lien impossible",
        );
      } finally {
        setLinkSaving(false);
      }
    },
    [linkEditUrl, linkEditLabel, linkEditNotify, toast],
  );

  /** Retire le lien du créneau. Sans notification : voir DELETE de la route. */
  const removeSlotLink = useCallback(
    async (slot: any) => {
      if (!window.confirm("Retirer le lien de ce business game ?")) return;
      setLinkSaving(true);
      setLinkError(null);
      try {
        await api.delete(`/slots/${slot.id}/link`);
        setSlotLinks((prev) => {
          const next = { ...prev };
          delete next[slot.id];
          return next;
        });
        setLinkEditOpen(false);
        toast("Lien retiré", "success");
      } catch (e: any) {
        setLinkError(
          e?.response?.data?.error || "Suppression du lien impossible",
        );
      } finally {
        setLinkSaving(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    fetchAvailabilityData();
    fetchSlotData();
    // Polling pour voir en temps réel les inscriptions candidats /
    // changements de jury. Toutes les 5s.
    if (isAdmin) {
      // Ces deux appels sont les plus lourds de l'app (le planning complet et
      // toutes les dispos). À 5 s, un seul onglet admin ouvert suffisait à
      // saturer le pool Postgres.
      return startPolling(() => {
        fetchSlotData();
        fetchAvailabilityData();
      }, POLL.planning);
    }
  }, [fetchAvailabilityData, fetchSlotData, isAdmin]);

  // Fetch saisie status + planning status for members
  const fetchSaisieStatus = useCallback(async () => {
    if (isAdmin) return;
    try {
      const res = await api.get("/settings");
      const saisieVal = res.data?.saisie_dispos_ouverte;
      const planningVal = res.data?.planning_generated;
      setSaisieOuverteMember(saisieVal === "true" || saisieVal === true);
      setPlanningGenerated(planningVal === "true" || planningVal === true);
    } catch {
      setSaisieOuverteMember(false);
      setPlanningGenerated(false);
    }
  }, [isAdmin]);

  // Fetch member's assigned slots (emploi du temps)
  const fetchMySlots = useCallback(async () => {
    if (isAdmin) return;
    try {
      const res = await api.get("/slots/my-slots");
      setMySlots(res.data || []);
    } catch {
      setMySlots([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchSaisieStatus();
  }, [fetchSaisieStatus]);

  // Effectif du tour de l'épreuve sélectionnée (candidats attendus / marge),
  // partagé par toutes ses épreuves. Un échec ne doit pas empêcher de
  // travailler : on retombe silencieusement sur "non applicable".
  useEffect(() => {
    const tour = epreuves.find((e) => e.id === selectedEpreuveId)?.tour;
    if (!tour) {
      setTourCapacity({ candidatsAttendus: null, margePct: 25 });
      return;
    }
    let cancelled = false;
    api
      .get(`/tour-settings/${tour}`, { headers: { "Cache-Control": "no-store" } })
      .then((res) => {
        if (cancelled) return;
        setTourCapacity({
          candidatsAttendus: res.data?.candidatsAttendus ?? null,
          margePct: res.data?.margePct ?? 25,
        });
      })
      .catch(() => {
        if (!cancelled) setTourCapacity({ candidatsAttendus: null, margePct: 25 });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEpreuveId, epreuves]);

  // Charger les créneaux assignés au membre dès le montage (sans condition sur la saisie)
  // Ainsi, dès qu'un examinateur s'inscrit ou est assigné, ses créneaux apparaissent.
  // Polling 5s + refresh sur focus pour garder la liste à jour.
  useEffect(() => {
    if (isAdmin) return;
    fetchMySlots();
    return startPolling(fetchMySlots, POLL.planning);
  }, [isAdmin, fetchMySlots]);

  // ── Tour 3 : Obligation de créneaux par pôle ──
  const [tour3Obligation, setTour3Obligation] = useState<any>(null);
  useEffect(() => {
    if (isAdmin) return;
    const fetchObligation = async () => {
      try {
        const res = await api.get("/tour3/obligations");
        setTour3Obligation(res.data);
      } catch {
        // silently ignore
      }
    };
    fetchObligation();
  }, [isAdmin]);

  // Helper: get all selected slots across other épreuves (for anti-doublon)
  const getConflictingSlots = (currentEpreuveId: string): Set<string> => {
    const conflicts = new Set<string>();
    Object.entries(memberAvailabilities).forEach(([epId, slots]) => {
      if (epId === currentEpreuveId) return;
      Object.entries(slots).forEach(([key, selected]) => {
        if (selected) conflicts.add(key);
      });
    });
    return conflicts;
  };

  // Initialize member availabilities per epreuve
  useEffect(() => {
    if (!isAdmin && epreuves.length > 0) {
      const initial: Record<string, SlotAvailability> = {};
      epreuves.forEach((ep) => {
        if (!initial[ep.id]) {
          initial[ep.id] = {};
        }
      });
      setMemberAvailabilities((prev) => ({ ...initial, ...prev }));
    }
  }, [isAdmin, epreuves]);

  const toggleMemberSlot = (epreuveId: string, key: string) => {
    // Anti-doublon: si on essaie de cocher et que le créneau est déjà pris sur une autre épreuve
    const currentlySelected = memberAvailabilities[epreuveId]?.[key] || false;
    if (!currentlySelected) {
      const conflicts = getConflictingSlots(epreuveId);
      if (conflicts.has(key)) {
        toast(
          "Ce creneau est deja selectionne sur une autre epreuve. Vous ne pouvez pas etre a deux endroits en meme temps.",
          "error",
        );
        return;
      }
    }
    setMemberAvailabilities((prev) => ({
      ...prev,
      [epreuveId]: {
        ...(prev[epreuveId] || {}),
        [key]: !currentlySelected,
      },
    }));
  };

  const resetMemberSlots = (epreuveId: string) => {
    setMemberAvailabilities((prev) => ({
      ...prev,
      [epreuveId]: {},
    }));
  };

  const handleSaveMemberAvailability = async (epreuveId: string) => {
    try {
      const slots = memberAvailabilities[epreuveId] || {};
      const selected = Object.entries(slots)
        .filter(([, v]) => v)
        .map(([k]) => {
          const [day, time] = k.split("-");
          const dayMap: Record<string, string> = {
            Lun: "mon",
            Mar: "tue",
            Mer: "wed",
            Jeu: "thu",
            Ven: "fri",
          };
          const hour = parseInt(time);
          return {
            weekday: dayMap[day] || day.toLowerCase(),
            startTime: `${hour.toString().padStart(2, "0")}:00`,
            endTime: `${(hour + 1).toString().padStart(2, "0")}:00`,
          };
        });
      await api.put("/availability", { availabilities: selected });
      toast("Disponibilites enregistrees !", "success");
    } catch (e) {
      console.error("Erreur sauvegarde:", e);
      toast("Erreur lors de la sauvegarde", "error");
    }
  };

  // Admin handlers
  const handleOuvrirSaisieDispos = async () => {
    try {
      await api.put("/settings", { saisie_dispos_ouverte: "true" });
      setSaisiOuverte(true);
      toast("Saisie des disponibilites ouverte", "success");
    } catch {
      toast("Erreur", "error");
    }
  };

  const handleFermerSaisieDispos = async () => {
    try {
      await api.put("/settings", { saisie_dispos_ouverte: "false" });
      setSaisiOuverte(false);
      toast("Saisie des disponibilites fermee", "success");
    } catch {
      toast("Erreur", "error");
    }
  };

  // Publier aux examinateurs : met les créneaux en "open" (visibles)
  // L'allocation auto tourne en arrière-plan à chaque changement de dispo.
  const handleOuvrirInscriptions = async () => {
    if (!selectedEpreuveId) return;
    try {
      // Publier tous les créneaux draft/open de l'épreuve
      const res = await api.get("/slots/all", {
        params: { epreuve: selectedEpreuveId },
      });
      const toPublish = (res.data || []).filter(
        (s: any) =>
          (s.epreuve_id === selectedEpreuveId || s.epreuveId === selectedEpreuveId) &&
          (s.status === "draft" || s.status === "open" || s.status === "ready"),
      );
      if (toPublish.length > 0) {
        await api.put("/slots/status/bulk", {
          slotIds: toPublish.map((s: any) => s.id),
          status: "open",
        });
      }
      // Déclencher l'allocation auto en arrière-plan (sans bloquer l'UX)
      api.post("/dispatch/run", { epreuveId: selectedEpreuveId }).catch(
        (e) => console.warn("dispatch background error:", e),
      );
      setInscriptionsOuvertes(true);
      toast(
        `${toPublish.length} créneau(x) publiés aux examinateurs ✅ — l'algo s'exécute en arrière-plan`,
        "success",
      );
      fetchSlotData();
    } catch (e) {
      console.error(e);
      toast("Erreur lors de la publication", "error");
    }
  };

  const handleFermerInscriptions = async () => {
    if (!selectedEpreuveId) return;
    try {
      // Épreuves de groupe : fusionner les créneaux restés sous le minimum
      // de candidats avant de fermer (no-op pour les autres épreuves).
      let mergeInfo = "";
      try {
        const merge = (force: boolean) =>
          api.post("/slots/merge-undersized", {
            epreuveId: selectedEpreuveId,
            force,
          });

        let mergeRes: { data?: { merged?: number } } | undefined;
        try {
          mergeRes = await merge(false);
        } catch (err: any) {
          // La fusion déplacerait des candidats inscrits sur des créneaux
          // FIGÉS. C'est précisément ce que le verrou promet d'empêcher : on
          // ne le fait plus en silence, l'admin tranche en connaissance de
          // cause. Refuser laisse simplement les créneaux sous-remplis en
          // l'état — la clôture des inscriptions se poursuit.
          const data = err?.response?.data;
          if (err?.response?.status === 409 && data?.error === "creneaux_figes") {
            if (!window.confirm(data.message)) {
              mergeInfo = " · fusion annulée (créneaux figés conservés)";
            } else {
              mergeRes = await merge(true);
            }
          } else {
            throw err;
          }
        }

        const mergedCount = mergeRes?.data?.merged ?? 0;
        if (mergedCount > 0) {
          mergeInfo = ` · ${mergedCount} créneau(x) sous le minimum fusionné(s)`;
        }
      } catch (e) {
        console.error("Erreur fusion créneaux sous-remplis:", e);
      }

      const res = await api.get("/slots/all", {
        params: { epreuve: selectedEpreuveId },
      });
      const publishedSlots = (res.data || []).filter(
        (s: any) =>
          (s.epreuve_id === selectedEpreuveId ||
            s.epreuveId === selectedEpreuveId) &&
          s.status === "published",
      );
      if (publishedSlots.length > 0) {
        await api.put("/slots/status/bulk", {
          slotIds: publishedSlots.map((s: any) => s.id),
          status: "closed",
        });
      }
      setInscriptionsOuvertes(false);
      toast(`${publishedSlots.length} creneau(x) fermes${mergeInfo}`, "success");
      fetchSlotData();
    } catch {
      toast("Erreur fermeture inscriptions", "error");
    }
  };

  // Toggle visibilité du planning aux candidats (masquer / afficher)
  const handleToggleVisibilite = async () => {
    const next = !planningVisible;
    try {
      await api.put("/settings", {
        planning_visible_candidats: next ? "true" : "false",
        ...(next ? { planning_generated: "true" } : {}),
      });
      setPlanningVisible(next);
      toast(
        next
          ? "Planning visible pour les candidats"
          : "Planning masqué — les candidats déjà inscrits restent inscrits",
        "success",
      );
    } catch (error) {
      console.error("Erreur toggle visibilité :", error);
      toast("Erreur lors du basculement", "error");
    }
  };

  // Publier les nouveaux créneaux non encore publiés (status open/draft/ready → published)
  // Ne touche PAS aux créneaux déjà publiés ni à leurs inscriptions existantes.
  const handlePublierNouveaux = async () => {
    if (!selectedEpreuveId) {
      toast("Sélectionnez une épreuve d'abord", "error");
      return;
    }
    try {
      const res = await api.post("/slots/publish-pending", {
        epreuveId: selectedEpreuveId,
      });
      const count = res.data?.published || 0;
      if (count === 0) {
        toast("Aucun nouveau créneau à publier", "info");
      } else {
        toast(
          `${count} nouveau(x) créneau(x) publié(s) et figés 🔒 — l'algorithme n'y touchera plus`,
          "success",
        );
        setPlanningVisible(true);
      }
      fetchSlotData();
      fetchAllSlotsGlobal();
    } catch (error: any) {
      console.error("Erreur publication créneaux :", error);
      toast(error?.response?.data?.error || "Erreur publication", "error");
    }
  };

  const handleRelancer = () => {
    toast(
      "Fonctionnalite de relance par email a configurer (necessite un service email)",
      "info",
    );
  };

  // ══════════════════════════════════════════════════════════════════
  // Réinitialiser tous les créneaux pour l'épreuve sélectionnée
  // ══════════════════════════════════════════════════════════════════
  const handleResetSlots = async () => {
    if (!selectedEpreuveId) return;
    setResetLoading(true);
    try {
      // Envoyer uniquement l'epreuveId — le serveur se charge de retrouver ET supprimer TOUS les créneaux
      const res = await api.post("/slots/reset", {
        epreuveId: selectedEpreuveId,
      });
      const deleted = res.data?.deleted || 0;
      const availsDeleted = res.data?.availabilities_deleted || 0;
      setRepartitionResult(null);
      setExistingSlots([]);
      setAllSlotsGlobal([]);
      setInscriptionData([]);
      setShowResetConfirm(false);
      toast(
        `${deleted} créneau(x) et ${availsDeleted} disponibilité(s) supprimé(s)`,
        "success",
      );
      fetchSlotData();
      fetchAllSlotsGlobal();
    } catch (e) {
      console.error("Erreur reset:", e);
      toast("Erreur lors de la réinitialisation", "error");
    } finally {
      setResetLoading(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // Échange de deux examinateurs entre deux créneaux (salles)
  // ══════════════════════════════════════════════════════════════════
  const swapAssignments = useMemo(() => {
    const list: {
      key: string;
      slotId: string;
      memberId: string;
      epreuveId: string;
      name: string;
      label: string;
    }[] = [];
    allSlotsGlobal.forEach((s: any) => {
      (s.members || []).forEach((m: any) => {
        const mem = m.member || {};
        const memberId = m.member_id || mem.id;
        if (!memberId) return;
        const name =
          `${mem.first_name || ""} ${mem.last_name || ""}`.trim() ||
          mem.email?.split("@")[0] ||
          "Examinateur";
        const day = new Date(s.date).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
        });
        const hours = `${String(s.start_time || "").substring(0, 5)}–${String(s.end_time || "").substring(0, 5)}`;
        list.push({
          key: `${s.id}:${memberId}`,
          slotId: s.id,
          memberId,
          epreuveId: s.epreuve_id,
          name,
          label: `${name} — ${s.room || "sans salle"} · ${s.epreuve?.name || "Épreuve"} · ${day} ${hours}`,
        });
      });
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [allSlotsGlobal]);

  const swapA = swapAssignments.find((a) => a.key === swapAKey) || null;
  // Même épreuve obligatoire (règle appliquée aussi côté serveur) : on ne
  // propose que des échanges que l'API acceptera.
  const swapBOptions = swapA
    ? swapAssignments.filter(
        (a) =>
          a.epreuveId === swapA.epreuveId &&
          a.slotId !== swapA.slotId &&
          a.memberId !== swapA.memberId,
      )
    : [];

  const handleSwapMembers = async () => {
    const b = swapAssignments.find((a) => a.key === swapBKey);
    if (!swapA || !b) return;
    setSwapLoading(true);
    try {
      await api.post("/slots/swap-members", {
        slotAId: swapA.slotId,
        memberAId: swapA.memberId,
        slotBId: b.slotId,
        memberBId: b.memberId,
      });
      toast(`${swapA.name} et ${b.name} ont été échangés`, "success");
      setSwapOpen(false);
      setSwapAKey("");
      setSwapBKey("");
      fetchAllSlotsGlobal();
      fetchSlotData();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Échange impossible", "error");
    } finally {
      setSwapLoading(false);
    }
  };

  const handleRepartir = async () => {
    if (!selectedEpreuveId) {
      toast("Selectionnez une epreuve", "error");
      return;
    }

    setRepartitionLoading(true);
    setRepartitionResult(null);

    try {
      const res = await api.post("/dispatch/run", {
        epreuveId: selectedEpreuveId,
      });

      const data = res.data;

      if (data.updated === 0 && data.backupsAssigned === 0) {
        toast(
          "Aucun changement lors du dispatch (créneaux déjà remplis ou manque d'examinateurs)",
          "info",
        );
      } else {
        toast(
          `Dispatch terminé : ${data.updated} affectations titulaires, ${data.backupsAssigned} backups assignés`,
          "success",
        );
      }

      // Refresh slot data
      fetchSlotData();
      fetchAvailabilityData();
    } catch (e) {
      console.error("Erreur repartition:", e);
      toast("Erreur lors de la repartition automatique", "error");
    } finally {
      setRepartitionLoading(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "400px",
        }}
      >
        <p className="text-gray-400 text-sm">Chargement...</p>
      </div>
    );
  }

  // ===================== ADMIN VIEW =====================
  if (isAdmin) {
    const capacite = sallesParCreneau * evalParSalle;

    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Dispos &amp; Inscriptions
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Gérez le recrutement global et les épreuves
            </p>
          </div>
          {ModeToggle}
        </div>

        {/* Créneaux sans leur compte d'examinateurs — priorité aux créneaux
            où un candidat est déjà inscrit (cf. UnderstaffedBanner). */}
        <UnderstaffedBanner
          slots={allSlotsGlobal}
          onRecalculated={() => {
            fetchSlotData();
            fetchAvailabilityData();
          }}
        />

        {/* ══════════════════════════════════════════════════════════════════
                    CALENDRIER ADMINISTRATEUR GLOBAL — design unifié
                    ══════════════════════════════════════════════════════════════════ */}
        {(() => {
          // ── Helpers calendrier ──────────────────────────────────────────
          const ADMIN_DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
          const ADMIN_MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
          const acYear = adminCalDate.getFullYear();
          const acMonth = adminCalDate.getMonth();
          const today = new Date();

          const prevPeriod = () => {
            if (adminCalView === "month") setAdminCalDate(new Date(acYear, acMonth - 1, 1));
            else { const d = new Date(adminCalDate); d.setDate(d.getDate() - 7); setAdminCalDate(d); }
          };
          const nextPeriod = () => {
            if (adminCalView === "month") setAdminCalDate(new Date(acYear, acMonth + 1, 1));
            else { const d = new Date(adminCalDate); d.setDate(d.getDate() + 7); setAdminCalDate(d); }
          };

          // Grille mois
          const daysInMonth = new Date(acYear, acMonth + 1, 0).getDate();
          const rawFirst = new Date(acYear, acMonth, 1).getDay();
          const firstDay = rawFirst === 0 ? 6 : rawFirst - 1;
          const cells: (number | null)[] = [];
          for (let i = 0; i < firstDay; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          while (cells.length % 7 !== 0) cells.push(null);

          // Semaine courante (lundi → dim)
          const getWeekDates = () => {
            const d = new Date(adminCalDate);
            const dow = d.getDay();
            const diff = dow === 0 ? -6 : 1 - dow;
            const mon = new Date(d); mon.setDate(d.getDate() + diff);
            return Array.from({ length: 7 }, (_, i) => { const w = new Date(mon); w.setDate(mon.getDate() + i); return w; });
          };
          const weekDates = getWeekDates();

          // Mapper tous les événements en format unifié
          const toDateStr = (raw: string | undefined) => {
            if (!raw) return "";
            const d = new Date(raw);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          };

          interface AdminEv { id: string; date: string; title: string; startTime?: string; bg: string; textColor: string; dotColor: string; kind: "slot"|"global"; raw: any; }
          const allAdminEvents: AdminEv[] = [];

          // Slots
          allSlotsGlobal.forEach((s: any) => {
            const memberCount = s.members?.length || 0;
            const candCount = s.enrollments?.length || 0;
            const minMembers = s.min_members || s.minMembers || 2;
            const maxCands = s.max_candidates || s.maxCandidates || 1;
            let bg = "#D1FAE5"; let dot = "#16A34A"; let txt = "#064E3B"; let icon = "🟢";
            // Priorité au sous-effectif SUR UN CRÉNEAU À CANDIDATS : un
            // rendez-vous pris qui n'a pas son jury passe avant un créneau
            // simplement pas rempli (spec 2026-09-11).
            if (memberCount === 0 && candCount > 0) { bg = "#FECACA"; dot = "#B91C1C"; txt = "#7F1D1D"; icon = "⚠️"; }
            else if (memberCount < minMembers && candCount > 0) { bg = "#FDE68A"; dot = "#B45309"; txt = "#78350F"; icon = "🟠"; }
            else if (memberCount === 0) { bg = "#EDE9FE"; dot = "#7C3AED"; txt = "#3B0764"; icon = "🟣"; }
            else if (candCount < maxCands) { bg = "#FEE2E2"; dot = "#DC2626"; txt = "#7F1D1D"; icon = "🔴"; }
            else if (memberCount < minMembers) { bg = "#FEF3C7"; dot = "#D97706"; txt = "#78350F"; icon = "🟠"; }
            // Cadenas : ce créneau est figé, ni le dispatch ni une édition
            // manuelle ne le feront bouger (cf. slot-lock.ts).
            const lockMark = s.is_locked ? "🔒 " : "";
            // 🔗 : ce business game a son lien. Son absence sur un créneau de
            // groupe se voit donc d'un coup d'œil, sans ouvrir la modale.
            const linkMark = slotLinks[s.id] ? "🔗 " : "";
            allAdminEvents.push({
              id: `slot-${s.id}`,
              date: toDateStr(s.date),
              title: `${lockMark}${linkMark}${s.epreuve?.name || "Épreuve"} · ${s.room || "Salle ?"}`,
              startTime: (s.start_time || "").substring(0, 5),
              bg, textColor: txt, dotColor: dot, kind: "slot", raw: s,
            });
          });

          // Événements globaux (+ multi-jours étendus)
          globalEvents.forEach((ev: any) => {
            const isHidden = ev.visible_to_candidates === false;
            const bg = isHidden ? "#F1F5F9" : (ev.color || "#DBEAFE");
            const dot = isHidden ? "#94A3B8" : (ev.color || "#2563EB");
            const txt = isHidden ? "#64748B" : "#1E3A8A";
            const startDate = toDateStr(ev.day);
            const endDate = ev.day_end ? toDateStr(ev.day_end) : startDate;

            if (endDate && endDate !== startDate) {
              const s = new Date(startDate + "T00:00:00");
              const e = new Date(endDate + "T00:00:00");
              let cur = new Date(s);
              while (cur <= e) {
                const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
                allAdminEvents.push({ id: `evt-${ev.id}-${ds}`, date: ds, title: `📌 ${ev.title}${isHidden?" (masqué)":""}`, startTime: (ev.start_time||"").substring(0,5), bg, textColor: txt, dotColor: dot, kind:"global", raw: ev });
                cur.setDate(cur.getDate() + 1);
              }
            } else {
              allAdminEvents.push({ id:`evt-${ev.id}`, date: startDate, title:`📌 ${ev.title}${isHidden?" (masqué)":""}`, startTime:(ev.start_time||"").substring(0,5), bg, textColor: txt, dotColor: dot, kind:"global", raw: ev });
            }
          });

          const getEventsForDay = (dateStr: string) => allAdminEvents.filter(e => e.date === dateStr).sort((a,b) => (a.startTime||"").localeCompare(b.startTime||""));
          const dateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          const isToday = (d: Date) => d.toDateString() === today.toDateString();

          const weekLabel = `${weekDates[0].toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} — ${weekDates[6].toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}`;

          const handleEvClick = (ev: AdminEv) => {
            // Le sélecteur d'examinateur appartient au créneau qu'on quitte :
            // le laisser ouvert l'afficherait sur le suivant, avec les dispos
            // de la mauvaise journée.
            setMemberPickerOpen(false);
            // Même raison pour l'éditeur de lien : ouvert, il afficherait
            // l'URL du créneau qu'on vient de quitter.
            setLinkEditOpen(false);
            if (ev.kind === "slot") {
              const s = ev.raw;
              const mc = s.members?.length||0, cc=s.enrollments?.length||0;
              const mm=s.min_members||s.minMembers||2, mx=s.max_candidates||s.maxCandidates||1;
              setGlobalDetailSlot({ kind:"slot", raw:s, memberCount:mc, candCount:cc, minMembers:mm, maxCands:mx, event:{ start: new Date(`${ev.date}T${ev.startTime||"09:00"}`) } });
            } else {
              setGlobalDetailSlot({ kind:"global", raw:ev.raw, event:{ start: new Date(`${ev.date}T${ev.startTime||"09:00"}`) } });
            }
          };

          return (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  <span className="text-xl">🗺️</span> Vue Globale du Recrutement
                  <span className="text-xs font-normal text-gray-400 ml-1">— clic pour détails</span>
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setSwapOpen(true)}
                    className="px-3 py-1.5 min-h-[36px] text-sm font-medium rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    title="Échanger deux examinateurs de salle"
                  >
                    ⇄ Échanger
                  </button>
                  <div className="flex bg-gray-100 rounded-full p-0.5">
                    {(["month","week"] as const).map(m => (
                      <button key={m} onClick={() => setAdminCalView(m)} className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${adminCalView===m?"bg-white text-gray-900 shadow-sm":"text-gray-500 hover:text-gray-700"}`}>
                        {m === "month" ? "Mois" : "Semaine"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={prevPeriod} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors">‹</button>
                <span className="text-sm sm:text-base font-semibold text-gray-900 flex-1 sm:flex-none sm:min-w-[200px] text-center">
                  {adminCalView === "month" ? `${ADMIN_MONTHS[acMonth]} ${acYear}` : weekLabel}
                </span>
                <button onClick={nextPeriod} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors">›</button>
                <button onClick={() => setAdminCalDate(new Date())} className="ml-1 sm:ml-2 shrink-0 px-3 py-1.5 min-h-[36px] text-xs font-medium bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors">Aujourd&apos;hui</button>
              </div>

              {/* Légende */}
              <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" />Aucun examinateur</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Manque candidat(s)</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Examinateurs &lt; min</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Tout OK</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />Événement global</span>
              </div>

              {allSlotsGlobal.length === 0 && globalEvents.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400 border border-dashed border-gray-200 rounded-xl">
                  <p className="text-sm">Aucun créneau ou événement généré.</p>
                </div>
              ) : (
                <>
                  {/* VUE MOIS */}
                  {adminCalView === "month" && (
                    <div className="bg-white border border-gray-200 rounded-xl scroll-x sm:overflow-x-auto">
                      {/* Sur mobile la grille se compacte pour tenir dans la largeur
                          de l'écran ; le détail d'un créneau s'ouvre au tap. */}
                      <div className="grid grid-cols-7 border-b border-gray-200 min-w-0 sm:min-w-[640px]">
                        {ADMIN_DAYS.map(d => (
                          <div key={d} className="py-2 sm:py-2.5 text-center text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            <span className="sm:hidden">{d.slice(0, 1)}</span>
                            <span className="hidden sm:inline">{d}</span>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 min-w-0 sm:min-w-[640px]">
                        {cells.map((day, i) => {
                          const ds = day ? `${acYear}-${String(acMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}` : "";
                          const dayEvs = day ? getEventsForDay(ds) : [];
                          const todayDay = day && today.getFullYear()===acYear && today.getMonth()===acMonth && today.getDate()===day;
                          return (
                            <div key={i} className={`min-h-[72px] sm:min-h-[90px] border-b border-r border-gray-100 p-0.5 sm:p-1.5 ${day===null?"bg-gray-50/50":"bg-white"} ${i%7===6?"border-r-0":""}`}>
                              {day !== null && (
                                <>
                                  <div className={`text-xs sm:text-sm font-medium mb-0.5 sm:mb-1 w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full ${todayDay?"bg-blue-600 text-white":"text-gray-700"}`}>{day}</div>
                                  <div className="space-y-0.5">
                                    {dayEvs.slice(0,3).map(ev => (
                                      <button key={ev.id} onClick={() => handleEvClick(ev)}
                                        className="w-full text-left text-[9px] sm:text-[10px] leading-tight px-1 sm:px-1.5 py-0.5 rounded sm:rounded-md truncate font-medium transition-opacity hover:opacity-80"
                                        style={{ backgroundColor: ev.bg, color: ev.textColor }}
                                        title={ev.title}
                                      >
                                        {ev.startTime && <span className="font-bold">{ev.startTime} </span>}
                                        {/* Le libellé ne tient pas dans une case de 50px. */}
                                        <span className="hidden sm:inline">{ev.title}</span>
                                      </button>
                                    ))}
                                    {dayEvs.length > 3 && (
                                      <p className="text-[9px] sm:text-[10px] text-gray-400 px-1">+{dayEvs.length-3}<span className="hidden sm:inline"> autres</span></p>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* VUE SEMAINE */}
                  {adminCalView === "week" && (
                    <div className="bg-white border border-gray-200 rounded-xl scroll-x sm:overflow-x-auto">
                      {/* Sept colonnes sont illisibles sur un iPhone : la semaine
                          se déroule verticalement, un bloc par jour. */}
                      <div className="grid grid-cols-1 sm:grid-cols-7 sm:min-w-[640px]">
                        {weekDates.map((wd, i) => {
                          const ds = dateStr(wd);
                          const dayEvs = getEventsForDay(ds);
                          const todayWd = isToday(wd);
                          return (
                            <div key={i} className="border-b sm:border-b-0 sm:border-r border-gray-100 last:border-b-0 sm:last:border-r-0">
                              <div className={`p-2 sm:p-3 flex sm:block items-baseline gap-2 border-b border-gray-200 sm:text-center ${todayWd?"bg-blue-50":"bg-gray-50"}`}>
                                <p className="text-xs font-semibold text-gray-500 uppercase">{ADMIN_DAYS[i]}</p>
                                <p className={`text-lg sm:text-xl font-bold sm:mt-0.5 ${todayWd?"text-blue-600":"text-gray-900"}`}>{wd.getDate()}</p>
                                <p className="text-xs text-gray-400">{wd.toLocaleDateString("fr-FR",{month:"short"})}</p>
                              </div>
                              <div className="p-2 min-h-[64px] sm:min-h-[180px] space-y-1.5">
                                {dayEvs.length === 0 && <p className="text-xs text-gray-300 text-center mt-4">—</p>}
                                {dayEvs.map(ev => (
                                  <button key={ev.id} onClick={() => handleEvClick(ev)}
                                    className="w-full text-left p-2 rounded-lg text-xs transition-all hover:shadow-sm border border-transparent"
                                    style={{ backgroundColor: ev.bg, color: ev.textColor }}
                                  >
                                    <p className="font-semibold truncate">{ev.title}</p>
                                    {ev.startTime && <p className="mt-0.5 opacity-80">{ev.startTime}</p>}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* Modal échange de deux examinateurs entre salles */}
        {swapOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setSwapOpen(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">
                  ⇄ Échanger deux examinateurs
                </h2>
                <button
                  onClick={() => setSwapOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="p-5 space-y-4 text-sm">
                <p className="text-xs text-gray-500">
                  Les deux examinateurs permutent de créneau. Les candidats,
                  les horaires et les autres examinateurs ne bougent pas.
                </p>

                <div>
                  <label className="block text-xs uppercase text-gray-400 mb-1.5">
                    Examinateur 1
                  </label>
                  <select
                    value={swapAKey}
                    onChange={(e) => {
                      setSwapAKey(e.target.value);
                      setSwapBKey("");
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Sélectionner…</option>
                    {swapAssignments.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase text-gray-400 mb-1.5">
                    Examinateur 2
                  </label>
                  <select
                    value={swapBKey}
                    onChange={(e) => setSwapBKey(e.target.value)}
                    disabled={!swapA}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="">
                      {swapA
                        ? "Sélectionner…"
                        : "Choisissez d'abord l'examinateur 1"}
                    </option>
                    {swapBOptions.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  {swapA && swapBOptions.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      Aucun autre créneau de la même épreuve n&apos;a
                      d&apos;examinateur à échanger.
                    </p>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  onClick={() => setSwapOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSwapMembers}
                  disabled={!swapAKey || !swapBKey || swapLoading}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {swapLoading ? "Échange…" : "Échanger"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal détail créneau (vue globale admin) */}
        {globalDetailSlot && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => { setGlobalDetailSlot(null); setMemberPickerOpen(false); setRoomEditOpen(false); setLinkEditOpen(false); }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {globalDetailSlot.kind === "global" ? (() => {
                const raw = globalDetailSlot.raw;
                const isVisible = raw.visible_to_candidates !== false;
                const hasEndDay = !!raw.day_end;
                return (
                  <div className="p-5 border-b border-gray-100 bg-blue-50">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-blue-900 flex items-center gap-2">📌 Événement global</h2>
                      <button onClick={() => { setGlobalDetailSlot(null); setMemberPickerOpen(false); setRoomEditOpen(false); setLinkEditOpen(false); }} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
                    </div>
                    <p className="text-sm font-semibold text-gray-800 mt-3">{raw.title}</p>
                    {raw.description && (
                      <p className="text-xs text-gray-600 mt-2">{raw.description}</p>
                    )}
                    {/* Date range */}
                    <p className="text-xs text-blue-700 mt-3">
                      {hasEndDay ? (
                        <>
                          {new Date(raw.day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                          {" → "}
                          {new Date(raw.day_end).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                        </>
                      ) : (
                        globalDetailSlot.event.start?.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
                      )}
                    </p>
                    {hasEndDay && (raw.start_time || raw.startTime) && (
                      <p className="text-xs text-blue-600 mt-1">
                        Horaire quotidien : {(raw.start_time || raw.startTime || "").slice(0, 5)} - {(raw.end_time || raw.endTime || "").slice(0, 5)}
                      </p>
                    )}
                    {/* Visibility badge */}
                    <div className="mt-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        isVisible
                          ? "bg-green-100 text-green-700 border border-green-200"
                          : "bg-red-100 text-red-700 border border-red-200"
                      }`}>
                        {isVisible ? "👁️ Visible par les candidats" : "🙈 Masqué pour les candidats"}
                      </span>
                    </div>
                  </div>
                );
              })() : (() => {
                const s = globalDetailSlot.raw;
                const memberCount = globalDetailSlot.memberCount;
                const candCount = globalDetailSlot.candCount;
                const minMembers = globalDetailSlot.minMembers;
                const maxCands = globalDetailSlot.maxCands;
                let headerColor = "bg-green-50 text-green-900"; let icon = "🟢"; let label = "Tout OK";
                // Un candidat déjà inscrit sur un créneau en sous-effectif prime
                // sur tout le reste : c'est un rendez-vous pris qui risque de ne
                // pas se tenir. Sans cette priorité, le cas se cachait derrière
                // « Manque candidat(s) » (spec 2026-09-11).
                if (memberCount === 0 && candCount > 0) { headerColor = "bg-red-100 text-red-900"; icon = "⚠️"; label = `CRITIQUE — ${candCount} candidat(s) inscrit(s), aucun examinateur`; }
                else if (memberCount < minMembers && candCount > 0) { headerColor = "bg-amber-50 text-amber-900"; icon = "🟠"; label = `Sous-effectif — ${memberCount}/${minMembers} examinateur(s) pour ${candCount} candidat(s) inscrit(s)`; }
                else if (memberCount === 0) { headerColor = "bg-purple-100 text-purple-900"; icon = "🟣"; label = "Aucun examinateur"; }
                else if (candCount < maxCands) { headerColor = "bg-red-50 text-red-900"; icon = "🔴"; label = "Manque candidat(s)"; }
                else if (memberCount < minMembers) { headerColor = "bg-orange-50 text-orange-900"; icon = "🟠"; label = "Examinateurs insuffisants"; }
                return (
                  <>
                    <div className={`p-5 border-b border-gray-100 ${headerColor}`}>
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold flex items-center gap-2">
                          {icon} {s.epreuve?.name || "Créneau"}
                        </h2>
                        <button onClick={() => { setGlobalDetailSlot(null); setMemberPickerOpen(false); setRoomEditOpen(false); setLinkEditOpen(false); }} className="opacity-60 hover:opacity-100 text-2xl leading-none">×</button>
                      </div>
                      <p className="text-xs mt-1 opacity-80">{label}</p>
                    </div>
                    <div className="p-5 space-y-3 text-sm">
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Date</span>
                        <span className="font-medium text-gray-800 capitalize">
                          {new Date(s.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Horaire</span>
                        <span className="font-medium text-gray-800">{(s.start_time || "").substring(0, 5)} – {(s.end_time || "").substring(0, 5)}</span>
                      </div>
                      {/* ── SALLE ──
                          Modifiable ici même : c'est dans cette modale qu'on
                          constate qu'une salle est incohérente (deux épreuves
                          au même endroit, salle finalement indisponible),
                          c'est donc ici qu'on doit pouvoir la corriger, sans
                          rouvrir l'ouverture ni relancer le dispatch. */}
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Salle</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-800">{s.room || "—"}</span>
                            {isAdmin && (
                              <button
                                onClick={() => {
                                  if (roomEditOpen) { setRoomEditOpen(false); return; }
                                  setRoomEditValue(s.room || "");
                                  setRoomEditCustom(false);
                                  setRoomEditNotify(true);
                                  setRoomEditOpen(true);
                                }}
                                className="text-xs px-2 py-0.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                                title="Changer la salle de ce créneau"
                              >
                                {roomEditOpen ? "Annuler" : "✏️ Changer"}
                              </button>
                            )}
                          </div>

                          {isAdmin && roomEditOpen && (
                            <div className="mt-2 border border-gray-200 rounded-lg p-2.5 bg-gray-50 space-y-2">
                              <select
                                value={roomEditCustom ? "__custom__" : roomEditValue}
                                onChange={(e) => {
                                  if (e.target.value === "__custom__") {
                                    setRoomEditCustom(true);
                                    setRoomEditValue("");
                                  } else {
                                    setRoomEditCustom(false);
                                    setRoomEditValue(e.target.value);
                                  }
                                }}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
                              >
                                <option value="">— Choisir une salle —</option>
                                {roomChoices.day.length > 0 && (
                                  <optgroup label="Salles utilisées ce jour-là">
                                    {roomChoices.day.map((r) => (
                                      <option key={r.room} value={r.room} disabled={r.busy}>
                                        {r.room}
                                        {r.busy ? " — occupée à cet horaire" : ""}
                                        {r.swap ? " — libre (échange de salles)" : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {roomChoices.others.length > 0 && (
                                  <optgroup label="Autres salles du planning">
                                    {roomChoices.others.map((r) => (
                                      <option key={r} value={r}>{r}</option>
                                    ))}
                                  </optgroup>
                                )}
                                <option value="__custom__">Autre salle…</option>
                              </select>

                              {roomEditCustom && (
                                <input
                                  autoFocus
                                  value={roomEditValue}
                                  onChange={(e) => setRoomEditValue(e.target.value)}
                                  placeholder="Nom de la salle (ex. 204)"
                                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5"
                                />
                              )}

                              {/* La salle visée porte un créneau vide au même
                                  horaire : on permute, personne n'est déplacé. */}
                              {roomChoices.day.find((r) => r.room === roomEditValue)?.swap && (
                                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-2 py-1.5">
                                  🔄 La salle {roomEditValue} a un créneau vide sur cet horaire :
                                  les deux salles seront échangées. Ce créneau vide prendra la salle {s.room || "—"}.
                                </p>
                              )}

                              {/* Personne sur le créneau : rien à décider, la
                                  case ne ferait que suggérer un envoi qui
                                  n'aura pas lieu. Sinon, décocher = correction
                                  silencieuse d'une coquille encore invisible. */}
                              {candCount + memberCount === 0 ? (
                                <p className="text-xs text-gray-500">
                                  Aucun candidat ni examinateur sur ce créneau — personne à prévenir.
                                </p>
                              ) : (
                                <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={roomEditNotify}
                                    onChange={(e) => setRoomEditNotify(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  <span>
                                    Prévenir{candCount > 0 ? ` ${candCount} candidat(s)` : ""}
                                    {candCount > 0 && memberCount > 0 ? " et" : ""}
                                    {memberCount > 0 ? ` ${memberCount} examinateur(s)` : ""}
                                    <span className="text-gray-400"> — message + email, l&apos;horaire ne change pas</span>
                                  </span>
                                </label>
                              )}

                              <button
                                onClick={() => saveSlotRoom(s)}
                                disabled={roomEditSaving || !roomEditValue.trim()}
                                className="w-full bg-blue-600 text-white text-sm font-medium rounded-md py-1.5 hover:bg-blue-700 disabled:opacity-40 transition-colors"
                              >
                                {roomEditSaving ? "Changement…" : "Changer la salle"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Tour</span>
                        <span className="font-medium text-gray-800">Tour {s.tour || s.epreuve?.tour || "?"}</span>
                      </div>
                      {/* VERROU — pourquoi ce créneau ne bouge plus. Le motif
                          est affiché en clair : sans lui, « figé » laisse
                          deviner s'il s'agit d'une publication, d'une
                          inscription ou d'une décision manuelle. */}
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Verrou</span>
                        {s.is_locked ? (
                          <span className="font-medium text-amber-700 flex items-center gap-1">
                            🔒 Figé <span className="text-xs text-gray-500">— {lockReasonLabel(s.locked_reason)}</span>
                          </span>
                        ) : (
                          <span className="font-medium text-gray-500">Libre — l&apos;algorithme peut réaffecter les examinateurs</span>
                        )}
                      </div>
                      {/* ── LIEN DU BUSINESS GAME ──
                          Déposé ici par l'admin, servi aux SEULS examinateurs
                          affectés à ce créneau (/api/slots/my-slots part de
                          leurs affectations). Ni les candidats, ni les
                          examinateurs des autres groupes n'y ont accès — le
                          lien vit dans sa propre table, qu'aucun select("*")
                          sur les créneaux ne ramasse. */}
                      {s.epreuve?.is_group_epreuve === true && (() => {
                        const link = slotLinks[s.id];
                        return (
                          <div className="flex items-start gap-3">
                            <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Lien BG</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {link ? (
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-blue-700 hover:underline truncate max-w-[220px]"
                                    title={link.url}
                                  >
                                    🔗 {link.label || slotLinkHost(link.url) || "Lien"}
                                  </a>
                                ) : (
                                  <span className="font-medium text-gray-500">Aucun lien</span>
                                )}
                                {isAdmin && (
                                  <button
                                    onClick={() => {
                                      if (linkEditOpen) { setLinkEditOpen(false); return; }
                                      setLinkEditUrl(link?.url || "");
                                      setLinkEditLabel(link?.label || "");
                                      setLinkEditNotify(true);
                                      setLinkError(null);
                                      setLinkEditOpen(true);
                                    }}
                                    className="text-xs px-2 py-0.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                                    title="Lien réservé aux examinateurs de ce créneau"
                                  >
                                    {linkEditOpen ? "Annuler" : link ? "✏️ Modifier" : "+ Ajouter"}
                                  </button>
                                )}
                              </div>

                              {isAdmin && linkEditOpen && (
                                <div className="mt-2 border border-gray-200 rounded-lg p-2.5 bg-gray-50 space-y-2">
                                  <input
                                    autoFocus
                                    value={linkEditUrl}
                                    onChange={(e) => setLinkEditUrl(e.target.value)}
                                    placeholder="https://drive.google.com/…"
                                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5"
                                  />
                                  <input
                                    value={linkEditLabel}
                                    onChange={(e) => setLinkEditLabel(e.target.value)}
                                    placeholder="Libellé affiché (facultatif) — ex. Sujet du BG"
                                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5"
                                  />

                                  {memberCount === 0 ? (
                                    <p className="text-xs text-gray-500">
                                      Aucun examinateur sur ce créneau — personne à prévenir. Le lien attendra le jury.
                                    </p>
                                  ) : (
                                    <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={linkEditNotify}
                                        onChange={(e) => setLinkEditNotify(e.target.checked)}
                                        className="mt-0.5"
                                      />
                                      <span>
                                        Prévenir les {memberCount} examinateur(s) du créneau
                                        <span className="text-gray-400"> — notification in-app</span>
                                      </span>
                                    </label>
                                  )}

                                  <p className="text-xs text-gray-500">
                                    🔒 Visible uniquement par les examinateurs affectés à ce créneau — ni les candidats, ni les autres groupes.
                                  </p>

                                  {linkError && (
                                    <p className="text-xs text-red-600">{linkError}</p>
                                  )}

                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => saveSlotLink(s)}
                                      disabled={linkSaving || !linkEditUrl.trim()}
                                      className="flex-1 bg-blue-600 text-white text-sm font-medium rounded-md py-1.5 hover:bg-blue-700 disabled:opacity-40 transition-colors"
                                    >
                                      {linkSaving ? "Enregistrement…" : "Enregistrer le lien"}
                                    </button>
                                    {link && (
                                      <button
                                        onClick={() => removeSlotLink(s)}
                                        disabled={linkSaving}
                                        className="px-3 text-sm font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                                      >
                                        Retirer
                                      </button>
                                    )}
                                  </div>

                                  {linksMigrationPending && (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                                      ⚠️ Migration <code>supabase-migration-bg-links.sql</code> pas encore appliquée : l&apos;enregistrement échouera tant que la table n&apos;existe pas.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <hr className="my-2" />
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs uppercase text-gray-400">Examinateurs ({memberCount}/{minMembers}+)</p>
                          {isAdmin && (
                            <button
                              onClick={() => (memberPickerOpen ? setMemberPickerOpen(false) : openMemberPicker(s))}
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                                memberPickerOpen
                                  ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                  : "bg-blue-600 text-white hover:bg-blue-700"
                              }`}
                              title={memberPickerOpen ? "Fermer" : "Ajouter un examinateur"}
                            >
                              {memberPickerOpen ? "×" : "+"}
                            </button>
                          )}
                        </div>
                        {memberCount === 0 ? (
                          <p className="text-purple-700 text-sm italic">Aucun examinateur assigné</p>
                        ) : (
                          <ul className="space-y-1">
                            {(s.members || []).map((m: any, idx: number) => {
                              const mem = m.member || {};
                              const name = mem.firstName || mem.first_name
                                ? `${mem.firstName || mem.first_name} ${mem.lastName || mem.last_name || ""}`.trim()
                                : mem.email?.split("@")[0] || "Inconnu";
                              const mid = mem.id || m.member_id;
                              return (
                                <li key={idx} className="flex items-center gap-2 text-gray-800 group">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                                  <span className="flex-1">{name} <span className="text-xs text-gray-400">{mem.email}</span></span>
                                  {/* Contrepartie du « + » : défaire un ajout
                                      fait par erreur sans quitter la modale.
                                      Le serveur refuse les retraits qui
                                      laisseraient un candidat sans jury. */}
                                  {isAdmin && mid && (
                                    <button
                                      onClick={() => {
                                        if (!window.confirm(`Retirer ${name} de ce créneau ?`)) return;
                                        toggleMemberOnSlot(s, mid, "remove");
                                      }}
                                      disabled={memberPickerBusy === mid}
                                      className="transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 text-red-500 hover:text-red-700 text-xs px-2 py-1 min-h-[32px] min-w-[32px] rounded hover:bg-red-50 flex-shrink-0 disabled:opacity-40"
                                      title="Retirer cet examinateur"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {/* ── Sélecteur d'examinateur ──
                            Les membres réellement disponibles sur ce créneau
                            sont listés en premier, avec la MÊME règle que le
                            dispatch (availabilityMatchesSlot) : sans ça,
                            « disponible » dans cette liste et « disponible »
                            pour l'algorithme ne voudraient pas dire la même
                            chose. Les autres restent proposés en dessous —
                            l'admin peut forcer, le serveur refusera seulement
                            les vrais conflits d'horaire. */}
                        {isAdmin && memberPickerOpen && (() => {
                          const assignedIds = new Set(
                            (s.members || []).map((m: any) => m.member?.id || m.member_id),
                          );
                          const q = memberPickerQuery.trim().toLowerCase();
                          const matches = (m: any) =>
                            !q ||
                            `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q);

                          const availableIds = new Set(
                            dayAvailabilities
                              .filter((av: any) => availabilityMatchesSlot(av, s))
                              .map((av: any) => av.member_id),
                          );

                          const pool = allMembers
                            .filter((m) => !assignedIds.has(m.id) && matches(m))
                            .sort((a, b) =>
                              `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
                            );
                          const dispo = pool.filter((m) => availableIds.has(m.id));
                          const autres = pool.filter((m) => !availableIds.has(m.id));

                          const row = (m: any, isDispo: boolean) => (
                            <button
                              key={m.id}
                              onClick={() => toggleMemberOnSlot(s, m.id, "add")}
                              disabled={memberPickerBusy === m.id}
                              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-blue-50 flex items-center gap-2 text-sm disabled:opacity-40"
                            >
                              <span className={isDispo ? "text-green-600" : "text-gray-300"}>
                                {isDispo ? "✓" : "○"}
                              </span>
                              <span className="flex-1 truncate">
                                {`${m.firstName} ${m.lastName}`.trim() || m.email}
                              </span>
                              <span className="text-blue-600 font-bold">+</span>
                            </button>
                          );

                          return (
                            <div className="mt-3 border border-gray-200 rounded-lg p-2 bg-gray-50">
                              <input
                                autoFocus
                                value={memberPickerQuery}
                                onChange={(e) => setMemberPickerQuery(e.target.value)}
                                placeholder="Rechercher un membre…"
                                className="w-full text-sm px-2 py-1.5 rounded-md border border-gray-300 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <div className="max-h-56 overflow-y-auto">
                                {dispo.length > 0 && (
                                  <>
                                    <p className="text-[11px] uppercase text-green-700 font-semibold px-2 py-1">
                                      Disponibles sur ce créneau ({dispo.length})
                                    </p>
                                    {dispo.map((m) => row(m, true))}
                                  </>
                                )}
                                {autres.length > 0 && (
                                  <>
                                    <p className="text-[11px] uppercase text-gray-400 font-semibold px-2 py-1 mt-1">
                                      Non déclarés disponibles ({autres.length})
                                    </p>
                                    {autres.map((m) => row(m, false))}
                                  </>
                                )}
                                {pool.length === 0 && (
                                  <p className="text-sm text-gray-500 italic px-2 py-2">
                                    Aucun membre ne correspond.
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs uppercase text-gray-400">Candidats ({candCount}/{maxCands})</p>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                setCandPickerOpen(!candPickerOpen);
                                setCandQuery("");
                                setCandResults([]);
                              }}
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                                candPickerOpen
                                  ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                  : "bg-green-600 text-white hover:bg-green-700"
                              }`}
                              title={candPickerOpen ? "Fermer" : "Inscrire / déplacer un candidat"}
                            >
                              {candPickerOpen ? "×" : "+"}
                            </button>
                          )}
                        </div>
                        {candCount === 0 ? (
                          <p className="text-red-700 text-sm italic">Aucun candidat inscrit</p>
                        ) : (
                          <ul className="space-y-1">
                            {(s.enrollments || []).map((e: any, idx: number) => {
                              const c = e.candidate || {};
                              const name = `${c.first_name || c.firstName || ""} ${c.last_name || c.lastName || ""}`.trim() || "Candidat";
                              const cid = c.id || e.candidate_id;
                              return (
                                <li key={idx} className="flex items-center gap-2 text-gray-800 group">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                                  <span className="flex-1">{name}</span>
                                  {isAdmin && cid && (
                                    <button
                                      onClick={() => unenrollCandidate(s, cid, name)}
                                      disabled={candBusy === cid}
                                      className="transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 text-red-500 hover:text-red-700 text-xs px-2 py-1 min-h-[32px] min-w-[32px] rounded hover:bg-red-50 flex-shrink-0 disabled:opacity-40"
                                      title="Désinscrire ce candidat"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {/* ── Sélecteur de candidat ──
                            On CHERCHE, on ne feuillette pas : plusieurs
                            centaines de candidats, et l'admin en vise un
                            précis. Chaque résultat indique où le candidat est
                            attendu aujourd'hui pour CETTE épreuve — sans
                            cette ligne, on déplacerait à l'aveugle sans
                            savoir ce qu'on défait. */}
                        {isAdmin && candPickerOpen && (
                          <div className="mt-3 border border-gray-200 rounded-lg p-2 bg-gray-50">
                            <input
                              autoFocus
                              value={candQuery}
                              onChange={(ev) => setCandQuery(ev.target.value)}
                              placeholder="Rechercher un candidat (nom, prénom, email)…"
                              className="w-full text-sm px-2 py-1.5 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <label className="flex items-start gap-2 text-xs text-gray-600 mt-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={candNotify}
                                onChange={(ev) => setCandNotify(ev.target.checked)}
                                className="mt-0.5"
                              />
                              <span>
                                Prévenir le candidat
                                <span className="text-gray-400"> — message + email avec son nouveau créneau</span>
                              </span>
                            </label>

                            <div className="max-h-56 overflow-y-auto mt-2">
                              {candQuery.trim().length < 2 ? (
                                <p className="text-xs text-gray-500 italic px-2 py-2">
                                  Tapez au moins 2 caractères pour chercher.
                                </p>
                              ) : candSearching ? (
                                <p className="text-xs text-gray-500 italic px-2 py-2">Recherche…</p>
                              ) : candResults.length === 0 ? (
                                <p className="text-sm text-gray-500 italic px-2 py-2">
                                  Aucun candidat ne correspond.
                                </p>
                              ) : (
                                candResults.map((c: any) => {
                                  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email;
                                  const cur = c.current;
                                  const curLabel = cur
                                    ? `${new Date(String(cur.date).substring(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${String(cur.start_time || "").substring(0, 5)}${cur.room ? ` · ${cur.room}` : ""}`
                                    : null;
                                  return (
                                    <button
                                      key={c.id}
                                      onClick={() => assignCandidateToSlot(s, c)}
                                      disabled={candBusy === c.id || c.here}
                                      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-green-50 flex items-center gap-2 text-sm disabled:opacity-40 disabled:hover:bg-transparent"
                                      title={c.here ? "Déjà sur ce créneau" : "Inscrire sur ce créneau"}
                                    >
                                      <span className="flex-1 min-w-0">
                                        <span className="block truncate">{name}</span>
                                        <span className="block text-[11px] text-gray-500 truncate">
                                          {c.here
                                            ? "déjà sur ce créneau"
                                            : curLabel
                                              ? `actuellement : ${curLabel}`
                                              : "aucun créneau sur cette épreuve"}
                                        </span>
                                      </span>
                                      <span className="text-green-600 font-bold flex-shrink-0">
                                        {c.here ? "✓" : curLabel ? "→" : "+"}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2">
                        {isAdmin && (
                          <button
                            onClick={() => toggleSlotLock(s)}
                            disabled={lockBusyId === s.id}
                            className={`text-xs px-3 py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-50 ${
                              s.is_locked
                                ? "bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
                            }`}
                            title={
                              s.is_locked
                                ? "Rendre ce créneau à l'algorithme"
                                : "Empêcher toute réaffectation sur ce créneau"
                            }
                          >
                            {lockBusyId === s.id
                              ? "…"
                              : s.is_locked
                                ? "🔓 Déverrouiller"
                                : "🔒 Figer ce créneau"}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const dateStr = String(s.date || "").substring(0, 10);
                            const tStart = String(s.start_time || "08:00").substring(0, 5);
                            const tEnd = String(s.end_time || "09:00").substring(0, 5);
                            const evName = s.epreuve?.name || "Épreuve";
                            
                            const evData = {
                              id: s.id || "slot",
                              title: `${evName} - ${s.room || "Salle"}`,
                              description: `Épreuve: ${evName}\nTour: ${s.tour || s.epreuve?.tour || "?"}\nSalle: ${s.room || "—"}`,
                              location: s.room || "—",
                              startDate: new Date(`${dateStr}T${tStart}:00`),
                              endDate: new Date(`${dateStr}T${tEnd}:00`)
                            };
                            
                            const icsContent = generateICS(evData);
                            downloadICS(icsContent, `creneau_${evName.replace(/\s+/g, "_")}.ics`);
                          }}
                          className="text-xs px-3 py-1.5 rounded-md font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm transition-all"
                        >
                          📅 Ajouter à mon calendrier
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        <hr className="my-2 border-gray-200" />

        {/* Combien de créneaux sont réellement staffés (≥ min examinateurs),
            par épreuve — réponse directe à « combien j'en ai vraiment ? »
            sans avoir à compter salle par salle dans le calendrier. */}
        <EpreuveSlotsSummary />

        {/* Vue globale des inscrits (examinateurs + candidats), filtrable —
            complète le clic-sur-créneau du calendrier de contrôle, qui ne
            montre qu'UN créneau à la fois. */}
        <EnrollmentsTable
          epreuves={epreuves.map((e) => ({ id: e.id, name: e.name, tour: e.tour }))}
        />

        {/* Epreuve selector pour le paramétrage */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Configuration d&apos;une Epreuve
          </label>
          <select
            className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={selectedEpreuveId}
            onChange={(e) => {
              setSelectedEpreuveId(e.target.value);
              setRepartitionResult(null);
              setActiveTab("creation");
            }}
          >
            <option value="">-- Sélectionner une épreuve --</option>
            {epreuves.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name} — {ep.type} (Tour {ep.tour})
              </option>
            ))}
          </select>
        </div>

        {selectedEpreuveId ? (
          <>
            {/* TABS DE VUES */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 mb-2 rounded-lg w-fit">
              <button
                onClick={() => setActiveTab("creation")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeTab === "creation"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                }`}
              >
                🛠️ Création
              </button>
              {inscriptionsOuvertes && (
                <button
                  onClick={() => setActiveTab("evaluators")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === "evaluators"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  👥 Planning Évaluateurs
                </button>
              )}
              {planningVisible && (
                <button
                  onClick={() => setActiveTab("candidates")}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === "candidates"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  🎓 Suivi Candidats
                </button>
              )}
            </div>

            {/* Ouvertures de salles : l'admin déclare les plages, le système
                découpe en créneaux — le calendrier devient une vue de contrôle.
                Ancien formulaire (fenêtre par fenêtre, prompt() pour la salle)
                retiré après validation : la grille par bandes couvre tout ce
                qu'il faisait, en plus rapide (cf. docs/superpowers/specs/
                2026-09-09-refonte-creneaux-bandes-design.md). */}
            {activeTab === "creation" && (
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <h3 className="mb-4 text-base font-semibold text-gray-900">
                  Ouverture des salles
                </h3>

                {!selectedEpreuveId ? (
                  <p className="text-sm text-gray-500">
                    Sélectionnez une épreuve pour déclarer ses ouvertures de salles.
                  </p>
                ) : (
                  <>
                    {(() => {
                      const courante = epreuves.find((e) => e.id === selectedEpreuveId);
                      if (!courante) return null;
                      const memeTour = epreuves.filter(
                        (e) => e.tour === courante.tour && !e.isCommune,
                      );
                      if (memeTour.length < 2) return null;
                      return (
                        <TourOpeningsPanel
                          tour={courante.tour}
                          epreuves={memeTour.map((e) => ({
                            id: e.id,
                            name: e.name,
                            isGroupEpreuve: !!e.isGroupEpreuve,
                            durationMinutes:
                              e.durationMinutes ?? e.duration_minutes ?? 30,
                            roulementMinutes:
                              e.roulementMinutes ?? e.roulement_minutes ?? 10,
                            minEvaluatorsPerSalle:
                              (e as any).minEvaluatorsPerSalle ??
                              (e as any).min_evaluators_per_salle ??
                              (e.isGroupEpreuve ? 4 : 2),
                            groupSize: (e as any).groupSize ?? null,
                            minCandidates: (e as any).minCandidates ?? null,
                            dateDebut: e.dateDebut ?? null,
                          }))}
                          onSaved={() => {
                            fetchSlotData();
                            fetchAllSlotsGlobal();
                            setCalRefreshKey((k) => k + 1);
                          }}
                        />
                      );
                    })()}
                    <RoomOpeningsGrid
                    key={selectedEpreuveId}
                    epreuveId={selectedEpreuveId}
                    epreuveName={
                      epreuves.find((e) => e.id === selectedEpreuveId)?.name
                    }
                    dateDebut={
                      epreuves.find((e) => e.id === selectedEpreuveId)?.dateDebut
                    }
                    candidatsAttendus={tourCapacity.candidatsAttendus}
                    margePct={tourCapacity.margePct}
                    isGroupEpreuve={
                      epreuves.find((e) => e.id === selectedEpreuveId)
                        ?.isGroupEpreuve
                    }
                    // Courbe « C » : ce qu'un effectif permet de tenir. Le
                    // besoin en collectif vient de l'épreuve de groupe
                    // configurée ; l'individuel de l'épreuve courante.
                    evaluatorsPerGroupRoom={
                      (epreuves.find((e) => e.isGroupEpreuve) as any)
                        ?.minEvaluatorsPerSalle ?? 4
                    }
                    evaluatorsPerIndividualRoom={(() => {
                      // Le repli individuel doit se mesurer sur une épreuve
                      // INDIVIDUELLE. Prendre l'épreuve courante donnait 4
                      // partout quand on ouvrait les salles d'un business
                      // game — le repli devenait alors identique au collectif
                      // et ne voulait plus rien dire.
                      const courante = epreuves.find(
                        (e) => e.id === selectedEpreuveId,
                      ) as any;
                      if (courante && !courante.isGroupEpreuve) {
                        return courante.minEvaluatorsPerSalle ?? 2;
                      }
                      const individuelle = epreuves.find(
                        (e) => !e.isGroupEpreuve,
                      ) as any;
                      return individuelle?.minEvaluatorsPerSalle ?? 2;
                    })()}
                    durationMinutes={
                      epreuves.find((e) => e.id === selectedEpreuveId)
                        ?.durationMinutes ?? 30
                    }
                    roulementMinutes={
                      epreuves.find((e) => e.id === selectedEpreuveId)
                        ?.roulementMinutes ?? 10
                    }
                    groupSize={
                      epreuves.find((e) => e.id === selectedEpreuveId)?.groupSize
                    }
                    minCandidates={
                      (epreuves.find((e) => e.id === selectedEpreuveId) as any)
                        ?.minCandidates
                    }
                    onSaved={() => {
                      fetchSlotData();
                      fetchAllSlotsGlobal();
                      setCalRefreshKey((k) => k + 1);
                    }}
                  />
                  </>
                )}
              </div>
            )}

            <CalendarAdminBuilder
              selectedEpreuveId={selectedEpreuveId}
              epreuve={epreuves.find((e) => e.id === selectedEpreuveId)}
              toast={toast}
              viewMode={activeTab}
              refreshKey={calRefreshKey}
            />

            {/* ══════════════════════════════════════════════════════════════════
                            PANNEAU DE CONTRÔLE DU WORKFLOW
                            ══════════════════════════════════════════════════════════════════ */}
            {/* ═══ ALERTE CRITIQUE : créneaux publiés sans examinateur ═══ */}
            {(() => {
              const criticalSlots = inscriptionData.filter(
                (s: any) =>
                  (s.status === "open" || s.status === "ready" || s.status === "published") &&
                  (!s.members || s.members.length === 0),
              );
              if (criticalSlots.length === 0) return null;
              return (
                <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">🚨</span>
                  <div>
                    <p className="text-sm font-bold text-red-800">
                      Alerte critique — {criticalSlots.length} créneau(x) sans aucun examinateur
                    </p>
                    <p className="text-xs text-red-600 mt-1">
                      Ces créneaux sont publiés mais aucun examinateur n&apos;est affecté. Des candidats pourraient s&apos;y inscrire sans jury.
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {criticalSlots.slice(0, 5).map((s: any) => (
                        <li key={s.id} className="text-xs text-red-700 font-medium">
                          · {s.date ? new Date(s.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "—"} {String(s.start_time || "").slice(0,5)} — {s.room || "?"}
                        </li>
                      ))}
                      {criticalSlots.length > 5 && (
                        <li className="text-xs text-red-500 italic">...et {criticalSlots.length - 5} autres</li>
                      )}
                    </ul>
                  </div>
                </div>
              );
            })()}

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">
                🚦 Gestion du workflow
              </h3>
              <p className="text-xs text-gray-500 mb-5">
                Créez les créneaux, publiez-les aux examinateurs, puis aux candidats.
              </p>

              {/* Workflow steps */}
              <div className="space-y-4">
                {/* BOUTON 1 — Publier aux examinateurs */}
                <div className={`flex items-center justify-between p-4 rounded-xl border ${inscriptionsOuvertes ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${inscriptionsOuvertes ? "bg-blue-200 text-blue-800" : "bg-gray-200 text-gray-600"}`}>
                      1
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Publier aux examinateurs</p>
                      <p className="text-xs text-gray-500">
                        {inscriptionsOuvertes
                          ? `✅ Publiés — examinateurs inscrivent leurs dispos · l'algo sélectionne le nombre d'examinateurs requis par créneau automatiquement`
                          : "⏸️ Créneaux non publiés — les examinateurs ne voient rien"}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <button
                      onClick={handleOuvrirInscriptions}
                      disabled={!selectedEpreuveId || existingSlots.length === 0}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {inscriptionsOuvertes ? "Republier aux examinateurs" : "Publier aux examinateurs"}
                    </button>
                  </div>
                </div>

                {/* BOUTON 2 — Publier les nouveaux créneaux aux candidats */}
                <div className="p-4 rounded-xl border bg-purple-50/40 border-purple-200">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold bg-purple-200 text-purple-800">
                        2
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">Publier les nouveaux créneaux</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Publie les créneaux non encore publiés. Les candidats déjà inscrits ne sont pas affectés.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handlePublierNouveaux}
                      className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors flex-shrink-0"
                    >
                      Publier
                    </button>
                  </div>

                  {/* Toggle visibilité du planning */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-gray-200">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{planningVisible ? "👁️" : "🙈"}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          Planning {planningVisible ? "visible" : "masqué"} aux candidats
                        </p>
                        <p className="text-xs text-gray-500">
                          {planningVisible
                            ? "Les candidats voient et peuvent s'inscrire"
                            : "Les inscriptions existantes sont préservées"}
                        </p>
                      </div>
                    </div>
                    {/* Toggle switch */}
                    <button
                      onClick={handleToggleVisibilite}
                      role="switch"
                      aria-checked={planningVisible}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                        planningVisible ? "bg-purple-600" : "bg-gray-300"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          planningVisible ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Résumé rapide */}
              <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>
                  {existingSlots.length} créneau(x) créé(s) pour cette épreuve
                </span>
                {existingSlots.length > 0 && (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="text-red-500 hover:text-red-700 hover:underline transition-colors"
                  >
                    Réinitialiser créneaux et inscriptions
                  </button>
                )}
              </div>
            </div>

            {/* Confirmation de réinitialisation */}
            {showResetConfirm && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-red-800">
                    Supprimer tous les créneaux ?
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Cette action supprimera {existingSlots.length} créneau(x),
                    toutes les inscriptions et affectations associées.
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleResetSlots}
                    disabled={resetLoading}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {resetLoading
                      ? "Suppression..."
                      : "Confirmer la suppression"}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-gray-500">
            Veuillez selectionner une epreuve ci-dessus pour configurer son
            planning.
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
                    RÈGLE 5 : Événements globaux (visibles par tous les candidats)
                    ══════════════════════════════════════════════════════════════════ */}
        <GlobalEventsAdmin toast={toast} onUpdate={fetchGlobalCalendarEvents} />
      </div>
    );
  }

  // ===================== MEMBER VIEW =====================

  // Helpers pour l'emploi du temps
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const jours = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const mois = [
      "jan.",
      "fev.",
      "mar.",
      "avr.",
      "mai",
      "juin",
      "juil.",
      "aout",
      "sep.",
      "oct.",
      "nov.",
      "dec.",
    ];
    return `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]}`;
  };

  const formatTime = (t: string) => {
    if (!t) return "";
    // Accepte "09:00", "09:00:00", "9"
    const parts = t.split(":");
    return `${parts[0].padStart(2, "0")}h${parts[1] ? parts[1] : "00"}`;
  };

  // Grouper les slots par date pour l'affichage calendrier
  const slotsByDate = mySlots.reduce<Record<string, MySlot[]>>((acc, slot) => {
    const dateKey = slot.date?.split("T")[0] || "unknown";
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(slot);
    return acc;
  }, {});

  const sortedDates = Object.keys(slotsByDate).sort();

  // Couleurs par épreuve (cycle)
  const epreuveColors = [
    "#3B82F6",
    "#8B5CF6",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#EC4899",
  ];
  const getEpreuveColor = (epreuveName: string) => {
    let hash = 0;
    for (let i = 0; i < epreuveName.length; i++) {
      hash = epreuveName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return epreuveColors[Math.abs(hash) % epreuveColors.length];
  };

  // ── TOUJOURS : grille d'inscription + emploi du temps si assigné ──
  // La saisie est permanente : l'examinateur voit les créneaux et
  // peut s'inscrire / se désinscrire à tout moment.
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">

      {ModeToggle && (
        <div className="flex justify-end">{ModeToggle}</div>
      )}

      {/* ─── Bannière obligation Tour 3 ─── */}
      {tour3Obligation?.myObligation && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-lg">🏆</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Obligation Tour 3 — Pôle {tour3Obligation.myObligation.pole}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {tour3Obligation.myObligation.candidatsCount} candidat(s) ont demandé votre pôle
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-6 flex-wrap">
              {/* Jauge visuelle */}
              <div className="flex-1 min-w-[200px]">
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-600 font-medium">Créneaux requis pour le pôle</span>
                  <span className="font-bold text-gray-900">{tour3Obligation.myObligation.creneauxRequis}</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (mySlots.filter(s => s.epreuve?.tour === "3").length / Math.max(1, tour3Obligation.myObligation.creneauxParMembre)) * 100)}%`,
                      backgroundColor: mySlots.filter(s => s.epreuve?.tour === "3").length >= tour3Obligation.myObligation.creneauxParMembre ? '#22C55E' : '#F59E0B'
                    }}
                  />
                </div>
              </div>
              {/* Stats */}
              <div className="flex gap-4 text-center">
                <div className="px-4 py-2 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-xl font-bold text-blue-700">{tour3Obligation.myObligation.creneauxParMembre}</p>
                  <p className="text-[10px] text-blue-500 font-medium">MIN. par membre</p>
                </div>
                <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xl font-bold text-gray-700">{tour3Obligation.myObligation.membresCount}</p>
                  <p className="text-[10px] text-gray-500 font-medium">Membre(s) du pôle</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Cochez vos disponibilités ci-dessous pour couvrir au minimum {tour3Obligation.myObligation.creneauxParMembre} créneau(x).
            </p>
          </div>
        </div>
      )}

      {/* ─── Grille de disponibilités (identique à ce que voit un membre) ─── */}
      <MemberAvailabilityGrid />

      {/* ─── Emploi du temps (créneaux déjà assignés) ─── */}
      {mySlots.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Mon emploi du temps ({mySlots.length} créneau{mySlots.length > 1 ? "x" : ""} assigné{mySlots.length > 1 ? "s" : ""})
            </h2>
            <button
              onClick={fetchMySlots}
              className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors border border-gray-200"
            >
              Actualiser
            </button>
          </div>
          <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <span className="text-base mt-0.5">📅</span>
            <p className="text-sm text-blue-800">
              Créneaux où vous avez été sélectionné(e) comme évaluateur.
            </p>
          </div>
        </>
      )}

      {mySlots.length === 0 ? (
        <div className="hidden" />
      ) : (
        <div className="space-y-4">
          {sortedDates.map((dateKey) => {
            const daySlots = slotsByDate[dateKey].sort((a, b) =>
              (a.start_time || "").localeCompare(b.start_time || ""),
            );

            return (
              <div
                key={dateKey}
                className="bg-white rounded-xl border border-gray-200 shadow-sm"
              >
                {/* Date header */}
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 rounded-t-xl">
                  <h2 className="text-sm font-semibold text-gray-700">
                    {formatDate(dateKey)}
                  </h2>
                </div>

                {/* Slots de cette journée */}
                <div className="divide-y divide-gray-50">
                  {daySlots.map((slot) => {
                    const color = getEpreuveColor(
                      slot.epreuve?.name || "default",
                    );
                    const candidateNames = (slot.enrollments || [])
                      .map((e) =>
                        `${e.candidate?.first_name || ""} ${e.candidate?.last_name || ""}`.trim(),
                      )
                      .filter(Boolean);

                    const hasCandidates = candidateNames.length > 0;

                    // Code couleur basé sur le statut d'affectation du membre
                    // courant sur ce créneau (vert = confirmé, orange = en
                    // attente, rouge = surplus / peu probable d'être retenu).
                    const myStatus = getMyAssignmentStatus(slot, user?.id);
                    const sideColor = myStatus.side;

                    return (
                      <div
                        key={slot.id}
                        onClick={() => setSelectedSlot(slot)}
                        className={`flex items-stretch cursor-pointer hover:bg-gray-50/50 transition-colors ${myStatus.cardClass}`}
                      >
                        {/* Barre latérale colorée */}
                        <div
                          style={{
                            width: 4,
                            backgroundColor: sideColor,
                            borderRadius: "0 4px 4px 0",
                            flexShrink: 0,
                          }}
                        />

                        <div className="flex-1 px-5 py-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              {/* Horaire + épreuve + statut */}
                              <div className="flex items-center flex-wrap gap-3 mb-1.5">
                                <span className={`text-sm font-semibold ${myStatus.timeClass}`}>
                                  {formatTime(slot.start_time)} -{" "}
                                  {formatTime(slot.end_time)}
                                </span>
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    backgroundColor: "#f3f4f6",
                                    color: "#4b5563",
                                    border: "1px solid #e5e7eb",
                                  }}
                                >
                                  {slot.epreuve?.name || "Epreuve"}
                                </span>
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                  style={{
                                    backgroundColor: myStatus.badgeBg,
                                    color: myStatus.badgeText,
                                    border: `1px solid ${myStatus.badgeBorder}`,
                                  }}
                                >
                                  {myStatus.label}
                                </span>
                              </div>

                              {/* Salle */}
                              <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span className="flex items-center gap-1">
                                  <span>🏫</span> {slot.room || "Non definie"}
                                </span>

                                {/* Candidat(s) */}
                                {candidateNames.length > 0 && (
                                  <span className="flex items-center gap-1">
                                    <span>👤</span> {candidateNames.join(", ")}
                                  </span>
                                )}

                                {/* Lien du BG : un repère sur la carte, le
                                    lien cliquable est dans la modale. Sans
                                    lui, l'examinateur n'a aucune raison
                                    d'ouvrir le détail pour aller le chercher. */}
                                {slot.link && (
                                  <span className="flex items-center gap-1 text-blue-600 font-medium">
                                    <span>🔗</span>{" "}
                                    {slot.link.label || "Lien du BG"}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Chevron pour indiquer cliquable */}
                            <div className="flex items-center text-gray-300 ml-3">
                              <svg
                                width="20"
                                height="20"
                                viewBox="0 0 20 20"
                                fill="none"
                              >
                                <path
                                  d="M7 5L12 10L7 15"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════ MODALE DE DETAILS ══════════════ */}
      {selectedSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end"
          onClick={() => setSelectedSlot(null)}
        >
          {/* Overlay sombre */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Side panel */}
          <div
            className="relative w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "slideInRight 0.25s ease-out" }}
          >
            {/* Header modale */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold text-gray-900">
                Details du creneau
              </h2>
              <button
                onClick={() => setSelectedSlot(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M5 5L15 15M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* ── Horaire ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">🕐</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Horaire
                  </p>
                  <p className="text-base font-semibold text-gray-900">
                    {formatTime(selectedSlot.start_time)} -{" "}
                    {formatTime(selectedSlot.end_time)}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {formatDate(selectedSlot.date)}
                  </p>
                </div>
              </div>

              {/* ── Épreuve ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">📝</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Epreuve
                  </p>
                  <p className="text-base font-semibold text-gray-900">
                    {selectedSlot.epreuve?.name || "Non definie"}
                  </p>
                  <div className="flex gap-2 mt-1.5">
                    {selectedSlot.epreuve?.type && (
                      <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-200">
                        {selectedSlot.epreuve.type}
                      </span>
                    )}
                    {selectedSlot.epreuve?.tour && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium border border-gray-200">
                        Tour {selectedSlot.epreuve.tour}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Salle ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">🏫</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Salle
                  </p>
                  <p className="text-base font-semibold text-gray-900">
                    {selectedSlot.room || "Non definie"}
                  </p>
                </div>
              </div>

              {/* ── Lien du business game ──
                  Il n'arrive jusqu'ici que parce que ce créneau fait partie
                  des affectations de l'examinateur connecté : la réponse de
                  /api/slots/my-slots ne contient que les siens. */}
              {selectedSlot.link && (
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg">🔗</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                      Lien du business game
                    </p>
                    <a
                      href={selectedSlot.link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base font-semibold text-blue-700 hover:underline break-all"
                    >
                      {selectedSlot.link.label ||
                        slotLinkHost(selectedSlot.link.url) ||
                        selectedSlot.link.url}
                    </a>
                    <p className="text-xs text-gray-400 mt-1">
                      Réservé aux examinateurs de ce créneau — ne pas le transmettre aux candidats.
                    </p>
                  </div>
                </div>
              )}

              {/* ── Candidat(s) à évaluer ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">👤</span>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Candidat(s) a evaluer
                  </p>
                  {(selectedSlot.enrollments || []).length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      Aucun candidat inscrit sur ce creneau
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(selectedSlot.enrollments || []).map(
                        (enrollment, idx) => {
                          const cand = enrollment.candidate || {};
                          const fullName = `${cand.first_name || ""} ${cand.last_name || ""}`.trim() || "Candidat";
                          const cid = cand.id;
                          return (
                            <div key={idx} className="flex items-center gap-2 group">
                              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-xs font-semibold text-amber-700 flex-shrink-0">
                                {(cand.first_name?.[0] || "?").toUpperCase()}
                                {(cand.last_name?.[0] || "").toUpperCase()}
                              </div>
                              <span className="text-sm font-medium text-gray-800 flex-1">
                                {fullName}
                              </span>
                              {isAdmin && cid && (
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Désinscrire ${fullName} de ce créneau ?`)) return;
                                    try {
                                      await api.delete(`/slots/enroll/${selectedSlot.id}?candidateId=${cid}`);
                                      setSelectedSlot(null);
                                      fetchSlotData();
                                    } catch (err: any) {
                                      alert(err?.response?.data?.error || "Erreur lors de la désinscription");
                                    }
                                  }}
                                  className="transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 text-xs text-red-500 hover:text-red-700 px-2 py-1.5 min-h-[36px] rounded hover:bg-red-50 border border-red-200 flex-shrink-0"
                                >
                                  Désinscrire
                                </button>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Examinateurs (titulaires + remplaçants) ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">👥</span>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Examinateur(s)
                  </p>
                  {(() => {
                    const minMembers =
                      (selectedSlot as any).min_members ||
                      (selectedSlot as any).minMembers ||
                      2;
                    // Ordre d'inscription (created_at) → titulaires d'abord
                    const ordered = [...(selectedSlot.members || [])].sort(
                      (a: any, b: any) =>
                        String(a.created_at || "").localeCompare(
                          String(b.created_at || ""),
                        ),
                    );
                    const titulaires = ordered.slice(0, minMembers);
                    // On n'affiche qu'un ou deux remplaçants éventuels
                    const remplacants = ordered.slice(minMembers, minMembers + 2);

                    if (ordered.length === 0) {
                      return (
                        <p className="text-sm text-gray-400 italic">
                          Aucun examinateur sur ce creneau
                        </p>
                      );
                    }

                    const renderRow = (m: any, isRempl: boolean) => {
                      const member = m.member || {};
                      const mine = member?.id === user?.id;
                      return (
                        <div key={m.id || member?.id} className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${isRempl ? "bg-gray-100 text-gray-500" : "bg-indigo-100 text-indigo-700"}`}
                          >
                            {(member?.email?.[0] || "?").toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-gray-800">
                            {member?.email || "Membre"}
                            {mine && (
                              <span className="ml-1 text-xs text-indigo-500">
                                (vous)
                              </span>
                            )}
                          </span>
                          {isRempl && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                              Remplaçant
                            </span>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div className="space-y-2">
                        {titulaires.map((m: any) => renderRow(m, false))}
                        {remplacants.length > 0 && (
                          <>
                            <p className="text-[10px] uppercase text-gray-400 pt-1">
                              Remplaçant(s) éventuel(s)
                            </p>
                            {remplacants.map((m: any) => renderRow(m, true))}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* ── Statut ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">📊</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Statut
                  </p>
                  <span
                    className="px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={
                      selectedSlot.status === "ready" ||
                      selectedSlot.status === "published"
                        ? {
                            backgroundColor: "#DCFCE7",
                            color: "#166534",
                            border: "1px solid #BBF7D0",
                          }
                        : selectedSlot.status === "draft"
                          ? {
                              backgroundColor: "#FEF9C3",
                              color: "#854D0E",
                              border: "1px solid #FDE68A",
                            }
                          : {
                              backgroundColor: "#F3F4F6",
                              color: "#374151",
                              border: "1px solid #D1D5DB",
                            }
                    }
                  >
                    {selectedSlot.status === "ready"
                      ? "Pret"
                      : selectedSlot.status === "published"
                        ? "Publie"
                        : selectedSlot.status === "draft"
                          ? "Brouillon"
                          : selectedSlot.status === "full"
                            ? "Complet"
                            : selectedSlot.status || "Inconnu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSS animation pour le slide-in du panel */}
      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   COMPOSANT : Événements globaux Admin (RÈGLE 5)
   Permet de créer / modifier / supprimer des événements visibles par TOUS les candidats
   ══════════════════════════════════════════════════════════════════════ */
function GlobalEventsAdmin({
  toast,
  onUpdate,
}: {
  toast: (msg: string, type?: any) => void;
  onUpdate?: () => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state (shared for create & edit)
  const [editingId, setEditingId] = useState<string | null>(null); // null = create mode
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState("");
  const [dayEnd, setDayEnd] = useState(""); // Multi-day: end date
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [visibleToCandidates, setVisibleToCandidates] = useState(true);
  const [color, setColor] = useState("#3B82F6");

  const EVENT_COLORS = [
    { value: "#3B82F6", label: "Bleu" },
    { value: "#10B981", label: "Vert" },
    { value: "#F59E0B", label: "Jaune" },
    { value: "#EF4444", label: "Rouge" },
    { value: "#8B5CF6", label: "Violet" },
    { value: "#EC4899", label: "Rose" },
    { value: "#64748B", label: "Gris" },
  ];

  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get("/calendar");
      const globals = (res.data || []).filter(
        (ev: any) => ev.is_global === true,
      );
      setEvents(globals);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const resetForm = () => {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setDay("");
    setDayEnd("");
    setStartTime("09:00");
    setEndTime("10:00");
    setVisibleToCandidates(true);
    setColor("#3B82F6");
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (ev: any) => {
    setEditingId(ev.id);
    setTitle(ev.title || "");
    setDescription(ev.description || "");
    // Parse day
    const dayStr = ev.day ? new Date(ev.day).toISOString().split("T")[0] : "";
    setDay(dayStr);
    // Parse day_end
    const dayEndStr = ev.day_end ? new Date(ev.day_end).toISOString().split("T")[0] : "";
    setDayEnd(dayEndStr);
    setStartTime((ev.start_time || ev.startTime || "09:00").slice(0, 5));
    setEndTime((ev.end_time || ev.endTime || "10:00").slice(0, 5));
    setVisibleToCandidates(ev.visible_to_candidates !== false);
    setColor(ev.color || "#3B82F6");
    setShowForm(true);
  };

  const handleCreateOrUpdate = async () => {
    if (!title.trim() || !day) {
      toast("Titre et date de début requis", "error");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        // UPDATE
        await api.put(`/calendar/${editingId}`, {
          title: title.trim(),
          description: description.trim() || null,
          day,
          day_end: dayEnd || null,
          start_time: startTime,
          end_time: endTime,
          visible_to_candidates: visibleToCandidates,
          color,
        });
        toast("Événement mis à jour", "success");
      } else {
        // CREATE
        await api.post("/calendar", {
          title: title.trim(),
          description: description.trim() || null,
          day,
          day_end: dayEnd || null,
          start_time: startTime,
          end_time: endTime,
          is_global: true,
          visible_to_candidates: visibleToCandidates,
          color,
        });
        toast(
          "Événement global créé" +
            (visibleToCandidates
              ? " et visible par tous les candidats"
              : " (masqué pour les candidats)"),
          "success",
        );
      }
      resetForm();
      setShowForm(false);
      fetchEvents();
      onUpdate?.();
    } catch (err: any) {
      toast(err?.response?.data?.error || "Erreur sauvegarde événement", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await api.delete(`/calendar/${id}`);
      toast("Événement supprimé", "success");
      fetchEvents();
      onUpdate?.();
    } catch {
      toast("Erreur suppression", "error");
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleVisibility = async (ev: any) => {
    const newVal = ev.visible_to_candidates === false ? true : false;
    try {
      await api.put(`/calendar/${ev.id}`, {
        visible_to_candidates: newVal,
      });
      toast(
        newVal
          ? "Événement visible pour les candidats"
          : "Événement masqué pour les candidats",
        "success",
      );
      fetchEvents();
      onUpdate?.();
    } catch {
      toast("Erreur changement visibilité", "error");
    }
  };

  const formatDateFr = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateRange = (ev: any) => {
    const start = formatDateFr(ev.day);
    if (ev.day_end) {
      const end = formatDateFr(ev.day_end);
      if (start === end) return start;
      return `${start} → ${end}`;
    }
    return start;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            📢 Événements globaux
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Publiés automatiquement dans le calendrier de tous les candidats
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm) {
              setShowForm(false);
              resetForm();
            } else {
              openCreateForm();
            }
          }}
          className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? "Annuler" : "+ Nouvel événement"}
        </button>
      </div>

      <div className="p-5">
        {/* Formulaire création / modification */}
        {showForm && (
          <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-blue-900">
                {editingId ? "✏️ Modifier l'événement" : "➕ Nouvel événement"}
              </span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Titre *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ex: Réunion d'information, Date limite de rendu..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                placeholder="Détails de l'événement (optionnel)"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date début *
                </label>
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date fin
                </label>
                <input
                  type="date"
                  value={dayEnd}
                  onChange={(e) => setDayEnd(e.target.value)}
                  min={day || undefined}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Laisser vide = 1 jour"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Vide = événement sur une journée
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Heure début
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Heure fin
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Couleur de l'événement */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Couleur de l&apos;événement
              </label>
              <div className="flex gap-2 items-center flex-wrap">
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setColor(c.value)}
                    title={c.label}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      color === c.value ? "border-gray-900 scale-110 shadow-sm" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>

            {/* Visibility toggle for candidates */}
            <div className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleToCandidates}
                  onChange={(e) => setVisibleToCandidates(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-400 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
              </label>
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {visibleToCandidates ? "👁️ Visible" : "🙈 Masqué"} pour les candidats
                </p>
                <p className="text-xs text-gray-500">
                  {visibleToCandidates
                    ? "Les candidats verront cet événement dans leur calendrier"
                    : "Cet événement ne sera pas visible par les candidats"}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {editingId && (
                <button
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
              )}
              <button
                onClick={handleCreateOrUpdate}
                disabled={saving}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving
                  ? "Sauvegarde..."
                  : editingId
                    ? "Mettre à jour"
                    : "Publier l'événement"}
              </button>
            </div>
          </div>
        )}

        {/* Liste des événements globaux */}
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            Chargement...
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            Aucun événement global créé
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((ev: any) => {
              const isVisible = ev.visible_to_candidates !== false;
              const isMultiDay = !!ev.day_end;
              return (
                <div
                  key={ev.id}
                  className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                    isVisible
                      ? "bg-gray-50 border-gray-200"
                      : "bg-gray-100/60 border-gray-300 opacity-75"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: ev.color || "#3B82F6" }}
                      />
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {ev.title}
                      </span>
                      {/* Visibility badge */}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                          isVisible
                            ? "bg-green-100 text-green-700 border border-green-200"
                            : "bg-red-100 text-red-700 border border-red-200"
                        }`}
                      >
                        {isVisible ? "👁️ Visible" : "🙈 Masqué"}
                      </span>
                      {/* Multi-day badge */}
                      {isMultiDay && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200 flex-shrink-0">
                          📅 Multi-jours
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 ml-5">
                      {formatDateRange(ev)}
                      {ev.start_time && ` — ${ev.start_time.slice(0, 5)}`}
                      {ev.end_time && ` - ${ev.end_time.slice(0, 5)}`}
                    </p>
                    {ev.description && (
                      <p className="text-xs text-gray-400 mt-0.5 ml-5 truncate">
                        {ev.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                    {/* Visibility toggle */}
                    <button
                      onClick={() => handleToggleVisibility(ev)}
                      title={isVisible ? "Masquer pour les candidats" : "Rendre visible aux candidats"}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        isVisible
                          ? "text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                          : "text-green-600 hover:text-green-800 hover:bg-green-50"
                      }`}
                    >
                      {isVisible ? "🙈 Masquer" : "👁️ Afficher"}
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => openEditForm(ev)}
                      className="text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                    >
                      ✏️ Modifier
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(ev.id)}
                      disabled={deleting === ev.id}
                      className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                    >
                      {deleting === ev.id ? "..." : "🗑️ Supprimer"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

