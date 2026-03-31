"use client";

import { useState, useEffect, useMemo } from "react";
import api from "@/lib/api";

interface CalendarMemberBuilderProps {
  memberId: string;
  toast: any;
  epreuvesConfigured: any[];
}

export default function CalendarMemberBuilder({
  memberId,
  toast,
  epreuvesConfigured
}: CalendarMemberBuilderProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tous les créneaux créés par l'admin (date, Heure)
  const [adminSlots, setAdminSlots] = useState<any[]>([]);
  
  // Disponibilités cochées par l'utilisateur: Set is easier for fast toggle. Format "{date}|{start_time}|{end_time}"
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchData();
  }, [memberId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // 1. Fetch tous les slots (creneaux admins)
      // Ne récupérer que ceux avec le status 'draft', 'ready' ou 'published' ? 
      // Si l'admin purge, les dispos des membres disparaîtront au prochain enregistrement car on écrase.
      const resSlots = await api.get('/slots/all');
      
      // On filtre pour ne garder que les slots des épreuves configurées
      const validEpreuveIds = epreuvesConfigured.map(e => e.id);
      const filteredSlots = resSlots.data.filter((s: any) => validEpreuveIds.includes(s.epreuve_id));
      setAdminSlots(filteredSlots);

      // 2. Fetch les disponibilités du membre
      const resAvail = await api.get('/availability/my'); // wait, the route is /availability to GET mine.
      // let's adjust GET to fetch current user's. "GET /api/availability" does exactly this.
      const resMyAvail = await api.get('/availability');
      
      const initials = new Set<string>();
      resMyAvail.data.forEach((av: any) => {
        if (av.date) {
          const dateOnly = av.date.split("T")[0];
          initials.add(`${dateOnly}|${av.start_time}|${av.end_time}`);
        }
      });
      setSelectedBlocks(initials);

    } catch (e) {
      console.error(e);
      toast("Erreur de synchronisation", "error");
    } finally {
      setLoading(false);
    }
  };

  // 3. Traitement des slots pour la grille Calendrier (Jours en colonnes, Heures en lignes)
  const gridData = useMemo(() => {
    const datesSet = new Set<string>();
    const timesSet = new Set<string>();
    const blocksMap = new Map<string, any>(); // key = "date|start|end"

    adminSlots.forEach(slot => {
      if (!slot.date || !slot.start_time || !slot.end_time) return;

      const d = slot.date.split("T")[0];
      datesSet.add(d);
      timesSet.add(slot.start_time);

      const key = `${d}|${slot.start_time}|${slot.end_time}`;
      if (!blocksMap.has(key)) {
        blocksMap.set(key, {
          date: d,
          startTime: slot.start_time,
          endTime: slot.end_time,
          epreuves: new Set<string>(),
          key
        });
      }

      const epreuveName = epreuvesConfigured.find(e => e.id === slot.epreuve_id)?.name || "Epreuve";
      blocksMap.get(key).epreuves.add(epreuveName);
    });

    const uniqueDates = Array.from(datesSet).sort();
    const uniqueTimes = Array.from(timesSet).sort((a, b) => a.localeCompare(b));

    return { uniqueDates, uniqueTimes, blocksMap };
  }, [adminSlots, epreuvesConfigured]);

  const toggleBlock = (key: string) => {
    setSelectedBlocks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const daysOfWeekMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

      const payload = Array.from(selectedBlocks).map(key => {
        const [date, start, end] = key.split("|");
        const weekdayInt = new Date(date).getDay();
        return {
          weekday: daysOfWeekMap[weekdayInt],
          date: date,
          startTime: start,
          endTime: end
        };
      });

      await api.put('/availability', { availabilities: payload });
      toast("Disponibilités synchronisées globales 🎉", "success");
      
    } catch (error: any) {
      console.error(error);
      toast(error.response?.data?.error || "Erreur de sauvegarde", "error");
    } finally {
      setSaving(false);
    }
  };

  const { uniqueDates, uniqueTimes, blocksMap } = gridData;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const formatTime = (t: string) => {
    const parts = t.split(':');
    return `${parts[0]}h${parts[1] || '00'}`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-4 bg-gray-50/50">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">🗓️ Calendrier de mes Disponibilités</h2>
          <p className="text-sm text-gray-500 mt-1">Cochez les tranches horaires où vous êtes libre dans la grille ci-dessous.</p>
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg text-sm hover:bg-blue-700 transition shadow-sm disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? "Sauvegarde..." : "💾 Enregistrer mes disponibilités"}
        </button>
      </div>

      <div className="p-4 overflow-x-auto">
        {uniqueDates.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-xl">
            Aucun créneau d&apos;évaluation n&apos;a encore été généré par l&apos;administration.
          </div>
        ) : (
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr>
                <th className="p-3 font-semibold text-gray-500 bg-gray-50 border-b border-r border-gray-200 sticky left-0 z-10 w-24">Horaire</th>
                {uniqueDates.map(date => {
                    const dateObj = new Date(date);
                    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                    return (
                        <th key={date} className={`p-3 font-semibold text-center border-b border-gray-200 min-w-[140px] ${isWeekend ? 'bg-orange-50/50 text-orange-800' : 'bg-gray-50 text-gray-700'}`}>
                            {dateObj.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                        </th>
                    );
                })}
              </tr>
            </thead>
            <tbody>
              {uniqueTimes.map(time => (
                <tr key={time} className="hover:bg-gray-50/30 transition-colors">
                  <td className="p-3 font-medium text-gray-600 bg-gray-50/50 border-r border-b border-gray-100 sticky left-0 z-10 text-right">
                    {formatTime(time)}
                  </td>
                  {uniqueDates.map(date => {
                    // Chercher un block qui correspond à ce jour et cette heure de début
                    // Vu qu'on indexe par start_time via notre construction blocksMap, on itère pr trouver 
                    let blockKey: string | null = null;
                    let blockObj: any = null;
                    
                    for (const [k, v] of Array.from(blocksMap.entries())) {
                        if (v.date === date && v.startTime === time) {
                            blockKey = k;
                            blockObj = v;
                            break;
                        }
                    }

                    if (!blockKey || !blockObj) {
                        return <td key={`${date}-${time}`} className="p-2 border-b border-gray-100 bg-gray-50/10 text-center"><span className="text-gray-300">-</span></td>;
                    }

                    const isSelected = selectedBlocks.has(blockKey);
                    const epreuvesArr = Array.from(blockObj.epreuves as Set<string>);

                    return (
                      <td key={`${date}-${time}`} className="p-2 border-b border-gray-100 align-top">
                        <div 
                          onClick={() => toggleBlock(blockKey!)}
                          className={`
                            cursor-pointer rounded-lg p-2 h-full min-h-[60px] border-2 transition-all flex flex-col items-center justify-center relative
                            ${isSelected 
                              ? 'bg-blue-50 border-blue-500 shadow-sm' 
                              : 'bg-white border-dashed border-gray-300 hover:border-blue-300 hover:bg-blue-50/30'
                            }
                          `}
                        >
                            {isSelected && (
                                <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                                    <span className="text-white text-[10px] font-bold">✓</span>
                                </div>
                            )}
                            <span className={`text-[11px] font-bold ${isSelected ? 'text-blue-800' : 'text-gray-700'}`}>
                              jusqu&apos;à {formatTime(blockObj.endTime)}
                            </span>
                            <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                                {epreuvesArr.map((ep, idx) => (
                                    <span key={idx} className={`text-[9px] px-1.5 py-0.5 rounded leading-none text-center ${isSelected ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-500'}`}>
                                        {ep}
                                    </span>
                                ))}
                            </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      {/* Footer warning */}
      <div className="px-5 py-3 border-t border-gray-100 bg-amber-50 flex items-start gap-3">
        <span className="text-amber-600 text-lg leading-none mt-0.5">⚠️</span>
        <p className="text-xs text-amber-800">
          <strong>N&apos;oubliez pas d&apos;Enregistrer</strong> pour figer vos disponibilités dans le système. Les cases grisées correspondent à des absences de configuration d&apos;épreuve pour ces horaires.
        </p>
      </div>
    </div>
  );
}
