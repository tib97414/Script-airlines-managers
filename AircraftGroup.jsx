import React, { useState } from "react";
import CircuitCard from "./CircuitCard.jsx";

function AircraftGroup({ item, globalTab, isCargo }) {
  const [open, setOpen] = useState(false);
  const cs = globalTab === "168" ? item.circuits168 : item.circuits24;
  const best = globalTab === "168" ? item.best168 : item.best24;
  const totalP = globalTab === "168" ? item.totalProfit168 : item.totalProfit24;
  if (!cs.length) return null;
  return (
    <div
      style={{
        border: "1px solid #dee2e6",
        borderRadius: 8,
        marginBottom: 6,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "9px 14px",
          background: "#e9ecef",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          <b>
            ✈️ {item.aircraft.brand} {item.aircraft.model}
          </b>
          <span style={{ color: "#6c757d", marginLeft: 8, fontSize: 12 }}>
            Cat:{item.aircraft.cat}
            {isCargo
              ? ` — ${item.aircraft.payload}t`
              : ` — ${item.aircraft.seats} sieges`}
          </span>
        </span>
        <span
          style={{
            fontWeight: "bold",
            color: totalP > 0 ? "#28a745" : "#e67e22",
            fontSize: 13,
          }}
        >
          {cs.length} circuit(s) —{" "}
          {best ? `${best.profitPerHour.toFixed(0)} $/h` : "—"}{" "}
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div style={{ padding: 8 }}>
          {cs.map((c, i) => (
            <CircuitCard key={i} c={c} idx={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export default AircraftGroup;
