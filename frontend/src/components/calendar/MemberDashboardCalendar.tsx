import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MemberDashboardCalendarProps {
    mySlots: any[];
    events: any[];
    deadlines: any;
    user: any;
    currentDate: Date;
    setCurrentDate: (d: Date) => void;
    myAvailabilities?: any[];
}

export default function MemberDashboardCalendar({
    mySlots, events, deadlines, user, currentDate, setCurrentDate, myAvailabilities = []
}: MemberDashboardCalendarProps) {
    const DAYS_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const MONTHS_LABELS = [
        "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
    ];

    const memberYear = currentDate.getFullYear();
    const memberMonth = currentDate.getMonth();
    const memberDaysInMonth = new Date(memberYear, memberMonth + 1, 0).getDate();
    const memberFirstDay = (() => {
        const d = new Date(memberYear, memberMonth, 1).getDay();
        return d === 0 ? 6 : d - 1;
    })();

    const memberCells: (number | null)[] = [];
    for (let i = 0; i < memberFirstDay; i++) memberCells.push(null);
    for (let d = 1; d <= memberDaysInMonth; d++) memberCells.push(d);
    while (memberCells.length % 7 !== 0) memberCells.push(null);

    const memberToday = new Date();
    const isMemberToday = (day: number) =>
        memberToday.getFullYear() === memberYear &&
        memberToday.getMonth() === memberMonth &&
        memberToday.getDate() === day;

    const memberWeekDates = (() => {
        const d = new Date(currentDate);
        const dow = d.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        const mon = new Date(d);
        mon.setDate(d.getDate() + diff);
        return Array.from({ length: 7 }, (_, i) => {
            const wd = new Date(mon);
            wd.setDate(mon.getDate() + i);
            return wd;
        });
    })();

    const [memberViewMode, setMemberViewMode] = useState<"month" | "week">("month");
    const [selectedMemberSlot, setSelectedMemberSlot] = useState<any>(null);

    // Build combined events from mySlots + calendar events
    const memberCalEvents = useMemo(() => {
        const allEvents: any[] = [];

        // 0. Disponibilités (availabilities)
        myAvailabilities.forEach((avail: any) => {
            const dateRaw = avail.date || "";
            let dateStr = "";
            if (dateRaw) {
                const d = new Date(dateRaw);
                dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            }
            allEvents.push({
                id: `avail-${avail.id}`,
                title: "Disponibilité",
                date: dateStr,
                startTime: avail.startTime || null,
                endTime: avail.endTime || null,
                type: "availability",
                description: "Vous avez indiqué être disponible à cet horaire.",
            });
        });

        // 1. Slots assignés → événements "slot"
        mySlots.forEach((slot: any) => {
            const dateRaw = slot.date || "";
            let dateStr = "";
            if (dateRaw) {
                const d = new Date(dateRaw);
                dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            }
            const candidates = (slot.enrollments || []).map((e: any) => ({
                firstName: e.candidate?.first_name || e.candidate?.firstName || "",
                lastName: e.candidate?.last_name || e.candidate?.lastName || "",
            }));
            const coEvals = (slot.members || [])
                .filter((m: any) => m.member?.id !== user?.id)
                .map((m: any) => m.member?.email || "Membre");

            const hasCandidates = candidates.length > 0;

            allEvents.push({
                id: `slot-${slot.id}`,
                title: slot.epreuve?.name || "Évaluation",
                date: dateStr,
                startTime: slot.start_time || slot.startTime || null,
                endTime: slot.end_time || slot.endTime || null,
                type: hasCandidates ? "slot_filled" : "slot_empty",
                room: slot.room || null,
                tour: slot.epreuve?.tour,
                candidates,
                coEvals,
                status: slot.status,
            });
        });

        // 2. Calendar events (globaux + assignés)
        events.forEach((ev: any) => {
            if (ev.isSlot || ev.isDeadline) return;

            let dateStr = "";
            const dayVal = ev.day || ev.date || "";
            if (dayVal) {
                const d = new Date(dayVal);
                dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            }

            let dateEndStr = "";
            if (ev.day_end || ev.dateEnd) {
                const de = new Date(ev.day_end || ev.dateEnd);
                dateEndStr = `${de.getFullYear()}-${String(de.getMonth() + 1).padStart(2, "0")}-${String(de.getDate()).padStart(2, "0")}`;
            }

            const isHidden = ev.visible_to_candidates === false;
            const evType = ev.is_global ? "global" : "event";

            const baseEvent = {
                id: ev.id,
                title: ev.title || "Événement",
                date: dateStr,
                dateEnd: dateEndStr || undefined,
                startTime: ev.startTime || ev.start_time || null,
                endTime: ev.endTime || ev.end_time || null,
                type: evType,
                description: ev.description || null,
                color: ev.color || null,
                isHidden,
            };

            // Multi-day expand
            if (dateEndStr && dateEndStr !== dateStr) {
                const start = new Date(dateStr + "T00:00:00");
                const end = new Date(dateEndStr + "T00:00:00");
                let cur = new Date(start);
                let idx = 0;
                while (cur <= end) {
                    const curStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
                    allEvents.push({ ...baseEvent, id: `${ev.id}-d${idx}`, date: curStr });
                    cur.setDate(cur.getDate() + 1);
                    idx++;
                }
            } else {
                allEvents.push(baseEvent);
            }
        });

        // 3. Deadlines
        if (deadlines?.deadline_candidats) {
            allEvents.push({
                id: "deadline-candidats",
                title: "Deadline Candidats",
                date: deadlines.deadline_candidats,
                startTime: "08:00",
                endTime: "08:30",
                type: "deadline",
            });
        }
        if (deadlines?.deadline_membres) {
            allEvents.push({
                id: "deadline-membres",
                title: "Deadline Membres",
                date: deadlines.deadline_membres,
                startTime: "08:00",
                endTime: "08:30",
                type: "deadline",
            });
        }

        return allEvents;
    }, [myAvailabilities, mySlots, events, deadlines, user?.id]);

    const getMemberEventsForDay = (day: number) => {
        const dateStr = `${memberYear}-${String(memberMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        return memberCalEvents.filter((e) => e.date === dateStr);
    };

    const getMemberEventsForDate = (date: Date) => {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return memberCalEvents.filter((e) => e.date === dateStr);
    };

    const typeStylesMember: Record<string, { bg: string; text: string; dot: string; label: string; border?: string }> = {
        slot_filled: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500", label: "Créneau validé", border: "border-green-200" },
        slot_empty: { bg: "bg-gray-100", text: "text-gray-700", dot: "bg-gray-400", label: "Créneau assigné", border: "border-gray-200" },
        availability: { bg: "bg-gray-50/80", text: "text-gray-500", dot: "bg-gray-300", label: "Disponibilité", border: "border-dashed border-gray-300" },
        global: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Événement global", border: "border-blue-100" },
        event: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Événement", border: "border-emerald-100" },
        deadline: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", label: "Deadline", border: "border-red-200" },
    };

    // Upcoming events (7 days)
    const upcomingMemberEvents = useMemo(() => {
        const now = new Date();
        const in7 = new Date(now);
        in7.setDate(in7.getDate() + 7);
        return memberCalEvents
            .filter((e) => {
                if (!e.date) return false;
                const d = new Date(e.date + "T00:00:00");
                return d >= now && d <= in7;
            })
            .sort((a, b) => {
                const da = new Date(a.date + "T" + (a.startTime || "00:00"));
                const db = new Date(b.date + "T" + (b.startTime || "00:00"));
                return da.getTime() - db.getTime();
            });
    }, [memberCalEvents]);

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">Mon calendrier</h1>
                <p className="text-sm text-gray-500 mt-1">Vos créneaux assignés, évaluations et événements</p>
            </div>

            {/* Upcoming events */}
            {upcomingMemberEvents.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
                        🔔 Prochains événements (7 jours)
                    </h2>
                    <div className="space-y-2">
                        {upcomingMemberEvents.slice(0, 5).map((ev) => {
                            const style = typeStylesMember[ev.type] || typeStylesMember.event;
                            return (
                                <button
                                    key={ev.id}
                                    onClick={() => setSelectedMemberSlot(ev)}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{ev.title}</p>
                                        <p className="text-xs text-gray-500">
                                            {new Date(ev.date + "T12:00:00").toLocaleDateString("fr-FR", {
                                                weekday: "short", day: "numeric", month: "short",
                                            })}
                                            {ev.startTime && ` à ${ev.startTime.slice(0, 5)}`}
                                        </p>
                                    </div>
                                    {ev.room && (
                                        <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full flex-shrink-0">
                                            🏫 {ev.room}
                                        </span>
                                    )}
                                    {ev.isHidden && (
                                        <span className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded flex-shrink-0 border border-red-200">
                                            🙈 Masqué
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            if (memberViewMode === "month") setCurrentDate(new Date(memberYear, memberMonth - 1, 1));
                            else { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); }
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-lg font-semibold text-gray-900 min-w-[200px] text-center">
                        {memberViewMode === "month"
                            ? `${MONTHS_LABELS[memberMonth]} ${memberYear}`
                            : `${memberWeekDates[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} - ${memberWeekDates[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`
                        }
                    </span>
                    <button
                        onClick={() => {
                            if (memberViewMode === "month") setCurrentDate(new Date(memberYear, memberMonth + 1, 1));
                            else { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); }
                        }}
                        className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
                    >
                        <ChevronRight size={16} />
                    </button>
                    <button
                        onClick={() => setCurrentDate(new Date())}
                        className="ml-2 px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors"
                    >
                        Aujourd&apos;hui
                    </button>
                </div>

                <div className="flex bg-gray-100 rounded-full p-0.5">
                    {(["month", "week"] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setMemberViewMode(mode)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                                memberViewMode === mode
                                    ? "bg-white text-gray-900 shadow-sm"
                                    : "text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            {mode === "month" ? "Mois" : "Semaine"}
                        </button>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    Créneau avec candidat(s)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                    Créneau assigné
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-200 border border-gray-300 border-dashed" />
                    Disponibilité
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    Événement global
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    Deadline
                </span>
            </div>

            {/* ═══ VUE MOIS ═══ */}
            {memberViewMode === "month" && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-7 border-b border-gray-200">
                        {DAYS_LABELS.map((d) => (
                            <div key={d} className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                {d}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7">
                        {memberCells.map((day, i) => {
                            const dayEvents = day ? getMemberEventsForDay(day) : [];
                            return (
                                <div
                                    key={i}
                                    className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 ${
                                        day === null ? "bg-gray-50/50" : "bg-white"
                                    } ${i % 7 === 6 ? "border-r-0" : ""}`}
                                >
                                    {day !== null && (
                                        <>
                                            <div
                                                className={`text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
                                                    isMemberToday(day) ? "bg-blue-600 text-white" : "text-gray-700"
                                                }`}
                                            >
                                                {day}
                                            </div>
                                            <div className="space-y-0.5">
                                                {dayEvents.map((ev) => {
                                                    const style = typeStylesMember[ev.type] || typeStylesMember.event;
                                                    const customStyle = ev.color ? { backgroundColor: ev.color, color: "#fff" } : {};
                                                    const borderClass = style.border ? `border ${style.border}` : "";
                                                    const classes = ev.color ? "" : `${style.bg} ${style.text} ${borderClass}`;
                                                    return (
                                                        <button
                                                            key={ev.id}
                                                            onClick={() => setSelectedMemberSlot(ev)}
                                                            className={`w-full text-left text-[11px] leading-tight px-1.5 py-1 rounded-md truncate font-medium transition-opacity hover:opacity-80 ${classes}`}
                                                            style={customStyle}
                                                            title={`${ev.title}${ev.room ? ` — ${ev.room}` : ""}${ev.startTime ? ` ${ev.startTime.slice(0, 5)}` : ""}`}
                                                        >
                                                            {ev.startTime && (
                                                                <span className="font-semibold">{ev.startTime.slice(0, 5)} </span>
                                                            )}
                                                            {ev.title}
                                                            {ev.isHidden && " 🙈"}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ═══ VUE SEMAINE ═══ */}
            {memberViewMode === "week" && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-7">
                        {memberWeekDates.map((wd, i) => {
                            const dateEvents = getMemberEventsForDate(wd);
                            const isTodayDate =
                                wd.getFullYear() === memberToday.getFullYear() &&
                                wd.getMonth() === memberToday.getMonth() &&
                                wd.getDate() === memberToday.getDate();
                            return (
                                <div key={i} className="border-r border-gray-100 last:border-r-0">
                                    <div className={`p-3 text-center border-b border-gray-200 ${isTodayDate ? "bg-blue-50" : "bg-gray-50"}`}>
                                        <p className="text-xs font-semibold text-gray-500 uppercase">{DAYS_LABELS[i]}</p>
                                        <p className={`text-xl font-bold mt-0.5 ${isTodayDate ? "text-blue-600" : "text-gray-900"}`}>
                                            {wd.getDate()}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {wd.toLocaleDateString("fr-FR", { month: "short" })}
                                        </p>
                                    </div>
                                    <div className="p-2 min-h-[200px] space-y-1.5">
                                        {dateEvents.length === 0 && (
                                            <p className="text-xs text-gray-300 text-center mt-4">—</p>
                                        )}
                                        {dateEvents.map((ev) => {
                                            const style = typeStylesMember[ev.type] || typeStylesMember.event;
                                            const customStyle = ev.color ? { backgroundColor: ev.color, color: "#fff", borderColor: "transparent" } : {};
                                            const borderClass = style.border ? style.border : "border-transparent";
                                            const classes = ev.color ? "" : `${style.bg} ${style.text}`;
                                            return (
                                                <button
                                                    key={ev.id}
                                                    onClick={() => setSelectedMemberSlot(ev)}
                                                    className={`w-full text-left p-2 rounded-lg border text-xs transition-all hover:shadow-sm ${classes} ${borderClass}`}
                                                    style={customStyle}
                                                >
                                                    <p className="font-semibold truncate">{ev.title}</p>
                                                    {ev.startTime && (
                                                        <p className="mt-0.5 opacity-80">
                                                            {ev.startTime.slice(0, 5)}
                                                            {ev.endTime ? ` - ${ev.endTime.slice(0, 5)}` : ""}
                                                        </p>
                                                    )}
                                                    {ev.room && (
                                                        <p className="mt-0.5 flex items-center gap-0.5 opacity-70">
                                                            🏫 {ev.room}
                                                        </p>
                                                    )}
                                                    {ev.isHidden && (
                                                        <p className="mt-0.5 text-red-500 text-[10px]">🙈 Masqué candidats</p>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {memberCalEvents.length === 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
                    <span className="text-4xl block mb-3">📅</span>
                    <p className="text-gray-500 font-medium">Aucun événement prévu</p>
                    <p className="text-sm text-gray-400 mt-1">
                        Vos créneaux et événements apparaîtront ici une fois planifiés.
                    </p>
                </div>
            )}

            {/* ═══ MODALE DÉTAIL ═══ */}
            {selectedMemberSlot && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedMemberSlot(null)}>
                    <div
                        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Color accent */}
                        {(() => {
                            const dotColor = selectedMemberSlot.type === "slot_filled" ? "#10B981" : selectedMemberSlot.type === "slot_empty" ? "#9CA3AF" : selectedMemberSlot.type === "availability" ? "#D1D5DB" : selectedMemberSlot.type === "global" ? "#3B82F6" : selectedMemberSlot.type === "deadline" ? "#EF4444" : "#10B981";
                            return <div className="h-2" style={{ backgroundColor: dotColor }} />;
                        })()}

                        <div className="px-6 py-5 space-y-4">
                            {/* Header */}
                            <div className="flex items-start justify-between">
                                <div>
                                    <h1 className="text-xl font-semibold text-gray-900">{selectedMemberSlot.title}</h1>
                                    <span
                                        className={`inline-block mt-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            typeStylesMember[selectedMemberSlot.type]?.bg || ""
                                        } ${typeStylesMember[selectedMemberSlot.type]?.text || ""}`}
                                    >
                                        {typeStylesMember[selectedMemberSlot.type]?.label || "Événement"}
                                    </span>
                                    {selectedMemberSlot.isHidden && (
                                        <span className="inline-block ml-2 mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 border border-red-200">
                                            🙈 Masqué pour les candidats
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setSelectedMemberSlot(null)}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Details */}
                            <div className="space-y-3">
                                {selectedMemberSlot.date && (
                                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                                        <span className="text-blue-500">🗓️</span>
                                        <div>
                                            <p className="text-xs text-gray-400 font-medium">Date</p>
                                            <p className="text-sm font-semibold text-gray-900 capitalize">
                                                {new Date(selectedMemberSlot.date + "T12:00:00").toLocaleDateString("fr-FR", {
                                                    weekday: "long", day: "numeric", month: "long", year: "numeric",
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {selectedMemberSlot.startTime && (
                                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                                        <span className="text-purple-500">🕐</span>
                                        <div>
                                            <p className="text-xs text-gray-400 font-medium">Horaire</p>
                                            <p className="text-sm font-semibold text-gray-900">
                                                {selectedMemberSlot.startTime.slice(0, 5)}
                                                {selectedMemberSlot.endTime && ` - ${selectedMemberSlot.endTime.slice(0, 5)}`}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {selectedMemberSlot.room && (
                                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                                        <span className="text-blue-600">🏫</span>
                                        <div>
                                            <p className="text-xs text-blue-500 font-medium">Salle</p>
                                            <p className="text-sm font-bold text-blue-800">{selectedMemberSlot.room}</p>
                                        </div>
                                    </div>
                                )}

                                {selectedMemberSlot.tour && (
                                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                                        <span className="text-gray-500">📋</span>
                                        <div>
                                            <p className="text-xs text-gray-400 font-medium">Tour</p>
                                            <p className="text-sm font-semibold text-gray-900">Tour {selectedMemberSlot.tour}</p>
                                        </div>
                                    </div>
                                )}

                                {/* Candidats à évaluer */}
                                {selectedMemberSlot.candidates && selectedMemberSlot.candidates.length > 0 && (
                                    <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                                        <span className="text-amber-600 mt-0.5">👤</span>
                                        <div className="flex-1">
                                            <p className="text-xs text-amber-600 font-medium mb-1.5">Candidat(s) à évaluer</p>
                                            <div className="space-y-1.5">
                                                {selectedMemberSlot.candidates.map((c: any, idx: number) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                        <span className="w-6 h-6 rounded-full bg-amber-200 text-amber-800 text-[10px] font-bold flex items-center justify-center">
                                                            {(c.firstName?.[0] || "?").toUpperCase()}{(c.lastName?.[0] || "").toUpperCase()}
                                                        </span>
                                                        <span className="text-sm text-gray-800">{c.firstName} {c.lastName}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Aucun candidat et c'est un créneau assigné */}
                                {selectedMemberSlot.candidates && selectedMemberSlot.candidates.length === 0 && (selectedMemberSlot.type === "slot_empty" || selectedMemberSlot.type === "slot_filled") && (
                                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                                        <span className="text-gray-400">👤</span>
                                        <p className="text-sm text-gray-400 italic">Aucun candidat inscrit sur ce créneau</p>
                                    </div>
                                )}

                                {/* Co-évaluateurs */}
                                {selectedMemberSlot.coEvals && selectedMemberSlot.coEvals.length > 0 && (
                                    <div className="flex items-start gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                                        <span className="text-indigo-600 mt-0.5">👥</span>
                                        <div className="flex-1">
                                            <p className="text-xs text-indigo-600 font-medium mb-1.5">Co-évaluateur(s)</p>
                                            <div className="space-y-1">
                                                {selectedMemberSlot.coEvals.map((email: string, idx: number) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                        <span className="w-6 h-6 rounded-full bg-indigo-200 text-indigo-800 text-[10px] font-bold flex items-center justify-center">
                                                            {(email[0] || "?").toUpperCase()}
                                                        </span>
                                                        <span className="text-sm text-gray-800">{email}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {selectedMemberSlot.description && (
                                    <p className="text-sm text-gray-500 italic border-t border-gray-100 pt-3">
                                        {selectedMemberSlot.description}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
                            <button
                                onClick={() => setSelectedMemberSlot(null)}
                                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-lg text-sm hover:bg-gray-100 transition-colors shadow-sm"
                            >
                                Fermer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
