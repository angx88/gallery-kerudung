import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import "./App.css";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

const auth = getAuth();
const provider = new GoogleAuthProvider();

const ALLOWED_EMAILS = [
  "angx89@gmail.com",
  "astriapriani.aa@gmail.com",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function rupiah(num) {
  return `Rp ${Number(num || 0).toLocaleString("id-ID")}`;
}

function parseMoney(value) {
  return Number(String(value).replace(/\D/g, "")) || 0;
}

function todayStr() {
  return new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
}

function getDateValue(text) {
  if (!text) return new Date();
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function samePeriod(dateStr, period) {
  const now = new Date();
  const d = getDateValue(dateStr);
  if (period === "day") return d.toDateString() === now.toDateString();
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return d >= start && d < end;
  }
  if (period === "month")
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year") return d.getFullYear() === now.getFullYear();
  return true;
}

// ─── UI Primitives ───────────────────────────────────────────────────────────

function Input({ label, value, onChange, placeholder, type = "text" }) {
  const isMoney = type === "money";
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold" style={{color: "#a855f7"}}>{label}</label>
      <input
        className="w-full px-4 py-3 outline-none text-sm"
        style={{borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69"}}
        value={isMoney ? rupiah(value || 0) : value}
        placeholder={placeholder}
        type={isMoney ? "text" : type}
        onChange={(e) =>
          onChange(isMoney ? parseMoney(e.target.value) : e.target.value)
        }
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
  // value: "YYYY-MM-DD" or ""
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("day"); // "day" | "month" | "year"

  const today = new Date();
  const parsed = value ? new Date(value + "T00:00:00") : today;
  const [cursor, setCursor] = useState({
    year: parsed.getFullYear(),
    month: parsed.getMonth(),
  });

  function selectDay(day) {
    const y = cursor.year;
    const m = String(cursor.month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
    setOpen(false);
    setView("day");
  }

  function selectMonth(m) {
    setCursor({ ...cursor, month: m });
    setView("day");
  }

  function selectYear(y) {
    setCursor({ ...cursor, year: y });
    setView("month");
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function firstDayOfMonth(y, m) {
    return new Date(y, m, 1).getDay();
  }

  const displayValue = value
    ? (() => {
        const d = new Date(value + "T00:00:00");
        return `${d.getDate()} ${BULAN_FULL[d.getMonth()]} ${d.getFullYear()}`;
      })()
    : "Pilih tanggal";

  // year range: 5 tahun ke belakang, 2 ke depan
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
      <button
        type="button"
        onClick={() => { setOpen(!open); setView("day"); }}
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-left outline-none focus:border-pink-400 bg-white flex items-center justify-between"
      >
        <span className={value ? "text-slate-800" : "text-slate-400"}>{displayValue}</span>
        <span className="text-lg">📅</span>
      </button>

      {open && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-3 mt-1">
          {/* Header navigasi */}
          <div className="flex items-center justify-between mb-3">
            {view === "day" && (
              <button
                type="button"
                onClick={() => setCursor({ ...cursor, month: cursor.month === 0 ? 11 : cursor.month - 1, year: cursor.month === 0 ? cursor.year - 1 : cursor.year })}
                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600"
              >‹</button>
            )}
            {view !== "day" && <div />}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView(view === "month" ? "day" : "month")}
                className="rounded-xl bg-pink-50 text-pink-700 font-semibold px-3 py-1 text-sm"
              >
                {BULAN_FULL[cursor.month]}
              </button>
              <button
                type="button"
                onClick={() => setView(view === "year" ? "day" : "year")}
                className="rounded-xl bg-pink-50 text-pink-700 font-semibold px-3 py-1 text-sm"
              >
                {cursor.year}
              </button>
            </div>

            {view === "day" && (
              <button
                type="button"
                onClick={() => setCursor({ ...cursor, month: cursor.month === 11 ? 0 : cursor.month + 1, year: cursor.month === 11 ? cursor.year + 1 : cursor.year })}
                className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600"
              >›</button>
            )}
            {view !== "day" && <div />}
          </div>

          {/* View: pilih tahun */}
          {view === "year" && (
            <div className="grid grid-cols-4 gap-2">
              {yearRange.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => selectYear(y)}
                  className={`rounded-xl py-2 text-sm font-semibold transition-all ${
                    y === cursor.year
                      ? "bg-pink-600 text-white"
                      : "bg-slate-50 text-slate-700 hover:bg-pink-50"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          {/* View: pilih bulan */}
          {view === "month" && (
            <div className="grid grid-cols-3 gap-2">
              {BULAN_FULL.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectMonth(i)}
                  className={`rounded-xl py-2 text-sm font-semibold transition-all ${
                    i === cursor.month
                      ? "bg-pink-600 text-white"
                      : "bg-slate-50 text-slate-700 hover:bg-pink-50"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          )}

          {/* View: pilih hari */}
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
                    <button
                      key={day}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={`mx-auto w-9 h-9 rounded-full text-sm font-medium transition-all flex items-center justify-center ${
                        isSelected
                          ? "bg-pink-600 text-white"
                          : isToday
                          ? "border-2 border-pink-400 text-pink-600 font-bold"
                          : "text-slate-700 hover:bg-pink-50"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              {/* Tombol hari ini */}
              <button
                type="button"
                onClick={() => {
                  setCursor({ year: today.getFullYear(), month: today.getMonth() });
                  selectDay(today.getDate());
                }}
                className="mt-3 w-full rounded-xl bg-slate-100 text-slate-600 font-semibold py-2 text-sm"
              >
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
    <button
      {...props}
      style={{borderRadius: 16, fontWeight: 700, letterSpacing: 0.2, ...style}}
      className={`px-4 py-3 text-white transition-all active:scale-95 shadow-sm ${className}`}
    >
      {children}
    </button>
  );
}

function Card({ title, value, note, bg, icon }) {
  return (
    <div className={`rounded-3xl p-4 shadow-sm ${bg}`} style={{border: "1px solid rgba(236,72,153,0.1)"}}>
      <div className="flex items-center gap-1 text-sm font-medium" style={{color: "#9d4edd"}}>{icon} {title}</div>
      <div className="mt-2 text-2xl font-bold" style={{color: "#2d1b69"}}>{rupiah(value)}</div>
      <div className="mt-1 text-xs" style={{color: "#c084fc"}}>{note}</div>
    </div>
  );
}

function SimpleModal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{background: "rgba(168,85,247,0.15)", backdropFilter: "blur(2px)"}}>
      <motion.div
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        className="max-h-[92vh] w-full overflow-auto p-5"
        style={{background: "white", borderRadius: "32px 32px 0 0", borderTop: "3px solid #f9a8d4"}}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold" style={{color: "#ec4899"}}>✨ {title}</h2>
          <button onClick={onClose} className="rounded-2xl px-4 py-2 text-sm font-semibold" style={{background: "#fdf2f8", color: "#ec4899"}}>
            Tutup
          </button>
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
  ];
  return (
    <div className="sticky top-0 z-40 flex bg-white shadow-sm" style={{borderBottom: "2px solid #fce7f3"}}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className="flex-1 py-3 text-xs font-semibold flex flex-col items-center gap-1 transition-all"
          style={{
            color: tab === t.id ? "#ec4899" : "#94a3b8",
            borderBottom: tab === t.id ? "3px solid #ec4899" : "3px solid transparent",
            background: tab === t.id ? "#fdf2f8" : "white",
          }}
        >
          <span className="relative text-lg">
            {t.icon}
            {t.id === "orders" && badgeCount > 0 && (
              <span className="absolute -top-1 -right-2 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold" style={{fontSize: 9, background: "linear-gradient(135deg,#ec4899,#a855f7)"}}>
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

// ─── Status Badge ────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  Proses: { background: "linear-gradient(135deg,#fde68a,#fbbf24)", color: "#92400e" },
  Selesai: { background: "linear-gradient(135deg,#bfdbfe,#60a5fa)", color: "#1e3a8a" },
  Lunas: { background: "linear-gradient(135deg,#bbf7d0,#34d399)", color: "#064e3b" },
};
const STATUS_ICON = { Proses: "⏳", Selesai: "🚚", Lunas: "✅" };

function StatusBadge({ status }) {
  return (
    <span className="rounded-full px-3 py-1 text-xs font-bold inline-flex items-center gap-1" style={STATUS_STYLES[status] || {background:"#f1f5f9",color:"#64748b"}}>
      {STATUS_ICON[status]} {status}
    </span>
  );
}

// ─── Invoice Modal ───────────────────────────────────────────────────────────

function InvoiceModal({ order, onClose }) {
  const canvasRef = React.useRef(null);
  const [imgUrl, setImgUrl] = React.useState(null);

  const paid = (order.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const sisa = Number(order.total || 0) - paid;
  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 400;
    const payments = order.payments || [];
    const H = 420 + payments.length * 28;
    canvas.width = W;
    canvas.height = H;

    // Background
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);

    // Header pink
    ctx.fillStyle = "#db2777";
    ctx.fillRect(0, 0, W, 90);

    // Logo text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Gallery Kerudung", W / 2, 38);
    ctx.font = "14px Arial";
    ctx.fillText("made by order", W / 2, 60);
    ctx.font = "13px Arial";
    ctx.fillText("📱 087822864625", W / 2, 80);

    // Invoice title
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 16px Arial";
    ctx.fillText("INVOICE", W / 2, 120);

    // Divider
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(20, 130); ctx.lineTo(W - 20, 130); ctx.stroke();
    ctx.setLineDash([]);

    // Info rows
    const drawRow = (label, val, y, bold = false) => {
      ctx.fillStyle = "#64748b";
      ctx.font = "13px Arial";
      ctx.textAlign = "left";
      ctx.fillText(label, 28, y);
      ctx.fillStyle = bold ? "#db2777" : "#1e293b";
      ctx.font = bold ? "bold 13px Arial" : "13px Arial";
      ctx.textAlign = "right";
      ctx.fillText(val, W - 28, y);
    };

    drawRow("No. Invoice", order.invoice || "-", 155);
    drawRow("Tgl Pesanan", order.createdAt || today, 178);
    drawRow("Tgl Cetak", today, 201);
    drawRow("Customer", order.customer || "-", 224);
    if (order.phone) drawRow("No. HP", order.phone, 247);
    const yProduk = order.phone ? 270 : 247;
    drawRow("Produk", order.item || "Pesanan Kerudung", yProduk);
    drawRow("Qty", `${order.qty || 0} pcs`, yProduk + 23);

    // Divider
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, 262); ctx.lineTo(W - 20, 262); ctx.stroke();

    drawRow("Total Pesanan", `Rp ${Number(order.total || 0).toLocaleString("id-ID")}`, 283);

    // Payment history
    let y = 306;
    if (payments.length > 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Riwayat Pembayaran:", 28, y);
      y += 22;
      payments.forEach((p) => {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "12px Arial";
        ctx.textAlign = "left";
        ctx.fillText(`${p.date} - ${p.note}`, 28, y);
        ctx.fillStyle = "#10b981";
        ctx.textAlign = "right";
        ctx.fillText(`Rp ${Number(p.amount || 0).toLocaleString("id-ID")}`, W - 28, y);
        y += 24;
      });
    }

    // Divider
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(20, y + 4); ctx.lineTo(W - 20, y + 4); ctx.stroke();
    y += 20;

    // Sisa
    ctx.fillStyle = sisa > 0 ? "#ef4444" : "#10b981";
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Sisa Tagihan", 28, y + 16);
    ctx.textAlign = "right";
    ctx.fillText(`Rp ${sisa.toLocaleString("id-ID")}`, W - 28, y + 16);

    // Status badge
    const statusColor = { Proses: "#f59e0b", Selesai: "#3b82f6", Lunas: "#10b981" }[order.status] || "#94a3b8";
    ctx.fillStyle = statusColor;
    ctx.beginPath();
    const bx = W/2 - 40, by = y + 30, bw = 80, bh = 26, br = 13;
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + bw - br, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + br, br);
    ctx.lineTo(bx + bw, by + bh - br);
    ctx.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
    ctx.lineTo(bx + br, by + bh);
    ctx.arcTo(bx, by + bh, bx, by + bh - br, br);
    ctx.lineTo(bx, by + br);
    ctx.arcTo(bx, by, bx + br, by, br);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "center";
    ctx.fillText(order.status || "Proses", W / 2, y + 48);

    // Footer
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Terima kasih sudah berbelanja! 💕", W / 2, H - 16);

    setImgUrl(canvas.toDataURL("image/png"));
  }, [order]);

  async function shareGambar() {
    if (!imgUrl) return;
    try {
      // Konversi dataURL ke Blob
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      const file = new File([blob], `invoice-${order.invoice}.png`, { type: "image/png" });

      // Coba Web Share API (share gambar langsung)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Invoice ${order.invoice}`,
        });
      } else {
        // Fallback: download gambar ke galeri
        const link = document.createElement("a");
        link.download = `invoice-${order.invoice}.png`;
        link.href = imgUrl;
        link.click();
        setTimeout(() => alert("Gambar tersimpan di galeri. Silakan bagikan ke WhatsApp dari galeri."), 500);
      }
    } catch (e) {
      // User cancel share atau error — tidak perlu alert
      if (e.name !== "AbortError") {
        const link = document.createElement("a");
        link.download = `invoice-${order.invoice}.png`;
        link.href = imgUrl;
        link.click();
      }
    }
  }

  const sharedRef = React.useRef(false);

  React.useEffect(() => {
    if (imgUrl && !sharedRef.current) {
      sharedRef.current = true;
      shareGambar();
    }
  }, [imgUrl]);

  return (
    <SimpleModal title="Invoice" onClose={onClose}>
      <canvas ref={canvasRef} className="hidden" />
      {!imgUrl && (
        <div className="flex items-center justify-center py-10 gap-3">
          <div className="w-5 h-5 border-2 border-pink-600 border-t-transparent rounded-full animate-spin"/>
          <span className="text-slate-500">Membuat invoice...</span>
        </div>
      )}
      {imgUrl && (
        <div className="space-y-3">
          <img src={imgUrl} alt="invoice" className="w-full rounded-2xl border border-slate-100" />
          <Button onClick={shareGambar} className="w-full bg-emerald-600">
            📤 Bagikan Gambar Invoice
          </Button>
        </div>
      )}
    </SimpleModal>
  );
}

// ─── Grafik Kas Masuk vs Kas Keluar ─────────────────────────────────────────

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
      <div className="flex items-end gap-1.5 justify-between" style={{height: H + 32}}>
        {data.map((d) => {
          const hMasuk = Math.max(Math.round((d.masuk / maxVal) * H), d.masuk > 0 ? 4 : 0);
          const hKeluar = Math.max(Math.round((d.keluar / maxVal) * H), d.keluar > 0 ? 4 : 0);
          const bulanIdx = parseInt(d.bulan.slice(5)) - 1;
          const label = BLN[bulanIdx] || d.bulan.slice(5);
          const isMax = d.masuk === Math.max(...data.map(x => x.masuk));
          return (
            <div key={d.bulan} className="flex flex-col items-center flex-1 gap-1">
              <div className="flex items-end gap-0.5 w-full justify-center" style={{height: H}}>
                <div className="flex flex-col items-center gap-0.5" style={{height: H, justifyContent:"flex-end"}}>
                  {d.masuk > 0 && <div className="text-xs font-semibold text-emerald-600" style={{fontSize:9}}>{fmt(d.masuk)}</div>}
                  <div
                    style={{
                      height: hMasuk || 2,
                      width: 14,
                      background: isMax ? "linear-gradient(to top, #059669, #34d399)" : "#6ee7b7",
                      borderRadius: "4px 4px 2px 2px",
                    }}
                  />
                </div>
                <div className="flex flex-col items-center gap-0.5" style={{height: H, justifyContent:"flex-end"}}>
                  {d.keluar > 0 && <div className="text-xs font-semibold text-rose-500" style={{fontSize:9}}>{fmt(d.keluar)}</div>}
                  <div
                    style={{
                      height: hKeluar || 2,
                      width: 14,
                      background: "#fca5a5",
                      borderRadius: "4px 4px 2px 2px",
                    }}
                  />
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

// ─── Grafik Pesanan per Bulan ─────────────────────────────────────────────────

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
  const maxNilai = Math.max(...data.map((d) => d.nilai), 1);
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
      <div className="flex items-end justify-around" style={{height: H + 52, gap: 4}}>
        {data.map((d) => {
          const hBar = Math.max(Math.round((d.jumlah / maxJumlah) * H), 4);
          const bulanIdx = parseInt(d.bulan.slice(5)) - 1;
          const label = BLN[bulanIdx] || d.bulan.slice(5);
          const isMax = d.jumlah === maxJumlah;
          const nilaiStr = d.nilai >= 1000000 ? (d.nilai/1000000).toFixed(1)+"jt" : (d.nilai/1000).toFixed(0)+"rb";
          return (
            <div key={d.bulan} className="flex flex-col items-center gap-1" style={{minWidth: BAR_W}}>
              <div className="text-xs font-bold text-pink-600">{d.jumlah}</div>
              <div
                style={{
                  height: hBar,
                  width: BAR_W,
                  background: isMax
                    ? "linear-gradient(to top, #be185d, #f472b6)"
                    : "linear-gradient(to top, #f9a8d4, #fce7f3)",
                  borderRadius: "8px 8px 4px 4px",
                  transition: "height 0.3s ease",
                  boxShadow: isMax ? "0 4px 12px rgba(236,72,153,0.3)" : "none",
                }}
              />
              <div className="text-xs font-semibold text-slate-500">{label}</div>
              <div className="text-xs text-slate-400" style={{fontSize:9}}>{nilaiStr}</div>
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
      if (u && ALLOWED_EMAILS.includes(u.email)) {
        setUser(u);
        setAuthError("");
      } else if (u) {
        signOut(auth);
        setAuthError("Email " + u.email + " tidak diizinkan mengakses aplikasi ini.");
        setUser(null);
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  async function handleLogin() {
    try {
      setAuthError("");
      await signInWithPopup(auth, provider);
    } catch (e) {
      setAuthError("Login gagal, coba lagi.");
    }
  }

  async function handleLogout() {
    await signOut(auth);
  }

  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [orders, setOrders] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [editData, setEditData] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filterOrder, setFilterOrder] = useState("semua"); // semua | belum-lunas | lunas
  const [sortOrder, setSortOrder] = useState("terbaru"); // terbaru | terlama
  const [confirmDelete, setConfirmDelete] = useState(null); // { type, id }
  const [rekapConfirm, setRekapConfirm] = useState(null); // period yang akan didownload
  const [kirimModal, setKirimModal] = useState(null); // { orderId } untuk tandai dikirim
  const [tanggalKirim, setTanggalKirim] = useState(todayStr());

  // ── Forms ──
  const [orderForm, setOrderForm] = useState({ date: todayStr(), customer: "", phone: "", item: "", qty: "", total: 0, dp: 0 });
  const [purchaseForm, setPurchaseForm] = useState({ date: todayStr(), supplier: "", material: "", total: 0, dp: 0 });
  const [expenseForm, setExpenseForm] = useState({ date: "", category: "", note: "", amount: 0 });
  const [orderPayForm, setOrderPayForm] = useState({ orderId: "", date: todayStr(), note: "", amount: 0 });
  const [supplierPayForm, setSupplierPayForm] = useState({ purchaseId: "", date: todayStr(), note: "", amount: 0 });

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setPurchases([]);
      setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let loadedCount = 0;
    const checkDone = () => { loadedCount++; if (loadedCount === 3) setLoading(false); };

    const unsubOrders = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      checkDone();
    });

    const unsubPurchases = onSnapshot(collection(db, "purchases"), (snap) => {
      setPurchases(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      checkDone();
    });

    const unsubExpenses = onSnapshot(collection(db, "expenses"), (snap) => {
      setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      checkDone();
    });

    return () => {
      unsubOrders();
      unsubPurchases();
      unsubExpenses();
    };
  }, [user]);

  // ── Stats ──
  const stats = useMemo(() => {
    const totalOrderValue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const customerPaid = orders.reduce(
      (s, o) => s + (o.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0), 0
    );
    const receivable = totalOrderValue - customerPaid;
    const supplierTotal = purchases.reduce((s, p) => s + Number(p.total || 0), 0);
    const supplierPaid = purchases.reduce(
      (s, p) => s + (p.payments || []).reduce((a, x) => a + Number(x.amount || 0), 0), 0
    );
    const supplierDebt = supplierTotal - supplierPaid;
    const otherExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const cashOut = supplierPaid + otherExpense;
    const netCash = customerPaid - cashOut;
    return { customerPaid, cashOut, receivable, supplierDebt, netCash };
  }, [orders, purchases, expenses]);

  // ── Notifikasi: pesanan belum lunas > 7 hari ──
  const pesananTelat = useMemo(() => {
    const now = new Date();
    return orders.filter((o) => {
      if (o.status === "Lunas") return false; // skip yang sudah lunas
      const sisa = Number(o.total || 0) - (o.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      if (sisa <= 0) return false; // sudah lunas
      // cek tanggal pembayaran terakhir atau tanggal dibuat
      const lastPayStr = (o.payments || []).length > 0
        ? o.payments[o.payments.length - 1].date
        : (o.createdAt || null);
      if (!lastPayStr) return true; // data lama tanpa tanggal = tampilkan sebagai telat
      const lastPayDate = new Date(lastPayStr + "T00:00:00");
      if (isNaN(lastPayDate.getTime())) return true;
      const diffDays = Math.floor((now - lastPayDate) / (1000 * 60 * 60 * 24));
      return diffDays >= 7;
    });
  }, [orders]);

  // ── Search filter ──
  const q = search.toLowerCase();
  const filteredOrders = orders.filter(
    (o) => o.customer?.toLowerCase().includes(q) || o.invoice?.toLowerCase().includes(q) || o.item?.toLowerCase().includes(q)
  );
  const filteredPurchases = purchases.filter(
    (p) => p.supplier?.toLowerCase().includes(q) || p.material?.toLowerCase().includes(q)
  );
  const filteredExpenses = expenses.filter(
    (e) => e.category?.toLowerCase().includes(q) || e.note?.toLowerCase().includes(q)
  );

  // ── Invoice generator ──
  function generateInvoice() {
    const ts = Date.now().toString().slice(-5);
    return `ORD-${ts}`;
  }

  // ── CRUD ──
  async function addOrder() {
    if (!orderForm.customer || !orderForm.total) return alert("Nama customer & total wajib diisi");
    setIsSaving(true);
    try {
      const dp = Number(orderForm.dp || 0);
      const newOrder = {
        invoice: generateInvoice(),
        customer: orderForm.customer,
        phone: orderForm.phone || "",
        item: orderForm.item || "Pesanan Kerudung",
        qty: Number(orderForm.qty || 0),
        total: Number(orderForm.total || 0),
        status: "Proses",
        createdAt: orderForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Awal", amount: dp }] : [],
      };
      await addDoc(collection(db, "orders"), newOrder);
      setOrderForm({ date: todayStr(), customer: "", phone: "", item: "", qty: "", total: 0, dp: 0 });
      setModal(null);
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addPurchase() {
    if (!purchaseForm.supplier || !purchaseForm.total) return alert("Nama supplier & total wajib diisi");
    setIsSaving(true);
    try {
      const dp = Number(purchaseForm.dp || 0);
      const newPurchase = {
        supplier: purchaseForm.supplier,
        material: purchaseForm.material || "Bahan Baku",
        total: Number(purchaseForm.total || 0),
        createdAt: purchaseForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Supplier", amount: dp }] : [],
      };
      await addDoc(collection(db, "purchases"), newPurchase);
      setPurchaseForm({ date: todayStr(), supplier: "", material: "", total: 0, dp: 0 });
      setModal(null);
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addExpense() {
    if (!expenseForm.category || !expenseForm.amount) return alert("Kategori & nominal wajib diisi");
    setIsSaving(true);
    try {
      const newExpense = {
        date: expenseForm.date || todayStr(),
        category: expenseForm.category,
        note: expenseForm.note || "",
        amount: Number(expenseForm.amount || 0),
      };
      await addDoc(collection(db, "expenses"), newExpense);
      setExpenseForm({ date: "", category: "", note: "", amount: 0 });
      setModal(null);
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
  }

  // FIX: Bayar masuk dari customer
  async function addOrderPayment() {
    if (!orderPayForm.orderId) return alert("Pilih pesanan terlebih dahulu");
    if (!orderPayForm.amount) return alert("Nominal pembayaran wajib diisi");
    const order = orders.find((o) => o.id === orderPayForm.orderId);
    if (!order) return;
    setIsSaving(true);
    try {
      const newPayment = {
        date: orderPayForm.date || todayStr(),
        note: orderPayForm.note || "Pembayaran",
        amount: Number(orderPayForm.amount),
      };
      const updatedPayments = [...(order.payments || []), newPayment];
      await updateDoc(doc(db, "orders", order.id), { payments: updatedPayments });
      // Cek otomatis apakah sudah lunas
      await cekDanUpdateLunas(order.id, order.total, updatedPayments);
      setOrderPayForm({ orderId: "", date: todayStr(), note: "", amount: 0 });
      setModal(null);
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
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
      const updatedPayments = [...(purchase.payments || []), newPayment];
      await updateDoc(doc(db, "purchases", purchase.id), { payments: updatedPayments });
      setSupplierPayForm({ purchaseId: "", date: todayStr(), note: "", amount: 0 });
      setModal(null);
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteItem(type, id) {
    setConfirmDelete({ type, id });
  }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteDoc(doc(db, type, id));
    } catch (e) {
      alert("Gagal menghapus, cek koneksi internet.");
    }
  }

  // FIX: update status pesanan
  async function updateOrderStatus(orderId, newStatus, tanggal) {
    try {
      const payload = { status: newStatus };
      if (newStatus === "Selesai" && tanggal) payload.tanggalKirim = tanggal;
      await updateDoc(doc(db, "orders", orderId), payload);
    } catch (e) {
      alert("Gagal mengubah status, cek koneksi internet.");
    }
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
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
  }

  // Cek otomatis Lunas saat payment berubah
  async function cekDanUpdateLunas(orderId, total, updatedPayments) {
    const paid = updatedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    if (paid >= Number(total || 0) && Number(total || 0) > 0) {
      try {
        await updateDoc(doc(db, "orders", orderId), { status: "Lunas" });
      } catch (e) {
        // silent fail - onSnapshot akan update UI
      }
    }
  }

  async function saveEdit() {
    if (!editData) return;
    setIsSaving(true);
    try {
      const { type, id, ...payload } = editData;
      const cleanPayload = { ...payload };
      delete cleanPayload.id;
      await updateDoc(doc(db, type, id), cleanPayload);
      setEditData(null);
    } catch (e) {
      alert("Gagal menyimpan, cek koneksi internet.");
    } finally {
      setIsSaving(false);
    }
  }

  // ── CSV Export ──
  function downloadExcel(filename, rows, period) {
    const label = { day: "Harian", week: "Mingguan", month: "Bulanan", year: "Tahunan", all: "Semua Data" }[period] || "";
    const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const totalMasuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
    const totalKeluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
    const saldo = totalMasuk - totalKeluar;

    // Tab-separated agar terbaca di WPS Office, Google Sheets, dll di HP
    const SEP = "	";
    const lines_out = [
      `Gallery Kerudung - Rekap ${label}`,
      `Dicetak: ${today}	Total: ${rows.length} transaksi`,
      "",
      ["Tanggal","Jenis","Nama","Keterangan","Kas Masuk","Kas Keluar"].join(SEP),
      ...rows.map(r => [
        r.tanggal || "",
        r.jenis || "",
        r.nama || "",
        r.keterangan || "",
        r.masuk > 0 ? r.masuk : "",
        r.keluar > 0 ? r.keluar : "",
      ].join(SEP)),
      "",
      ["","","","TOTAL", totalMasuk, totalKeluar].join(SEP),
      ["","","","SALDO BERSIH", saldo, ""].join(SEP),
    ];
    const content_out = lines_out.join("\n");
    const blob = new Blob(["\uFEFF" + content_out], { type: "text/tab-separated-values;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename.replace(".xls","").replace(".csv","") + ".tsv";
    link.click();
  }

  function buildRows(period) {
    const rows = [];
    orders.forEach((order) => {
      (order.payments || []).forEach((pay) => {
        if (period === "all" || samePeriod(pay.date, period)) {
          rows.push({ tanggal: pay.date, jenis: "Kas Masuk", nama: order.customer, keterangan: order.invoice, masuk: pay.amount, keluar: 0 });
        }
      });
    });
    purchases.forEach((purchase) => {
      (purchase.payments || []).forEach((pay) => {
        if (period === "all" || samePeriod(pay.date, period)) {
          rows.push({ tanggal: pay.date, jenis: "Bayar Supplier", nama: purchase.supplier, keterangan: purchase.material, masuk: 0, keluar: pay.amount });
        }
      });
    });
    expenses.forEach((expense) => {
      if (period === "all" || samePeriod(expense.date, period)) {
        rows.push({ tanggal: expense.date, jenis: "Biaya", nama: expense.category, keterangan: expense.note, masuk: 0, keluar: expense.amount });
      }
    });
    rows.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
    return rows;
  }

  function downloadRekap(period) {
    setRekapConfirm(period);
  }

  function doDownloadRekap() {
    if (!rekapConfirm) return;
    const label = { day: "harian", week: "mingguan", month: "bulanan", year: "tahunan", all: "semua" }[rekapConfirm];
    const rows = buildRows(rekapConfirm);
    if (rows.length === 0) {
      alert("Tidak ada data untuk periode ini.");
      setRekapConfirm(null);
      return;
    }
    downloadExcel(`rekap-gallery-kerudung-${label}.csv`, rows, rekapConfirm);
    setRekapConfirm(null);
  }

  // ── Computed sisa per order ──
  function sisaOrder(order) {
    const paid = (order.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    return Number(order.total || 0) - paid;
  }

  function sisaPurchase(purchase) {
    const paid = (purchase.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    return Number(purchase.total || 0) - paid;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  // Loading auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pink-50">
        <div className="text-pink-600 text-lg font-semibold">Memuat...</div>
      </div>
    );
  }

  // Belum login → tampilkan halaman login
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6" style={{background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #ede9fe 100%)"}}>
        {/* Dekorasi bintang */}
        <div className="absolute top-10 left-6 text-3xl opacity-40">✨</div>
        <div className="absolute top-20 right-8 text-2xl opacity-30">💕</div>
        <div className="absolute bottom-20 left-10 text-2xl opacity-30">🌸</div>
        <div className="absolute bottom-10 right-6 text-3xl opacity-40">⭐</div>

        <div className="w-full max-w-sm rounded-3xl bg-white/80 backdrop-blur p-8 shadow-xl text-center" style={{border: "1.5px solid #f9a8d4"}}>
          {/* Logo area */}
          <div className="mb-2 text-4xl">🧕✨</div>
          <div className="mb-1 text-3xl font-bold" style={{background: "linear-gradient(135deg, #ec4899, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"}}>
            Gallery Kerudung
          </div>
          <div className="mb-6 text-sm font-medium" style={{color: "#c084fc"}}>💕 made by order 💕</div>

          {authError && (
            <div className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-500 border border-rose-100">
              {authError}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 font-bold text-white shadow-lg transition-all active:scale-95"
            style={{background: "linear-gradient(135deg, #ec4899, #a855f7)"}}
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 32.8 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8 12.9 4.8 4 13.7 4 24.8s8.9 20 20 20c11 0 19.5-7.7 19.5-20 0-1.3-.1-2.6-.3-3.8z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.4 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8c-7.5 0-14 4.2-17.7 9.9z"/>
              <path fill="#4CAF50" d="M24 44c4.9 0 9.3-1.8 12.7-4.6l-5.9-4.9C29 36.3 26.6 37 24 37c-5.3 0-9.6-3.2-11.3-7.8L6 34.2C9.7 39.8 16.3 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.4-4.6 5.8l5.9 4.9C40.2 35.2 44 30.4 44 24c0-1.3-.1-2.6-.4-4z"/>
            </svg>
            Masuk dengan Google
          </button>
          <p className="mt-4 text-xs" style={{color: "#c084fc"}}>✨ Hanya akun yang diizinkan ✨</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md" style={{background: "#fdf2f8"}}>
      {/* Header */}
      <div className="p-5 text-white relative overflow-hidden" style={{background: "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)"}}>
        {/* Dekorasi */}
        <div className="absolute top-2 right-24 text-2xl opacity-20">✨</div>
        <div className="absolute bottom-8 left-4 text-xl opacity-20">💕</div>
        <div className="absolute top-8 left-32 text-lg opacity-20">⭐</div>

        <div className="flex items-center justify-between relative z-10">
          <div>
            <div className="text-3xl font-bold tracking-tight">Gallery Kerudung</div>
            <div className="mt-1 text-sm font-medium opacity-80">💕 made by order ✨</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <img src="/logo-gk.png" className="h-16 w-16 rounded-2xl shadow-lg" alt="logo" style={{border: "2px solid rgba(255,255,255,0.4)"}} />
            <button
              onClick={handleLogout}
              className="rounded-full px-3 py-1 text-xs font-semibold text-white"
              style={{background: "rgba(255,255,255,0.25)", backdropFilter: "blur(4px)"}}
            >
              Keluar
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl px-4 py-3 flex items-center gap-3 relative z-10" style={{background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)"}}>
          <span>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari pesanan, supplier, biaya..."
            className="bg-transparent outline-none flex-1 text-white placeholder-pink-100 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-pink-200 font-bold">✕</button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <TabBar tab={tab} setTab={setTab} badgeCount={pesananTelat.length} />

      {loading && (
        <div className="flex justify-center py-10 text-slate-400">Memuat data...</div>
      )}

      {/* ── DASHBOARD TAB ── */}
      {!loading && tab === "dashboard" && (
        <>
          {/* Banner notifikasi pesanan telat */}
          {pesananTelat.length > 0 && (
            <div className="mx-4 mt-4 rounded-2xl bg-rose-50 border border-rose-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔔</span>
                <span className="font-bold text-rose-700">{pesananTelat.length} Pesanan Belum Bayar 7+ Hari</span>
              </div>
              <div className="space-y-2">
                {pesananTelat.map((o) => {
                  const sisa = Number(o.total || 0) - (o.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
                  return (
                    <div key={o.id} className="flex justify-between items-center bg-white rounded-xl px-3 py-2">
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{o.customer}</div>
                        <div className="text-xs text-slate-400">{o.invoice}</div>
                      </div>
                      <div className="text-sm font-bold text-rose-600">{rupiah(sisa)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 p-4">
            <Card title="Kas Masuk" value={stats.customerPaid} note="Cicilan pelanggan" bg="bg-emerald-50" icon="💚" />
            <Card title="Kas Keluar" value={stats.cashOut} note="Supplier + biaya" bg="bg-pink-50" icon="🌸" />
            <Card title="Piutang" value={stats.receivable} note="Tagihan pelanggan" bg="bg-purple-50" icon="💜" />
            <Card title="Hutang Supplier" value={stats.supplierDebt} note="Bahan baku" bg="bg-yellow-50" icon="⭐" />
          </div>

          <div className="px-4">
            <div className="rounded-3xl p-5 shadow-sm relative overflow-hidden" style={{background: "linear-gradient(135deg, #fdf2f8, #ede9fe)", border: "1.5px solid #f9a8d4"}}>
              <div className="absolute top-2 right-4 text-3xl opacity-20">💕</div>
              <div className="absolute bottom-2 left-4 text-2xl opacity-20">✨</div>
              <div className="text-sm font-semibold" style={{color: "#a855f7"}}>✨ Saldo Cashflow Saat Ini</div>
              <div className={`mt-3 text-5xl font-bold`} style={{color: stats.netCash >= 0 ? "#059669" : "#e11d48"}}>
                {rupiah(stats.netCash)}
              </div>
              <div className="mt-3 text-xs" style={{color: "#c084fc"}}>💕 Kas masuk dikurangi pembayaran supplier dan biaya lain</div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3 p-4">
            <Button onClick={() => setModal("order")} style={{background: "linear-gradient(135deg,#ec4899,#f472b6)"}}>🧕 Pesanan</Button>
            <Button onClick={() => setModal("pay")} style={{background: "linear-gradient(135deg,#10b981,#34d399)"}}>💚 Bayar Masuk</Button>
            <Button onClick={() => setModal("purchase")} style={{background: "linear-gradient(135deg,#a855f7,#c084fc)"}}>🛍️ Supplier</Button>
            <Button onClick={() => setModal("expense")} style={{background: "linear-gradient(135deg,#f59e0b,#fbbf24)"}}>💸 Pengeluaran</Button>
          </div>
          <div className="px-4 pb-2">
            <Button className="w-full" onClick={() => setModal("supplierPay")} style={{background: "linear-gradient(135deg,#f97316,#fb923c)"}}>
              🏪 Bayar Supplier
            </Button>
          </div>

          {/* Rekap */}
          <div className="px-4 pb-1">
            <div className="text-xs font-bold mb-2 mt-2" style={{color: "#a855f7"}}>📥 Download Rekap</div>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4">
            <Button onClick={() => downloadRekap("day")} style={{background: "linear-gradient(135deg,#10b981,#34d399)"}}>📅 Harian</Button>
            <Button onClick={() => downloadRekap("week")} style={{background: "linear-gradient(135deg,#3b82f6,#60a5fa)"}}>📅 Mingguan</Button>
            <Button onClick={() => downloadRekap("month")} style={{background: "linear-gradient(135deg,#ec4899,#f472b6)"}}>📅 Bulanan</Button>
            <Button onClick={() => downloadRekap("year")} style={{background: "linear-gradient(135deg,#6366f1,#818cf8)"}}>📅 Tahunan</Button>
          </div>
          <div className="px-4 pb-4 pt-2">
            <Button className="w-full" onClick={() => downloadRekap("all")} style={{background: "linear-gradient(135deg,#a855f7,#ec4899)"}}>💕 Semua Data</Button>
          </div>

          {/* Grafik Kas Masuk vs Kas Keluar */}
          <GrafikKas orders={orders} purchases={purchases} expenses={expenses} />

          {/* Grafik Pesanan per Bulan */}
          <GrafikPesanan orders={orders} />
        </>
      )}

      {/* ── ORDERS TAB ── */}
      {!loading && tab === "orders" && (
        <div className="space-y-4 p-4">
          <Button className="w-full bg-pink-600" onClick={() => setModal("order")}>+ Tambah Pesanan</Button>
          <Button className="w-full bg-emerald-600" onClick={() => setModal("pay")}>+ Catat Bayar Masuk</Button>

          {/* Filter & Sort */}
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none"
              value={filterOrder}
              onChange={(e) => setFilterOrder(e.target.value)}
            >
              <option value="semua">Semua</option>
              <option value="belum-lunas">Belum Lunas</option>
              <option value="lunas">Lunas</option>
            </select>
            <select
              className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm bg-white outline-none"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            >
              <option value="terbaru">Terbaru</option>
              <option value="terlama">Terlama</option>
            </select>
          </div>

          {(() => {
            let list = [...filteredOrders];
            if (filterOrder === "belum-lunas") list = list.filter(o => {
              const paid = (o.payments||[]).reduce((s,p) => s+Number(p.amount||0),0);
              return Number(o.total||0) - paid > 0;
            });
            if (filterOrder === "lunas") list = list.filter(o => {
              const paid = (o.payments||[]).reduce((s,p) => s+Number(p.amount||0),0);
              return Number(o.total||0) - paid <= 0;
            });
            if (sortOrder === "terbaru") list.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
            if (sortOrder === "terlama") list.sort((a,b) => (a.createdAt||"").localeCompare(b.createdAt||""));

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
                      <a href={`https://wa.me/62${o.phone.replace(/^0/,"")}`} target="_blank" rel="noreferrer"
                        className="text-xs text-emerald-600 font-semibold">📱 WA {o.phone}</a>
                    )}
                    <div className="text-sm text-slate-500">{o.invoice} · {o.item} · {o.qty} pcs</div>
                    {o.createdAt && <div className="text-xs text-slate-400">📅 {o.createdAt}</div>}
                    <div className="mt-1"><StatusBadge status={o.status} /></div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{rupiah(o.total)}</div>
                    <div className="text-sm text-rose-500">Sisa {rupiah(sisa)}</div>
                  </div>
                </div>

                {/* FIX: Riwayat pembayaran */}
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

                {/* Status otomatis */}
                <div className="mt-3 space-y-2">
                  {/* Tombol Tandai Dikirim - hanya tampil kalau status masih Proses */}
                  {o.status === "Proses" && (
                    <button
                      onClick={() => { setKirimModal(o.id); setTanggalKirim(todayStr()); }}
                      className="w-full rounded-2xl bg-sky-600 py-2 text-sm font-semibold text-white"
                    >
                      🚚 Tandai Dikirim
                    </button>
                  )}
                  {/* Info tanggal kirim kalau sudah Selesai/Lunas */}
                  {o.tanggalKirim && (
                    <div className="text-xs text-slate-400">🚚 Dikirim: {o.tanggalKirim}</div>
                  )}
                  {/* Lunas otomatis - tampilkan info */}
                  {o.status === "Lunas" && (
                    <div className="text-xs text-emerald-600 font-semibold">✅ Lunas otomatis</div>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    className="bg-emerald-500 flex-1"
                    onClick={() => setModal("invoice-" + o.id)}
                  >
                    Invoice
                  </Button>
                  <Button
                    className="bg-sky-600 flex-1"
                    onClick={() => setEditData({ type: "orders", ...o })}
                  >
                    Edit
                  </Button>
                  <Button
                    className="bg-rose-600 flex-1"
                    onClick={() => deleteItem("orders", o.id)}
                  >
                    Hapus
                  </Button>
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
          <Button className="w-full bg-yellow-500" onClick={() => setModal("purchase")}>+ Tambah Supplier</Button>
          <Button className="w-full bg-orange-500" onClick={() => setModal("supplierPay")}>+ Bayar Supplier</Button>

          {filteredPurchases.length === 0 && (
            <div className="text-center py-10 text-slate-400">Tidak ada data supplier</div>
          )}

          {filteredPurchases.map((p) => {
            const paid = (p.payments || []).reduce((s, x) => s + Number(x.amount || 0), 0);
            const sisa = Number(p.total || 0) - paid;
            return (
              <div key={p.id} className="rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-lg">{p.supplier}</div>
                    <div className="text-sm text-slate-500">{p.material}</div>
                    {p.createdAt && <div className="text-xs text-slate-400">📅 {p.createdAt}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{rupiah(p.total)}</div>
                    <div className="text-sm text-rose-500">Sisa hutang {rupiah(sisa)}</div>
                  </div>
                </div>

                {/* Riwayat pembayaran supplier */}
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
                  <Button
                    className="bg-sky-600 flex-1"
                    onClick={() => setEditData({ type: "purchases", ...p })}
                  >
                    Edit
                  </Button>
                  <Button
                    className="bg-rose-600 flex-1"
                    onClick={() => deleteItem("purchases", p.id)}
                  >
                    Hapus
                  </Button>
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

          {filteredExpenses.length === 0 && (
            <div className="text-center py-10 text-slate-400">Tidak ada pengeluaran</div>
          )}

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
                <Button
                  className="bg-sky-600 flex-1"
                  onClick={() => setEditData({ type: "expenses", ...e })}
                >
                  Edit
                </Button>
                <Button
                  className="bg-rose-600 flex-1"
                  onClick={() => deleteItem("expenses", e.id)}
                >
                  Hapus
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════
          MODALS
      ════════════════════════════════════════════ */}

      {/* Modal: Tambah Pesanan */}
      {modal === "order" && (
        <SimpleModal title="Tambah Pesanan" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal Pesanan" value={orderForm.date} onChange={(v) => setOrderForm({ ...orderForm, date: v })} />
            <Input label="Nama Customer" value={orderForm.customer} onChange={(v) => setOrderForm({ ...orderForm, customer: v })} />
            <Input label="No HP Customer (opsional)" type="number" value={orderForm.phone} onChange={(v) => setOrderForm({ ...orderForm, phone: v })} placeholder="08xxxxxxxxxx" />
            <Input label="Produk" value={orderForm.item} onChange={(v) => setOrderForm({ ...orderForm, item: v })} placeholder="Contoh: Kerudung Segiempat" />
            <Input label="Jumlah pcs" type="number" value={orderForm.qty} onChange={(v) => setOrderForm({ ...orderForm, qty: v })} />
            <Input label="Total Pesanan" type="money" value={orderForm.total} onChange={(v) => setOrderForm({ ...orderForm, total: v })} />
            <Input label="DP Awal (opsional)" type="money" value={orderForm.dp} onChange={(v) => setOrderForm({ ...orderForm, dp: v })} />
            <Button onClick={addOrder} className="w-full bg-pink-600">Simpan Pesanan</Button>
          </div>
        </SimpleModal>
      )}

      {/* Modal: Tambah Supplier */}
      {modal === "purchase" && (
        <SimpleModal title="Tambah Supplier" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal Belanja" value={purchaseForm.date} onChange={(v) => setPurchaseForm({ ...purchaseForm, date: v })} />
            <Input label="Nama Supplier" value={purchaseForm.supplier} onChange={(v) => setPurchaseForm({ ...purchaseForm, supplier: v })} />
            <Input label="Bahan" value={purchaseForm.material} onChange={(v) => setPurchaseForm({ ...purchaseForm, material: v })} />
            <Input label="Total" type="money" value={purchaseForm.total} onChange={(v) => setPurchaseForm({ ...purchaseForm, total: v })} />
            <Input label="DP Supplier (opsional)" type="money" value={purchaseForm.dp} onChange={(v) => setPurchaseForm({ ...purchaseForm, dp: v })} />
            <Button onClick={addPurchase} className="w-full bg-yellow-500">Simpan Supplier</Button>
          </div>
        </SimpleModal>
      )}

      {/* Modal: Tambah Pengeluaran */}
      {modal === "expense" && (
        <SimpleModal title="Tambah Pengeluaran" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal" value={expenseForm.date} onChange={(v) => setExpenseForm({ ...expenseForm, date: v })} />
            <Input label="Kategori" value={expenseForm.category} onChange={(v) => setExpenseForm({ ...expenseForm, category: v })} placeholder="Contoh: Ongkir, Listrik" />
            <Input label="Keterangan" value={expenseForm.note} onChange={(v) => setExpenseForm({ ...expenseForm, note: v })} />
            <Input label="Nominal" type="money" value={expenseForm.amount} onChange={(v) => setExpenseForm({ ...expenseForm, amount: v })} />
            <Button onClick={addExpense} className="w-full bg-slate-700">Simpan Pengeluaran</Button>
          </div>
        </SimpleModal>
      )}

      {/* FIX: Modal Bayar Masuk (customer) */}
      {modal === "pay" && (
        <SimpleModal title="Catat Bayar Masuk" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Select
              label="Pilih Pesanan"
              value={orderPayForm.orderId}
              onChange={(v) => setOrderPayForm({ ...orderPayForm, orderId: v })}
            >
              <option value="">-- Pilih Customer --</option>
              {orders
                .filter((o) => sisaOrder(o) > 0)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.customer} ({o.invoice}) — sisa {rupiah(sisaOrder(o))}
                  </option>
                ))}
            </Select>
            <DatePicker label="Tanggal" value={orderPayForm.date} onChange={(v) => setOrderPayForm({ ...orderPayForm, date: v })} />
            <Input label="Keterangan" value={orderPayForm.note} onChange={(v) => setOrderPayForm({ ...orderPayForm, note: v })} placeholder="Contoh: Pelunasan" />
            <Input label="Nominal" type="money" value={orderPayForm.amount} onChange={(v) => setOrderPayForm({ ...orderPayForm, amount: v })} />
            <Button onClick={addOrderPayment} className="w-full bg-emerald-600">Simpan Pembayaran</Button>
          </div>
        </SimpleModal>
      )}

      {/* FIX: Modal Bayar Supplier */}
      {modal === "supplierPay" && (
        <SimpleModal title="Bayar Supplier" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Select
              label="Pilih Supplier"
              value={supplierPayForm.purchaseId}
              onChange={(v) => setSupplierPayForm({ ...supplierPayForm, purchaseId: v })}
            >
              <option value="">-- Pilih Supplier --</option>
              {purchases
                .filter((p) => sisaPurchase(p) > 0)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.supplier} ({p.material}) — sisa hutang {rupiah(sisaPurchase(p))}
                  </option>
                ))}
            </Select>
            <DatePicker label="Tanggal" value={supplierPayForm.date} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, date: v })} />
            <Input label="Keterangan" value={supplierPayForm.note} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, note: v })} placeholder="Contoh: Pelunasan bahan" />
            <Input label="Nominal" type="money" value={supplierPayForm.amount} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, amount: v })} />
            <Button onClick={addSupplierPayment} className="w-full bg-orange-500">Simpan Pembayaran</Button>
          </div>
        </SimpleModal>
      )}

      {/* FIX: Modal Edit — lengkap per tipe */}
      {/* Modal Invoice */}
      {modal && modal.startsWith("invoice-") && (() => {
        const orderId = modal.replace("invoice-", "");
        const order = orders.find((o) => o.id === orderId);
        return order ? <InvoiceModal order={order} onClose={() => setModal(null)} /> : null;
      })()}

      {/* Modal konfirmasi download rekap */}
      {rekapConfirm && (() => {
        const labelMap = { day: "Harian", week: "Mingguan", month: "Bulanan", year: "Tahunan", all: "Semua Data" };
        const label = labelMap[rekapConfirm] || "";
        const rows = buildRows(rekapConfirm);
        const totalMasuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
        const totalKeluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
        const fmt = (n) => `Rp ${Number(n||0).toLocaleString("id-ID")}`;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
              <div className="text-xl font-bold text-slate-800 mb-1">Download Rekap {label}</div>
              <div className="text-slate-500 text-sm mb-4">Format: CSV (bisa dibuka di Google Sheets, WPS Office)</div>
              <div className="rounded-2xl bg-slate-50 p-4 space-y-2 mb-5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Total transaksi</span>
                  <span className="font-semibold">{rows.length} data</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Kas masuk</span>
                  <span className="font-semibold text-emerald-600">{fmt(totalMasuk)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Kas keluar</span>
                  <span className="font-semibold text-rose-500">{fmt(totalKeluar)}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="font-semibold text-slate-700">Saldo bersih</span>
                  <span className={`font-bold ${totalMasuk - totalKeluar >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{fmt(totalMasuk - totalKeluar)}</span>
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
            <DatePicker
              label="Tanggal Kirim"
              value={tanggalKirim}
              onChange={(v) => setTanggalKirim(v)}
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setKirimModal(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
              <button onClick={tandaiDikirim} className="flex-1 rounded-2xl bg-sky-600 py-3 font-semibold text-white">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal konfirmasi hapus */}
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

      {/* Loading overlay saat saving */}
      {isSaving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-2xl bg-white px-8 py-5 shadow-xl flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-pink-600 border-t-transparent rounded-full animate-spin"/>
            <span className="font-semibold text-slate-700">Menyimpan...</span>
          </div>
        </div>
      )}

      {editData && (
        <SimpleModal title="Edit Data" onClose={() => setEditData(null)}>
          <div className="space-y-3">
            {/* Orders */}
            {editData.type === "orders" && (
              <>
                <DatePicker label="Tanggal Pesanan" value={editData.createdAt || ""} onChange={(v) => setEditData({ ...editData, createdAt: v })} />
                <Input label="Nama Customer" value={editData.customer || ""} onChange={(v) => setEditData({ ...editData, customer: v })} />
                <Input label="No HP Customer" type="number" value={editData.phone || ""} onChange={(v) => setEditData({ ...editData, phone: v })} placeholder="08xxxxxxxxxx" />
                <Input label="Produk" value={editData.item || ""} onChange={(v) => setEditData({ ...editData, item: v })} />
                <Input label="Jumlah pcs" type="number" value={editData.qty || ""} onChange={(v) => setEditData({ ...editData, qty: v })} />
                <Input label="Total Pesanan" type="money" value={editData.total || 0} onChange={(v) => setEditData({ ...editData, total: v })} />
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Status</label>
                  <div className="flex gap-2">
                    {["Proses", "Selesai", "Lunas"].map((s) => (
                      <button
                        key={s}
                        onClick={() => setEditData({ ...editData, status: s })}
                        className={`rounded-full px-4 py-2 text-sm font-semibold border transition-all ${
                          editData.status === s
                            ? "bg-pink-600 text-white border-pink-600"
                            : "bg-white text-slate-500 border-slate-200"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Purchases */}
            {editData.type === "purchases" && (
              <>
                <DatePicker label="Tanggal Belanja" value={editData.createdAt || ""} onChange={(v) => setEditData({ ...editData, createdAt: v })} />
                <Input label="Nama Supplier" value={editData.supplier || ""} onChange={(v) => setEditData({ ...editData, supplier: v })} />
                <Input label="Bahan" value={editData.material || ""} onChange={(v) => setEditData({ ...editData, material: v })} />
                <Input label="Total" type="money" value={editData.total || 0} onChange={(v) => setEditData({ ...editData, total: v })} />
              </>
            )}

            {/* Expenses */}
            {editData.type === "expenses" && (
              <>
                <DatePicker label="Tanggal" value={editData.date || ""} onChange={(v) => setEditData({ ...editData, date: v })} />
                <Input label="Kategori" value={editData.category || ""} onChange={(v) => setEditData({ ...editData, category: v })} />
                <Input label="Keterangan" value={editData.note || ""} onChange={(v) => setEditData({ ...editData, note: v })} />
                <Input label="Nominal" type="money" value={editData.amount || 0} onChange={(v) => setEditData({ ...editData, amount: v })} />
              </>
            )}

            <Button onClick={saveEdit} className="w-full bg-sky-600">Simpan Perubahan</Button>
          </div>
        </SimpleModal>
      )}
    </div>
  );
}