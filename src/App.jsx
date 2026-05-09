import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "./firebase";
import {
  collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
import "./App.css";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";

const auth = getAuth();
const provider = new GoogleAuthProvider();
const ALLOWED_EMAILS = ["angx89@gmail.com", "astriapriani.aa@gmail.com"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function rupiah(num) {
  return `Rp ${Number(num || 0).toLocaleString("id-ID")}`;
}

function parseMoney(value) {
  return Number(String(value).replace(/\D/g, "")) || 0;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function getDateValue(text) {
  if (!text) return new Date();
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function samePeriod(dateStr, period) {
  const now = new Date();
  const d = getDateValue(dateStr);
  if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year") return d.getFullYear() === now.getFullYear();
  return true;
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

function capitalizeWords(name) {
  return (name || "").trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function generateInvoice() {
  const ts = Date.now().toString().slice(-5);
  const rand = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return `ORD-${ts}${rand}`;
}


function emptyOrderItem() {
  return { name: "", qty: "", price: 0 };
}

function normalizeOrderItems(order) {
  const rawItems = Array.isArray(order?.items) && order.items.length > 0
    ? order.items
    : [{ name: order?.item || "Pesanan Kerudung", qty: order?.qty || 0, price: order?.hargaPcs || 0 }];

  return rawItems.map((it) => ({
    name: it.name || it.item || "Pesanan Kerudung",
    qty: Number(it.qty || 0),
    price: Number(it.price || it.hargaPcs || 0),
  }));
}

function orderItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.price || 0), 0);
}

function orderItemsSummary(order) {
  const items = normalizeOrderItems(order);
  if (items.length === 0) return "Pesanan Kerudung";
  if (items.length === 1) return `${items[0].name} · ${items[0].qty} pcs`;
  return `${items.length} produk · ${items.reduce((s, it) => s + Number(it.qty || 0), 0)} pcs`;
}

// ─── UI Primitives ───────────────────────────────────────────────────────────

function Input({ label, value, onChange, placeholder, type = "text" }) {
  const isMoney = type === "money";
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold" style={{ color: "#a855f7" }}>{label}</label>
      <input
        className="w-full px-4 py-3 outline-none text-sm"
        style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }}
        value={isMoney ? rupiah(value || 0) : value}
        placeholder={placeholder}
        type={isMoney ? "text" : type}
        onChange={(e) => onChange(isMoney ? parseMoney(e.target.value) : e.target.value)}
      />
    </div>
  );
}

function Select({ label, value, onChange, children }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <select
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-400 bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

// ─── DatePicker ──────────────────────────────────────────────────────────────
const BULAN_FULL = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];

function DatePicker({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("day");
  const today = new Date();
  const parsed = value ? new Date(value + "T00:00:00") : today;
  const [cursor, setCursor] = useState({ year: parsed.getFullYear(), month: parsed.getMonth() });

  function selectDay(day) {
    const y = cursor.year;
    const m = String(cursor.month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setOpen(false);
    setView("day");
  }

  function selectMonth(m) { setCursor({ ...cursor, month: m }); setView("day"); }
  function selectYear(y) { setCursor({ ...cursor, year: y }); setView("month"); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function firstDayOfMonth(y, m) { return new Date(y, m, 1).getDay(); }

  const displayValue = value
    ? (() => {
        const d = new Date(value + "T00:00:00");
        return `${d.getDate()} ${BULAN_FULL[d.getMonth()]} ${d.getFullYear()}`;
      })()
    : "Pilih tanggal";

  const yearRange = [];
  for (let y = today.getFullYear() - 5; y <= today.getFullYear() + 2; y++) yearRange.push(y);

  const totalDays = daysInMonth(cursor.year, cursor.month);
  const firstDay = firstDayOfMonth(cursor.year, cursor.month);
  const selectedDay = value && new Date(value + "T00:00:00").getMonth() === cursor.month
    && new Date(value + "T00:00:00").getFullYear() === cursor.year
    ? new Date(value + "T00:00:00").getDate() : null;

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <button type="button" onClick={() => { setOpen(!open); setView("day"); }}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-left outline-none focus:border-pink-400 bg-white flex items-center justify-between">
        <span className={value ? "text-slate-800" : "text-slate-400"}>{displayValue}</span>
        <span className="text-lg">📅</span>
      </button>

      {open && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-3 mt-1 z-50 relative">
          <div className="flex items-center justify-between mb-3">
            {view === "day" && (
              <button type="button"
                onClick={() => setCursor({ ...cursor, month: cursor.month === 0 ? 11 : cursor.month - 1, year: cursor.month === 0 ? cursor.year - 1 : cursor.year })}
                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">‹</button>
            )}
            {view !== "day" && <div />}
            <div className="flex gap-2">
              <button type="button" onClick={() => setView(view === "month" ? "day" : "month")}
                className="rounded-xl bg-pink-50 text-pink-700 font-semibold px-3 py-1 text-sm">
                {BULAN_FULL[cursor.month]}
              </button>
              <button type="button" onClick={() => setView(view === "year" ? "day" : "year")}
                className="rounded-xl bg-pink-50 text-pink-700 font-semibold px-3 py-1 text-sm">
                {cursor.year}
              </button>
            </div>
            {view === "day" && (
              <button type="button"
                onClick={() => setCursor({ ...cursor, month: cursor.month === 11 ? 0 : cursor.month + 1, year: cursor.month === 11 ? cursor.year + 1 : cursor.year })}
                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">›</button>
            )}
            {view !== "day" && <div />}
          </div>

          {view === "year" && (
            <div className="grid grid-cols-4 gap-2">
              {yearRange.map((y) => (
                <button key={y} type="button" onClick={() => selectYear(y)}
                  className={`rounded-xl py-2 text-sm font-semibold transition-all ${y === cursor.year ? "bg-pink-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-pink-50"}`}>
                  {y}
                </button>
              ))}
            </div>
          )}

          {view === "month" && (
            <div className="grid grid-cols-3 gap-2">
              {BULAN_FULL.map((b, i) => (
                <button key={i} type="button" onClick={() => selectMonth(i)}
                  className={`rounded-xl py-2 text-sm font-semibold transition-all ${i === cursor.month ? "bg-pink-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-pink-50"}`}>
                  {b}
                </button>
              ))}
            </div>
          )}

          {view === "day" && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {HARI.map((h) => (
                  <div key={h} className="text-center text-xs font-semibold text-slate-400 py-1">{h}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1">
                {Array(firstDay).fill(null).map((_, i) => <div key={`e-${i}`} />)}
                {Array(totalDays).fill(null).map((_, i) => {
                  const day = i + 1;
                  const isToday = today.getDate() === day && today.getMonth() === cursor.month && today.getFullYear() === cursor.year;
                  const isSelected = selectedDay === day;
                  return (
                    <button key={day} type="button" onClick={() => selectDay(day)}
                      className={`mx-auto w-9 h-9 rounded-full text-sm font-medium transition-all flex items-center justify-center ${isSelected ? "bg-pink-600 text-white" : isToday ? "border-2 border-pink-400 text-pink-600 font-bold" : "text-slate-700 hover:bg-pink-50"}`}>
                      {day}
                    </button>
                  );
                })}
              </div>
              <button type="button"
                onClick={() => { setCursor({ year: today.getFullYear(), month: today.getMonth() }); selectDay(today.getDate()); }}
                className="mt-3 w-full rounded-xl bg-slate-100 text-slate-600 font-semibold py-2 text-sm">
                Hari Ini
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Button({ children, className = "", style = {}, ...props }) {
  return (
    <button {...props} style={{ borderRadius: 16, fontWeight: 700, letterSpacing: 0.2, ...style }}
      className={`px-4 py-3 text-white transition-all active:scale-95 shadow-sm ${className}`}>
      {children}
    </button>
  );
}

function Card({ title, value, note, bg, icon }) {
  return (
    <div className={`rounded-3xl p-4 shadow-sm ${bg}`} style={{ border: "1px solid rgba(236,72,153,0.1)" }}>
      <div className="flex items-center gap-1 text-sm font-medium" style={{ color: "#9d4edd" }}>{icon} {title}</div>
      <div className="mt-2 text-2xl font-bold" style={{ color: "#2d1b69" }}>{rupiah(value)}</div>
      <div className="mt-1 text-xs" style={{ color: "#c084fc" }}>{note}</div>
    </div>
  );
}

function SimpleModal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(168,85,247,0.15)", backdropFilter: "blur(2px)" }}>
      <motion.div initial={{ y: 80 }} animate={{ y: 0 }}
        className="max-h-[92vh] w-full overflow-auto p-5"
        style={{ background: "white", borderRadius: "32px 32px 0 0", borderTop: "3px solid #f9a8d4" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold" style={{ color: "#ec4899" }}>✨ {title}</h2>
          <button onClick={onClose} className="rounded-2xl px-4 py-2 text-sm font-semibold"
            style={{ background: "#fdf2f8", color: "#ec4899" }}>Tutup</button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function TabBar({ tab, setTab, badgeCount = 0 }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "🏠" },
    { id: "orders", label: "Pesanan", icon: "🧕" },
    { id: "purchases", label: "Supplier", icon: "🛍️" },
    { id: "expenses", label: "Pengeluaran", icon: "💸" },
    { id: "rekap", label: "Rekap", icon: "📊" },
  ];
  return (
    <div className="sticky top-0 z-40 flex bg-white shadow-sm" style={{ borderBottom: "2px solid #fce7f3" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)}
          className="flex-1 py-3 text-xs font-semibold flex flex-col items-center gap-1 transition-all"
          style={{
            color: tab === t.id ? "#ec4899" : "#94a3b8",
            borderBottom: tab === t.id ? "3px solid #ec4899" : "3px solid transparent",
            background: tab === t.id ? "#fdf2f8" : "white",
          }}>
          <span className="relative text-lg">
            {t.icon}
            {t.id === "orders" && badgeCount > 0 && (
              <span className="absolute -top-1 -right-2 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold"
                style={{ fontSize: 9, background: "linear-gradient(135deg,#ec4899,#a855f7)" }}>
                {badgeCount}
              </span>
            )}
          </span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_STYLES = {
  Proses:  { background: "linear-gradient(135deg,#fde68a,#fbbf24)", color: "#92400e" },
  Selesai: { background: "linear-gradient(135deg,#bfdbfe,#60a5fa)", color: "#1e3a8a" },
  Lunas:   { background: "linear-gradient(135deg,#bbf7d0,#34d399)", color: "#064e3b" },
};
const STATUS_ICON = { Proses: "⏳", Selesai: "🚚", Lunas: "✅" };

function StatusBadge({ status }) {
  return (
    <span className="rounded-full px-3 py-1 text-xs font-bold inline-flex items-center gap-1"
      style={STATUS_STYLES[status] || { background: "#f1f5f9", color: "#64748b" }}>
      {STATUS_ICON[status]} {status}
    </span>
  );
}

// ─── Invoice Modal (per customer: semua pesanan, rincian lengkap) ─────────────
function InvoiceModal({ customerName, orders, onClose }) {
  const canvasRef = React.useRef(null);
  const [imgUrl, setImgUrl] = React.useState(null);
  const [invoiceAction, setInvoiceAction] = React.useState(null);

  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  const customerOrders = orders
    .filter(o => normalizeName(o.customer) === normalizeName(customerName))
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const totalTagihan = customerOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalBayar = customerOrders.reduce((s, o) =>
    s + (o.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0);
  const totalSisa = totalTagihan - totalBayar;


  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 340;

    // Calculate height dynamically
    let estimatedH = 200; // header + title
    customerOrders.forEach(o => {
      estimatedH += 60; // order header
      estimatedH += normalizeOrderItems(o).length * 42; // products
      estimatedH += 24; // divider
      const payments = o.payments || [];
      estimatedH += payments.length > 0 ? 28 + payments.length * 26 : 0;
      estimatedH += 40; // sisa per order
    });
    estimatedH += 100; // summary + footer

    canvas.width = W;
    canvas.height = estimatedH;

    // Background
    ctx.fillStyle = "#fff9fc";
    ctx.fillRect(0, 0, W, estimatedH);
    ctx.fillStyle = "#fce7f3";
    ctx.fillRect(0, 0, 6, estimatedH);
    ctx.fillRect(W - 6, 0, 6, estimatedH);

    // Header gradient
    const grad = ctx.createLinearGradient(0, 0, W, 110);
    grad.addColorStop(0, "#ec4899");
    grad.addColorStop(1, "#a855f7");
    ctx.fillStyle = grad;
    ctx.fillRect(6, 0, W - 12, 110);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Gallery Kerudung", W / 2, 36);
    ctx.font = "12px Arial";
    ctx.fillText("✨ made by order ✨", W / 2, 56);
    ctx.fillText("📱 087822864625", W / 2, 76);
    ctx.font = "11px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText("💕 Gallery Kerudung 💕", W / 2, 98);

    // Scallop edge
    ctx.fillStyle = "#fff9fc";
    for (let x = 6; x < W - 6; x += 14) {
      ctx.beginPath();
      ctx.arc(x + 7, 110, 7, 0, Math.PI);
      ctx.fill();
    }

    // Invoice title
    ctx.fillStyle = "#ec4899";
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "center";
    ctx.fillText("─── RINCIAN PESANAN ───", W / 2, 142);

    // Customer info
    ctx.fillStyle = "#a855f7";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Customer:", 20, 168);
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 15px Arial";
    ctx.fillText(customerName, 20, 186);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`Dicetak: ${today}`, W - 20, 168);
    ctx.fillText(`${customerOrders.length} pesanan`, W - 20, 186);

    let curY = 210;

    const drawLine = (dashed = false) => {
      ctx.strokeStyle = "#fce7f3";
      ctx.lineWidth = 1;
      if (dashed) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(20, curY);
      ctx.lineTo(W - 20, curY);
      ctx.stroke();
      ctx.setLineDash([]);
      curY += 12;
    };

    const drawRow = (label, val, labelColor = "#9d4edd", valColor = "#1e293b", bold = false, fontSize = 11) => {
      ctx.fillStyle = labelColor;
      ctx.font = `${bold ? "bold " : ""}${fontSize}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(label, 20, curY);
      ctx.fillStyle = valColor;
      ctx.font = `${bold ? "bold " : ""}${fontSize}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(val, W - 20, curY);
      curY += 22;
    };

    // Each order
    customerOrders.forEach((o, idx) => {
      // Order header box
      const boxY = curY - 4;
      ctx.fillStyle = idx % 2 === 0 ? "#fdf2f8" : "#f5f3ff";
      ctx.fillRect(14, boxY, W - 28, 24);

      ctx.fillStyle = "#ec4899";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`#${idx + 1} ${o.invoice || "-"}`, 20, curY + 12);
      ctx.fillStyle = "#a855f7";
      ctx.textAlign = "right";
      ctx.fillText(o.createdAt || "-", W - 20, curY + 12);
      curY += 28;

      const invoiceItems = normalizeOrderItems(o);
      ctx.fillStyle = "#a855f7";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Rincian Produk:", 20, curY);
      curY += 16;
      invoiceItems.forEach((it) => {
        const subtotal = Number(it.qty || 0) * Number(it.price || 0);
        ctx.fillStyle = "#1e293b";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "left";
        ctx.fillText(it.name || "Produk", 24, curY);
        ctx.fillStyle = "#64748b";
        ctx.font = "10px Arial";
        ctx.textAlign = "right";
        ctx.fillText(`${it.qty || 0} x Rp ${Number(it.price || 0).toLocaleString("id-ID")}`, W - 20, curY);
        curY += 16;
        ctx.fillStyle = "#ec4899";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "right";
        ctx.fillText(`Subtotal Rp ${subtotal.toLocaleString("id-ID")}`, W - 20, curY);
        curY += 18;
      });
      drawRow("Total Pesanan", `Rp ${Number(o.total || 0).toLocaleString("id-ID")}`, "#64748b", "#1e293b", true);

      // Status badge inline
      const statusColors = { Proses: "#f59e0b", Selesai: "#3b82f6", Lunas: "#10b981" };
      const sc = statusColors[o.status] || "#94a3b8";
      ctx.fillStyle = sc;
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`● ${o.status || "Proses"}`, 20, curY);
      curY += 18;

      // Payments
      const payments = o.payments || [];
      if (payments.length > 0) {
        ctx.fillStyle = "#a855f7";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "left";
        ctx.fillText("Riwayat Pembayaran:", 20, curY);
        curY += 18;
        payments.forEach(p => {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "10px Arial";
          ctx.textAlign = "left";
          ctx.fillText(`  ${p.date}  ${p.note || ""}`, 20, curY);
          ctx.fillStyle = "#059669";
          ctx.font = "bold 10px Arial";
          ctx.textAlign = "right";
          ctx.fillText(`+ Rp ${Number(p.amount || 0).toLocaleString("id-ID")}`, W - 20, curY);
          curY += 20;
        });
      } else {
        ctx.fillStyle = "#fca5a5";
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.fillText("Belum ada pembayaran", 20, curY);
        curY += 18;
      }

      // Sisa per order
      const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const sisa = Number(o.total || 0) - paid;
      ctx.fillStyle = sisa > 0 ? "#fee2e2" : "#dcfce7";
      ctx.fillRect(14, curY, W - 28, 22);
      ctx.fillStyle = sisa > 0 ? "#e11d48" : "#059669";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Sisa:", 20, curY + 15);
      ctx.textAlign = "right";
      ctx.fillText(`Rp ${sisa.toLocaleString("id-ID")}`, W - 20, curY + 15);
      curY += 30;

      drawLine(true);
    });

    // Summary box
    curY += 6;
    ctx.fillStyle = "#ede9fe";
    ctx.fillRect(14, curY, W - 28, 90);

    ctx.fillStyle = "#7c3aed";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("RINGKASAN", W / 2, curY + 18);

    ctx.fillStyle = "#6d28d9";
    ctx.font = "11px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Total Tagihan", 24, curY + 38);
    ctx.textAlign = "right";
    ctx.fillText(`Rp ${totalTagihan.toLocaleString("id-ID")}`, W - 24, curY + 38);

    ctx.fillStyle = "#059669";
    ctx.font = "11px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Total Dibayar", 24, curY + 56);
    ctx.textAlign = "right";
    ctx.fillText(`Rp ${totalBayar.toLocaleString("id-ID")}`, W - 24, curY + 56);

    ctx.fillStyle = totalSisa > 0 ? "#e11d48" : "#059669";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Sisa Tagihan", 24, curY + 78);
    ctx.textAlign = "right";
    ctx.fillText(`Rp ${totalSisa.toLocaleString("id-ID")}`, W - 24, curY + 78);

    curY += 100;

    // Footer scallop + gradient
    ctx.fillStyle = "#fce7f3";
    for (let x = 6; x < W - 6; x += 14) {
      ctx.beginPath();
      ctx.arc(x + 7, curY, 7, Math.PI, 0);
      ctx.fill();
    }
    const footGrad = ctx.createLinearGradient(0, curY, W, curY + 46);
    footGrad.addColorStop(0, "#ec4899");
    footGrad.addColorStop(1, "#a855f7");
    ctx.fillStyle = footGrad;
    ctx.fillRect(6, curY + 4, W - 12, 46);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Terima kasih sudah berbelanja! 💕", W / 2, curY + 30);

    setImgUrl(canvas.toDataURL("image/png"));
  }, [customerName]);

  function downloadGambar() {
    if (!imgUrl) return;
    const safeName = customerName.replace(/\s+/g, "-").toLowerCase();
    const link = document.createElement("a");
    link.download = `invoice-${safeName}.png`;
    link.href = imgUrl;
    link.click();
  }

  async function shareGambar() {
    if (!imgUrl) return;
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      const safeName = customerName.replace(/\s+/g, "-").toLowerCase();
      const file = new File([blob], `invoice-${safeName}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Invoice ${customerName} - Gallery Kerudung`,
          text: `Rincian pesanan ${customerName} dari Gallery Kerudung 💕`,
        });
      } else {
        const link = document.createElement("a");
        link.download = `invoice-${safeName}.png`;
        link.href = imgUrl;
        link.click();
        setTimeout(() => alert("Gambar tersimpan. Silakan bagikan ke WhatsApp dari galeri."), 500);
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        const link = document.createElement("a");
        link.download = `invoice-${customerName}.png`;
        link.href = imgUrl;
        link.click();
      }
    }
  }


  return (
    <SimpleModal title={`Invoice — ${customerName}`} onClose={onClose}>
      <canvas ref={canvasRef} className="hidden" />
      {!imgUrl && (
        <div className="flex items-center justify-center py-10 gap-3">
          <div className="w-5 h-5 border-2 border-pink-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500">Membuat invoice...</span>
        </div>
      )}
      {imgUrl && (
        <div className="space-y-3">
          <img src={imgUrl} alt="invoice" className="w-full rounded-2xl border border-slate-100" />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setInvoiceAction("download")} className="w-full"
              style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>
              ⬇️ Download
            </Button>
            <Button onClick={() => setInvoiceAction("share")} className="w-full"
              style={{ background: "linear-gradient(135deg,#10b981,#25d366)" }}>
              📤 Kirim WA
            </Button>
          </div>
        </div>
      )}

      {invoiceAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-slate-800 mb-2">
              {invoiceAction === "download" ? "Download Invoice?" : "Kirim Invoice ke WhatsApp?"}
            </div>
            <div className="text-slate-500 text-sm mb-5">
              Invoice atas nama <strong>{customerName}</strong> akan {invoiceAction === "download" ? "diunduh sebagai gambar." : "dibagikan lewat menu share/WhatsApp."}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setInvoiceAction(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
              <button
                onClick={() => {
                  const action = invoiceAction;
                  setInvoiceAction(null);
                  if (action === "download") downloadGambar();
                  else shareGambar();
                }}
                className="flex-1 rounded-2xl py-3 font-semibold text-white"
                style={{ background: invoiceAction === "download" ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "linear-gradient(135deg,#10b981,#25d366)" }}
              >
                Ya, lanjut
              </button>
            </div>
          </div>
        </div>
      )}
    </SimpleModal>
  );
}

// ─── Grafik Kas ──────────────────────────────────────────────────────────────
function GrafikKas({ orders, purchases, expenses }) {
  const BLN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const data = useMemo(() => {
    const map = {};
    const getKey = (d) => {
      if (!d) return todayStr().slice(0, 7);
      const raw = d.includes("T") ? d : d + "T00:00:00";
      const date = new Date(raw);
      const safeDate = isNaN(date.getTime()) ? new Date() : date;
      return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}`;
    };
    orders.forEach((o) => {
      (o.payments || []).forEach((p) => {
        const k = getKey(p.date);
        if (!map[k]) map[k] = { bulan: k, masuk: 0, keluar: 0 };
        map[k].masuk += Number(p.amount || 0);
      });
    });
    purchases.forEach((p) => {
      (p.payments || []).forEach((x) => {
        const k = getKey(x.date);
        if (!map[k]) map[k] = { bulan: k, masuk: 0, keluar: 0 };
        map[k].keluar += Number(x.amount || 0);
      });
    });
    expenses.forEach((e) => {
      const k = getKey(e.date);
      if (!map[k]) map[k] = { bulan: k, masuk: 0, keluar: 0 };
      map[k].keluar += Number(e.amount || 0);
    });
    return Object.values(map).sort((a, b) => a.bulan.localeCompare(b.bulan)).slice(-6);
  }, [orders, purchases, expenses]);

  if (data.length === 0) return null;

  const maxVal = Math.max(...data.flatMap((d) => [d.masuk, d.keluar]), 1);
  const H = 130;
  const fmt = (n) => n >= 1000000 ? (n/1000000).toFixed(1)+"jt" : n >= 1000 ? (n/1000).toFixed(0)+"rb" : n;

  return (
    <div className="mx-4 mb-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-slate-700">Kas Masuk vs Keluar</div>
        <div className="flex gap-3">
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500"/><span className="text-xs text-slate-400">Masuk</span></div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-rose-400"/><span className="text-xs text-slate-400">Keluar</span></div>
        </div>
      </div>
      <div className="text-xs text-slate-400 mb-5">6 bulan terakhir</div>
      <div className="flex items-end gap-1.5 justify-between" style={{ height: H + 32 }}>
        {data.map((d) => {
          const hMasuk = Math.max(Math.round((d.masuk / maxVal) * H), d.masuk > 0 ? 4 : 0);
          const hKeluar = Math.max(Math.round((d.keluar / maxVal) * H), d.keluar > 0 ? 4 : 0);
          const bulanIdx = parseInt(d.bulan.slice(5)) - 1;
          const label = BLN[bulanIdx] || d.bulan.slice(5);
          const isMax = d.masuk === Math.max(...data.map(x => x.masuk));
          return (
            <div key={d.bulan} className="flex flex-col items-center flex-1 gap-1">
              <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: H }}>
                <div className="flex flex-col items-center gap-0.5" style={{ height: H, justifyContent: "flex-end" }}>
                  {d.masuk > 0 && <div className="text-xs font-semibold text-emerald-600" style={{ fontSize: 9 }}>{fmt(d.masuk)}</div>}
                  <div style={{ height: hMasuk || 2, width: 14, background: isMax ? "linear-gradient(to top, #059669, #34d399)" : "#6ee7b7", borderRadius: "4px 4px 2px 2px" }} />
                </div>
                <div className="flex flex-col items-center gap-0.5" style={{ height: H, justifyContent: "flex-end" }}>
                  {d.keluar > 0 && <div className="text-xs font-semibold text-rose-500" style={{ fontSize: 9 }}>{fmt(d.keluar)}</div>}
                  <div style={{ height: hKeluar || 2, width: 14, background: "#fca5a5", borderRadius: "4px 4px 2px 2px" }} />
                </div>
              </div>
              <div className="text-xs text-slate-400 font-medium">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GrafikPesanan({ orders }) {
  const BLN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const data = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const raw = o.createdAt || todayStr();
      const date = new Date(raw.includes("T") ? raw : raw + "T00:00:00");
      const safeDate = isNaN(date.getTime()) ? new Date() : date;
      const k = `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}`;
      if (!map[k]) map[k] = { bulan: k, jumlah: 0, nilai: 0 };
      map[k].jumlah += 1;
      map[k].nilai += Number(o.total || 0);
    });
    return Object.values(map).sort((a, b) => a.bulan.localeCompare(b.bulan)).slice(-6);
  }, [orders]);

  if (data.length === 0) return null;

  const maxJumlah = Math.max(...data.map((d) => d.jumlah), 1);
  const H = 130;
  const BAR_W = Math.min(36, Math.floor(280 / data.length) - 8);

  return (
    <div className="mx-4 mb-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-slate-700">Pesanan per Bulan</div>
        <div className="text-xs text-slate-400 bg-pink-50 text-pink-600 font-semibold px-2 py-1 rounded-full">
          Total {orders.length} pesanan
        </div>
      </div>
      <div className="text-xs text-slate-400 mb-5">6 bulan terakhir</div>
      <div className="flex items-end justify-around" style={{ height: H + 52, gap: 4 }}>
        {data.map((d) => {
          const hBar = Math.max(Math.round((d.jumlah / maxJumlah) * H), 4);
          const bulanIdx = parseInt(d.bulan.slice(5)) - 1;
          const label = BLN[bulanIdx] || d.bulan.slice(5);
          const isMax = d.jumlah === maxJumlah;
          const nilaiStr = d.nilai >= 1000000 ? (d.nilai/1000000).toFixed(1)+"jt" : (d.nilai/1000).toFixed(0)+"rb";
          return (
            <div key={d.bulan} className="flex flex-col items-center gap-1" style={{ minWidth: BAR_W }}>
              <div className="text-xs font-bold text-pink-600">{d.jumlah}</div>
              <div style={{
                height: hBar, width: BAR_W,
                background: isMax ? "linear-gradient(to top, #be185d, #f472b6)" : "linear-gradient(to top, #f9a8d4, #fce7f3)",
                borderRadius: "8px 8px 4px 4px", transition: "height 0.3s ease",
                boxShadow: isMax ? "0 4px 12px rgba(236,72,153,0.3)" : "none",
              }} />
              <div className="text-xs font-semibold text-slate-500">{label}</div>
              <div className="text-xs text-slate-400" style={{ fontSize: 9 }}>{nilaiStr}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && ALLOWED_EMAILS.includes(u.email)) { setUser(u); setAuthError(""); }
      else if (u) { signOut(auth); setAuthError("Email " + u.email + " tidak diizinkan."); setUser(null); }
      else setUser(null);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  async function handleLogin() {
    try { setAuthError(""); await signInWithPopup(auth, provider); }
    catch (e) { setAuthError("Login gagal: " + e.message); }
  }

  async function handleLogout() { await signOut(auth); }

  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [orders, setOrders] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [editData, setEditData] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filterOrder, setFilterOrder] = useState("semua");
  const [sortOrder, setSortOrder] = useState("terbaru");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [rekapConfirm, setRekapConfirm] = useState(null);
  const [kirimModal, setKirimModal] = useState(null);
  const [tanggalKirim, setTanggalKirim] = useState(todayStr());
  // Invoice per customer
  const [invoiceCustomer, setInvoiceCustomer] = useState(null);

  const [orderForm, setOrderForm] = useState({
    date: todayStr(),
    customer: "",
    phone: "",
    items: [emptyOrderItem()],
    dp: 0,
  });
  const [purchaseForm, setPurchaseForm] = useState({ date: todayStr(), supplier: "", material: "", qty: "", total: 0, dp: 0 });
  const [expenseForm, setExpenseForm] = useState({ date: todayStr(), category: "", note: "", amount: 0 });
  const [orderPayForm, setOrderPayForm] = useState({ customer: "", date: todayStr(), note: "", amount: 0 });
  const [supplierPayForm, setSupplierPayForm] = useState({ purchaseId: "", date: todayStr(), note: "", amount: 0 });

  const loadedRef = useRef({ orders: false, purchases: false, expenses: false });

  useEffect(() => {
    if (!user) {
      setOrders([]); setPurchases([]); setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadedRef.current = { orders: false, purchases: false, expenses: false };

    const checkAllLoaded = () => {
      const r = loadedRef.current;
      if (r.orders && r.purchases && r.expenses) setLoading(false);
    };

    const unsubOrders = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.orders) { loadedRef.current.orders = true; checkAllLoaded(); }
    }, err => console.error("orders:", err));

    const unsubPurchases = onSnapshot(collection(db, "purchases"), (snap) => {
      setPurchases(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.purchases) { loadedRef.current.purchases = true; checkAllLoaded(); }
    }, err => console.error("purchases:", err));

    const unsubExpenses = onSnapshot(collection(db, "expenses"), (snap) => {
      setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.expenses) { loadedRef.current.expenses = true; checkAllLoaded(); }
    }, err => console.error("expenses:", err));

    return () => { unsubOrders(); unsubPurchases(); unsubExpenses(); };
  }, [user]);

  // ── Helper functions ──
  function sisaOrder(order) {
    const paid = (order.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    return Number(order.total || 0) - paid;
  }

  function sisaPurchase(purchase) {
    const paid = (purchase.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    return Number(purchase.total || 0) - paid;
  }

  // ── Stats ──
  const stats = useMemo(() => {
    const totalOrderValue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const customerPaid = orders.reduce((s, o) => s + (o.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0);
    const receivable = totalOrderValue - customerPaid;
    const supplierTotal = purchases.reduce((s, p) => s + Number(p.total || 0), 0);
    const supplierPaid = purchases.reduce((s, p) => s + (p.payments || []).reduce((a, x) => a + Number(x.amount || 0), 0), 0);
    const supplierDebt = supplierTotal - supplierPaid;
    const otherExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const cashOut = supplierPaid + otherExpense;
    const netCash = customerPaid - cashOut;
    return { customerPaid, cashOut, receivable, supplierDebt, netCash };
  }, [orders, purchases, expenses]);

  const pesananTelat = useMemo(() => {
    const now = new Date();
    return orders.filter((o) => {
      if (o.status === "Lunas") return false;
      const sisa = sisaOrder(o);
      if (sisa <= 0) return false;
      const lastPayStr = (o.payments || []).length > 0
        ? o.payments[o.payments.length - 1].date
        : (o.createdAt || null);
      if (!lastPayStr) return true;
      const lastPayDate = new Date(lastPayStr + "T00:00:00");
      if (isNaN(lastPayDate.getTime())) return true;
      const diffDays = Math.floor((now - lastPayDate) / (1000 * 60 * 60 * 24));
      return diffDays >= 7;
    });
  }, [orders]);

  const uniqueCustomers = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const name = capitalizeWords(o.customer || "");
      const key = normalizeName(name);
      if (!key) return;
      if (!map[key]) map[key] = { name, totalSisa: 0, totalPesanan: 0, pesananAktif: 0 };
      map[key].totalPesanan += 1;
      const paid = (o.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      const sisa = Number(o.total || 0) - paid;
      if (sisa > 0) { map[key].totalSisa += sisa; map[key].pesananAktif += 1; }
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  // ── Search filter ──
  const q = search.toLowerCase();
  const filteredOrders = useMemo(() => orders.filter((o) => {
    const itemText = normalizeOrderItems(o).map((it) => it.name).join(" ").toLowerCase();
    return !q || o.customer?.toLowerCase().includes(q) || o.invoice?.toLowerCase().includes(q) || itemText.includes(q);
  }), [orders, q]);

  const filteredPurchases = useMemo(() => purchases.filter(
    (p) => !q || p.supplier?.toLowerCase().includes(q) || p.material?.toLowerCase().includes(q)
  ), [purchases, q]);

  const filteredExpenses = useMemo(() => expenses.filter(
    (e) => !q || e.category?.toLowerCase().includes(q) || e.note?.toLowerCase().includes(q)
  ), [expenses, q]);

  // ── CRUD ──
  async function addOrder() {
    if (!orderForm.customer.trim()) return alert("Nama customer wajib diisi");

    const cleanItems = (orderForm.items || [])
      .map((it) => ({
        name: (it.name || "").trim(),
        qty: Number(it.qty || 0),
        price: Number(it.price || 0),
      }))
      .filter((it) => it.name && it.qty > 0 && it.price >= 0);

    if (cleanItems.length === 0) return alert("Minimal isi 1 produk dengan nama dan jumlah pcs.");
    if (cleanItems.some((it) => it.qty < 0)) return alert("Jumlah pcs tidak boleh negatif");

    const total = orderItemsTotal(cleanItems);
    if (!total) return alert("Total pesanan wajib diisi");

    setIsSaving(true);
    try {
      const dp = Number(orderForm.dp || 0);
      const firstItem = cleanItems[0] || {};
      const newOrder = {
        invoice: generateInvoice(),
        customer: capitalizeWords(orderForm.customer),
        phone: orderForm.phone || "",
        items: cleanItems,
        // field lama tetap disimpan supaya data lama / kode lama tetap aman
        item: firstItem.name || "Pesanan Kerudung",
        qty: cleanItems.reduce((s, it) => s + Number(it.qty || 0), 0),
        hargaPcs: Number(firstItem.price || 0),
        total,
        status: "Proses",
        createdAt: orderForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Awal", amount: dp }] : [],
      };
      await addDoc(collection(db, "orders"), newOrder);
      setOrderForm({ date: todayStr(), customer: "", phone: "", items: [emptyOrderItem()], dp: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addPurchase() {
    if (!purchaseForm.supplier.trim()) return alert("Nama supplier wajib diisi");
    if (!purchaseForm.total) return alert("Total wajib diisi");
    setIsSaving(true);
    try {
      const dp = Number(purchaseForm.dp || 0);
      await addDoc(collection(db, "purchases"), {
        supplier: purchaseForm.supplier.trim(),
        material: purchaseForm.material || "Bahan Baku",
        qty: purchaseForm.qty || "",
        total: Number(purchaseForm.total || 0),
        createdAt: purchaseForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Supplier", amount: dp }] : [],
      });
      setPurchaseForm({ date: todayStr(), supplier: "", material: "", qty: "", total: 0, dp: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addExpense() {
    if (!expenseForm.category.trim()) return alert("Kategori wajib diisi");
    if (!expenseForm.amount) return alert("Nominal wajib diisi");
    setIsSaving(true);
    try {
      await addDoc(collection(db, "expenses"), {
        date: expenseForm.date || todayStr(),
        category: expenseForm.category.trim(),
        note: expenseForm.note || "",
        amount: Number(expenseForm.amount || 0),
      });
      setExpenseForm({ date: todayStr(), category: "", note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addOrderPayment() {
    if (!orderPayForm.customer) return alert("Pilih nama customer terlebih dahulu");
    if (!orderPayForm.amount) return alert("Nominal pembayaran wajib diisi");

    const normQ = normalizeName(orderPayForm.customer);
    const customerOrders = orders
      .filter((o) => normalizeName(o.customer) === normQ && sisaOrder(o) > 0)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    if (customerOrders.length === 0) return alert("Tidak ada pesanan aktif untuk customer ini.");

    setIsSaving(true);
    try {
      let sisa = Number(orderPayForm.amount);
      const date = orderPayForm.date || todayStr();
      const note = orderPayForm.note || "Pembayaran";
      const alokasi = [];

      for (const order of customerOrders) {
        if (sisa <= 0) break;
        const sisaOrder_ = sisaOrder(order);
        const bayar = Math.min(sisa, sisaOrder_);
        sisa -= bayar;

        const newPayment = { date, note, amount: bayar };
        const updatedPayments = [...(order.payments || []), newPayment];
        await updateDoc(doc(db, "orders", order.id), { payments: updatedPayments });
        await cekDanUpdateLunas(order.id, order.total, updatedPayments);
        alokasi.push({ invoice: order.invoice, bayar });
      }

      const info = alokasi.map(a => `${a.invoice}: ${rupiah(a.bayar)}`).join("\n");
      const sisaMsg = sisa > 0 ? `\n\nSisa ${rupiah(sisa)} tidak dialokasikan (semua pesanan sudah lunas).` : "";
      alert(`✅ Pembayaran dialokasikan:\n${info}${sisaMsg}`);

      setOrderPayForm({ customer: "", date: todayStr(), note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addSupplierPayment() {
    if (!supplierPayForm.purchaseId) return alert("Pilih supplier terlebih dahulu");
    if (!supplierPayForm.amount) return alert("Nominal pembayaran wajib diisi");
    const purchase = purchases.find((p) => p.id === supplierPayForm.purchaseId);
    if (!purchase) return;
    setIsSaving(true);
    try {
      const newPayment = {
        date: supplierPayForm.date || todayStr(),
        note: supplierPayForm.note || "Pembayaran Supplier",
        amount: Number(supplierPayForm.amount),
      };
      await updateDoc(doc(db, "purchases", purchase.id), {
        payments: [...(purchase.payments || []), newPayment],
      });
      setSupplierPayForm({ purchaseId: "", date: todayStr(), note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  function deleteItem(type, id) { setConfirmDelete({ type, id }); }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    setConfirmDelete(null);
    try { await deleteDoc(doc(db, type, id)); }
    catch (e) { alert("Gagal menghapus: " + e.message); }
  }

  async function tandaiDikirim() {
    if (!kirimModal) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "orders", kirimModal), {
        status: "Selesai",
        tanggalKirim: tanggalKirim || todayStr(),
      });
      setKirimModal(null);
      setTanggalKirim(todayStr());
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function cekDanUpdateLunas(orderId, total, updatedPayments) {
    const paid = updatedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    if (paid >= Number(total || 0) && Number(total || 0) > 0) {
      try { await updateDoc(doc(db, "orders", orderId), { status: "Lunas" }); }
      catch (e) { /* silent */ }
    }
  }

  async function saveEdit() {
    if (!editData) return;
    setIsSaving(true);
    try {
      const { type, id } = editData;
      let payload = {};

      if (type === "orders") {
        const cleanItems = normalizeOrderItems(editData)
          .map((it) => ({ name: (it.name || "").trim(), qty: Number(it.qty || 0), price: Number(it.price || 0) }))
          .filter((it) => it.name && it.qty > 0);
        const total = orderItemsTotal(cleanItems);
        const firstItem = cleanItems[0] || {};
        payload = {
          customer: capitalizeWords(editData.customer || ""),
          phone: editData.phone || "",
          items: cleanItems,
          item: firstItem.name || "",
          qty: cleanItems.reduce((s, it) => s + Number(it.qty || 0), 0),
          hargaPcs: Number(firstItem.price || 0),
          total,
          status: editData.status || "Proses",
          createdAt: editData.createdAt || todayStr(),
        };
      } else if (type === "purchases") {
        payload = {
          supplier: editData.supplier || "",
          material: editData.material || "",
          qty: editData.qty || "",
          total: Number(editData.total || 0),
          createdAt: editData.createdAt || todayStr(),
        };
      } else if (type === "expenses") {
        payload = {
          category: editData.category || "",
          note: editData.note || "",
          amount: Number(editData.amount || 0),
          date: editData.date || todayStr(),
        };
      }

      await updateDoc(doc(db, type, id), payload);
      setEditData(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  // ── Rekap (Bulanan / Tahunan / Semua) ──
  function buildRows(period) {
    const rows = [];
    orders.forEach((order) => {
      (order.payments || []).forEach((pay) => {
        if (period === "all" || samePeriod(pay.date, period))
          rows.push({ tanggal: pay.date, jenis: "Kas Masuk", nama: order.customer, keterangan: order.invoice, masuk: pay.amount, keluar: 0 });
      });
    });
    purchases.forEach((purchase) => {
      (purchase.payments || []).forEach((pay) => {
        if (period === "all" || samePeriod(pay.date, period))
          rows.push({ tanggal: pay.date, jenis: "Bayar Supplier", nama: purchase.supplier, keterangan: purchase.material, masuk: 0, keluar: pay.amount });
      });
    });
    expenses.forEach((expense) => {
      if (period === "all" || samePeriod(expense.date, period))
        rows.push({ tanggal: expense.date, jenis: "Biaya", nama: expense.category, keterangan: expense.note, masuk: 0, keluar: expense.amount });
    });
    return rows.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
  }

  function buildSupplierRows(period) {
    return purchases
      .filter((purchase) => period === "all" || samePeriod(purchase.createdAt, period))
      .map((purchase) => {
        const sudahDibayar = (purchase.payments || []).reduce((s, x) => s + Number(x.amount || 0), 0);
        const sisaUtang = Number(purchase.total || 0) - sudahDibayar;
        return {
          tanggalBelanja: purchase.createdAt || "",
          supplier: purchase.supplier || "",
          jenisBahan: purchase.material || "",
          banyak: purchase.qty || "",
          totalBelanja: Number(purchase.total || 0),
          sudahDibayar,
          sisaUtang,
        };
      })
      .sort((a, b) => new Date(a.tanggalBelanja || 0) - new Date(b.tanggalBelanja || 0));
  }

  function downloadSupplierRekap(period) {
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[period];
    const rows = buildSupplierRows(period);
    if (rows.length === 0) return alert("Tidak ada data supplier untuk periode ini.");
    const SEP = "\t";
    const totalBelanja = rows.reduce((s, r) => s + Number(r.totalBelanja || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + Number(r.sudahDibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + Number(r.sisaUtang || 0), 0);
    const lines_out = [
      `Gallery Kerudung - Rekap Pembayaran Supplier ${label}`,
      "",
      ["Tanggal Belanja", "Supplier", "Jenis Bahan", "Banyak", "Total Belanja", "Sudah Dibayar", "Sisa Utang"].join(SEP),
      ...rows.map(r => [r.tanggalBelanja, r.supplier, r.jenisBahan, r.banyak, r.totalBelanja, r.sudahDibayar, r.sisaUtang].join(SEP)),
      "",
      ["", "", "", "TOTAL", totalBelanja, totalDibayar, totalSisa].join(SEP),
    ];
    const blob = new Blob(["\uFEFF" + lines_out.join("\n")], { type: "text/tab-separated-values;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rekap-pembayaran-supplier-${label}.tsv`;
    link.click();
  }


  function buildCustomerRows(period) {
    const map = {};
    orders
      .filter((order) => period === "all" || samePeriod(order.createdAt, period))
      .forEach((order) => {
        const key = normalizeName(order.customer || "Tanpa Nama");
        const name = capitalizeWords(order.customer || "Tanpa Nama");
        const total = Number(order.total || 0);
        const paid = (order.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
        const sisa = total - paid;

        if (!map[key]) {
          map[key] = {
            customer: name,
            jumlahPesanan: 0,
            totalTagihan: 0,
            sudahDibayar: 0,
            sisaTagihan: 0,
            invoices: [],
          };
        }

        map[key].jumlahPesanan += 1;
        map[key].totalTagihan += total;
        map[key].sudahDibayar += paid;
        map[key].sisaTagihan += sisa;
        if (order.invoice) map[key].invoices.push(order.invoice);
      });

    return Object.values(map).sort((a, b) => b.totalTagihan - a.totalTagihan);
  }

  function pdfPeriodLabel(period) {
    const now = new Date();
    if (period === "month") return `${BULAN_FULL[now.getMonth()]} ${now.getFullYear()}`;
    if (period === "year") return `Tahun ${now.getFullYear()}`;
    return "Semua Data";
  }

  function addPdfHeader(pdf, title, period) {
    pdf.setFillColor(236, 72, 153);
    pdf.rect(0, 0, 210, 28, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.text("Gallery Kerudung", 14, 12);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text("made by order", 14, 19);
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text(title, 14, 40);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Periode: ${pdfPeriodLabel(period)}`, 14, 47);
    pdf.text(`Dicetak: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`, 14, 53);
  }

  function downloadSupplierRekapPdf(period) {
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[period];
    const rows = buildSupplierRows(period);
    if (rows.length === 0) return alert("Tidak ada data supplier untuk periode ini.");

    const totalBelanja = rows.reduce((s, r) => s + Number(r.totalBelanja || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + Number(r.sudahDibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + Number(r.sisaUtang || 0), 0);

    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Pembayaran Supplier", period);

    autoTable(pdf, {
      startY: 62,
      head: [["Tanggal", "Supplier", "Jenis Bahan", "Banyak", "Total", "Dibayar", "Sisa Utang"]],
      body: rows.map((r) => [
        r.tanggalBelanja || "-",
        r.supplier || "-",
        r.jenisBahan || "-",
        r.banyak || "-",
        rupiah(r.totalBelanja),
        rupiah(r.sudahDibayar),
        rupiah(r.sisaUtang),
      ]),
      foot: [["", "", "", "TOTAL", rupiah(totalBelanja), rupiah(totalDibayar), rupiah(totalSisa)]],
      theme: "grid",
      headStyles: { fillColor: [168, 85, 247], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [253, 242, 248], textColor: [190, 24, 93], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    });

    pdf.save(`rekap-supplier-${label}.pdf`);
  }

  function downloadCustomerRekapPdf(period) {
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[period];
    const rows = buildCustomerRows(period);
    if (rows.length === 0) return alert("Tidak ada data customer untuk periode ini.");

    const totalTagihan = rows.reduce((s, r) => s + Number(r.totalTagihan || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + Number(r.sudahDibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + Number(r.sisaTagihan || 0), 0);

    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Customer", period);

    autoTable(pdf, {
      startY: 62,
      head: [["Customer", "Pesanan", "Invoice", "Total Tagihan", "Dibayar", "Sisa"]],
      body: rows.map((r) => [
        r.customer || "-",
        r.jumlahPesanan,
        r.invoices.slice(0, 4).join(", ") + (r.invoices.length > 4 ? "..." : ""),
        rupiah(r.totalTagihan),
        rupiah(r.sudahDibayar),
        rupiah(r.sisaTagihan),
      ]),
      foot: [["TOTAL", rows.reduce((s, r) => s + Number(r.jumlahPesanan || 0), 0), "", rupiah(totalTagihan), rupiah(totalDibayar), rupiah(totalSisa)]],
      theme: "grid",
      headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [253, 242, 248], textColor: [190, 24, 93], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
    });

    pdf.save(`rekap-customer-${label}.pdf`);
  }

  function downloadExcel(filename, rows, period) {
    const label = { month: "Bulanan", year: "Tahunan", all: "Semua Data" }[period] || "";
    const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const totalMasuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
    const totalKeluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
    const saldo = totalMasuk - totalKeluar;
    const SEP = "\t";
    const lines_out = [
      `Gallery Kerudung - Rekap ${label}`,
      `Dicetak: ${today}\tTotal: ${rows.length} transaksi`,
      "",
      ["Tanggal","Jenis","Nama","Keterangan","Kas Masuk","Kas Keluar"].join(SEP),
      ...rows.map(r => [r.tanggal||"", r.jenis||"", r.nama||"", r.keterangan||"", r.masuk > 0 ? r.masuk : "", r.keluar > 0 ? r.keluar : ""].join(SEP)),
      "",
      ["","","","TOTAL", totalMasuk, totalKeluar].join(SEP),
      ["","","","SALDO BERSIH", saldo, ""].join(SEP),
    ];
    const blob = new Blob(["\uFEFF" + lines_out.join("\n")], { type: "text/tab-separated-values;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename.replace(".xls","").replace(".csv","") + ".tsv";
    link.click();
  }

  function downloadRekap(period) { setRekapConfirm(period); }

  function doDownloadRekap() {
    if (!rekapConfirm) return;
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[rekapConfirm];
    const rows = buildRows(rekapConfirm);
    if (rows.length === 0) { alert("Tidak ada data untuk periode ini."); setRekapConfirm(null); return; }
    downloadExcel(`rekap-gallery-kerudung-${label}.csv`, rows, rekapConfirm);
    setRekapConfirm(null);
  }

  // ══════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════

  if (authLoading) return (
    <div className="flex min-h-screen items-center justify-center bg-pink-50">
      <div className="text-pink-600 text-lg font-semibold">Memuat...</div>
    </div>
  );

  if (!user) return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6"
      style={{ background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #ede9fe 100%)" }}>
      <div className="absolute top-10 left-6 text-3xl opacity-40">✨</div>
      <div className="absolute top-20 right-8 text-2xl opacity-30">💕</div>
      <div className="absolute bottom-20 left-10 text-2xl opacity-30">🌸</div>
      <div className="absolute bottom-10 right-6 text-3xl opacity-40">⭐</div>
      <div className="w-full max-w-sm rounded-3xl bg-white/80 backdrop-blur p-8 shadow-xl text-center"
        style={{ border: "1.5px solid #f9a8d4" }}>
        <div className="mb-2 text-4xl">🧕✨</div>
        <div className="mb-1 text-3xl font-bold"
          style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Gallery Kerudung
        </div>
        <div className="mb-6 text-sm font-medium" style={{ color: "#c084fc" }}>💕 made by order 💕</div>
        {authError && <div className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-500 border border-rose-100">{authError}</div>}
        <button onClick={handleLogin}
          className="flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 font-bold text-white shadow-lg transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)" }}>
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 32.8 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8 12.9 4.8 4 13.7 4 24.8s8.9 20 20 20c11 0 19.5-7.7 19.5-20 0-1.3-.1-2.6-.3-3.8z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.4 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8c-7.5 0-14 4.2-17.7 9.9z"/>
            <path fill="#4CAF50" d="M24 44c4.9 0 9.3-1.8 12.7-4.6l-5.9-4.9C29 36.3 26.6 37 24 37c-5.3 0-9.6-3.2-11.3-7.8L6 34.2C9.7 39.8 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.4-4.6 5.8l5.9 4.9C40.2 35.2 44 30.4 44 24c0-1.3-.1-2.6-.4-4z"/>
          </svg>
          Masuk dengan Google
        </button>
        <p className="mt-4 text-xs" style={{ color: "#c084fc" }}>✨ Hanya akun yang diizinkan ✨</p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-md" style={{ background: "#fdf2f8" }}>
      {/* Header */}
      <div className="p-5 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)" }}>
        <div className="absolute top-2 right-24 text-2xl opacity-20">✨</div>
        <div className="absolute bottom-8 left-4 text-xl opacity-20">💕</div>
        <div className="flex items-center justify-between relative z-10">
          <div>
            <div className="text-3xl font-bold tracking-tight">Gallery Kerudung</div>
            <div className="mt-1 text-sm font-medium opacity-80">💕 made by order ✨</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <img src="/logo-gk.png" className="h-16 w-16 rounded-2xl shadow-lg" alt="logo"
              style={{ border: "2px solid rgba(255,255,255,0.4)" }} />
            <button onClick={handleLogout} className="rounded-full px-3 py-1 text-xs font-semibold text-white"
              style={{ background: "rgba(255,255,255,0.25)" }}>Keluar</button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl px-4 py-3 flex items-center gap-3 relative z-10"
          style={{ background: "rgba(255,255,255,0.2)" }}>
          <span>🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari pesanan, supplier, biaya..."
            className="bg-transparent outline-none flex-1 text-white placeholder-pink-100 text-sm" />
          {search && <button onClick={() => setSearch("")} className="text-pink-200 font-bold">✕</button>}
        </div>
      </div>

      <TabBar tab={tab} setTab={setTab} badgeCount={pesananTelat.length} />

      {loading && <div className="flex justify-center py-10 text-slate-400">Memuat data...</div>}

      {/* ── DASHBOARD ── */}
      {!loading && tab === "dashboard" && (
        <>
          {pesananTelat.length > 0 && (
            <div className="mx-4 mt-4 rounded-2xl bg-rose-50 border border-rose-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔔</span>
                <span className="font-bold text-rose-700">{pesananTelat.length} Pesanan Belum Bayar 7+ Hari</span>
              </div>
              <div className="space-y-2">
                {pesananTelat.map((o) => (
                  <div key={o.id} className="flex justify-between items-center bg-white rounded-xl px-3 py-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-800">{o.customer}</div>
                      <div className="text-xs text-slate-400">{o.invoice}</div>
                    </div>
                    <div className="text-sm font-bold text-rose-600">{rupiah(sisaOrder(o))}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 p-4">
            <Card title="Kas Masuk" value={stats.customerPaid} note="Cicilan pelanggan" bg="bg-emerald-50" icon="💚" />
            <Card title="Kas Keluar" value={stats.cashOut} note="Supplier + biaya" bg="bg-pink-50" icon="🌸" />
            <Card title="Piutang" value={stats.receivable} note="Tagihan pelanggan" bg="bg-purple-50" icon="💜" />
            <Card title="Hutang Supplier" value={stats.supplierDebt} note="Bahan baku" bg="bg-yellow-50" icon="⭐" />
          </div>

          <div className="px-4 pb-4">
            <div className="rounded-3xl p-5 shadow-sm relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #fdf2f8, #ede9fe)", border: "1.5px solid #f9a8d4" }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold" style={{ color: "#a855f7" }}>✨ Saldo Cashflow</div>
                <span className="text-xs font-bold px-2 py-1 rounded-full"
                  style={{ background: stats.netCash >= 0 ? "#dcfce7" : "#fee2e2", color: stats.netCash >= 0 ? "#059669" : "#e11d48" }}>
                  {stats.netCash >= 0 ? "✅ POSITIF" : "⚠️ MINUS"}
                </span>
              </div>
              <div className="mt-3 text-5xl font-bold"
                style={{ color: stats.netCash >= 0 ? "#059669" : "#e11d48" }}>
                {stats.netCash < 0 ? "-" : ""}{rupiah(Math.abs(stats.netCash))}
              </div>
              {stats.netCash < 0 && (
                <div className="mt-2 rounded-xl p-2 text-xs font-semibold"
                  style={{ background: "#fee2e2", color: "#e11d48" }}>
                  ⚠️ Kas keluar lebih besar {rupiah(Math.abs(stats.netCash))}
                </div>
              )}
              <div className="mt-2 text-xs" style={{ color: "#c084fc" }}>💕 Kas masuk dikurangi pembayaran supplier dan biaya lain</div>
            </div>
          </div>

          <GrafikKas orders={orders} purchases={purchases} expenses={expenses} />
          <GrafikPesanan orders={orders} />
        </>
      )}

      {/* ── ORDERS TAB ── */}
      {!loading && tab === "orders" && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setModal("order")} style={{ background: "linear-gradient(135deg,#ec4899,#f472b6)" }}>+ Pesanan</Button>
            <Button onClick={() => setModal("pay")} style={{ background: "linear-gradient(135deg,#10b981,#34d399)" }}>+ Bayar Masuk</Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <select className="flex-1 rounded-2xl border px-3 py-2 text-sm bg-white outline-none"
              style={{ borderColor: "#f9a8d4", minWidth: 100 }}
              value={filterOrder} onChange={(e) => setFilterOrder(e.target.value)}>
              <option value="semua">Semua Status</option>
              <option value="belum-lunas">Belum Lunas</option>
              <option value="lunas">Lunas</option>
            </select>
            <select className="flex-1 rounded-2xl border px-3 py-2 text-sm bg-white outline-none"
              style={{ borderColor: "#f9a8d4", minWidth: 100 }}
              value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="terbaru">Terbaru</option>
              <option value="terlama">Terlama</option>
              <option value="customer">Per Customer</option>
            </select>
          </div>

          {/* Ringkasan per customer */}
          {sortOrder === "customer" && uniqueCustomers
            .filter(c => filteredOrders.some(o => normalizeName(o.customer) === normalizeName(c.name)))
            .filter(c => filterOrder === "belum-lunas" ? c.pesananAktif > 0 : true)
            .map(c => (
              <div key={c.name} className="rounded-2xl p-3 mb-1"
                style={{ background: "linear-gradient(135deg,#fdf2f8,#ede9fe)", border: "1.5px solid #f9a8d4" }}>
                <div className="flex justify-between items-center">
                  <div className="font-bold text-sm" style={{ color: "#ec4899" }}>👤 {c.name}</div>
                  <div className="text-xs font-semibold" style={{ color: "#a855f7" }}>{c.totalPesanan} pesanan</div>
                </div>
                {c.pesananAktif > 0 && (
                  <div className="flex justify-between mt-1">
                    <span className="text-xs" style={{ color: "#64748b" }}>{c.pesananAktif} belum lunas</span>
                    <span className="text-xs font-bold" style={{ color: "#e11d48" }}>sisa {rupiah(c.totalSisa)}</span>
                  </div>
                )}
              </div>
            ))}

          {(() => {
            let list = [...filteredOrders];
            if (filterOrder === "belum-lunas") list = list.filter(o => sisaOrder(o) > 0);
            if (filterOrder === "lunas") list = list.filter(o => sisaOrder(o) <= 0);
            if (sortOrder === "terbaru") list.sort((a, b) => (b.createdAt||"").localeCompare(a.createdAt||""));
            if (sortOrder === "terlama") list.sort((a, b) => (a.createdAt||"").localeCompare(b.createdAt||""));
            if (sortOrder === "customer") list.sort((a, b) => (a.customer||"").localeCompare(b.customer||"") || (a.createdAt||"").localeCompare(b.createdAt||""));

            if (list.length === 0) return <div className="text-center py-10 text-slate-400">Tidak ada pesanan ditemukan</div>;

            return list.map((o) => {
              const paid = (o.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
              const sisa = Number(o.total || 0) - paid;
              return (
                <div key={o.id} className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-lg">{o.customer}</div>
                      {o.phone && (
                        <a href={`https://wa.me/62${o.phone.replace(/^0/, "")}`} target="_blank" rel="noreferrer"
                          className="text-xs text-emerald-600 font-semibold">📱 WA {o.phone}</a>
                      )}
                      <div className="text-sm text-slate-500">{o.invoice} · {orderItemsSummary(o)}</div>
                      <div className="mt-2 rounded-2xl bg-slate-50 p-3 space-y-1">
                        {normalizeOrderItems(o).map((it, idx) => (
                          <div key={idx} className="flex justify-between text-xs">
                            <span className="text-slate-500">{it.name} · {it.qty} pcs</span>
                            <span className="font-semibold text-purple-600">{rupiah(Number(it.qty || 0) * Number(it.price || 0))}</span>
                          </div>
                        ))}
                      </div>
                      {o.createdAt && <div className="text-xs text-slate-400">📅 {o.createdAt}</div>}
                      <div className="mt-1"><StatusBadge status={o.status} /></div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{rupiah(o.total)}</div>
                      <div className="text-sm text-rose-500">Sisa {rupiah(sisa)}</div>
                    </div>
                  </div>

                  {(o.payments || []).length > 0 && (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3 space-y-1">
                      <div className="text-xs font-semibold text-slate-500 mb-2">Riwayat Pembayaran</div>
                      {(o.payments || []).map((p, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-slate-500">{p.date} · {p.note}</span>
                          <span className="font-semibold text-emerald-600">{rupiah(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 space-y-2">
                    {o.status === "Proses" && (
                      <button onClick={() => { setKirimModal(o.id); setTanggalKirim(todayStr()); }}
                        className="w-full rounded-2xl bg-sky-600 py-2 text-sm font-semibold text-white">
                        🚚 Tandai Dikirim
                      </button>
                    )}
                    {o.tanggalKirim && <div className="text-xs text-slate-400">🚚 Dikirim: {o.tanggalKirim}</div>}
                    {o.status === "Lunas" && <div className="text-xs text-emerald-600 font-semibold">✅ Lunas otomatis</div>}
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button className="flex-1" style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}
                      onClick={() => setInvoiceCustomer(capitalizeWords(o.customer))}>
                      📄 Invoice
                    </Button>
                    <Button className="bg-sky-600 flex-1" onClick={() => setEditData({ type: "orders", ...o })}>Edit</Button>
                    <Button className="bg-rose-600 flex-1" onClick={() => deleteItem("orders", o.id)}>Hapus</Button>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ── PURCHASES TAB ── */}
      {!loading && tab === "purchases" && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setModal("purchase")} style={{ background: "linear-gradient(135deg,#a855f7,#c084fc)" }}>+ Supplier</Button>
            <Button onClick={() => setModal("supplierPay")} style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>+ Bayar Supplier</Button>
          </div>

          {filteredPurchases.length === 0 && <div className="text-center py-10 text-slate-400">Tidak ada data supplier</div>}

          {filteredPurchases.map((p) => {
            const paid = (p.payments || []).reduce((s, x) => s + Number(x.amount || 0), 0);
            const sisa = Number(p.total || 0) - paid;
            return (
              <div key={p.id} className="rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-lg">{p.supplier}</div>
                    <div className="text-sm text-slate-500">{p.material}{p.qty ? ` · ${p.qty}` : ""}</div>
                    {p.createdAt && <div className="text-xs text-slate-400">📅 {p.createdAt}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{rupiah(p.total)}</div>
                    <div className="text-sm text-rose-500">Sisa hutang {rupiah(sisa)}</div>
                  </div>
                </div>
                {(p.payments || []).length > 0 && (
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3 space-y-1">
                    <div className="text-xs font-semibold text-slate-500 mb-2">Riwayat Pembayaran</div>
                    {(p.payments || []).map((x, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-500">{x.date} · {x.note}</span>
                        <span className="font-semibold text-emerald-600">{rupiah(x.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  <Button className="bg-sky-600 flex-1" onClick={() => setEditData({ type: "purchases", ...p })}>Edit</Button>
                  <Button className="bg-rose-600 flex-1" onClick={() => deleteItem("purchases", p.id)}>Hapus</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── EXPENSES TAB ── */}
      {!loading && tab === "expenses" && (
        <div className="space-y-4 p-4">
          <Button className="w-full bg-slate-700" onClick={() => setModal("expense")}>+ Tambah Pengeluaran</Button>
          {filteredExpenses.length === 0 && <div className="text-center py-10 text-slate-400">Tidak ada pengeluaran</div>}
          {filteredExpenses.map((e) => (
            <div key={e.id} className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold">{e.category}</div>
                  <div className="text-sm text-slate-500">{e.date}</div>
                  {e.note && <div className="text-sm text-slate-400 mt-1">{e.note}</div>}
                </div>
                <div className="font-bold text-rose-600">{rupiah(e.amount)}</div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="bg-sky-600 flex-1" onClick={() => setEditData({ type: "expenses", ...e })}>Edit</Button>
                <Button className="bg-rose-600 flex-1" onClick={() => deleteItem("expenses", e.id)}>Hapus</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── REKAP TAB ── */}
      {!loading && tab === "rekap" && (
        <div className="p-4 space-y-4">
          <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
            <div className="text-lg font-bold mb-1" style={{ color: "#ec4899" }}>📊 Download Rekap Keuangan</div>
            <div className="text-xs text-slate-400 mb-5">Format TSV — bisa dibuka di Google Sheets / Excel</div>

            <div className="space-y-3">
              {/* Bulanan */}
              {(() => {
                const rows = buildRows("month");
                const masuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
                const keluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
                const now = new Date();
                return (
                  <div className="rounded-2xl p-4" style={{ background: "linear-gradient(135deg,#fdf2f8,#fce7f3)", border: "1px solid #f9a8d4" }}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="font-bold" style={{ color: "#ec4899" }}>📅 Rekap Bulanan</div>
                        <div className="text-xs text-slate-400">{BULAN_FULL[now.getMonth()]} {now.getFullYear()}</div>
                      </div>
                      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-pink-100 text-pink-700">{rows.length} transaksi</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Masuk</div>
                        <div className="text-sm font-bold text-emerald-600">{masuk >= 1000000 ? (masuk/1000000).toFixed(1)+"jt" : rupiah(masuk)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Keluar</div>
                        <div className="text-sm font-bold text-rose-500">{keluar >= 1000000 ? (keluar/1000000).toFixed(1)+"jt" : rupiah(keluar)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Saldo</div>
                        <div className={`text-sm font-bold ${masuk-keluar >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                          {(masuk-keluar) >= 1000000 ? ((masuk-keluar)/1000000).toFixed(1)+"jt" : rupiah(masuk-keluar)}
                        </div>
                      </div>
                    </div>
                    <Button onClick={() => downloadRekap("month")} className="w-full"
                      style={{ background: "linear-gradient(135deg,#ec4899,#f472b6)" }}>
                      ⬇️ Download Bulanan
                    </Button>
                  </div>
                );
              })()}

              {/* Tahunan */}
              {(() => {
                const rows = buildRows("year");
                const masuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
                const keluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
                return (
                  <div className="rounded-2xl p-4" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: "1px solid #c4b5fd" }}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="font-bold" style={{ color: "#7c3aed" }}>📅 Rekap Tahunan</div>
                        <div className="text-xs text-slate-400">Tahun {new Date().getFullYear()}</div>
                      </div>
                      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-purple-100 text-purple-700">{rows.length} transaksi</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Masuk</div>
                        <div className="text-sm font-bold text-emerald-600">{masuk >= 1000000 ? (masuk/1000000).toFixed(1)+"jt" : rupiah(masuk)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Keluar</div>
                        <div className="text-sm font-bold text-rose-500">{keluar >= 1000000 ? (keluar/1000000).toFixed(1)+"jt" : rupiah(keluar)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Saldo</div>
                        <div className={`text-sm font-bold ${masuk-keluar >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                          {(masuk-keluar) >= 1000000 ? ((masuk-keluar)/1000000).toFixed(1)+"jt" : rupiah(masuk-keluar)}
                        </div>
                      </div>
                    </div>
                    <Button onClick={() => downloadRekap("year")} className="w-full"
                      style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>
                      ⬇️ Download Tahunan
                    </Button>
                  </div>
                );
              })()}

              {/* Semua Data */}
              {(() => {
                const rows = buildRows("all");
                const masuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
                const keluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
                return (
                  <div className="rounded-2xl p-4" style={{ background: "linear-gradient(135deg,#ecfdf5,#d1fae5)", border: "1px solid #6ee7b7" }}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="font-bold" style={{ color: "#059669" }}>💕 Semua Data</div>
                        <div className="text-xs text-slate-400">Seluruh riwayat transaksi</div>
                      </div>
                      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">{rows.length} transaksi</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Masuk</div>
                        <div className="text-sm font-bold text-emerald-600">{masuk >= 1000000 ? (masuk/1000000).toFixed(1)+"jt" : rupiah(masuk)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Keluar</div>
                        <div className="text-sm font-bold text-rose-500">{keluar >= 1000000 ? (keluar/1000000).toFixed(1)+"jt" : rupiah(keluar)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-400">Saldo</div>
                        <div className={`text-sm font-bold ${masuk-keluar >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                          {(masuk-keluar) >= 1000000 ? ((masuk-keluar)/1000000).toFixed(1)+"jt" : rupiah(masuk-keluar)}
                        </div>
                      </div>
                    </div>
                    <Button onClick={() => downloadRekap("all")} className="w-full"
                      style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>
                      ⬇️ Download Semua Data
                    </Button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Rekap pembayaran supplier */}
          <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
            <div className="text-lg font-bold mb-1" style={{ color: "#a855f7" }}>🛍️ Rekap Pembayaran Supplier</div>
            <div className="text-xs text-slate-400 mb-4">Tanggal belanja, jenis bahan, jumlah, sudah dibayar, dan sisa utang</div>

            {(() => {
              const rows = buildSupplierRows("all");
              const totalBelanja = rows.reduce((s, r) => s + Number(r.totalBelanja || 0), 0);
              const totalDibayar = rows.reduce((s, r) => s + Number(r.sudahDibayar || 0), 0);
              const totalSisa = rows.reduce((s, r) => s + Number(r.sisaUtang || 0), 0);
              return (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="text-center rounded-2xl p-3 bg-purple-50">
                      <div className="text-xs text-slate-400">Belanja</div>
                      <div className="text-sm font-bold text-purple-600">{rupiah(totalBelanja)}</div>
                    </div>
                    <div className="text-center rounded-2xl p-3 bg-emerald-50">
                      <div className="text-xs text-slate-400">Dibayar</div>
                      <div className="text-sm font-bold text-emerald-600">{rupiah(totalDibayar)}</div>
                    </div>
                    <div className="text-center rounded-2xl p-3 bg-rose-50">
                      <div className="text-xs text-slate-400">Sisa</div>
                      <div className="text-sm font-bold text-rose-500">{rupiah(totalSisa)}</div>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4 max-h-72 overflow-auto">
                    {rows.length === 0 && <div className="text-center py-4 text-slate-400">Belum ada data supplier</div>}
                    {rows.map((r, i) => (
                      <div key={i} className="rounded-2xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="flex justify-between gap-2">
                          <div>
                            <div className="font-bold text-sm text-slate-800">{r.supplier || "Supplier"}</div>
                            <div className="text-xs text-slate-500">📅 {r.tanggalBelanja || "-"} · {r.jenisBahan || "Bahan"}</div>
                            <div className="text-xs text-slate-400">Banyak: {r.banyak || "-"}</div>
                          </div>
                          <div className="text-right text-xs">
                            <div className="font-semibold text-slate-700">{rupiah(r.totalBelanja)}</div>
                            <div className="text-emerald-600">Dibayar {rupiah(r.sudahDibayar)}</div>
                            <div className="font-bold text-rose-500">Sisa {rupiah(r.sisaUtang)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="text-xs font-bold text-slate-500 mb-2">Download Excel / Sheets</div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <Button onClick={() => downloadSupplierRekap("month")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#ec4899,#f472b6)" }}>Bulanan</Button>
                    <Button onClick={() => downloadSupplierRekap("year")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>Tahunan</Button>
                    <Button onClick={() => downloadSupplierRekap("all")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>Semua</Button>
                  </div>
                  <div className="text-xs font-bold text-slate-500 mb-2">Export PDF Supplier</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button onClick={() => downloadSupplierRekapPdf("month")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#be185d,#ec4899)" }}>PDF Bulanan</Button>
                    <Button onClick={() => downloadSupplierRekapPdf("year")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#6d28d9,#8b5cf6)" }}>PDF Tahunan</Button>
                    <Button onClick={() => downloadSupplierRekapPdf("all")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#047857,#10b981)" }}>PDF Semua</Button>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Invoice per customer */}
          <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
            <div className="text-lg font-bold mb-1" style={{ color: "#ec4899" }}>📄 Invoice per Customer</div>
            <div className="text-xs text-slate-400 mb-4">Kirim rincian pesanan langsung ke WhatsApp atau export rekap PDF customer</div>
            <div className="text-xs font-bold text-slate-500 mb-2">Export PDF Customer</div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Button onClick={() => downloadCustomerRekapPdf("month")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#be185d,#ec4899)" }}>PDF Bulanan</Button>
              <Button onClick={() => downloadCustomerRekapPdf("year")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#6d28d9,#8b5cf6)" }}>PDF Tahunan</Button>
              <Button onClick={() => downloadCustomerRekapPdf("all")} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#047857,#10b981)" }}>PDF Semua</Button>
            </div>
            <div className="space-y-2">
              {uniqueCustomers.length === 0 && <div className="text-center py-4 text-slate-400">Belum ada customer</div>}
              {uniqueCustomers.map(c => {
                const cOrders = orders.filter(o => normalizeName(o.customer) === normalizeName(c.name));
                const totalNilai = cOrders.reduce((s, o) => s + Number(o.total || 0), 0);
                const totalBayar = cOrders.reduce((s, o) => s + (o.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0);
                const sisa = totalNilai - totalBayar;
                return (
                  <div key={c.name} className="flex items-center justify-between rounded-2xl p-3"
                    style={{ background: "#fdf2f8", border: "1px solid #fce7f3" }}>
                    <div>
                      <div className="font-bold text-sm" style={{ color: "#1e293b" }}>{c.name}</div>
                      <div className="text-xs text-slate-400">{c.totalPesanan} pesanan · sisa {rupiah(sisa)}</div>
                    </div>
                    <button onClick={() => setInvoiceCustomer(c.name)}
                      className="rounded-xl px-3 py-2 text-xs font-bold text-white"
                      style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}>
                      📤 Kirim WA
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════ MODALS ════ */}

      {modal === "order" && (
        <SimpleModal title="Tambah Pesanan" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal Pesanan" value={orderForm.date} onChange={(v) => setOrderForm(f => ({ ...f, date: v }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Nama Customer</label>
              <input list="customer-list" value={orderForm.customer}
                onChange={(e) => setOrderForm(f => ({ ...f, customer: e.target.value }))}
                placeholder="Ketik atau pilih nama customer..."
                className="w-full px-4 py-3 outline-none text-sm"
                style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }} />
              <datalist id="customer-list">
                {uniqueCustomers.map(c => <option key={c.name} value={c.name} />)}
              </datalist>
            </div>
            <Input label="No HP Customer (opsional)" type="number" value={orderForm.phone} onChange={(v) => setOrderForm(f => ({ ...f, phone: v }))} placeholder="08xxxxxxxxxx" />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Produk Pesanan</label>
                <button
                  type="button"
                  onClick={() => setOrderForm(f => ({ ...f, items: [...(f.items || []), emptyOrderItem()] }))}
                  className="rounded-xl px-3 py-2 text-xs font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}
                >
                  + Tambah Produk
                </button>
              </div>

              {(orderForm.items || []).map((it, idx) => (
                <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#fdf2f8", border: "1.5px solid #f9a8d4" }}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold" style={{ color: "#ec4899" }}>Produk #{idx + 1}</div>
                    {(orderForm.items || []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => setOrderForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                        className="rounded-xl px-3 py-1 text-xs font-bold text-rose-600 bg-rose-50"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                  <Input
                    label="Nama Produk"
                    value={it.name}
                    onChange={(v) => setOrderForm(f => ({
                      ...f,
                      items: f.items.map((x, i) => i === idx ? { ...x, name: v } : x),
                    }))}
                    placeholder="Contoh: Segiempat Motif"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      label="Jumlah pcs"
                      type="number"
                      value={it.qty}
                      onChange={(v) => setOrderForm(f => ({
                        ...f,
                        items: f.items.map((x, i) => i === idx ? { ...x, qty: v } : x),
                      }))}
                    />
                    <Input
                      label="Harga/pcs"
                      type="money"
                      value={it.price}
                      onChange={(v) => setOrderForm(f => ({
                        ...f,
                        items: f.items.map((x, i) => i === idx ? { ...x, price: v } : x),
                      }))}
                    />
                  </div>
                  <div className="flex justify-between rounded-xl bg-white px-3 py-2 text-sm">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-bold" style={{ color: "#be185d" }}>{rupiah(Number(it.qty || 0) * Number(it.price || 0))}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Total Pesanan (otomatis)</label>
              <div className="w-full px-4 py-3 text-sm font-bold rounded-2xl"
                style={{ border: "1.5px solid #f9a8d4", background: "#fce7f3", color: "#be185d" }}>
                {rupiah(orderItemsTotal(orderForm.items))}
              </div>
            </div>
            <Input label="DP Awal (opsional)" type="money" value={orderForm.dp} onChange={(v) => setOrderForm(f => ({ ...f, dp: v }))} />
            <Button onClick={addOrder} className="w-full bg-pink-600">Simpan Pesanan</Button>
          </div>
        </SimpleModal>
      )}

      {modal === "purchase" && (
        <SimpleModal title="Tambah Supplier" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal Belanja" value={purchaseForm.date} onChange={(v) => setPurchaseForm(f => ({ ...f, date: v }))} />
            <Input label="Nama Supplier" value={purchaseForm.supplier} onChange={(v) => setPurchaseForm(f => ({ ...f, supplier: v }))} />
            <Input label="Bahan" value={purchaseForm.material} onChange={(v) => setPurchaseForm(f => ({ ...f, material: v }))} />
            <Input label="Banyak / Jumlah Bahan" value={purchaseForm.qty} onChange={(v) => setPurchaseForm(f => ({ ...f, qty: v }))} placeholder="Contoh: 12 meter / 5 roll" />
            <Input label="Total" type="money" value={purchaseForm.total} onChange={(v) => setPurchaseForm(f => ({ ...f, total: v }))} />
            <Input label="DP Supplier (opsional)" type="money" value={purchaseForm.dp} onChange={(v) => setPurchaseForm(f => ({ ...f, dp: v }))} />
            <Button onClick={addPurchase} className="w-full bg-yellow-500">Simpan Supplier</Button>
          </div>
        </SimpleModal>
      )}

      {modal === "expense" && (
        <SimpleModal title="Tambah Pengeluaran" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal" value={expenseForm.date} onChange={(v) => setExpenseForm(f => ({ ...f, date: v }))} />
            <Input label="Kategori" value={expenseForm.category} onChange={(v) => setExpenseForm(f => ({ ...f, category: v }))} placeholder="Contoh: Ongkir, Listrik" />
            <Input label="Keterangan" value={expenseForm.note} onChange={(v) => setExpenseForm(f => ({ ...f, note: v }))} />
            <Input label="Nominal" type="money" value={expenseForm.amount} onChange={(v) => setExpenseForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addExpense} className="w-full bg-slate-700">Simpan Pengeluaran</Button>
          </div>
        </SimpleModal>
      )}

      {modal === "pay" && (
        <SimpleModal title="Catat Bayar Masuk" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Select label="Nama Customer" value={orderPayForm.customer}
              onChange={(v) => setOrderPayForm(f => ({ ...f, customer: v }))}>
              <option value="">-- Pilih Customer --</option>
              {uniqueCustomers.filter(c => c.pesananAktif > 0).map(c => (
                <option key={c.name} value={c.name}>
                  {c.name} — {c.pesananAktif} pesanan, sisa {rupiah(c.totalSisa)}
                </option>
              ))}
            </Select>

            {orderPayForm.customer && (() => {
              const list = orders
                .filter(o => normalizeName(o.customer) === normalizeName(orderPayForm.customer) && sisaOrder(o) > 0)
                .sort((a, b) => (a.createdAt||"").localeCompare(b.createdAt||""));
              return list.length > 0 ? (
                <div className="rounded-2xl p-3 space-y-1" style={{ background: "#fdf2f8", border: "1px solid #fce7f3" }}>
                  <div className="text-xs font-bold mb-2" style={{ color: "#a855f7" }}>📋 Akan dialokasikan (urutan terlama):</div>
                  {list.map((o, i) => (
                    <div key={o.id} className="flex justify-between text-xs">
                      <span style={{ color: "#64748b" }}>{i+1}. {o.invoice}</span>
                      <span className="font-semibold" style={{ color: "#e11d48" }}>sisa {rupiah(sisaOrder(o))}</span>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            <DatePicker label="Tanggal Bayar" value={orderPayForm.date} onChange={(v) => setOrderPayForm(f => ({ ...f, date: v }))} />
            <Input label="Keterangan" value={orderPayForm.note} onChange={(v) => setOrderPayForm(f => ({ ...f, note: v }))} placeholder="Contoh: Transfer BCA" />
            <Input label="Nominal Pembayaran" type="money" value={orderPayForm.amount} onChange={(v) => setOrderPayForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addOrderPayment} className="w-full" style={{ background: "linear-gradient(135deg,#10b981,#34d399)" }}>
              💚 Simpan & Alokasi Otomatis
            </Button>
          </div>
        </SimpleModal>
      )}

      {modal === "supplierPay" && (
        <SimpleModal title="Bayar Supplier" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Select label="Pilih Supplier" value={supplierPayForm.purchaseId}
              onChange={(v) => setSupplierPayForm(f => ({ ...f, purchaseId: v }))}>
              <option value="">-- Pilih Supplier --</option>
              {purchases.filter((p) => sisaPurchase(p) > 0).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.supplier} ({p.material}) — sisa {rupiah(sisaPurchase(p))}
                </option>
              ))}
            </Select>
            <DatePicker label="Tanggal" value={supplierPayForm.date} onChange={(v) => setSupplierPayForm(f => ({ ...f, date: v }))} />
            <Input label="Keterangan" value={supplierPayForm.note} onChange={(v) => setSupplierPayForm(f => ({ ...f, note: v }))} placeholder="Contoh: Pelunasan bahan" />
            <Input label="Nominal" type="money" value={supplierPayForm.amount} onChange={(v) => setSupplierPayForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addSupplierPayment} className="w-full bg-orange-500">Simpan Pembayaran</Button>
          </div>
        </SimpleModal>
      )}

      {/* Invoice per Customer Modal */}
      {invoiceCustomer && (
        <InvoiceModal
          key={invoiceCustomer}
          customerName={invoiceCustomer}
          orders={orders}
          onClose={() => setInvoiceCustomer(null)}
        />
      )}

      {/* Modal Edit */}
      {editData && (
        <SimpleModal title="Edit Data" onClose={() => setEditData(null)}>
          <div className="space-y-3">
            {editData.type === "orders" && <>
              <DatePicker label="Tanggal Pesanan" value={editData.createdAt || ""} onChange={(v) => setEditData(d => ({ ...d, createdAt: v }))} />
              <Input label="Nama Customer" value={editData.customer || ""} onChange={(v) => setEditData(d => ({ ...d, customer: v }))} />
              <Input label="No HP Customer" type="number" value={editData.phone || ""} onChange={(v) => setEditData(d => ({ ...d, phone: v }))} placeholder="08xxxxxxxxxx" />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Produk Pesanan</label>
                  <button
                    type="button"
                    onClick={() => setEditData(d => ({ ...d, items: [...normalizeOrderItems(d), emptyOrderItem()] }))}
                    className="rounded-xl px-3 py-2 text-xs font-bold text-white"
                    style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}
                  >
                    + Tambah Produk
                  </button>
                </div>
                {normalizeOrderItems(editData).map((it, idx) => (
                  <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#fdf2f8", border: "1.5px solid #f9a8d4" }}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold" style={{ color: "#ec4899" }}>Produk #{idx + 1}</div>
                      {normalizeOrderItems(editData).length > 1 && (
                        <button
                          type="button"
                          onClick={() => setEditData(d => ({ ...d, items: normalizeOrderItems(d).filter((_, i) => i !== idx) }))}
                          className="rounded-xl px-3 py-1 text-xs font-bold text-rose-600 bg-rose-50"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                    <Input
                      label="Nama Produk"
                      value={it.name}
                      onChange={(v) => setEditData(d => ({ ...d, items: normalizeOrderItems(d).map((x, i) => i === idx ? { ...x, name: v } : x) }))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Jumlah pcs"
                        type="number"
                        value={it.qty}
                        onChange={(v) => setEditData(d => ({ ...d, items: normalizeOrderItems(d).map((x, i) => i === idx ? { ...x, qty: v } : x) }))}
                      />
                      <Input
                        label="Harga/pcs"
                        type="money"
                        value={it.price}
                        onChange={(v) => setEditData(d => ({ ...d, items: normalizeOrderItems(d).map((x, i) => i === idx ? { ...x, price: v } : x) }))}
                      />
                    </div>
                    <div className="flex justify-between rounded-xl bg-white px-3 py-2 text-sm">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-bold" style={{ color: "#be185d" }}>{rupiah(Number(it.qty || 0) * Number(it.price || 0))}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Total Pesanan</label>
                <div className="w-full px-4 py-3 text-sm font-bold rounded-2xl" style={{ border: "1.5px solid #f9a8d4", background: "#fce7f3", color: "#be185d" }}>
                  {rupiah(orderItemsTotal(normalizeOrderItems(editData)))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Status</label>
                <div className="flex gap-2">
                  {["Proses", "Selesai", "Lunas"].map((s) => (
                    <button key={s} onClick={() => setEditData(d => ({ ...d, status: s }))}
                      className={`rounded-full px-4 py-2 text-sm font-semibold border transition-all ${editData.status === s ? "bg-pink-600 text-white border-pink-600" : "bg-white text-slate-500 border-slate-200"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>}
            {editData.type === "purchases" && <>
              <DatePicker label="Tanggal Belanja" value={editData.createdAt || ""} onChange={(v) => setEditData(d => ({ ...d, createdAt: v }))} />
              <Input label="Nama Supplier" value={editData.supplier || ""} onChange={(v) => setEditData(d => ({ ...d, supplier: v }))} />
              <Input label="Bahan" value={editData.material || ""} onChange={(v) => setEditData(d => ({ ...d, material: v }))} />
              <Input label="Banyak / Jumlah Bahan" value={editData.qty || ""} onChange={(v) => setEditData(d => ({ ...d, qty: v }))} placeholder="Contoh: 12 meter / 5 roll" />
              <Input label="Total" type="money" value={editData.total || 0} onChange={(v) => setEditData(d => ({ ...d, total: v }))} />
            </>}
            {editData.type === "expenses" && <>
              <DatePicker label="Tanggal" value={editData.date || ""} onChange={(v) => setEditData(d => ({ ...d, date: v }))} />
              <Input label="Kategori" value={editData.category || ""} onChange={(v) => setEditData(d => ({ ...d, category: v }))} />
              <Input label="Keterangan" value={editData.note || ""} onChange={(v) => setEditData(d => ({ ...d, note: v }))} />
              <Input label="Nominal" type="money" value={editData.amount || 0} onChange={(v) => setEditData(d => ({ ...d, amount: v }))} />
            </>}
            <Button onClick={saveEdit} className="w-full bg-sky-600">Simpan Perubahan</Button>
          </div>
        </SimpleModal>
      )}

      {/* Konfirmasi Rekap */}
      {rekapConfirm && (() => {
        const labelMap = { month: "Bulanan", year: "Tahunan", all: "Semua Data" };
        const rows = buildRows(rekapConfirm);
        const totalMasuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
        const totalKeluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
              <div className="text-xl font-bold text-slate-800 mb-1">Download Rekap {labelMap[rekapConfirm]}</div>
              <div className="text-slate-500 text-sm mb-4">Format: TSV (bisa dibuka di Google Sheets)</div>
              <div className="rounded-2xl bg-slate-50 p-4 space-y-2 mb-5">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Total transaksi</span><span className="font-semibold">{rows.length} data</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Kas masuk</span><span className="font-semibold text-emerald-600">{rupiah(totalMasuk)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Kas keluar</span><span className="font-semibold text-rose-500">{rupiah(totalKeluar)}</span></div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="font-semibold text-slate-700">Saldo bersih</span>
                  <span className={`font-bold ${totalMasuk - totalKeluar >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{rupiah(totalMasuk - totalKeluar)}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setRekapConfirm(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
                <button onClick={doDownloadRekap} className="flex-1 rounded-2xl bg-indigo-600 py-3 font-semibold text-white">Download</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Tandai Dikirim */}
      {kirimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-slate-800 mb-1">🚚 Tandai Pesanan Dikirim</div>
            <div className="text-slate-500 text-sm mb-4">Status akan berubah menjadi <strong>Selesai</strong></div>
            <DatePicker label="Tanggal Kirim" value={tanggalKirim} onChange={(v) => setTanggalKirim(v)} />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setKirimModal(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
              <button onClick={tandaiDikirim} className="flex-1 rounded-2xl bg-sky-600 py-3 font-semibold text-white">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi Hapus */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-slate-800 mb-2">Hapus Data?</div>
            <div className="text-slate-500 mb-6">Data yang dihapus tidak bisa dikembalikan.</div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
              <button onClick={confirmDeleteAction} className="flex-1 rounded-2xl bg-rose-600 py-3 font-semibold text-white">Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isSaving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-2xl bg-white px-8 py-5 shadow-xl flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-pink-600 border-t-transparent rounded-full animate-spin" />
            <span className="font-semibold text-slate-700">Menyimpan...</span>
          </div>
        </div>
      )}
    </div>
  );
}