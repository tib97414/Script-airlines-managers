// Export XLSX des résultats (passagers + cargo).
import * as XLSX from "xlsx";

function flattenCircuitsForXlsx(circuits, windowH) {
  const rows = [];
  circuits.forEach((c, i) => {
    const ac = c.aircraft || {};
    const baseRow = {
      "#": i + 1,
      "Fenêtre": `${windowH}h`,
      "Avion": `${ac.brand || ""} ${ac.model || ""}`.trim(),
      "Type": c.type || "",
      "Pool": c.pool || "",
      "Routes": (c.routes || []).map((r) => r.name).join(" + "),
      "Temps total (h)": +(c.totalTime || 0).toFixed(2),
      "Profit total ($)": Math.round(c.totalProfit || 0),
      "Profit/h ($/h)": Math.round(c.profitPerHour || 0),
      "Taux remplissage": c.fillRate ? `${c.fillRate}%` : "",
    };
    rows.push(baseRow);
  });
  return rows;
}

export function exportGlobal(gRes, cargoRes) {
  if (!gRes) return;
  const wb = XLSX.utils.book_new();

  const all168 = (gRes.byAircraft || []).flatMap((x) => x.circuits168 || []);
  const all24 = (gRes.byAircraft || []).flatMap((x) => x.circuits24 || []);
  const ws168 = XLSX.utils.json_to_sheet(flattenCircuitsForXlsx(all168, 168));
  const ws24 = XLSX.utils.json_to_sheet(flattenCircuitsForXlsx(all24, 24));
  XLSX.utils.book_append_sheet(wb, ws168, "Pax 168h");
  XLSX.utils.book_append_sheet(wb, ws24, "Pax 24h");

  // Synthèse cargo piggy-back par circuit
  const piggy = [];
  [...all168, ...all24].forEach((c) => {
    const fleet = c.cabin?.fleet || [];
    fleet.forEach((p) => {
      if (p.cargoLoaded && p.cargoLoaded > 0) {
        piggy.push({
          "Avion principal": `${c.aircraft?.brand || ""} ${c.aircraft?.model || ""}`.trim(),
          "Fenêtre": `${c.windowH}h`,
          "Routes": (c.routes || []).map((r) => r.name).join(" + "),
          "Plane #": p.planeNum,
          "Modèle plane": `${p.brand} ${p.model}`,
          "Payload total (t)": p.acPayload,
          "Masse pax (t)": p.cargoPaxMass,
          "Résidu (t)": p.cargoResidualPayload,
          "Cargo chargé (t)": p.cargoLoaded,
          "Revenu cargo ($)": p.cargoRev,
          "Surcoût carburant ($)": p.cargoFuelDelta,
          "Profit cargo net ($)": p.cargoProfit,
        });
      }
    });
  });
  if (piggy.length) {
    const wsPiggy = XLSX.utils.json_to_sheet(piggy);
    XLSX.utils.book_append_sheet(wb, wsPiggy, "Cargo piggy-back");
  }

  if (cargoRes) {
    const c168 = (cargoRes.byAircraft || []).flatMap((x) => x.circuits168 || []);
    const c24 = (cargoRes.byAircraft || []).flatMap((x) => x.circuits24 || []);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenCircuitsForXlsx(c168, 168)), "Cargo 168h");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenCircuitsForXlsx(c24, 24)), "Cargo 24h");
  }

  XLSX.writeFile(wb, `optimisation_globale_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportCargo(cargoRes) {
  if (!cargoRes) return;
  const wb = XLSX.utils.book_new();
  const c168 = (cargoRes.byAircraft || []).flatMap((x) => x.circuits168 || []);
  const c24 = (cargoRes.byAircraft || []).flatMap((x) => x.circuits24 || []);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenCircuitsForXlsx(c168, 168)), "Cargo 168h");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flattenCircuitsForXlsx(c24, 24)), "Cargo 24h");
  XLSX.writeFile(wb, `optimisation_cargo_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
