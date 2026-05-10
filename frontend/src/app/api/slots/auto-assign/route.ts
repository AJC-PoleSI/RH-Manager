import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";

// POST /api/slots/auto-assign — auto-assign evaluators to slots based on availabilities
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const { epreuveId, sallesParCreneau, evalParSalle } = await req.json();

    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }

    const roomsPerSlot = sallesParCreneau || 2;
    const membersPerRoom = evalParSalle || 3;
    const totalMembersNeeded = roomsPerSlot * membersPerRoom;

    // Fetch the epreuve
    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: "Epreuve introuvable" }, { status: 404 });
    }

    // Fetch all availabilities with member info
    const { data: availabilities, error: avError } = await supabaseAdmin
      .from("availabilities")
      .select("*, member:members(id, email)");

    if (avError) throw avError;

    // Group availabilities by weekday + start_time
    const slotMap: Record<
      string,
      {
        members: { id: string; email: string }[];
        weekday: string;
        startTime: string;
        endTime: string;
      }
    > = {};

    (availabilities || []).forEach((av: any) => {
      const weekday = av.weekday?.toLowerCase() || "";
      const startTime = av.start_time || "";
      const endTime = av.end_time || "";
      if (!weekday || !startTime) return;

      const key = `${weekday}-${startTime}`;
      if (!slotMap[key]) {
        slotMap[key] = { members: [], weekday, startTime, endTime };
      }

      const memberId = av.member?.id || av.member_id;
      const memberEmail = av.member?.email || "";
      if (memberId && !slotMap[key].members.find((m) => m.id === memberId)) {
        slotMap[key].members.push({ id: memberId, email: memberEmail });
      }
    });

    // Filter slots that have enough available members
    const validSlots = Object.entries(slotMap)
      .filter(([, data]) => data.members.length >= membersPerRoom) // at least enough for 1 room
      .sort(([a], [b]) => a.localeCompare(b));

    // Delete existing auto-generated slots for this epreuve to avoid duplicates
    const { data: existingSlots } = await supabaseAdmin
      .from("evaluation_slots")
      .select("id")
      .eq("epreuve_id", epreuveId)
      .eq("status", "draft");

    if (existingSlots && existingSlots.length > 0) {
      const slotIds = existingSlots.map((s) => s.id);
      // Delete assignments first
      await supabaseAdmin
        .from("slot_member_assignments")
        .delete()
        .in("slot_id", slotIds);
      // Delete slots
      await supabaseAdmin.from("evaluation_slots").delete().in("id", slotIds);
    }

    // ══════════════════════════════════════════════════════════════════
    // DURÉE DU CRÉNEAU = durée épreuve + 10 min de roulement (buffer)
    // ══════════════════════════════════════════════════════════════════
    const BUFFER_MINUTES = 10;
    const epreuveDuration = epreuve.duration_minutes || 30;
    const slotDuration = epreuveDuration + BUFFER_MINUTES;

    // Fonction utilitaire : additionner des minutes à un horaire "HH:MM"
    const addMinutes = (timeStr: string, minutes: number): string => {
      const [h, m] = timeStr.split(":").map(Number);
      const totalMin = h * 60 + (m || 0) + minutes;
      const newH = Math.floor(totalMin / 60);
      const newM = totalMin % 60;
      return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
    };

    // Track how many times each member has been assigned (for fair distribution)
    const memberAssignmentCount: Record<string, number> = {};

    const createdSlots: any[] = [];
    const createdAssignments: any[] = [];

    // Use next Monday as reference date for weekday-based slots
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + ((8 - dayOfWeek) % 7 || 7));

    const weekdayOffset: Record<string, number> = {
      mon: 0,
      monday: 0,
      tue: 1,
      tuesday: 1,
      wed: 2,
      wednesday: 2,
      thu: 3,
      thursday: 3,
      fri: 4,
      friday: 4,
    };

    for (const [, slotData] of validSlots) {
      // Determine how many rooms we can actually fill
      const actualRooms = Math.min(
        roomsPerSlot,
        Math.floor(slotData.members.length / membersPerRoom),
      );

      if (actualRooms === 0) continue;

      // Sort members by assignment count (least assigned first) for fair distribution
      const sortedMembers = [...slotData.members].sort((a, b) => {
        return (
          (memberAssignmentCount[a.id] || 0) -
          (memberAssignmentCount[b.id] || 0)
        );
      });

      // Calculate slot date from weekday
      const offset = weekdayOffset[slotData.weekday] ?? 0;
      const slotDate = new Date(nextMonday);
      slotDate.setDate(nextMonday.getDate() + offset);
      const dateStr = slotDate.toISOString().split("T")[0];

      let memberIndex = 0;

      for (let room = 0; room < actualRooms; room++) {
        // Calculer le end_time réel : start_time + durée épreuve + buffer
        const computedEndTime = addMinutes(slotData.startTime, slotDuration);

        // Create evaluation slot
        const { data: newSlot, error: slotError } = await supabaseAdmin
          .from("evaluation_slots")
          .insert({
            epreuve_id: epreuveId,
            date: `${dateStr}T00:00:00Z`,
            start_time: slotData.startTime,
            end_time: computedEndTime,
            duration_minutes: slotDuration,
            room: `Salle ${room + 1}`,
            label: `${epreuve.name} - ${slotData.weekday.charAt(0).toUpperCase() + slotData.weekday.slice(1)} ${slotData.startTime} (${epreuveDuration}min + ${BUFFER_MINUTES}min)`,
            max_candidates: epreuve.is_group_epreuve
              ? epreuve.group_size || 1
              : 1,
            min_members: membersPerRoom,
            status: "draft",
            tour: epreuve.tour,
          })
          .select()
          .single();

        if (slotError || !newSlot) {
          console.error("Error creating slot:", slotError);
          continue;
        }

        createdSlots.push(newSlot);

        // Assign members to this room
        const assignedMembers = [];
        for (
          let m = 0;
          m < membersPerRoom && memberIndex < sortedMembers.length;
          m++, memberIndex++
        ) {
          const member = sortedMembers[memberIndex];
          const { error: assignError } = await supabaseAdmin
            .from("slot_member_assignments")
            .insert({
              slot_id: newSlot.id,
              member_id: member.id,
            });

          if (!assignError) {
            assignedMembers.push(member);
            memberAssignmentCount[member.id] =
              (memberAssignmentCount[member.id] || 0) + 1;
          }
        }

        createdAssignments.push({
          slotId: newSlot.id,
          room: `Salle ${room + 1}`,
          day: slotData.weekday,
          time: `${slotData.startTime} - ${slotData.endTime}`,
          members: assignedMembers.map((m) => m.email),
        });
      }
    }

    return Response.json({
      success: true,
      summary: {
        totalSlots: createdSlots.length,
        totalAssignments: createdAssignments.reduce(
          (sum, a) => sum + a.members.length,
          0,
        ),
        sallesParCreneau: roomsPerSlot,
        evalParSalle: membersPerRoom,
        creneauxDisponibles: validSlots.length,
      },
      assignments: createdAssignments,
    });
  } catch (error) {
    console.error("Auto-assign error:", error);
    return Response.json(
      { error: "Echec de la repartition automatique", details: String(error) },
      { status: 500 },
    );
  }
}
