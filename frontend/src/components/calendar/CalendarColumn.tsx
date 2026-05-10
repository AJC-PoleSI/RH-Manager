import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CalendarEvent } from "@/types";
import { format, isSameDay, setMinutes, setHours } from "date-fns"; // Added setMinutes
import { fr } from "date-fns/locale";
import { useSettings } from "@/context/SettingsContext";

interface CalendarColumnProps {
  date: Date;
  events: any[];
  onEventClick?: (event: any) => void;
  isMember?: boolean;
  onTimeSlotClick?: (date: Date, hour: number, minute: number) => void;
  variant?: "time-grid" | "simple-list";
}

const HOUR_HEIGHT = 60; // px per hour

// Helper to map date to key
const getDayKey = (date: Date) => {
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return keys[date.getDay()];
};

export const CalendarColumn = ({
  date,
  events,
  onEventClick,
  isMember,
  onTimeSlotClick,
  variant = "time-grid",
}: CalendarColumnProps) => {
  const { settings } = useSettings();
  const { dayStart, dayEnd, slotDuration, weeklySchedule } = settings;

  const dayKey = getDayKey(date);
  // Fallback if schedule missing (though context default has it)
  const dayConfig = weeklySchedule?.[dayKey] || {
    start: dayStart,
    end: dayEnd,
    isOpen: true,
  };

  const dayEvents = useMemo(() => {
    return events.filter((e) => isSameDay(new Date(e.day), date));
  }, [events, date]);

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onTimeSlotClick || variant !== "time-grid") return;

    // Block if closed or outside specific hours
    if (!dayConfig.isOpen) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Calculate minutes from top
    const minutesFromStart = (y / HOUR_HEIGHT) * 60;

    // Quantize to slotDuration
    const slotIndex = Math.floor(minutesFromStart / slotDuration);
    const quantizedMinutes = slotIndex * slotDuration;

    const hour = dayStart + Math.floor(quantizedMinutes / 60);
    const minute = quantizedMinutes % 60; // 0, 15, 30, 45

    // Check per-day bounds
    if (hour < dayConfig.start || hour >= dayConfig.end) return;

    if (hour >= dayStart && hour < dayEnd) {
      onTimeSlotClick(date, hour, minute);
    }
  };

  if (variant === "simple-list") {
    return (
      <div className="flex-1 min-w-[200px] border-r border-gray-100 last:border-r-0 flex flex-col">
        <div className="text-center p-3 border-b border-gray-100 bg-white sticky top-0 z-10">
          <div className="text-sm font-medium text-gray-500 uppercase">
            {format(date, "EEEE", { locale: fr })}
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {format(date, "d")}
          </div>
        </div>
        <div className="flex-1 bg-gray-50/10 p-2 space-y-2 overflow-y-auto">
          {dayEvents.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-4">
              Aucun événement
            </div>
          )}
          {dayEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick?.(event)}
              className={cn(
                "w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm",
                event.isDeadline
                  ? "bg-red-50 border-red-300 text-red-900 font-bold"
                  : event.isSlot
                    ? "bg-purple-50 border-purple-300 text-purple-900"
                    : event.relatedEpreuveId
                      ? "bg-blue-50 border-blue-200 text-blue-900"
                      : "bg-white border-gray-200 text-gray-900",
              )}
            >
              <div className="font-semibold text-sm truncate">
                {event.title}
              </div>
              <div className="text-xs mt-1 opacity-70 flex items-center gap-1">
                {event.startTime} - {event.endTime}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Grid Rendering
  const totalMinutes = (dayEnd - dayStart) * 60;
  const numberOfSlots = Math.floor(totalMinutes / slotDuration);

  // Calculate disabled zones heights
  const topDisabledHeight = dayConfig.isOpen
    ? (dayConfig.start - dayStart) * HOUR_HEIGHT
    : (dayEnd - dayStart) * HOUR_HEIGHT;
  const bottomDisabledTop = dayConfig.isOpen
    ? (dayConfig.end - dayStart) * HOUR_HEIGHT
    : 0;
  const bottomDisabledHeight = dayConfig.isOpen
    ? (dayEnd - dayConfig.end) * HOUR_HEIGHT
    : 0;

  return (
    <div className="flex-1 min-w-[200px] border-r border-gray-100 last:border-r-0 flex flex-col">
      <div className="text-center p-3 border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="text-sm font-medium text-gray-500 uppercase">
          {format(date, "EEEE", { locale: fr })}
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {format(date, "d")}
        </div>
      </div>
      <div
        className={cn(
          "relative flex-1 transition-colors",
          dayConfig.isOpen
            ? "bg-white cursor-pointer hover:bg-gray-50"
            : "bg-gray-100 cursor-not-allowed",
        )}
        style={{ height: (dayEnd - dayStart) * HOUR_HEIGHT }}
        onClick={handleColumnClick}
      >
        {/* Visual "Closed" state */}
        {!dayConfig.isOpen && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm font-medium uppercase tracking-widest">
            Fermé
          </div>
        )}

        {/* Grid lines */}
        {dayConfig.isOpen &&
          Array.from({ length: numberOfSlots }).map((_, i) => {
            const slotTimeMinutes = i * slotDuration;
            const top = (slotTimeMinutes / 60) * HOUR_HEIGHT;

            const absoluteMinutes = dayStart * 60 + slotTimeMinutes;
            const h = Math.floor(absoluteMinutes / 60);
            const m = absoluteMinutes % 60;

            const isFullHour = m === 0;

            return (
              <div
                key={i}
                className={cn(
                  "absolute w-full border-gray-100 text-xs text-gray-300 pl-1 pointer-events-none flex items-center",
                  isFullHour
                    ? "border-b-2"
                    : "border-b border-dashed opacity-50",
                )}
                style={{ top: top, height: (slotDuration / 60) * HOUR_HEIGHT }}
              >
                {isFullHour && <span className="-mt-[20px]">{h}:00</span>}
              </div>
            );
          })}

        {/* Disabled Zones (Gray overlays for closed hours within open but partial day) */}
        {dayConfig.isOpen && topDisabledHeight > 0 && (
          <div
            className="absolute top-0 left-0 right-0 bg-gray-100/50 border-b border-gray-200"
            style={{ height: topDisabledHeight }}
          />
        )}
        {dayConfig.isOpen && bottomDisabledHeight > 0 && (
          <div
            className="absolute left-0 right-0 bg-gray-100/50 border-t border-gray-200"
            style={{ top: bottomDisabledTop, height: bottomDisabledHeight }}
          />
        )}

        {/* Events Rendering */}
        {dayConfig.isOpen &&
          dayEvents.map((event) => {
            const start = event.startTime.split(":").map(Number);
            const end = event.endTime.split(":").map(Number);

            // Top relative to dayStart
            const startMinutes = (start[0] - dayStart) * 60 + start[1];
            const durationMinutes =
              end[0] * 60 + end[1] - (start[0] * 60 + start[1]);

            // Top position in px
            const top = (startMinutes / 60) * HOUR_HEIGHT;
            const height = (durationMinutes / 60) * HOUR_HEIGHT;

            return (
              <button
                key={event.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick?.(event);
                }}
                className={cn(
                  "absolute left-1 right-1 rounded-md p-2 text-left text-xs transition-all hover:brightness-95 border-l-4 overflow-hidden z-20",
                  event.isAvailability
                    ? "bg-green-100 border-green-500 text-green-700"
                    : event.isSlot
                      ? "bg-purple-100 border-purple-500 text-purple-700"
                      : event.relatedEpreuveId
                        ? "bg-blue-50 border-blue-500 text-blue-700"
                        : "bg-gray-100 border-gray-400 text-gray-700",
                )}
                style={{ top: `${top}px`, height: `${height}px` }}
              >
                <div className="font-semibold truncate">{event.title}</div>
                <div className="opacity-80">
                  {event.startTime} - {event.endTime}
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
};
