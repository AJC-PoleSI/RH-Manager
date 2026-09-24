import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { normalizeRoomList } from "@/lib/rooms";
import {
  openEpreuveIds,
  openingsPerRoom,
  readRoomList,
  writeRoomList,
} from "@/lib/rooms-db";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/rooms — salles proposées dans l'onglet « Création » du planning,
// avec le nombre d'ouvertures de chacune sur les tours en cours ou à venir
// (`usage`). Lue directement en base, sans le cache de /api/settings : après
// un renommage, la grille doit voir le nouveau nom tout de suite.
export async function GET(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (payload.role === "candidate") return forbidden();

  try {
    const [list, usage] = await Promise.all([
      readRoomList(),
      openEpreuveIds().then(openingsPerRoom),
    ]);
    return Response.json({ ...list, usage });
  } catch (error) {
    console.error("GET rooms error:", error);
    return Response.json({ error: "Échec du chargement des salles" }, { status: 500 });
  }
}

// PUT /api/rooms — admin : enregistre la liste (ajout, retrait, ordre).
// Body : { rooms: string[] }. Retirer une salle qui a encore des ouvertures
// sur un tour en cours ou à venir est refusé (409) : elle resterait de toute
// façon affichée par la grille, et l'admin croirait l'avoir supprimée.
export async function PUT(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const parsed = normalizeRoomList(body?.rooms);
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const current = await readRoomList();
    const removed = current.rooms.filter((r) => !parsed.rooms.includes(r));
    if (removed.length > 0) {
      const usage = await openingsPerRoom(await openEpreuveIds());
      const stillUsed = removed.filter((r) => (usage[r] ?? 0) > 0);
      if (stillUsed.length > 0) {
        return Response.json(
          {
            error: `${stillUsed.map((r) => `« ${r} »`).join(", ")} a encore des ouvertures sur un tour en cours : supprimez-les d'abord, ou renommez la salle.`,
          },
          { status: 409 },
        );
      }
    }

    await writeRoomList(parsed.rooms);
    return Response.json({ rooms: parsed.rooms });
  } catch (error) {
    console.error("PUT rooms error:", error);
    return Response.json({ error: "Échec de l'enregistrement des salles" }, { status: 500 });
  }
}
