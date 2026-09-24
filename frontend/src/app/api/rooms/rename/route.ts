import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { renameInList, validateRoomName } from "@/lib/rooms";
import { openEpreuveIds, readRoomList, writeRoomList } from "@/lib/rooms-db";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/rooms/rename — admin : renomme une salle.
// Body : { from, to, dryRun? }
//
// Le nouveau nom remplace l'ancien dans la liste des salles, et sur les
// ouvertures et créneaux des tours en cours ou à venir — les candidats déjà
// inscrits voient donc la nouvelle salle. Les tours clos gardent l'ancien nom
// : c'est là qu'ils se sont passés. `dryRun` renvoie seulement ce qui serait
// modifié, pour la confirmation.
//
// Refusé si le nouveau nom est déjà pris (liste ou ouvertures d'un tour en
// cours) : deux salles fusionnées sous un même nom feraient se chevaucher
// leurs créneaux.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const from = typeof body?.from === "string" ? body.from.trim() : "";
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const dryRun = body?.dryRun === true;

    if (!from) {
      return Response.json({ error: "Salle à renommer manquante." }, { status: 400 });
    }
    const invalid = validateRoomName(to);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    if (from === to) {
      return Response.json({ error: "Le nouveau nom est identique." }, { status: 400 });
    }

    const [list, epreuveIds] = await Promise.all([readRoomList(), openEpreuveIds()]);
    // Changer seulement la casse (« a12 » → « A12 ») reste permis.
    const sameRoom = from.toLowerCase() === to.toLowerCase();

    if (!sameRoom && list.rooms.some((r) => r.toLowerCase() === to.toLowerCase())) {
      return Response.json(
        { error: `La salle « ${to} » existe déjà.` },
        { status: 409 },
      );
    }

    const count = async (table: "room_openings" | "evaluation_slots", room: string) => {
      if (epreuveIds.length === 0) return 0;
      const { count: n, error } = await supabaseAdmin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("room", room)
        .in("epreuve_id", epreuveIds);
      if (error) throw error;
      return n ?? 0;
    };

    if (!sameRoom && (await count("room_openings", to)) > 0) {
      return Response.json(
        { error: `Des ouvertures utilisent déjà la salle « ${to} ».` },
        { status: 409 },
      );
    }

    const [openings, slots] = await Promise.all([
      count("room_openings", from),
      count("evaluation_slots", from),
    ]);
    if (dryRun) return Response.json({ openings, slots });

    if (epreuveIds.length > 0) {
      const { error: openErr } = await supabaseAdmin
        .from("room_openings")
        .update({ room: to })
        .eq("room", from)
        .in("epreuve_id", epreuveIds);
      if (openErr) throw openErr;

      const { error: slotErr } = await supabaseAdmin
        .from("evaluation_slots")
        .update({ room: to })
        .eq("room", from)
        .in("epreuve_id", epreuveIds);
      if (slotErr) throw slotErr;
    }

    const rooms = renameInList(list.rooms, from, to);
    await writeRoomList(rooms);

    return Response.json({ rooms, openings, slots });
  } catch (error) {
    console.error("POST rooms/rename error:", error);
    return Response.json({ error: "Échec du renommage de la salle" }, { status: 500 });
  }
}
