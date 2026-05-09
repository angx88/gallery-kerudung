export const rupiah = (angka = 0) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(Number(angka || 0))
}

export const parseMoney = (value) => {
  if (!value) return 0

  return Number(
    String(value).replace(/[^\d]/g, "")
  )
}

export const todayStr = () => {
  return new Date().toISOString().split("T")[0]
}

export const capitalizeWords = (text = "") => {
  return text.replace(/\b\w/g, (c) => c.toUpperCase())
}

export const normalizeName = (text = "") => {
  return text.trim().toLowerCase()
}

export const generateInvoiceNumber = () => {
  return `INV-${Date.now()}`
}

export const generateOrderNumber = () => {
  return `ORD-${Math.floor(
    10000 + Math.random() * 90000
  )}`
}