import ExcelJS from "exceljs";
import { sanitizeSpreadsheetValue } from "./spreadsheet-safety";

export interface BackupData {
  candidates: any[];
  members: any[];
  slots: any[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const WEEKDAYS = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

const THIN = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const parseScores = (raw: any): Record<string, number> => {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, number> = {};
    Object.entries(obj).forEach(([k, v]) => {
      const n = Number(v);
      if (!isNaN(n)) out[k] = n;
    });
    return out;
  } catch {
    return {};
  }
};

const avgOf = (nums: number[]) =>
  nums.length === 0
    ? null
    : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;

const personName = (p: any): string => {
  if (!p) return "";
  const full = `${p.first_name || ""} ${p.last_name || ""}`.trim();
  return full || p.email || "";
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Clé de regroupement par jour, en heure locale (pas UTC). */
const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const dayHeader = (iso: string): string => {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}\n${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
};

/** Excel interdit * ? : \ / [ ] dans un nom d'onglet, et le limite à 31 caractères. */
const sheetName = (wb: ExcelJS.Workbook, base: string): string => {
  const cleaned = (base || "Feuille").replace(/[*?:\\/[\]]/g, "-").slice(0, 31).trim();
  let name = cleaned || "Feuille";
  let i = 2;
  while (wb.worksheets.some((ws) => ws.name === name)) {
    const suffix = ` (${i})`;
    name = cleaned.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  return name;
};

const styleHeaderRow = (row: ExcelJS.Row, height = 28) => {
  row.height = height;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = ALL_BORDERS;
  });
};

/** Hauteur de ligne estimée à partir du texte le plus long de la ligne. */
const rowHeightFor = (texts: (string | null | undefined)[], charsPerLine: number) => {
  const lines = texts.reduce((max, t) => {
    const s = String(t ?? "");
    const explicit = s.split("\n").length;
    const wrapped = Math.ceil(s.length / charsPerLine) || 1;
    return Math.max(max, explicit, wrapped);
  }, 1);
  return Math.min(200, Math.max(22, 15 * lines + 8));
};

/* ------------------------------------------------------------------ */
/*  Feuille 1 : Candidats (infos)                                      */
/* ------------------------------------------------------------------ */

function buildCandidatesSheet(wb: ExcelJS.Workbook, data: BackupData) {
  const ws = wb.addWorksheet(sheetName(wb, "Candidats"), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Prénom", width: 16 },
    { header: "Nom", width: 18 },
    { header: "Email", width: 30 },
    { header: "Email vérifié", width: 13 },
    { header: "Téléphone", width: 15 },
    { header: "Formation", width: 22 },
    { header: "Établissement", width: 22 },
    { header: "Année d'intégration", width: 18 },
    { header: "Statut T1", width: 12 },
    { header: "Statut T2", width: 12 },
    { header: "Statut T3", width: 12 },
    { header: "Note globale", width: 12 },
    { header: "Points forts", width: 42 },
    { header: "Points faibles", width: 42 },
    { header: "Commentaire général", width: 42 },
  ];

  styleHeaderRow(ws.getRow(1));

  const sorted = [...data.candidates].sort((a, b) =>
    `${a.last_name || ""}${a.first_name || ""}`.localeCompare(
      `${b.last_name || ""}${b.first_name || ""}`,
      "fr",
    ),
  );

  sorted.forEach((c: any) => {
    const evals: any[] = c.candidate_evaluations || [];
    const allScores = evals.flatMap((e) =>
      Object.values(parseScores(e.scores)),
    ) as number[];
    const delib = Array.isArray(c.deliberation) ? c.deliberation[0] : c.deliberation;

    const row = ws.addRow([
      c.first_name || "",
      c.last_name || "",
      c.email || "",
      c.email_verified ? "Oui" : "Non",
      c.phone || "",
      c.formation || "",
      c.etablissement || "",
      c.annee_integration || "",
      delib?.tour1_status || "",
      delib?.tour2_status || "",
      delib?.tour3_status || "",
      avgOf(allScores),
      delib?.pros_comment || "",
      delib?.cons_comment || "",
      delib?.global_comments || c.comments || "",
    ]);

    row.height = rowHeightFor(
      [delib?.pros_comment, delib?.cons_comment, delib?.global_comments || c.comments],
      45,
    );
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = ALL_BORDERS;
    });
  });

  ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columnCount } };
}

/* ------------------------------------------------------------------ */
/*  Feuille 2 : Examinateurs (infos + charge)                          */
/* ------------------------------------------------------------------ */

function buildExaminersSheet(wb: ExcelJS.Workbook, data: BackupData) {
  const ws = wb.addWorksheet(sheetName(wb, "Examinateurs"), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Prénom", width: 16 },
    { header: "Nom", width: 18 },
    { header: "Email", width: 30 },
    { header: "Admin", width: 9 },
    { header: "Pôle", width: 24 },
    { header: "Candidats évalués", width: 16 },
    { header: "Évaluations données", width: 17 },
    { header: "Créneaux affectés", width: 16 },
  ];

  styleHeaderRow(ws.getRow(1));

  const slotCounts: Record<string, number> = {};
  data.slots.forEach((s: any) => {
    (s.members || []).forEach((a: any) => {
      const mid = a.member?.id || a.member_id;
      if (mid) slotCounts[mid] = (slotCounts[mid] || 0) + 1;
    });
  });

  const sorted = [...data.members].sort((a, b) =>
    `${a.last_name || ""}${a.first_name || ""}`.localeCompare(
      `${b.last_name || ""}${b.first_name || ""}`,
      "fr",
    ),
  );

  sorted.forEach((m: any) => {
    const evals: any[] = m.candidate_evaluations || [];
    const distinct = new Set(evals.map((e) => e.candidates?.id).filter(Boolean));
    const row = ws.addRow([
      m.first_name || "",
      m.last_name || "",
      m.email || "",
      m.is_admin ? "Oui" : "Non",
      m.pole_affiliation || "",
      distinct.size,
      evals.length,
      slotCounts[m.id] || 0,
    ]);
    row.height = 22;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle" };
      cell.border = ALL_BORDERS;
    });
  });

  ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columnCount } };
}

/* ------------------------------------------------------------------ */
/*  Feuilles Tour 1 / Tour 2 / Tour 3                                  */
/*                                                                     */
/*  Tableau croisé : UNE ligne par candidat, et pour chaque épreuve du  */
/*  tour un bloc de 4 colonnes (évaluateurs, notes, moyenne,            */
/*  appréciation). Les blocs se suivent horizontalement.                */
/* ------------------------------------------------------------------ */

const COLS_PER_EPREUVE = 4;
const BLOCK_FILLS = ["FF1F2937", "FF374151"];

function buildTourSheet(wb: ExcelJS.Workbook, data: BackupData, tour: number) {
  const epreuves = new Map<string, string>();
  const perCandidate = new Map<
    string,
    { candidate: any; cells: Map<string, any[]> }
  >();

  data.candidates.forEach((c: any) => {
    (c.candidate_evaluations || []).forEach((e: any) => {
      if ((e.epreuves?.tour ?? null) !== tour) return;
      const epId = e.epreuves?.id || e.epreuves?.name || "inconnue";
      epreuves.set(epId, e.epreuves?.name || "Épreuve inconnue");

      if (!perCandidate.has(c.id)) {
        perCandidate.set(c.id, { candidate: c, cells: new Map() });
      }
      const entry = perCandidate.get(c.id)!;
      if (!entry.cells.has(epId)) entry.cells.set(epId, []);
      entry.cells.get(epId)!.push(e);
    });
  });

  if (perCandidate.size === 0) return;

  const epreuveIds = Array.from(epreuves.keys()).sort((a, b) =>
    (epreuves.get(a) || "").localeCompare(epreuves.get(b) || "", "fr"),
  );

  const ws = wb.addWorksheet(sheetName(wb, `Tour ${tour}`), {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });

  const lastCol = 1 + epreuveIds.length * COLS_PER_EPREUVE;

  ws.getColumn(1).width = 26;
  epreuveIds.forEach((_, i) => {
    const base = 2 + i * COLS_PER_EPREUVE;
    ws.getColumn(base).width = 22;
    ws.getColumn(base + 1).width = 26;
    ws.getColumn(base + 2).width = 10;
    ws.getColumn(base + 3).width = 50;
  });

  /* ---- Ligne 1 : nom de l'épreuve, fusionné au-dessus de son bloc ---- */
  const r1 = ws.getRow(1);
  const r2 = ws.getRow(2);

  r1.getCell(1).value = "Candidat";
  ws.mergeCells(1, 1, 2, 1);
  const candHeader = ws.getCell(1, 1);
  candHeader.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  candHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF111827" },
  };
  candHeader.alignment = { vertical: "middle", horizontal: "center" };
  candHeader.border = ALL_BORDERS;

  epreuveIds.forEach((id, i) => {
    const base = 2 + i * COLS_PER_EPREUVE;
    const fill = BLOCK_FILLS[i % BLOCK_FILLS.length];

    r1.getCell(base).value = epreuves.get(id) || "";
    ws.mergeCells(1, base, 1, base + COLS_PER_EPREUVE - 1);
    const titleCell = ws.getCell(1, base);
    titleCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    titleCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    titleCell.border = ALL_BORDERS;

    ["Évaluateur(s)", "Notes", "Moyenne", "Appréciation"].forEach((label, j) => {
      const cell = r2.getCell(base + j);
      cell.value = label;
      cell.font = { bold: true, size: 10, color: { argb: "FF111827" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = ALL_BORDERS;
    });
  });

  r1.height = 26;
  r2.height = 22;

  /* ---- Une ligne par candidat ---- */
  const candidates = Array.from(perCandidate.values()).sort((a, b) =>
    `${a.candidate.last_name || ""}${a.candidate.first_name || ""}`.localeCompare(
      `${b.candidate.last_name || ""}${b.candidate.first_name || ""}`,
      "fr",
    ),
  );

  candidates.forEach(({ candidate, cells }) => {
    const row = ws.addRow([]);
    row.getCell(1).value = personName(candidate);
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { vertical: "middle", wrapText: true };
    row.getCell(1).border = ALL_BORDERS;

    const texts: string[] = [];

    epreuveIds.forEach((id, i) => {
      const base = 2 + i * COLS_PER_EPREUVE;
      const evals = cells.get(id) || [];
      const multiple = evals.length > 1;

      const evaluateurs = evals
        .map((e) => `${personName(e.members)}${e.is_group ? " (groupe)" : ""}`)
        .filter(Boolean)
        .join("\n");

      const notes = evals
        .map((e) => {
          const detail = Object.entries(parseScores(e.scores))
            .map(([k, v]) => `${k} : ${v}`)
            .join("\n");
          return multiple ? `[${personName(e.members)}]\n${detail}` : detail;
        })
        .filter(Boolean)
        .join("\n");

      const allScores = evals.flatMap((e) =>
        Object.values(parseScores(e.scores)),
      ) as number[];

      const appreciation = evals
        .map((e) =>
          e.comment
            ? multiple
              ? `[${personName(e.members)}] ${e.comment}`
              : e.comment
            : "",
        )
        .filter(Boolean)
        .join("\n");

      const values: (string | number | null)[] = [
        evaluateurs,
        notes,
        avgOf(allScores),
        appreciation,
      ];

      texts.push(notes, appreciation, evaluateurs);

      values.forEach((v, j) => {
        const cell = row.getCell(base + j);
        cell.value = v === "" ? null : v;
        cell.alignment = {
          vertical: "middle",
          wrapText: true,
          horizontal: j === 2 ? "center" : "left",
        };
        cell.border = {
          ...ALL_BORDERS,
          // trait plus marqué à la frontière entre deux épreuves
          left:
            j === 0
              ? { style: "medium" as const, color: { argb: "FF9CA3AF" } }
              : THIN,
        };
        // Épreuve non passée par ce candidat : case grisée
        if (evals.length === 0) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF9FAFB" },
          };
        }
      });
    });

    row.height = rowHeightFor(texts, 50);
  });

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: lastCol } };
}

/* ------------------------------------------------------------------ */
/*  Feuilles EDT : une par épreuve, un tableau par salle               */
/*                                                                     */
/*  Jours en LIGNES, créneaux horaires en COLONNES. Chaque case         */
/*  contient uniquement le(s) candidat(s) inscrit(s) sur ce créneau —   */
/*  l'objectif est de voir d'un coup d'œil qui passe quand et où.       */
/* ------------------------------------------------------------------ */

function buildTimetableSheets(wb: ExcelJS.Workbook, data: BackupData) {
  const byEpreuve = new Map<string, { label: string; slots: any[] }>();

  data.slots.forEach((s: any) => {
    const id = s.epreuve?.id || "sans-epreuve";
    const label = s.epreuve?.name
      ? `${s.epreuve.name}${s.epreuve.tour ? ` (T${s.epreuve.tour})` : ""}`
      : "Créneaux sans épreuve";
    if (!byEpreuve.has(id)) byEpreuve.set(id, { label, slots: [] });
    byEpreuve.get(id)!.slots.push(s);
  });

  byEpreuve.forEach(({ label, slots }) => {
    const ws = wb.addWorksheet(sheetName(wb, `EDT ${label}`), {
      views: [{ state: "frozen", xSplit: 1 }],
    });
    ws.getColumn(1).width = 20;

    const rooms = new Map<string, any[]>();
    slots.forEach((s: any) => {
      const room = s.room || "Salle non définie";
      if (!rooms.has(room)) rooms.set(room, []);
      rooms.get(room)!.push(s);
    });

    const sortedRooms = Array.from(rooms.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "fr", { numeric: true }),
    );

    let cursor = 1;

    sortedRooms.forEach(([room, roomSlots]) => {
      const days = Array.from(
        new Set(roomSlots.map((s: any) => dayKey(s.date) as string)),
      ).sort();
      const times = Array.from(
        new Set(roomSlots.map((s: any) => (s.start_time || "") as string)),
      ).sort();

      /* Titre du tableau */
      const titleRow = ws.getRow(cursor);
      titleRow.getCell(1).value = `${room} — ${label}`;
      ws.mergeCells(cursor, 1, cursor, Math.max(2, times.length + 1));
      titleRow.height = 26;
      const titleCell = titleRow.getCell(1);
      titleCell.font = { bold: true, size: 13, color: { argb: "FF111827" } };
      titleCell.alignment = { vertical: "middle", horizontal: "left" };
      cursor++;

      /* En-tête : Date + un créneau horaire par colonne */
      const headerRow = ws.getRow(cursor);
      headerRow.getCell(1).value = "Date";
      times.forEach((time, i) => {
        const end = roomSlots.find((s: any) => s.start_time === time)?.end_time;
        headerRow.getCell(i + 2).value = end ? `${time}\n${end}` : time;
        ws.getColumn(i + 2).width = 24;
      });
      styleHeaderRow(headerRow, 32);
      cursor++;

      /* Une ligne par jour */
      days.forEach((day) => {
        const row = ws.getRow(cursor);
        const sample = roomSlots.find((s: any) => dayKey(s.date) === day);
        row.getCell(1).value = dayHeader(sample.date).replace("\n", " ");
        row.getCell(1).font = { bold: true };
        row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
        row.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3F4F6" },
        };
        row.getCell(1).border = ALL_BORDERS;

        const contents: string[] = [];

        times.forEach((time, i) => {
          const cell = row.getCell(i + 2);
          const matching = roomSlots.filter(
            (s: any) => dayKey(s.date) === day && (s.start_time || "") === time,
          );

          if (matching.length === 0) {
            // Aucun créneau ouvert ce jour-là à cette heure
            cell.border = ALL_BORDERS;
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF9FAFB" },
            };
            return;
          }

          const names = matching.flatMap((s: any) =>
            (s.enrollments || [])
              .map((en: any) => personName(en.candidate))
              .filter(Boolean),
          );

          cell.border = ALL_BORDERS;
          cell.alignment = { vertical: "middle", wrapText: true, horizontal: "center" };

          if (names.length === 0) {
            // Créneau ouvert mais personne d'inscrit
            cell.value = "(libre)";
            cell.font = { italic: true, color: { argb: "FF9CA3AF" }, size: 10 };
          } else {
            const text = names.join("\n");
            cell.value = text;
            contents.push(text);
          }
        });

        row.height = rowHeightFor(contents, 22);
        cursor++;
      });

      cursor += 2; // ligne vide entre deux salles
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Entrée principale                                                  */
/* ------------------------------------------------------------------ */

export function buildBackupWorkbook(data: BackupData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RH Manager AJC";
  wb.created = new Date();

  buildCandidatesSheet(wb, data);
  buildExaminersSheet(wb, data);
  [1, 2, 3].forEach((tour) => buildTourSheet(wb, data, tour));
  buildTimetableSheets(wb, data);

  neutralizeFormulas(wb);

  return wb;
}

/**
 * Dernière passe : aucune cellule texte du classeur ne doit pouvoir être
 * interprétée comme une formule à l'ouverture (cf. lib/spreadsheet-safety.ts).
 *
 * Fait ici, en un seul endroit, plutôt qu'à chaque `addRow` : une feuille
 * ajoutée plus tard est automatiquement couverte, sans qu'on ait à y penser.
 */
function neutralizeFormulas(wb: ExcelJS.Workbook) {
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") {
          cell.value = sanitizeSpreadsheetValue(cell.value);
        }
      });
    });
  });
}
