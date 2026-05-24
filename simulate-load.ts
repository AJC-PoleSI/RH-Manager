import jwt from "jsonwebtoken";

/**
 * SIMULATION DE CHARGE : 100 candidats -> 1 slot
 * Tests : performance inscription, planification candidat, admin avec 100 inscrits
 */

const API_URL = "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

if (!JWT_SECRET || !ADMIN_TOKEN) {
  console.error("❌ Manque JWT_SECRET ou ADMIN_TOKEN");
  process.exit(1);
}

interface Candidate {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  token: string;
}

// ══════════════════════════════════════════════════════════════════
// 1. CRÉER 100 CANDIDATS
// ══════════════════════════════════════════════════════════════════
async function createCandidates(count: number): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const startTime = Date.now();

  console.log(`\n📝 Création de ${count} candidats...`);

  for (let i = 0; i < count; i++) {
    const email = `test-load-${i}@example.com`;
    const firstName = `Test`;
    const lastName = `Candidate${i}`;

    try {
      const res = await fetch(`${API_URL}/api/candidates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ firstName, lastName, email }),
      });

      if (!res.ok) {
        console.error(`  ❌ Candidat ${i}: ${res.status}`);
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

      if ((i + 1) % 20 === 0) {
        console.log(`  ✓ ${i + 1}/${count} candidats créés`);
      }
    } catch (err) {
      console.error(`  ❌ Erreur candidat ${i}:`, err);
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `✅ ${candidates.length} candidats créés en ${(duration / 1000).toFixed(2)}s`
  );
  console.log(
    `   Vitesse: ${((candidates.length / duration) * 1000).toFixed(0)} cand/s\n`
  );

  return candidates;
}

// ══════════════════════════════════════════════════════════════════
// 2. INSCRIRE TOUS LES CANDIDATS SUR LE MÊME SLOT
// ══════════════════════════════════════════════════════════════════
async function enrollCandidates(
  candidates: Candidate[],
  slotId: string
): Promise<void> {
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  console.log(`\n📅 Inscription de ${candidates.length} candidats sur slot ${slotId}...`);

  const timings: number[] = [];

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

      const duration = Date.now() - enrollStart;
      timings.push(duration);

      if (res.ok) {
        successCount++;
      } else {
        failCount++;
        if (i < 5 || i % 20 === 0) {
          const error = await res.json();
          console.log(
            `  ⚠️  Candidat ${i} (${res.status}): ${error.error}`
          );
        }
      }

      if ((i + 1) % 20 === 0) {
        console.log(
          `  ✓ ${i + 1}/${candidates.length} inscriptions (${duration}ms)`
        );
      }
    } catch (err) {
      failCount++;
      console.error(`  ❌ Erreur inscription ${i}:`, err);
    }
  }

  const totalDuration = Date.now() - startTime;
  const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
  const minTime = Math.min(...timings);
  const maxTime = Math.max(...timings);

  console.log(`✅ Inscriptions terminées en ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`   ✓ Succès: ${successCount} | ❌ Erreurs: ${failCount}`);
  console.log(`   ⏱️  Temps moyen: ${avgTime.toFixed(0)}ms`);
  console.log(`   ⏱️  Min: ${minTime}ms | Max: ${maxTime}ms\n`);
}

// ══════════════════════════════════════════════════════════════════
// 3. MAIN
// ══════════════════════════════════════════════════════════════════
async function main() {
  console.log("🚀 SIMULATION DE CHARGE - RH Manager");
  console.log("====================================\n");

  // TODO: Récupérer le slotId d'un slot existant
  const slotId = process.argv[2] || "slot-id-here";

  if (slotId === "slot-id-here") {
    console.error("❌ Usage: npx ts-node simulate-load.ts <slotId>");
    process.exit(1);
  }

  const candidates = await createCandidates(100);
  await enrollCandidates(candidates, slotId);

  console.log("📊 RÉSULTAT:");
  console.log(`   - ${candidates.length} candidats créés et inscrits`);
  console.log(`   - Slot: ${slotId}`);
  console.log(
    `   - Prochaine étape: Vérifier le planning candidat et admin\n`
  );
}

main().catch(console.error);
