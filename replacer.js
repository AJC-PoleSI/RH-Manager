const fs = require('fs');
let content = fs.readFileSync('frontend/src/app/(dashboard)/dashboard/planning/page.tsx', 'utf-8');

// Insert import if not exists
if (!content.includes('CalendarAdminBuilder')) {
    content = content.replace("import { useToast } from '@/components/ui/toast';", "import { useToast } from '@/components/ui/toast';\nimport CalendarAdminBuilder from '@/components/calendar/CalendarAdminBuilder';");
}

// Find ranges
const startIndex = content.indexOf('{/* Card: Dispos evaluateurs */}');
const endIndex = content.indexOf('{/* ══════════════════════════════════════════════════════════════════\n                    RÈGLE 5 : Événements globaux (visibles par tous les candidats)\n                    ══════════════════════════════════════════════════════════════════ */}');

if (startIndex !== -1 && endIndex !== -1) {
    const replacement = `                {selectedEpreuveId ? (
                    <CalendarAdminBuilder 
                        selectedEpreuveId={selectedEpreuveId}
                        epreuve={epreuves.find(e => e.id === selectedEpreuveId)}
                        toast={toast}
                        onUpdate={() => {}} 
                    />
                ) : (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-gray-500">
                        Veuillez selectionner une epreuve ci-dessus pour configurer son planning.
                    </div>
                )}

                `;
    fs.writeFileSync('frontend/src/app/(dashboard)/dashboard/planning/page.tsx', content.substring(0, startIndex) + replacement + content.substring(endIndex));
    console.log("Replacement successful.");
} else {
    console.log("Could not find start or end index", {startIndex, endIndex});
}
