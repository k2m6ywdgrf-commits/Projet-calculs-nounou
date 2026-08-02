// Tests de régression pour le moteur de calcul de paie (calculerPaye).
//
// Pas de framework de test : un compteur pass/fail maison + `assert` natif de
// Node, volontairement simple pour un projet sans étape de build. Chaque cas
// force un planning précis via agendaCustom (plutôt que de dépendre du
// planning "par défaut" du calendrier), pour que les montants attendus soient
// calculables à la main et non ambigus.
//
// Lancer : npm test   (ou : node tests/calculerPaye.test.js)
// Nécessite jsdom (npm install), car charger index.html exécute initApp()
// qui touche le DOM — calculerPaye() elle-même est une fonction pure.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

let passed = 0;
let failed = 0;
const failures = [];

function test(nom, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${nom}`);
    } catch (e) {
        failed++;
        failures.push({ nom, erreur: e.message });
        console.log(`  ✗ ${nom}`);
        console.log(`    ${e.message}`);
    }
}

function presque(a, b, msg, eps = 0.01) {
    assert.ok(Math.abs(a - b) < eps, `${msg} : attendu ${b}, obtenu ${a}`);
}

// Charge une instance fraîche de l'appli dans jsdom et attend l'initialisation.
function chargerApp() {
    const html = fs.readFileSync(INDEX_HTML, 'utf-8');
    const dom = new JSDOM(html, {
        url: 'http://localhost/index.html',
        runScripts: 'dangerously',
        pretendToBeVisual: true
    });
    return dom;
}

// Force l'intégralité d'un mois à "non travaillé", puis marque comme
// travaillés uniquement les jours ISO fournis — donne un planning
// entièrement déterministe, indépendant du calendrier réel du mois.
function forcerPlanning(window, enf, moisIso, joursTravailles) {
    const [y, m] = moisIso.split('-').map(Number);
    const totalJours = new Date(y, m, 0).getDate();
    enf.agendaCustom = enf.agendaCustom || {};
    const joursSet = new Set(joursTravailles);
    for (let d = 1; d <= totalJours; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        enf.agendaCustom[iso] = joursSet.has(iso) ? 'travaill_force' : 'deduit_force';
    }
}

async function main() {
    console.log('calculerPaye() — tests de régression\n');

    // ============================================================
    // CAS A — calcul au réel simple, sans heures majorées
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        const mois = '2026-08';

        // Deux semaines pleines Lun-Ven (10 jours) : 3,4,5,6,7 puis 10,11,12,13,14.
        forcerPlanning(window, enf, mois, [
            '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
            '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'
        ]);
        enf.heuresJour = 6;
        enf.seuilHebdo = 45; // 5 × 6h = 30h/semaine, jamais de dépassement
        enf.tauxNormal = 4.50;
        enf.tauxMajore = 4.95;
        enf.entretienBaseReference = 9; // tauxHoraire = 1,00 €/h tout rond
        enf.entretienPlancherMinimal = 2.65;
        // Lignes par défaut : Lun-Jeu 9h30, Ven 8h30.

        const R = window.calculerPaye(enf, mois);

        test('A. 10 jours de garde', () => assert.strictEqual(R.joursGarde, 10));
        test('A. 60h normales, 0h majorée', () => {
            presque(R.totalNormalHours, 60);
            presque(R.totalMajoreHours, 0);
        });
        test('A. montant normal = 270,00 €', () => presque(R.montantNormal, 270.00));
        test('A. entretien = 93,00 € (8j × 9,50€ + 2j × 8,50€)', () => presque(R.entretienTotal, 93.00));
        test('A. repas = 55,00 € (10j × 5,50€)', () => presque(R.repasTotal, 55.00));
        test('A. total général = 418,00 €', () => presque(R.totalGeneral, 418.00));

        dom.window.close();
    }

    // ============================================================
    // CAS B — heures majorées (semaine à 70h, seuil à 45h)
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        const mois = '2026-08';

        // Semaine complète Lun 3 → Dim 9 août, 7 jours travaillés.
        forcerPlanning(window, enf, mois, [
            '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
            '2026-08-07', '2026-08-08', '2026-08-09'
        ]);
        enf.heuresJour = 10;
        enf.seuilHebdo = 45;
        enf.tauxNormal = 4.50;
        enf.tauxMajore = 4.95;
        enf.entretienBaseReference = 9;
        enf.entretienPlancherMinimal = 2.65;

        const R = window.calculerPaye(enf, mois);

        // Cumul jour par jour (10h/j) : 10,20,30,40,50,60,70 → seuil dépassé
        // à partir du 5e jour (jeu 45..50) puis les 6e/7e jours (sam/dim)
        // entièrement en heures majorées.
        test('B. 45h normales, 25h majorées', () => {
            presque(R.totalNormalHours, 45);
            presque(R.totalMajoreHours, 25);
        });
        test('B. montant normal = 202,50 €, majoré = 123,75 €', () => {
            presque(R.montantNormal, 202.50);
            presque(R.montantMajore, 123.75);
        });
        test('B. entretien = 46,50 € (4j Lun-Jeu à 9,50€ + 1j Ven à 8,50€)', () => presque(R.entretienTotal, 46.50));
        test('B. total général = 411,25 €', () => presque(R.totalGeneral, 411.25));

        dom.window.close();
    }

    // ============================================================
    // CAS C — contrat mensualisé (heures fixes, indépendantes du planning)
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        const mois = '2026-08';

        forcerPlanning(window, enf, mois, []); // aucun jour travaillé
        enf.mensualisationOn = true;
        enf.mensualiseNormal = 130;
        enf.mensualiseMajore = 10;
        enf.tauxNormal = 4.50;
        enf.tauxMajore = 4.95;

        const R = window.calculerPaye(enf, mois);

        test('C. heures = forfait mensualisé (130 / 10), pas le planning', () => {
            presque(R.totalNormalHours, 130);
            presque(R.totalMajoreHours, 10);
        });
        test('C. joursGarde = 0 (planning vide)', () => assert.strictEqual(R.joursGarde, 0));
        test('C. montants = 585,00 € + 49,50 € = 634,50 €', () => {
            presque(R.montantNormal, 585.00);
            presque(R.montantMajore, 49.50);
            presque(R.totalGeneral, 634.50);
        });

        dom.window.close();
    }

    // ============================================================
    // CAS D — cotisations sociales, les 4 bases de calcul
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        const mois = '2026-08';

        forcerPlanning(window, enf, mois, [
            '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
            '2026-08-07', '2026-08-08', '2026-08-09'
        ]);
        enf.heuresJour = 10;
        enf.seuilHebdo = 45;
        enf.tauxNormal = 4.50;
        enf.tauxMajore = 4.95;
        enf.entretienOn = false;
        enf.repasOn = false;
        enf.cotisationsOn = true;
        enf.cotisations = [
            { id: 'c1', nom: 'A', baseType: 'net', taux: 10 },
            { id: 'c2', nom: 'B', baseType: 'heure', taux: 1 },
            { id: 'c3', nom: 'C', baseType: 'net_maj', taux: 10 },
            { id: 'c4', nom: 'D', baseType: 'heure_maj', taux: 2 }
        ];

        const R = window.calculerPaye(enf, mois);

        // salaireNetBase = 202,50 + 123,75 = 326,25 ; totalHeures = 70
        test('D. % sur Net = 32,625 €', () => presque(R.cotisationsDetails[0].montant, 32.625));
        test('D. €/heure (total) = 70,00 €', () => presque(R.cotisationsDetails[1].montant, 70.00));
        test('D. % sur Heures Sup. = 12,375 €', () => presque(R.cotisationsDetails[2].montant, 12.375));
        test('D. €/h sur Heures Sup. = 50,00 €', () => presque(R.cotisationsDetails[3].montant, 50.00));
        test('D. cotisationsTotal = 165,00 €', () => presque(R.cotisationsTotal, 165.00));

        dom.window.close();
    }

    // ============================================================
    // CAS E — jour férié qui tombe un week-end, travaillé sur dérogation
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        const mois = '2026-08';

        // Le 15 août 2026 est un samedi ET l'Assomption (jour férié).
        forcerPlanning(window, enf, mois, ['2026-08-15']);

        const R = window.calculerPaye(enf, mois);
        test('E. jour férié + week-end travaillé sur dérogation = 1 jour de garde', () => {
            assert.strictEqual(R.joursGarde, 1);
        });

        dom.window.close();
    }

    // ============================================================
    // CAS F — semaine à cheval sur deux mois (seuil hebdomadaire)
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        const mois = '2026-08';

        // Semaine du lundi 27 juillet au dimanche 2 août 2026 : seuls le
        // samedi 1er et le dimanche 2 août appartiennent au mois calculé.
        enf.agendaCustom = enf.agendaCustom || {};
        const totalAout = new Date(2026, 8, 0).getDate();
        for (let d = 1; d <= totalAout; d++) {
            enf.agendaCustom[`2026-08-${String(d).padStart(2, '0')}`] = 'deduit_force';
        }
        ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']
            .forEach(iso => { enf.agendaCustom[iso] = 'travaill_force'; });

        enf.heuresJour = 10;
        enf.seuilHebdo = 45;
        enf.tauxNormal = 4.50;
        enf.tauxMajore = 4.95;

        const R = window.calculerPaye(enf, mois);

        // Le cumul hebdomadaire (venant de juillet) dépasse déjà 45h avant
        // même d'entrer dans août : les 2 jours d'août sont donc ENTIÈREMENT
        // en heures majorées (10h + 10h), sans qu'aucune heure de juillet ne
        // soit comptée dans le total du mois d'août.
        test('F. joursGarde = 2 (seuls les jours d\'août comptent)', () => assert.strictEqual(R.joursGarde, 2));
        test('F. 0h normale, 20h majorée (report du cumul de juillet)', () => {
            presque(R.totalNormalHours, 0);
            presque(R.totalMajoreHours, 20);
        });
        test('F. total général = 99,00 € + repas', () => {
            presque(R.montantMajore, 99.00);
        });

        dom.window.close();
    }

    // ============================================================
    // CAS G — historique des tarifs appliqué à un mois PASSÉ non validé
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();

        // Juillet 2026 : tarif d'époque 4,00 €/h. Le profil est ensuite passé
        // à 5,00 €/h en août (aujourd'hui). Juillet n'a jamais été validé.
        forcerPlanning(window, enf, '2026-07', ['2026-07-06', '2026-07-07']); // 2 jours, lun/mar
        enf.tauxHistorique = [
            { date: '2026-07-01', tauxNormal: 4.00, tauxMajore: 4.40, majorationPct: 10, initial: true },
            { date: '2026-08-01', tauxNormal: 5.00, tauxMajore: 5.50, majorationPct: 10 }
        ];
        enf.tauxNormal = 5.00; // valeur "actuelle" du profil, différente de juillet
        enf.tauxMajore = 5.50;
        enf.heuresJour = 8;
        enf.seuilHebdo = 45;
        enf.entretienOn = false;
        enf.repasOn = false;

        const Rjuillet = window.calculerPaye(enf, '2026-07');
        const Raout = window.calculerPaye(enf, '2026-08');

        test('G. juillet (passé, non validé) utilise le tarif d\'époque (4,00 €)', () => {
            presque(Rjuillet.tauxNormal, 4.00);
            presque(Rjuillet.montantNormal, 2 * 8 * 4.00); // 64,00 €
        });
        test('G. août (mois courant) utilise le tarif actuel (5,00 €)', () => {
            presque(Raout.tauxNormal, 5.00);
        });

        dom.window.close();
    }

    // ============================================================
    // CAS H — normaliserProfil borne les valeurs importées aberrantes
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));

        const brut = {
            enfants: [{
                id: 'x1', nomEnfant: 'Test',
                heuresJour: 9999, seuilHebdo: -5,
                tauxNormal: -10, entretienLignes: [{ id: 'el1', jours: [1], heures: 999 }],
                repasList: [{ id: 'r1', nom: 'Midi', prix: -3 }]
            }]
        };
        const normalise = window.normaliserEtat(brut).enfants[0];

        test('H. heuresJour borné à 12 (max UI)', () => assert.strictEqual(normalise.heuresJour, 12));
        test('H. seuilHebdo borné à 35 (min UI)', () => assert.strictEqual(normalise.seuilHebdo, 35));
        test('H. tauxNormal négatif ramené à 0', () => assert.strictEqual(normalise.tauxNormal, 0));
        test('H. heures d\'entretien bornées à 24', () => assert.strictEqual(normalise.entretienLignes[0].heures, 24));
        test('H. prix de repas négatif ramené à 0', () => assert.strictEqual(normalise.repasList[0].prix, 0));

        dom.window.close();
    }

    // ============================================================
    // CAS I — jours d'entretien en conflit : la 2e ligne ne peut pas
    // reprendre un jour déjà utilisé par une autre ligne
    // ============================================================
    {
        const dom = chargerApp();
        const { window } = dom;
        await new Promise(r => setTimeout(r, 300));
        const enf = window.getEnfantActif();
        enf.entretienLignes = [
            { id: 'l1', jours: [1, 2], heures: 8 },
            { id: 'l2', jours: [], heures: 8 }
        ];

        window.toggleJourLigne('l2', 1); // lundi déjà pris par l1

        test('I. impossible d\'ajouter un jour déjà pris par une autre ligne', () => {
            assert.ok(!enf.entretienLignes[1].jours.includes(1));
        });

        dom.window.close();
    }

    console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main();
