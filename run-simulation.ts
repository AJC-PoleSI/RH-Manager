import jwt from "jsonwebtoken";

/**
 * SIMULATION DE CHARGE COMPLÈTE
 * Crée 100 candidats + les inscrit sur 1 slot + mesure les perfs
 */

const API_URL = "http://localhost:3000";
const JWT_SECRET = "22d1848c06bdf08a7fa9585e2a6fb7387f52d3561da14367db7635fe3593bde9";

// Token admin de test
const ADMIN_ID = "00000000-0000-0000-0000-000000000001"; // À adapter
const ADMIN_EMAIL = "admin@test.local";

const adminToken = jwt.sign(
  {
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    role: "member",
    isAdmin: true,
  },
  JWT_SECRET,
  { expiresIn: "2h" }
);

interface Candidate {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  token: string;
}

interface SlotInfo {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  maxCandidates: number;
  enrollmentCount: number;
}

// ══════════════════════════════════════════════════════════════════
// 0. TROUVER UN SLOT DISPO
// ══════════════════════════════════════════════════════════════════
async function findAvailableSlot(): Promise<SlotInfo | null> {
  console.log("🔍 Recherche d'un slot disponible...\n");

  try {
    const res = await fetch(`${API_URL}/api/slots/available`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!res.ok) {
      console.error(`❌ Erreur API slots: ${res.status}`);
      return null;
    }

    const slots = await res.json();

    if (!Array.isArray(slots) || slots.length === 0) {
      console.error("❌ Aucun slot disponible");
      return null;
    }

    // Prendre le premier slot avec assez de places
    const slot = slots.find((s: any) => {
      const enrollmentCount = (s.enrollments?.length || 0);
      return s.status === "published" && enrollmentCount < s.max_candidates;
    });

    if (!slot) {
      console.error("❌ Aucun slot avec assez de places");
      return null;
    }

    const slotInfo: SlotInfo = {
      id: slot.id,
      date: slot.date,
      startTime: slot.start_time || slot.startTime,
      endTime: slot.end_time || slot.endTime,
      maxCandidates: slot.max_candidates,
      enrollmentCount: slot.enrollments?.length || 0,
    };

    console.log(`✅ Slot trouvé:`);
    console.log(`   📅 ${slotInfo.date} ${slotInfo.startTime}-${slotInfo.endTime}`);
    console.log(`   👥 Actuellement: ${slotInfo.enrollmentCount}/${slotInfo.maxCandidates}`);
    console.log(`   ID: ${slotInfo.id}\n`);

    return slotInfo;
  } catch (err) {
    console.error("❌ Erreur recherche slot:", err);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 1. CRÉER 100 CANDIDATS
// ══════════════════════════════════════════════════════════════════
async function createCandidates(count: number): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const startTime = Date.now();

  console.log(`📝 Création de ${count} candidats...`);

  for (let i = 0; i < count; i++) {
    const email = `loadtest-${Date.now()}-${i}@example.com`;
    const firstName = `Test`;
    const lastName = `LoadTest${i}`;

    try {
      const res = await fetch(`${API_URL}/api/candidates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ firstName, lastName, email }),
      });

      if (!res.ok) {
        const err = await res.text();
        if (i < 3) console.log(`  ⚠️  Candidat ${i}: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const token = jwt.sign(
        {
          id: data.id,
          email: data.email,
          role: "candidate",
        },
        JWT_SECRET,
        { expiresIn: "2h" }
      );

      candidates.push({
        id: data.id,
        email: data.email,
        firstName,
        lastName,
        token,
      });

      if ((i + 1) % 25 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`  ✓ ${i + 1}/${count} (${elapsed.toFixed(1)}s)`);
      }
    } catch (err) {
      if (i < 3) console.error(`  ❌ Erreur ${i}:`, err);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`✅ ${candidates.length} candidats créés en ${(duration / 1000).toFixed(2)}s`);
  console.log(`   → ${((candidates.length / duration) * 1000).toFixed(0)} cand/s\n`);

  return candidates;
}

// ══════════════════════════════════════════════════════════════════
// 2. INSCRIRE TOUS SUR LE SLOT
// ══════════════════════════════════════════════════════════════════
async function enrollCandidates(
  candidates: Candidate[],
  slotId: string
): Promise<{ success: number; failed: number; timings: number[] }> {
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;
  const timings: number[] = [];

  console.log(`📅 Inscription de ${candidates.length} candidats...\n`);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const enrollStart = Date.now();

    try {
      const res = await fetch(`${API_URL}/api/slots/enroll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${candidate.token}`,
        },
        body: JSON.stringify({ slotId }),
      });

      const elapsed = Date.now() - enrollStart;
      timings.push(elapsed);

      if (res.ok) {
        successCount++;
      } else {
        failCount++;
        const error = await res.json();
        if (i < 3) {
          console.log(`  ⚠️  ${i}: ${error.error} (${res.status})`);
        }
      }

      if ((i + 1) % 25 === 0) {
        const totalElapsed = (Date.now() - startTime) / 1000;
        console.log(`  ✓ ${i + 1}/${candidates.length} (${totalElapsed.toFixed(1)}s)`);
      }
    } catch (err) {
      failCount++;
    }
  }

  const totalDuration = Date.now() - startTime;
  const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
  const minTime = Math.min(...timings);
  const maxTime = Math.max(...timings);

  console.log(`\n✅ Inscriptions: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`   ✓ Succès: ${successCount} | ❌ Erreurs: ${failCount}`);
  console.log(`   ⏱️  Moyen: ${avgTime.toFixed(0)}ms | Min: ${minTime}ms | Max: ${maxTime}ms\n`);

  return { success: successCount, failed: failCount, timings };
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
async function main() {
  console.log("\n🚀 SIMULATION DE CHARGE - RH Manager");
  console.log("═════════════════════════════════════════\n");

  const slot = await findAvailableSlot();
  if (!slot) {
    console.error("❌ Impossible de commencer sans slot");
    process.exit(1);
  }

  const candidates = await createCandidates(100);
  if (candidates.length === 0) {
    console.error("❌ Aucun candidat créé");
    process.exit(1);
  }

  const { success, failed, timings } = await enrollCandidates(
    candidates,
    slot.id
  );

  console.log("📊 RÉSUMÉ");
  console.log("═════════════════════════════════════════");
  console.log(`Candidats créés: ${candidates.length}`);
  console.log(`Inscriptions réussies: ${success}`);
  console.log(`Inscriptions échouées: ${failed}`);
  console.log(`Taux de succès: ${((success / candidates.length) * 100).toFixed(1)}%`);
  console.log(`\n⏱️  Performance:`);
  console.log(`   Moyen: ${(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(0)}ms`);
  console.log(`   P99: ${timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.99)]?.toFixed(0)}ms`);
  console.log(`\n✅ Test de charge terminé!`);
  console.log(`   → Vérifier la performance du planning candidat`);
  console.log(`   → Vérifier la performance du planning admin`);
  console.log(`   → Vérifier les temps de chargement des pages\n`);
}

main().catch(console.error);
