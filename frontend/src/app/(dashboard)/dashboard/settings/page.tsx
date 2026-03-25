"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
  pole: string;
  /* shared */
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
  pole: "",
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
    commune: "bg-blue-100 text-blue-700",
    individuelle: "bg-pink-100 text-pink-700",
    groupe: "bg-green-100 text-green-700",
  };
  const label: Record<string, string> = {
    commune: "Commune",
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
    setForm({ ...EMPTY_FORM });
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
        tourId: form.tourId,
        type: form.type,
        criteres: form.criteres,
      };
      if (form.type === "commune") {
        payload.date = form.date;
        payload.time = form.time;
        payload.salle = form.salle;
        payload.presentedBy = form.presentedBy;
      } else {
        payload.dateDebut = form.dateDebut;
        payload.dateFin = form.dateFin;
        payload.duree = form.duree;
        payload.pole = form.pole;
      }
      await api.post("/epreuves", payload);
      toast("Épreuve créée", "success");
      closeModal();
      fetchEpreuves();
    } catch {
      toast("Erreur lors de la création", "error");
    } finally {
      setCreatingEpreuve(false);
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
              <span className="text-xs text-gray-500">{tour.candidateCount} candidat(s)</span>
            </div>
          ))}

          {tours.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Aucun tour configuré</p>
          )}
        </div>

        <div className="mt-4">
          <button className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors">
            + Ajouter un tour
          </button>
        </div>
      </div>

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
                    <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
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
            onClick={closeModal}
          />

          {/* Panel */}
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-[620px] max-h-[90vh] overflow-y-auto mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">Nouvelle épreuve</h2>

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
                {tours.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
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
                <option value="commune">Commune</option>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pôle</label>
                  <input
                    type="text"
                    value={form.pole}
                    onChange={(e) => handleFormChange("pole", e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: Communication"
                  />
                </div>
              </div>
            )}

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
            <div className="flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleCreateEpreuve}
                disabled={creatingEpreuve || !form.name || !form.tourId}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {creatingEpreuve ? "Création..." : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
