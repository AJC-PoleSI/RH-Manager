import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Clear existing data
  await prisma.candidateWish.deleteMany();
  await prisma.evaluatorTracking.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.candidateEvaluation.deleteMany();
  await prisma.deliberation.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.epreuve.deleteMany();
  await prisma.member.deleteMany();

  // Create test admin member
  const adminPasswordHash = bcrypt.hashSync('password123', 10);
  const admin = await prisma.member.create({
    data: {
      email: 'admin@rhmanager.com',
      passwordHash: adminPasswordHash,
      isAdmin: true,
    },
  });
  console.log('✅ Admin created: admin@rhmanager.com');

  // Create test regular member
  const memberPasswordHash = bcrypt.hashSync('member123', 10);
  const member = await prisma.member.create({
    data: {
      email: 'evaluator@rhmanager.com',
      passwordHash: memberPasswordHash,
      isAdmin: false,
    },
  });
  console.log('✅ Member created: evaluator@rhmanager.com');

  // Create test epreuves
  const epreuve1 = await prisma.epreuve.create({
    data: {
      name: 'Entretien Initial',
      tour: 1,
      type: 'oral',
      durationMinutes: 30,
      evaluationQuestions: JSON.stringify([
        { q: 'Parlez-nous de votre expérience', weight: 2 },
        { q: 'Vos points forts ?', weight: 1 },
        { q: 'Vos faiblesses ?', weight: 1 },
      ]),
      isPoleTest: false,
    },
  });

  const epreuve2 = await prisma.epreuve.create({
    data: {
      name: 'Test Technique',
      tour: 2,
      type: 'technical',
      durationMinutes: 60,
      evaluationQuestions: JSON.stringify([
        { q: 'Compétences techniques', weight: 3 },
        { q: 'Résolution de problème', weight: 2 },
      ]),
      isPoleTest: false,
    },
  });

  const epreuve3 = await prisma.epreuve.create({
    data: {
      name: 'Business Game RH',
      tour: 2,
      type: 'business_game',
      durationMinutes: 90,
      evaluationQuestions: JSON.stringify([
        { q: 'Leadership', weight: 2 },
        { q: 'Travail en équipe', weight: 2 },
        { q: 'Gestion du stress', weight: 1 },
      ]),
      isPoleTest: true,
      pole: 'RH',
    },
  });

  console.log('✅ 3 test epreuves created');

  // Create test candidates
  const candidates = [];
  for (let i = 1; i <= 5; i++) {
    const candidate = await prisma.candidate.create({
      data: {
        firstName: `Candidat${i}`,
        lastName: `Test${i}`,
        email: `candidate${i}@test.com`,
        phone: `+33612345${String(i).padStart(3, '0')}`,
        comments: i % 2 === 0 ? `Notes sur le candidat ${i}` : null,
      },
    });
    candidates.push(candidate);
  }
  console.log(`✅ ${candidates.length} test candidates created`);

  // Create test evaluations
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    await prisma.candidateEvaluation.create({
      data: {
        candidateId: candidate.id,
        epreuveId: epreuve1.id,
        memberId: admin.id,
        scores: JSON.stringify({ experience: 8, strengths: 7, weaknesses: 6 }),
        comment: `Bon candidat`,
      },
    });

    await prisma.candidateEvaluation.create({
      data: {
        candidateId: candidate.id,
        epreuveId: epreuve2.id,
        memberId: member.id,
        scores: JSON.stringify({ technical: 7, problem_solving: 8 }),
        comment: `Compétences solides`,
      },
    });

    await prisma.candidateEvaluation.create({
      data: {
        candidateId: candidate.id,
        epreuveId: epreuve3.id,
        memberId: admin.id,
        scores: JSON.stringify({ leadership: 7, teamwork: 8, stress: 6 }),
        comment: `Bon leader`,
      },
    });
  }
  console.log('✅ 15 test evaluations created');

  // Create candidate wishes
  const poles = ['Communication', 'Marketing', 'RH', 'SI', 'Finance'];
  for (const candidate of candidates) {
    const shuffledPoles = [...poles].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffledPoles.length; i++) {
      await prisma.candidateWish.create({
        data: {
          candidateId: candidate.id,
          pole: shuffledPoles[i],
          rank: i + 1,
        },
      });
    }
  }
  console.log('✅ Candidate wishes created');

  // Create deliberations
  for (const candidate of candidates) {
    await prisma.deliberation.create({
      data: {
        candidateId: candidate.id,
        tour1Status: 'admitted',
        tour2Status: 'admitted',
        tour3Status: 'pending',
        globalComments: 'À suivre',
      },
    });
  }
  console.log('✅ Deliberations created');

  console.log('\n🎉 Database seeded successfully!\n');
  console.log('📝 TEST CREDENTIALS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ADMIN:');
  console.log('  Email:    admin@rhmanager.com');
  console.log('  Password: password123');
  console.log('\nMEMBER:');
  console.log('  Email:    evaluator@rhmanager.com');
  console.log('  Password: member123');
  console.log('\nCONDIDATES (for candidate login):');
  for (let i = 1; i <= 5; i++) {
    console.log(`  Email: candidate${i}@test.com | Last Name: Test${i}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
