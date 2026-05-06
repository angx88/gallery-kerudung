import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import { db } from "./firebase";

import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";

import "./App.css";

function rupiah(num) {
  return `Rp ${Number(num || 0).toLocaleString("id-ID")}`;
}

function parseMoney(value) {
  return Number(String(value).replace(/\D/g, "")) || 0;
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}) {
  const isMoney = type === "money";

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-slate-700">
        {label}
      </label>

      <input
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
        value={isMoney ? rupiah(value || 0) : value}
        placeholder={placeholder}
        type={isMoney ? "text" : type}
        onChange={(e) => {
          if (isMoney) {
            onChange(parseMoney(e.target.value));
          } else {
            onChange(e.target.value);
          }
        }}
      />
    </div>
  );
}

function Button({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={`rounded-2xl px-4 py-3 font-semibold text-white ${className}`}
    >
      {children}
    </button>
  );
}

function Card({ title, value, note, bg }) {
  return (
    <div className={`rounded-3xl p-5 shadow-sm ${bg}`}>
      <div className="text-slate-500">{title}</div>

      <div className="mt-3 text-3xl font-bold">
        {rupiah(value)}
      </div>

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
        className="max-h-[95vh] w-full overflow-auto rounded-t-[32px] bg-white p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{title}</h2>

          <button
            onClick={onClose}
            className="rounded-2xl bg-slate-100 px-4 py-2"
          >
            Tutup
          </button>
        </div>

        {children}
      </motion.div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");

  const [modal, setModal] = useState(null);

  const [orders, setOrders] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [editData, setEditData] = useState(null);

  const [orderForm, setOrderForm] = useState({
    customer: "",
    item: "",
    qty: "",
    total: 0,
    dp: 0,
  });

  const [purchaseForm, setPurchaseForm] = useState({
    supplier: "",
    material: "",
    total: 0,
    dp: 0,
  });

  const [expenseForm, setExpenseForm] = useState({
    date: "",
    category: "",
    note: "",
    amount: 0,
  });

  const [orderPayForm, setOrderPayForm] = useState({
    orderId: "",
    date: "",
    note: "",
    amount: 0,
  });

  const [supplierPayForm, setSupplierPayForm] = useState({
    purchaseId: "",
    date: "",
    note: "",
    amount: 0,
  });

  const [search, setSearch] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const orderSnap = await getDocs(collection(db, "orders"));
    const purchaseSnap = await getDocs(collection(db, "purchases"));
    const expenseSnap = await getDocs(collection(db, "expenses"));

    setOrders(
      orderSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }))
    );

    setPurchases(
      purchaseSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }))
    );

    setExpenses(
      expenseSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }))
    );
  }

  const stats = useMemo(() => {
    const totalOrderValue = orders.reduce(
      (s, o) => s + Number(o.total || 0),
      0
    );

    const customerPaid = orders.reduce(
      (s, o) =>
        s +
        (o.payments || []).reduce(
          (a, p) => a + Number(p.amount || 0),
          0
        ),
      0
    );

    const receivable = totalOrderValue - customerPaid;

    const supplierTotal = purchases.reduce(
      (s, p) => s + Number(p.total || 0),
      0
    );

    const supplierPaid = purchases.reduce(
      (s, p) =>
        s +
        (p.payments || []).reduce(
          (a, x) => a + Number(x.amount || 0),
          0
        ),
      0
    );

    const supplierDebt = supplierTotal - supplierPaid;

    const otherExpense = expenses.reduce(
      (s, e) => s + Number(e.amount || 0),
      0
    );

    const cashOut = supplierPaid + otherExpense;

    const netCash = customerPaid - cashOut;

    return {
      customerPaid,
      cashOut,
      receivable,
      supplierDebt,
      netCash,
    };
  }, [orders, purchases, expenses]);

  function generateInvoice() {
    return `ORD-${String(orders.length + 1).padStart(4, "0")}`;
  }

  async function addOrder() {
    if (!orderForm.customer || !orderForm.total) return;

    const dp = Number(orderForm.dp || 0);

    const newOrder = {
      invoice: generateInvoice(),
      customer: orderForm.customer,
      item: orderForm.item || "Pesanan Kerudung",
      qty: Number(orderForm.qty || 0),
      total: Number(orderForm.total || 0),
      status: "Proses",
      payments:
        dp > 0
          ? [
              {
                date: "Hari ini",
                note: "DP Awal",
                amount: dp,
              },
            ]
          : [],
    };

    const docRef = await addDoc(
      collection(db, "orders"),
      newOrder
    );

    setOrders([{ id: docRef.id, ...newOrder }, ...orders]);

    setOrderForm({
      customer: "",
      item: "",
      qty: "",
      total: 0,
      dp: 0,
    });

    setModal(null);
  }

  async function addPurchase() {
    if (!purchaseForm.supplier || !purchaseForm.total)
      return;

    const dp = Number(purchaseForm.dp || 0);

    const newPurchase = {
      supplier: purchaseForm.supplier,
      material:
        purchaseForm.material || "Bahan Baku",
      total: Number(purchaseForm.total || 0),
      payments:
        dp > 0
          ? [
              {
                date: "Hari ini",
                note: "DP Supplier",
                amount: dp,
              },
            ]
          : [],
    };

    const docRef = await addDoc(
      collection(db, "purchases"),
      newPurchase
    );

    setPurchases([
      { id: docRef.id, ...newPurchase },
      ...purchases,
    ]);

    setPurchaseForm({
      supplier: "",
      material: "",
      total: 0,
      dp: 0,
    });

    setModal(null);
  }

  async function addExpense() {
    if (!expenseForm.category || !expenseForm.amount)
      return;

    const newExpense = {
      date: expenseForm.date || "Hari ini",
      category: expenseForm.category,
      note: expenseForm.note || "",
      amount: Number(expenseForm.amount || 0),
    };

    const docRef = await addDoc(
      collection(db, "expenses"),
      newExpense
    );

    setExpenses([
      { id: docRef.id, ...newExpense },
      ...expenses,
    ]);

    setExpenseForm({
      date: "",
      category: "",
      note: "",
      amount: 0,
    });

    setModal(null);
  }

  async function deleteItem(type, id) {
    await deleteDoc(doc(db, type, id));

    if (type === "orders") {
      setOrders(orders.filter((x) => x.id !== id));
    }

    if (type === "purchases") {
      setPurchases(
        purchases.filter((x) => x.id !== id)
      );
    }

    if (type === "expenses") {
      setExpenses(expenses.filter((x) => x.id !== id));
    }
  }

  async function saveEdit() {
    if (!editData) return;

    const { type, id, ...payload } = editData;

    await updateDoc(doc(db, type, id), payload);

    loadData();

    setEditData(null);
  }

  function getDateValue(text) {
    if (!text || text === "Hari ini") return new Date();

    const parsed = new Date(text);

    return isNaN(parsed.getTime())
      ? new Date()
      : parsed;
  }

  function samePeriod(date, period) {
    const now = new Date();
    const d = getDateValue(date);

    if (period === "day") {
      return d.toDateString() === now.toDateString();
    }

    if (period === "month") {
      return (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    }

    if (period === "year") {
      return d.getFullYear() === now.getFullYear();
    }

    if (period === "week") {
      const start = new Date(now);

      start.setDate(now.getDate() - now.getDay());

      const end = new Date(start);

      end.setDate(start.getDate() + 7);

      return d >= start && d < end;
    }

    return true;
  }

  function downloadCSV(filename, rows) {
    const header = [
      "Tanggal",
      "Jenis",
      "Nama",
      "Keterangan",
      "Masuk",
      "Keluar",
    ];

    const csv = [
      header.join(","),

      ...rows.map((r) =>
        [
          r.tanggal,
          r.jenis,
          r.nama,
          r.keterangan,
          r.masuk,
          r.keluar,
        ]
          .map((v) => `"${String(v)}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

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
          rows.push({
            tanggal: pay.date,
            jenis: "Kas Masuk",
            nama: order.customer,
            keterangan: order.invoice,
            masuk: pay.amount,
            keluar: 0,
          });
        }
      });
    });

    purchases.forEach((purchase) => {
      (purchase.payments || []).forEach((pay) => {
        if (samePeriod(pay.date, period)) {
          rows.push({
            tanggal: pay.date,
            jenis: "Bayar Supplier",
            nama: purchase.supplier,
            keterangan: purchase.material,
            masuk: 0,
            keluar: pay.amount,
          });
        }
      });
    });

    expenses.forEach((expense) => {
      if (samePeriod(expense.date, period)) {
        rows.push({
          tanggal: expense.date,
          jenis: "Biaya",
          nama: expense.category,
          keterangan: expense.note,
          masuk: 0,
          keluar: expense.amount,
        });
      }
    });

    const label = {
      day: "harian",
      week: "mingguan",
      month: "bulanan",
      year: "tahunan",
    }[period];

    downloadCSV(
      `rekap-gallery-kerudung-${label}.csv`,
      rows
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-100">
      <div className="bg-pink-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-4xl font-bold">
              Gallery Kerudung
            </div>

            <div className="mt-2 text-2xl">
              made by order
            </div>
          </div>

          <img
            src="/logo-gk.png"
            className="h-28 w-28 rounded-3xl"
          />
        </div>

        <div className="mt-6 rounded-full bg-pink-500 px-5 py-4">
          🔎
          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Cari pesanan, supplier, biaya..."
            className="ml-3 bg-transparent outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 p-4">
        <Card
          title="Kas Masuk"
          value={stats.customerPaid}
          note="Cicilan pelanggan"
          bg="bg-emerald-50"
        />

        <Card
          title="Kas Keluar"
          value={stats.cashOut}
          note="Supplier + biaya"
          bg="bg-rose-50"
        />

        <Card
          title="Piutang"
          value={stats.receivable}
          note="Tagihan pelanggan"
          bg="bg-sky-50"
        />

        <Card
          title="Hutang Supplier"
          value={stats.supplierDebt}
          note="Bahan baku"
          bg="bg-yellow-50"
        />
      </div>

      <div className="px-4">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="text-2xl text-slate-500">
            Saldo Cashflow Saat Ini
          </div>

          <div className="mt-5 text-6xl font-bold text-emerald-600">
            {rupiah(stats.netCash)}
          </div>

          <div className="mt-5 text-slate-500">
            Kas masuk dikurangi pembayaran supplier
            dan biaya lain.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 p-4">
        <Button
          className="bg-pink-600"
          onClick={() => setModal("order")}
        >
          + Pesanan
        </Button>

        <Button
          className="bg-emerald-600"
          onClick={() => setModal("pay")}
        >
          + Bayar Masuk
        </Button>

        <Button
          className="bg-yellow-500"
          onClick={() => setModal("purchase")}
        >
          + Supplier
        </Button>

        <Button
          className="bg-slate-700"
          onClick={() => setModal("expense")}
        >
          + Pengeluaran
        </Button>
      </div>

      <div className="space-y-4 p-4">
        {orders.map((o) => (
          <div
            key={o.id}
            className="rounded-3xl bg-white p-5 shadow-sm"
          >
            <div className="flex justify-between">
              <div>
                <div className="font-bold">
                  {o.customer}
                </div>

                <div className="text-sm text-slate-500">
                  {o.invoice}
                </div>
              </div>

              <div className="font-bold">
                {rupiah(o.total)}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                className="bg-sky-600"
                onClick={() =>
                  setEditData({
                    type: "orders",
                    ...o,
                  })
                }
              >
                Edit
              </Button>

              <Button
                className="bg-rose-600"
                onClick={() =>
                  deleteItem("orders", o.id)
                }
              >
                Hapus
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <Button
          className="bg-emerald-600"
          onClick={() => downloadRekap("day")}
        >
          Rekap Harian
        </Button>

        <Button
          className="bg-sky-600"
          onClick={() => downloadRekap("week")}
        >
          Rekap Mingguan
        </Button>

        <Button
          className="bg-pink-600"
          onClick={() => downloadRekap("month")}
        >
          Rekap Bulanan
        </Button>

        <Button
          className="bg-slate-700"
          onClick={() => downloadRekap("year")}
        >
          Rekap Tahunan
        </Button>
      </div>

      {modal === "order" && (
        <SimpleModal
          title="Tambah Pesanan"
          onClose={() => setModal(null)}
        >
          <div className="space-y-3">
            <Input
              label="Nama Customer"
              value={orderForm.customer}
              onChange={(v) =>
                setOrderForm({
                  ...orderForm,
                  customer: v,
                })
              }
            />

            <Input
              label="Produk"
              value={orderForm.item}
              onChange={(v) =>
                setOrderForm({
                  ...orderForm,
                  item: v,
                })
              }
            />

            <Input
              label="Jumlah pcs"
              type="number"
              value={orderForm.qty}
              onChange={(v) =>
                setOrderForm({
                  ...orderForm,
                  qty: v,
                })
              }
            />

            <Input
              label="Total Pesanan"
              type="money"
              value={orderForm.total}
              onChange={(v) =>
                setOrderForm({
                  ...orderForm,
                  total: v,
                })
              }
            />

            <Input
              label="DP Awal"
              type="money"
              value={orderForm.dp}
              onChange={(v) =>
                setOrderForm({
                  ...orderForm,
                  dp: v,
                })
              }
            />

            <Button
              onClick={addOrder}
              className="w-full bg-pink-600"
            >
              Simpan Pesanan
            </Button>
          </div>
        </SimpleModal>
      )}

      {modal === "purchase" && (
        <SimpleModal
          title="Tambah Supplier"
          onClose={() => setModal(null)}
        >
          <div className="space-y-3">
            <Input
              label="Nama Supplier"
              value={purchaseForm.supplier}
              onChange={(v) =>
                setPurchaseForm({
                  ...purchaseForm,
                  supplier: v,
                })
              }
            />

            <Input
              label="Bahan"
              value={purchaseForm.material}
              onChange={(v) =>
                setPurchaseForm({
                  ...purchaseForm,
                  material: v,
                })
              }
            />

            <Input
              label="Total"
              type="money"
              value={purchaseForm.total}
              onChange={(v) =>
                setPurchaseForm({
                  ...purchaseForm,
                  total: v,
                })
              }
            />

            <Input
              label="DP Supplier"
              type="money"
              value={purchaseForm.dp}
              onChange={(v) =>
                setPurchaseForm({
                  ...purchaseForm,
                  dp: v,
                })
              }
            />

            <Button
              onClick={addPurchase}
              className="w-full bg-yellow-500"
            >
              Simpan Supplier
            </Button>
          </div>
        </SimpleModal>
      )}

      {modal === "expense" && (
        <SimpleModal
          title="Tambah Pengeluaran"
          onClose={() => setModal(null)}
        >
          <div className="space-y-3">
            <Input
              label="Tanggal"
              value={expenseForm.date}
              onChange={(v) =>
                setExpenseForm({
                  ...expenseForm,
                  date: v,
                })
              }
            />

            <Input
              label="Kategori"
              value={expenseForm.category}
              onChange={(v) =>
                setExpenseForm({
                  ...expenseForm,
                  category: v,
                })
              }
            />

            <Input
              label="Keterangan"
              value={expenseForm.note}
              onChange={(v) =>
                setExpenseForm({
                  ...expenseForm,
                  note: v,
                })
              }
            />

            <Input
              label="Nominal"
              type="money"
              value={expenseForm.amount}
              onChange={(v) =>
                setExpenseForm({
                  ...expenseForm,
                  amount: v,
                })
              }
            />

            <Button
              onClick={addExpense}
              className="w-full bg-slate-700"
            >
              Simpan Pengeluaran
            </Button>
          </div>
        </SimpleModal>
      )}

      {editData && (
        <SimpleModal
          title="Edit Data"
          onClose={() => setEditData(null)}
        >
          <div className="space-y-3">
            <Input
              label="Nama"
              value={
                editData.customer ||
                editData.supplier ||
                editData.category
              }
              onChange={(v) => {
                if (editData.customer !== undefined) {
                  setEditData({
                    ...editData,
                    customer: v,
                  });
                }

                if (editData.supplier !== undefined) {
                  setEditData({
                    ...editData,
                    supplier: v,
                  });
                }

                if (editData.category !== undefined) {
                  setEditData({
                    ...editData,
                    category: v,
                  });
                }
              }}
            />

            <Input
              label="Nominal"
              type="money"
              value={
                editData.total || editData.amount || 0
              }
              onChange={(v) => {
                if (editData.total !== undefined) {
                  setEditData({
                    ...editData,
                    total: v,
                  });
                }

                if (editData.amount !== undefined) {
                  setEditData({
                    ...editData,
                    amount: v,
                  });
                }
              }}
            />

            <Button
              onClick={saveEdit}
              className="w-full bg-sky-600"
            >
              Simpan Perubahan
            </Button>
          </div>
        </SimpleModal>
      )}
    </div>
  );
}