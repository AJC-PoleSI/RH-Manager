import { supabaseAdmin } from '@/lib/supabase';
import { getTokenFromRequest, unauthorized, forbidden } from '@/lib/auth';
import { NextRequest } from 'next/server';

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
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
        { error: 'epreuveId, startDate, endDate are required' },
        { status: 400 }
      );
    }

    // Fetch epreuve
    const { data: epreuve, error: epreuveError } = await supabaseAdmin
      .from('epreuves')
      .select('*')
      .eq('id', epreuveId)
      .single();

    if (epreuveError || !epreuve) {
      return Response.json({ error: 'Epreuve not found' }, { status: 404 });
    }

    const requiredMembers = membersPerSlot || 2;
    const candidateCapacity =
      maxCandidates || (epreuve.is_group_epreuve ? epreuve.group_size : 1);

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Fetch all availabilities in range with member info
    const { data: availabilities, error: avError } = await supabaseAdmin
      .from('availabilities')
      .select('*, member:members(id, email)')
      .gte('date', start.toISOString())
      .lte('date', end.toISOString());

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
      .filter(([, data]) => data.members.length >= requiredMembers)
      .map(([key, data]) => ({
        key,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        availableMembers: data.members,
        memberCount: data.members.length,
      }))
      .sort((a, b) =>
        `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)
      );

    // Generate rooms per slot
    const generatedSlots = validSlots.map((slot) => {
      const numberOfRooms = Math.floor(
        slot.availableMembers.length / requiredMembers
      );
      const rooms = [];

      for (let r = 0; r < numberOfRooms; r++) {
        const assignedMembers = slot.availableMembers.slice(
          r * requiredMembers,
          (r + 1) * requiredMembers
        );
        rooms.push({
          roomNumber: r + 1,
          members: assignedMembers,
          maxCandidates: candidateCapacity,
        });
      }

      return {
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        totalAvailableMembers: slot.memberCount,
        rooms,
      };
    });

    const totalRooms = generatedSlots.reduce(
      (sum, s) => sum + s.rooms.length,
      0
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
    console.error('Generate slots error:', error);
    return Response.json(
      { error: 'Failed to generate slots', details: String(error) },
      { status: 500 }
    );
  }
}
