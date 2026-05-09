import { rupiah, parseMoney } from "../utils/helpers"

export default function Input({ label, value, onChange, placeholder, type = "text" }) {
  const isMoney = type === "money"

  return (
    <div className="space-y-1">
      <label className="text-xs font-bold" style={{ color: "#a855f7" }}>
        {label}
      </label>

      <input
        className="w-full px-4 py-3 outline-none text-sm"
        style={{
          borderRadius: 14,
          border: "1.5px solid #f9a8d4",
          background: "#fdf2f8",
          color: "#2d1b69",
        }}
        value={isMoney ? rupiah(value || 0) : value}
        placeholder={placeholder}
        type={isMoney ? "text" : type}
        onChange={(e) =>
          onChange(isMoney ? parseMoney(e.target.value) : e.target.value)
        }
      />
    </div>
  )
}