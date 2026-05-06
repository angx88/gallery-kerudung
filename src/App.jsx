import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

function Card({ className = "", children }) {
  return <div className={className}>{children}</div>;
}

function CardContent({ className = "", children }) {
  return <div className={className}>{children}</div>;
}

function Button({ className = "", children, onClick, size }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold text-white ${className}`}>
      {children}
    </button>
  );
}

const makeIcon = (symbol) => function Icon({ size = 20, className = "" }) {
  return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{symbol}</span>;
};

const Plus = makeIcon("+");
const Search = makeIcon("🔍");
const Wallet = makeIcon("💰");
const ShoppingBag = makeIcon("🛍️");
const TrendingUp = makeIcon("📈");
const TrendingDown = makeIcon("📉");
const Users = makeIcon("👥");
const Package = makeIcon("📦");
const ClipboardList = makeIcon("📋");
const ReceiptText = makeIcon("🧾");
const Factory = makeIcon("🏭");
const CheckCircle2 = makeIcon("✅");
const Clock = makeIcon("⏳");

const rupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

const initialOrders = [];

const initialPurchases = [];

const initialExpenses = [];

function sumPayments(rows) {
  return rows.reduce((total, row) => total + row.payments.reduce((s, p) => s + p.amount, 0), 0);
}

function ProgressBar({ value }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function StatCard({ title, value, icon: Icon, sub, tone = "default" }) {
  const toneClass = {
    default: "bg-white",
    income: "bg-emerald-50",
    expense: "bg-rose-50",
    debt: "bg-amber-50",
    receivable: "bg-sky-50",
  }[tone];

  return (
    <Card className={`${toneClass} border-none shadow-sm rounded-2xl`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">{title}</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{value}</h3>
            {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
          </div>
          <div className="rounded-2xl bg-white p-2 shadow-sm">
            <Icon size={20} className="text-rose-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      {action}
    </div>
  );
}

function OrderCard({ order }) {
  const paid = order.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = order.total - paid;
  const percent = (paid / order.total) * 100;

  return (
    <Card className="rounded-2xl border-none shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">{order.customer}</h3>
            <p className="text-xs font-semibold text-rose-600">{order.invoice}</p>
            <p className="text-sm text-slate-500">{order.item} • {order.qty} pcs</p>
          </div>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">{order.status}</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-slate-500">Total</p>
            <p className="font-semibold">{rupiah(order.total)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Dibayar</p>
            <p className="font-semibold text-emerald-600">{rupiah(paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Sisa</p>
            <p className="font-semibold text-rose-600">{rupiah(remaining)}</p>
          </div>
        </div>

        <div className="mt-3">
          <ProgressBar value={percent} />
          
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-600">Riwayat Bayar Pelanggan</p>
          <div className="space-y-2">
            {order.payments.map((pay, index) => (
              <div key={index} className="flex justify-between text-sm">
                <span className="text-slate-600">{pay.date} — {pay.note}</span>
                <span className="font-semibold">{rupiah(pay.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PurchaseCard({ purchase }) {
  const paid = purchase.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = purchase.total - paid;
  const percent = (paid / purchase.total) * 100;

  return (
    <Card className="rounded-2xl border-none shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">{purchase.supplier}</h3>
            <p className="text-sm text-slate-500">{purchase.material}</p>
          </div>
          {remaining <= 0 ? (
            <CheckCircle2 size={22} className="text-emerald-500" />
          ) : (
            <Clock size={22} className="text-amber-500" />
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-slate-500">Total</p>
            <p className="font-semibold">{rupiah(purchase.total)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Dibayar</p>
            <p className="font-semibold text-emerald-600">{rupiah(paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Hutang</p>
            <p className="font-semibold text-amber-600">{rupiah(remaining)}</p>
          </div>
        </div>

        <div className="mt-3">
          <ProgressBar value={percent} />
          
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-600">Riwayat Bayar Supplier</p>
          <div className="space-y-2">
            {purchase.payments.map((pay, index) => (
              <div key={index} className="flex justify-between text-sm">
                <span className="text-slate-600">{pay.date} — {pay.note}</span>
                <span className="font-semibold">{rupiah(pay.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-rose-400"
      />
    </label>
  );
}

function SimpleModal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1 text-sm">Tutup</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const DATA_VERSION = "empty-start-v2";

if (localStorage.getItem("gk_data_version") !== DATA_VERSION) {
  localStorage.removeItem("gk_orders");
  localStorage.removeItem("gk_purchases");
  localStorage.removeItem("gk_expenses");
  localStorage.setItem("gk_data_version", DATA_VERSION);
}
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [orders, setOrders] = useState(() => JSON.parse(localStorage.getItem("gk_orders") || "null") || initialOrders);
  const [purchases, setPurchases] = useState(() => JSON.parse(localStorage.getItem("gk_purchases") || "null") || initialPurchases);
  const [expenses, setExpenses] = useState(() => JSON.parse(localStorage.getItem("gk_expenses") || "null") || initialExpenses);

  const [orderForm, setOrderForm] = useState({ customer: "", item: "", qty: "", total: "", dp: "" });
  const [orderPayForm, setOrderPayForm] = useState({ orderId: "", date: "", note: "", amount: "" });
  const [purchaseForm, setPurchaseForm] = useState({ supplier: "", material: "", total: "", dp: "" });
  const [supplierPayForm, setSupplierPayForm] = useState({ purchaseId: "", date: "", note: "", amount: "" });
  const [expenseForm, setExpenseForm] = useState({ date: "", category: "", note: "", amount: "" });
  const [restoreText, setRestoreText] = useState("");

  useEffect(() => localStorage.setItem("gk_orders", JSON.stringify(orders)), [orders]);
  useEffect(() => localStorage.setItem("gk_purchases", JSON.stringify(purchases)), [purchases]);
  useEffect(() => localStorage.setItem("gk_expenses", JSON.stringify(expenses)), [expenses]);

  const stats = useMemo(() => {
    const totalOrderValue = orders.reduce((s, o) => s + o.total, 0);
    const customerPaid = sumPayments(orders);
    const receivable = totalOrderValue - customerPaid;
    const supplierTotal = purchases.reduce((s, p) => s + p.total, 0);
    const supplierPaid = sumPayments(purchases);
    const supplierDebt = supplierTotal - supplierPaid;
    const otherExpense = expenses.reduce((s, e) => s + e.amount, 0);
    const totalCashOut = supplierPaid + otherExpense;
    const netCash = customerPaid - totalCashOut;

    return { totalOrderValue, customerPaid, receivable, supplierTotal, supplierPaid, supplierDebt, otherExpense, totalCashOut, netCash };
  }, [orders, purchases, expenses]);

  const generateInvoice = () => {
    const nextNumber = orders.length + 1;
    return `ORD-${String(nextNumber).padStart(4, "0")}`;
  };

  const addOrder = () => {
    if (!orderForm.customer || !orderForm.total) return;
    const dp = Number(orderForm.dp || 0);
    const newOrder = {
      id: Date.now(),
      invoice: generateInvoice(),
      customer: orderForm.customer,
      item: orderForm.item || "Pesanan Kerudung",
      qty: Number(orderForm.qty || 0),
      total: Number(orderForm.total || 0),
      status: "Proses",
      payments: dp > 0 ? [{ date: "Hari ini", note: "DP Awal", amount: dp }] : [],
    };
    setOrders([newOrder, ...orders]);
    setOrderForm({ customer: "", item: "", qty: "", total: "", dp: "" });
    setModal(null);
  };

  const addOrderPayment = () => {
    if (!orderPayForm.orderId || !orderPayForm.amount) return;
    setOrders(orders.map((o) => o.id === Number(orderPayForm.orderId) ? {
      ...o,
      payments: [...o.payments, { date: orderPayForm.date || "Hari ini", note: orderPayForm.note || "Pembayaran", amount: Number(orderPayForm.amount) }],
    } : o));
    setOrderPayForm({ orderId: "", date: "", note: "", amount: "" });
    setModal(null);
  };

  const addPurchase = () => {
    if (!purchaseForm.supplier || !purchaseForm.total) return;
    const dp = Number(purchaseForm.dp || 0);
    const newPurchase = {
      id: Date.now(),
      supplier: purchaseForm.supplier,
      material: purchaseForm.material || "Bahan Baku",
      total: Number(purchaseForm.total || 0),
      payments: dp > 0 ? [{ date: "Hari ini", note: "DP Supplier", amount: dp }] : [],
    };
    setPurchases([newPurchase, ...purchases]);
    setPurchaseForm({ supplier: "", material: "", total: "", dp: "" });
    setModal(null);
  };

  const addSupplierPayment = () => {
    if (!supplierPayForm.purchaseId || !supplierPayForm.amount) return;
    setPurchases(purchases.map((p) => p.id === Number(supplierPayForm.purchaseId) ? {
      ...p,
      payments: [...p.payments, { date: supplierPayForm.date || "Hari ini", note: supplierPayForm.note || "Pembayaran", amount: Number(supplierPayForm.amount) }],
    } : p));
    setSupplierPayForm({ purchaseId: "", date: "", note: "", amount: "" });
    setModal(null);
  };

  const addExpense = () => {
    if (!expenseForm.category || !expenseForm.amount) return;
    setExpenses([{ id: Date.now(), date: expenseForm.date || "Hari ini", category: expenseForm.category, note: expenseForm.note, amount: Number(expenseForm.amount) }, ...expenses]);
    setExpenseForm({ date: "", category: "", note: "", amount: "" });
    setModal(null);
  };

  const backupData = () => {
    const data = JSON.stringify({ orders, purchases, expenses }, null, 2);
    navigator.clipboard?.writeText(data);
    setRestoreText(data);
    setModal("backup");
  };

  const restoreData = () => {
    try {
      const data = JSON.parse(restoreText);
      if (!Array.isArray(data.orders) || !Array.isArray(data.purchases) || !Array.isArray(data.expenses)) return;
      setOrders(data.orders);
      setPurchases(data.purchases);
      setExpenses(data.expenses);
      setModal(null);
    } catch (error) {
      alert("Format backup tidak valid");
    }
  };

  const resetData = () => {
    const ok = confirm("Yakin hapus semua data dan kembali ke contoh awal?");
    if (!ok) return;
    setOrders(initialOrders);
    setPurchases(initialPurchases);
    setExpenses(initialExpenses);
    localStorage.removeItem("gk_orders");
    localStorage.removeItem("gk_purchases");
    localStorage.removeItem("gk_expenses");
    setModal(null);
  };

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: TrendingUp },
    { id: "orders", label: "Pesanan", icon: ClipboardList },
    { id: "materials", label: "Bahan", icon: Package },
    { id: "expenses", label: "Biaya", icon: ReceiptText },
    { id: "settings", label: "Backup", icon: Wallet },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-md pb-24">
        <header className="sticky top-0 z-10 bg-gradient-to-br from-rose-700 to-pink-600 px-5 pb-5 pt-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Gallery Kerudung</h1>
              <p className="text-sm text-rose-100 mt-1">made by order</p>
            </div>
            <div className="rounded-2xl bg-white/15 p-2">
              <img
                src="/logo-gk.png"
                alt="Gallery Kerudung"
                className="h-14 w-14 rounded-2xl object-cover bg-white"
              />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 backdrop-blur">
            <Search size={18} />
            <input className="w-full bg-transparent text-sm outline-none placeholder:text-rose-100" placeholder="Cari pesanan, supplier, biaya..." />
          </div>
        </header>

        <main className="p-4">
          {tab === "dashboard" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <StatCard title="Kas Masuk" value={rupiah(stats.customerPaid)} icon={TrendingUp} tone="income" sub="Cicilan pelanggan" />
                <StatCard title="Kas Keluar" value={rupiah(stats.totalCashOut)} icon={TrendingDown} tone="expense" sub="Supplier + biaya" />
                <StatCard title="Piutang" value={rupiah(stats.receivable)} icon={Wallet} tone="receivable" sub="Tagihan pelanggan" />
                <StatCard title="Hutang Supplier" value={rupiah(stats.supplierDebt)} icon={ShoppingBag} tone="debt" sub="Bahan baku" />
              </div>
              <Card className="rounded-3xl border-none shadow-sm"><CardContent className="p-5">
                <p className="text-sm text-slate-500">Saldo Cashflow Saat Ini</p>
                <h2 className={`mt-1 text-3xl font-extrabold ${stats.netCash >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{rupiah(stats.netCash)}</h2>
                <p className="mt-2 text-sm text-slate-500">Kas masuk dikurangi pembayaran supplier dan biaya lain.</p>
              </CardContent></Card>
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={() => setModal("order")} className="rounded-2xl bg-rose-600 py-6"><Plus size={18} /> Pesanan</Button>
                <Button onClick={() => setModal("payment")} className="rounded-2xl bg-emerald-600 py-6"><Plus size={18} /> Bayar Masuk</Button>
                <Button onClick={() => setModal("purchase")} className="rounded-2xl bg-amber-600 py-6"><Plus size={18} /> Beli Bahan</Button>
                <Button onClick={() => setModal("expense")} className="rounded-2xl bg-slate-700 py-6"><Plus size={18} /> Biaya</Button>
              </div>
              <div>
                <SectionTitle title="Pesanan Terbaru" />
                <div className="space-y-3">{orders.slice(0, 2).map((order) => <OrderCard key={order.id} order={order} />)}</div>
              </div>
            </motion.div>
          )}

          {tab === "orders" && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <SectionTitle title="Pesanan & Cicilan Pelanggan" action={<div className="flex gap-2"><Button size="sm" onClick={() => setModal("payment")} className="rounded-full bg-emerald-600">Bayar</Button><Button size="sm" onClick={() => setModal("order")} className="rounded-full bg-rose-600"><Plus size={16} /> Pesanan</Button></div>} />
            {orders.map((order) => <OrderCard key={order.id} order={order} />)}
          </motion.div>}

          {tab === "materials" && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <SectionTitle title="Pembelian Bahan & Hutang Supplier" action={<div className="flex gap-2"><Button size="sm" onClick={() => setModal("supplierPay")} className="rounded-full bg-emerald-600">Bayar</Button><Button size="sm" onClick={() => setModal("purchase")} className="rounded-full bg-rose-600"><Plus size={16} /> Bahan</Button></div>} />
            {purchases.map((purchase) => <PurchaseCard key={purchase.id} purchase={purchase} />)}
          </motion.div>}

          {tab === "expenses" && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <SectionTitle title="Pengeluaran Lain" action={<Button size="sm" onClick={() => setModal("expense")} className="rounded-full bg-rose-600"><Plus size={16} /> Biaya</Button>} />
            {expenses.map((expense) => <Card key={expense.id} className="rounded-2xl border-none shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><h3 className="font-bold text-slate-900">{expense.category}</h3><p className="text-sm text-slate-500">{expense.date} — {expense.note}</p></div><p className="font-bold text-rose-600">{rupiah(expense.amount)}</p></CardContent></Card>)}
          </motion.div>}

          {tab === "settings" && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <SectionTitle title="Backup Data Gratis" />
            <Card className="rounded-2xl border-none shadow-sm"><CardContent className="space-y-3 p-4">
              <p className="text-sm text-slate-600">Data versi gratis tersimpan di browser HP. Gunakan backup untuk menyalin data ke catatan/WhatsApp/Google Drive pribadi.</p>
              <Button onClick={backupData} className="w-full rounded-2xl bg-emerald-600 py-6">Copy Backup Data</Button>
              <Button onClick={() => setModal("restore")} className="w-full rounded-2xl bg-sky-600 py-6">Restore dari Backup</Button>
              <Button onClick={resetData} className="w-full rounded-2xl bg-slate-700 py-6">Reset ke Data Contoh</Button>
            </CardContent></Card>
          </motion.div>}
        </main>

        <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t bg-white px-3 py-2 shadow-2xl">
          <div className="grid grid-cols-5 gap-1">{nav.map((item) => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-xs transition ${active ? "bg-rose-50 text-rose-700" : "text-slate-500"}`}><Icon size={20} /><span>{item.label}</span></button>; })}</div>
        </nav>
      </div>

      {modal === "order" && <SimpleModal title="Tambah Pesanan" onClose={() => setModal(null)}><div className="space-y-3"><Input label="Nama Customer" value={orderForm.customer} onChange={(v) => setOrderForm({ ...orderForm, customer: v })} /><Input label="Produk" value={orderForm.item} onChange={(v) => setOrderForm({ ...orderForm, item: v })} /><Input label="Jumlah pcs" type="number" value={orderForm.qty} onChange={(v) => setOrderForm({ ...orderForm, qty: v })} /><Input label="Total Pesanan" type="number" value={orderForm.total} onChange={(v) => setOrderForm({ ...orderForm, total: v })} /><Input label="DP Awal" type="number" value={orderForm.dp} onChange={(v) => setOrderForm({ ...orderForm, dp: v })} /><Button onClick={addOrder} className="w-full rounded-2xl bg-rose-600 py-6">Simpan Pesanan</Button></div></SimpleModal>}

      {modal === "payment" && <SimpleModal title="Tambah Cicilan Pelanggan" onClose={() => setModal(null)}><div className="space-y-3"><label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Pilih Pesanan</span><select value={orderPayForm.orderId} onChange={(e) => setOrderPayForm({ ...orderPayForm, orderId: e.target.value })} className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm"><option value="">Pilih...</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.customer} — {o.invoice}</option>)}</select></label><Input label="Tanggal" value={orderPayForm.date} onChange={(v) => setOrderPayForm({ ...orderPayForm, date: v })} /><Input label="Keterangan" value={orderPayForm.note} onChange={(v) => setOrderPayForm({ ...orderPayForm, note: v })} /><Input label="Nominal Bayar" type="number" value={orderPayForm.amount} onChange={(v) => setOrderPayForm({ ...orderPayForm, amount: v })} /><Button onClick={addOrderPayment} className="w-full rounded-2xl bg-emerald-600 py-6">Simpan Pembayaran</Button></div></SimpleModal>}

      {modal === "purchase" && <SimpleModal title="Tambah Pembelian Bahan" onClose={() => setModal(null)}><div className="space-y-3"><Input label="Supplier" value={purchaseForm.supplier} onChange={(v) => setPurchaseForm({ ...purchaseForm, supplier: v })} /><Input label="Nama Bahan" value={purchaseForm.material} onChange={(v) => setPurchaseForm({ ...purchaseForm, material: v })} /><Input label="Total Pembelian" type="number" value={purchaseForm.total} onChange={(v) => setPurchaseForm({ ...purchaseForm, total: v })} /><Input label="DP Supplier" type="number" value={purchaseForm.dp} onChange={(v) => setPurchaseForm({ ...purchaseForm, dp: v })} /><Button onClick={addPurchase} className="w-full rounded-2xl bg-amber-600 py-6">Simpan Pembelian</Button></div></SimpleModal>}

      {modal === "supplierPay" && <SimpleModal title="Tambah Cicilan Supplier" onClose={() => setModal(null)}><div className="space-y-3"><label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Pilih Pembelian</span><select value={supplierPayForm.purchaseId} onChange={(e) => setSupplierPayForm({ ...supplierPayForm, purchaseId: e.target.value })} className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm"><option value="">Pilih...</option>{purchases.map((p) => <option key={p.id} value={p.id}>{p.supplier} - {rupiah(p.total)}</option>)}</select></label><Input label="Tanggal" value={supplierPayForm.date} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, date: v })} /><Input label="Keterangan" value={supplierPayForm.note} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, note: v })} /><Input label="Nominal Bayar" type="number" value={supplierPayForm.amount} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, amount: v })} /><Button onClick={addSupplierPayment} className="w-full rounded-2xl bg-emerald-600 py-6">Simpan Pembayaran Supplier</Button></div></SimpleModal>}

      {modal === "expense" && <SimpleModal title="Tambah Pengeluaran" onClose={() => setModal(null)}><div className="space-y-3"><Input label="Tanggal" value={expenseForm.date} onChange={(v) => setExpenseForm({ ...expenseForm, date: v })} /><Input label="Kategori" placeholder="Gaji / Operasional / Ongkir" value={expenseForm.category} onChange={(v) => setExpenseForm({ ...expenseForm, category: v })} /><Input label="Keterangan" value={expenseForm.note} onChange={(v) => setExpenseForm({ ...expenseForm, note: v })} /><Input label="Nominal" type="number" value={expenseForm.amount} onChange={(v) => setExpenseForm({ ...expenseForm, amount: v })} /><Button onClick={addExpense} className="w-full rounded-2xl bg-rose-600 py-6">Simpan Pengeluaran</Button></div></SimpleModal>}

      {modal === "backup" && <SimpleModal title="Backup Data" onClose={() => setModal(null)}><div className="space-y-3"><p className="text-sm text-slate-600">Data backup sudah dicopy jika browser mengizinkan. Simpan teks di bawah ini ke Google Drive, WhatsApp, atau catatan pribadi.</p><textarea value={restoreText} readOnly className="h-52 w-full rounded-2xl border border-slate-200 p-3 text-xs" /><Button onClick={() => navigator.clipboard?.writeText(restoreText)} className="w-full rounded-2xl bg-emerald-600 py-6">Copy Lagi</Button></div></SimpleModal>}

      {modal === "restore" && <SimpleModal title="Restore Data" onClose={() => setModal(null)}><div className="space-y-3"><p className="text-sm text-slate-600">Tempel teks backup lama di sini, lalu klik restore.</p><textarea value={restoreText} onChange={(e) => setRestoreText(e.target.value)} className="h-52 w-full rounded-2xl border border-slate-200 p-3 text-xs" placeholder="Tempel backup data di sini..." /><Button onClick={restoreData} className="w-full rounded-2xl bg-sky-600 py-6">Restore Data</Button></div></SimpleModal>}
    </div>
  );
}
