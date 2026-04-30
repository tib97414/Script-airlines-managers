// Optimisation cargo (avions cargo dédiés).
// Logique extraite VERBATIM du script original.

import {
    PRICE, TURNAROUND,
    flightTime, fuelCostOneWay, avgTaxForRoutes, fillExact,
  } from "./core.js";
  import { CARGO_AIRCRAFTS_RAW } from "../data/aircrafts.js";
  
  function cargoGrossRev(route, payload) {
    // Revenu brut cargo (AVANT taxe) — aller-retour
    // Utilise le prix individuel de la route si disponible
    const cargoPrice = route.priceCargo || PRICE.CARGO;
    return Math.min(payload, route.dCargo || 0) * cargoPrice * 2;
  }
  function routeRevenueCargo(route, payload) {
    return cargoGrossRev(route, payload) - route.tax * 2;
  }
  function routeProfitCargo(route, payload) {
    return routeRevenueCargo(route, payload);
  } // peut être négatif
  
  function enrichRoutesCargo(aircraft, routes, maxH) {
    return routes
      .filter(
        (r) =>
          r.distance <= aircraft.range &&
          r.category >= aircraft.cat &&
          (r.dCargo || 0) > 0
      )
      .map((r) => {
        const grossRev = cargoGrossRev(r, aircraft.payload);
        // Pour cargo : MASS_UNIT = payload de l'avion cargo (tonnes chargées)
        const cargoMASS_UNIT = Math.min(
          aircraft.payload || 10,
          r.dCargo || aircraft.payload || 10
        );
        const fuelCostC = aircraft.conso
          ? fuelCostOneWay(r.distance, aircraft.conso, cargoMASS_UNIT)
          : 0;
        const rev = grossRev - r.tax * 2 - fuelCostC;
        return {
          ...r,
          ft: flightTime(r.distance, aircraft.speed),
          grossRev,
          fuelCost: fuelCostC,
          rev,
          profit: rev, // peut être négatif
          cargoFleet: buildCargoFleetCascade(
            {
              brand: aircraft.brand,
              model: aircraft.model,
              payload: aircraft.payload,
              range: aircraft.range,
              cat: aircraft.cat,
            },
            CARGO_AIRCRAFTS_RAW,
            [r]
          ),
        };
      })
      .filter((r) => r.ft > 0 && r.ft <= maxH);
  }
  
  // ── CASCADE CARGO MULTI-APPAREILS ─────────────────────────────────────────────
  // primaryAc = avion principal { brand, model, payload, range, cat }
  // allCargoAc = liste des avions cargo à tester pour les places restantes
  // circuitRoutes = routes du circuit (avec .dCargo, .tax)
  function buildCargoFleetCascade(primaryAc, allCargoAc, circuitRoutes) {
    // Demande cargo consolidée du circuit = min(dCargo) sur toutes les routes
    const demands = circuitRoutes.map((r) => r.dCargo || 0).filter((d) => d > 0);
    if (!demands.length) return { planes: [], unsatisfied: 0 };
    let remDemand = Math.min(...demands);
    const avgTax = avgTaxForRoutes(circuitRoutes);
    const planes = [];
  
    for (let i = 0; i < 30; i++) {
      if (remDemand <= 0) break;
      const candidates =
        i === 0 ? [primaryAc] : allCargoAc || CARGO_AIRCRAFTS_RAW;
      let bestEntry = null;
  
      for (const ac of candidates) {
        // Éligibilité : doit pouvoir desservir toutes les routes du circuit
        if (
          circuitRoutes.some((r) => r.distance > ac.range || r.category < ac.cat)
        )
          continue;
        // Vérification temps total circuit (comme pax)
        if (i > 0 && ac.speed) {
          const STEP = 0.25;
          const totalFtCandidate = circuitRoutes.reduce((s, r) => {
            return (
              s +
              Math.ceil(((2 * r.distance) / ac.speed + TURNAROUND) / STEP) * STEP
            );
          }, 0);
  
          if (totalFtCandidate > 168) continue; // avion trop lent
        }
        const loaded = Math.min(ac.payload, remDemand);
        const grossRev = loaded * PRICE.CARGO * 2;
        const tax = avgTax * 2;
        const fuelCost = ac.conso
          ? fuelCostOneWay(
              circuitRoutes[0].distance, // ou moyenne des routes
              ac.conso,
              loaded
            ) * 2
          : 0;
  
        const profit = grossRev - tax - fuelCost;
        // Avion 1 toujours inclus, suivants seulement si rentables
        if (i > 0 && profit <= 0) continue;
        if (!bestEntry || profit > bestEntry.profit)
          bestEntry = { ac, loaded, grossRev, tax, profit };
      }
  
      if (!bestEntry) break;
      const isSame =
        bestEntry.ac.brand === primaryAc.brand &&
        bestEntry.ac.model === primaryAc.model;
      planes.push({
        planeNum: i + 1,
        brand: bestEntry.ac.brand,
        model: bestEntry.ac.model,
        payload: bestEntry.ac.payload,
        isSameType: isSame,
        demandBefore: remDemand,
        loaded: bestEntry.loaded,
        remaining: (remDemand = Math.max(0, remDemand - bestEntry.loaded * 2)),
        grossRev: bestEntry.grossRev,
        tax: bestEntry.tax,
        profit: bestEntry.profit,
        isProfitable: bestEntry.profit > 0,
      });
    }
    return { planes, unsatisfied: remDemand };
  }
  
  
  function runGlobalOptCargo(cargoAircrafts, routes) {
    // ══════════════════════════════════════════════════════════════════════════
    // CARGO — Structure identique au Mode C pax : 168h → 84h×2 → 24h → rescue
    // Tri par profit DESC (revenu cargo - taxe), pas de cible de couverture.
    // ══════════════════════════════════════════════════════════════════════════
    const used = new Set();
  
    // Cache ft par avion cargo
    const ftCache = new Map();
    const getCargoRoutes = (ac, maxH) => {
      const key = `${ac.brand}|${ac.model}|${maxH}`;
      if (!ftCache.has(key))
        ftCache.set(key, enrichRoutesCargo(ac, routes, maxH));
      return ftCache.get(key);
    };
  
    const all168 = [],
      all84 = [],
      all24 = [];
    const sortedAc = [...cargoAircrafts].sort(
      (a, b) => (b.payload || 0) - (a.payload || 0)
    );
  
    const makeCircuit = (ac, chosen, windowH, rotations = 1) => {
      const ai = {
        brand: ac.brand,
        model: ac.model,
        payload: ac.payload,
        cat: ac.cat,
        isCargo: true,
      };
      const tt = chosen.reduce((s, r) => s + r.ft, 0) * rotations;
      const tp = chosen.reduce((s, r) => s + r.profit, 0) * rotations;
      const tr = chosen.reduce((s, r) => s + (r.grossRev || 0), 0) * rotations;
      const cf = buildCargoFleetCascade(
        {
          brand: ac.brand,
          model: ac.model,
          payload: ac.payload,
          range: ac.range,
          cat: ac.cat,
        },
        CARGO_AIRCRAFTS_RAW,
        chosen
      );
      return {
        aircraft: ai,
        windowH,
        isCargo: true,
        pool: "cargo",
        type: `${chosen.length} route(s)${
          rotations > 1 ? " ×" + rotations : ""
        } cargo`,
        routes: chosen.map((r) => ({
          id: r.id,
          name: r.name,
          distance: r.distance,
          ft: r.ft,
          profit: r.profit,
          rev: r.rev,
          grossRev: r.grossRev || 0,
          tax: r.tax || 0,
          dCargo: r.dCargo,
          payload: ac.payload,
          rotations,
        })),
        routeIds: chosen.map((r) => r.id),
        totalTime: tt,
        totalProfit: tp,
        totalRev: tr,
        cargoFleet: cf,
        profitPerHour: tt > 0 ? tp / tt : 0,
        routeCount: chosen.length,
        fillRate: ((tt / (windowH || 168)) * 100).toFixed(1),
      };
    };
  
    // ── PASSE 168h ────────────────────────────────────────────────────────────
    let prog168 = true,
      p168 = 0;
    while (prog168 && p168++ < 30) {
      prog168 = false;
      for (const ac of sortedAc) {
        const el = getCargoRoutes(ac, 168).filter((r) => !used.has(r.id));
        if (el.length < 2) continue;
        const sorted = [...el].sort(
          (a, b) => (b.profit / b.ft || 0) - (a.profit / a.ft || 0)
        );
        const lu = new Set();
        let p = 0;
        while (p++ < 200) {
          const free = sorted.filter((r) => !lu.has(r.id) && !used.has(r.id));
          if (free.length < 2) break;
          const longR = free.filter((r) => r.ft >= 30);
          const pool = longR.length
            ? [longR[0], ...free.filter((r) => r.id !== longR[0].id)]
            : free;
          const chosen = fillExact(pool, 168, 84);
          if (!chosen || chosen.length < 2) break;
          chosen.forEach((r) => lu.add(r.id));
          const c = makeCircuit(ac, chosen, 168);
          if (c.totalProfit <= 0) continue;
          all168.push(c);
          chosen.forEach((r) => used.add(r.id));
          prog168 = true;
        }
      }
    }
  
    // ── PASSE 84h×2 ──────────────────────────────────────────────────────────
    let prog84 = true,
      p84 = 0;
    while (prog84 && p84++ < 20) {
      prog84 = false;
      for (const ac of sortedAc) {
        const el = getCargoRoutes(ac, 168).filter((r) => !used.has(r.id));
        if (el.length < 2) continue;
        const sorted = [...el].sort(
          (a, b) => (b.profit / b.ft || 0) - (a.profit / a.ft || 0)
        );
        const lu = new Set();
        let p = 0;
        while (p++ < 100) {
          const free = sorted.filter((r) => !lu.has(r.id) && !used.has(r.id));
          if (free.length < 2) break;
          const chosen = fillExact(free, 84, 42);
          if (!chosen || chosen.length < 2) break;
          chosen.forEach((r) => lu.add(r.id));
          const c = makeCircuit(ac, chosen, 168, 2);
          if (c.totalProfit <= 0) continue;
          all84.push(c);
          chosen.forEach((r) => used.add(r.id));
          prog84 = true;
        }
      }
    }
  
    // ── PASSE 24h ─────────────────────────────────────────────────────────────
    for (const ac of sortedAc) {
      const el24 = getCargoRoutes(ac, 24).filter((r) => !used.has(r.id));
      if (!el24.length) continue;
      const sorted24 = [...el24].sort(
        (a, b) => (b.profit / b.ft || 0) - (a.profit / a.ft || 0)
      );
      const lu24 = new Set();
      let p24 = 0;
      while (p24++ < 300) {
        const free = sorted24.filter((r) => !lu24.has(r.id) && !used.has(r.id));
        if (!free.length) break;
        // Multi-route 24h
        if (free.length >= 2) {
          const ch24 = fillExact(free, 24, 12);
          if (ch24 && ch24.length >= 2) {
            const c = makeCircuit(ac, ch24, 24);
            if (c.totalProfit > 0) {
              all24.push(c);
              ch24.forEach((r) => {
                lu24.add(r.id);
                used.add(r.id);
              });
              continue;
            }
            ch24.forEach((r) => lu24.add(r.id));
            continue;
          }
        }
        // Rotation simple
        const best = free[0];
        lu24.add(best.id);
        const rot = Math.floor(24 / best.ft);
        if (rot < 1) continue;
        const c = makeCircuit(ac, [best], 24, rot);
        if (c.totalProfit <= 0) continue;
        all24.push(c);
        used.add(best.id);
      }
    }
  
    // ── RESCUE : routes restantes ─────────────────────────────────────────────
    for (const ac of sortedAc) {
      const remaining = getCargoRoutes(ac, 168).filter((r) => !used.has(r.id));
      if (!remaining.length) continue;
      const sorted = [...remaining].sort(
        (a, b) => (b.profit / b.ft || 0) - (a.profit / a.ft || 0)
      );
      const lu = new Set();
      let rp = 0;
      // Essayer 168h
      while (rp++ < 100) {
        const fr = sorted.filter((r) => !lu.has(r.id) && !used.has(r.id));
        if (fr.length < 2) break;
        const ch = fillExact(fr, 168, 84);
        if (!ch || ch.length < 2) break;
        ch.forEach((r) => lu.add(r.id));
        const c = makeCircuit(ac, ch, 168);
        all168.push(c);
        ch.forEach((r) => used.add(r.id));
      }
      // Vrais solos
      for (const r of sorted) {
        if (lu.has(r.id) || used.has(r.id)) continue;
        lu.add(r.id);
        const rot = r.ft <= 24 ? Math.floor(24 / r.ft) : 1;
        const wH = r.ft <= 24 ? 24 : 168;
        if (rot < 1) continue;
        const c = makeCircuit(ac, [r], wH, rot);
        (wH === 168 ? all168 : all24).push(c);
        used.add(r.id);
      }
    }
  
    // ── Regrouper par avion ───────────────────────────────────────────────────
    const allCircuits = [...all168, ...all84, ...all24];
    const byAcMap = new Map();
    for (const c of allCircuits) {
      const k = `${c.aircraft.brand}|${c.aircraft.model}`;
      if (!byAcMap.has(k))
        byAcMap.set(k, { aircraft: c.aircraft, circuits168: [], circuits24: [] });
      if (c.windowH === 168) byAcMap.get(k).circuits168.push(c);
      else byAcMap.get(k).circuits24.push(c);
    }
    const byAircraft = [...byAcMap.values()].map((item) => ({
      ...item,
      best168: item.circuits168[0] || null,
      best24: item.circuits24[0] || null,
      totalProfit168: item.circuits168.reduce((s, c) => s + c.totalProfit, 0),
      totalProfit24: item.circuits24.reduce((s, c) => s + c.totalProfit, 0),
    }));
  
    const c168 = allCircuits.filter((c) => c.windowH === 168);
    const c24 = allCircuits.filter((c) => c.windowH === 24);
    return {
      byAircraft,
      total168: c168.reduce((s, c) => s + c.totalProfit, 0),
      total24: c24.reduce((s, c) => s + c.totalProfit, 0),
      circuits168: c168.length,
      circuits24: c24.length,
      aircraftCount: byAircraft.length,
      routesUsed: used.size,
      routesTotal: routes.filter((r) => r.dCargo > 0).length,
      routesWithCargo: routes.filter((r) => r.dCargo > 0).length,
      all168: c168,
      all24: c24,
    };
  }
  
  export {
    cargoGrossRev, routeRevenueCargo, routeProfitCargo,
    enrichRoutesCargo, buildCargoFleetCascade, runGlobalOptCargo,
  };
  