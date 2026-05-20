"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

/* ─── Types ──────────────────────────────────────────────────────── */
type WorkflowStatus =
  | "draft"
  | "creneaux_finalises"
  | "published_evaluators"
  | "allocating"
  | "allocated"
  | "published_candidates";

const STEPS: { key: WorkflowStatus; label: string; icon: string }[] = [
  { key: "draft",                label: "Configuration",       icon: "⚙️" },
  { key: "creneaux_finalises",   label: "Créneaux générés",    icon: "📅" },
  { key: "published_evaluators", label: "Inscriptions ouvertes",icon: "👥" },
  { key: "allocating",           label: "Allocation lancée",   icon: "⚡" },
  { key: "allocated",            label: "Allocation validée",  icon: "✅" },
  { key: "published_candidates", label: "Publié candidats",    icon: "🎉" },
];

const STEP_INDEX: Record<WorkflowStatus, number> = {
  draft: 0, creneaux_finalises: 1, published_evaluators: 2,
  allocating: 3, allocated: 4, published_candidates: 5,
};

/* ─── Format helpers ─────────────────────────────────────────────── */
const fmtDate = (iso: string) => {
  try { return format(new Date(iso), "EEE dd/MM", { locale: fr }); } catch { return iso; }
};

/* ─── Main Page ──────────────────────────────────────────────────── */
export default function AllocationPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const epreuveId = params.id as string;
  const isAdmin = user?.isAdmin;

  const [epreuve, setEpreuve]               = useState<any>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>("draft");
  const [counts, setCounts]                 = useState<any>({});
  const [loading, setLoading]               = useState(true);

  // Step 1 – génération
  const [genForm, setGenForm] = useState({
    nombre_salles: 2,
    heure_debut_journee: "08:00",
    heure_fin_journee: "18:00",
    duree_creneau_minutes: 30,
    quota_min_evaluateurs: 2,
    days_selected: [] as string[],
    delete_existing: true,
  });
  const [sallesNames, setSallesNames] = useState<string[]>(["Salle A", "Salle B"]);
  const [generating, setGenerating] = useState(false);
  const [genStats, setGenStats]     = useState<any>(null);

  // Step 3 – inscriptions (admin view)
  const [slots, setSlots]           = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Step 4 – allocation
  const [allocating, setAllocating] = useState(false);
  const [ranking, setRanking]       = useState<any>(null);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 4 – my allocations (evaluator view)
  const [myAllocs, setMyAllocs]     = useState<any>(null);

  /* ── Fetch workflow state ── */
  const fetchWorkflow = useCallback(async () => {
    try {
      const res = await api.get(`/epreuves/${epreuveId}/workflow`);
      setEpreuve(res.data.epreuve);
      setWorkflowStatus(res.data.epreuve?.workflow_status || "draft");
      setCounts(res.data.counts || {});
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [epreuveId]);

  useEffect(() => { fetchWorkflow(); }, [fetchWorkflow]);

  /* ── Sync salle names array when count changes ── */
  useEffect(() => {
    setSallesNames(prev => {
      const n = genForm.nombre_salles;
      const arr = [...prev];
      while (arr.length < n) arr.push(`Salle ${String.fromCharCode(65 + arr.length)}`);
      return arr.slice(0, n);
    });
  }, [genForm.nombre_salles]);

  /* ── Fetch slots for subscription view ── */
  const fetchSlots = useCallback(async () => {
    setLoadingSlots(true);
    try {
      const res = await api.get(`/epreuves/${epreuveId}/slot-subscriptions`);
      setSlots(res.data);
    } catch { /* ignore */ }
    finally { setLoadingSlots(false); }
  }, [epreuveId]);

  /* ── Fetch ranking ── */
  const fetchRanking = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api.get(`/epreuves/${epreuveId}/allocation-ranking`);
      setRanking(res.data);
    } catch { /* ignore */ }
  }, [epreuveId, isAdmin]);

  /* ── Fetch my allocations (evaluator) ── */
  const fetchMyAllocs = useCallback(async () => {
    try {
      const res = await api.get(`/epreuves/${epreuveId}/my-allocations`);
      setMyAllocs(res.data);
    } catch { /* ignore */ }
  }, [epreuveId]);

  /* ── Polling when allocating or allocated ── */
  useEffect(() => {
    if (["allocating", "allocated", "published_evaluators"].includes(workflowStatus)) {
      if (isAdmin) { fetchRanking(); fetchSlots(); }
      else fetchMyAllocs();

      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          if (isAdmin) fetchRanking();
          else fetchMyAllocs();
        }, 5000);
      }
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [workflowStatus, isAdmin, fetchRanking, fetchMyAllocs, fetchSlots]);

  useEffect(() => {
    if (["published_evaluators", "allocating"].includes(workflowStatus) && isAdmin) fetchSlots();
  }, [workflowStatus, isAdmin, fetchSlots]);

  /* ── Handlers ── */
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/epreuves/${epreuveId}/generate-slots`, {
        ...genForm, salles_names: sallesNames,
      });
      setGenStats(res.data.stats);
      toast(`${res.data.creneaux_generated} créneaux générés 🎉`, "success");
      await fetchWorkflow();
    } catch (e: any) {
      toast(e.response?.data?.error || "Erreur génération", "error");
    } finally { setGenerating(false); }
  };

  const handleTransition = async (newStatus: WorkflowStatus) => {
    try {
      await api.patch(`/epreuves/${epreuveId}/workflow`, { status: newStatus });
      setWorkflowStatus(newStatus);
      await fetchWorkflow();
      toast("Statut mis à jour", "success");
    } catch (e: any) {
      toast(e.response?.data?.error || "Erreur", "error");
    }
  };

  const handleAllocate = async () => {
    setAllocating(true);
    try {
      const res = await api.post(`/epreuves/${epreuveId}/allocate`, {});
      const { creneaux_non_remplis, statistiques } = res.data;
      if (creneaux_non_remplis?.length > 0) {
        toast(`⚠️ ${creneaux_non_remplis.length} créneau(x) non remplis`, "error");
      } else {
        toast("Allocation réussie ✅", "success");
      }
      setWorkflowStatus("allocated");
      await fetchWorkflow();
      await fetchRanking();
    } catch (e: any) {
      toast(e.response?.data?.error || "Erreur allocation", "error");
    } finally { setAllocating(false); }
  };

  const handleManualEdit = async (action: "add" | "remove", slot_id: string, member_id: string) => {
    try {
      await api.patch(`/epreuves/${epreuveId}/allocation-manual`, { action, slot_id, member_id });
      await fetchRanking();
      toast(action === "remove" ? "Évaluateur retiré" : "Évaluateur ajouté", "success");
    } catch (e: any) {
      toast(e.response?.data?.error || "Erreur", "error");
    }
  };

  const handleSubscribeSlot = async (slot_id: string, subscribed: boolean) => {
    try {
      if (subscribed) {
        await api.delete(`/epreuves/${epreuveId}/slot-subscribe`, { data: { slot_id } });
        toast("Désinscrit du créneau", "success");
      } else {
        await api.post(`/epreuves/${epreuveId}/slot-subscribe`, { slot_id });
        toast("Inscrit au créneau ✅", "success");
      }
      await fetchMyAllocs();
    } catch (e: any) {
      toast(e.response?.data?.error || "Erreur", "error");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full" />
    </div>
  );

  const currentStep = STEP_INDEX[workflowStatus] ?? 0;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Retour</button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            🎯 Allocation — {epreuve?.name}
          </h1>
          <p className="text-sm text-gray-500">Tour {epreuve?.tour}</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {STEPS.map((step, idx) => {
          const done    = idx < currentStep;
          const active  = idx === currentStep;
          const future  = idx > currentStep;
          return (
            <div key={step.key} className="flex items-center">
              <div className={`flex flex-col items-center min-w-[90px] ${future ? "opacity-40" : ""}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base border-2
                  ${done   ? "bg-green-500 border-green-500 text-white"
                  : active ? "bg-pink-500 border-pink-500 text-white"
                  :          "bg-white border-gray-300 text-gray-400"}`}>
                  {done ? "✓" : step.icon}
                </div>
                <span className={`text-[10px] mt-1 text-center leading-tight
                  ${active ? "text-pink-600 font-semibold" : "text-gray-500"}`}>
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`h-0.5 w-8 mx-1 flex-shrink-0 ${idx < currentStep ? "bg-green-400" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── ÉTAPE 1 : Générer les créneaux (admin) ── */}
      {isAdmin && workflowStatus === "draft" && (
        <Panel title="⚙️ Étape 1 — Générer les créneaux">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <Field label="Nombre de salles">
              <input type="number" min={1} max={10} value={genForm.nombre_salles}
                onChange={e => setGenForm(p => ({ ...p, nombre_salles: +e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Durée créneau (min)">
              <input type="number" min={15} max={240} step={15} value={genForm.duree_creneau_minutes}
                onChange={e => setGenForm(p => ({ ...p, duree_creneau_minutes: +e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Évaluateurs min / créneau">
              <input type="number" min={1} max={10} value={genForm.quota_min_evaluateurs}
                onChange={e => setGenForm(p => ({ ...p, quota_min_evaluateurs: +e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Heure début">
              <input type="time" value={genForm.heure_debut_journee}
                onChange={e => setGenForm(p => ({ ...p, heure_debut_journee: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Heure fin">
              <input type="time" value={genForm.heure_fin_journee}
                onChange={e => setGenForm(p => ({ ...p, heure_fin_journee: e.target.value }))}
                className={inputCls} />
            </Field>
          </div>

          {/* Noms des salles */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Noms des salles</label>
            <div className="flex flex-wrap gap-2">
              {sallesNames.map((name, i) => (
                <input key={i} value={name}
                  onChange={e => setSallesNames(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-28" placeholder={`Salle ${i + 1}`} />
              ))}
            </div>
          </div>

          {/* Sélection des jours */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Jours sélectionnés</label>
            <DayPicker selected={genForm.days_selected}
              onChange={days => setGenForm(p => ({ ...p, days_selected: days }))} />
          </div>

          {/* Aperçu */}
          {genForm.days_selected.length > 0 && (() => {
            const debutMin = timeToMin(genForm.heure_debut_journee);
            const finMin   = timeToMin(genForm.heure_fin_journee);
            const parSalle = Math.floor((finMin - debutMin) / genForm.duree_creneau_minutes);
            return (
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700 mb-4">
                <strong>Aperçu :</strong> {genForm.nombre_salles} salles × {parSalle} créneaux/salle × {genForm.days_selected.length} jour(s)
                = <strong>{genForm.nombre_salles * parSalle * genForm.days_selected.length} créneaux</strong>
              </div>
            );
          })()}

          <div className="flex items-center gap-3">
            <button onClick={handleGenerate} disabled={generating || genForm.days_selected.length === 0}
              className="px-4 py-2 bg-pink-600 text-white text-sm rounded-lg hover:bg-pink-700 disabled:opacity-40 font-medium">
              {generating ? "Génération…" : "🚀 Générer les créneaux"}
            </button>
            {genStats && (
              <span className="text-sm text-green-600 font-medium">
                ✅ {genStats.total_creneaux} créneaux générés
              </span>
            )}
          </div>
        </Panel>
      )}

      {/* ── ÉTAPE 1 : Créneaux générés — actions (admin) ── */}
      {isAdmin && workflowStatus === "creneaux_finalises" && (
        <Panel title="📅 Étape 2 — Créneaux prêts">
          <p className="text-sm text-gray-600 mb-3">
            {counts.total_slots} créneaux générés. Tu peux publier pour que les évaluateurs s'inscrivent.
          </p>
          <div className="flex gap-3">
            <button onClick={() => handleTransition("draft")}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              ← Regénérer
            </button>
            <button onClick={() => handleTransition("published_evaluators")}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium">
              👥 Ouvrir inscriptions évaluateurs
            </button>
          </div>
        </Panel>
      )}

      {/* ── ÉTAPE 3 : Inscriptions évaluateurs (admin) ── */}
      {isAdmin && workflowStatus === "published_evaluators" && (
        <Panel title="👥 Étape 3 — Inscriptions en cours">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              {counts.subscriptions || 0} inscription(s) sur {counts.total_slots} créneaux.
              <span className="text-xs text-gray-400 ml-2">Rafraîchissement auto toutes les 5s</span>
            </p>
            <div className="flex gap-2">
              <button onClick={fetchSlots} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">
                🔄 Rafraîchir
              </button>
              <button onClick={() => handleAllocate()}
                className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 font-medium">
                ⚡ Lancer l'allocation
              </button>
            </div>
          </div>
          <SlotSubscriptionGrid slots={slots} loading={loadingSlots} />
        </Panel>
      )}

      {/* ── ÉTAPE 3 : Vue évaluateur ── */}
      {!isAdmin && (workflowStatus === "published_evaluators" || workflowStatus === "allocating") && (
        <EvaluatorSubscriptionView
          epreuveId={epreuveId}
          myAllocs={myAllocs}
          onSubscribe={handleSubscribeSlot}
          onRefresh={fetchMyAllocs}
        />
      )}

      {/* ── ÉTAPE 4 : Allocation (admin) ── */}
      {isAdmin && (workflowStatus === "allocating" || workflowStatus === "allocated") && (
        <Panel title={workflowStatus === "allocating" ? "⚡ Allocation en cours…" : "✅ Allocation terminée"}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600">
              {ranking?.summary && (
                <>
                  <span className="text-green-600 font-medium">{ranking.summary.creneaux_complets} complets</span>
                  {ranking.summary.creneaux_non_remplis > 0 && (
                    <span className="text-red-500 font-medium ml-3">⚠️ {ranking.summary.creneaux_non_remplis} non remplis</span>
                  )}
                  <span className="text-gray-400 ml-3 text-xs">· Quota Z={ranking.summary.quota_z}</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {workflowStatus === "allocated" && (
                <button onClick={() => handleTransition("published_candidates")}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium">
                  🎉 Publier pour les candidats
                </button>
              )}
              <button onClick={handleAllocate} disabled={allocating}
                className="px-3 py-1.5 text-sm border border-purple-300 text-purple-600 rounded-lg hover:bg-purple-50 disabled:opacity-40">
                {allocating ? "…" : "🔄 Relancer"}
              </button>
            </div>
          </div>
          {ranking && <AllocationRanking ranking={ranking} onManualEdit={handleManualEdit} />}
        </Panel>
      )}

      {/* ── ÉTAPE 4 : Vue évaluateur après allocation ── */}
      {!isAdmin && (workflowStatus === "allocated" || workflowStatus === "published_candidates") && myAllocs && (
        <EvaluatorResultView myAllocs={myAllocs} />
      )}

      {/* ── ÉTAPE 5 : Publié candidats ── */}
      {workflowStatus === "published_candidates" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h2 className="text-lg font-semibold text-green-800">Créneaux publiés pour les candidats</h2>
          <p className="text-sm text-green-600 mt-1">Les candidats peuvent maintenant s'inscrire aux créneaux.</p>
          {isAdmin && ranking && <AllocationRanking ranking={ranking} onManualEdit={handleManualEdit} readOnly />}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────── */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300";

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/* ── DayPicker : sélection de dates ── */
function DayPicker({ selected, onChange }: { selected: string[]; onChange: (days: string[]) => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const firstDay    = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const today       = new Date(); today.setHours(0,0,0,0);

  const toggle = (dateStr: string) => {
    onChange(selected.includes(dateStr) ? selected.filter(d => d !== dateStr) : [...selected, dateStr]);
  };

  const monthLabel = month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div className="inline-block select-none">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => setMonth(m => { const d = new Date(m); d.setMonth(d.getMonth()-1); return d; })}
          className="p-1 hover:bg-gray-100 rounded">‹</button>
        <span className="text-sm font-medium capitalize w-36 text-center">{monthLabel}</span>
        <button onClick={() => setMonth(m => { const d = new Date(m); d.setMonth(d.getMonth()+1); return d; })}
          className="p-1 hover:bg-gray-100 rounded">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-xs">
        {["L","M","M","J","V","S","D"].map((d, i) => (
          <div key={i} className="text-center text-gray-400 font-medium py-1">{d}</div>
        ))}
        {Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />)}
        {Array(daysInMonth).fill(null).map((_, i) => {
          const day = i + 1;
          const d   = new Date(month.getFullYear(), month.getMonth(), day);
          const str = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const sel = selected.includes(str);
          const past = d < today;
          return (
            <button key={day} onClick={() => !past && toggle(str)} disabled={past}
              className={`w-8 h-8 rounded text-center text-xs font-medium transition-colors
                ${past ? "text-gray-300 cursor-not-allowed"
                : sel  ? "bg-pink-500 text-white"
                :        "hover:bg-gray-100 text-gray-700"}`}>
              {day}
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.sort().map(d => (
            <span key={d} className="bg-pink-100 text-pink-700 text-xs px-2 py-0.5 rounded-full">
              {format(new Date(d + "T12:00"), "dd/MM", { locale: fr })}
              <button onClick={() => toggle(d)} className="ml-1 hover:text-pink-900">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── SlotSubscriptionGrid : grille des inscriptions (admin) ── */
function SlotSubscriptionGrid({ slots, loading }: { slots: any[]; loading: boolean }) {
  if (loading) return <div className="text-sm text-gray-400">Chargement…</div>;
  if (!slots.length) return <div className="text-sm text-gray-400">Aucun créneau.</div>;

  const grouped: Record<string, any[]> = {};
  for (const s of slots) {
    const day = s.date?.split("T")[0] || s.date;
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(s);
  }

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {Object.entries(grouped).sort().map(([day, daySlots]) => (
        <div key={day}>
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{fmtDate(day + "T12:00")}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {daySlots.map((slot: any) => {
              const count = slot.requests?.length || 0;
              return (
                <div key={slot.id} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-700">
                      {slot.room} · {slot.start_time}–{slot.end_time}
                    </span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full
                      ${count >= 2 ? "bg-green-100 text-green-700" : count === 1 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-600"}`}>
                      {count}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(slot.requests || []).map((r: any) => (
                      <span key={r.member_id} className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600">
                        {r.member?.first_name || r.member?.email?.split("@")[0]}
                      </span>
                    ))}
                    {count === 0 && <span className="text-[10px] text-gray-400 italic">Personne inscrit</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── AllocationRanking : vue ranking par créneau ── */
function AllocationRanking({
  ranking,
  onManualEdit,
  readOnly = false,
}: {
  ranking: any;
  onManualEdit?: (action: "add" | "remove", slot_id: string, member_id: string) => void;
  readOnly?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "non_rempli">("all");
  const creneaux = ranking.creneaux || [];
  const visible  = filter === "non_rempli" ? creneaux.filter((c: any) => c.statut === "NON_REMPLI") : creneaux;

  const grouped: Record<string, any[]> = {};
  for (const c of visible) {
    const day = c.date?.split("T")[0] || c.date;
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(c);
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {["all", "non_rempli"].map(f => (
          <button key={f} onClick={() => setFilter(f as any)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors
              ${filter === f ? "bg-gray-800 text-white border-gray-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {f === "all" ? "Tous" : "⚠️ Non remplis"}
          </button>
        ))}
      </div>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {Object.entries(grouped).sort().map(([day, daySlots]) => (
          <div key={day}>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{fmtDate(day + "T12:00")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {(daySlots as any[]).map((creneau: any) => (
                <CreneauCard key={creneau.id} creneau={creneau}
                  onEdit={readOnly ? undefined : onManualEdit} />
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && <div className="text-sm text-gray-400 text-center py-8">Aucun créneau</div>}
      </div>
    </div>
  );
}

function CreneauCard({ creneau, onEdit }: { creneau: any; onEdit?: (action: "add"|"remove", slot_id: string, member_id: string) => void }) {
  const ok = creneau.statut === "OK";
  return (
    <div className={`border rounded-xl p-3 ${ok ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-700">
          {creneau.salle} · {creneau.heure_debut?.slice(0,5)}–{creneau.heure_fin?.slice(0,5)}
        </span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full
          ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
          {ok ? "✅ OK" : `⚠️ ${creneau.affectes?.length}/${creneau.quota}`}
        </span>
      </div>

      {/* Affectés */}
      <div className="space-y-1">
        {(creneau.affectes || []).map((a: any) => (
          <div key={a.member_id} className="flex items-center justify-between bg-white rounded px-2 py-1 border border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 w-4">#{a.rang_priorite}</span>
              <span className="text-xs text-gray-700">{a.member?.first_name || a.member?.email?.split("@")[0]}</span>
              {a.modifie_par_admin && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1 rounded">admin</span>}
            </div>
            {onEdit && (
              <button onClick={() => onEdit("remove", creneau.id, a.member_id)}
                className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
            )}
          </div>
        ))}
        {/* En attente */}
        {(creneau.en_attente || []).map((a: any) => (
          <div key={a.member_id} className="flex items-center justify-between bg-yellow-50 rounded px-2 py-1 border border-yellow-100 opacity-70">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-yellow-600 w-4">⏳</span>
              <span className="text-xs text-gray-500">{a.member?.first_name || a.member?.email?.split("@")[0]}</span>
            </div>
            {onEdit && (
              <button onClick={() => onEdit("remove", creneau.id, a.member_id)}
                className="text-red-300 hover:text-red-500 text-xs px-1">✕</button>
            )}
          </div>
        ))}
        {creneau.total_inscrits === 0 && (
          <div className="text-[10px] text-gray-400 italic px-2">Aucune inscription</div>
        )}
      </div>
    </div>
  );
}

/* ── EvaluatorSubscriptionView : l'évaluateur choisit ses créneaux ── */
function EvaluatorSubscriptionView({
  epreuveId, myAllocs, onSubscribe, onRefresh,
}: {
  epreuveId: string;
  myAllocs: any;
  onSubscribe: (slot_id: string, subscribed: boolean) => void;
  onRefresh: () => void;
}) {
  const [allSlots, setAllSlots] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get(`/epreuves/${epreuveId}/slot-subscriptions`)
      .then(r => setAllSlots(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [epreuveId]);

  const subscribedIds = new Set(
    (myAllocs?.allocations || []).map((a: any) => a.slot_id)
  );

  if (loading) return <div className="text-sm text-gray-400 p-6">Chargement des créneaux…</div>;

  const grouped: Record<string, any[]> = {};
  for (const s of allSlots) {
    const day = s.date?.split("T")[0] || s.date;
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(s);
  }

  return (
    <Panel title="📋 Créneaux disponibles — Inscrivez-vous">
      <p className="text-sm text-gray-500 mb-3">
        Cliquez sur les créneaux qui vous conviennent.
        {myAllocs?.summary && (
          <span className="ml-2 text-pink-600 font-medium">
            {subscribedIds.size} créneau(x) sélectionné(s)
          </span>
        )}
      </p>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {Object.entries(grouped).sort().map(([day, slots]) => (
          <div key={day}>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{fmtDate(day + "T12:00")}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {(slots as any[]).map((slot: any) => {
                const sub = subscribedIds.has(slot.id);
                return (
                  <button key={slot.id} onClick={() => onSubscribe(slot.id, sub)}
                    className={`rounded-lg border-2 p-2.5 text-left text-xs transition-all
                      ${sub ? "border-pink-400 bg-pink-50 text-pink-700" : "border-gray-200 bg-white hover:border-gray-300 text-gray-600"}`}>
                    <div className="font-semibold">{slot.room}</div>
                    <div>{slot.start_time?.slice(0,5)}–{slot.end_time?.slice(0,5)}</div>
                    {sub && <div className="text-[10px] mt-1 text-pink-500">✅ Inscrit</div>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── EvaluatorResultView : résultat d'allocation pour l'évaluateur ── */
function EvaluatorResultView({ myAllocs }: { myAllocs: any }) {
  const { allocations = [], summary = {} } = myAllocs;
  return (
    <Panel title="📊 Mes créneaux attribués">
      <div className="flex gap-3 mb-4 flex-wrap">
        <Chip label={`✅ ${summary.affectes || 0} affecté(s)`} color="green" />
        <Chip label={`⏳ ${summary.en_attente || 0} en attente`} color="yellow" />
        <Chip label={`📋 ${summary.total_inscriptions || 0} inscrip.`} color="gray" />
      </div>
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {allocations.map((a: any) => (
          <div key={a.slot_id} className={`flex items-center justify-between rounded-lg px-3 py-2.5 border
            ${a.statut === "affecte" ? "bg-green-50 border-green-200"
            : a.statut === "en_attente" ? "bg-yellow-50 border-yellow-200"
            : "bg-gray-50 border-gray-200"}`}>
            <div>
              <span className="text-sm font-medium text-gray-800">{a.salle}</span>
              <span className="text-xs text-gray-500 ml-2">{fmtDate(a.date)} · {a.heure_debut?.slice(0,5)}</span>
            </div>
            <div className="text-right">
              {a.statut === "affecte" && <span className="text-xs font-semibold text-green-600">✅ Affecté #{a.rang_dans_creneau}</span>}
              {a.statut === "en_attente" && <span className="text-xs font-semibold text-yellow-600">⏳ Réserviste</span>}
              {a.statut === "en_attente_allocation" && <span className="text-xs text-gray-400">En attente d'allocation…</span>}
            </div>
          </div>
        ))}
        {allocations.length === 0 && <div className="text-sm text-gray-400 text-center py-6">Vous n'êtes inscrit à aucun créneau.</div>}
      </div>
    </Panel>
  );
}

function Chip({ label, color }: { label: string; color: "green" | "yellow" | "gray" | "red" }) {
  const cls = {
    green:  "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    gray:   "bg-gray-100 text-gray-600",
    red:    "bg-red-100 text-red-600",
  }[color];
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cls}`}>{label}</span>;
}
