import React, { useState, useMemo } from "react";
import { circuitCabinConfig, enrichRoutesFull, fuelCostRoundTrip } from "../../lib/core.js";
import { AIRCRAFTS_RAW } from "../../data/aircrafts.js";
import PoolBadge from "./PoolBadge.jsx";

function CircuitCard({ c, idx }) {
  const [open, setOpen] = useState(false);
  const handleOpen = () => setOpen((v) => !v);
  const fp = parseFloat(c.fillRate || 0);
  const fc = fp >= 95 ? "#28a745" : fp >= 80 ? "#fd7e14" : "#dc3545";
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        marginBottom: 6,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "9px 14px",
          background: "#f8f9fa",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
          <b>#{idx + 1}</b>
          <PoolBadge pool={c.pool} />
          <span style={{ color: "#6c757d", marginLeft: 6 }}>
            {c.totalTime.toFixed(2)}h
          </span>
          {c.fillRate && (
            <span style={{ marginLeft: 6, fontWeight: "bold", color: fc }}>
              ({c.fillRate}%)
            </span>
          )}
        </span>
        <span
          style={{
            color:
              c.totalProfit > 0
                ? "#28a745"
                : c.totalProfit < 0
                ? "#dc3545"
                : "#aaa",
            fontWeight: "bold",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          {c.totalProfit !== 0
            ? `${c.totalProfit.toLocaleString()} $ (${c.profitPerHour.toFixed(
                0
              )} $/h)`
            : "0 $"}{" "}
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div style={{ padding: "8px 14px", fontSize: 12, background: "white" }}>
          {/* Config cabine du circuit */}
          {c.cabin && (
            <div
              style={{
                marginBottom: 8,
                padding: "8px 10px",
                background: "#f0f4ff",
                border: "1px solid #cce0ff",
                borderRadius: 6,
              }}
            >
              {/* En-tête : demande totale du circuit */}
              <div style={{ fontSize: 11, color: "#6c757d", marginBottom: 6 }}>
                <b style={{ color: "#0d6efd" }}>🪑 Flotte optimale</b>
                <span style={{ marginLeft: 8 }}>
                  Demande circuit :{" "}
                  <b>
                    {(() => {
                      const dE = c.cabin.demandEco || 0;
                      const dB = c.cabin.demandBus || 0;
                      const dF = c.cabin.demandFirst || 0;
                      const parts = [];
                      if (dE > 0) parts.push(dE + "é");
                      if (dB > 0) parts.push(dB + "b");
                      if (dF > 0) parts.push(dF + "f");
                      return parts.length ? parts.join(" / ") : "—";
                    })()}
                  </b>
                </span>
                {c.cabin.unsatisfied &&
                  (c.cabin.unsatisfied.eco > 0 ||
                    c.cabin.unsatisfied.bus > 0 ||
                    c.cabin.unsatisfied.first > 0) && (
                    <span style={{ marginLeft: 8, color: "#dc3545" }}>
                      — Résidu non rentable : {c.cabin.unsatisfied.eco}é /{" "}
                      {c.cabin.unsatisfied.bus}b / {c.cabin.unsatisfied.first}f
                    </span>
                  )}
              </div>
              {/* Un bandeau par avion de la cascade */}
              {(c.cabin.fleet || []).map((plane, pi) => (
                <div
                  key={pi}
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: "5px 8px",
                    marginBottom: 4,
                    borderRadius: 4,
                    background: plane.isProfitable ? "#f0fdf4" : "#fff7ed",
                    border: `1px solid ${
                      plane.isProfitable ? "#86efac" : "#fdba74"
                    }`,
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      background: plane.isProfitable
                        ? plane.isSameType === false
                          ? "#7c3aed"
                          : "#22c55e"
                        : "#f97316",
                      color: "white",
                      borderRadius: 3,
                      padding: "1px 7px",
                      fontWeight: "bold",
                      fontSize: 12,
                      minWidth: 60,
                      textAlign: "center",
                    }}
                  >
                    ✈️ Avion {plane.planeNum}
                  </span>
                  {plane.brand && !plane.isSameType && (
                    <span
                      style={{
                        background: "#ede9fe",
                        color: "#5b21b6",
                        borderRadius: 3,
                        padding: "1px 6px",
                        fontSize: 11,
                        fontWeight: "bold",
                      }}
                    >
                      🔄 {plane.brand} {plane.model}
                    </span>
                  )}
                  {/* Config cabine */}
                  <span
                    style={{
                      background: "#dbeafe",
                      color: "#1d4ed8",
                      borderRadius: 3,
                      padding: "1px 5px",
                      fontWeight: "bold",
                    }}
                  >
                    {plane.label}
                  </span>
                  <span style={{ color: "#374151" }}>
                    {plane.sE}é/{plane.sB}b/{plane.sF}f
                    <span style={{ color: "#9ca3af", marginLeft: 4 }}>
                      (A/R×2 → {plane.capEco}é/{plane.capBus}b/{plane.capFirst}
                      f)
                    </span>
                  </span>
                  {/* Demande résiduelle prise en charge */}
                  <span
                    style={{
                      color: "#6b7280",
                      borderLeft: "1px solid #e5e7eb",
                      paddingLeft: 8,
                    }}
                  >
                    Demande : {plane.demandEco}é/{plane.demandBus}b/
                    {plane.demandFirst}f
                  </span>
                  <span style={{ color: "#6b7280" }}>
                    Embarqués : {plane.paxEco}é/{plane.paxBus}b/{plane.paxFirst}
                    f
                  </span>
                  {/* Rentabilité */}
                  <span
                    style={{
                      marginLeft: "auto",
                      fontWeight: "bold",
                      color:
                        plane.profit > 0
                          ? "#16a34a"
                          : plane.profit < 0
                          ? "#dc2626"
                          : "#9ca3af",
                    }}
                  >
                    {plane.profit >= 0 ? "+" : ""}
                    {plane.profit.toLocaleString()} $
                    {!plane.isProfitable && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: "normal",
                          marginLeft: 4,
                        }}
                      >
                        (déficitaire)
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {/* Total flotte */}
              {(c.cabin.fleet || []).length > 1 &&
                (() => {
                  const fleet = c.cabin.fleet || [];
                  const totalRev = fleet.reduce((s, p) => s + p.rev, 0);
                  const totalTax = fleet.reduce((s, p) => s + p.tax, 0);
                  const totalProfit = fleet.reduce((s, p) => s + p.profit, 0);
                  return (
                    <div
                      style={{
                        paddingTop: 4,
                        borderTop: "1px solid #bfdbfe",
                        fontSize: 11,
                        display: "flex",
                        gap: 12,
                        color: "#374151",
                        flexWrap: "wrap",
                      }}
                    >
                      <b>{fleet.length} avions au total</b>
                      <span style={{ color: "#6b7280" }}>
                        Rev total : {totalRev.toLocaleString()} $
                      </span>
                      <span style={{ color: "#e74c3c" }}>
                        Taxes : -{totalTax.toLocaleString()} $
                      </span>
                      <span
                        style={{
                          color: totalProfit >= 0 ? "#16a34a" : "#dc2626",
                          fontWeight: "bold",
                        }}
                      >
                        Profit flotte : {totalProfit >= 0 ? "+" : ""}
                        {totalProfit.toLocaleString()} $
                      </span>
                    </div>
                  );
                })()}
            </div>
          )}
          {/* Cargo piggy-back : fret embarqué sur les avions PAX */}
          {c.cabin && c.cabin.cargoPiggyback && !c.isCargo && (
            <div
              style={{
                marginBottom: 8,
                padding: "8px 10px",
                background: "#fff7ed",
                border: "1px dashed #fdba74",
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: "bold",
                  color: "#c2410c",
                  marginBottom: 6,
                }}
              >
                📦 Cargo piggy-back —{" "}
                {c.cabin.cargoPiggyback.planes.length} avion(s) PAX chargent du
                fret résiduel
                <span style={{ color: "#92400e", fontWeight: "normal", marginLeft: 6 }}>
                  (aucun nouvel avion — chargement sur les avions pax existants)
                </span>
              </div>
              {c.cabin.cargoPiggyback.planes.map((p, pi) => (
                <div
                  key={pi}
                  style={{
                    fontSize: 11,
                    padding: "4px 6px",
                    marginBottom: 3,
                    background: "#fffbeb",
                    border: "1px solid #fed7aa",
                    borderRadius: 4,
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <span>
                    <b>Avion {p.planeNum}</b> {p.brand} {p.model}
                  </span>
                  <span style={{ color: "#6b7280" }}>
                    Payload : <b>{p.acPayload}t</b>
                    <br />
                    Pax : {p.paxMass}t · Résidu : <b>{p.residualPayload}t</b>
                  </span>
                  <span style={{ color: "#c2410c" }}>
                    📦 Chargé : <b>{p.loaded}t</b>
                  </span>
                  <span style={{ color: "#16a34a" }}>
                    Rev : +{p.cargoRev.toLocaleString()} $
                    <br />
                    <span style={{ color: "#dc2626", fontSize: 10 }}>
                      Carb. : -{p.cargoFuelDelta.toLocaleString()} $
                    </span>
                  </span>
                  <span
                    style={{
                      color: "#16a34a",
                      fontWeight: "bold",
                      textAlign: "right",
                    }}
                  >
                    +{p.cargoProfit.toLocaleString()} $
                  </span>
                </div>
              ))}
              {/* Total piggy-back */}
              <div
                style={{
                  paddingTop: 4,
                  borderTop: "1px solid #fdba74",
                  fontSize: 11,
                  display: "flex",
                  gap: 12,
                  color: "#374151",
                  flexWrap: "wrap",
                  marginTop: 4,
                }}
              >
                <b>
                  Total fret embarqué :{" "}
                  {c.cabin.cargoPiggyback.totalLoaded}t
                </b>
                <span style={{ color: "#6b7280" }}>
                  Rev cargo : +
                  {c.cabin.cargoPiggyback.totalRev.toLocaleString()} $
                </span>
                <span style={{ color: "#dc2626" }}>
                  Surcoût carburant : -
                  {c.cabin.cargoPiggyback.totalFuelDelta.toLocaleString()} $
                </span>
                <span
                  style={{
                    color: "#16a34a",
                    fontWeight: "bold",
                  }}
                >
                  Profit cargo net : +
                  {c.cabin.cargoPiggyback.totalProfit.toLocaleString()} $
                </span>
                {c.cabin.cargoPiggyback.cargoDemandRemaining > 0 && (
                  <span style={{ color: "#92400e", fontStyle: "italic" }}>
                    Demande cargo non utilisée :{" "}
                    {c.cabin.cargoPiggyback.cargoDemandRemaining}t
                  </span>
                )}
              </div>
            </div>
          )}
          {/* Flotte cargo */}
          {c.cargoFleet && c.isCargo && (
            <div
              style={{
                marginBottom: 8,
                padding: "8px 10px",
                background: "#fff7ed",
                border: "1px solid #fdba74",
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 11, color: "#92400e", marginBottom: 6 }}>
                <b style={{ color: "#c2410c" }}>📦 Flotte cargo optimale</b>
                <span style={{ marginLeft: 8 }}>
                  Demande circuit :{" "}
                  <b>
                    {Math.min(
                      ...c.routes.map((r) => r.dCargo || 0).filter((d) => d > 0)
                    ) || 0}{" "}
                    t
                  </b>
                </span>
                {c.cargoFleet.unsatisfied > 0 && (
                  <span style={{ marginLeft: 8, color: "#dc3545" }}>
                    — Résidu non rentable : {c.cargoFleet.unsatisfied} t
                  </span>
                )}
              </div>
              {(c.cargoFleet.planes || []).map((plane, pi) => (
                <div
                  key={pi}
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: "5px 8px",
                    marginBottom: 4,
                    borderRadius: 4,
                    background: plane.isProfitable ? "#f0fdf4" : "#fff7ed",
                    border: `1px solid ${
                      plane.isProfitable ? "#86efac" : "#fdba74"
                    }`,
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      background: plane.isProfitable
                        ? plane.isSameType === false
                          ? "#7c3aed"
                          : "#22c55e"
                        : "#f97316",
                      color: "white",
                      borderRadius: 3,
                      padding: "1px 7px",
                      fontWeight: "bold",
                      fontSize: 12,
                      minWidth: 60,
                      textAlign: "center",
                    }}
                  >
                    ✈️ Avion {plane.planeNum}
                  </span>
                  {!plane.isSameType && (
                    <span
                      style={{
                        background: "#ede9fe",
                        color: "#5b21b6",
                        borderRadius: 3,
                        padding: "1px 6px",
                        fontSize: 11,
                        fontWeight: "bold",
                      }}
                    >
                      🔄 {plane.brand} {plane.model}
                    </span>
                  )}
                  <span
                    style={{
                      background: "#fef3c7",
                      color: "#92400e",
                      borderRadius: 3,
                      padding: "1px 5px",
                      fontWeight: "bold",
                    }}
                  >
                    {plane.payload} t
                  </span>
                  <span style={{ color: "#374151" }}>
                    Demande: {plane.demandBefore} t
                    <span style={{ color: "#9ca3af", marginLeft: 4 }}>
                      → Chargé: {plane.loaded} t
                    </span>
                  </span>
                  {plane.remaining > 0 && (
                    <span style={{ color: "#6b7280" }}>
                      Reste: {plane.remaining} t
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: "auto",
                      fontWeight: "bold",
                      color:
                        plane.profit > 0
                          ? "#16a34a"
                          : plane.profit < 0
                          ? "#dc2626"
                          : "#9ca3af",
                    }}
                  >
                    Rev: {plane.grossRev.toLocaleString()} $ − Tax:{" "}
                    {plane.tax.toLocaleString()} $ ={" "}
                    <b>
                      {plane.profit >= 0 ? "+" : ""}
                      {plane.profit.toLocaleString()} $
                    </b>
                  </span>
                </div>
              ))}
              {(c.cargoFleet.planes || []).length > 1 &&
                (() => {
                  const pl = c.cargoFleet.planes;
                  const totRev = pl.reduce((s, p) => s + p.grossRev, 0);
                  const totTax = pl.reduce((s, p) => s + p.tax, 0);
                  const totProfit = pl.reduce((s, p) => s + p.profit, 0);
                  return (
                    <div
                      style={{
                        paddingTop: 4,
                        borderTop: "1px solid #fdba74",
                        fontSize: 11,
                        display: "flex",
                        gap: 12,
                        color: "#374151",
                        flexWrap: "wrap",
                      }}
                    >
                      <b>{pl.length} avions cargo</b>
                      <span style={{ color: "#6b7280" }}>
                        Rev total: {totRev.toLocaleString()} $
                      </span>
                      <span style={{ color: "#e74c3c" }}>
                        Taxes: -{totTax.toLocaleString()} $
                      </span>
                      <span
                        style={{
                          color: totProfit >= 0 ? "#16a34a" : "#dc2626",
                          fontWeight: "bold",
                        }}
                      >
                        Profit flotte: {totProfit >= 0 ? "+" : ""}
                        {totProfit.toLocaleString()} $
                      </span>
                    </div>
                  );
                })()}
            </div>
          )}
          {/* Lignes par route */}
          {c.routes.map((r, i) => {
            const isCargo = (r.dCargo || 0) > 0 && !r.cabin;
            const rot = r.rotations || 1;
            const taxTotal = (r.tax || 0) * 2 * rot;
            const profitNet = r.profit * rot;
            const paxRev = isCargo
              ? (r.grossRev || 0) * rot
              : r.cabin
              ? r.cabin.rev * rot
              : 0;
            const revLabel = isCargo ? "Rev cargo" : "Rev pax";

            // ── Demande restante ──────────────────────────────────────────
            // On additionne les passagers réellement embarqués sur TOUS les
            // avions de la flotte (cabin.fleet[].paxEco/Bus/First).
            // paxEco = passagers embarqués par sens de vol (aller simple) —
            // la demande est aussi par sens, donc pas de ×2 ici.
            const cabin = c.cabin;
            const fleet = cabin?.fleet || [];
            // Utilise capEco/capBus/capFirst = sièges A/R (déjà ×2, valeur grise)
            const totalCapEco   = fleet.reduce((s, p) => s + (p.capEco   || 0), 0);
            const totalCapBus   = fleet.reduce((s, p) => s + (p.capBus   || 0), 0);
            const totalCapFirst = fleet.reduce((s, p) => s + (p.capFirst || 0), 0);
            // Si pas de fleet, fallback cabin.sE ×2
            const totalFilledEco   = fleet.length ? totalCapEco   : (cabin ? (cabin.sE || 0) * 2 : 0);
            const totalFilledBus   = fleet.length ? totalCapBus   : (cabin ? (cabin.sB || 0) * 2 : 0);
            const totalFilledFirst = fleet.length ? totalCapFirst : (cabin ? (cabin.sF || 0) * 2 : 0);
            // Restant = demande − capacité A/R déployée (peut être négatif si sur-desservi)
            const remEco   = (r.dEco   || 0) - totalFilledEco;
            const remBus   = (r.dBus   || 0) - totalFilledBus;
            const remFirst = (r.dFirst || 0) - totalFilledFirst;
            const hasAnyDemand = (r.dEco || 0) + (r.dBus || 0) + (r.dFirst || 0) > 0;

            return (
              <div
                key={i}
                style={{ padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}
              >
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "#6c757d", minWidth: 20 }}>
                    #{i + 1}
                  </span>
                  <span style={{ flex: 1 }}>
                    {r.name}
                  </span>
                  <span style={{ color: "#6c757d" }}>{r.distance} km</span>
                  <span style={{ color: "#6c757d" }}>{r.ft.toFixed(2)}h</span>
                  {rot > 1 && <span style={{ color: "#0d6efd" }}>×{rot}</span>}
                  {isCargo && (
                    <span style={{ color: "#fd7e14", fontWeight: "bold" }}>
                      {r.dCargo}t
                    </span>
                  )}
                  <span
                    style={{
                      color: profitNet >= 0 ? "#28a745" : "#dc3545",
                      fontWeight: "bold",
                    }}
                  >
                    {profitNet.toLocaleString()} $
                  </span>
                </div>

                {/* Demande brute → restante */}
                {!isCargo && hasAnyDemand && (
                  <div
                    style={{
                      paddingLeft: 30,
                      fontSize: 11,
                      marginTop: 2,
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    {/* Demande originale */}
                    <span style={{ color: "#6c757d" }}>
                      {r.dEco || 0}é/{r.dBus || 0}b/{r.dFirst || 0}f
                    </span>
                    <span style={{ color: "#adb5bd", fontSize: 10 }}>→</span>
                    {/* Demande restante avec couleur selon positif/négatif */}
                    {[
                      { label: "é", val: remEco,   filled: totalFilledEco },
                      { label: "b", val: remBus,   filled: totalFilledBus },
                      { label: "f", val: remFirst, filled: totalFilledFirst },
                    ]
                      .filter(({ filled }) => filled > 0 || true) // toujours afficher si demande > 0
                      .map(({ label, val, filled }, ki) => (
                        <span
                          key={ki}
                          style={{
                            fontWeight: "bold",
                            color:
                              filled === 0
                                ? "#adb5bd"   // gris = non desservi
                                : val <= 0
                                ? "#dc3545"   // rouge = demande saturée / dépassée
                                : val < 50
                                ? "#fd7e14"   // orange = quasi-saturé
                                : "#0d6efd",  // bleu = encore de la demande
                          }}
                        >
                          {val > 0 ? val : val}{label}
                          {ki < 2 && <span style={{ color: "#dee2e6" }}>/</span>}
                        </span>
                      ))}
                    <span style={{ color: "#adb5bd", fontSize: 10 }}>restant</span>
                  </div>
                )}

                <div
                  style={{
                    paddingLeft: 30,
                    fontSize: 11,
                    color: "#6c757d",
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {revLabel}: {paxRev.toLocaleString()} $
                  </span>
                  {!isCargo && r.priceEco && (
                    <span style={{ color: "#6366f1", fontSize: 10 }}>
                      📋 Prix: {r.priceEco?.toLocaleString()}é
                      {r.priceBus
                        ? " / " + r.priceBus?.toLocaleString() + "b"
                        : ""}
                      {r.priceFirst
                        ? " / " + r.priceFirst?.toLocaleString() + "f"
                        : ""}
                    </span>
                  )}
                  <span style={{ color: "#e74c3c" }}>
                    − Taxes: {taxTotal.toLocaleString()} $
                  </span>
                  {(r.fuelCost || 0) > 0 && (
                    <span style={{ color: "#c2410c" }}>
                      − Carburant:{" "}
                      {Math.round((r.fuelCost || 0) * rot).toLocaleString()} $
                    </span>
                  )}
                  <span>
                    = Net:{" "}
                    <b
                      style={{ color: profitNet >= 0 ? "#27ae60" : "#dc3545" }}
                    >
                      {profitNet.toLocaleString()} $
                    </b>
                  </span>
                </div>
              </div>
            );
          })}
          {(() => {
            const totFuel = c.routes
              ? c.routes.reduce(
                  (s, r) => s + (r.fuelCost || 0) * (r.rotations || 1),
                  0
                )
              : 0;
            return (
              totFuel > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#c2410c",
                    padding: "2px 0",
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <span>
                    ⛽ Carburant total circuit :{" "}
                    {Math.round(totFuel).toLocaleString()} $
                  </span>
                </div>
              )
            );
          })()}
          <div
            style={{
              marginTop: 4,
              padding: "4px 0",
              fontWeight: "bold",
              display: "flex",
              gap: 16,
              fontSize: 12,
            }}
          >
            <span>Total: {c.totalTime.toFixed(2)}h</span>
            <span style={{ color: c.totalProfit >= 0 ? "#28a745" : "#dc3545" }}>
              {c.totalProfit.toLocaleString()} $
            </span>
            <span>{c.profitPerHour.toFixed(0)} $/h</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default CircuitCard;
