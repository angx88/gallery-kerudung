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

function TabBar({ tab, setTab }) {
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
          <span className="text-lg">{t.icon}</span>
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

  // ── Forms ──
  const [orderForm, setOrderForm] = useState({ customer: "", item: "", qty: "", total: 0, dp: 0 });
  const [purchaseForm, setPurchaseForm] = useState({ supplier: "", material: "", total: 0, dp: 0 });
  const [expenseForm, setExpenseForm] = useState({ date: "", category: "", note: "", amount: 0 });
  const [orderPayForm, setOrderPayForm] = useState({ orderId: "", date: todayStr(), note: "", amount: 0 });
  const [supplierPayForm, setSupplierPayForm] = useState({ purchaseId: "", date: todayStr(), note: "", amount: 0 });

  useEffect(() => {
    if (!user) return;
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

    // Cleanup listeners saat komponen unmount
    return () => {
      unsubOrders();
      unsubPurchases();
      unsubExpenses();
    };
  }, []);

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
    return `ORD-${String(orders.length + 1).padStart(4, "0")}`;
  }

  // ── CRUD ──
  async function addOrder() {
    if (!orderForm.customer || !orderForm.total) return alert("Nama customer & total wajib diisi");
    const dp = Number(orderForm.dp || 0);
    const newOrder = {
      invoice: generateInvoice(),
      customer: orderForm.customer,
      item: orderForm.item || "Pesanan Kerudung",
      qty: Number(orderForm.qty || 0),
      total: Number(orderForm.total || 0),
      status: "Proses",
      createdAt: todayStr(),
      payments: dp > 0 ? [{ date: todayStr(), note: "DP Awal", amount: dp }] : [],
    };
    const docRef = await addDoc(collection(db, "orders"), newOrder);
    setOrders([{ id: docRef.id, ...newOrder }, ...orders]);
    setOrderForm({ customer: "", item: "", qty: "", total: 0, dp: 0 });
    setModal(null);
  }

  async function addPurchase() {
    if (!purchaseForm.supplier || !purchaseForm.total) return alert("Nama supplier & total wajib diisi");
    const dp = Number(purchaseForm.dp || 0);
    const newPurchase = {
      supplier: purchaseForm.supplier,
      material: purchaseForm.material || "Bahan Baku",
      total: Number(purchaseForm.total || 0),
      createdAt: todayStr(),
      payments: dp > 0 ? [{ date: todayStr(), note: "DP Supplier", amount: dp }] : [],
    };
    const docRef = await addDoc(collection(db, "purchases"), newPurchase);
    setPurchases([{ id: docRef.id, ...newPurchase }, ...purchases]);
    setPurchaseForm({ supplier: "", material: "", total: 0, dp: 0 });
    setModal(null);
  }

  async function addExpense() {
    if (!expenseForm.category || !expenseForm.amount) return alert("Kategori & nominal wajib diisi");
    const newExpense = {
      date: expenseForm.date || todayStr(),
      category: expenseForm.category,
      note: expenseForm.note || "",
      amount: Number(expenseForm.amount || 0),
    };
    const docRef = await addDoc(collection(db, "expenses"), newExpense);
    setExpenses([{ id: docRef.id, ...newExpense }, ...expenses]);
    setExpenseForm({ date: "", category: "", note: "", amount: 0 });
    setModal(null);
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
    if (!window.confirm("Yakin hapus data ini?")) return;
    await deleteDoc(doc(db, type, id));
    if (type === "orders") setOrders(orders.filter((x) => x.id !== id));
    if (type === "purchases") setPurchases(purchases.filter((x) => x.id !== id));
    if (type === "expenses") setExpenses(expenses.filter((x) => x.id !== id));
  }

  // FIX: update status pesanan
  async function updateOrderStatus(orderId, newStatus) {
    await updateDoc(doc(db, "orders", orderId), { status: newStatus });
    setOrders(orders.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
  }

  async function saveEdit() {
    if (!editData) return;
    const { type, id, ...payload } = editData;
    const cleanPayload = { ...payload };
    delete cleanPayload.id;
    await updateDoc(doc(db, type, id), cleanPayload);
    // onSnapshot otomatis update state, tidak perlu loadData()
    setEditData(null);
  }

  // ── CSV Export ──
  function downloadCSV(filename, rows) {
    const header = ["Tanggal", "Jenis", "Nama", "Keterangan", "Masuk", "Keluar"];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [r.tanggal, r.jenis, r.nama, r.keterangan, r.masuk, r.keluar]
          .map((v) => `"${String(v)}"`)
          .join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  function downloadRekap(period) {
    const rows = [];
    orders.forEach((order) => {
      (order.payments || []).forEach((pay) => {
        if (samePeriod(pay.date, period)) {
          rows.push({ tanggal: pay.date, jenis: "Kas Masuk", nama: order.customer, keterangan: order.invoice, masuk: pay.amount, keluar: 0 });
        }
      });
    });
    purchases.forEach((purchase) => {
      (purchase.payments || []).forEach((pay) => {
        if (samePeriod(pay.date, period)) {
          rows.push({ tanggal: pay.date, jenis: "Bayar Supplier", nama: purchase.supplier, keterangan: purchase.material, masuk: 0, keluar: pay.amount });
        }
      });
    });
    expenses.forEach((expense) => {
      if (samePeriod(expense.date, period)) {
        rows.push({ tanggal: expense.date, jenis: "Biaya", nama: expense.category, keterangan: expense.note, masuk: 0, keluar: expense.amount });
      }
    });
    const label = { day: "harian", week: "mingguan", month: "bulanan", year: "tahunan" }[period];
    downloadCSV(`rekap-gallery-kerudung-${label}.csv`, rows);
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
      <TabBar tab={tab} setTab={setTab} />

      {loading && (
        <div className="flex justify-center py-10 text-slate-400">Memuat data...</div>
      )}

      {/* ── DASHBOARD TAB ── */}
      {!loading && tab === "dashboard" && (
        <>
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

          {/* Rekap CSV */}
          <div className="grid grid-cols-2 gap-3 p-4">
            <Button className="bg-emerald-600" onClick={() => downloadRekap("day")}>Rekap Harian</Button>
            <Button className="bg-sky-600" onClick={() => downloadRekap("week")}>Rekap Mingguan</Button>
            <Button className="bg-pink-600" onClick={() => downloadRekap("month")}>Rekap Bulanan</Button>
            <Button className="bg-slate-700" onClick={() => downloadRekap("year")}>Rekap Tahunan</Button>
          </div>
        </>
      )}

      {/* ── ORDERS TAB ── */}
      {!loading && tab === "orders" && (
        <div className="space-y-4 p-4">
          <Button className="w-full bg-pink-600" onClick={() => setModal("order")}>+ Tambah Pesanan</Button>
          <Button className="w-full bg-emerald-600" onClick={() => setModal("pay")}>+ Catat Bayar Masuk</Button>

          {filteredOrders.length === 0 && (
            <div className="text-center py-10 text-slate-400">Tidak ada pesanan ditemukan</div>
          )}

          {filteredOrders.map((o) => {
            const paid = (o.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
            const sisa = Number(o.total || 0) - paid;
            return (
              <div key={o.id} className="rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-lg">{o.customer}</div>
                    <div className="text-sm text-slate-500">{o.invoice} · {o.item} · {o.qty} pcs</div>
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
          })}
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
            <Input label="Nama Customer" value={orderForm.customer} onChange={(v) => setOrderForm({ ...orderForm, customer: v })} />
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
      {editData && (
        <SimpleModal title="Edit Data" onClose={() => setEditData(null)}>
          <div className="space-y-3">
            {/* Orders */}
            {editData.type === "orders" && (
              <>
                <Input label="Nama Customer" value={editData.customer || ""} onChange={(v) => setEditData({ ...editData, customer: v })} />
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