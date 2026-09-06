import ExcelJS from "exceljs";

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
/*  Feuilles 3-5 : Tour 1 / Tour 2 / Tour 3                            */
/* ------------------------------------------------------------------ */

interface TourRow {
  epreuve: string;
  candidat: string;
  examinateur: string;
  notes: string;
  moyenne: number | null;
  appreciation: string;
}

function buildTourSheet(wb: ExcelJS.Workbook, data: BackupData, tour: number) {
  const rows: TourRow[] = [];

  data.candidates.forEach((c: any) => {
    (c.candidate_evaluations || []).forEach((e: any) => {
      if ((e.epreuves?.tour ?? null) !== tour) return;
      const scores = parseScores(e.scores);
      const entries = Object.entries(scores);
      rows.push({
        epreuve: e.epreuves?.name || "Épreuve inconnue",
        candidat: personName(c),
        examinateur: e.is_group
          ? `${personName(e.members)} (éval. groupe)`
          : personName(e.members),
        notes: entries.map(([k, v]) => `${k} : ${v}`).join("\n"),
        moyenne: avgOf(entries.map(([, v]) => v)),
        appreciation: e.comment || "",
      });
    });
  });

  if (rows.length === 0) return;

  rows.sort(
    (a, b) =>
      a.epreuve.localeCompare(b.epreuve, "fr") ||
      a.candidat.localeCompare(b.candidat, "fr") ||
      a.examinateur.localeCompare(b.examinateur, "fr"),
  );

  const ws = wb.addWorksheet(sheetName(wb, `Tour ${tour}`), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Épreuve", width: 26 },
    { header: "Candidat", width: 22 },
    { header: "Examinateur", width: 22 },
    { header: "Notes", width: 30 },
    { header: "Moyenne", width: 10 },
    { header: "Appréciation", width: 70 },
  ];

  styleHeaderRow(ws.getRow(1));

  rows.forEach((r) => {
    const row = ws.addRow([
      r.epreuve,
      r.candidat,
      r.examinateur,
      r.notes,
      r.moyenne,
      r.appreciation,
    ]);
    row.height = rowHeightFor([r.notes, r.appreciation], 65);
    row.eachCell((cell, col) => {
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
        horizontal: col === 5 ? "center" : "left",
      };
      cell.border = ALL_BORDERS;
    });
  });

  /* Fusion verticale des cellules répétées (épreuve, puis candidat) —
     une seule grande cellule au lieu du même nom répété ligne après ligne. */
  const mergeRuns = (
    column: number,
    keyOf: (r: TourRow) => string,
    fill?: string,
  ) => {
    let start = 0;
    for (let i = 1; i <= rows.length; i++) {
      const same = i < rows.length && keyOf(rows[i]) === keyOf(rows[start]);
      if (same) continue;
      const firstRow = start + 2; // +1 en-tête, +1 index 1-based
      const lastRow = i + 1;
      if (lastRow > firstRow) ws.mergeCells(firstRow, column, lastRow, column);
      const cell = ws.getCell(firstRow, column);
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.font = { bold: column === 1 };
      if (fill) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
      start = i;
    }
  };

  mergeRuns(1, (r) => r.epreuve, "FFF3F4F6");
  mergeRuns(2, (r) => `${r.epreuve}||${r.candidat}`);
}

/* ------------------------------------------------------------------ */
/*  Feuilles EDT : une par épreuve, un tableau par salle               */
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
    ws.getColumn(1).width = 16;

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
      const days = [...new Set(roomSlots.map((s: any) => dayKey(s.date)))].sort();
      const times = [...new Set(roomSlots.map((s: any) => s.start_time || ""))].sort();

      /* Titre du tableau */
      const titleRow = ws.getRow(cursor);
      titleRow.getCell(1).value = `${room} — ${label}`;
      ws.mergeCells(cursor, 1, cursor, Math.max(2, days.length + 1));
      titleRow.height = 26;
      const titleCell = titleRow.getCell(1);
      titleCell.font = { bold: true, size: 13, color: { argb: "FF111827" } };
      titleCell.alignment = { vertical: "middle", horizontal: "left" };
      cursor++;

      /* En-tête : Horaire + un jour par colonne */
      const headerRow = ws.getRow(cursor);
      headerRow.getCell(1).value = "Horaire";
      days.forEach((d, i) => {
        const sample = roomSlots.find((s: any) => dayKey(s.date) === d);
        headerRow.getCell(i + 2).value = dayHeader(sample.date);
        ws.getColumn(i + 2).width = 30;
      });
      styleHeaderRow(headerRow, 34);
      cursor++;

      /* Une ligne par horaire */
      times.forEach((time) => {
        const row = ws.getRow(cursor);
        const sampleEnd = roomSlots.find((s: any) => s.start_time === time)?.end_time;
        row.getCell(1).value = sampleEnd ? `${time} - ${sampleEnd}` : time;
        row.getCell(1).font = { bold: true };
        row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
        row.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3F4F6" },
        };
        row.getCell(1).border = ALL_BORDERS;

        const contents: string[] = [];

        days.forEach((d, i) => {
          const cell = row.getCell(i + 2);
          const matching = roomSlots.filter(
            (s: any) => dayKey(s.date) === d && (s.start_time || "") === time,
          );

          if (matching.length === 0) {
            cell.border = ALL_BORDERS;
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFAFAFA" },
            };
            return;
          }

          const text = matching
            .map((s: any) => {
              const exams = (s.members || [])
                .map((a: any) => personName(a.member))
                .filter(Boolean)
                .join(", ");
              const cands = (s.enrollments || [])
                .map((en: any) => personName(en.candidate))
                .filter(Boolean)
                .join(", ");
              return `Exam. : ${exams || "—"}\nCand. : ${cands || "—"}`;
            })
            .join("\n· · ·\n");

          contents.push(text);
          cell.value = text;
          cell.alignment = { vertical: "middle", wrapText: true };
          // Trait diagonal : sépare visuellement la partie examinateurs (haut)
          // de la partie candidats (bas). Le format xlsx ne permet pas de
          // placer deux textes de part et d'autre, seulement la diagonale.
          cell.border = {
            ...ALL_BORDERS,
            diagonal: { up: true, style: "hair", color: { argb: "FFB0B7C3" } },
          };
        });

        row.height = rowHeightFor(contents, 34);
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

  return wb;
}
