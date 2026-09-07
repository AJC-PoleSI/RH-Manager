import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// POST /api/slots/generate — generate slots from availability crossings (admin)
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, startDate, endDate, membersPerSlot, maxCandidates } =
      await req.json();

    if (!epreuveId || !startDate || !endDate) {
      return Response.json(
        { error: "epreuveId, startDate, endDate are required" },
        { status: 400 },
      );
    }

    // Fetch epreuve
    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: "Epreuve not found" }, { status: 404 });
    }

    const requiredMembers = membersPerSlot || 2;
    const candidateCapacity =
      maxCandidates || (epreuve.is_group_epreuve ? epreuve.group_size : 1);

    // ══════════════════════════════════════════════════════════════════
    // ÉPREUVE DE GROUPE (business game) : le nombre d'examinateurs par
    // salle suit le même intervalle [min_candidates, group_size] que les
    // candidats (cf. docs/superpowers/specs/2026-09-07-min-candidats-epreuves-groupe-design.md).
    // On privilégie le moins de salles possible, chacune remplie au
    // maximum, plutôt qu'un nombre fixe d'examinateurs par salle qui
    // gaspillerait des membres disponibles (ex: 12 dispos, min 4, max 6 →
    // 2 salles de 6, pas 3 salles de 4).
    // ══════════════════════════════════════════════════════════════════
    const groupMinMembers = epreuve.is_group_epreuve
      ? epreuve.min_evaluators_per_salle ||
        epreuve.min_candidates ||
        requiredMembers
      : requiredMembers;
    const groupMaxMembers = epreuve.is_group_epreuve
      ? candidateCapacity
      : requiredMembers;

    /** Découpe `available` membres en le moins de salles possible, chacune dans [min, max]. */
    const packRoomSizes = (
      available: number,
      min: number,
      max: number,
    ): number[] => {
      const safeMin = Math.max(1, min);
      const safeMax = Math.max(safeMin, max);
      if (available < safeMin) return [];
      const rooms = Math.max(1, Math.ceil(available / safeMax));
      const base = Math.floor(available / rooms);
      const remainder = available - base * rooms;
      return Array.from({ length: rooms }, (_, i) =>
        i < remainder ? base + 1 : base,
      );
    };

    // ══════════════════════════════════════════════════════════════════
    // DURÉE DU CRÉNEAU = durée épreuve + 10 min de roulement (buffer)
    // ══════════════════════════════════════════════════════════════════
    const BUFFER_MINUTES = 10;
    const epreuveDuration = epreuve.duration_minutes || 30;
    const slotDuration = epreuveDuration + BUFFER_MINUTES;

    const addMinutesToTime = (timeStr: string, minutes: number): string => {
      const [h, m] = timeStr.split(":").map(Number);
      const totalMin = h * 60 + (m || 0) + minutes;
      const newH = Math.floor(totalMin / 60);
      const newM = totalMin % 60;
      return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
    };

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Fetch all availabilities in range with member info
    const { data: availabilities, error: avError } = await supabaseAdmin
      .from("availabilities")
      .select("*, member:members(id, email)")
      .gte("date", start.toISOString())
      .lte("date", end.toISOString());

    if (avError) throw avError;

    // Group availabilities by date + start time
    const slotMap: Record<
      string,
      {
        members: { id: string; email: string }[];
        startTime: string;
        endTime: string;
        date: string;
      }
    > = {};

    (availabilities || []).forEach((av: any) => {
      if (!av.date) return;
      const dateStr = formatDate(new Date(av.date));
      const key = `${dateStr}-${av.start_time}`;

      if (!slotMap[key]) {
        slotMap[key] = {
          members: [],
          startTime: av.start_time,
          endTime: av.end_time,
          date: dateStr,
        };
      }

      if (!slotMap[key].members.find((m) => m.id === av.member.id)) {
        slotMap[key].members.push({ id: av.member.id, email: av.member.email });
      }
    });

    // Filter for slots with enough members
    const validSlots = Object.entries(slotMap)
      .filter(([, data]) => data.members.length >= groupMinMembers)
      .map(([key, data]) => ({
        key,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        availableMembers: data.members,
        memberCount: data.members.length,
      }))
      .sort((a, b) =>
        `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
      );

    // Generate rooms per slot
    const generatedSlots = validSlots.map((slot) => {
      const roomSizes = epreuve.is_group_epreuve
        ? packRoomSizes(
            slot.availableMembers.length,
            groupMinMembers,
            groupMaxMembers,
          )
        : Array(
            Math.floor(slot.availableMembers.length / requiredMembers),
          ).fill(requiredMembers);
      const rooms: {
        roomNumber: number;
        members: { id: string; email: string }[];
        maxCandidates: number;
      }[] = [];

      let cursor = 0;
      roomSizes.forEach((size, r) => {
        const assignedMembers = slot.availableMembers.slice(
          cursor,
          cursor + size,
        );
        cursor += size;
        rooms.push({
          roomNumber: r + 1,
          members: assignedMembers,
          maxCandidates: candidateCapacity,
        });
      });

      // end_time calculé : start_time + durée épreuve + buffer
      const computedEndTime = addMinutesToTime(slot.startTime, slotDuration);

      return {
        date: slot.date,
        startTime: slot.startTime,
        endTime: computedEndTime,
        durationMinutes: slotDuration,
        epreuveDurationMinutes: epreuveDuration,
        bufferMinutes: BUFFER_MINUTES,
        totalAvailableMembers: slot.memberCount,
        rooms,
      };
    });

    const totalRooms = generatedSlots.reduce(
      (sum, s) => sum + s.rooms.length,
      0,
    );
    const totalCapacity = totalRooms * candidateCapacity;

    return Response.json({
      epreuve: { id: epreuve.id, name: epreuve.name, tour: epreuve.tour },
      summary: {
        validTimeSlots: generatedSlots.length,
        totalRooms,
        totalCapacity,
        membersPerSlot: requiredMembers,
        candidatesPerSlot: candidateCapacity,
      },
      slots: generatedSlots,
    });
  } catch (error) {
    console.error("Generate slots error:", error);
    return Response.json(
      { error: "Failed to generate slots", details: String(error) },
      { status: 500 },
    );
  }
}
