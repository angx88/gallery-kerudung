const STATUS_STYLES = {
  Proses: {
    background: "linear-gradient(135deg,#fde68a,#fbbf24)",
    color: "#92400e",
  },
  "Dikirim Sebagian": {
    background: "linear-gradient(135deg,#fed7aa,#fb923c)",
    color: "#9a3412",
  },
  Selesai: {
    background: "linear-gradient(135deg,#bfdbfe,#60a5fa)",
    color: "#1e3a8a",
  },
  Lunas: {
    background: "linear-gradient(135deg,#bbf7d0,#34d399)",
    color: "#064e3b",
  },
}

const STATUS_ICON = {
  Proses: "⏳",
  "Dikirim Sebagian": "📦",
  Selesai: "🚚",
  Lunas: "✅",
}

export default function StatusBadge({ status }) {
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-bold inline-flex items-center gap-1"
      style={
        STATUS_STYLES[status] || {
          background: "#f1f5f9",
          color: "#64748b",
        }
      }
    >
      {STATUS_ICON[status]} {status}
    </span>
  )
}