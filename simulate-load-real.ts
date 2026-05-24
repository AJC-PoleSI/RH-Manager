import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

/**
 * SIMULATION DE CHARGE RÉELLE
 * Crée 100 candidats via Supabase + les inscrit via l'API
 */

const API_URL = "http://localhost:3000";
const JWT_SECRET = "22d1848c06bdf08a7fa9585e2a6fb7387f52d3561da14367db7635fe3593bde9";

// Initialiser Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface Candidate {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  token: string;
}

// ══════════════════════════════════════════════════════════════════
// 0. TROUVER UN SLOT AVEC PLACE
// ══════════════════════════════════════════════════════════════════
async function findAvailableSlot(): Promise<any> {
  console.log("🔍 Recherche d'un slot avec place...\n");

  const { data: slots, error } = await supabase
    .from("evaluation_slots")
    .select("*, enrollments:slot_enrollments(id)")
    .eq("status", "published")
    .limit(1);

  if (error) {
    console.error("❌ Erreur BD:", error);
    return null;
  }

  const slot = slots?.find(
    (s: any) => (s.enrollments?.length || 0) < s.max_candidates
  );

  if (!slot) {
    console.error("❌ Aucun slot avec place");
    return null;
  }

  console.log(`✅ Slot trouvé:`);
  console.log(`   📅 ${slot.date} ${slot.start_time}-${slot.end_time}`);
  console.log(`   👥 Places: ${(slot.enrollments?.length || 0)}/${slot.max_candidates}`);
  console.log(`   ID: ${slot.id}\n`);

  return slot;
}

// ══════════════════════════════════════════════════════════════════
// 1. CRÉER 100 CANDIDATS
// ══════════════════════════════════════════════════════════════════
async function createCandidates(count: number): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const startTime = Date.now();

  console.log(`📝 Création de ${count} candidats...\n`);

  // Préparer les données
  const data = Array.from({ length: count }, (_, i) => ({
    first_name: "Test",
    last_name: `LoadTest${i}`,
    email: `loadtest-${Date.now()}-${i}@example.com`,
  }));

  // Créer par batch de 50
  const batchSize = 50;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    const { data: created, error } = await supabase
      .from("candidates")
      .insert(batch)
      .select();

    if (error) {
      console.error(`❌ Erreur création batch ${i / batchSize + 1}:`, error);
      continue;
    }

    if (created) {
      for (const cand of created) {
        const token = jwt.sign(
          {
            id: cand.id,
            email: cand.email,
            role: "candidate",
          },
          JWT_SECRET,
          { expiresIn: "2h" }
        );

        candidates.push({
          id: cand.id,
          email: cand.email,
          firstName: cand.first_name,
          lastName: cand.last_name,
          token,
        });
      }
    }

    console.log(`  ✓ ${Math.min(i + batchSize, count)}/${count} candidats créés`);
  }

  const duration = Date.now() - startTime;
  console.log(`✅ ${candidates.length} candidats en ${(duration / 1000).toFixed(2)}s\n`);

  return candidates;
}

// ══════════════════════════════════════════════════════════════════
// 2. INSCRIRE SUR LE SLOT
// ══════════════════════════════════════════════════════════════════
async function enrollCandidates(
  candidates: Candidate[],
  slotId: string
): Promise<void> {
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
        if (i < 3) {
          const error = await res.json();
          console.log(`  ⚠️  ${i}: ${error.error}`);
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
  const p99 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.99)];

  console.log(`\n✅ Inscriptions: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`   ✓ Succès: ${successCount} | ❌ Erreurs: ${failCount}`);
  console.log(`   Taux réussite: ${((successCount / candidates.length) * 100).toFixed(1)}%`);
  console.log(`   ⏱️  Moyen: ${avgTime.toFixed(0)}ms | Min: ${minTime}ms | Max: ${maxTime}ms`);
  console.log(`   P99: ${p99?.toFixed(0)}ms\n`);
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════
async function main() {
  console.log("\n🚀 SIMULATION DE CHARGE - RH Manager");
  console.log("═════════════════════════════════════════\n");

  const slot = await findAvailableSlot();
  if (!slot) {
    console.error("❌ Impossible de commencer");
    process.exit(1);
  }

  const candidates = await createCandidates(100);
  if (candidates.length === 0) {
    console.error("❌ Aucun candidat créé");
    process.exit(1);
  }

  await enrollCandidates(candidates, slot.id);

  console.log("📊 RÉSUMÉ");
  console.log("═════════════════════════════════════════");
  console.log(`✅ Test de charge terminé!`);
  console.log(`   ${candidates.length} candidats créés et inscrits`);
  console.log(`   → Tester la performance du planning candidat`);
  console.log(`   → Tester la performance du planning admin`);
  console.log(`   → Observer le temps de chargement des pages\n`);
}

main().catch(console.error);
