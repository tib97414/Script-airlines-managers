import { useState, useCallback } from "react";
import * as XLSX from "xlsx";

import { AIRCRAFTS_RAW, CARGO_AIRCRAFTS_RAW } from "./data/aircrafts.js";
import {
  parseRoutes, projectRoutesForSimulation, applyDemandBonus,
  CURRENT_BONUS, configCache,
  buildCircuits168, buildCircuits24,
} from "./lib/core.js";
import { runGlobalOptCargo } from "./lib/cargo.js";
import {
  runGlobalOpt, runGlobalOptModeP, runGlobalOptModeC,
} from "./lib/global.js";
import { exportGlobal, exportCargo } from "./lib/exports.js";

import CircuitCard from "./components/circuits/CircuitCard.jsx";
import AircraftGroup from "./components/circuits/AircraftGroup.jsx";
import ProfitSummary from "./components/circuits/ProfitSummary.jsx";
import StatCard from "./components/circuits/StatCard.jsx";

export default function App() {
  const [routes, setRoutes] = useState([]);
  const [rawRouteData, setRawRouteData] = useState([]); // données brutes du fichier pour re-parser
  const [acIdx, setAcIdx] = useState(0);
  const [c24, setC24] = useState(null);
  const [c168, setC168] = useState(null);
  const [gRes, setGRes] = useState(null);
  const [cargoRes, setCargoRes] = useState(null);
  const [running, setRunning] = useState(false);
  const [runningG, setRunningG] = useState(false);
  const [runningC, setRunningC] = useState(false);
  const [modeB, setModeB] = useState(false);
  const [modeC, setModeC] = useState(false);
  const [modeP, setModeP] = useState(false);
  const [coverageTarget, setCoverageTarget] = useState(0.92);
  const [bandSize, setBandSize] = useState(1000);
  const [hubCat, setHubCat] = useState(10); // Catégorie max autorisée par le hub (1-10)
  const [tab, setTab] = useState("single");
  // Système de bonus demande
  const [useSimulation, setUseSimulation] = useState(false);
  const [currentBonus, setCurrentBonus] = useState({ ...CURRENT_BONUS });
  const [targetBonus, setTargetBonus] = useState({ ...CURRENT_BONUS }); // part des valeurs courantes
  const activeBonus = useSimulation ? targetBonus : currentBonus;
  const setBonus = useSimulation ? setTargetBonus : setCurrentBonus;

  // Quand on active la simulation, initialiser la cible sur les valeurs actuelles
  // pour que "ajouter 3 points" signifie vraiment current+3, pas 100+3.
  const handleToggleSimulation = (enabled) => {
    // Pré-remplir la cible avec les valeurs courantes pour que "+3 points" = current+3
    if (enabled) setTargetBonus({ ...currentBonus });
    setUseSimulation(enabled);
    // Réinitialiser les résultats — ils seront recalculés avec la bonne projection
    setGRes(null);
    setCargoRes(null);
    setC168(null);
    setC24(null);
  };
  const [sw, setSw] = useState("168");
  const [gw, setGw] = useState("168");
  const [cw, setCw] = useState("168");

  const aircraft = AIRCRAFTS_RAW[acIdx];

  const handleFile = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws);
      configCache.clear(); // purge le cache cabine entre imports
      setRawRouteData(raw); // sauvegarde pour re-parser si les bonus changent
      setRoutes(parseRoutes(raw, activeBonus));
      setC24(null);
      setC168(null);
      setGRes(null);
      setCargoRes(null);
    };
    reader.readAsBinaryString(file);
  }, [activeBonus]); // dépend de activeBonus pour capturer les bonus courants

  const [calcError, setCalcError] = useState(null);

  const handleSingle = useCallback(async () => {
    setRunning(true);
    setCalcError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const effectiveRoutes = useSimulation
        ? projectRoutesForSimulation(routes, currentBonus, targetBonus)
        : routes;
      setC168(buildCircuits168(aircraft, effectiveRoutes));
      setC24(buildCircuits24(aircraft, effectiveRoutes));
    } catch (err) {
      setCalcError(`Erreur avion unique : ${err.message}`);
    }
    setRunning(false);
  }, [aircraft, routes, useSimulation, currentBonus, targetBonus]);

  const handleGlobal = useCallback(async () => {
    setRunningG(true);
    setGRes(null);
    await new Promise((r) => setTimeout(r, 60));
    const filteredAc = AIRCRAFTS_RAW.filter((ac) => ac.cat <= hubCat);
    const filteredCargoAc = CARGO_AIRCRAFTS_RAW.filter((ac) => ac.cat <= hubCat);
    // Projection simulation : ratio target/current appliqué aux demandes réelles
    const effectiveRoutes = useSimulation
      ? projectRoutesForSimulation(routes, currentBonus, targetBonus)
      : routes;
    await new Promise((r) => setTimeout(r, 20));
    try {
      // Passagers
      const paxOpt = modeP
        ? runGlobalOptModeP(filteredAc, effectiveRoutes, coverageTarget)
        : modeC
        ? runGlobalOptModeC(filteredAc, effectiveRoutes, bandSize)
        : runGlobalOpt(filteredAc, effectiveRoutes, modeB, bandSize);
      await new Promise((r) => setTimeout(r, 30));
      // Cargo (indépendant des bonus pax — toujours routes réelles)
      const cargoOpt = runGlobalOptCargo(filteredCargoAc, routes);
      setGRes(paxOpt);
      setCargoRes(cargoOpt);
    } catch (err) {
      setCalcError(`Erreur optimisation globale : ${err.message}`);
    }
    setRunningG(false);
  }, [
    routes,
    modeB,
    modeC,
    modeP,
    bandSize,
    coverageTarget,
    hubCat,
    useSimulation,
    currentBonus,
    targetBonus,
  ]);

  const handleCargo = useCallback(async () => {
    setRunningC(true);
    setCargoRes(null);
    setCalcError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      setCargoRes(runGlobalOptCargo(CARGO_AIRCRAFTS_RAW, routes));
    } catch (err) {
      setCalcError(`Erreur optimisation cargo : ${err.message}`);
    }
    setRunningC(false);
  }, [routes]);

  const tabBtn = (key, label, active, setActive, color) => (
    <button
      onClick={() => setActive(key)}
      style={{
        padding: "6px 16px",
        border: "1px solid #dee2e6",
        borderRadius: 4,
        marginRight: 6,
        background: active === key ? color : "white",
        color: active === key ? "white" : "#444",
        cursor: "pointer",
        fontWeight: "bold",
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );
  const mainTabBtn = (key, label, color) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: "10px 22px",
        border: "none",
        borderRadius: "6px 6px 0 0",
        marginRight: 4,
        background: tab === key ? color : "#e9ecef",
        color: tab === key ? "white" : "#555",
        cursor: "pointer",
        fontWeight: "bold",
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        fontFamily: "Arial,sans-serif",
        maxWidth: 1000,
        margin: "0 auto",
        padding: 20,
      }}
    >
      <h2 style={{ margin: "0 0 16px" }}>✈️ Optimiseur de Circuits Aériens</h2>

      <div
        style={{
          background: "#f8f9fa",
          border: "1px solid #dee2e6",
          borderRadius: 8,
          padding: 14,
          marginBottom: 14,
        }}
      >
        <b>📥 Import routes XLSX</b>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <input type="file" accept=".xlsx" onChange={handleFile} />
          {routes.length > 0 && (
            <span style={{ color: "#28a745", fontWeight: "bold" }}>
              ✅ {routes.length} routes chargees
            </span>
          )}
        </div>
      </div>

      <div style={{ borderBottom: "2px solid #dee2e6" }}>
        {mainTabBtn("single", "✈️ Avion unique", "#0d6efd")}
        {mainTabBtn("global", "🌐 Optimisation globale", "#28a745")}
        {mainTabBtn("cargo", "📦 Cargo", "#fd7e14")}
      </div>

      {calcError && (
        <div
          style={{
            background: "#fff0f0",
            border: "1px solid #dc3545",
            borderRadius: 6,
            padding: "10px 14px",
            marginTop: 10,
            color: "#dc3545",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 13,
          }}
        >
          <span>⚠️ {calcError}</span>
          <button
            onClick={() => setCalcError(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#dc3545",
              fontWeight: "bold",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          padding: 20,
          marginBottom: 20,
        }}
      >
        {tab === "single" && (
          <>
            <select
              value={acIdx}
              onChange={(e) => {
                setAcIdx(+e.target.value);
                setC24(null);
                setC168(null);
              }}
              style={{
                width: "100%",
                padding: 8,
                fontSize: 13,
                marginBottom: 8,
                borderRadius: 4,
                border: "1px solid #dee2e6",
              }}
            >
              <optgroup label="✈️ Avions passagers">
                {AIRCRAFTS_RAW.map((a, i) => (
                  <option key={i} value={i}>
                    {a.brand} {a.model} — Cat:{a.cat} — {a.seats} sieges —{" "}
                    {a.range} km
                  </option>
                ))}
              </optgroup>
            </select>
            <div
              style={{
                fontSize: 12,
                color: "#666",
                display: "flex",
                gap: 14,
                marginBottom: 12,
              }}
            >
              <span>
                Cat: <b>{aircraft.cat}</b>
              </span>
              <span>
                Sieges: <b>{aircraft.seats}</b>
              </span>
              <span>
                Range: <b>{aircraft.range} km</b>
              </span>
              <span>
                Vitesse: <b>{aircraft.speed} km/h</b>
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#fd7e14", marginBottom: 8 }}>
              📦 Pour les avions cargo, utilisez l'onglet <b>Cargo</b>.
            </div>
            <button
              onClick={handleSingle}
              disabled={!routes.length || running}
              style={{
                width: "100%",
                padding: "10px",
                fontSize: 14,
                fontWeight: "bold",
                background: !routes.length || running ? "#aaa" : "#0d6efd",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                marginBottom: 14,
              }}
            >
              {running ? "⏳ Calcul..." : "🚀 Construire les circuits"}
            </button>
            {(c168 !== null || c24 !== null) &&
              (() => {
                const cs = sw === "168" ? c168 : c24;
                const tp = cs ? cs.reduce((s, c) => s + c.totalProfit, 0) : 0;
                return (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      {tabBtn(
                        "168",
                        `🟣 168h (${c168?.length ?? 0})`,
                        sw,
                        setSw,
                        "#6f42c1"
                      )}
                      {tabBtn(
                        "24",
                        `🔵 24h (${c24?.length ?? 0})`,
                        sw,
                        setSw,
                        "#0d6efd"
                      )}
                    </div>
                    {!cs || !cs.length ? (
                      <div
                        style={{
                          color: "#888",
                          padding: 16,
                          textAlign: "center",
                        }}
                      >
                        Aucun circuit trouve.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            display: "flex",
                            gap: 20,
                            marginBottom: 10,
                            padding: 10,
                            background: "#f0f8ff",
                            borderRadius: 6,
                            fontSize: 13,
                          }}
                        >
                          <span>
                            <b>{cs.length}</b> circuits
                          </span>
                          <span>
                            Meilleur:{" "}
                            <b>{cs[0].profitPerHour.toFixed(0)} $/h</b>
                          </span>
                        </div>
                        <ProfitSummary circuits={cs} windowH={sw} />
                        <div style={{ maxHeight: 520, overflowY: "auto" }}>
                          {cs.map((c, i) => (
                            <CircuitCard key={i} c={c} idx={i} />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
          </>
        )}

        {tab === "global" && (
          <>
            <div
              style={{
                background: "#fffbea",
                border: "1px solid #ffc107",
                borderRadius: 6,
                padding: 12,
                marginBottom: 14,
                fontSize: 13,
              }}
            >
              <b>Priorite 168h :</b> circuits 168h en premier, repack ultime
              cross-aircraft pour minimiser les solos.
            </div>
            {/* Hub Category Filter */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
                padding: "8px 14px",
                background: "#fff8e1",
                border: "1px solid #ffc107",
                borderRadius: 8,
              }}
            >
              <span
                style={{ fontSize: 13, fontWeight: "bold", color: "#856404" }}
              >
                🏢 Catégorie hub :
              </span>
              <select
                value={hubCat}
                onChange={(e) => setHubCat(+e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid #dee2e6",
                  fontSize: 13,
                  fontWeight: "bold",
                  color: "#444",
                }}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                  <option key={c} value={c}>
                    {c} — {AIRCRAFTS_RAW.filter((a) => a.cat <= c).length}{" "}
                    avions pax /{" "}
                    {CARGO_AIRCRAFTS_RAW.filter((a) => a.cat <= c).length} cargo
                    autorisés
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: "#6c757d" }}>
                ({AIRCRAFTS_RAW.filter((a) => a.cat > hubCat).length} avions
                exclus)
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 14,
                padding: "10px 14px",
                background: "#f1f3f5",
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: "bold", color: "#444" }}>
                Mode :
              </span>
              <button
                onClick={() => {
                  setModeB(false);
                  setModeC(false);
                }}
                style={{
                  padding: "5px 14px",
                  borderRadius: 4,
                  border: "2px solid",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: "bold",
                  borderColor: !modeB && !modeC ? "#0d6efd" : "#dee2e6",
                  background: !modeB && !modeC ? "#0d6efd" : "white",
                  color: !modeB && !modeC ? "white" : "#555",
                }}
              >
                A — Sans tri
              </button>
              <button
                onClick={() => {
                  setModeB(true);
                  setModeC(false);
                }}
                style={{
                  padding: "5px 14px",
                  borderRadius: 4,
                  border: "2px solid",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: "bold",
                  borderColor: modeB && !modeC ? "#6f42c1" : "#dee2e6",
                  background: modeB && !modeC ? "#6f42c1" : "white",
                  color: modeB && !modeC ? "white" : "#555",
                }}
              >
                B — Tranches
              </button>
              <button
                onClick={() => {
                  setModeB(true);
                  setModeC(true);
                  setModeP(false);
                }}
                style={{
                  padding: "5px 14px",
                  borderRadius: 4,
                  border: "2px solid",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: "bold",
                  borderColor: modeC && !modeP ? "#059669" : "#dee2e6",
                  background: modeC && !modeP ? "#059669" : "white",
                  color: modeC && !modeP ? "white" : "#555",
                }}
              >
                C — Résiduel
              </button>
              <button
                onClick={() => {
                  setModeP(true);
                  setModeC(false);
                  setModeB(false);
                }}
                style={{
                  padding: "5px 14px",
                  borderRadius: 4,
                  border: "2px solid",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: "bold",
                  borderColor: modeP ? "#dc6f00" : "#dee2e6",
                  background: modeP ? "#dc6f00" : "white",
                  color: modeP ? "white" : "#555",
                }}
              >
                P — Passagers
              </button>
              {modeP && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginLeft: 4,
                  }}
                >
                  <label
                    style={{
                      fontSize: 12,
                      color: "#6c757d",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Cible :
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    step={1}
                    value={Math.round(coverageTarget * 100)}
                    onChange={(e) => {
                      const v = Math.max(
                        10,
                        Math.min(100, +e.target.value || 92)
                      );
                      setCoverageTarget(v / 100);
                    }}
                    style={{
                      width: 58,
                      padding: "3px 6px",
                      border: "1px solid #dee2e6",
                      borderRadius: 4,
                      fontSize: 13,
                      fontWeight: "bold",
                      color: "#dc6f00",
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#6c757d" }}>%</span>
                </div>
              )}
              {modeB && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginLeft: 4,
                  }}
                >
                  <label
                    style={{
                      fontSize: 12,
                      color: "#6c757d",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Taille tranche :
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    step={50}
                    value={bandSize}
                    onChange={(e) =>
                      setBandSize(
                        Math.max(50, Math.min(5000, +e.target.value || 1000))
                      )
                    }
                    style={{
                      width: 80,
                      padding: "3px 6px",
                      border: "1px solid #dee2e6",
                      borderRadius: 4,
                      fontSize: 13,
                      fontWeight: "bold",
                      color: "#6f42c1",
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#6c757d" }}>unités</span>
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>
                    ({Math.ceil(7000 / Math.max(50, bandSize))} tranches)
                  </span>
                </div>
              )}
            </div>
            {/* ── Panneau Bonus Demande ─────────────────────────────────── */}
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                background: "#f8f0ff",
                border: "1px solid #c084fc",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{ fontSize: 13, fontWeight: "bold", color: "#7c3aed" }}
                >
                  🎯 Bonus Demande
                </span>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useSimulation}
                    onChange={(e) => handleToggleSimulation(e.target.checked)}
                  />
                  Mode simulation (cible)
                </label>
                {useSimulation && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#7c3aed",
                      fontStyle: "italic",
                    }}
                  >
                    Simulation avec bonus cible
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5,1fr)",
                  gap: 8,
                }}
              >
                {[
                  { key: "confort", label: "Confort", classes: "é/b/f" },
                  { key: "distraction", label: "Divertiss.", classes: "é/b/f" },
                  { key: "price", label: "Prix", classes: "é/b/f" },
                  { key: "ponctualite", label: "Ponctualité", classes: "é/b" },
                  { key: "securite", label: "Sécurité", classes: "b/f" },
                ].map(({ key, label, classes }) => (
                  <div
                    key={key}
                    style={{ display: "flex", flexDirection: "column", gap: 3 }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        color: "#555",
                        fontWeight: "bold",
                      }}
                    >
                      {label}
                    </label>
                    <span style={{ fontSize: 10, color: "#999" }}>
                      {classes}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={1}
                      value={activeBonus[key] || 0}
                      onChange={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(1000, +e.target.value || 0)
                        );
                        setBonus((prev) => ({ ...prev, [key]: v }));
                      }}
                      style={{
                        width: "100%",
                        padding: "3px 5px",
                        border: "1px solid #c084fc",
                        borderRadius: 4,
                        fontSize: 13,
                        fontWeight: "bold",
                        color: "#7c3aed",
                        textAlign: "center",
                      }}
                    />
                  </div>
                ))}
              </div>
              {routes.length > 0 &&
                (() => {
                  const sampleRoute = routes[0];
                  const base = {
                    eco: sampleRoute.dEcoBase || sampleRoute.dEco,
                    bus: sampleRoute.dBusBase || sampleRoute.dBus,
                    first: sampleRoute.dFirstBase || sampleRoute.dFirst,
                  };
                  const boostedActive = applyDemandBonus(
                    base.eco, base.bus, base.first,
                    sampleRoute.distance, activeBonus
                  );
                  // En mode simulation : aussi calculer le facteur du bonus courant
                  // pour afficher le DELTA (ce qui change réellement)
                  const boostedCurrent = useSimulation
                    ? applyDemandBonus(base.eco, base.bus, base.first, sampleRoute.distance, currentBonus)
                    : null;

                  const fmt = (f) => (f >= 0 ? "+" : "") + f.toFixed(2) + "%";
                  const absPct = (factor) => ((factor - 1) * 100).toFixed(1);
                  const deltaPct = (fTarget, fCurrent) =>
                    ((fTarget / fCurrent - 1) * 100).toFixed(2);

                  return (
                    <div style={{ marginTop: 8, fontSize: 11, borderTop: "1px solid #e9d5ff", paddingTop: 6 }}>
                      <span style={{ color: "#7c3aed", fontWeight: "bold" }}>
                        Exemple : {sampleRoute.name} ({sampleRoute.distance} km)
                      </span>
                      <div style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {[
                          { label: "Éco", fA: boostedActive.factors.eco, fC: boostedCurrent?.factors.eco },
                          { label: "Bus", fA: boostedActive.factors.bus, fC: boostedCurrent?.factors.bus },
                          { label: "First", fA: boostedActive.factors.first, fC: boostedCurrent?.factors.first },
                        ].map(({ label, fA, fC }) => (
                          <span key={label} style={{ color: "#6d28d9" }}>
                            <b>{label}</b>{" "}
                            <span style={{ color: "#7c3aed" }}>
                              +{absPct(fA)}% vs base
                            </span>
                            {useSimulation && fC != null && (
                              <span style={{
                                marginLeft: 5,
                                color: fA > fC ? "#15803d" : fA < fC ? "#dc2626" : "#9ca3af",
                                fontWeight: "bold",
                              }}>
                                ({fmt(parseFloat(deltaPct(fA, fC)))} vs actuel)
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                      {useSimulation && (
                        <div style={{ marginTop: 4, fontSize: 10, color: "#9ca3af" }}>
                          "vs base" = depuis la demande brute du fichier ·{" "}
                          "vs actuel" = gain marginal par rapport aux bonus courants
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>

            <button
              onClick={handleGlobal}
              disabled={!routes.length || runningG}
              style={{
                width: "100%",
                padding: "10px",
                fontSize: 14,
                fontWeight: "bold",
                background: !routes.length || runningG ? "#aaa" : "#28a745",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                marginBottom: 14,
              }}
            >
              {runningG
                ? "⏳ Optimisation en cours..."
                : "🚀 Lancer l'optimisation passagers (" +
                  AIRCRAFTS_RAW.length +
                  " avions)"}
            </button>
            {gRes &&
              (() => {
                const items = gRes.byAircraft.filter((x) =>
                  gw === "168"
                    ? x.circuits168.length > 0
                    : x.circuits24.length > 0
                );
                return (
                  <>
                    <div
                      style={{
                        marginBottom: 8,
                        fontSize: 12,
                        color: "#6c757d",
                      }}
                    >
                      Mode{" "}
                      <b
                        style={{
                          color: gRes.modeC
                            ? "#059669"
                            : gRes.modeB
                            ? "#6f42c1"
                            : "#0d6efd",
                        }}
                      >
                        {gRes.modeP
                          ? "P (Passagers en priorité)"
                          : gRes.modeC
                          ? `C (Mode B + ${
                              (gRes.residualCircuits168 || 0) +
                              (gRes.residualCircuits24 || 0)
                            } circuits résiduels)`
                          : gRes.modeB
                          ? "B (tranches)"
                          : "A (sans tri)"}
                      </b>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5,1fr)",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <StatCard
                        label="✈️ Avions"
                        val={gRes.aircraftCount}
                        color="#0d6efd"
                      />
                      <StatCard
                        label="🟣 Circuits 168h"
                        val={gRes.circuits168}
                        color="#6f42c1"
                      />
                      <StatCard
                        label="🔵 Circuits 24h"
                        val={gRes.circuits24}
                        color="#0d6efd"
                      />
                      <StatCard
                        label="📍 Routes assignees"
                        val={
                          gRes.modeP
                            ? `${gRes.routesUsed} / ${routes.length}`
                            : `${gRes.routesUsed} / ${gRes.routesTotal}`
                        }
                        color="#28a745"
                      />
                      <StatCard
                        label="❌ Aucun avion"
                        val={gRes.routesImpossible}
                        color={
                          gRes.routesImpossible > 0 ? "#dc3545" : "#28a745"
                        }
                        title="Routes impossibles : la catégorie de l'aéroport bloque tous les avions ayant assez d'autonomie"
                      />
                      {gRes.modeC && (
                        <StatCard
                          label="✅ Routes épuisées"
                          val={gRes.routesExhausted || 0}
                          color="#059669"
                        />
                      )}
                      {gRes.modeC && (
                        <StatCard
                          label="🔄 Circuits résiduels 168h"
                          val={
                            (gRes.residualCircuits168 || 0) +
                            (gRes.residualCircuits24 || 0)
                          }
                          color="#059669"
                        />
                      )}
                      {gRes.modeP &&
                        (() => {
                          // Calculer la couverture depuis les circuits si non disponible
                          const cov = gRes.covered || {
                            eco: 0,
                            bus: 0,
                            first: 0,
                          };
                          const td = gRes.totalDemand || {
                            eco: 1,
                            bus: 1,
                            first: 1,
                          };
                          // Recalculer depuis les circuits si pax=0 (fallback)
                          if (!cov.eco && !cov.bus && !cov.first) {
                            const allC = [
                              ...(gRes.all168 || []),
                              ...(gRes.all24 || []),
                            ];
                            allC.forEach((c) => {
                              if (c.pax) {
                                cov.eco += c.pax.eco || 0;
                                cov.bus += c.pax.bus || 0;
                                cov.first += c.pax.first || 0;
                              } else if (c.cabin) {
                                cov.eco += Math.min(
                                  (c.cabin.sE || 0) * 2,
                                  c.routes?.reduce(
                                    (s, r) => s + (r.dEco || 0),
                                    0
                                  ) || 0
                                );
                                cov.bus += Math.min(
                                  (c.cabin.sB || 0) * 2,
                                  c.routes?.reduce(
                                    (s, r) => s + (r.dBus || 0),
                                    0
                                  ) || 0
                                );
                                cov.first += Math.min(
                                  (c.cabin.sF || 0) * 2,
                                  c.routes?.reduce(
                                    (s, r) => s + (r.dFirst || 0),
                                    0
                                  ) || 0
                                );
                              }
                            });
                          }
                          const pctE =
                            td.eco > 0
                              ? ((cov.eco / td.eco) * 100).toFixed(1)
                              : "0";
                          const pctB =
                            td.bus > 0
                              ? ((cov.bus / td.bus) * 100).toFixed(1)
                              : "0";
                          const pctF =
                            td.first > 0
                              ? ((cov.first / td.first) * 100).toFixed(1)
                              : "0";
                          return (
                            <>
                              <StatCard
                                label={`✈️ ECO ${pctE}%`}
                                val={`${Math.round(
                                  cov.eco
                                ).toLocaleString()} pax`}
                                color="#dc6f00"
                              />
                              <StatCard
                                label={`💼 BUS ${pctB}%`}
                                val={`${Math.round(
                                  cov.bus
                                ).toLocaleString()} pax`}
                                color="#dc6f00"
                              />
                              <StatCard
                                label={`🌟 FIRST ${pctF}%`}
                                val={`${Math.round(
                                  cov.first
                                ).toLocaleString()} pax`}
                                color="#dc6f00"
                              />
                              <StatCard
                                label="🎯 Cible"
                                val={`${Math.round(
                                  (gRes.coverageTarget || 0) * 100
                                )}%`}
                                color="#dc6f00"
                              />
                            </>
                          );
                        })()}
                      {gRes.modeC && (gRes.routesRescued || 0) > 0 && (
                        <StatCard
                          label="♻️ Routes sauvées"
                          val={gRes.routesRescued}
                          color="#0891b2"
                        />
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginBottom: 12,
                        gap: 6,
                      }}
                    >
                      {tabBtn(
                        "168",
                        `🟣 168h — ${gRes.total168.toLocaleString()} $`,
                        gw,
                        setGw,
                        "#6f42c1"
                      )}
                      {tabBtn(
                        "24",
                        `🔵 24h — ${gRes.total24.toLocaleString()} $`,
                        gw,
                        setGw,
                        "#0d6efd"
                      )}
                      <button
                        onClick={() => exportGlobal(gRes, cargoRes)}
                        style={{
                          marginLeft: "auto",
                          padding: "6px 14px",
                          background: "#198754",
                          color: "white",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: "bold",
                          fontSize: 13,
                        }}
                      >
                        📥 Exporter XLSX
                      </button>
                    </div>
                    <ProfitSummary
                      circuits={gRes.byAircraft.flatMap((x) =>
                        gw === "168" ? x.circuits168 : x.circuits24
                      )}
                      windowH={gw}
                    />
                    <div style={{ maxHeight: 580, overflowY: "auto" }}>
                      {items.map((item, i) => (
                        <AircraftGroup key={i} item={item} globalTab={gw} />
                      ))}
                    </div>
                  </>
                );
              })()}
          </>
        )}

        {tab === "cargo" && (
          <>
            <div
              style={{
                background: "#fff3e0",
                border: "1px solid #fd7e14",
                borderRadius: 6,
                padding: 12,
                marginBottom: 14,
                fontSize: 13,
              }}
            >
              <b>📦 Cargo ({CARGO_AIRCRAFTS_RAW.length} avions) :</b>{" "}
              optimisation sur colonne DEMANDE CARGO (tonnes). Le profit
              passager n'est pas affecte.
            </div>
            <button
              onClick={handleCargo}
              disabled={!routes.length || runningC}
              style={{
                width: "100%",
                padding: "10px",
                fontSize: 14,
                fontWeight: "bold",
                background: !routes.length || runningC ? "#aaa" : "#fd7e14",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                marginBottom: 14,
              }}
            >
              {runningC
                ? "⏳ Optimisation cargo en cours..."
                : "🚀 Lancer l'optimisation cargo (" +
                  CARGO_AIRCRAFTS_RAW.length +
                  " avions)"}
            </button>
            {cargoRes &&
              (() => {
                const items = cargoRes.byAircraft.filter((x) =>
                  cw === "168"
                    ? x.circuits168.length > 0
                    : x.circuits24.length > 0
                );
                return (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5,1fr)",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <StatCard
                        label="📦 Avions cargo"
                        val={cargoRes.aircraftCount}
                        color="#fd7e14"
                      />
                      <StatCard
                        label="🟣 Circuits 168h"
                        val={cargoRes.circuits168}
                        color="#6f42c1"
                      />
                      <StatCard
                        label="🔵 Circuits 24h"
                        val={cargoRes.circuits24}
                        color="#0d6efd"
                      />
                      <StatCard
                        label="📍 Routes assignees"
                        val={`${cargoRes.routesUsed} / ${cargoRes.routesWithCargo}`}
                        color="#28a745"
                      />
                      <StatCard
                        label="🗂️ Routes avec cargo"
                        val={cargoRes.routesWithCargo}
                        color="#6c757d"
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginBottom: 12,
                        gap: 6,
                      }}
                    >
                      {tabBtn(
                        "168",
                        `🟣 168h — ${cargoRes.total168.toLocaleString()} $`,
                        cw,
                        setCw,
                        "#6f42c1"
                      )}
                      {tabBtn(
                        "24",
                        `🔵 24h — ${cargoRes.total24.toLocaleString()} $`,
                        cw,
                        setCw,
                        "#0d6efd"
                      )}
                      <button
                        onClick={() => exportCargo(cargoRes)}
                        style={{
                          marginLeft: "auto",
                          padding: "6px 14px",
                          background: "#fd7e14",
                          color: "white",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: "bold",
                          fontSize: 13,
                        }}
                      >
                        📥 Exporter XLSX Cargo
                      </button>
                    </div>
                    <ProfitSummary
                      circuits={cargoRes.byAircraft.flatMap((x) =>
                        cw === "168" ? x.circuits168 : x.circuits24
                      )}
                      windowH={cw}
                    />
                    <div style={{ maxHeight: 580, overflowY: "auto" }}>
                      {items.map((item, i) => (
                        <AircraftGroup
                          key={i}
                          item={item}
                          globalTab={cw}
                          isCargo={true}
                        />
                      ))}
                    </div>
                  </>
                );
              })()}
          </>
        )}
      </div>
    </div>
  );
}