"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

const POLES = [
  "Système d'information",
  "Marketing",
  "Développement commercial",
  "Audit Qualité",
  "Ressource Humaine",
  "Trésorerie",
  "Bureau - VP",
  "Bureau - Président",
  "Bureau - Trésorier",
  "Bureau - Secrétaire générale"
];

interface Tour {
  id: string;
  name: string;
  status: "en_cours" | "a_venir" | "termine";
  candidateCount: number;
}

interface Epreuve {
  id: string;
  name: string;
  tourId: string;
  tourName: string;
  type: "commune" | "individuelle" | "groupe";
  date?: string;
  dateDebut?: string;
  dateFin?: string;
  visibleCandidats: boolean;
}

interface Critere {
  name: string;
  coefficient: number;
}

interface NewEpreuveForm {
  name: string;
  tourId: string;
  type: "commune" | "individuelle" | "groupe";
  /* commune */
  date: string;
  time: string;
  salle: string;
  presentedBy: string;
  /* individuelle / groupe */
  dateDebut: string;
  dateFin: string;
  duree: string;
  roulementMinutes: string;
  pole: string;
  /* shared */
  description: string;
  documents: FileList | null;
  criteres: Critere[];
}

const EMPTY_FORM: NewEpreuveForm = {
  name: "",
  tourId: "",
  type: "commune",
  date: "",
  time: "",
  salle: "",
  presentedBy: "",
  dateDebut: "",
  dateFin: "",
  duree: "",
  roulementMinutes: "10",
  pole: "",
  description: "",
  documents: null,
  criteres: [{ name: "", coefficient: 1 }],
};

/* ------------------------------------------------------------------ */
/*  Helper components                                                  */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
  if (status === "en_cours")
    return (
      <span className="inline-block text-xs font-medium px-2 py-[2px] rounded-full bg-blue-100 text-blue-700">
        En cours
      </span>
    );
  if (status === "a_venir")
    return (
      <span className="inline-block text-xs font-medium px-2 py-[2px] rounded-full bg-gray-100 text-gray-600">
        A venir
      </span>
    );
  return (
    <span className="inline-block text-xs font-medium px-2 py-[2px] rounded-full bg-green-100 text-green-700">
      Terminé
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    commune: "bg-amber-100 text-amber-700",
    individuelle: "bg-pink-100 text-pink-700",
    groupe: "bg-green-100 text-green-700",
  };
  const label: Record<string, string> = {
    commune: "Sur table",
    individuelle: "Individuelle",
    groupe: "Groupe",
  };
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-[2px] rounded-full ${map[type] ?? "bg-gray-100 text-gray-700"}`}
    >
      {label[type] ?? type}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CreationPage() {
  const { user, role } = useAuth();
  const { toast } = useToast();

  /* ---- inscription window ---- */
  const [deadlineCandidats, setDeadlineCandidats] = useState("");
  const [deadlineMembres, setDeadlineMembres] = useState("");
  const [savingDeadlines, setSavingDeadlines] = useState(false);

  /* ---- tours ---- */
  const [tours, setTours] = useState<Tour[]>([]);

  /* ---- épreuves ---- */
  const [epreuves, setEpreuves] = useState<Epreuve[]>([]);

  /* ---- modal ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewEpreuveForm>({ ...EMPTY_FORM });
  const [creatingEpreuve, setCreatingEpreuve] = useState(false);
  const [editingEpreuveId, setEditingEpreuveId] = useState<string | null>(null);

  /* ---- tour deletion modal ---- */
  const [tourToDelete, setTourToDelete] = useState<Tour | null>(null);
  const [deletingTour, setDeletingTour] = useState(false);

  /* ================================================================ */
  /*  Data fetching                                                    */
  /* ================================================================ */

  useEffect(() => {
    fetchSettings();
    fetchTours();
    fetchEpreuves();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get("/settings");
      if (res.data.deadline_candidats) setDeadlineCandidats(res.data.deadline_candidats);
      if (res.data.deadline_membres) setDeadlineMembres(res.data.deadline_membres);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTours = async () => {
    try {
      const res = await api.get("/tours");
      setTours(res.data);
    } catch {
      /* fallback hardcoded data when API does not exist */
      setTours([
        { id: "1", name: "Tour 1", status: "en_cours", candidateCount: 42 },
        { id: "2", name: "Tour 2", status: "a_venir", candidateCount: 0 },
      ]);
    }
  };

  const fetchEpreuves = async () => {
    try {
      const res = await api.get("/epreuves");
      setEpreuves(res.data);
    } catch {
      setEpreuves([]);
    }
  };

  /* ================================================================ */
  /*  Handlers                                                         */
  /* ================================================================ */

  const handleSaveDeadlines = async () => {
    setSavingDeadlines(true);
    try {
      await api.put("/settings", {
        deadline_candidats: deadlineCandidats,
        deadline_membres: deadlineMembres,
      });
      toast("Fenêtre d\u2019inscription sauvegardée", "success");
    } catch {
      toast("Erreur lors de la sauvegarde", "error");
    } finally {
      setSavingDeadlines(false);
    }
  };

  const openModal = () => {
    setEditingEpreuveId(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEditModal = (ep: any) => {
    setEditingEpreuveId(ep.id);
    const criteres = Array.isArray(ep.evaluationQuestions)
      ? ep.evaluationQuestions.map((q: any) => ({ name: q.q || q.name || '', coefficient: q.weight || q.coefficient || 1 }))
      : [{ name: '', coefficient: 1 }];
    setForm({
      name: ep.name || '',
      tourId: String(ep.tour || ''),
      type: ep.type || 'commune',
      date: ep.date || '',
      time: ep.time || '',
      salle: ep.salle || '',
      presentedBy: ep.presentedBy || '',
      dateDebut: ep.dateDebut || "",
      dateFin: ep.dateFin || "",
      duree: String(ep.durationMinutes || ""),
      roulementMinutes: String(ep.roulementMinutes || "10"),
      pole: ep.pole || "",
      description: ep.description || "",
      documents: null,
      criteres,
    });
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const handleFormChange = (field: keyof NewEpreuveForm, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addCritere = () => {
    setForm((prev) => ({
      ...prev,
      criteres: [...prev.criteres, { name: "", coefficient: 1 }],
    }));
  };

  const updateCritere = (idx: number, field: keyof Critere, value: any) => {
    setForm((prev) => {
      const updated = [...prev.criteres];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, criteres: updated };
    });
  };

  const removeCritere = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      criteres: prev.criteres.filter((_, i) => i !== idx),
    }));
  };

  const handleCreateEpreuve = async () => {
    setCreatingEpreuve(true);
    try {
      const payload: any = {
        name: form.name,
        tour: form.tourId ? parseInt(form.tourId) : 1,
        type: form.type,
        durationMinutes: form.duree ? parseInt(form.duree) : 30,
        evaluationQuestions: form.criteres.map(c => ({ q: c.name, weight: c.coefficient })),
        pole: form.pole || null,
        isPoleTest: !!form.pole,
        roulementMinutes: form.roulementMinutes ? parseInt(form.roulementMinutes) : 10,
        dateDebut: form.dateDebut || null,
        dateFin: form.dateFin || null,
        description: form.description || null,
      };

      if (editingEpreuveId) {
        await api.put(`/epreuves/${editingEpreuveId}`, payload);
        toast("Épreuve modifiée", "success");
      } else {
        await api.post("/epreuves", payload);
        toast("Épreuve créée", "success");
      }
      closeModal();
      setEditingEpreuveId(null);
      fetchEpreuves();
    } catch (err: any) {
      console.error('Erreur création/modification épreuve:', err);
      const msg = err.response?.data?.error || err.message || "Erreur lors de la sauvegarde";
      toast(msg, "error");
    } finally {
      setCreatingEpreuve(false);
    }
  };

  const handleDeleteEpreuve = async () => {
    if (!editingEpreuveId) return;
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette épreuve ?")) return;
    try {
      await api.delete(`/epreuves/${editingEpreuveId}`);
      toast("Épreuve supprimée", "success");
      closeModal();
      setEditingEpreuveId(null);
      fetchEpreuves();
    } catch (err: any) {
      console.error('Erreur suppression épreuve:', err);
      const msg = err.response?.data?.error || err.message || "Erreur lors de la suppression";
      toast(msg, "error");
    }
  };

  const handleDeleteTour = async () => {
    if (!tourToDelete) return;
    setDeletingTour(true);
    try {
      await api.delete(`/tours/${tourToDelete.id}`);
      setTours((prev) => prev.filter((t) => t.id !== tourToDelete.id));
      toast("Tour supprimé", "success");
      setTourToDelete(null);
    } catch (err: any) {
      console.error('Erreur suppression tour:', err);
      const msg = err.response?.data?.error || err.message || "Erreur lors de la suppression";
      toast(msg, "error");
    } finally {
      setDeletingTour(false);
    }
  };

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="max-w-[960px] mx-auto py-8 px-4">
      {/* ---------- Page header ---------- */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Création</h1>
        <p className="text-sm text-gray-500 mt-1">Tours, épreuves et inscriptions</p>
      </div>

      {/* ================================================================ */}
      {/*  1. Fenêtre d'inscription candidats                              */}
      {/* ================================================================ */}
      <div className="bg-white border border-gray-200 rounded-[10px] p-[18px_20px] mb-[14px]">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          🗓️ Fenêtre d&apos;inscription candidats
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ouverture</label>
            <input
              type="datetime-local"
              value={deadlineCandidats}
              onChange={(e) => setDeadlineCandidats(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fermeture</label>
            <input
              type="datetime-local"
              value={deadlineMembres}
              onChange={(e) => setDeadlineMembres(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={handleSaveDeadlines}
            disabled={savingDeadlines}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {savingDeadlines ? "Sauvegarde..." : "Sauvegarder"}
          </button>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  2. Tours de recrutement                                         */}
      {/* ================================================================ */}
      <div className="bg-white border border-gray-200 rounded-[10px] p-[18px_20px] mb-[14px]">
        <h2 className="text-base font-semibold text-gray-900 mb-4">🏁 Tours de recrutement</h2>

        <div className="space-y-2">
          {tours.map((tour) => (
            <div
              key={tour.id}
              className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-800">{tour.name}</span>
                <StatusBadge status={tour.status} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{tour.candidateCount} candidat(s)</span>
                <button
                  onClick={() => setTourToDelete(tour)}
                  className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                  title="Supprimer ce tour"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </div>
            </div>
          ))}

          {tours.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Aucun tour configuré</p>
          )}
        </div>

        <div className="mt-4">
          <button
            onClick={async () => {
              const name = `Tour ${tours.length + 1}`;
              try {
                const res = await api.post('/tours', { name, status: 'a_venir' });
                setTours(prev => [...prev, res.data]);
                toast('Tour ajouté', 'success');
              } catch {
                toast('Erreur lors de la création du tour', 'error');
              }
            }}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
          >
            + Ajouter un tour
          </button>
        </div>
      </div>

      {/* ---- Modal confirmation suppression tour ---- */}
      {tourToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-[420px] mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Supprimer le tour</h2>
            <p className="text-sm text-gray-600 mb-4">
              Êtes-vous sûr de vouloir supprimer <strong>{tourToDelete.name}</strong> ?
            </p>

            {tourToDelete.candidateCount > 0 && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-medium text-red-700">⚠️ Attention</p>
                <p className="text-sm text-red-600 mt-1">
                  Ce tour contient <strong>{tourToDelete.candidateCount} candidat(s)</strong>.
                  La suppression entraînera la perte de leurs données pour ce tour.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setTourToDelete(null)}
                disabled={deletingTour}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleDeleteTour}
                disabled={deletingTour}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deletingTour ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  3. Épreuves & Formations                                        */}
      {/* ================================================================ */}
      <div className="bg-white border border-gray-200 rounded-[10px] p-[18px_20px] mb-[14px]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">📝 Épreuves &amp; Formations</h2>
          <button
            onClick={openModal}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            + Créer une épreuve
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-[10px] overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Tour</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Date(s)</th>
                <th className="px-4 py-3 font-medium text-center">Visible candidats</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {epreuves.map((ep) => (
                <tr key={ep.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{ep.name}</td>
                  <td className="px-4 py-3 text-gray-600">{ep.tourName}</td>
                  <td className="px-4 py-3">
                    <TypeBadge type={ep.type} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {ep.date
                      ? ep.date
                      : ep.dateDebut && ep.dateFin
                        ? `${ep.dateDebut} → ${ep.dateFin}`
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-base">
                    {ep.visibleCandidats ? "🟢" : "⚪"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEditModal(ep)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Modifier
                    </button>
                  </td>
                </tr>
              ))}

              {epreuves.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">
                    Aucune épreuve créée
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  Modal – Nouvelle épreuve                                        */}
      {/* ================================================================ */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/40"
          />

          {/* Panel */}
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-[620px] max-h-[90vh] overflow-y-auto mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">{editingEpreuveId ? 'Modifier l\u0027épreuve' : 'Nouvelle épreuve'}</h2>

            {/* Name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleFormChange("name", e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Nom de l&apos;épreuve"
              />
            </div>

            {/* Tour select */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tour</label>
              <select
                value={form.tourId}
                onChange={(e) => handleFormChange("tourId", e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Sélectionner un tour</option>
                {tours.map((t, idx) => {
                  const tourNum = t.name.match(/(\d+)/)?.[1] ?? String(idx + 1);
                  return (
                    <option key={t.id} value={tourNum}>
                      {t.name}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Type select */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) =>
                  handleFormChange("type", e.target.value as "commune" | "individuelle" | "groupe")
                }
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="commune">Sur table (commune, convocation globale)</option>
                <option value="individuelle">Individuelle</option>
                <option value="groupe">Groupe</option>
              </select>
            </div>

            {/* ------- Commune fields ------- */}
            {form.type === "commune" && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => handleFormChange("date", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure</label>
                  <input
                    type="time"
                    value={form.time}
                    onChange={(e) => handleFormChange("time", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Salle</label>
                  <input
                    type="text"
                    value={form.salle}
                    onChange={(e) => handleFormChange("salle", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: Amphi B102"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Présenté par</label>
                  <input
                    type="text"
                    value={form.presentedBy}
                    onChange={(e) => handleFormChange("presentedBy", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Nom du présentateur"
                  />
                </div>
              </div>
            )}

            {/* ------- Individuelle / Groupe fields ------- */}
            {(form.type === "individuelle" || form.type === "groupe") && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date début</label>
                  <input
                    type="date"
                    value={form.dateDebut}
                    onChange={(e) => handleFormChange("dateDebut", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date fin</label>
                  <input
                    type="date"
                    value={form.dateFin}
                    onChange={(e) => handleFormChange("dateFin", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Durée (min)</label>
                  <input
                    type="number"
                    value={form.duree}
                    onChange={(e) => handleFormChange("duree", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Roulement (min)</label>
                  <input
                    type="number"
                    value={form.roulementMinutes}
                    onChange={(e) => handleFormChange("roulementMinutes", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="10"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pôle (Optionnel)</label>
                  <select
                    value={form.pole}
                    onChange={(e) => handleFormChange("pole", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Sélectionner un pôle (optionnel)</option>
                    {POLES.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (visible par les candidats)</label>
              <textarea
                value={form.description}
                onChange={(e) => handleFormChange("description", e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Décrivez le contenu et les attentes de cette épreuve..."
              />
            </div>

            {/* Documents */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Documents</label>
              <input
                type="file"
                multiple
                onChange={(e) => handleFormChange("documents", e.target.files)}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
              />
            </div>

            {/* Critères d'évaluation */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Critères d&apos;évaluation
              </label>

              <div className="space-y-2">
                {form.criteres.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateCritere(idx, "name", e.target.value)}
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Nom du critère"
                    />
                    <input
                      type="number"
                      value={c.coefficient}
                      onChange={(e) => updateCritere(idx, "coefficient", parseFloat(e.target.value) || 0)}
                      className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Coeff."
                      min={0}
                      step={0.5}
                    />
                    {form.criteres.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCritere(idx)}
                        className="text-red-400 hover:text-red-600 text-lg leading-none px-1"
                        title="Supprimer"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addCritere}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Critère
              </button>
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              {editingEpreuveId ? (
                <button
                  onClick={handleDeleteEpreuve}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
                >
                  Supprimer
                </button>
              ) : <div />}
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleCreateEpreuve}
                  disabled={creatingEpreuve || !form.name}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {creatingEpreuve ? "Sauvegarde..." : editingEpreuveId ? "Enregistrer" : "Créer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
