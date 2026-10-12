"use client";

/**
 * EpreuveSlotsInfo — « combien de créneaux sont prêts, par épreuve », rangé
 * derrière un (i). Remplace l'ancien tableau pleine largeur : l'information
 * reste à portée de clic sans occuper la page.
 *
 * « Prêt » = un créneau qui a déjà au moins le nombre minimum d'examinateurs
 * requis (slot.min_members) affecté — donc staffé, indépendamment de son
 * statut publié/pas publié. Aucune requête propre : le calendrier global de
 * la page charge déjà tous les créneaux (/api/slots/all), on les reçoit en
 * prop et on les compte à l'ouverture seulement.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Info } from "lucide-react";

interface Row {
  epreuveId: string;
  epreuveName: string;
  tour: string | number;
  total: number;
  prets: number;
  incomplets: number;
}

function countByEpreuve(slots: any[]): Row[] {
  const byEpreuve = new Map<string, Row>();
  for (const s of slots) {
    const ep = s.epreuve;
    if (!ep) continue;
    const row = byEpreuve.get(ep.id) || {
      epreuveId: ep.id,
      epreuveName: ep.name,
      tour: ep.tour,
      total: 0,
      prets: 0,
      incomplets: 0,
    };
    const assigned = (s.members || []).length;
    const min = s.min_members || 1;
    row.total += 1;
    if (assigned >= min) row.prets += 1;
    else if (assigned > 0) row.incomplets += 1;
    byEpreuve.set(ep.id, row);
  }
  return Array.from(byEpreuve.values()).sort(
    (a, b) =>
      String(a.tour).localeCompare(String(b.tour), undefined, {
        numeric: true,
      }) || a.epreuveName.localeCompare(b.epreuveName),
  );
}

/** Largeur de la bulle, plafonnée à celle de l'écran (mobile). */
const POPOVER_WIDTH = 352;

export default function EpreuveSlotsInfo({ slots }: { slots: any[] }) {
  const [open, setOpen] = useState(false);
  // Position fixe calculée à l'ouverture depuis le bouton, puis bornée à la
  // fenêtre : la bulle ne dépasse jamais de l'écran, où que soit le (i).
  const [pos, setPos] = useState({ left: 8, top: 0, width: POPOVER_WIDTH, maxHeight: 320 });
  const wrapRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
      const top = rect.bottom + 8;
      setPos({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top,
        maxHeight: Math.max(160, Math.min(320, window.innerHeight - top - 8)),
      });
    }
    setOpen((o) => !o);
  };

  // Fermeture au clic ailleurs, sur Échap, ou si la page bouge (la bulle est
  // en position fixe : elle resterait à l'écran quand le (i) défile).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    const close = () => setOpen(false);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const rows = useMemo(() => (open ? countByEpreuve(slots) : []), [open, slots]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({ total: acc.total + r.total, prets: acc.prets + r.prets }),
        { total: 0, prets: 0 },
      ),
    [rows],
  );

  return (
    <div ref={wrapRef} className="inline-flex">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Créneaux prêts par épreuve"
        title="Créneaux prêts par épreuve"
        className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <Info className="h-4 w-4" />
      </button>

      {open && (
        <div
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
          className="fixed z-30 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg"
        >
          <p className="text-sm font-semibold text-gray-900">
            Créneaux prêts par épreuve
          </p>
          <p className="mb-2 text-xs font-normal text-gray-500">
            « Prêt » = au moins le minimum d&apos;examinateurs déjà affecté sur
            le créneau.
          </p>
          {rows.length === 0 ? (
            <p className="py-2 text-xs font-normal text-gray-400">
              Aucun créneau pour le moment.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {rows.map((r) => (
                <li
                  key={r.epreuveId}
                  className="flex items-baseline justify-between gap-3 py-1.5 text-xs font-normal"
                >
                  <span className="min-w-0 text-gray-800">
                    {r.epreuveName}
                    <span className="ml-1.5 text-gray-400">T{r.tour}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold text-green-700">
                      {r.prets}/{r.total}
                    </span>
                    {r.incomplets > 0 && (
                      <span className="ml-1.5 text-amber-600">
                        {r.incomplets} incomplet{r.incomplets > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <p className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-xs font-medium text-gray-700">
              <span>Total</span>
              <span className="tabular-nums text-green-700">
                {totals.prets}/{totals.total}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
