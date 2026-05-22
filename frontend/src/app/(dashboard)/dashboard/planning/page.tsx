"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import CalendarMemberBuilder from "@/components/calendar/CalendarMemberBuilder";
import { CalendarColumn } from "@/components/calendar/CalendarColumn";
import { startOfWeek, addDays } from "date-fns";

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
  nbSalles?: number;
  nb_salles?: number;
  minEvaluatorsPerSalle?: number;
  min_evaluators_per_salle?: number;
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

export default function PlanningPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.isAdmin === true;

  const [epreuves, setEpreuves] = useState<Epreuve[]>([]);
  const [selectedEpreuveId, setSelectedEpreuveId] = useState<string>("");
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
  const [globalEvents, setGlobalEvents] = useState<any[]>([]); // NEW STATE for global admin calendar
  // Modal détail créneau cliqué dans la vue calendrier globale
  const [globalDetailSlot, setGlobalDetailSlot] = useState<any | null>(null);
  const [repartitionLoading, setRepartitionLoading] = useState(false);
  const [repartitionResult, setRepartitionResult] = useState<any>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Planning visibility for candidates
  const [planningVisible, setPlanningVisible] = useState(false);
  // Logistique des créneaux (Phase 1 — déplacé depuis le formulaire épreuves)
  const [logNbSalles, setLogNbSalles] = useState(1);
  const [logMinEval, setLogMinEval] = useState(2);
  const [logSaving, setLogSaving] = useState(false);

  // ViewMode state
  const [activeTab, setActiveTab] = useState<
    "creation" | "evaluators" | "candidates"
  >("creation");
  const [memberAvailsSummary, setMemberAvailsSummary] = useState<
    { email: string; count: number; details: string }[]
  >([]);

  // Modale modification créneau
  const [editSlot, setEditSlot] = useState<any>(null);
  const [editRoom, setEditRoom] = useState("");
  const [editSaving, setEditSaving] = useState(false);
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

  useEffect(() => {
    fetchEpreuves();
    fetchGlobalCalendarEvents();
    fetchAllSlotsGlobal();
  }, [fetchEpreuves, fetchGlobalCalendarEvents, fetchAllSlotsGlobal]);

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

  // Sync logistique fields when selected epreuve changes
  useEffect(() => {
    if (!selectedEpreuveId) return;
    const ep = epreuves.find((e: any) => e.id === selectedEpreuveId) as any;
    if (ep) {
      setLogNbSalles(ep.nbSalles || ep.nb_salles || 1);
      setLogMinEval(
        ep.minEvaluatorsPerSalle || ep.min_evaluators_per_salle || 2,
      );
    }
  }, [selectedEpreuveId, epreuves]);

  // Save logistique fields to epreuve
  const handleSaveLogistique = async () => {
    if (!selectedEpreuveId) return;
    setLogSaving(true);
    try {
      await api.put(`/epreuves/${selectedEpreuveId}`, {
        nbSalles: logNbSalles,
        minEvaluatorsPerSalle: logMinEval,
      });
      // Update epreuves list in local state
      setEpreuves((prev: any) =>
        prev.map((ep: any) =>
          ep.id === selectedEpreuveId
            ? {
                ...ep,
                nbSalles: logNbSalles,
                minEvaluatorsPerSalle: logMinEval,
              }
            : ep,
        ),
      );
      toast("Configuration logistique sauvegardee", "success");
    } catch (e) {
      console.error("Erreur sauvegarde logistique:", e);
      toast("Erreur lors de la sauvegarde", "error");
    } finally {
      setLogSaving(false);
    }
  };

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

  const fetchMemberAvailabilitiesSummary = useCallback(async () => {
    if (!isAdmin || !selectedEpreuveId) return;
    const ep: any = epreuves.find((e) => (e as any).id === selectedEpreuveId);
    if (!ep || !ep.dateDebut || !ep.dateFin) return;

    try {
      const res = await api.get(
        `/availability/all?start=${ep.dateDebut}&end=${ep.dateFin}`,
      );
      const data = res.data || [];

      const grouped: Record<string, any[]> = {};
      data.forEach((av: any) => {
        const email = av.member?.email || "Inconnu";
        if (!grouped[email]) grouped[email] = [];
        grouped[email].push(av);
      });

      const summary = Object.entries(grouped).map(([email, slots]) => {
        const parts = slots.map((s) => {
          const d = new Date(s.date).toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
          const st = (s.start_time || s.startTime || "")
            .split(":")
            .slice(0, 2)
            .join("h");
          const et = (s.end_time || s.endTime || "")
            .split(":")
            .slice(0, 2)
            .join("h");
          return `${d} ${st}-${et}`;
        });
        return {
          email,
          count: slots.length,
          details: parts.join(" | "),
        };
      });

      setMemberAvailsSummary(summary.sort((a, b) => b.count - a.count));
    } catch (e) {
      console.error("Erreur chargement member summary:", e);
    }
  }, [isAdmin, selectedEpreuveId, epreuves]);

  useEffect(() => {
    fetchMemberAvailabilitiesSummary();
  }, [fetchMemberAvailabilitiesSummary]);

  // Fetch slots for inscription data + reconstruct repartition from DB
  const fetchSlotData = useCallback(async () => {
    if (!isAdmin || !selectedEpreuveId) return;
    try {
      const res = await api.get("/slots/all");
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

  useEffect(() => {
    fetchAvailabilityData();
    fetchSlotData();
  }, [fetchAvailabilityData, fetchSlotData]);

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

  // Charger les créneaux assignés au membre dès le montage (sans condition sur la saisie)
  // Ainsi, dès qu'un examinateur s'inscrit ou est assigné, ses créneaux apparaissent.
  // Polling 15s + refresh sur focus pour garder la liste à jour.
  useEffect(() => {
    if (isAdmin) return;
    fetchMySlots();
    const interval = setInterval(fetchMySlots, 15000);
    const onFocus = () => fetchMySlots();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAdmin, fetchMySlots]);

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
      const res = await api.get("/slots/all");
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
      api.post("/slots/auto-allocate", { epreuveId: selectedEpreuveId }).catch(
        (e) => console.warn("auto-allocate background error:", e),
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
      const res = await api.get("/slots/all");
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
      toast(`${publishedSlots.length} creneau(x) fermes`, "success");
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
          `${count} nouveau(x) créneau(x) publié(s) — les inscriptions existantes sont préservées`,
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
      // Vider le récapitulatif des saisies (la saisie reste toujours ouverte)
      setMemberAvailsSummary([]);
      toast(
        `${deleted} créneau(x) et ${availsDeleted} disponibilité(s) supprimé(s)`,
        "success",
      );
      fetchSlotData();
      fetchAllSlotsGlobal();
      fetchMemberAvailabilitiesSummary();
    } catch (e) {
      console.error("Erreur reset:", e);
      toast("Erreur lors de la réinitialisation", "error");
    } finally {
      setResetLoading(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // Modale modification créneau : ouvrir / sauvegarder / toggle membre
  // ══════════════════════════════════════════════════════════════════
  const openEditSlot = (slot: any) => {
    setEditSlot(slot);
    setEditRoom(slot.room || "");
  };

  const handleSaveSlot = async () => {
    if (!editSlot) return;
    setEditSaving(true);
    try {
      await api.put(`/slots/${editSlot.id}`, { room: editRoom });
      toast("Creneau mis a jour", "success");
      setEditSlot(null);
      setRepartitionResult(null); // Force re-fetch from DB
      fetchSlotData();
    } catch {
      toast("Erreur mise a jour", "error");
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleMemberOnSlot = async (
    slotId: string,
    memberId: string,
    isAssigned: boolean,
  ) => {
    try {
      if (isAssigned) {
        // Retirer le membre
        await api.post("/slots/toggle-member", {
          slotId,
          memberId,
          action: "remove",
        });
      } else {
        // Ajouter le membre
        await api.post("/slots/toggle-member", {
          slotId,
          memberId,
          action: "add",
        });
      }
      // Re-fetch le slot modifié
      const res = await api.get("/slots/all");
      const updated = (res.data || []).find((s: any) => s.id === slotId);
      if (updated) setEditSlot(updated);
      setRepartitionResult(null);
      fetchSlotData();
    } catch (e: any) {
      toast(
        e?.response?.data?.error || "Erreur modification evaluateur",
        "error",
      );
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
      const res = await api.post("/slots/auto-assign", {
        epreuveId: selectedEpreuveId,
        sallesParCreneau,
        evalParSalle,
      });

      const data = res.data;
      setRepartitionResult(data);

      if (data.summary.totalSlots === 0) {
        toast(
          "Aucun creneau avec suffisamment d'evaluateurs disponibles",
          "info",
        );
      } else {
        toast(
          `Repartition terminee : ${data.summary.totalSlots} salle(s) creee(s), ${data.summary.totalAssignments} affectation(s)`,
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
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Dispos &amp; Inscriptions
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Gérez le recrutement global et les épreuves
          </p>
        </div>

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
            if (memberCount === 0) { bg = "#EDE9FE"; dot = "#7C3AED"; txt = "#3B0764"; icon = "🟣"; }
            else if (candCount < maxCands) { bg = "#FEE2E2"; dot = "#DC2626"; txt = "#7F1D1D"; icon = "🔴"; }
            else if (memberCount < minMembers) { bg = "#FEF3C7"; dot = "#D97706"; txt = "#78350F"; icon = "🟠"; }
            allAdminEvents.push({
              id: `slot-${s.id}`,
              date: toDateStr(s.date),
              title: `${s.epreuve?.name || "Épreuve"} · ${s.room || "Salle ?"}`,
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
                <div className="flex bg-gray-100 rounded-full p-0.5">
                  {(["month","week"] as const).map(m => (
                    <button key={m} onClick={() => setAdminCalView(m)} className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${adminCalView===m?"bg-white text-gray-900 shadow-sm":"text-gray-500 hover:text-gray-700"}`}>
                      {m === "month" ? "Mois" : "Semaine"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-2">
                <button onClick={prevPeriod} className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors">‹</button>
                <span className="text-base font-semibold text-gray-900 min-w-[200px] text-center">
                  {adminCalView === "month" ? `${ADMIN_MONTHS[acMonth]} ${acYear}` : weekLabel}
                </span>
                <button onClick={nextPeriod} className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors">›</button>
                <button onClick={() => setAdminCalDate(new Date())} className="ml-2 px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors">Aujourd&apos;hui</button>
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
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-7 border-b border-gray-200">
                        {ADMIN_DAYS.map(d => (
                          <div key={d} className="py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">{d}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7">
                        {cells.map((day, i) => {
                          const ds = day ? `${acYear}-${String(acMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}` : "";
                          const dayEvs = day ? getEventsForDay(ds) : [];
                          const todayDay = day && today.getFullYear()===acYear && today.getMonth()===acMonth && today.getDate()===day;
                          return (
                            <div key={i} className={`min-h-[90px] border-b border-r border-gray-100 p-1.5 ${day===null?"bg-gray-50/50":"bg-white"} ${i%7===6?"border-r-0":""}`}>
                              {day !== null && (
                                <>
                                  <div className={`text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full ${todayDay?"bg-blue-600 text-white":"text-gray-700"}`}>{day}</div>
                                  <div className="space-y-0.5">
                                    {dayEvs.slice(0,3).map(ev => (
                                      <button key={ev.id} onClick={() => handleEvClick(ev)}
                                        className="w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded-md truncate font-medium transition-opacity hover:opacity-80"
                                        style={{ backgroundColor: ev.bg, color: ev.textColor }}
                                        title={ev.title}
                                      >
                                        {ev.startTime && <span className="font-bold">{ev.startTime} </span>}
                                        {ev.title}
                                      </button>
                                    ))}
                                    {dayEvs.length > 3 && (
                                      <p className="text-[10px] text-gray-400 px-1">+{dayEvs.length-3} autres</p>
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
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-7">
                        {weekDates.map((wd, i) => {
                          const ds = dateStr(wd);
                          const dayEvs = getEventsForDay(ds);
                          const todayWd = isToday(wd);
                          return (
                            <div key={i} className="border-r border-gray-100 last:border-r-0">
                              <div className={`p-3 text-center border-b border-gray-200 ${todayWd?"bg-blue-50":"bg-gray-50"}`}>
                                <p className="text-xs font-semibold text-gray-500 uppercase">{ADMIN_DAYS[i]}</p>
                                <p className={`text-xl font-bold mt-0.5 ${todayWd?"text-blue-600":"text-gray-900"}`}>{wd.getDate()}</p>
                                <p className="text-xs text-gray-400">{wd.toLocaleDateString("fr-FR",{month:"short"})}</p>
                              </div>
                              <div className="p-2 min-h-[180px] space-y-1.5">
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

        {/* Modal détail créneau (vue globale admin) */}
        {globalDetailSlot && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setGlobalDetailSlot(null)}
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
                      <button onClick={() => setGlobalDetailSlot(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
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
                if (memberCount === 0) { headerColor = "bg-purple-100 text-purple-900"; icon = "🟣"; label = "Aucun examinateur"; }
                else if (candCount < maxCands) { headerColor = "bg-red-50 text-red-900"; icon = "🔴"; label = "Manque candidat(s)"; }
                else if (memberCount < minMembers) { headerColor = "bg-orange-50 text-orange-900"; icon = "🟠"; label = "Examinateurs insuffisants"; }
                return (
                  <>
                    <div className={`p-5 border-b border-gray-100 ${headerColor}`}>
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-semibold flex items-center gap-2">
                          {icon} {s.epreuve?.name || "Créneau"}
                        </h2>
                        <button onClick={() => setGlobalDetailSlot(null)} className="opacity-60 hover:opacity-100 text-2xl leading-none">×</button>
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
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Salle</span>
                        <span className="font-medium text-gray-800">{s.room || "—"}</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="text-gray-400 w-20 flex-shrink-0 text-xs uppercase">Tour</span>
                        <span className="font-medium text-gray-800">Tour {s.tour || s.epreuve?.tour || "?"}</span>
                      </div>
                      <hr className="my-2" />
                      <div>
                        <p className="text-xs uppercase text-gray-400 mb-1.5">Examinateurs ({memberCount}/{minMembers}+)</p>
                        {memberCount === 0 ? (
                          <p className="text-purple-700 text-sm italic">Aucun examinateur assigné</p>
                        ) : (
                          <ul className="space-y-1">
                            {(s.members || []).map((m: any, idx: number) => {
                              const mem = m.member || {};
                              const name = mem.firstName || mem.first_name
                                ? `${mem.firstName || mem.first_name} ${mem.lastName || mem.last_name || ""}`.trim()
                                : mem.email?.split("@")[0] || "Inconnu";
                              return <li key={idx} className="flex items-center gap-2 text-gray-800"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{name} <span className="text-xs text-gray-400">{mem.email}</span></li>;
                            })}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase text-gray-400 mb-1.5">Candidats ({candCount}/{maxCands})</p>
                        {candCount === 0 ? (
                          <p className="text-red-700 text-sm italic">Aucun candidat inscrit</p>
                        ) : (
                          <ul className="space-y-1">
                            {(s.enrollments || []).map((e: any, idx: number) => {
                              const c = e.candidate || {};
                              const name = `${c.first_name || c.firstName || ""} ${c.last_name || c.lastName || ""}`.trim() || "Candidat";
                              return <li key={idx} className="flex items-center gap-2 text-gray-800"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{name}</li>;
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        <hr className="my-2 border-gray-200" />

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
            {/* ══════════════════════════════════════════════════════════════════
                            LOGISTIQUE DES CRÉNEAUX — nb salles + min évaluateurs
                            (Déplacé depuis le formulaire de création d'épreuve)
                            ══════════════════════════════════════════════════════════════════ */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">
                ⚙️ Logistique des créneaux
              </h3>
              <div className="grid grid-cols-2 gap-6 max-w-lg">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Nombre de salles
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={logNbSalles}
                    onChange={(e) =>
                      setLogNbSalles(parseInt(e.target.value) || 1)
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Salles en parallèle pour cette épreuve
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Min. évaluateurs / salle
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={logMinEval}
                    onChange={(e) =>
                      setLogMinEval(parseInt(e.target.value) || 1)
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Minimum d&apos;évaluateurs requis par salle
                  </p>
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={handleSaveLogistique}
                  disabled={logSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {logSaving ? "Sauvegarde..." : "Sauvegarder la logistique"}
                </button>
              </div>
            </div>

            {/* Ancienne position du calendrier supprimée */}

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

            <CalendarAdminBuilder
              selectedEpreuveId={selectedEpreuveId}
              epreuve={epreuves.find((e) => e.id === selectedEpreuveId)}
              toast={toast}
              onUpdate={() => {
                fetchSlotData();
                fetchAllSlotsGlobal(); // Refresh vue globale aussi
              }}
              viewMode={activeTab}
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
                          ? `✅ Publiés — examinateurs inscrivent leurs dispos · l'algo sélectionne ${logMinEval} par créneau automatiquement`
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

                {/* Récapitulatif des inscriptions */}
                {memberAvailsSummary.length > 0 && (
                  <div className="p-4 border border-gray-200 rounded-xl bg-gray-50/50">
                    <h4 className="text-sm font-semibold mb-3 text-gray-800">
                      Récapitulatif des disponibilités ({memberAvailsSummary.length} membre{memberAvailsSummary.length > 1 ? "s" : ""})
                    </h4>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100 bg-white">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-600 font-medium sticky top-0 border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-2">Membre</th>
                            <th className="px-4 py-2 text-center">Créneaux</th>
                            <th className="px-4 py-2">Détail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {memberAvailsSummary.map((mem, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="px-4 py-2 font-medium text-gray-800">{mem.email}</td>
                              <td className="px-4 py-2 text-center">
                                <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-semibold">{mem.count}</span>
                              </td>
                              <td className="px-4 py-2 text-gray-500 text-xs truncate max-w-xs" title={mem.details}>{mem.details}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

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
                {(existingSlots.length > 0 || memberAvailsSummary.length > 0) && (
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
    <div className="flex flex-col gap-6 p-6">

      {/* ─── Grille d'inscription (toujours visible) ─── */}
      <CalendarMemberBuilder
        memberId={user?.id || ""}
        toast={toast}
        epreuvesConfigured={epreuves}
        onSlotsChange={fetchMySlots}
      />

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

                    return (
                      <div
                        key={slot.id}
                        onClick={() => setSelectedSlot(slot)}
                        className="flex items-stretch cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        {/* Barre latérale colorée */}
                        <div
                          style={{
                            width: 4,
                            backgroundColor: color,
                            borderRadius: "0 4px 4px 0",
                            flexShrink: 0,
                          }}
                        />

                        <div className="flex-1 px-5 py-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              {/* Horaire + épreuve */}
                              <div className="flex items-center gap-3 mb-1.5">
                                <span className="text-sm font-semibold text-gray-900">
                                  {formatTime(slot.start_time)} -{" "}
                                  {formatTime(slot.end_time)}
                                </span>
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    backgroundColor: `${color}15`,
                                    color: color,
                                    border: `1px solid ${color}40`,
                                  }}
                                >
                                  {slot.epreuve?.name || "Epreuve"}
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
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
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

            <div className="p-6 space-y-6">
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
                        (enrollment, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-xs font-semibold text-amber-700">
                              {(
                                enrollment.candidate?.first_name?.[0] || "?"
                              ).toUpperCase()}
                              {(
                                enrollment.candidate?.last_name?.[0] || ""
                              ).toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-gray-800">
                              {enrollment.candidate?.first_name}{" "}
                              {enrollment.candidate?.last_name}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Co-évaluateurs ── */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">👥</span>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                    Co-evaluateur(s)
                  </p>
                  {(() => {
                    // Filtrer pour ne montrer que les AUTRES membres (pas soi-même)
                    const coEvals = (selectedSlot.members || [])
                      .filter((m) => m.member?.id !== user?.id)
                      .map((m) => m.member);

                    if (coEvals.length === 0) {
                      return (
                        <p className="text-sm text-gray-400 italic">
                          Vous evaluez seul(e) sur ce creneau
                        </p>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {coEvals.map((member, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700">
                              {(member?.email?.[0] || "?").toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-gray-800">
                              {member?.email || "Membre"}
                            </span>
                          </div>
                        ))}
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

