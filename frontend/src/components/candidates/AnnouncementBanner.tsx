"use client";

// Bandeau d'annonce, affiché en haut de l'accueil candidat.
//
// Une annonce non lue s'affiche ici en grand : la cloche du header suffit
// pour l'historique, pas pour être SÛR que l'info passe (un candidat ouvre
// l'app pour voir son créneau, pas pour cliquer sur une icône).
// Fermer le bandeau = marquer l'annonce comme lue : la cloche et le bandeau
// partagent le même état, on ne relit pas deux fois la même chose.

import { useCallback, useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import api from "@/lib/api";

interface Announcement {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const res = await api.get("/notifications");
      const unread = (res.data?.notifications || []).filter(
        (n: Announcement) => !n.read && n.type === "annonce",
      );
      setItems(unread);
    } catch {
      // Silencieux : le bandeau ne doit jamais casser le dashboard.
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const dismiss = async (id: string) => {
    setItems((prev) => prev.filter((a) => a.id !== id));
    try {
      await api.post("/notifications/mark-read", { ids: [id] });
    } catch {
      // Silencieux : au pire l'annonce réapparaît au prochain chargement.
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3"
        >
          <span className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
            <Megaphone size={17} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900">{a.title}</p>
            {a.body && (
              <p className="text-sm text-blue-800 mt-0.5 whitespace-pre-line break-words">
                {a.body}
              </p>
            )}
            <p className="text-xs text-blue-500 mt-1">{formatDate(a.createdAt)}</p>
          </div>
          <button
            onClick={() => dismiss(a.id)}
            className="p-1 rounded-md text-blue-400 hover:text-blue-700 hover:bg-blue-100 transition-colors flex-shrink-0"
            aria-label="Masquer l'annonce"
            title="J'ai lu"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
