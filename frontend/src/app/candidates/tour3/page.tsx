"use client";

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";

export default function CandidateTour3Page() {
  const { user } = useAuth();
  const [slots, setSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [polesDemandés, setPolesDemandés] = useState<string[]>([]);
  
  // Dans un vrai cas, on irait chercher les pôles demandés par le candidat
  // via l'API, par exemple /api/wishes. Pour simplifier, on permet 
  // au candidat de filtrer parmi SI, RH, COM (ou on utilise un mock).
  const [selectedPole, setSelectedPole] = useState("SI");

  const fetchSlots = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tour3/slots?pole=${selectedPole}`);
      if (res.ok) {
        const data = await res.json();
        // Filtrer pour ne montrer que les places qui ont un examinateur assigné 
        // (c'est-à-dire que la place a été libérée par un examinateur)
        // et où le candidat n'est pas encore inscrit (ou c'est lui-même)
        setSlots(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPole]);

  const handleEnroll = async (placeId: string) => {
    if (!user?.id) return;
    try {
      const res = await fetch("/api/tour3/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, candidateId: user.id })
      });
      if (res.ok) {
        alert("Inscription confirmée !");
        fetchSlots();
      } else {
        alert("Erreur lors de l'inscription. La place est peut-être déjà prise.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inscription Tour 3</h1>
        <p className="text-gray-500 mt-2">Choisissez un créneau disponible pour vos pôles demandés.</p>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex gap-4 items-center mb-6">
          <h2 className="text-xl font-semibold">Voir les créneaux pour le pôle :</h2>
          <select 
            value={selectedPole} 
            onChange={(e) => setSelectedPole(e.target.value)}
            className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl"
          >
            <option value="SI">SI</option>
            <option value="RH">RH</option>
            <option value="COM">COM</option>
          </select>
        </div>

        {loading ? (
          <div className="text-gray-500 py-8 text-center animate-pulse">Chargement...</div>
        ) : slots.length === 0 ? (
          <div className="text-gray-500 py-8 text-center">Aucun créneau disponible.</div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {slots.map(slot => {
              // Filtrer les places libres de ce créneau qui ont un examinateur
              const availablePlaces = slot.places?.filter((p: any) => p.examiner_id !== null && p.candidate_id === null) || [];
              const myPlace = slot.places?.find((p: any) => p.candidate_id === user?.id);

              if (availablePlaces.length === 0 && !myPlace) return null;

              return (
                <div key={slot.id} className="border border-gray-200 p-5 rounded-2xl hover:border-blue-300 transition-colors bg-white shadow-sm">
                  <div className="text-lg font-bold text-gray-800 mb-2">
                    {format(new Date(slot.date_time), "dd MMMM yyyy HH:mm", { locale: fr })}
                  </div>
                  <div className="text-sm text-gray-600 mb-4">
                    Pôle: <span className="font-semibold">{slot.pole}</span>
                  </div>

                  {myPlace ? (
                    <div className="p-3 bg-green-50 text-green-700 rounded-xl font-medium text-center border border-green-200">
                      Vous êtes inscrit à ce créneau
                      <br/>
                      <span className="text-sm text-green-600 font-normal">Examinateur: {myPlace.examiner?.email}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-gray-700 mb-2">Places disponibles :</p>
                      {availablePlaces.slice(0, 3).map((place: any) => (
                        <div key={place.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <span className="text-sm text-gray-600 truncate mr-2" title={place.examiner?.email}>
                            Jury: {place.examiner?.email.split('@')[0]}
                          </span>
                          <button 
                            onClick={() => handleEnroll(place.id)}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition shrink-0"
                          >
                            S&apos;inscrire
                          </button>
                        </div>
                      ))}
                      {availablePlaces.length > 3 && (
                        <p className="text-xs text-gray-500 text-center mt-2">+ {availablePlaces.length - 3} autres places</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
