export default function Card({ children, className = "", style = {} }) {
  return (
    <div
      className={`shadow-sm ${className}`}
      style={{
        borderRadius: 24,
        background: "#fff",
        ...style,
      }}
    >
      {children}
    </div>
  )
}