export default function Button({ children, className = "", style = {}, ...props }) {
  return (
    <button
      {...props}
      style={{
        borderRadius: 16,
        fontWeight: 700,
        letterSpacing: 0.2,
        ...style,
      }}
      className={`px-4 py-3 text-white transition-all active:scale-95 shadow-sm ${className}`}
    >
      {children}
    </button>
  )
}