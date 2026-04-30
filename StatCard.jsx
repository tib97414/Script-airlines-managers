import React from "react";

function StatCard({ label, val, color }) {
  return (
    <div
      style={{
        padding: 10,
        background: "#f8f9fa",
        borderRadius: 6,
        textAlign: "center",
        border: `1px solid ${color}22`,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: "bold", color }}>{val}</div>
      <div style={{ fontSize: 11, color: "#6c757d", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

export default StatCard;
