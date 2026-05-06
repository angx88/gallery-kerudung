import React, { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

const rupiah = (v) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

const cleanNumber = (v) => String(v || "").replace(/\D/g, "");
const formatNumber = (v) => {
  const n = cleanNumber(v);
  return n ? new Intl.NumberFormat("id-ID").format(Number(n)) : "";
};

function Button({ children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-3 font-bold text-white ${className}`}
    >
      {children}
    </button>
  );
}

function Input({ label, value, onChange, money = false, type = "text", placeholder = "" }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-600">{label}</span>
      <div className="relative">
        {money && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-500">
            Rp
          </span>
        )}
        <input
          type={money ? "text" : type}
          value={money ? formatNumber(value) : value}
          onChange={(e) => onChange(money ? cleanNumber(e.target.value) : e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-500 ${
            money ? "pl-12" : ""
          }`}
        />
      </div>
    </label>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2">
            Tutup
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function totalPaid(row) {
  return (row.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);

  const [orders, setOrders] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [orderForm, setOrderForm] = useState({
    id: "",
    invoice: "",
    customer: "",
    item: "",
    qty: "",
    total: "",
    dp: "",
  });

  const [paymentForm, setPaymentForm] = useState({
    orderId: "",
    date: "",
    note: "",
    amount: "",
  });

  const [purchaseForm, setPurchaseForm] = useState({
    id: "",
    supplier: "",
    material: "",
    total: "",
    dp: "",
  });

  const [supplierPayForm, setSupplierPayForm] = useState({
    purchaseId: "",
    date: "",
    note: "",
    amount: "",
  });

  const [expenseForm, setExpenseForm] = useState({
    id: "",
    date: "",
    category: "",
    note: "",
    amount: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const ordersSnap = await getDocs(collection(db, "orders"));
    const purchasesSnap = await getDocs(collection(db, "purchases"));
    const expensesSnap = await getDocs(collection(db, "expenses"));

    setOrders(ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setPurchases(purchasesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setExpenses(expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  const stats = useMemo(() => {
    const orderTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const customerPaid = orders.reduce((s, o) => s + totalPaid(o), 0);
    const receivable = orderTotal - customerPaid;

    const purchaseTotal = purchases.reduce((s, p) => s + Number(p.total || 0), 0);
    const supplierPaid = purchases.reduce((s, p) => s + totalPaid(p), 0);
    const supplierDebt = purchaseTotal - supplierPaid;

    const otherExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const cashOut = supplierPaid + otherExpense;
    const cashflow = customerPaid - cashOut;

    return { customerPaid, cashOut, receivable, supplierDebt, cashflow };
  }, [orders, purchases, expenses]);

  function nextInvoice() {
    const max = orders.reduce((m, o) => {
      const n = Number(String(o.invoice || "").replace("ORD-", ""));
      return n > m ? n : m;
    }, 0);
    return `ORD-${String(max + 1).padStart(4, "0")}`;
  }

  function openAddOrder() {
    setOrderForm({ id: "", invoice: "", customer: "", item: "", qty: "", total: "", dp: "" });
    setModal("order");
  }

  function openEditOrder(order) {
    setOrderForm({
      id: order.id,
      invoice: order.invoice || "",
      customer: order.customer || "",
      item: order.item || "",
      qty: String(order.qty || ""),
      total: String(order.total || ""),
      dp: "",
    });
    setModal("order");
  }

  async function saveOrder() {
    if (!orderForm.customer || !orderForm.total) return;

    if (orderForm.id) {
      const data = {
        customer: orderForm.customer,
        item: orderForm.item || "Pesanan Kerudung",
        qty: Number(orderForm.qty || 0),
        total: Number(orderForm.total || 0),
      };

      await updateDoc(doc(db, "orders", orderForm.id), data);
      setOrders(orders.map((o) => (o.id === orderForm.id ? { ...o, ...data } : o)));
    } else {
      const dp = Number(orderForm.dp || 0);
      const data = {
        invoice: nextInvoice(),
        customer: orderForm.customer,
        item: orderForm.item || "Pesanan Kerudung",
        qty: Number(orderForm.qty || 0),
        total: Number(orderForm.total || 0),
        status: "Proses",
        payments: dp > 0 ? [{ date: "Hari ini", note: "DP Awal", amount: dp }] : [],
      };

      const ref = await addDoc(collection(db, "orders"), data);
      setOrders([{ id: ref.id, ...data }, ...orders]);
    }

    setModal(null);
  }

  async function deleteOrder(order) {
    if (!confirm(`Hapus pesanan ${order.customer}?`)) return;
    await deleteDoc(doc(db, "orders", order.id));
    setOrders(orders.filter((o) => o.id !== order.id));
  }

  async function addCustomerPayment() {
    if (!paymentForm.orderId || !paymentForm.amount) return;

    const order = orders.find((o) => o.id === paymentForm.orderId);
    if (!order) return;

    const newPayment = {
      date: paymentForm.date || "Hari ini",
      note: paymentForm.note || "Pembayaran",
      amount: Number(paymentForm.amount || 0),
    };

    const payments = [...(order.payments || []), newPayment];

    await updateDoc(doc(db, "orders", order.id), { payments });
    setOrders(orders.map((o) => (o.id === order.id ? { ...o, payments } : o)));

    setPaymentForm({ orderId: "", date: "", note: "", amount: "" });
    setModal(null);
  }

  function openAddPurchase() {
    setPurchaseForm({ id: "", supplier: "", material: "", total: "", dp: "" });
    setModal("purchase");
  }

  function openEditPurchase(purchase) {
    setPurchaseForm({
      id: purchase.id,
      supplier: purchase.supplier || "",
      material: purchase.material || "",
      total: String(purchase.total || ""),
      dp: "",
    });
    setModal("purchase");
  }

  async function savePurchase() {
    if (!purchaseForm.supplier || !purchaseForm.total) return;

    if (purchaseForm.id) {
      const data = {
        supplier: purchaseForm.supplier,
        material: purchaseForm.material || "Bahan Baku",
        total: Number(purchaseForm.total || 0),
      };

      await updateDoc(doc(db, "purchases", purchaseForm.id), data);
      setPurchases(purchases.map((p) => (p.id === purchaseForm.id ? { ...p, ...data } : p)));
    } else {
      const dp = Number(purchaseForm.dp || 0);
      const data = {
        supplier: purchaseForm.supplier,
        material: purchaseForm.material || "Bahan Baku",
        total: Number(purchaseForm.total || 0),
        payments: dp > 0 ? [{ date: "Hari ini", note: "DP Supplier", amount: dp }] : [],
      };

      const ref = await addDoc(collection(db, "purchases"), data);
      setPurchases([{ id: ref.id, ...data }, ...purchases]);
    }

    setModal(null);
  }

  async function deletePurchase(purchase) {
    if (!confirm(`Hapus pembelian dari ${purchase.supplier}?`)) return;
    await deleteDoc(doc(db, "purchases", purchase.id));
    setPurchases(purchases.filter((p) => p.id !== purchase.id));
  }

  async function addSupplierPayment() {
    if (!supplierPayForm.purchaseId || !supplierPayForm.amount) return;

    const purchase = purchases.find((p) => p.id === supplierPayForm.purchaseId);
    if (!purchase) return;

    const newPayment = {
      date: supplierPayForm.date || "Hari ini",
      note: supplierPayForm.note || "Pembayaran Supplier",
      amount: Number(supplierPayForm.amount || 0),
    };

    const payments = [...(purchase.payments || []), newPayment];

    await updateDoc(doc(db, "purchases", purchase.id), { payments });
    setPurchases(purchases.map((p) => (p.id === purchase.id ? { ...p, payments } : p)));

    setSupplierPayForm({ purchaseId: "", date: "", note: "", amount: "" });
    setModal(null);
  }

  function openAddExpense() {
    setExpenseForm({ id: "", date: "", category: "", note: "", amount: "" });
    setModal("expense");
  }

  function openEditExpense(expense) {
    setExpenseForm({
      id: expense.id,
      date: expense.date || "",
      category: expense.category || "",
      note: expense.note || "",
      amount: String(expense.amount || ""),
    });
    setModal("expense");
  }

  async function saveExpense() {
    if (!expenseForm.category || !expenseForm.amount) return;

    const data = {
      date: expenseForm.date || "Hari ini",
      category: expenseForm.category,
      note: expenseForm.note || "",
      amount: Number(expenseForm.amount || 0),
    };

    if (expenseForm.id) {
      await updateDoc(doc(db, "expenses", expenseForm.id), data);
      setExpenses(expenses.map((e) => (e.id === expenseForm.id ? { ...e, ...data } : e)));
    } else {
      const ref = await addDoc(collection(db, "expenses"), data);
      setExpenses([{ id: ref.id, ...data }, ...expenses]);
    }

    setModal(null);
  }

  async function deleteExpense(expense) {
    if (!confirm(`Hapus biaya ${expense.category}?`)) return;
    await deleteDoc(doc(db, "expenses", expense.id));
    setExpenses(expenses.filter((e) => e.id !== expense.id));
  }

  function OrderCard({ order }) {
    const paid = totalPaid(order);
    const remaining = Number(order.total || 0) - paid;

    return (
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">{order.customer}</h3>
            <p className="text-sm text-rose-600">{order.invoice}</p>
            <p className="text-sm text-slate-500">{order.item} • {order.qty} pcs</p>
          </div>
          <span className="h-fit rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-600">
            {remaining <= 0 ? "Lunas" : "Proses"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-slate-500">Total</p>
            <b>{rupiah(order.total)}</b>
          </div>
          <div>
            <p className="text-slate-500">Bayar</p>
            <b className="text-emerald-600">{rupiah(paid)}</b>
          </div>
          <div>
            <p className="text-slate-500">Sisa</p>
            <b className="text-rose-600">{rupiah(remaining)}</b>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-3">
          {(order.payments || []).length === 0 && (
            <p className="text-sm text-slate-400">Belum ada cicilan.</p>
          )}
          {(order.payments || []).map((p, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{p.date} — {p.note}</span>
              <b>{rupiah(p.amount)}</b>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => openEditOrder(order)} className="bg-sky-600">
            Edit
          </Button>
          <Button onClick={() => deleteOrder(order)} className="bg-red-600">
            Hapus
          </Button>
        </div>
      </div>
    );
  }

  function PurchaseCard({ purchase }) {
    const paid = totalPaid(purchase);
    const remaining = Number(purchase.total || 0) - paid;

    return (
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">{purchase.supplier}</h3>
        <p className="text-sm text-slate-500">{purchase.material}</p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-slate-500">Total</p>
            <b>{rupiah(purchase.total)}</b>
          </div>
          <div>
            <p className="text-slate-500">Bayar</p>
            <b className="text-emerald-600">{rupiah(paid)}</b>
          </div>
          <div>
            <p className="text-slate-500">Hutang</p>
            <b className="text-amber-600">{rupiah(remaining)}</b>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-3">
          {(purchase.payments || []).length === 0 && (
            <p className="text-sm text-slate-400">Belum ada cicilan.</p>
          )}
          {(purchase.payments || []).map((p, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{p.date} — {p.note}</span>
              <b>{rupiah(p.amount)}</b>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => openEditPurchase(purchase)} className="bg-sky-600">
            Edit
          </Button>
          <Button onClick={() => deletePurchase(purchase)} className="bg-red-600">
            Hapus
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-md pb-24">
        <header className="sticky top-0 z-10 bg-gradient-to-br from-rose-700 to-pink-600 p-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Gallery Kerudung</h1>
              <p className="mt-1 text-sm">made by order</p>
            </div>
            <div className="rounded-2xl bg-white/20 p-2">
              <img src="/logo-gk.png" className="h-16 w-16 rounded-2xl bg-white object-cover" />
            </div>
          </div>
          <div className="mt-5 rounded-2xl bg-white/20 px-4 py-3">
            🔍 Cari pesanan, supplier, biaya...
          </div>
        </header>

        <main className="space-y-5 p-4">
          {tab === "dashboard" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-3xl bg-emerald-50 p-4 shadow-sm">
                  <p>Kas Masuk</p>
                  <h2 className="text-xl font-bold">{rupiah(stats.customerPaid)}</h2>
                </div>
                <div className="rounded-3xl bg-rose-50 p-4 shadow-sm">
                  <p>Kas Keluar</p>
                  <h2 className="text-xl font-bold">{rupiah(stats.cashOut)}</h2>
                </div>
                <div className="rounded-3xl bg-sky-50 p-4 shadow-sm">
                  <p>Piutang</p>
                  <h2 className="text-xl font-bold">{rupiah(stats.receivable)}</h2>
                </div>
                <div className="rounded-3xl bg-amber-50 p-4 shadow-sm">
                  <p>Hutang Supplier</p>
                  <h2 className="text-xl font-bold">{rupiah(stats.supplierDebt)}</h2>
                </div>
              </div>

              <div className="rounded-3xl bg-white p-6 shadow-sm">
                <p>Saldo Cashflow Saat Ini</p>
                <h2 className="text-4xl font-extrabold text-emerald-600">
                  {rupiah(stats.cashflow)}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button onClick={openAddOrder} className="bg-rose-600 py-6">
                  + Pesanan
                </Button>
                <Button onClick={() => setModal("payment")} className="bg-emerald-600 py-6">
                  + Bayar Masuk
                </Button>
                <Button onClick={openAddPurchase} className="bg-orange-600 py-6">
                  + Beli Bahan
                </Button>
                <Button onClick={openAddExpense} className="bg-slate-700 py-6">
                  + Biaya
                </Button>
              </div>

              <h2 className="text-xl font-bold">Pesanan Terbaru</h2>
              {orders.length === 0 ? (
                <div className="rounded-3xl bg-white p-4 text-slate-500">Belum ada pesanan.</div>
              ) : (
                orders.slice(0, 2).map((o) => <OrderCard key={o.id} order={o} />)
              )}
            </>
          )}

          {tab === "orders" && (
            <>
              <Button onClick={openAddOrder} className="w-full bg-rose-600">
                + Tambah Pesanan
              </Button>
              {orders.map((o) => <OrderCard key={o.id} order={o} />)}
            </>
          )}

          {tab === "materials" && (
            <>
              <Button onClick={openAddPurchase} className="w-full bg-orange-600">
                + Tambah Bahan
              </Button>
              <Button onClick={() => setModal("supplierPay")} className="w-full bg-emerald-600">
                + Bayar Supplier
              </Button>
              {purchases.map((p) => <PurchaseCard key={p.id} purchase={p} />)}
            </>
          )}

          {tab === "expenses" && (
            <>
              <Button onClick={openAddExpense} className="w-full bg-slate-700">
                + Tambah Biaya
              </Button>
              {expenses.map((e) => (
                <div key={e.id} className="rounded-3xl bg-white p-4 shadow-sm">
                  <div className="flex justify-between">
                    <div>
                      <h3 className="font-bold">{e.category}</h3>
                      <p className="text-sm text-slate-500">{e.date} — {e.note}</p>
                    </div>
                    <b className="text-rose-600">{rupiah(e.amount)}</b>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button onClick={() => openEditExpense(e)} className="bg-sky-600">
                      Edit
                    </Button>
                    <Button onClick={() => deleteExpense(e)} className="bg-red-600">
                      Hapus
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "settings" && (
            <div className="rounded-3xl bg-white p-4 shadow-sm">
              Data tersimpan online di Firebase.
            </div>
          )}
        </main>

        <nav className="fixed bottom-0 left-1/2 grid w-full max-w-md -translate-x-1/2 grid-cols-5 border-t bg-white p-2 text-xs shadow-2xl">
          {[
            ["dashboard", "📈", "Dashboard"],
            ["orders", "📋", "Pesanan"],
            ["materials", "📦", "Bahan"],
            ["expenses", "🧾", "Biaya"],
            ["settings", "💰", "Backup"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-2xl p-2 ${tab === id ? "bg-rose-50 text-rose-600" : "text-slate-500"}`}
            >
              <div>{icon}</div>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {modal === "order" && (
        <Modal title={orderForm.id ? "Edit Pesanan" : "Tambah Pesanan"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Input label="Nama Customer" value={orderForm.customer} onChange={(v) => setOrderForm({ ...orderForm, customer: v })} />
            <Input label="Produk" value={orderForm.item} onChange={(v) => setOrderForm({ ...orderForm, item: v })} />
            <Input label="Jumlah pcs" type="number" value={orderForm.qty} onChange={(v) => setOrderForm({ ...orderForm, qty: v })} />
            <Input label="Total Pesanan" money value={orderForm.total} onChange={(v) => setOrderForm({ ...orderForm, total: v })} />
            {!orderForm.id && (
              <Input label="DP Awal" money value={orderForm.dp} onChange={(v) => setOrderForm({ ...orderForm, dp: v })} />
            )}
            <Button onClick={saveOrder} className="w-full bg-rose-600">
              Simpan
            </Button>
          </div>
        </Modal>
      )}

      {modal === "payment" && (
        <Modal title="Tambah Cicilan Pelanggan" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <select
              value={paymentForm.orderId}
              onChange={(e) => setPaymentForm({ ...paymentForm, orderId: e.target.value })}
              className="w-full rounded-2xl border p-3"
            >
              <option value="">Pilih Pesanan</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.customer} — {o.invoice}</option>
              ))}
            </select>
            <Input label="Tanggal" value={paymentForm.date} onChange={(v) => setPaymentForm({ ...paymentForm, date: v })} />
            <Input label="Keterangan" value={paymentForm.note} onChange={(v) => setPaymentForm({ ...paymentForm, note: v })} />
            <Input label="Nominal Bayar" money value={paymentForm.amount} onChange={(v) => setPaymentForm({ ...paymentForm, amount: v })} />
            <Button onClick={addCustomerPayment} className="w-full bg-emerald-600">
              Simpan Pembayaran
            </Button>
          </div>
        </Modal>
      )}

      {modal === "purchase" && (
        <Modal title={purchaseForm.id ? "Edit Pembelian" : "Tambah Pembelian"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Input label="Supplier" value={purchaseForm.supplier} onChange={(v) => setPurchaseForm({ ...purchaseForm, supplier: v })} />
            <Input label="Nama Bahan" value={purchaseForm.material} onChange={(v) => setPurchaseForm({ ...purchaseForm, material: v })} />
            <Input label="Total Pembelian" money value={purchaseForm.total} onChange={(v) => setPurchaseForm({ ...purchaseForm, total: v })} />
            {!purchaseForm.id && (
              <Input label="DP Supplier" money value={purchaseForm.dp} onChange={(v) => setPurchaseForm({ ...purchaseForm, dp: v })} />
            )}
            <Button onClick={savePurchase} className="w-full bg-orange-600">
              Simpan
            </Button>
          </div>
        </Modal>
      )}

      {modal === "supplierPay" && (
        <Modal title="Bayar Supplier" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <select
              value={supplierPayForm.purchaseId}
              onChange={(e) => setSupplierPayForm({ ...supplierPayForm, purchaseId: e.target.value })}
              className="w-full rounded-2xl border p-3"
            >
              <option value="">Pilih Pembelian</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>{p.supplier} — {rupiah(p.total)}</option>
              ))}
            </select>
            <Input label="Tanggal" value={supplierPayForm.date} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, date: v })} />
            <Input label="Keterangan" value={supplierPayForm.note} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, note: v })} />
            <Input label="Nominal Bayar" money value={supplierPayForm.amount} onChange={(v) => setSupplierPayForm({ ...supplierPayForm, amount: v })} />
            <Button onClick={addSupplierPayment} className="w-full bg-emerald-600">
              Simpan Pembayaran
            </Button>
          </div>
        </Modal>
      )}

      {modal === "expense" && (
        <Modal title={expenseForm.id ? "Edit Biaya" : "Tambah Biaya"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Input label="Tanggal" value={expenseForm.date} onChange={(v) => setExpenseForm({ ...expenseForm, date: v })} />
            <Input label="Kategori" value={expenseForm.category} onChange={(v) => setExpenseForm({ ...expenseForm, category: v })} />
            <Input label="Keterangan" value={expenseForm.note} onChange={(v) => setExpenseForm({ ...expenseForm, note: v })} />
            <Input label="Nominal" money value={expenseForm.amount} onChange={(v) => setExpenseForm({ ...expenseForm, amount: v })} />
            <Button onClick={saveExpense} className="w-full bg-slate-700">
              Simpan
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}