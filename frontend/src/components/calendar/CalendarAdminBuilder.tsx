"use client";

import { useState, useEffect } from "react";
import api from "@/lib/api";

interface CalendarAdminBuilderProps {
  selectedEpreuveId: string;
  epreuve: any; // Pénible à typer parfaitement ici, on s'adapte
  toast: any;
  onUpdate: () => void;
}

export default function CalendarAdminBuilder({
  selectedEpreuveId,
  epreuve,
  toast,
  onUpdate,
}: CalendarAdminBuilderProps) {
  const [existingSlots, setExistingSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Modal creation
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [selectedRooms, setSelectedRooms] = useState<number[]>([]);

  // Computed days
  const validDays = getValidDays(epreuve?.dateDebut, epreuve?.dateFin);
  const [activeTabDay, setActiveTabDay] = useState<string>(validDays[0] || "");

  useEffect(() => {
    if (validDays.length > 0 && !validDays.includes(activeTabDay)) {
      setActiveTabDay(validDays[0]);
    }
  }, [epreuve, validDays]);

  useEffect(() => {
    if (selectedEpreuveId) {
      fetchSlots();
    }
  }, [selectedEpreuveId]);

  async function fetchSlots() {
    try {
      setLoading(true);
      const res = await api.get(`/slots/all?epreuve=${selectedEpreuveId}`);
      // L'API renvoie tous les slots, on filtre pour être sur
      const filtered = (res.data || []).filter((s: any) => s.epreuve_id === selectedEpreuveId || s.epreuve?.id === selectedEpreuveId);
      setExistingSlots(filtered);
    } catch (e) {
      console.error(e);
      toast("Erreur lors du chargement des créneaux", "error");
    } finally {
      setLoading(false);
    }
  }

  function getValidDays(startStr?: string, endStr?: string) {
    if (!startStr || !endStr) return [];
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);
    const days: string[] = [];
    
    // Au cas où l'admin s'est trompé
    if (dStart > dEnd) return [];

    let current = new Date(dStart);
    while (current <= dEnd) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0: Dimanche, 6: Samedi
        days.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }

  const handleOpenCreation = (day: string) => {
    setSelectedDay(day);
    setSelectedRooms([]);
    setStartTime("08:00");
    setEndTime("12:00");
    setIsModalOpen(true);
  };

  const handleCreatePlage = async () => {
    if (selectedRooms.length === 0) {
      toast("Veuillez sélectionner au moins une salle", "error");
      return;
    }
    if (startTime >= endTime) {
      toast("L'heure de fin doit être après l'heure de début", "error");
      return;
    }
    
    try {
      setLoading(true);
      await api.post("/slots/bulk-create", {
        epreuveId: selectedEpreuveId,
        date: selectedDay,
        startTime,
        endTime,
        rooms: selectedRooms,
      });
      toast("Plage horaire créée avec succès", "success");
      setIsModalOpen(false);
      fetchSlots();
      onUpdate();
    } catch (error: any) {
      toast(error.response?.data?.error || "Erreur création", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    if (!window.confirm("Supprimer ce créneau de manière définitive ?")) return;
    try {
      setLoading(true);
      await api.delete(`/slots/${slotId}`); // Assumant que cette route existe
      toast("Créneau supprimé", "success");
      fetchSlots();
      onUpdate();
    } catch (e) {
      toast("Erreur suppression", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!epreuve) return null;

  if (validDays.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-gray-500 mb-2">Les dates de cette épreuve ne semblent pas configurées (Date de début et fin).</p>
        <p className="text-sm text-gray-400">Veuillez paramétrer l'épreuve dans les Réglages pour utiliser le Calendar Builder.</p>
      </div>
    );
  }

  const nbSalles = parseInt(epreuve.nbSalles || epreuve.nb_salles || "1");
  const sallesArray = Array.from({ length: nbSalles }, (_, i) => i + 1);

  // Group slots by day
  const slotsByDay = existingSlots.reduce((acc, slot) => {
    const d = slot.date.split("T")[0];
    if (!acc[d]) acc[d] = [];
    acc[d].push(slot);
    return acc;
  }, {});

  const currentSlots = slotsByDay[activeTabDay] || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">📅 Calendar Builder</h2>
        {loading && <span className="text-xs text-blue-600 animate-pulse">Synchronisation...</span>}
      </div>

      {/* TABS JOURS */}
      <div className="flex border-b border-gray-100 bg-gray-50/50 px-2 pt-2 gap-1 overflow-x-auto">
        {validDays.map(day => {
          const isActive = activeTabDay === day;
          return (
            <button
              key={day}
              onClick={() => setActiveTabDay(day)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                isActive 
                  ? "bg-white text-blue-600 border-blue-600 shadow-[0_-2px_4px_rgba(0,0,0,0.02)]" 
                  : "text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })}
            </button>
          );
        })}
      </div>

      <div className="p-5 flex-1 bg-gray-50/30">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              Planning du {new Date(activeTabDay).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}
            </h3>
            <p className="text-sm text-gray-500">Gérez les créneaux pour vos {nbSalles} salles en parallèle.</p>
          </div>
          <button
            onClick={() => handleOpenCreation(activeTabDay)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm transition-all flex items-center gap-2"
          >
            <span>+</span>
            Générer une plage
          </button>
        </div>

        {/* GRILLE SALLES */}
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${nbSalles}, minmax(0, 1fr))` }}>
          {sallesArray.map(roomNum => {
            const roomName = `Salle ${roomNum}`;
            const roomSlots = currentSlots.filter((s: any) => s.room === roomName).sort((a: any, b: any) => a.start_time.localeCompare(b.start_time));
            
            return (
              <div key={roomNum} className="flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-100/80 px-4 py-3 border-b border-gray-200">
                  <h4 className="font-semibold text-gray-700 text-center">{roomName}</h4>
                </div>
                
                <div className="p-3 flex flex-col gap-2 min-h-[300px]">
                  {roomSlots.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm">
                      <p>Aucun créneau</p>
                    </div>
                  ) : (
                    roomSlots.map((slot: any) => (
                      <div key={slot.id} className="group relative bg-blue-50 border border-blue-100 rounded-lg p-3 hover:border-blue-300 hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded">
                            {slot.start_time} - {slot.end_time}
                          </span>
                          <button 
                            onClick={() => handleDeleteSlot(slot.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 bg-white p-1 rounded shadow-sm text-xs leading-none"
                            title="Supprimer"
                          >
                            ✕
                          </button>
                        </div>
                        <p className="text-[11px] text-blue-600 mt-1">
                          {slot.duration_minutes}m (Durée pure)
                          {slot.status === 'draft' && <span className="ml-2 text-gray-500 font-semibold uppercase">Brouillon</span>}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL CREATION PLAGE */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Générer une plage horaire</h3>
              <p className="text-sm text-gray-500 mt-1">
                Le système découpera automatiquement la plage en créneaux structurés.
              </p>
            </div>
            
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Début (ex: 08:00)</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fin globale (ex: 12:00)</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Appliquer aux salles</label>
                <div className="flex flex-wrap gap-2">
                  {sallesArray.map(room => {
                    const isSelected = selectedRooms.includes(room);
                    return (
                      <button
                        key={room}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedRooms(prev => prev.filter(r => r !== room));
                          } else {
                            setSelectedRooms(prev => [...prev, room]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          isSelected 
                            ? "bg-blue-600 text-white border-blue-600" 
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        Salle {room}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Annuler
              </button>
              <button
                onClick={handleCreatePlage}
                disabled={loading || selectedRooms.length === 0}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? "Génération..." : "Créer les blocs"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
