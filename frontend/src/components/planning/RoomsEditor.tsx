"use client";

/**
 * RoomsEditor — gestion des salles depuis l'onglet « Création » du planning :
 * renommer, ajouter, retirer.
 *
 * Renommer met à jour les ouvertures et créneaux des tours en cours ou à
 * venir (les tours clos gardent l'ancien nom) — cf. POST /api/rooms/rename.
 * Une salle qui a encore des ouvertures ne peut pas être retirée : elle
 * resterait affichée dans la grille.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateRoomName } from "@/lib/rooms";

interface Props {
  onClose: () => void;
  /** Appelé après chaque modification enregistrée. */
  onChanged: () => void;
}

export default function RoomsEditor({ onClose, onChanged }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newRoom, setNewRoom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/rooms", { params: { t: Date.now() } });
      setRooms(Array.isArray(res.data?.rooms) ? res.data.rooms : []);
      setUsage(res.data?.usage || {});
      setDrafts({});
    } catch (e: any) {
      toast(e?.response?.data?.error || "Échec du chargement des salles", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Les salles de la liste, puis celles qui portent des ouvertures sans y
  // figurer : on doit pouvoir les renommer aussi.
  const rows = Array.from(new Set([...rooms, ...Object.keys(usage)]));

  const rename = async (from: string) => {
    const to = (drafts[from] ?? from).trim();
    const invalid = validateRoomName(to);
    if (invalid) return toast(invalid, "error");
    setBusy(from);
    try {
      const preview = await api.post("/rooms/rename", { from, to, dryRun: true });
      const { openings = 0, slots = 0 } = preview.data || {};
      const detail =
        openings || slots
          ? `\n\n${openings} ouverture(s) et ${slots} créneau(x) des tours en cours ou à venir prendront le nouveau nom. Les candidats déjà inscrits verront la nouvelle salle (sans mail). Les tours clos gardent l'ancien nom.`
          : "";
      if (!window.confirm(`Renommer la salle « ${from} » en « ${to} » ?${detail}`)) return;
      await api.post("/rooms/rename", { from, to });
      toast(`Salle « ${from} » renommée en « ${to} ».`, "success");
      await load();
      onChanged();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Échec du renommage", "error");
    } finally {
      setBusy(null);
    }
  };

  const saveList = async (next: string[], key: string, success: string) => {
    setBusy(key);
    try {
      await api.put("/rooms", { rooms: next });
      toast(success, "success");
      await load();
      onChanged();
      return true;
    } catch (e: any) {
      toast(e?.response?.data?.error || "Échec de l'enregistrement", "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const remove = (room: string) => {
    if (!window.confirm(`Retirer la salle « ${room} » de la liste ?`)) return;
    saveList(rooms.filter((r) => r !== room), room, `Salle « ${room} » retirée.`);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRoom.trim();
    const invalid = validateRoomName(name);
    if (invalid) return toast(invalid, "error");
    if (rows.some((r) => r.toLowerCase() === name.toLowerCase())) {
      return toast(`La salle « ${name} » existe déjà.`, "error");
    }
    if (await saveList([...rooms, name], "__add__", `Salle « ${name} » ajoutée.`)) {
      setNewRoom("");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-modal-85 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Salles</h2>
            <p className="text-xs text-gray-500 mt-1">
              Renommer une salle met à jour ses ouvertures et créneaux des tours en
              cours ou à venir. Les tours clos gardent l&apos;ancien nom.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            rows.map((room) => {
              const draft = drafts[room] ?? room;
              const changed = draft.trim() !== room && draft.trim() !== "";
              const used = usage[room] ?? 0;
              const declared = rooms.includes(room);
              return (
                <div key={room} className="flex items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [room]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && changed) rename(room);
                    }}
                    aria-label={`Nom de la salle ${room}`}
                    className="h-9"
                    disabled={busy !== null}
                  />
                  <span
                    className="w-24 shrink-0 text-[11px] text-gray-400"
                    title="Ouvertures sur les tours en cours ou à venir"
                  >
                    {used > 0 ? `${used} ouverture${used > 1 ? "s" : ""}` : declared ? "libre" : ""}
                    {!declared && " · hors liste"}
                  </span>
                  {changed ? (
                    <Button size="sm" onClick={() => rename(room)} disabled={busy !== null}>
                      {busy === room ? <Loader2 className="h-4 w-4 animate-spin" /> : "Renommer"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(room)}
                      disabled={busy !== null || used > 0 || !declared}
                      title={
                        used > 0
                          ? "Cette salle a encore des ouvertures : supprimez-les d'abord, ou renommez-la."
                          : "Retirer de la liste"
                      }
                      aria-label={`Retirer la salle ${room}`}
                      className="text-red-500 hover:bg-red-50"
                    >
                      {busy === room ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={add} className="p-5 border-t border-gray-100 flex items-center gap-2">
          <Input
            value={newRoom}
            onChange={(e) => setNewRoom(e.target.value)}
            placeholder="Nouvelle salle (ex. 310)"
            className="h-9"
            disabled={loading || busy !== null}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={loading || busy !== null || !newRoom.trim()}>
            {busy === "__add__" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Ajouter
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
