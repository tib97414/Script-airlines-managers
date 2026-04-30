import React from "react";

function ProfitSummary({ circuits, windowH }) {
  if (!circuits || !circuits.length) return null;
  const total = circuits.reduce((s, c) => s + c.totalProfit, 0);
  const pos = circuits.filter((c) => c.totalProfit >= 0);
  const neg = circuits.filter((c) => c.totalProfit < 0);
  const sumPos = pos.reduce((s, c) => s + c.totalProfit, 0);
  const sumNeg = neg.reduce((s, c) => s + c.totalProfit, 0);
  const isPos = total >= 0;
  return (
    <div
      style={{
        border: `2px solid ${isPos ? "#28a745" : "#dc3545"}`,
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 14,
        background: isPos ? "#f0fff4" : "#fff5f5",
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: "#6c757d", marginBottom: 2 }}>
          💰 PROFIT NET TOTAL — {windowH}h ({circuits.length} circuits)
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: "bold",
            color: isPos ? "#28a745" : "#dc3545",
          }}
        >
          {total >= 0 ? "+" : ""}
          {total.toLocaleString()} $
        </div>
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#6c757d",
          borderLeft: "1px solid #dee2e6",
          paddingLeft: 16,
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <span style={{ color: "#27ae60" }}>
          ✅ {pos.length} circuits positifs : +{sumPos.toLocaleString()} $
        </span>
        {neg.length > 0 && (
          <span style={{ color: "#dc3545" }}>
            ❌ {neg.length} circuits négatifs : {sumNeg.toLocaleString()} $
          </span>
        )}
        {neg.length === 0 && (
          <span style={{ color: "#27ae60" }}>✅ Aucun circuit négatif</span>
        )}
      </div>
    </div>
  );
}

export default ProfitSummary;
