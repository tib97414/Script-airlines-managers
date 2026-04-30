// Optimisation globale passagers : Mode A/B/C/P, exclusive-route prepass.
// Logique extraite VERBATIM du script original.

import {
    TURNAROUND, ROUND_STEP, PRICE, MASS_UNIT, SEAT_SPACE,
    flightTime, fuelCostOneWay, fuelCostRoundTrip,
    cabinConfig, avgTaxForRoutes, singleCabinCfg,
    buildMultiFleetCascade, circuitCabinConfig,
    enrichRoutesLight, enrichRoutesFull, enrichRoutes,
    fillExact, ffd, mkC168, makeDemandBands,
    applyDemandBonus, projectRoutesForSimulation,
  } from "./core.js";
  import { AIRCRAFTS_RAW, POOLS } from "../data/aircrafts.js";
  
  function computeExclusiveThreshold(aircraft, allAircrafts) {
    const catMax =
      aircraft.cat <= 3 ? 3 : aircraft.cat <= 4 ? 4 : aircraft.cat <= 6 ? 6 : 10;
    let secondMax = 0;
    for (const ac of allAircrafts) {
      if (ac === aircraft) continue;
      if (ac.cat > catMax) continue;
      if (ac.range > secondMax && ac.range < aircraft.range) secondMax = ac.range;
    }
    return secondMax;
  }
  
  function runExclusiveRoutePrepass(aircrafts, routes, used, all168, enrichFn) {
    const candidates = aircrafts
      .map((ac) => ({ ac, threshold: computeExclusiveThreshold(ac, aircrafts) }))
      .filter((x) => x.threshold > 0)
      .sort((a, b) => b.threshold - a.threshold);
    for (const { ac, threshold } of candidates) {
      const exclusiveRoutes = routes.filter(
        (r) =>
          r.distance > threshold &&
          r.category >= ac.cat &&
          r.distance <= ac.range &&
          !used.has(r.id)
      );
      if (exclusiveRoutes.length < 2) continue;
      const enriched = exclusiveRoutes
        .map((r) => enrichFn(r, ac, 168))
        .filter(Boolean)
        .sort((a, b) => {
          const ftA = Math.round(a.ft / 0.25) * 0.25,
            ftB = Math.round(b.ft / 0.25) * 0.25;
          if (ftA !== ftB) return ftB - ftA;
          return (b.dEco || b.demand || 0) - (a.dEco || a.demand || 0);
        });
      if (enriched.length < 2) continue;
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      const lu = new Set();
      let p = 0;
      while (p++ < 200) {
        const free = enriched.filter((r) => !lu.has(r.id) && !used.has(r.id));
        if (free.length < 2) break;
        const chosen = fillExact(free, 168, 84);
        if (!chosen || chosen.length < 2) break;
        const tt = chosen.reduce((s, r) => s + r.ft, 0);
        const tp = chosen.reduce((s, r) => s + r.profit, 0);
        chosen.forEach((r) => lu.add(r.id));
        if (tp <= 0) continue;
        const minEco = Math.min(
          ...chosen
            .map((r) => r.dEco || 0)
            .filter((d) => d > 0)
            .concat([0])
        );
        const minBus = Math.min(
          ...chosen
            .map((r) => r.dBus || 0)
            .filter((d) => d > 0)
            .concat([0])
        );
        const minFirst = Math.min(
          ...chosen
            .map((r) => r.dFirst || 0)
            .filter((d) => d > 0)
            .concat([0])
        );
        const fastCabin = cabinConfig(ac.seats, minEco, minBus, minFirst);
        all168.push({
          aircraft: ai,
          windowH: 168,
          pool: "exclusif",
          type: `${chosen.length} route(s) [exclusif]`,
          routes: chosen.map((r) => ({
            id: r.id,
            name: r.name,
            distance: r.distance,
            ft: r.ft,
            profit: r.profit,
            rev: r.rev,
            dEco: r.dEco || 0,
            dBus: r.dBus || 0,
            dFirst: r.dFirst || 0,
            cabin: r.cabin,
            rotations: 1,
            tax: r.tax || 0,
            fuelCost: r.fuelCost || 0,
          })),
          routeIds: chosen.map((r) => r.id),
          totalTime: tt,
          totalProfit: tp,
          cabin: { ...fastCabin, fleet: [], nbAvions: 1 },
          profitPerHour: tt > 0 ? tp / tt : 0,
          routeCount: chosen.length,
          fillRate: ((tt / 168) * 100).toFixed(1),
        });
        chosen.forEach((r) => used.add(r.id));
      }
    }
  }
  
  // Table pré-calculée optionnelle (désactivée — conservée pour usage futur)
  let GLOBAL_FT_TABLE = null;
  
  function runGlobalOpt(
    aircrafts,
    routes,
    modeB,
    bandSize,
    skipUltimate,
    skipFallback
  ) {
    const used = new Set();
    const bestAc = new Map();
  
    // ── CACHE D'ENRICHISSEMENT ──────────────────────────────────────────────────
    // Utilise la table globale si disponible, sinon calcule à la volée.
    const enrichCache = new Map();
    const getEnriched = (ac, windowH) => {
      const key = `${ac.brand}|${ac.model}|${windowH}`;
      if (!enrichCache.has(key)) {
        // Utiliser la table globale pré-calculée si dispo (ft déjà calculé)
        if (GLOBAL_FT_TABLE && windowH === 168) {
          const byRoute = GLOBAL_FT_TABLE.get(`${ac.brand}|${ac.model}`);
          if (byRoute) {
            enrichCache.set(
              key,
              [...byRoute.values()].filter((r) => !used.has(r.id))
            );
            return enrichCache.get(key);
          }
        }
        enrichCache.set(key, enrichRoutesLight(ac, routes, windowH));
      }
      return enrichCache.get(key);
    };
  
    for (const ac of aircrafts) {
      const info = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      for (const r of getEnriched(ac, 168)) {
        const ph = r.profit / r.ft,
          cur = bestAc.get(r.id);
        if (!cur || ph > (cur.ph168 || -Infinity))
          bestAc.set(r.id, {
            ...(cur || {}),
            aircraft: info,
            r168: r,
            ph168: ph,
          });
      }
      for (const r of getEnriched(ac, 24)) {
        const ph = r.profit / r.ft,
          cur = bestAc.get(r.id);
        if (!cur || ph > (cur.ph24 || -Infinity))
          bestAc.set(r.id, {
            ...(cur || {}),
            r24: r,
            ph24: ph,
            aircraft: bestAc.get(r.id)?.aircraft || info,
          });
      }
    }
    const c168 = [];
  
    // ── PASSE 1 : Routes longues (ft ≥ 30h) assemblées avec TOUTES les routes ─
    // Pour chaque avion, calcul ft avec SA vitesse. Routes longues = ancres.
    // Chaque ancre est combinée avec TOUTES les routes courtes/moyennes disponibles.
    for (const ac of aircrafts) {
      const allAc = getEnriched(ac, 168).filter((r) => !used.has(r.id));
      if (allAc.length < 2) continue;
      const longR = allAc.filter((r) => r.ft >= 30);
      if (!longR.length) continue;
      const shortR = allAc.filter((r) => r.ft < 30);
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      const lu = new Set();
      let p = 0;
      while (p++ < 300) {
        const freeAll = allAc.filter((r) => !lu.has(r.id) && !used.has(r.id));
        const freeLong = freeAll.filter((r) => r.ft >= 30);
        if (!freeLong.length) break;
        // Ancre = route la plus longue pour CET AVION
        // Partners = TOUTES les routes disponibles (courtes, moyennes, longues)
        // → une route de 35h peut se combiner avec 4×33h, ou 3×28h+1×12h, etc.
        const anchor = freeLong[0];
        const partners = freeAll.filter((r) => r.id !== anchor.id);
        const pool4c = [anchor, ...partners]; // ancre en tête, tous les partenaires possibles
        const chosen = fillExact(pool4c, 168, 84); // tolérance 84h large
        if (!chosen || chosen.length < 2) {
          lu.add(anchor.id);
          continue;
        }
        const tp = chosen.reduce((s, r) => s + r.profit, 0);
        chosen.forEach((r) => lu.add(r.id));
        if (tp <= 0) continue;
        c168.push({
          ...mkC168(chosen, { aircraft: ai, pool: "long+court" }, ac),
        });
        chosen.forEach((r) => used.add(r.id));
      }
    }
  
    // ── PASSE 2 : Exclusive prepass + pool normal ────────────────────────────
    runExclusiveRoutePrepass(
      aircrafts,
      routes,
      used,
      c168,
      (r, ac, maxH) => getEnriched(ac, maxH).find((e) => e.id === r.id) || null
    );
    for (const pool of POOLS) {
      const pr = routes.filter(
        (r) => r.category >= pool.min && r.category <= pool.max && !used.has(r.id)
      );
      const slices = modeB
        ? makeDemandBands(bandSize).map((b) =>
            pr.filter((r) => r.dEco >= b.min && r.dEco < b.max)
          )
        : [pr];
      for (const ac of aircrafts) {
        const ai = {
          brand: ac.brand,
          model: ac.model,
          seats: ac.seats,
          cat: ac.cat,
        };
        for (const slice of slices) {
          const sliceIds = new Set(slice.map((s) => s.id)); // O(1) lookup au lieu de some() O(n)
          const el = getEnriched(ac, 168).filter(
            (r) => sliceIds.has(r.id) && !used.has(r.id)
          );
          if (el.length < 2) continue;
          const lu = new Set();
          let p = 0;
          while (p++ < 1000) {
            const free = el.filter((r) => !lu.has(r.id));
            if (free.length < 2) break;
            const chosen = fillExact(free, 168, 24);
            if (!chosen.length) break;
            c168.push({
              ...mkC168(chosen, { aircraft: ai, pool: pool.label }, ac),
            });
            chosen.forEach((r) => lu.add(r.id));
          }
        }
      }
    }
    c168.sort(
      (a, b) =>
        parseFloat(b.fillRate) - parseFloat(a.fillRate) ||
        b.profitPerHour - a.profitPerHour
    );
    const all168 = [];
    for (const c of c168)
      if (c.routeIds.every((id) => !used.has(id))) {
        all168.push(c);
        c.routeIds.forEach((id) => used.add(id));
      }
  
    const rp168 = [];
    for (const ac of aircrafts) {
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      const fn = routes.filter((r) => !used.has(r.id));
      const el = getEnriched(ac, 168).filter((r) => !used.has(r.id));
      if (el.length < 2) continue;
      const lu = new Set();
      let prev = -1,
        p = 0;
      while (p++ < 500) {
        const free = el.filter((r) => !lu.has(r.id));
        if (free.length < 2 || free.length === prev) break;
        prev = free.length;
        const chosen = fillExact(free, 168, 84);
        if (chosen.length < 2) break;
        rp168.push({
          ...mkC168(
            chosen,
            {
              aircraft: ai,
              pool: "repack",
              type: `${chosen.length} route(s) [repack]`,
            },
            ac
          ),
        });
        chosen.forEach((r) => lu.add(r.id));
      }
    }
    rp168.sort(
      (a, b) =>
        parseFloat(b.fillRate) - parseFloat(a.fillRate) ||
        b.profitPerHour - a.profitPerHour
    );
    for (const c of rp168)
      if (c.routeIds.every((id) => !used.has(id))) {
        all168.push(c);
        c.routeIds.forEach((id) => used.add(id));
      }
  
    const c24 = [];
    for (const pool of POOLS) {
      const pr = routes.filter(
        (r) => r.category >= pool.min && r.category <= pool.max && !used.has(r.id)
      );
      const slices = modeB
        ? makeDemandBands(bandSize).map((b) =>
            pr.filter((r) => r.dEco >= b.min && r.dEco < b.max)
          )
        : [pr];
      for (const ac of aircrafts) {
        const ai = {
          brand: ac.brand,
          model: ac.model,
          seats: ac.seats,
          cat: ac.cat,
        };
        const sk = new Set();
        for (const slice of slices) {
          const el = getEnriched(ac, 24).filter(
            (r) => slice.some((s) => s.id === r.id) && !used.has(r.id)
          );
          if (!el.length) continue;
          const lu = new Set();
          const tryAdd = (c, pl) => {
            if (!c.length) return;
            const key = c
              .map((r) => `${r.id}x${r.rotations || 1}`)
              .sort()
              .join("|");
            if (sk.has(key)) return;
            sk.add(key);
            const tt = c.reduce((s, r) => s + r.ft * (r.rotations || 1), 0);
            const tp = c.reduce((s, r) => s + r.profit * (r.rotations || 1), 0);
            if (tt <= 0 || tt > 24.01) return;
            const ids = [...new Set(c.map((r) => r.id))];
            const pAc = {
              brand: ac.brand || "",
              model: ac.model || "",
              seats: ac.seats,
              range: ac.range || 99999,
              cat: ac.cat || 0,
            };
            const cabin24 =
              c.length === 1
                ? c[0].cabin
                : circuitCabinConfig(pAc, AIRCRAFTS_RAW, c);
            c24.push({
              aircraft: ai,
              windowH: 24,
              pool: pl,
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
              cabin: cabin24,
              profitPerHour: tt > 0 ? tp / tt : 0,
              routeCount: c.reduce((s, r) => s + (r.rotations || 1), 0),
              fillRate: ((tt / 24) * 100).toFixed(1),
            });
            ids.forEach((id) => lu.add(id));
          };
          let p = 0;
          while (p++ < 1000) {
            const free = el.filter((r) => !lu.has(r.id));
            if (!free.length) break;
            let b = free[0];
            for (const x of free) {
              if ((x.profit / x.ft || 0) > (b.profit / b.ft || 0)) b = x;
            }
            const rot = Math.floor(24 / b.ft);
            if (rot >= 1) {
              tryAdd([{ ...b, rotations: rot }], pool.label);
              if (lu.has(b.id)) continue;
            }
            const multi = ffd(free, 24);
            if (multi.length)
              tryAdd(
                multi.map((r) => ({ ...r, rotations: 1 })),
                pool.label
              );
            else break;
          }
        }
      }
    }
    c24.sort(
      (a, b) =>
        parseFloat(b.fillRate) - parseFloat(a.fillRate) ||
        b.profitPerHour - a.profitPerHour
    );
    const all24 = [];
    for (const c of c24)
      if (c.routeIds.every((id) => !used.has(id))) {
        all24.push(c);
        c.routeIds.forEach((id) => used.add(id));
      }
  
    const rp24 = [];
    for (const ac of aircrafts) {
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      const fn = routes.filter((r) => !used.has(r.id));
      const el = getEnriched(ac, 24).filter((r) => !used.has(r.id));
      if (el.length < 2) continue;
      const lu = new Set(),
        sk = new Set();
      let p = 0;
      while (p++ < 500) {
        const free = el.filter((r) => !lu.has(r.id));
        if (free.length < 2) break;
        const chosen = ffd(free, 24);
        if (chosen.length < 2) break;
        const key = chosen
          .map((r) => `${r.id}x1`)
          .sort()
          .join("|");
        if (sk.has(key)) break;
        sk.add(key);
        const tt = chosen.reduce((s, r) => s + r.ft, 0),
          tp = chosen.reduce((s, r) => s + r.profit, 0),
          tr = chosen.reduce((s, r) => s + r.rev, 0);
        if (tt > 24.01) break;
        const ids = [...new Set(chosen.map((r) => r.id))];
        rp24.push({
          aircraft: ai,
          windowH: 24,
          pool: "repack",
          type: `${chosen.length} routes [repack]`,
          routes: chosen.map((r) => ({
            id: r.id,
            name: r.name,
            distance: r.distance,
            ft: r.ft,
            profit: r.profit,
            rev: r.rev,
            dEco: r.dEco,
            dBus: r.dBus || 0,
            dFirst: r.dFirst || 0,
            cabin: r.cabin,
            rotations: 1,
            tax: r.tax,
          })),
          routeIds: ids,
          totalTime: tt,
          totalProfit: tp,
          cabin: (() => {
            const dE = chosen.map((r) => r.dEco || 0).filter((d) => d > 0);
            const dB = chosen.map((r) => r.dBus || 0).filter((d) => d > 0);
            const dF = chosen.map((r) => r.dFirst || 0).filter((d) => d > 0);
            const cfg = cabinConfig(
              ai.seats,
              dE.length ? Math.min(...dE) : 0,
              dB.length ? Math.min(...dB) : 0,
              dF.length ? Math.min(...dF) : 0
            );
            return {
              sE: cfg.sE,
              sB: cfg.sB,
              sF: cfg.sF,
              rev: cfg.rev,
              label: cfg.label,
              demandEco: dE[0] || 0,
              demandBus: dB[0] || 0,
              demandFirst: dF[0] || 0,
              capPerAc: { eco: cfg.sE * 2, bus: cfg.sB * 2, first: cfg.sF * 2 },
              nbAvions: 1,
              fleet: [],
              unsatisfied: { eco: 0, bus: 0, first: 0 },
            };
          })(),
          profitPerHour: tt > 0 ? tp / tt : 0,
          routeCount: chosen.length,
          fillRate: ((tt / 24) * 100).toFixed(1),
        });
        chosen.forEach((r) => lu.add(r.id));
      }
    }
    rp24.sort(
      (a, b) =>
        parseFloat(b.fillRate) - parseFloat(a.fillRate) ||
        b.profitPerHour - a.profitPerHour
    );
    for (const c of rp24)
      if (c.routeIds.every((id) => !used.has(id))) {
        all24.push(c);
        c.routeIds.forEach((id) => used.add(id));
      }
  
    // Repack ultime désactivé en Mode C (les passes résiduelles le remplacent)
    if (!skipUltimate) {
      let progress = true,
        pass = 0;
      while (progress && pass++ < 20) {
        progress = false;
        const fc = [];
        const fn = routes.filter((r) => !used.has(r.id));
        if (fn.length < 2) break;
        for (const ac of aircrafts) {
          const ai = {
            brand: ac.brand,
            model: ac.model,
            seats: ac.seats,
            cat: ac.cat,
          };
          const el = getEnriched(ac, 168).filter((r) => !used.has(r.id));
          if (el.length < 2) continue;
          const lu = new Set();
          let ip = 0;
          while (ip++ < 500) {
            const free = el.filter((r) => !lu.has(r.id));
            if (free.length < 2) break;
            const chosen = ffd(free, 168);
            if (chosen.length < 2) break;
            const tt = chosen.reduce((s, r) => s + r.ft, 0),
              tp = chosen.reduce((s, r) => s + r.profit, 0),
              tr = chosen.reduce((s, r) => s + r.rev, 0);
            const _dEU = chosen.map((r) => r.dEco || 0).filter((d) => d > 0),
              _dBU = chosen.map((r) => r.dBus || 0).filter((d) => d > 0),
              _dFU = chosen.map((r) => r.dFirst || 0).filter((d) => d > 0);
            const _cfgU = cabinConfig(
              ac.seats,
              _dEU.length ? Math.min(..._dEU) : 0,
              _dBU.length ? Math.min(..._dBU) : 0,
              _dFU.length ? Math.min(..._dFU) : 0
            );
            const cabinUlt = {
              sE: _cfgU.sE,
              sB: _cfgU.sB,
              sF: _cfgU.sF,
              rev: _cfgU.rev,
              label: _cfgU.label,
              demandEco: _dEU[0] || 0,
              demandBus: _dBU[0] || 0,
              demandFirst: _dFU[0] || 0,
              capPerAc: {
                eco: _cfgU.sE * 2,
                bus: _cfgU.sB * 2,
                first: _cfgU.sF * 2,
              },
              nbAvions: 1,
              fleet: [],
              unsatisfied: { eco: 0, bus: 0, first: 0 },
            };
            fc.push({
              aircraft: ai,
              windowH: 168,
              pool: "ultime",
              type: `${chosen.length} route(s) [ultime]`,
              routes: chosen.map((r) => ({
                id: r.id,
                name: r.name,
                distance: r.distance,
                ft: r.ft,
                profit: r.profit,
                rev: r.rev,
                dEco: r.dEco,
                dBus: r.dBus || 0,
                dFirst: r.dFirst || 0,
                cabin: r.cabin,
                rotations: 1,
                tax: r.tax,
              })),
              routeIds: chosen.map((r) => r.id),
              totalTime: tt,
              totalProfit: tp,
              cabin: cabinUlt,
              profitPerHour: tt > 0 ? tp / tt : 0,
              routeCount: chosen.length,
              fillRate: ((tt / 168) * 100).toFixed(1),
            });
            chosen.forEach((r) => lu.add(r.id));
          }
        }
        fc.sort((a, b) => b.profitPerHour - a.profitPerHour);
        for (const c of fc)
          if (c.routeIds.every((id) => !used.has(id))) {
            all168.push(c);
            c.routeIds.forEach((id) => used.add(id));
            progress = true;
          }
      }
    }
  
    // Fallback solo désactivé en Mode C
    if (!skipFallback) {
      for (const [rid, info] of bestAc) {
        if (used.has(rid)) continue;
        if (info.r168) {
          const r = info.r168;
          all168.push({
            aircraft: info.aircraft,
            windowH: 168,
            pool: "—",
            type: "1 route (isolee)",
            routes: [
              {
                id: r.id,
                name: r.name,
                distance: r.distance,
                ft: r.ft,
                profit: r.profit,
                rev: r.rev,
                dEco: r.dEco,
                dBus: r.dBus || 0,
                dFirst: r.dFirst || 0,
                cabin: r.cabin,
                rotations: 1,
                tax: r.tax,
              },
            ],
            routeIds: [r.id],
            totalTime: r.ft,
            totalProfit: r.profit,
            cabin: r.cabin,
            profitPerHour: r.ft > 0 ? r.profit / r.ft : 0,
            routeCount: 1,
            fillRate: ((r.ft / 168) * 100).toFixed(1),
          });
          used.add(rid);
        } else if (info.r24) {
          const r = info.r24;
          const rot = Math.floor(24 / r.ft);
          if (rot >= 1) {
            all24.push({
              aircraft: info.aircraft,
              windowH: 24,
              pool: "—",
              type: `x${rot} (isolee)`,
              routes: [
                {
                  id: r.id,
                  name: r.name,
                  distance: r.distance,
                  ft: r.ft,
                  profit: r.profit,
                  rev: r.rev,
                  dEco: r.dEco,
                  dBus: r.dBus || 0,
                  dFirst: r.dFirst || 0,
                  cabin: r.cabin,
                  rotations: rot,
                  tax: r.tax,
                },
              ],
              routeIds: [r.id],
              totalTime: r.ft * rot,
              totalProfit: r.profit * rot,
              cabin: r.cabin,
              profitPerHour: r.profit,
              routeCount: rot,
              fillRate: (((r.ft * rot) / 24) * 100).toFixed(1),
            });
            used.add(rid);
          }
        }
      }
    }
    // Routes non assignées pour les passes résiduelles
    const unassignedRoutes = skipFallback
      ? [...bestAc.keys()].filter((id) => !used.has(id))
      : [];
    const bestAcMap = skipFallback ? bestAc : new Map(); // exposé pour Mode C safety net
    const m = new Map();
    const reg = (c) => {
      const k = `${c.aircraft.brand}|${c.aircraft.model}`;
      if (!m.has(k))
        m.set(k, { aircraft: c.aircraft, circuits168: [], circuits24: [] });
      if (c.windowH === 168) m.get(k).circuits168.push(c);
      else m.get(k).circuits24.push(c);
    };
    all168.forEach(reg);
    all24.forEach(reg);
    const byAircraft = [...m.values()]
      .map((item) => ({
        ...item,
        best168: item.circuits168[0] || null,
        best24: item.circuits24[0] || null,
        totalProfit168: item.circuits168.reduce((s, c) => s + c.totalProfit, 0),
        totalProfit24: item.circuits24.reduce((s, c) => s + c.totalProfit, 0),
      }))
      .sort(
        (a, b) =>
          Math.max(b.best168?.profitPerHour || 0, b.best24?.profitPerHour || 0) -
          Math.max(a.best168?.profitPerHour || 0, a.best24?.profitPerHour || 0)
      );
    return {
      byAircraft,
      modeB: !!modeB,
      total168: all168.reduce((s, c) => s + c.totalProfit, 0),
      total24: all24.reduce((s, c) => s + c.totalProfit, 0),
      circuits168: all168.length,
      circuits24: all24.length,
      aircraftCount: byAircraft.length,
      unassignedRoutes:
        typeof unassignedRoutes !== "undefined" ? unassignedRoutes : [],
      bestAcMap: typeof bestAcMap !== "undefined" ? bestAcMap : new Map(),
      routesUsed: used.size,
      routesTotal: routes.length,
      routesImpossible: routes.filter((r) => !bestAc.has(r.id)).length,
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // MODE C — DEMANDE RÉSIDUELLE
  // Identique au Mode B (tranches de demande) MAIS les routes ne sont plus
  // fermées définitivement après un circuit. On garde une Map de demande résiduelle
  // et une route reste disponible tant que son résidu > seuil (= 1 siège minimum).
  // Chaque circuit est construit sur la demande RÉSIDUELLE, pas la demande totale.
  // ══════════════════════════════════════════════════════════════════════════════
  function runGlobalOptModeP(aircrafts, routes, coverageTarget = 0.92) {
    const used = new Set();
    const totalDemand = {
      eco: routes.reduce((s, r) => s + (r.dEco || 0), 0),
      bus: routes.reduce((s, r) => s + (r.dBus || 0), 0),
      first: routes.reduce((s, r) => s + (r.dFirst || 0), 0),
    };
    const targets = {
      eco: totalDemand.eco * coverageTarget,
      bus: totalDemand.bus * coverageTarget,
      first: totalDemand.first * coverageTarget,
    };
    let coveredEco = 0,
      coveredBus = 0,
      coveredFirst = 0;
    const ftCache = new Map();
    const getRoutes = (ac) => {
      const k = `${ac.brand}|${ac.model}`;
      if (!ftCache.has(k)) ftCache.set(k, enrichRoutesLight(ac, routes, 168));
      return ftCache.get(k);
    };
    const all168 = [],
      all84 = [],
      all24 = [];
    const sortedAc = [...aircrafts].sort((a, b) => b.seats - a.seats);
    const mkC = (ai, ac, chosen, windowH, rotations = 1) => {
      const tt = chosen.reduce((s, r) => s + r.ft, 0) * rotations;
      const tp = chosen.reduce((s, r) => s + r.profit, 0) * rotations;
      let minEco = 0,
        minBus = 0,
        minFirst = 0;
      for (const r of chosen) {
        const e = r.dEco || 0,
          b = r.dBus || 0,
          f = r.dFirst || 0;
        if (e > 0) minEco = minEco === 0 ? e : Math.min(minEco, e);
        if (b > 0) minBus = minBus === 0 ? b : Math.min(minBus, b);
        if (f > 0) minFirst = minFirst === 0 ? f : Math.min(minFirst, f);
      }
      const pAc = {
        brand: ac.brand || "",
        model: ac.model || "",
        seats: ac.seats,
        range: ac.range || 99999,
        cat: ac.cat || 0,
      };
      const cabin = circuitCabinConfig(pAc, AIRCRAFTS_RAW, chosen);
      return {
        aircraft: ai,
        windowH,
        pool: "passagers",
        type: `${chosen.length} route(s)${
          rotations > 1 ? " ×" + rotations : ""
        } [pax]`,
        routes: chosen.map((r) => ({ ...r, rotations })),
        routeIds: chosen.map((r) => r.id),
        totalTime: tt,
        totalProfit: tp,
        totalRev:
          chosen.reduce((s, r) => s + Math.max(0, r.grossPaxRev || 0), 0) *
          rotations,
        cabin,
        profitPerHour: tt > 0 ? tp / tt : 0,
        routeCount: chosen.length,
        fillRate: ((tt / (windowH || 168)) * 100).toFixed(1),
        pax: {
          eco: Math.min(cabin.sE * 2, minEco) * rotations,
          bus: Math.min(cabin.sB * 2, minBus) * rotations,
          first: Math.min(cabin.sF * 2, minFirst) * rotations,
        },
      };
    };
  
    // 168h
    let gp = 0,
      pass = 0;
    while (pass++ < 50) {
      if (
        coveredEco >= targets.eco &&
        coveredBus >= targets.bus &&
        coveredFirst >= targets.first
      )
        break;
      gp = 0;
      for (const ac of sortedAc) {
        const el = getRoutes(ac).filter((r) => !used.has(r.id));
        if (el.length < 2) continue;
        const sorted = [...el].sort((a, b) => {
          const wA = (a.dEco || 0) + (a.dBus || 0) * 1.5 + (a.dFirst || 0) * 3,
            wB = (b.dEco || 0) + (b.dBus || 0) * 1.5 + (b.dFirst || 0) * 3;
          return wB - wA;
        });
        const ai = {
          brand: ac.brand,
          model: ac.model,
          seats: ac.seats,
          cat: ac.cat,
        };
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
          const c = mkC(ai, ac, chosen, 168);
          all168.push(c);
          chosen.forEach((r) => used.add(r.id));
          coveredEco += c.pax.eco;
          coveredBus += c.pax.bus;
          coveredFirst += c.pax.first;
          gp++;
        }
      }
      if (!gp) break;
    }
    // 84h×2
    let gp84 = 0,
      p84 = 0;
    while (p84++ < 20) {
      gp84 = 0;
      for (const ac of sortedAc) {
        const el = getRoutes(ac).filter((r) => !used.has(r.id));
        if (el.length < 2) continue;
        const sorted = [...el].sort((a, b) => {
          const wA = (a.dEco || 0) + (a.dBus || 0) * 1.5 + (a.dFirst || 0) * 3,
            wB = (b.dEco || 0) + (b.dBus || 0) * 1.5 + (b.dFirst || 0) * 3;
          return wB - wA;
        });
        const ai = {
          brand: ac.brand,
          model: ac.model,
          seats: ac.seats,
          cat: ac.cat,
        };
        const lu = new Set();
        let p = 0;
        while (p++ < 100) {
          const free = sorted.filter((r) => !lu.has(r.id) && !used.has(r.id));
          if (free.length < 2) break;
          const chosen = fillExact(free, 84, 42);
          if (!chosen || chosen.length < 2) break;
          chosen.forEach((r) => lu.add(r.id));
          const c = mkC(ai, ac, chosen, 168, 2);
          all84.push(c);
          chosen.forEach((r) => used.add(r.id));
          coveredEco += c.pax.eco;
          coveredBus += c.pax.bus;
          coveredFirst += c.pax.first;
          gp84++;
        }
      }
      if (!gp84) break;
    }
    // 24h
    for (const ac of sortedAc) {
      const el24 = enrichRoutesLight(ac, routes, 24).filter(
        (r) => !used.has(r.id)
      );
      if (!el24.length) continue;
      const sorted24 = [...el24].sort((a, b) => {
        const wA = (a.dEco || 0) + (a.dBus || 0) * 1.5 + (a.dFirst || 0) * 3,
          wB = (b.dEco || 0) + (b.dBus || 0) * 1.5 + (b.dFirst || 0) * 3;
        return wB - wA;
      });
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      const lu24 = new Set();
      let p24 = 0;
      while (p24++ < 300) {
        const free = sorted24.filter((r) => !lu24.has(r.id) && !used.has(r.id));
        if (!free.length) break;
        if (free.length >= 2) {
          const ch = fillExact(free, 24, 12);
          if (ch && ch.length >= 2) {
            const c = mkC(ai, ac, ch, 24);
            if (c.totalProfit > 0) {
              all24.push(c);
              ch.forEach((r) => {
                lu24.add(r.id);
                used.add(r.id);
              });
              continue;
            }
            ch.forEach((r) => lu24.add(r.id));
            continue;
          }
        }
        const best = free[0];
        const rot = Math.floor(24 / best.ft);
        if (rot < 1) {
          lu24.add(best.id);
          continue;
        }
        const c = mkC(ai, ac, [best], 24, rot);
        if (c.totalProfit > 0) {
          all24.push(c);
          lu24.add(best.id);
          used.add(best.id);
        } else lu24.add(best.id);
      }
    }
  
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
    const coveragePct = {
      eco:
        totalDemand.eco > 0
          ? ((coveredEco / totalDemand.eco) * 100).toFixed(1)
          : "0",
      bus:
        totalDemand.bus > 0
          ? ((coveredBus / totalDemand.bus) * 100).toFixed(1)
          : "0",
      first:
        totalDemand.first > 0
          ? ((coveredFirst / totalDemand.first) * 100).toFixed(1)
          : "0",
    };
    return {
      byAircraft,
      modeP: true,
      modeB: false,
      modeC: false,
      aircraftCount: byAircraft.length,
      circuits168: c168.length,
      circuits24: c24.length,
      total168: c168.reduce((s, c) => s + c.totalProfit, 0),
      total24: c24.reduce((s, c) => s + c.totalProfit, 0),
      routesUsed: used.size,
      routesTotal: routes.length,
      routesImpossible: 0,
      totalDemand,
      targets,
      coverageTarget,
      covered: { eco: coveredEco, bus: coveredBus, first: coveredFirst },
      coveragePct,
      all168: c168,
      all24: c24,
    };
  }
  
  function runGlobalOptModeC(aircrafts, routes, bandSize) {
    // ══════════════════════════════════════════════════════════════════════════
    // MODE C REFONDU — Passagers + Profit équilibrés
    // Basé sur la structure du Mode P (simple, robuste, 168h en premier)
    // Score de tri : 50% profit/h + 50% demande pondérée
    // Pas de cible de couverture — tourne jusqu'à épuisement des routes.
    // ══════════════════════════════════════════════════════════════════════════
    const used = new Set();
  
    // Cache ft par avion
    const ftCache = new Map();
    const getRoutesForAc = (ac, maxH = 168) => {
      const key = `${ac.brand}|${ac.model}|${maxH}`;
      if (!ftCache.has(key))
        ftCache.set(key, enrichRoutesLight(ac, routes, maxH));
      return ftCache.get(key);
    };
  
    // Score équilibré : profit/h normalisé + demande normalisée (50/50)
    // On calcule les max globaux une seule fois pour normaliser
    const allEnriched168 = aircrafts.flatMap((ac) => getRoutesForAc(ac, 168));
    const maxPH = Math.max(
      ...allEnriched168.map((r) => r.profit / r.ft || 0).filter((v) => v > 0),
      1
    );
    const maxDem = Math.max(
      ...allEnriched168.map(
        (r) => (r.dEco || 0) + (r.dBus || 0) * 1.5 + (r.dFirst || 0) * 3
      ),
      1
    );
  
    const score = (r) => {
      const ph = Math.max(0, r.profit / r.ft || 0) / maxPH;
      const dem =
        ((r.dEco || 0) + (r.dBus || 0) * 1.5 + (r.dFirst || 0) * 3) / maxDem;
      return 0.5 * ph + 0.5 * dem;
    };
  
    const all168 = [],
      all84 = [],
      all24 = [];
  
    // Avions par capacité DESC
    const sortedAc = [...aircrafts].sort((a, b) => b.seats - a.seats);
  
    // ── PASSE 168h ────────────────────────────────────────────────────────────
    let progress168 = true,
      pass168 = 0;
    while (progress168 && pass168++ < 30) {
      progress168 = false;
      for (const ac of sortedAc) {
        const acRoutesAll = getRoutesForAc(ac, 168).filter(
          (r) => !used.has(r.id)
        );
        if (acRoutesAll.length < 2) continue;
        const ai = {
          brand: ac.brand,
          model: ac.model,
          seats: ac.seats,
          cat: ac.cat,
        };
  
        // Tranches de demande : si bandSize actif, on itère par bande de dEco
        // Sinon une seule "tranche" = toutes les routes
        const bands168 = bandSize
          ? makeDemandBands(bandSize).filter((b) =>
              acRoutesAll.some(
                (r) => (r.dEco || 0) >= b.min && (r.dEco || 0) < b.max
              )
            )
          : [null];
  
        for (const band of bands168) {
          const acRoutes = band
            ? acRoutesAll.filter(
                (r) =>
                  (r.dEco || 0) >= band.min &&
                  (r.dEco || 0) < band.max &&
                  !used.has(r.id)
              )
            : acRoutesAll.filter((r) => !used.has(r.id));
          if (acRoutes.length < 2) continue;
  
          acRoutes.sort((a, b) => score(b) - score(a));
          const sorted = acRoutes;
          const lu = new Set();
          let p = 0;
  
          while (p++ < 200) {
            const free = sorted.filter((r) => !lu.has(r.id) && !used.has(r.id));
            if (free.length < 2) break;
            // Route longue ≥30h comme ancre si disponible
            const longR = free.filter((r) => r.ft >= 30);
            const pool = longR.length
              ? [longR[0], ...free.filter((r) => r.id !== longR[0].id)]
              : free;
            const chosen = fillExact(pool, 168, 84);
            if (!chosen || chosen.length < 2) break;
            chosen.forEach((r) => lu.add(r.id));
            const tt = chosen.reduce((s, r) => s + r.ft, 0);
            const tp = chosen.reduce((s, r) => s + r.profit, 0);
            // Ne pas filtrer les circuits négatifs : mieux d'avoir 6 routes groupées
            // qu'une seule en solo (même logique que Mode B)
            const minEco = Math.min(
              ...chosen
                .map((r) => r.dEco || 0)
                .filter((d) => d > 0)
                .concat([0])
            );
            const minBus = Math.min(
              ...chosen
                .map((r) => r.dBus || 0)
                .filter((d) => d > 0)
                .concat([0])
            );
            const minFirst = Math.min(
              ...chosen
                .map((r) => r.dFirst || 0)
                .filter((d) => d > 0)
                .concat([0])
            );
            const cabin = cabinConfig(ac.seats, minEco, minBus, minFirst);
            const pAc168 = {
              brand: ac.brand || "",
              model: ac.model || "",
              seats: ac.seats,
              range: ac.range || 99999,
              cat: ac.cat || 0,
            };
            const fullCabin168 = circuitCabinConfig(
              pAc168,
              AIRCRAFTS_RAW,
              chosen
            );
            const baseCircuit168 = {
              aircraft: ai,
              windowH: 168,
              pool: "mixte",
              type: `${chosen.length} route(s) [C]`,
              routes: chosen.map((r) => ({ ...r, rotations: 1 })),
              routeIds: chosen.map((r) => r.id),
              totalTime: tt,
              totalProfit: tp,
              totalRev: chosen.reduce(
                (s, r) => s + Math.max(0, r.grossPaxRev || 0),
                0
              ),
              cabin: fullCabin168,
              profitPerHour: tt > 0 ? tp / tt : 0,
              routeCount: chosen.length,
              fillRate: ((tt / 168) * 100).toFixed(1),
              pax: {
                eco: Math.min(cabin.sE * 2, minEco),
                bus: Math.min(cabin.sB * 2, minBus),
                first: Math.min(cabin.sF * 2, minFirst),
              },
            };
            all168.push(baseCircuit168);
            chosen.forEach((r) => used.add(r.id));
            progress168 = true;
          }
        } // end band loop 168h
      }
    }
  
    // ── PASSE 84h×2 : routes qui ne forment pas un 168h complet ──────────────
    let progress84 = true,
      pass84 = 0;
    while (progress84 && pass84++ < 20) {
      progress84 = false;
      for (const ac of sortedAc) {
        const acRoutesAll84 = getRoutesForAc(ac, 168).filter(
          (r) => !used.has(r.id)
        );
        if (acRoutesAll84.length < 2) continue;
        const ai = {
          brand: ac.brand,
          model: ac.model,
          seats: ac.seats,
          cat: ac.cat,
        };
  
        const bands84 = bandSize
          ? makeDemandBands(bandSize).filter((b) =>
              acRoutesAll84.some(
                (r) => (r.dEco || 0) >= b.min && (r.dEco || 0) < b.max
              )
            )
          : [null];
  
        for (const band of bands84) {
          const acRoutes84 = band
            ? acRoutesAll84.filter(
                (r) =>
                  (r.dEco || 0) >= band.min &&
                  (r.dEco || 0) < band.max &&
                  !used.has(r.id)
              )
            : acRoutesAll84.filter((r) => !used.has(r.id));
          if (acRoutes84.length < 2) continue;
          const sorted84 = [...acRoutes84].sort((a, b) => score(b) - score(a));
          const lu = new Set();
          let p = 0;
          while (p++ < 100) {
            const free = sorted84.filter((r) => !lu.has(r.id) && !used.has(r.id));
            if (free.length < 2) break;
            const chosen = fillExact(free, 84, 42);
            if (!chosen || chosen.length < 2) break;
            chosen.forEach((r) => lu.add(r.id));
            const tt = chosen.reduce((s, r) => s + r.ft, 0);
            const tp = chosen.reduce((s, r) => s + r.profit, 0) * 2;
            const minEco = Math.min(
              ...chosen
                .map((r) => r.dEco || 0)
                .filter((d) => d > 0)
                .concat([0])
            );
            const minBus = Math.min(
              ...chosen
                .map((r) => r.dBus || 0)
                .filter((d) => d > 0)
                .concat([0])
            );
            const minFirst = Math.min(
              ...chosen
                .map((r) => r.dFirst || 0)
                .filter((d) => d > 0)
                .concat([0])
            );
            const cabin = cabinConfig(ac.seats, minEco, minBus, minFirst);
            const pAc84 = {
              brand: ac.brand || "",
              model: ac.model || "",
              seats: ac.seats,
              range: ac.range || 99999,
              cat: ac.cat || 0,
            };
            const fullCabin84 = circuitCabinConfig(pAc84, AIRCRAFTS_RAW, chosen);
            const baseCircuit84 = {
              aircraft: ai,
              windowH: 168,
              pool: "mixte",
              type: `${chosen.length} route(s) ×2 [84h×2]`,
              routes: chosen.map((r) => ({ ...r, rotations: 2 })),
              routeIds: chosen.map((r) => r.id),
              totalTime: tt * 2,
              totalProfit: tp,
              totalRev:
                chosen.reduce((s, r) => s + Math.max(0, r.grossPaxRev || 0), 0) *
                2,
              cabin: fullCabin84,
              profitPerHour: tt > 0 ? tp / (tt * 2) : 0,
              routeCount: chosen.length,
              fillRate: (((tt * 2) / 168) * 100).toFixed(1),
              pax: {
                eco: Math.min(cabin.sE * 2, minEco) * 2,
                bus: Math.min(cabin.sB * 2, minBus) * 2,
                first: Math.min(cabin.sF * 2, minFirst) * 2,
              },
            };
            all84.push(baseCircuit84);
            chosen.forEach((r) => used.add(r.id));
            progress84 = true;
          }
        } // end band loop 84h
      }
    }
  
    // ── PASSE 24h : tout le reste ─────────────────────────────────────────────
    for (const ac of sortedAc) {
      const acRoutesAll24 = getRoutesForAc(ac, 24).filter((r) => !used.has(r.id));
      if (!acRoutesAll24.length) continue;
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
  
      const bands24 = bandSize
        ? makeDemandBands(bandSize).filter((b) =>
            acRoutesAll24.some(
              (r) => (r.dEco || 0) >= b.min && (r.dEco || 0) < b.max
            )
          )
        : [null];
  
      for (const band of bands24) {
        const acRoutes24 = band
          ? acRoutesAll24.filter(
              (r) =>
                (r.dEco || 0) >= band.min &&
                (r.dEco || 0) < band.max &&
                !used.has(r.id)
            )
          : acRoutesAll24.filter((r) => !used.has(r.id));
        if (!acRoutes24.length) continue;
        const sorted24 = [...acRoutes24].sort((a, b) => score(b) - score(a));
        const lu24 = new Set();
        let p24 = 0;
        while (p24++ < 300) {
          const free = sorted24.filter((r) => !lu24.has(r.id) && !used.has(r.id));
          if (!free.length) break;
          // Essayer un circuit multi-routes 24h d'abord
          if (free.length >= 2) {
            const chosen24 = fillExact(free, 24, 12);
            if (chosen24 && chosen24.length >= 2) {
              const tt24 = chosen24.reduce((s, r) => s + r.ft, 0);
              const tp24 = chosen24.reduce((s, r) => s + r.profit, 0);
              const minEco = Math.min(
                ...chosen24
                  .map((r) => r.dEco || 0)
                  .filter((d) => d > 0)
                  .concat([0])
              );
              const minBus = Math.min(
                ...chosen24
                  .map((r) => r.dBus || 0)
                  .filter((d) => d > 0)
                  .concat([0])
              );
              const minFirst = Math.min(
                ...chosen24
                  .map((r) => r.dFirst || 0)
                  .filter((d) => d > 0)
                  .concat([0])
              );
              const cabin24 = cabinConfig(ac.seats, minEco, minBus, minFirst);
              if (tp24 > 0) {
                const pAc24m = {
                  brand: ac.brand || "",
                  model: ac.model || "",
                  seats: ac.seats,
                  range: ac.range || 99999,
                  cat: ac.cat || 0,
                };
                const fullCabin24m = circuitCabinConfig(
                  pAc24m,
                  AIRCRAFTS_RAW,
                  chosen24
                );
                const baseCircuit24m = {
                  aircraft: ai,
                  windowH: 24,
                  pool: "mixte",
                  type: `${chosen24.length} route(s) [24h C]`,
                  routes: chosen24.map((r) => ({ ...r, rotations: 1 })),
                  routeIds: chosen24.map((r) => r.id),
                  totalTime: tt24,
                  totalProfit: tp24,
                  totalRev: chosen24.reduce(
                    (s, r) => s + Math.max(0, r.grossPaxRev || 0),
                    0
                  ),
                  cabin: fullCabin24m,
                  profitPerHour: tt24 > 0 ? tp24 / tt24 : 0,
                  routeCount: chosen24.length,
                  fillRate: ((tt24 / 24) * 100).toFixed(1),
                  pax: {
                    eco: Math.min(cabin24.sE * 2, minEco),
                    bus: Math.min(cabin24.sB * 2, minBus),
                    first: Math.min(cabin24.sF * 2, minFirst),
                  },
                };
                all24.push(baseCircuit24m);
                chosen24.forEach((r) => {
                  lu24.add(r.id);
                  used.add(r.id);
                });
                continue;
              }
              chosen24.forEach((r) => lu24.add(r.id));
              continue;
            }
          }
          // Sinon rotation simple
          const best = free[0];
          const rot = Math.floor(24 / best.ft);
          if (rot < 1) {
            lu24.add(best.id);
            continue;
          }
          const tt = best.ft * rot,
            tp = best.profit * rot;
          const pAc24s = {
            brand: ac.brand || "",
            model: ac.model || "",
            seats: ac.seats,
            range: ac.range || 99999,
            cat: ac.cat || 0,
          };
          const fullCabin24s = circuitCabinConfig(pAc24s, AIRCRAFTS_RAW, [
            { ...best, rotations: rot },
          ]);
          const cabin = fullCabin24s;
          const baseCircuit24s = {
            aircraft: ai,
            windowH: 24,
            pool: "mixte",
            type: `×${rot} [24h]`,
            routes: [{ ...best, rotations: rot }],
            routeIds: [best.id],
            totalTime: tt,
            totalProfit: tp,
            totalRev: Math.max(0, best.grossPaxRev || 0) * rot,
            cabin: fullCabin24s,
            profitPerHour: tt > 0 ? tp / tt : 0,
            routeCount: rot,
            fillRate: ((tt / 24) * 100).toFixed(1),
            pax: {
              eco: Math.min(cabin.sE * 2, best.dEco || 0) * rot,
              bus: Math.min(cabin.sB * 2, best.dBus || 0) * rot,
              first: Math.min(cabin.sF * 2, best.dFirst || 0) * rot,
            },
          };
          all24.push(baseCircuit24s);
          lu24.add(best.id);
          used.add(best.id);
        }
      } // end band loop 24h
    }
  
    // ── Passe finale : routes non assignées (69 manquantes) ─────────────────
    // Routes restantes qui n'ont pas trouvé de partenaires pour 168h/84h/24h
    // → solo 168h si ft ≤ 168h, ou solo 24h si profit > 0 avec rotations
    for (const ac of sortedAc) {
      const allAcRoutes = getRoutesForAc(ac, 168).filter((r) => !used.has(r.id));
      if (!allAcRoutes.length) continue;
      const ai = {
        brand: ac.brand,
        model: ac.model,
        seats: ac.seats,
        cat: ac.cat,
      };
      const pAcF = {
        brand: ac.brand || "",
        model: ac.model || "",
        seats: ac.seats,
        range: ac.range || 99999,
        cat: ac.cat || 0,
      };
      const lu = new Set();
      // D'abord : tenter de combiner les routes restantes en 168h
      const rescueSorted = allAcRoutes.sort((a, b) => score(b) - score(a));
      const rescueLu = new Set();
      let rp = 0;
      while (rp++ < 100) {
        const rfree = rescueSorted.filter(
          (r) => !rescueLu.has(r.id) && !used.has(r.id)
        );
        if (rfree.length < 2) break;
        const longR2 = rfree.filter((r) => r.ft >= 30);
        const rpool = longR2.length
          ? [longR2[0], ...rfree.filter((r) => r.id !== longR2[0].id)]
          : rfree;
        const rchosen = fillExact(rpool, 168, 84);
        if (!rchosen || rchosen.length < 2) break;
        rchosen.forEach((r) => rescueLu.add(r.id));
        const rtt = rchosen.reduce((s, r) => s + r.ft, 0);
        const rtp = rchosen.reduce((s, r) => s + r.profit, 0);
        const rminEco = Math.min(
          ...rchosen
            .map((r) => r.dEco || 0)
            .filter((d) => d > 0)
            .concat([0])
        );
        const rminBus = Math.min(
          ...rchosen
            .map((r) => r.dBus || 0)
            .filter((d) => d > 0)
            .concat([0])
        );
        const rminFirst = Math.min(
          ...rchosen
            .map((r) => r.dFirst || 0)
            .filter((d) => d > 0)
            .concat([0])
        );
        const rCabin = circuitCabinConfig(pAcF, AIRCRAFTS_RAW, rchosen);
        all168.push({
          aircraft: ai,
          windowH: 168,
          pool: "mixte",
          type: `${rchosen.length} route(s) [rescue]`,
          routes: rchosen.map((r) => ({ ...r, rotations: 1 })),
          routeIds: rchosen.map((r) => r.id),
          totalTime: rtt,
          totalProfit: rtp,
          totalRev: rchosen.reduce(
            (s, r) => s + Math.max(0, r.grossPaxRev || 0),
            0
          ),
          cabin: rCabin,
          profitPerHour: rtt > 0 ? rtp / rtt : 0,
          routeCount: rchosen.length,
          fillRate: ((rtt / 168) * 100).toFixed(1),
          pax: {
            eco: Math.min(rCabin.sE * 2, rminEco),
            bus: Math.min(rCabin.sB * 2, rminBus),
            first: Math.min(rCabin.sF * 2, rminFirst),
          },
        });
        rchosen.forEach((r) => used.add(r.id));
      }
      // Ensuite : vrais solos pour ce qui reste
      for (const r of rescueSorted) {
        if (lu.has(r.id) || used.has(r.id)) continue;
        lu.add(r.id);
        const fullCabinF = circuitCabinConfig(pAcF, AIRCRAFTS_RAW, [r]);
        const rot = r.ft <= 24 ? Math.floor(24 / r.ft) : 1;
        const wH = r.ft <= 24 ? 24 : 168;
        const tt = r.ft * rot;
        const tp = r.profit * rot;
        (wH === 168 ? all168 : all24).push({
          aircraft: ai,
          windowH: wH,
          pool: "mixte",
          type: `×${rot} [solo]`,
          routes: [{ ...r, rotations: rot }],
          routeIds: [r.id],
          totalTime: tt,
          totalProfit: tp,
          totalRev: Math.max(0, r.grossPaxRev || 0) * rot,
          cabin: fullCabinF,
          profitPerHour: tt > 0 ? tp / tt : 0,
          routeCount: rot,
          fillRate: ((tt / wH) * 100).toFixed(1),
          pax: {
            eco: Math.min(fullCabinF.sE * 2, r.dEco || 0) * rot,
            bus: Math.min(fullCabinF.sB * 2, r.dBus || 0) * rot,
            first: Math.min(fullCabinF.sF * 2, r.dFirst || 0) * rot,
          },
        });
        used.add(r.id);
      }
    }
  
    // ── POST-PROCESSING : reclassification des circuits 168h ─────────────────
    // Règle 1 : fillRate < 14.2% (totalTime ≤ ~24h) → déplacer en 24h
    //   Le circuit ne remplit que 24h sur 168h → c'est un circuit 24h déguisé.
    //   Si rot = floor(24 / totalTime) ≥ 2 → multiplier pour remplir 24h.
    //   Sinon garder tel quel en 24h (×1).
    //
    // Règle 2 : fillRate entre 30% et 50% (50.4h–84h) → doubler (×2)
    //   2× donne 100.8h–168h, beaucoup plus proche du 168h cible.
    //   Le circuit et ses routes sont dupliqués avec rotations×2.
    {
      const toMove24 = [];
      const toKeep168 = [];
      for (const c of all168) {
        const fill = c.totalTime / 168;
        if (fill < 0.142) {
          // Règle 1 : passer en 24h
          const rot = Math.max(1, Math.floor(24 / c.totalTime));
          const newTt = c.totalTime * rot;
          const newTp = c.totalProfit * rot;
          toMove24.push({
            ...c,
            windowH: 24,
            type:
              rot > 1
                ? `×${rot} [24h]`
                : c.type
                    .replace("[C]", "[24h]")
                    .replace("[rescue]", "[24h]")
                    .replace("[solo]", "[24h]"),
            routes: c.routes.map((r) => ({
              ...r,
              rotations: (r.rotations || 1) * rot,
            })),
            totalTime: newTt,
            totalProfit: newTp,
            totalRev: (c.totalRev || 0) * rot,
            profitPerHour: newTt > 0 ? newTp / newTt : 0,
            fillRate: ((newTt / 24) * 100).toFixed(1),
            pax: c.pax
              ? {
                  eco: (c.pax.eco || 0) * rot,
                  bus: (c.pax.bus || 0) * rot,
                  first: (c.pax.first || 0) * rot,
                }
              : c.pax,
          });
        } else if (fill >= 0.3 && fill <= 0.5) {
          // Règle 2 : doubler → passe de 50-84h à 100-168h
          const newTt = c.totalTime * 2;
          const newTp = c.totalProfit * 2;
          toKeep168.push({
            ...c,
            type: c.type
              .replace("[C]", "[C×2]")
              .replace("[rescue]", "[rescue×2]"),
            routes: c.routes.map((r) => ({
              ...r,
              rotations: (r.rotations || 1) * 2,
            })),
            totalTime: newTt,
            totalProfit: newTp,
            totalRev: (c.totalRev || 0) * 2,
            profitPerHour: newTt > 0 ? newTp / newTt : 0,
            fillRate: ((newTt / 168) * 100).toFixed(1),
            pax: c.pax
              ? {
                  eco: (c.pax.eco || 0) * 2,
                  bus: (c.pax.bus || 0) * 2,
                  first: (c.pax.first || 0) * 2,
                }
              : c.pax,
          });
        } else {
          toKeep168.push(c);
        }
      }
      // Remplacer all168 par les circuits reclassifiés
      all168.length = 0;
      all168.push(...toKeep168);
      all24.push(...toMove24);
    }
  
    const allCircuits = [...all168, ...all84, ...all24];
  
    // ── Regrouper par avion ────────────────────────────────────────────────────
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
    const c24  = allCircuits.filter((c) => c.windowH === 24);
    return {
      byAircraft,
      modeP: false,
      modeB: false,
      modeC: true,
      aircraftCount: byAircraft.length,
      circuits168: c168.length,
      circuits24: c24.length,
      total168: c168.reduce((s, c) => s + c.totalProfit, 0),
      total24:  c24.reduce((s, c) => s + c.totalProfit, 0),
      routesUsed: used.size,
      routesTotal: routes.length,
      routesImpossible: 0,
      all168: c168,
      all24: c24,
    };
  }
  
  export {
    computeExclusiveThreshold, runExclusiveRoutePrepass,
    runGlobalOpt, runGlobalOptModeP, runGlobalOptModeC,
  };
  