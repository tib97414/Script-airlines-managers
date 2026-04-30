import React from "react";

// Badge de pool pour identifier la catégorie d\u2019un avion.
const POOL_BADGE_STYLE = {
  repack: { bg: "#fff3cd", color: "#856404" },
  "repack-final": { bg: "#fde8d0", color: "#c0392b" },
  groupe: { bg: "#f3e5f5", color: "#6f42c1" },
  ultime: { bg: "#fce4ec", color: "#ad1457" },
  résiduel: { bg: "#d1fae5", color: "#065f46" },
  exclusif: { bg: "#fdf4ff", color: "#7e22ce" },
};

function PoolBadge({ pool }) {
  if (!pool || pool === "—") return null;
  const s = POOL_BADGE_STYLE[pool] || { bg: "#e8f4ff", color: "#0d6efd" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        borderRadius: 3,
        padding: "1px 5px",
        fontSize: 11,
        marginLeft: 6,
        fontWeight: "bold",
      }}
    >
      {pool}
    </span>
  );
}

export { POOL_BADGE_STYLE };
export default PoolBadge;
