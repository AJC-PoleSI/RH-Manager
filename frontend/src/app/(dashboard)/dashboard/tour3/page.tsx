"use client";

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function Tour3Dashboard() {
  const [slots, setSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pole, setPole] = useState("SI");
  const [newSlot, setNewSlot] = useState({
    dateTime: "",
    maxCapacity: 5,
    pole: "SI"
  });

  const fetchSlots = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tour3/slots?pole=${pole}`);
      if (res.ok) {
        const data = await res.json();
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
  }, [pole]);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/tour3/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSlot)
      });
      if (res.ok) {
        fetchSlots();
        setNewSlot({ ...newSlot, dateTime: "" });
      } else {
        alert("Erreur lors de la création du créneau");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLiberate = async (slotId: string) => {
    try {
      const res = await fetch("/api/tour3/liberate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId })
      });
      if (res.ok) {
        fetchSlots();
      } else {
        alert("Erreur lors de la libération des places");
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Tour 3 - Gestion des Épreuves</h1>
        <p className="text-gray-500 mt-2">Déploiement des créneaux et libération par les examinateurs.</p>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-semibold mb-4">Créer un Créneau (Admin)</h2>
        <form onSubmit={handleCreateSlot} className="flex gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Pôle</label>
            <select 
              value={newSlot.pole} 
              onChange={(e) => setNewSlot({...newSlot, pole: e.target.value})}
              className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl"
            >
              <option value="SI">SI</option>
              <option value="RH">RH</option>
              <option value="COM">COM</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Date & Heure</label>
            <input 
              type="datetime-local" 
              value={newSlot.dateTime}
              onChange={(e) => setNewSlot({...newSlot, dateTime: e.target.value})}
              required
              className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Capacité Max</label>
            <input 
              type="number" 
              value={newSlot.maxCapacity}
              onChange={(e) => setNewSlot({...newSlot, maxCapacity: parseInt(e.target.value)})}
              min={1}
              required
              className="px-4 py-2 w-24 bg-gray-50 border border-gray-200 rounded-xl"
            />
          </div>
          <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition">
            Créer
          </button>
        </form>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Créneaux du pôle</h2>
          <select 
            value={pole} 
            onChange={(e) => setPole(e.target.value)}
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
          <div className="text-gray-500 py-8 text-center">Aucun créneau pour ce pôle.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {slots.map(slot => (
              <div key={slot.id} className="border border-gray-200 p-5 rounded-2xl hover:border-blue-300 transition-colors bg-gradient-to-b from-white to-gray-50">
                <div className="flex justify-between items-start mb-3">
                  <div className="text-lg font-bold text-gray-800">
                    {format(new Date(slot.date_time), "dd MMMM yyyy HH:mm", { locale: fr })}
                  </div>
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                    {slot.pole}
                  </span>
                </div>
                
                <div className="text-sm text-gray-600 mb-4">
                  <p>Inscrits : <span className="font-semibold">{slot.enrolled_count}</span> / {slot.max_capacity}</p>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <button 
                    onClick={() => handleLiberate(slot.id)}
                    className="w-full py-2 bg-green-50 text-green-700 font-medium rounded-xl border border-green-200 hover:bg-green-100 transition"
                  >
                    Me déclarer disponible
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
