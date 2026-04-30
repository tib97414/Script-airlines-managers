// Cœur de l'optimiseur : constantes, bonus demande, helpers, cabine,
// parsing de routes, enrichissement, circuits 168h/24h.
// Logique extraite VERBATIM du script original — aucune modification fonctionnelle.
// Une seule extension : "cargoPiggyback" ajouté en fin de circuitCabinConfig
// (cargo embarqué sur les avions PAX déjà configurés — pas de nouveaux avions).

import { AIRCRAFTS_RAW } from "../data/aircrafts.js";

const TURNAROUND = 2;
const FUEL_FACTOR = 0.1875; // coût = FUEL_FACTOR × distance × conso × MASS_UNIT_pax (aller simple)
// MASS_UNIT_pax = nb_sièges_occupés × 0.1t (toutes classes)
const ROUND_STEP = 0.25;
const PRICE = { ECO: 2000, BUS: 3500, FIRST: 6000, CARGO: 9000 };
const SEAT_SPACE = { ECO: 1, BUS: 1.8, FIRST: 4.2 };
const MASS_UNIT = {
  ECO: 0.1,
  BUS: 0.13,
  FIRST: 0.15,
  CARGO: 1.0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTÈME DE BONUS DEMANDE PASSAGERS
// Modèle déterministe multiplicatif — inspiré d'Airlines Manager.
// La demande finale = demandBase × Π(1 + bonus_i × coef_i(distance))
// ═══════════════════════════════════════════════════════════════════════════════

// Bonus courants (valeurs réelles en jeu)
const CURRENT_BONUS = {
  distraction: 821, // divertissement à bord
  price: 669, // attractivité tarifaire
  ponctualite: 857, // ponctualité
  securite: 614, // sécurité
  confort: 570, // confort cabine
  revenue: 1000, // impact revenu (non utilisé sur demande)
  frais: -485, // impact coûts (non utilisé sur demande)
};

// Bonus cibles (simulation — ex: après amélioration)
const TARGET_BONUS = {
  distraction: 100,
  price: 100,
  ponctualite: 100,
  securite: 100,
  confort: 100,
  revenue: 0,
  frais: 0,
};

// Segmentation distance (km)
const DIST_SEG = { SHORT: 3700, LONG: 7550 };

// Interpolation linéaire
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

// Coefficients par point de bonus selon segment
// Format: [short, medium, long] (en % par point → /100 dans le calcul)
// Valeurs stockées en % → divisées par 100 dans getBonusCoef (ex: 0.05 → 0.0005/point)
const BONUS_COEFS = {
  // Confort prix billet (distance-based, pour le revenu — pas la demande pax)
  confort: [0.02, 0.025, 0.03], // court→0.0002  moyen→0.00025  long→0.0003  /point
  distraction: [0.0, 0.05, 0.1], // court→0       moyen→0.0005   long→0.001   /point
  price: [0.1, 0.05, 0.0], // court→0.001   moyen→0.0005   long→0       /point
  ponctualite: [0.03, 0.03, 0.03], // 0.0003/point (éco + bus)
  securite: [0.03, 0.03, 0.03], // 0.0003/point (bus + first)
};
// Confort PAX flat : +0.1%/point → /100 = 0.001 par point (toutes classes, toutes distances)
const CONFORT_FLAT = 0.1; // % par point
// Interpolation d'un coefficient selon la distance (retourne le coef en décimal)
function getBonusCoef(key, distanceKm) {
  const [cShort, cMed, cLong] = BONUS_COEFS[key];
  const d = distanceKm;
  let pct;
  if (d <= DIST_SEG.SHORT) {
    pct = cShort;
  } else if (d <= DIST_SEG.LONG) {
    const midDist = (DIST_SEG.SHORT + DIST_SEG.LONG) / 2;
    if (d <= midDist) {
      const t2 = (d - DIST_SEG.SHORT) / (midDist - DIST_SEG.SHORT);
      pct = lerp(cShort, cMed, t2);
    } else {
      const t2 = (d - midDist) / (DIST_SEG.LONG - midDist);
      pct = lerp(cMed, cLong, t2);
    }
  } else {
    pct = cLong;
  }
  return pct / 100; // convertir % en décimal
}

/**
 * Calcule la demande finale par classe après application des bonus.
 * @param {number} dEcoBase   — demande éco de base (stable, issue du fichier)
 * @param {number} dBusBase   — demande business de base
 * @param {number} dFirstBase — demande première de base
 * @param {number} distance   — distance de la route (km)
 * @param {object} bonus      — objet BONUS (CURRENT_BONUS ou TARGET_BONUS)
 * @returns {{ dEco, dBus, dFirst, factors, appliedBonus }}
 */
function applyDemandBonus(dEcoBase, dBusBase, dFirstBase, distance, bonus) {
  const B = bonus || CURRENT_BONUS;
  const d = distance;

  // Coefficients interpolés pour cette distance (confort exclu — prix uniquement)
  const cDistraction = getBonusCoef("distraction", d);
  const cPrice = getBonusCoef("price", d);
  const cPonct = getBonusCoef("ponctualite", d);
  const cSecurite = getBonusCoef("securite", d);

  // Confort : +0.01% PAX par point (flat, toutes classes, toutes distances)
  // Son effet principal (hausse tarifaire) est géré séparément dans le calcul de revenu.
  const fConfortPax = 1 + B.confort * (CONFORT_FLAT / 100);
  const fDistraction = 1 + B.distraction * cDistraction;
  const fPrice = 1 + B.price * cPrice;
  const fPonct = 1 + B.ponctualite * cPonct;
  const fSecurite = 1 + B.securite * cSecurite;

  // Éco : confort(flat) + distraction + price + ponctualité
  const factorEco = fConfortPax * fDistraction * fPrice * fPonct;
  // Business : confort(flat) + distraction + price + ponctualité + sécurité
  const factorBus = fConfortPax * fDistraction * fPrice * fPonct * fSecurite;
  // First : confort(flat) + distraction + price + sécurité (pas ponctualité)
  const factorFirst = fConfortPax * fDistraction * fPrice * fSecurite;

  return {
    dEco: Math.round(dEcoBase * factorEco),
    dBus: Math.round(dBusBase * factorBus),
    dFirst: Math.round(dFirstBase * factorFirst),
    factors: { eco: factorEco, bus: factorBus, first: factorFirst },
    appliedBonus: B,
  };
}

/**
 * Projette les demandes des routes pour la SIMULATION.
 * Principe : la demande du fichier est déjà la demande réelle en jeu (post-bonus courant).
 * Pour simuler de nouveaux bonus, on applique le ratio target/current :
 *   dEco_projeté = dEco_réel × (facteur_target / facteur_current)
 * Ainsi ajouter 3 points donne bien un +0.09% et pas ×2.3.
 */
function projectRoutesForSimulation(routes, currentBonus, targetBonus) {
  return routes.map((r) => {
    if ((r.dEco || 0) + (r.dBus || 0) + (r.dFirst || 0) === 0) return r;
    const cur = applyDemandBonus(r.dEco, r.dBus, r.dFirst, r.distance, currentBonus);
    const tgt = applyDemandBonus(r.dEco, r.dBus, r.dFirst, r.distance, targetBonus);
    // Ratio par classe : tgt.factor / cur.factor — appliqué à la demande réelle
    const scaleEco   = cur.factors.eco   > 0 ? tgt.factors.eco   / cur.factors.eco   : 1;
    const scaleBus   = cur.factors.bus   > 0 ? tgt.factors.bus   / cur.factors.bus   : 1;
    const scaleFirst = cur.factors.first > 0 ? tgt.factors.first / cur.factors.first : 1;
    return {
      ...r,
      dEco:   Math.round((r.dEco   || 0) * scaleEco),
      dBus:   Math.round((r.dBus   || 0) * scaleBus),
      dFirst: Math.round((r.dFirst || 0) * scaleFirst),
      // Conserver les bases originales pour l'UI
      dEcoBase: r.dEcoBase,
      dBusBase: r.dBusBase,
      dFirstBase: r.dFirstBase,
    };
  });
}

// Génère les tranches de demande dynamiquement selon le bandSize choisi
function makeDemandBands(bandSize) {
  const sz = Math.max(100, Math.round(bandSize || 1000));
  const bands = [];
  // Commencer à 0 pour couvrir toutes les demandes
  for (let start = 0; start < 20000; start += sz) {
    const end = start + sz;
    bands.push({
      label: `${start.toLocaleString()}-${(end - 1).toLocaleString()}`,
      min: start,
      max: end,
    });
  }
  bands.push({ label: `20 000+`, min: 20000, max: Infinity });
  return bands;
}


function flightTime(distance, speed) {
  const raw = (2 * distance) / speed + TURNAROUND;
  return Math.ceil(raw / ROUND_STEP) * ROUND_STEP;
}

// Coût carburant aller-retour pour 1 vol
// = FUEL_FACTOR × distance × conso × payload (charge utile en tonnes)
// La distance est en km, conso en L/100km/t, payload en tonnes
function fuelCostOneWay(distance, conso, payload) {
  return FUEL_FACTOR * distance * conso * payload;
}
function fuelCostRoundTrip(distance, conso, payload) {
  return fuelCostOneWay(distance, conso, payload) * 2;
}

function toNum(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[\s,]/g, ""));
  return isFinite(n) ? n : 0;
}

const configCache = new Map();

function getSeatConfigs(seats) {
  if (!configCache.has(seats)) {
    configCache.set(seats, generateSeatConfigs(seats));
  }
  return configCache.get(seats);
}
function generateSeatConfigs(seats) {
  const configs = [];
  // Pas adaptatif : granularité plus grossière sur les grands avions
  // pour garder un nombre de configs raisonnable (≤ ~3000).
  // Petits (<150) : pas 2/4  —  Moyens (150-299) : 4/8  —  Grands (≥300) : 6/12
  const stepF = seats < 150 ? 2 : seats < 300 ? 4 : 6;
  const stepB = seats < 150 ? 4 : seats < 300 ? 8 : 12;

  for (let sF = 0; sF <= seats * 0.2; sF += stepF) {
    for (let sB = 0; sB <= seats * 0.4; sB += stepB) {
      const used = sF * 4.2 + sB * 1.8;
      if (used > seats) break; // sB croissant → inutile de continuer
      const sE = Math.floor(seats - used);
      configs.push({ sE, sB, sF, label: `${sE}é/${sB}b/${sF}f` });
    }
  }
  return configs;
}

function cabinConfig(seats, dEco, dBus, dFirst, routePrices) {
  const pEco   = (routePrices && routePrices.eco)   || PRICE.ECO;
  const pBus   = (routePrices && routePrices.bus)   || PRICE.BUS;
  const pFirst = (routePrices && routePrices.first) || PRICE.FIRST;

  const cfgs = getSeatConfigs(seats);
  let best = null, bestRev = -Infinity, bestWaste = Infinity;

  for (const { sE, sB, sF, label } of cfgs) {
    const filledEco   = Math.min(sE * 2, dEco);
    const filledBus   = Math.min(sB * 2, dBus);
    const filledFirst = Math.min(sF * 2, dFirst);
    const rev = filledEco * pEco + filledBus * pBus + filledFirst * pFirst;

    // Gaspillage = sièges déployés au-delà de la demande (pondéré par prix)
    // Permet de choisir la config la plus "ajustée" à la demande à revenu égal
    const waste =
      Math.max(0, sE * 2 - dEco)   * pEco  +
      Math.max(0, sB * 2 - dBus)   * pBus  +
      Math.max(0, sF * 2 - dFirst) * pFirst;

    // Préférer le revenu le plus élevé ; à revenu égal, préférer le moins de gaspillage
    if (rev > bestRev + 0.01 || (rev >= bestRev - 0.01 && waste < bestWaste)) {
      bestRev = rev;
      bestWaste = waste;
      best = { sE, sB, sF, rev, label };
    }
  }
  return best || { sE: seats, sB: 0, sF: 0, rev: 0, label: `${seats}é/0b/0f` };
}

// Calcule config cabine optimale pour un circuit multi-routes
// Utilise le min de chaque classe comme demande contraignante
// ── CALCUL TAXE MOYENNE D'UN CIRCUIT ────────────────────────────────────────
// La taxe est par vol (aller-retour = ×2). Pour un circuit multi-routes,
// on utilise la taxe moyenne des routes du circuit comme proxy par rotation.
function avgTaxForRoutes(routes) {
  if (!routes || !routes.length) return 0;
  return routes.reduce((s, r) => s + (r.tax || 0), 0) / routes.length;
}

// ── CONFIGURATION CABINE SIMPLE (1 avion) ────────────────────────────────────
function singleCabinCfg(seats, demEco, demBus, demFirst) {
  const cfg = cabinConfig(seats, demEco, demBus, demFirst);
  cfg.demandEco = demEco;
  cfg.demandBus = demBus;
  cfg.demandFirst = demFirst;
  cfg.capPerAc = { eco: cfg.sE * 2, bus: cfg.sB * 2, first: cfg.sF * 2 };
  return cfg;
}

function buildMultiFleetCascade(primaryAc, allAircrafts, circuitRoutes) {
  const demandsEco = circuitRoutes.map((r) => r.dEco || 0).filter((d) => d > 0);
  const demandsBus = circuitRoutes.map((r) => r.dBus || 0).filter((d) => d > 0);
  const demandsFirst = circuitRoutes
    .map((r) => r.dFirst || 0)
    .filter((d) => d > 0);
  let remEco = demandsEco.length > 0 ? Math.min(...demandsEco) : 0;
  let remBus = demandsBus.length > 0 ? Math.min(...demandsBus) : 0;
  let remFirst = demandsFirst.length > 0 ? Math.min(...demandsFirst) : 0;
  const avgTax = avgTaxForRoutes(circuitRoutes);

  const planes = [];
  const allAc = allAircrafts || AIRCRAFTS_RAW;

  for (let i = 0; i < 30; i++) {
    if (remEco <= 0 && remBus <= 0 && remFirst <= 0) break;

    // Avion 1 → toujours primaryAc. Suivants → meilleur avion éligible + rentable.
    let bestEntry = null;
    const candidates = i === 0 ? [primaryAc] : allAc;

    for (const ac of candidates) {
      // Vérifier éligibilité : distance, catégorie ET temps de vol total ≤ 168h
      if (
        circuitRoutes.some((r) => r.distance > ac.range || r.category < ac.cat)
      )
        continue;
      // BUG FIX: l'avion candidat peut avoir une vitesse différente → recalculer le ft total
      // Si le circuit dépasse 168h à la vitesse du candidat, il est invalide (bug rapporté)
      if (i > 0 && ac.speed) {
        const STEP = 0.25;
        const totalFtCandidate = circuitRoutes.reduce((s, r) => {
          return (
            s +
            Math.ceil(((2 * r.distance) / ac.speed + TURNAROUND) / STEP) * STEP
          );
        }, 0);
        if (totalFtCandidate > 168) continue; // trop lent pour ce circuit
      }

      const cfg = cabinConfig(ac.seats, remEco, remBus, remFirst);
      const capEco = cfg.sE * 2,
        capBus = cfg.sB * 2,
        capFirst = cfg.sF * 2;
      const paxEco = Math.min(capEco, remEco);
      const paxBus = Math.min(capBus, remBus);
      const paxFirst = Math.min(capFirst, remFirst);
      const rev =
        paxEco * PRICE.ECO + paxBus * PRICE.BUS + paxFirst * PRICE.FIRST;
      const tax = avgTax * 2;
      const profit = rev - tax;

      // Avion 1 : on prend toujours (même déficitaire, c'est le circuit de base)
      // Avions suivants : seulement si profit > 0
      if (i > 0 && profit <= 0) continue;

      if (!bestEntry || profit > bestEntry.profit) {
        bestEntry = {
          ac,
          cfg,
          capEco,
          capBus,
          capFirst,
          paxEco,
          paxBus,
          paxFirst,
          rev,
          tax,
          profit,
        };
      }
    }

    if (!bestEntry) break; // aucun avion rentable trouvé

    const {
      ac,
      cfg,
      capEco,
      capBus,
      capFirst,
      paxEco,
      paxBus,
      paxFirst,
      rev,
      tax,
      profit,
    } = bestEntry;
    const isSame = ac.brand === primaryAc.brand && ac.model === primaryAc.model;

    planes.push({
      planeNum: i + 1,
      brand: ac.brand,
      model: ac.model,
      isSameType: isSame,
      label: cfg.label,
      sE: cfg.sE,
      sB: cfg.sB,
      sF: cfg.sF,
      capEco,
      capBus,
      capFirst,
      paxEco,
      paxBus,
      paxFirst,
      demandEco: remEco,
      demandBus: remBus,
      demandFirst: remFirst,
      rev,
      tax,
      profit,
      isProfitable: profit > 0,
      // Référence avion : nécessaire pour le calcul cargo piggy-back
      acPayload: ac.payload,
      acConso: ac.conso,
      acRange: ac.range,
      acSpeed: ac.speed,
      acSeats: ac.seats,
    });

    remEco = Math.max(0, remEco - capEco);
    remBus = Math.max(0, remBus - capBus);
    remFirst = Math.max(0, remFirst - capFirst);
  }

  return { planes, unsatisfied: { eco: remEco, bus: remBus, first: remFirst } };
}

// ── buildFleetCascade : conservé pour enrichRoutes (route individuelle) ──────
// Utilisé quand on n'a pas les routes complètes du circuit (single-route cabin).
function buildFleetCascade(seats, demEco, demBus, demFirst, avgTax, maxPlanes) {
  const MAX = maxPlanes || 20;
  const planes = [];
  let remEco = demEco,
    remBus = demBus,
    remFirst = demFirst;
  for (let i = 0; i < MAX; i++) {
    if (remEco <= 0 && remBus <= 0 && remFirst <= 0) break;
    const cfg = cabinConfig(seats, remEco, remBus, remFirst);
    const capEco = cfg.sE * 2,
      capBus = cfg.sB * 2,
      capFirst = cfg.sF * 2;
    const paxEco = Math.min(capEco, remEco),
      paxBus = Math.min(capBus, remBus),
      paxFirst = Math.min(capFirst, remFirst);
    const rev =
      paxEco * PRICE.ECO + paxBus * PRICE.BUS + paxFirst * PRICE.FIRST;
    const tax = avgTax * 2;
    const profit = rev - tax;
    if (i > 0 && profit <= 0) break;
    planes.push({
      planeNum: i + 1,
      label: cfg.label,
      sE: cfg.sE,
      sB: cfg.sB,
      sF: cfg.sF,
      capEco,
      capBus,
      capFirst,
      paxEco,
      paxBus,
      paxFirst,
      demandEco: remEco,
      demandBus: remBus,
      demandFirst: remFirst,
      rev,
      tax,
      profit,
      isProfitable: profit > 0,
      isSameType: true,
      brand: "",
      model: "",
    });
    remEco = Math.max(0, remEco - capEco);
    remBus = Math.max(0, remBus - capBus);
    remFirst = Math.max(0, remFirst - capFirst);
  }
  return { planes, unsatisfied: { eco: remEco, bus: remBus, first: remFirst } };
}

// ── circuitCabinConfig : entrée publique ──────────────────────────────────────
// primaryAc = avion principal du circuit { brand, model, seats, range, cat }
// allAircrafts = liste de tous les avions à tester pour les places suivantes
// routes = routes enrichies du circuit
function circuitCabinConfig(
  primaryAcOrSeats,
  allAircraftsOrRoutes,
  routesOrUndef
) {
  // Surcharge : ancienne signature (seats, routes) ou nouvelle (primaryAc, allAircrafts, routes)
  let primaryAc, allAircrafts, routes;
  if (routesOrUndef !== undefined) {
    // Nouvelle signature : (primaryAc, allAircrafts, routes)
    primaryAc = primaryAcOrSeats;
    allAircrafts = allAircraftsOrRoutes;
    routes = routesOrUndef;
  } else {
    // Ancienne signature : (seats, routes) — on crée un primaryAc minimal
    const seats = primaryAcOrSeats;
    routes = allAircraftsOrRoutes;
    primaryAc = { brand: "", model: "", seats, range: 99999, cat: 0 };
    allAircrafts = null; // pas de recherche multi-type
  }

  const { planes, unsatisfied } = allAircrafts
    ? buildMultiFleetCascade(primaryAc, allAircrafts, routes)
    : buildFleetCascade(
        primaryAc.seats,
        routes
          .map((r) => r.dEco || 0)
          .filter((d) => d > 0)
          .reduce((mn, d) => Math.min(mn, d), Infinity) || 0,
        routes
          .map((r) => r.dBus || 0)
          .filter((d) => d > 0)
          .reduce((mn, d) => Math.min(mn, d), Infinity) || 0,
        routes
          .map((r) => r.dFirst || 0)
          .filter((d) => d > 0)
          .reduce((mn, d) => Math.min(mn, d), Infinity) || 0,
        avgTaxForRoutes(routes)
      );

  const first = planes[0] || cabinConfig(primaryAc.seats, 0, 0, 0);
  const demandsEco = routes.map((r) => r.dEco || 0).filter((d) => d > 0);
  const demandsBus = routes.map((r) => r.dBus || 0).filter((d) => d > 0);
  const demandsFirst = routes.map((r) => r.dFirst || 0).filter((d) => d > 0);
  const minEco = demandsEco.length > 0 ? Math.min(...demandsEco) : 0;
  const minBus = demandsBus.length > 0 ? Math.min(...demandsBus) : 0;
  const minFirst = demandsFirst.length > 0 ? Math.min(...demandsFirst) : 0;

  // ════════════════════════════════════════════════════════════════════════
  // CARGO PIGGY-BACK : embarquer du fret sur les avions PAX déjà configurés
  // ════════════════════════════════════════════════════════════════════════
  // Principe : à la toute fin de la configuration cabine, on regarde le
  // payload résiduel disponible sur chaque avion PAX du circuit (payload
  // total - masse occupée par les sièges remplis) et on charge du fret
  // jusqu'à concurrence de la demande cargo consolidée du circuit.
  // CRUCIAL : aucun nouvel avion n'est créé — on n'utilise QUE les avions
  // PAX déjà présents dans `planes`.
  const cargoDemands = routes.map((r) => r.dCargo || 0);
  const allRoutesHaveCargo = cargoDemands.every((d) => d > 0);
  let cargoPiggyback = null;
  if (allRoutesHaveCargo && planes.length > 0) {
    let remCargoDemand = Math.min(...cargoDemands);
    const piggyPlanes = [];
    for (const p of planes) {
      if (remCargoDemand <= 0) break;
      const acPayload = p.acPayload || 0;
      const acConso = p.acConso || 0;
      if (acPayload <= 0) continue;
      // Masse occupée par les passagers (tonnes), par classe
      const paxMass =
        (p.paxEco || 0) * MASS_UNIT.ECO +
        (p.paxBus || 0) * MASS_UNIT.BUS +
        (p.paxFirst || 0) * MASS_UNIT.FIRST;
      const residualPayload = acPayload - paxMass;
      if (residualPayload <= 0.05) continue;
      const loaded = Math.min(residualPayload, remCargoDemand);
      if (loaded <= 0.05) continue;
      // Revenu cargo et surcoût carburant cumulés sur toutes les routes du circuit
      let cargoRev = 0;
      let cargoFuelDelta = 0;
      for (const r of routes) {
        const price = r.priceCargo || PRICE.CARGO;
        cargoRev += loaded * price * 2; // aller-retour
        if (acConso > 0) {
          cargoFuelDelta += fuelCostRoundTrip(r.distance, acConso, loaded);
        }
      }
      const cargoProfit = cargoRev - cargoFuelDelta;
      // Pas de taxe additionnelle : la rotation existe déjà pour les pax.
      // On accepte même profit légèrement négatif si la cargo réduit l'overhead ?
      // Non : on suit la même règle que pax — on n'embarque que si cargoProfit > 0.
      if (cargoProfit <= 0) continue;
      // Marquer l'avion PAX avec ses chiffres cargo (pour affichage)
      p.cargoLoaded = +loaded.toFixed(2);
      p.cargoRev = Math.round(cargoRev);
      p.cargoFuelDelta = Math.round(cargoFuelDelta);
      p.cargoProfit = Math.round(cargoProfit);
      p.cargoResidualPayload = +residualPayload.toFixed(2);
      p.cargoPaxMass = +paxMass.toFixed(2);
      piggyPlanes.push({
        planeNum: p.planeNum,
        brand: p.brand,
        model: p.model,
        acPayload,
        paxMass: +paxMass.toFixed(2),
        residualPayload: +residualPayload.toFixed(2),
        loaded: +loaded.toFixed(2),
        cargoRev: Math.round(cargoRev),
        cargoFuelDelta: Math.round(cargoFuelDelta),
        cargoProfit: Math.round(cargoProfit),
        isProfitable: true,
      });
      remCargoDemand = Math.max(0, remCargoDemand - loaded * 2);
    }
    if (piggyPlanes.length > 0) {
      cargoPiggyback = {
        planes: piggyPlanes,
        totalLoaded: +piggyPlanes.reduce((s, p) => s + p.loaded, 0).toFixed(2),
        totalRev: piggyPlanes.reduce((s, p) => s + p.cargoRev, 0),
        totalFuelDelta: piggyPlanes.reduce((s, p) => s + p.cargoFuelDelta, 0),
        totalProfit: piggyPlanes.reduce((s, p) => s + p.cargoProfit, 0),
        cargoDemandPerRoute: Math.min(...cargoDemands),
        cargoDemandRemaining: +remCargoDemand.toFixed(2),
      };
    }
  }

  return {
    sE: first.sE,
    sB: first.sB,
    sF: first.sF,
    rev: first.rev,
    label: first.label,
    demandEco: minEco,
    demandBus: minBus,
    demandFirst: minFirst,
    capPerAc: {
      eco: first.capEco || first.sE * 2,
      bus: first.capBus || first.sB * 2,
      first: first.capFirst || first.sF * 2,
    },
    nbAvions: planes.length,
    fleet: planes,
    unsatisfied,
    cargoPiggyback,
  };
}

function routeRevenue(route, seats) {
  // rev pax (aller-retour) - taxe (aller-retour)
  // Pour N rotations : totalRev = routeRevenue(route,seats) * N
  // Peut être NÉGATIF si la taxe dépasse le revenu pax.
  return (
    cabinConfig(seats, route.dEco, route.dBus, route.dFirst).rev - route.tax * 2
  );
}

function parseRoutes(raw, activeBonus) {
  // Normalise les accents pour la comparaison de colonnes
  const stripAccents = (s) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ");
  const pick = (r, ...keys) => {
    // 1. Correspondance exacte (avec accents)
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null && r[k] !== "")
        return toNum(r[k]);
    }
    // 2. Correspondance insensible aux accents + espaces
    const rKeys = Object.keys(r);
    const rNorms = rKeys.map((rk) => stripAccents(rk));
    for (const k of keys) {
      const norm = stripAccents(k);
      const idx = rNorms.findIndex((rn) => rn.startsWith(norm));
      if (idx >= 0 && r[rKeys[idx]] !== null && r[rKeys[idx]] !== "")
        return toNum(r[rKeys[idx]]);
    }
    return 0;
  };
  const pickStr = (r, ...keys) => {
    for (const k of keys) {
      if (r[k]) return r[k];
    }
    const rKeys = Object.keys(r);
    for (const k of keys) {
      const found = rKeys.find((rk) =>
        rk.toLowerCase().includes(k.toLowerCase())
      );
      if (found && r[found]) return r[found];
    }
    return null;
  };
  return raw
    .map((r, i) => {
      const name     = pickStr(r, "NOM ROUTES") || `Route ${i + 1}`;
      const distance = pick(r, "DISTANCE");
      const category = pick(r, "CATÉGORIE");
      const dEco     = pick(r, "DEMANDE ÉCONOMIE");
      const dBus     = pick(r, "DEMANDE AFFAIRES");
      const dFirst   = pick(r, "DEMANDE PREMIÈRE");
      const dCargo   = pick(r, "DEMANDE CARGO");
      const tax      = pick(r, "TAXE PAR VOL", "TAXE", "taxe", "tax");
      if (distance <= 0 || category <= 0) return null;

      // Prix par route (optionnels — fallback sur les prix globaux si absent)
      const priceEco   = pick(r, "TARIFS ÉCONOMIE") || null;
      const priceBus   = pick(r, "TARIFS AFFAIRES") || null;
      const priceFirst = pick(r, "TARIFS PREMIÈRE") || null;
      const priceCargo = pick(r, "TARIFS CARGO")    || null;

      // Facteurs bonus stockés pour l'aperçu simulation (sans modifier la demande)
      const bonusFactorsOnly =
        activeBonus && (dEco > 0 || dBus > 0 || dFirst > 0)
          ? applyDemandBonus(dEco, dBus, dFirst, distance, activeBonus)
          : null;

      return {
        id: `r${i}`,
        name,
        distance,
        category,
        dEco,
        dBus,
        dFirst,
        dEcoBase:  dEco,
        dBusBase:  dBus,
        dFirstBase: dFirst,
        bonusFactors: bonusFactorsOnly ? bonusFactorsOnly.factors : null,
        dCargo,
        tax,
        priceEco,
        priceBus,
        priceFirst,
        priceCargo,
      };
    })
    .filter(Boolean);
}

// ── enrichRoutesLight : version rapide pour l'OPTIMISEUR ─────────────────────
// Pas de buildFleetCascade (calcul de flotte), juste ft/profit/cabinLite.
// Utilisé dans toutes les boucles d'optimisation (runGlobalOpt, résiduel, etc.)
function enrichRoutesLight(aircraft, routes, maxH) {
  const result = [];
  for (const r of routes) {
    if (r.distance > aircraft.range || r.category < aircraft.cat) continue;
    const ft = flightTime(r.distance, aircraft.speed);
    if (ft <= 0 || ft > maxH) continue;
    const cabin = cabinConfig(aircraft.seats, r.dEco, r.dBus, r.dFirst, {
      eco: r.priceEco || null,
      bus: r.priceBus || null,
      first: r.priceFirst || null,
    });
    cabin.demandEco = r.dEco || 0;
    cabin.demandBus = r.dBus || 0;
    cabin.demandFirst = r.dFirst || 0;
    cabin.capPerAc = {
      eco: cabin.sE * 2,
      bus: cabin.sB * 2,
      first: cabin.sF * 2,
    };
    // Pas de fleet cascade — rempli à la demande dans CircuitCard
    cabin.fleet = null;
    cabin.nbAvions = null;
    cabin.unsatisfied = null;
    // MASS_UNIT réelle embarquée = nb_pax × 0.1t (indépendant de la classe)
    // MASS_UNIT pax = nb_sièges × 0.1t  /  cargo = tonnes réelles chargées
    const MASS_UNITPax = (cabin.sE + cabin.sB + cabin.sF) * 0.1;
    const MASS_UNITCargo =
      r.dCargo && r.dCargo > 0
        ? Math.min(aircraft.payload || 10, r.dCargo)  // tonnes, pas ×0.1
        : 0;
    const MASS_UNITTotal = MASS_UNITPax + MASS_UNITCargo;
    const fuelCost = aircraft.conso
      ? fuelCostOneWay(r.distance, aircraft.conso, MASS_UNITTotal || 0.1)
      : 0;
    result.push({
      ...r,
      ft,
      rev: cabin.rev - r.tax * 2,
      profit: cabin.rev - r.tax * 2 - fuelCost,
      fuelCost,
      grossPaxRev: cabin.rev,
      cabin,
    });
  }
  return result;
}

// ── enrichRoutesFull : version complète pour l'AFFICHAGE ──────────────────────
// Appelée uniquement quand l'utilisateur ouvre un circuit (CircuitCard).
// Calcule buildFleetCascade pour chaque route → fleet/nbAvions/unsatisfied.
function enrichRoutesFull(aircraft, routes, maxH) {
  return enrichRoutesLight(aircraft, routes, maxH).map((r) => {
    const { planes, unsatisfied } = buildFleetCascade(
      aircraft.seats,
      r.cabin.demandEco,
      r.cabin.demandBus,
      r.cabin.demandFirst,
      r.tax || 0
    );
    r.cabin.fleet = planes;
    r.cabin.unsatisfied = unsatisfied;
    r.cabin.nbAvions = planes.length;
    return r;
  });
}

// ── enrichRoutes : alias rétro-compatible ─────────────────────────────────────
// Redirige vers Light (optimiseur) ou Full selon contexte.
function enrichRoutes(aircraft, routes, maxH) {
  return enrichRoutesLight(aircraft, routes, maxH);
}

function fillExact(candidates, targetH, tolerance) {
  if (!candidates.length) return [];
  const STEP = 0.25;
  const CAP = Math.round(targetH / STEP);
  const TOL = Math.round((tolerance || 0.5) / STEP);

  // ── Tri "Tetris par avion" ────────────────────────────────────────────────────
  // Le ft est DÉJÀ calculé avec la vitesse de l'avion courant (via enrichRoutesLight).
  // Tri: ft DESC → pour cet avion, les routes les plus longues en premier.
  // Tie-break: demande ECO DESC → à durée égale (±0.25h), la plus forte demande prime.
  const sorted = [...candidates].sort((a, b) => {
    // Groupe de ft (arrondi au quart d'heure) pour comparer les durées
    const ftA = Math.round(a.ft / 0.25) * 0.25;
    const ftB = Math.round(b.ft / 0.25) * 0.25;
    if (ftA !== ftB) return ftB - ftA; // ft DESC (durée propre à l'avion)
    const dA = a.dEco || a.demand || 0;
    const dB = b.dEco || b.demand || 0;
    return dB - dA; // demande DESC (tie-break)
  });

  const items = sorted
    .map((r) => ({ ...r, slots: Math.round(r.ft / STEP) }))
    .filter((r) => r.slots > 0 && r.slots <= CAP);
  if (!items.length) return [];
  const dp = new Uint8Array(CAP + 1);
  const from = new Int16Array(CAP + 1).fill(-1);
  const prev = new Int32Array(CAP + 1).fill(-1);
  dp[0] = 1;
  for (let i = 0; i < items.length; i++) {
    const s = items[i].slots;
    for (let cap = CAP; cap >= s; cap--) {
      if (dp[cap - s] && !dp[cap]) {
        dp[cap] = 1;
        from[cap] = i;
        prev[cap] = cap - s;
      }
    }
  }
  let best = -1;
  for (let d = 0; d <= TOL; d++) {
    if (CAP - d >= 0 && dp[CAP - d]) {
      best = CAP - d;
      break;
    }
    if (CAP + d < dp.length && dp[CAP + d]) {
      best = CAP + d;
      break;
    }
  }
  if (best < 0) return ffd(candidates, targetH);
  const chosen = [];
  let cur = best;
  while (cur > 0 && from[cur] >= 0) {
    chosen.push(items[from[cur]]);
    cur = prev[cur];
  }
  return chosen;
}

function ffd(candidates, targetH) {
  // Trier par ft DESC (greedy filling) mais à égalité de ft, préférer profit/h
  // Tetris: ft DESC (propre à l'avion) → demande DESC (tie-break)
  const sorted = [...candidates].sort((a, b) => {
    const ftA = Math.round(a.ft / 0.25) * 0.25,
      ftB = Math.round(b.ft / 0.25) * 0.25;
    if (ftA !== ftB) return ftB - ftA;
    return (b.dEco || b.demand || 0) - (a.dEco || a.demand || 0);
  });
  const circuit = [];
  let left = targetH;
  for (const r of sorted) {
    if (r.ft <= left + 0.001) {
      circuit.push(r);
      left -= r.ft;
    }
    if (left < 0.25) break;
  }
  return circuit;
}

function mkC168(chosen, extra, aircraft) {
  const tt = chosen.reduce((s, r) => s + r.ft, 0);
  const tp = chosen.reduce((s, r) => s + r.profit, 0);
  // Cascade multi-avions : avion principal + tous les avions éligibles pour les places restantes
  const primaryAc = aircraft
    ? {
        brand: aircraft.brand || "",
        model: aircraft.model || "",
        seats: aircraft.seats ?? 0,
        range: aircraft.range || 99999,
        cat: aircraft.cat || 0,
      }
    : null;
  const cabin = primaryAc
    ? circuitCabinConfig(primaryAc, AIRCRAFTS_RAW, chosen)
    : chosen[0]?.cabin || null;
  return {
    windowH: 168,
    type: `${chosen.length} route(s)`,
    routes: chosen.map((r) => ({
      id: r.id,
      name: r.name,
      distance: r.distance,
      ft: r.ft,
      profit: r.profit,
      rev: r.rev,
      dEco: r.dEco,
      dBus: r.dBus,
      dFirst: r.dFirst,
      cabin: r.cabin,
      rotations: 1,
      tax: r.tax,
    })),
    routeIds: chosen.map((r) => r.id),
    totalTime: tt,
    totalProfit: tp,
    cabin, // config cabine optimale du circuit
    profitPerHour: tt > 0 ? tp / tt : 0,
    routeCount: chosen.length,
    fillRate: ((tt / 168) * 100).toFixed(1),
    ...extra,
  };
}

function buildCircuits168(aircraft, routes) {
  const eligible = enrichRoutes(aircraft, routes, 168);
  if (eligible.length < 2) return [];
  const circuits = [];
  const lu = new Set();
  let pass = 0;
  while (pass++ < 2000) {
    const free = eligible.filter((r) => !lu.has(r.id));
    if (free.length < 2) break;
    const chosen = fillExact(free, 168, 24);
    if (!chosen.length) break;
    circuits.push(mkC168(chosen, { pool: "" }, aircraft));
    chosen.forEach((r) => lu.add(r.id));
  }
  {
    let p = 0;
    while (p++ < 500) {
      const free = eligible.filter((r) => !lu.has(r.id));
      if (free.length < 2) break;
      const chosen = ffd(free, 168);
      if (chosen.length < 2) break;
      circuits.push(
        mkC168(
          chosen,
          { pool: "repack", type: `${chosen.length} route(s) [repack]` },
          aircraft
        )
      );
      chosen.forEach((r) => lu.add(r.id));
    }
  }
  eligible
    .filter((r) => !lu.has(r.id))
    .forEach((r) => {
      circuits.push({
        windowH: 168,
        pool: "—",
        type: "1 route (isolée)",
        routes: [
          {
            id: r.id,
            name: r.name,
            distance: r.distance,
            ft: r.ft,
            profit: r.profit,
            rev: r.rev,
            dEco: r.dEco,
            rotations: 1,
          },
        ],
        routeIds: [r.id],
        totalTime: r.ft,
        totalProfit: r.profit,
        totalRev: r.rev,
        profitPerHour: r.ft > 0 ? r.profit / r.ft : 0,
        routeCount: 1,
        fillRate: ((r.ft / 168) * 100).toFixed(1),
      });
    });
  return circuits.sort((a, b) => b.profitPerHour - a.profitPerHour);
}

function buildCircuits24(aircraft, routes) {
  const eligible = enrichRoutes(aircraft, routes, 24);
  if (!eligible.length) return [];
  const circuits = [];
  const lu = new Set();
  const sk = new Set();
  const tryAdd = (c, pool) => {
    if (!c.length) return;
    const key = c
      .map((r) => `${r.id}x${r.rotations || 1}`)
      .sort()
      .join("|");
    if (sk.has(key)) return;
    sk.add(key);
    const tt = c.reduce((s, r) => s + r.ft * (r.rotations || 1), 0);
    // profit = (rev_pax - taxe×2) par rotation → × rotations = correct
    const tp = c.reduce((s, r) => s + r.profit * (r.rotations || 1), 0);
    if (tt <= 0 || tt > 24.01) return;
    const ids = [...new Set(c.map((r) => r.id))];
    // Config cabine : utiliser la demande de la meilleure route (1 seule route pour Pattern A)
    const primaryAc24 = {
      brand: aircraft.brand || "",
      model: aircraft.model || "",
      seats: aircraft.seats,
      range: aircraft.range || 99999,
      cat: aircraft.cat || 0,
    };
    const cabin =
      c.length === 1
        ? c[0].cabin
        : circuitCabinConfig(primaryAc24, AIRCRAFTS_RAW, c);
    circuits.push({
      windowH: 24,
      pool,
      type:
        c.length === 1
          ? `x${c[0].rotations} rotation(s)`
          : `${c.length} routes`,
      routes: c.map((r) => ({
        id: r.id,
        name: r.name,
        distance: r.distance,
        ft: r.ft,
        profit: r.profit,
        rev: r.rev,
        dEco: r.dEco,
        dBus: r.dBus,
        dFirst: r.dFirst,
        cabin: r.cabin,
        rotations: r.rotations || 1,
        tax: r.tax,
      })),
      routeIds: ids,
      totalTime: tt,
      totalProfit: tp,
      cabin,
      profitPerHour: tt > 0 ? tp / tt : 0,
      routeCount: c.reduce((s, r) => s + (r.rotations || 1), 0),
      fillRate: ((tt / 24) * 100).toFixed(1),
    });
    ids.forEach((id) => lu.add(id));
  };
  let pass = 0;
  while (pass++ < 2000) {
    const free = eligible.filter((r) => !lu.has(r.id));
    if (!free.length) break;
    const best = [...free].sort((a, b) => b.profit / b.ft - a.profit / a.ft)[0];
    const rot = Math.floor(24 / best.ft);
    if (rot >= 1) {
      tryAdd([{ ...best, rotations: rot }], "");
      if (lu.has(best.id)) continue;
    }
    const multi = ffd(free, 24);
    if (multi.length)
      tryAdd(
        multi.map((r) => ({ ...r, rotations: 1 })),
        ""
      );
    else break;
  }
  return circuits.sort((a, b) => b.profitPerHour - a.profitPerHour);
}


// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════
export {
  TURNAROUND, FUEL_FACTOR, ROUND_STEP, PRICE, SEAT_SPACE, MASS_UNIT,
  CURRENT_BONUS, TARGET_BONUS, DIST_SEG, BONUS_COEFS, CONFORT_FLAT,
  lerp, getBonusCoef, applyDemandBonus, projectRoutesForSimulation,
  makeDemandBands, flightTime, fuelCostOneWay, fuelCostRoundTrip, toNum,
  configCache, getSeatConfigs, generateSeatConfigs,
  cabinConfig, avgTaxForRoutes, singleCabinCfg,
  buildMultiFleetCascade, buildFleetCascade, circuitCabinConfig,
  routeRevenue, parseRoutes,
  enrichRoutesLight, enrichRoutesFull, enrichRoutes,
  fillExact, ffd, mkC168, buildCircuits168, buildCircuits24,
};
