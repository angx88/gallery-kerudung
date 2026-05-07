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
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-400"
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

function Button({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={`rounded-2xl px-4 py-3 font-semibold text-white transition-opacity active:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}

function Card({ title, value, note, bg }) {
  return (
    <div className={`rounded-3xl p-5 shadow-sm ${bg}`}>
      <div className="text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-bold">{rupiah(value)}</div>
      <div className="mt-3 text-slate-500">{note}</div>
    </div>
  );
}

function SimpleModal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30">
      <motion.div
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        className="max-h-[92vh] w-full overflow-auto rounded-t-[32px] bg-white p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-2xl bg-slate-100 px-4 py-2">
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
    { id: "orders", label: "Pesanan", icon: "📦" },
    { id: "purchases", label: "Supplier", icon: "🏭" },
    { id: "expenses", label: "Pengeluaran", icon: "💸" },
  ];
  return (
    <div className="sticky top-0 z-40 flex bg-white border-b border-slate-100 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`flex-1 py-3 text-xs font-semibold flex flex-col items-center gap-1 transition-colors ${
            tab === t.id ? "text-pink-600 border-b-2 border-pink-600" : "text-slate-400"
          }`}
        >
          <span className="relative text-lg">
            {t.icon}
            {t.id === "orders" && badgeCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-rose-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold" style={{fontSize: 9}}>
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

const STATUS_COLORS = {
  Proses: "bg-yellow-100 text-yellow-700",
  Selesai: "bg-sky-100 text-sky-700",
  Lunas: "bg-emerald-100 text-emerald-700",
};

function StatusBadge({ status }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
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
    drawRow("Tanggal", today, 178);
    drawRow("Customer", order.customer || "-", 201);
    drawRow("Produk", order.item || "Pesanan Kerudung", 224);
    drawRow("Qty", `${order.qty || 0} pcs`, 247);

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

  function shareWhatsApp() {
    const sisa = Number(order.total || 0) - (order.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const text = `*INVOICE - Gallery Kerudung*
📱 087822864625

No: ${order.invoice}
Customer: ${order.customer}
Produk: ${order.item} (${order.qty} pcs)
Total: Rp ${Number(order.total||0).toLocaleString("id-ID")}
Sisa: Rp ${sisa.toLocaleString("id-ID")}
Status: ${order.status}

_Terima kasih sudah berbelanja! 💕_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  function downloadInvoice() {
    const link = document.createElement("a");
    link.download = `invoice-${order.invoice}.png`;
    link.href = imgUrl;
    link.click();
  }

  // Auto bagikan ke WA saat gambar siap
  React.useEffect(() => {
    if (imgUrl) shareWhatsApp();
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
          <Button onClick={shareWhatsApp} className="w-full bg-emerald-600">
            📤 Bagikan via WhatsApp
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
      const date = new Date(d || Date.now());
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
      const date = new Date((o.createdAt || "") + "T00:00:00" || Date.now());
      const k = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
    const newPayment = {
      date: orderPayForm.date || todayStr(),
      note: orderPayForm.note || "Pembayaran",
      amount: Number(orderPayForm.amount),
    };
    const updatedPayments = [...(order.payments || []), newPayment];
    await updateDoc(doc(db, "orders", order.id), { payments: updatedPayments });
    setOrders(orders.map((o) => o.id === order.id ? { ...o, payments: updatedPayments } : o));
    setOrderPayForm({ orderId: "", date: todayStr(), note: "", amount: 0 });
    setModal(null);
  }

  // FIX: Bayar supplier
  async function addSupplierPayment() {
    if (!supplierPayForm.purchaseId) return alert("Pilih supplier terlebih dahulu");
    if (!supplierPayForm.amount) return alert("Nominal pembayaran wajib diisi");
    const purchase = purchases.find((p) => p.id === supplierPayForm.purchaseId);
    if (!purchase) return;
    const newPayment = {
      date: supplierPayForm.date || todayStr(),
      note: supplierPayForm.note || "Pembayaran Supplier",
      amount: Number(supplierPayForm.amount),
    };
    const updatedPayments = [...(purchase.payments || []), newPayment];
    await updateDoc(doc(db, "purchases", purchase.id), { payments: updatedPayments });
    setPurchases(purchases.map((p) => p.id === purchase.id ? { ...p, payments: updatedPayments } : p));
    setSupplierPayForm({ purchaseId: "", date: todayStr(), note: "", amount: 0 });
    setModal(null);
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
  async function updateOrderStatus(orderId, newStatus) {
    await updateDoc(doc(db, "orders", orderId), { status: newStatus });
    setOrders(orders.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
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
    const fmt = (n) => Number(n || 0).toLocaleString("id-ID");

    // Pakai CSV agar bisa dibuka di semua HP dan aplikasi spreadsheet
    const header = ["Tanggal","Jenis","Nama","Keterangan","Kas Masuk","Kas Keluar"];
    const infoRows = [
      [`Gallery Kerudung - Rekap ${label}`,"","","","",""],
      [`Dicetak: ${today}`,`Total: ${rows.length} transaksi`,"","","",""],
      [],
      header,
    ];
    const dataRows = rows.map(r => [
      r.tanggal,
      r.jenis,
      r.nama,
      r.keterangan,
      r.masuk > 0 ? r.masuk : "",
      r.keluar > 0 ? r.keluar : "",
    ]);
    const totalRow = ["","","","TOTAL", totalMasuk, totalKeluar];
    const saldoRow = ["","","","SALDO BERSIH", saldo >= 0 ? saldo : "", saldo < 0 ? Math.abs(saldo) : ""];

    const allRows = [...infoRows, ...dataRows, [], totalRow, saldoRow];
    const csv = allRows.map(row =>
      row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("
");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename.replace(".xls", ".csv");
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
    const label = { day: "harian", week: "mingguan", month: "bulanan", year: "tahunan", all: "semua" }[period];
    downloadExcel(`rekap-gallery-kerudung-${label}.xls`, buildRows(period), period);
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-pink-50 p-6">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-lg text-center">
          <div className="mb-2 text-5xl font-bold text-pink-600">Gallery</div>
          <div className="mb-1 text-5xl font-bold text-pink-600">Kerudung</div>
          <div className="mb-8 text-slate-400">made by order</div>
          {authError && (
            <div className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-600">
              {authError}
            </div>
          )}
          <button
            onClick={handleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 32.8 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8 12.9 4.8 4 13.7 4 24.8s8.9 20 20 20c11 0 19.5-7.7 19.5-20 0-1.3-.1-2.6-.3-3.8z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.4 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8c-7.5 0-14 4.2-17.7 9.9z"/>
              <path fill="#4CAF50" d="M24 44c4.9 0 9.3-1.8 12.7-4.6l-5.9-4.9C29 36.3 26.6 37 24 37c-5.3 0-9.6-3.2-11.3-7.8L6 34.2C9.7 39.8 16.3 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.4-4.6 5.8l5.9 4.9C40.2 35.2 44 30.4 44 24c0-1.3-.1-2.6-.4-4z"/>
            </svg>
            Masuk dengan Google
          </button>
          <p className="mt-4 text-xs text-slate-400">Hanya akun yang diizinkan yang bisa masuk</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-100">
      {/* Header */}
      <div className="bg-pink-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-4xl font-bold">Gallery Kerudung</div>
            <div className="mt-2 text-2xl">made by order</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <img src="/logo-gk.png" className="h-20 w-20 rounded-3xl" alt="logo" />
            <button
              onClick={handleLogout}
              className="rounded-full bg-pink-500 px-3 py-1 text-xs font-semibold text-white"
            >
              Keluar
            </button>
          </div>
        </div>
        <div className="mt-6 rounded-full bg-pink-500 px-5 py-4 flex items-center gap-3">
          <span>🔎</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari pesanan, supplier, biaya..."
            className="bg-transparent outline-none flex-1 text-white placeholder-pink-200"
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

          <div className="grid grid-cols-2 gap-4 p-4">
            <Card title="Kas Masuk" value={stats.customerPaid} note="Cicilan pelanggan" bg="bg-emerald-50" />
            <Card title="Kas Keluar" value={stats.cashOut} note="Supplier + biaya" bg="bg-rose-50" />
            <Card title="Piutang" value={stats.receivable} note="Tagihan pelanggan" bg="bg-sky-50" />
            <Card title="Hutang Supplier" value={stats.supplierDebt} note="Bahan baku" bg="bg-yellow-50" />
          </div>

          <div className="px-4">
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="text-2xl text-slate-500">Saldo Cashflow Saat Ini</div>
              <div className={`mt-5 text-6xl font-bold ${stats.netCash >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {rupiah(stats.netCash)}
              </div>
              <div className="mt-5 text-slate-500">Kas masuk dikurangi pembayaran supplier dan biaya lain.</div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-4 p-4">
            <Button className="bg-pink-600" onClick={() => setModal("order")}>+ Pesanan</Button>
            {/* FIX: modal "pay" sekarang berfungsi */}
            <Button className="bg-emerald-600" onClick={() => setModal("pay")}>+ Bayar Masuk</Button>
            <Button className="bg-yellow-500" onClick={() => setModal("purchase")}>+ Supplier</Button>
            <Button className="bg-slate-700" onClick={() => setModal("expense")}>+ Pengeluaran</Button>
          </div>

          {/* FIX: Tambah tombol Bayar Supplier di dashboard */}
          <div className="px-4 pb-2">
            <Button className="w-full bg-orange-500" onClick={() => setModal("supplierPay")}>
              + Bayar Supplier
            </Button>
          </div>

          {/* Rekap Excel */}
          <div className="px-4 pb-1">
            <div className="text-xs font-semibold text-slate-400 mb-2 mt-2">📥 Download Rekap Excel</div>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4">
            <Button className="bg-emerald-600" onClick={() => downloadRekap("day")}>📅 Harian</Button>
            <Button className="bg-sky-600" onClick={() => downloadRekap("week")}>📅 Mingguan</Button>
            <Button className="bg-pink-600" onClick={() => downloadRekap("month")}>📅 Bulanan</Button>
            <Button className="bg-slate-700" onClick={() => downloadRekap("year")}>📅 Tahunan</Button>
          </div>
          <div className="px-4 pb-4 pt-2">
            <Button className="w-full bg-indigo-600" onClick={() => downloadRekap("all")}>📊 Semua Data</Button>
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

                {/* FIX: Ubah status */}
                <div className="mt-3">
                  <div className="text-xs text-slate-400 mb-1">Ubah Status:</div>
                  <div className="flex gap-2">
                    {["Proses", "Selesai", "Lunas"].map((s) => (
                      <button
                        key={s}
                        onClick={() => updateOrderStatus(o.id, s)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
                          o.status === s
                            ? "bg-pink-600 text-white border-pink-600"
                            : "bg-white text-slate-500 border-slate-200"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
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