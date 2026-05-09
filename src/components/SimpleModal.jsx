import { motion } from "framer-motion"

export default function SimpleModal({ title, children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{
        background: "rgba(168,85,247,0.15)",
        backdropFilter: "blur(2px)",
      }}
    >
      <motion.div
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        className="max-h-[92vh] w-full overflow-auto p-5"
        style={{
          background: "white",
          borderRadius: "32px 32px 0 0",
          borderTop: "3px solid #f9a8d4",
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold" style={{ color: "#ec4899" }}>
            ✨ {title}
          </h2>

          <button
            onClick={onClose}
            className="rounded-2xl px-4 py-2 text-sm font-semibold"
            style={{
              background: "#fdf2f8",
              color: "#ec4899",
            }}
          >
            Tutup
          </button>
        </div>

        {children}
      </motion.div>
    </div>
  )
}