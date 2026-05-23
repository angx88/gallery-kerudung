import SimpleModal from "./components/SimpleModal";
import StatusBadge from "./components/StatusBadge";
import Card from "./components/Card";
import Input from "./components/Input";
import Button from "./components/Button";
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
  const n = Math.round(Number(num || 0));
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;

  const raw = String(value).trim();
  if (!raw) return 0;

  const clean = raw
    .replace(/Rp/gi, "")
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");

  if (!clean || clean === "-" || clean === ".") return 0;

  const negative = clean.startsWith("-");
  const withoutSign = clean.replace(/-/g, "");
  const parts = withoutSign.split(".").filter(Boolean);

  let numericText = "0";
  if (parts.length === 1) {
    numericText = parts[0] || "0";
  } else if (parts.length === 2) {
    const [left, right] = parts;
    // Satu titik dengan 3 digit di belakang biasanya pemisah ribuan: 13.875 => 13875.
    // Satu titik dengan <=2 digit atau >3 digit di belakang dianggap desimal/artefak float: 13875849.986124152 => 13875850.
    if (right.length === 3 && left.length <= 3) numericText = left + right;
    else numericText = String(Math.round(Number(`${left}.${right}`) || 0));
  } else {
    const last = parts[parts.length - 1];
    const looksLikeDecimal = last.length > 0 && last.length <= 2;
    numericText = looksLikeDecimal ? parts.slice(0, -1).join("") : parts.join("");
  }

  const result = Number(numericText || 0);
  return Number.isFinite(result) ? (negative ? -Math.round(result) : Math.round(result)) : 0;
}

function moneyValue(value) {
  return parseMoney(value);
}


const LIMITS = {
  MAX_MONEY_INPUT: 10_000_000_000,
  MAX_PRICE_PER_UNIT: 1_000_000_000,
  MAX_QTY: 1_000_000,
  MAX_STOCK_VALUE_PER_MATERIAL: 1_000_000_000,
  MAX_AVG_COST: 100_000_000,
};

const SAFE_SUMMARY_MAX = 10_000_000_000;

function isReasonableMoney(n, max = SAFE_SUMMARY_MAX) {
  return Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= max;
}

function safeSummaryMoney(value, max = SAFE_SUMMARY_MAX) {
  const n = moneyValue(value);
  return isReasonableMoney(n, max) ? Math.round(n) : 0;
}

function hasAbnormalMoney(value, max = SAFE_SUMMARY_MAX) {
  const raw = value === null || value === undefined || value === "" ? 0 : moneyValue(value);
  return Number.isFinite(Number(raw)) && Number(raw) > max;
}


function assertReasonableMoney(value, label = "Nominal", max = LIMITS.MAX_MONEY_INPUT) {
  const n = moneyValue(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} tidak valid.`);
  if (n > max) throw new Error(`${label} terlalu besar/tidak masuk akal: ${rupiah(n)}.`);
  return n;
}

function assertReasonableQty(value, label = "Qty") {
  const n = numberValue(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} tidak valid.`);
  if (n > LIMITS.MAX_QTY) throw new Error(`${label} terlalu besar/tidak masuk akal.`);
  return n;
}

function safeMaterialStockValue(material) {
  const stock = Number(material?.stock || 0);
  const avgCost = Number(material?.avgCost || 0);
  const totalValue = Number(material?.totalValue || 0);

  const safeStock = Number.isFinite(stock) && stock >= 0 && stock <= LIMITS.MAX_QTY ? stock : 0;
  const safeAvgCost = Number.isFinite(avgCost) && avgCost >= 0 && avgCost <= LIMITS.MAX_AVG_COST ? Math.round(avgCost) : 0;
  const safeTotalValue = Number.isFinite(totalValue) && totalValue >= 0 && totalValue <= LIMITS.MAX_STOCK_VALUE_PER_MATERIAL ? Math.round(totalValue) : 0;

  if (safeTotalValue > 0) return safeTotalValue;
  return Math.round(safeStock * safeAvgCost);
}

function validateMaterialPayload({ name, qty, pricePerUnit, total }) {
  if (!String(name || "").trim()) throw new Error("Nama bahan wajib diisi.");
  const cleanQty = assertReasonableQty(qty, `Qty ${name}`);
  const cleanPrice = assertReasonableMoney(pricePerUnit, `Harga bahan ${name}`, LIMITS.MAX_PRICE_PER_UNIT);
  const cleanTotal = total !== undefined ? assertReasonableMoney(total, `Total bahan ${name}`, LIMITS.MAX_MONEY_INPUT) : cleanQty * cleanPrice;
  if (cleanQty <= 0) throw new Error(`Qty ${name} harus lebih dari 0.`);
  if (cleanPrice <= 0) throw new Error(`Harga ${name} harus lebih dari 0.`);
  return { qty: cleanQty, pricePerUnit: cleanPrice, total: cleanTotal };
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = String(value)
    .trim()
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const result = Number(clean);
  return Number.isFinite(result) ? result : 0;
}

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function dateSerial(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const datePart = text.includes("T") ? text.slice(0, 10) : text;
  const match = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    return y * 10000 + m * 100 + d;
  }
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return parsed.getFullYear() * 10000 + (parsed.getMonth() + 1) * 100 + parsed.getDate();
  }
  return 0;
}

function getRowDate(row) {
  return row?.date || row?.createdAt || row?.tanggal || row?.tanggalBelanja || "";
}

function sortOldestBottom(a, b) {
  return dateSerial(getRowDate(b)) - dateSerial(getRowDate(a));
}

function sortOldestTop(a, b) {
  return dateSerial(getRowDate(a)) - dateSerial(getRowDate(b));
}

function sortPurchaseNewestFirst(a, b) {
  const dateDiff = dateSerial(b?.createdAt || b?.date || "") - dateSerial(a?.createdAt || a?.date || "");
  if (dateDiff !== 0) return dateDiff;
  const createdDiff = String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""));
  if (createdDiff !== 0) return createdDiff;
  return String(b?.id || "").localeCompare(String(a?.id || ""));
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

function normalizeMaterialUnit(name, unit) {
  const key = normalizeName(name);
  if (["balon", "jaguard", "rayon"].includes(key)) return "kg";
  return unit === "kg" ? "kg" : "yard";
}

function capitalizeWords(name) {
  return (name || "").trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function generateInvoice() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `ORD-${ymd}-${Date.now().toString().slice(-5)}${rand}`;
}

function emptyOrderItem() {
  return {
    productId: "",
    name: "",
    category: "",
    qty: "",
    price: 0,
    bahanCost: 0,
    hppPerPcs: 0,
    mainMaterial: "",
    materialQtyPerPcs: 0,
    unit: "yard",
  };
}

function emptyPurchaseMaterial() {
  return { name: "", category: "Kain", qty: "", unit: "yard", pricePerUnit: 0, total: 0 };
}

function normalizePurchaseMaterials(purchase) {
  const raw = Array.isArray(purchase?.materials) && purchase.materials.length > 0
    ? purchase.materials
    : [{
        name: purchase?.material || "Bahan Baku",
        category: purchase?.category || "Kain",
        qty: Number(String(purchase?.qty || "0").replace(/[^0-9.]/g, "")) || 0,
        unit: String(purchase?.qty || "").toLowerCase().includes("kg") ? "kg" : "yard",
        total: moneyValue(purchase?.total || 0),
      }];

  return raw.map((it) => {
    const qty = numberValue(it.qty || 0);
    const savedTotal = moneyValue(it.total || 0);
    const savedPrice = moneyValue(it.pricePerUnit || it.unitPrice || it.hargaSatuan || 0);
    const total = savedPrice > 0 && qty > 0 ? Math.round(qty * savedPrice) : savedTotal;
    return {
      name: it.name || it.material || "Bahan Baku",
      category: it.category || "Kain",
      qty,
      unit: normalizeMaterialUnit(it.name || it.material || purchase?.material, it.unit),
      total,
      pricePerUnit: savedPrice > 0 ? savedPrice : (qty > 0 ? Math.round(total / qty) : 0),
    };
  });
}

function purchaseMaterialTotal(it) {
  const qty = numberValue(it?.qty || 0);
  const pricePerUnit = moneyValue(it?.pricePerUnit || it?.unitPrice || it?.hargaSatuan || 0);
  const savedTotal = moneyValue(it?.total || 0);

  // Guard untuk data lama/rusak agar 1 field aneh tidak merusak Ringkasan Bisnis.
  // Contoh bug: total supplier terbaca 16.746.330.349.310.308.
  if (qty > 0 && qty <= LIMITS.MAX_QTY && pricePerUnit > 0 && pricePerUnit <= LIMITS.MAX_PRICE_PER_UNIT) {
    const calculated = Math.round(qty * pricePerUnit);
    if (isReasonableMoney(calculated)) return calculated;
  }

  return isReasonableMoney(savedTotal) ? Math.round(savedTotal) : 0;
}

function purchaseMaterialsTotal(items) {
  return (items || []).reduce((sum, it) => sum + purchaseMaterialTotal(it), 0);
}

function purchaseInvoiceTotal(purchase) {
  const materialsTotal = purchaseMaterialsTotal(normalizePurchaseMaterials(purchase));
  const shippingCost = safeSummaryMoney(purchase?.shippingCost ?? purchase?.ongkir ?? 0);
  const savedSubtotal = safeSummaryMoney(purchase?.subtotal || 0);
  const savedTotal = safeSummaryMoney(purchase?.total || 0);
  const calculatedTotalRaw = (savedSubtotal > 0 ? savedSubtotal : materialsTotal) + shippingCost;
  const calculatedTotal = isReasonableMoney(calculatedTotalRaw) ? Math.round(calculatedTotalRaw) : 0;

  // Data lama kadang menyimpan total rusak/tidak wajar. Jangan pakai angka itu
  // untuk Hutang Supplier/Laba Bersih. Kalau savedTotal tidak wajar, gunakan
  // hasil hitung dari rincian bahan yang masih masuk batas aman.
  return Math.max(savedTotal, calculatedTotal);
}

function calculateProductHpp(product) {
  const bahan = moneyValue(product?.bahanCost || product?.materialCost || 0);
  const produksi = moneyValue(product?.productionCost || 0);
  const distribusi = moneyValue(product?.distributionCost || 0);
  const lain = moneyValue(product?.otherCost || 0);
  const manual = moneyValue(product?.hppPerPcs || 0);
  const total = bahan + produksi + distribusi + lain;
  return total > 0 ? total : manual;
}

function hppItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.qty || it.shippedQty || 0) * moneyValue(it.hppPerPcs || 0), 0);
}

function orderItemsHppTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.qty || 0) * moneyValue(it.hppPerPcs || 0), 0);
}

function purchaseMaterialsSummary(purchase) {
  const items = normalizePurchaseMaterials(purchase);
  if (items.length === 0) return "Bahan Baku";
  if (items.length === 1) return `${items[0].name} · ${items[0].qty} ${items[0].unit}`;
  return `${items.length} bahan · ${items.map((it) => `${it.qty} ${it.unit}`).join(", ")}`;
}

function normalizeMaterialKey(name) {
  return normalizeName(name);
}

function materialLineKey(name, unit = "yard") {
  return `${normalizeMaterialKey(name)}__${unit === "kg" ? "kg" : "yard"}`;
}

function aggregateMaterialLines(items = []) {
  const map = {};
  (items || []).forEach((it) => {
    const name = capitalizeWords(it.name || it.mainMaterial || "");
    if (!name) return;
    const unit = normalizeMaterialUnit(name || it.name || it.mainMaterial, it.unit);
    const key = materialLineKey(name, unit);
    if (!map[key]) {
      map[key] = {
        name,
        category: it.category || "Bahan",
        unit,
        qty: 0,
        total: 0,
        source: it.source || "",
      };
    }
    map[key].qty += Number(it.qty || 0);
    map[key].total += moneyValue(it.total || 0);
  });
  return Object.values(map).filter((it) => it.name && Number(it.qty || 0) !== 0);
}

function buildMaterialUsageFromDeliveryItems(items = []) {
  return aggregateMaterialLines((items || [])
    .filter((it) => it.mainMaterial && Number(it.materialQtyPerPcs || 0) > 0 && Number(it.qty || 0) > 0)
    .map((it) => ({
      name: it.mainMaterial,
      category: "Kain",
      unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit),
      qty: Number(it.qty || 0) * Number(it.materialQtyPerPcs || 0),
      total: moneyValue(it.bahanCost || 0) * Number(it.qty || 0),
      source: it.name || "Produksi",
    })));
}

function normalizeOrderItems(order) {
  const rawItems = Array.isArray(order?.items) && order.items.length > 0
    ? order.items
    : [{ name: order?.item || "Pesanan Kerudung", qty: order?.qty || 0, price: order?.hargaPcs || 0 }];

  return rawItems.map((it) => {
    const qty = Number(it.qty || 0);
    let price = moneyValue(it.price || it.hargaPcs || 0);

    if (!price && moneyValue(order?.hargaPcs || 0) > 0) {
      price = moneyValue(order.hargaPcs || 0);
    }

    if (!price && qty > 0 && moneyValue(order?.total || 0) > 0) {
      price = moneyValue(order.total || 0) / qty;
    }

    return {
      productId: it.productId || "",
      name: it.name || it.item || "Produk",
      category: it.category || it.productCategory || "Lainnya",
      qty,
      price,
      bahanCost: moneyValue(it.bahanCost || it.materialCost || 0),
      hppPerPcs: moneyValue(it.hppPerPcs || 0),
      mainMaterial: it.mainMaterial || it.materialName || "",
      materialQtyPerPcs: Number(it.materialQtyPerPcs || 0),
      unit: normalizeMaterialUnit(it.mainMaterial || it.materialName || it.name, it.unit),
    };
  });
}

function orderItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.qty || 0) * moneyValue(it.price || 0), 0);
}

function orderItemsSummary(order) {
  const items = normalizeOrderItems(order);
  if (items.length === 0) return "Produk";
  if (items.length === 1) return `${items[0].name} · ${items[0].qty} pcs`;
  return `${items.length} produk · ${items.reduce((sum, it) => sum + Number(it.qty || 0), 0)} pcs`;
}

function shipmentAutoNote(orderedQty, shippedQty) {
  const ordered = Number(orderedQty || 0);
  const shipped = Number(shippedQty || 0);
  const diff = shipped - ordered;
  if (diff === 0) return "Sesuai pesanan";
  if (diff < 0) return `Kekurangan pengiriman ${Math.abs(diff)} pcs`;
  return `Kelebihan pengiriman ${diff} pcs`;
}

function getDeliveryHistory(order) {
  return Array.isArray(order?.deliveries) ? order.deliveries : [];
}

function totalDeliveredQtyForItem(order, itemIndex, itemName) {
  return getDeliveryHistory(order).reduce((sum, delivery) => {
    const found = (delivery.items || []).find((it) =>
      Number(it.itemIndex ?? -1) === itemIndex || normalizeName(it.name) === normalizeName(itemName)
    );
    return sum + Number(found?.qty || 0);
  }, 0);
}

function normalizeShipmentItems(order) {
  const orderItems = normalizeOrderItems(order);
  const deliveries = getDeliveryHistory(order);

  if (deliveries.length > 0) {
    return orderItems.map((it, idx) => {
      const shippedQty = totalDeliveredQtyForItem(order, idx, it.name);
      return {
        name: it.name,
        orderedQty: Number(it.qty || 0),
        shippedQty,
        price: moneyValue(it.price || 0),
        bahanCost: moneyValue(it.bahanCost || 0),
        hppPerPcs: moneyValue(it.hppPerPcs || 0),
        mainMaterial: it.mainMaterial || "",
        materialQtyPerPcs: Number(it.materialQtyPerPcs || 0),
        unit: it.unit || "yard",
        note: shipmentAutoNote(Number(it.qty || 0), shippedQty),
      };
    });
  }

  const shipped = Array.isArray(order?.shippedItems) && order.shippedItems.length > 0
    ? order.shippedItems
    : null;

  if (!shipped) {
    return orderItems.map((it) => ({
      name: it.name,
      orderedQty: Number(it.qty || 0),
      shippedQty: 0,
      price: moneyValue(it.price || 0),
      bahanCost: moneyValue(it.bahanCost || 0),
      hppPerPcs: moneyValue(it.hppPerPcs || 0),
      mainMaterial: it.mainMaterial || "",
      materialQtyPerPcs: Number(it.materialQtyPerPcs || 0),
      unit: it.unit || "yard",
      note: `Belum dikirim ${Number(it.qty || 0)} pcs`,
    }));
  }

  return shipped.map((it, idx) => {
    const base = orderItems[idx] || {};
    const orderedQty = Number(it.orderedQty ?? base.qty ?? it.qty ?? 0);
    const shippedQty = Number(it.shippedQty ?? it.qty ?? 0);
    return {
      name: it.name || base.name || "Produk",
      orderedQty,
      shippedQty,
      price: moneyValue(it.price ?? base.price ?? 0),
      bahanCost: moneyValue(it.bahanCost ?? base.bahanCost ?? 0),
      hppPerPcs: moneyValue(it.hppPerPcs ?? base.hppPerPcs ?? 0),
      mainMaterial: it.mainMaterial || base.mainMaterial || "",
      materialQtyPerPcs: Number(it.materialQtyPerPcs ?? base.materialQtyPerPcs ?? 0),
      unit: it.unit || base.unit || "yard",
      note: it.note || it.keterangan || shipmentAutoNote(orderedQty, shippedQty),
    };
  });
}

function shipmentItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.shippedQty || 0) * moneyValue(it.price || 0), 0);
}

function shipmentItemsHppTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.shippedQty || 0) * moneyValue(it.hppPerPcs || 0), 0);
}

function billableOrderHppTotal(order) {
  const deliveries = getDeliveryHistory(order);
  if (deliveries.length > 0) return shipmentItemsHppTotal(normalizeShipmentItems(order));
  if (Array.isArray(order?.shippedItems) && order.shippedItems.length > 0) return shipmentItemsHppTotal(normalizeShipmentItems(order));
  return 0;
}

function deliveryItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + Number(it.qty || 0) * moneyValue(it.price || 0), 0);
}

function orderShippingCost(order) {
  return moneyValue(order?.shippingCost ?? order?.ongkir ?? 0);
}

function orderGrandTotal(items, shippingCost = 0) {
  return orderItemsTotal(items) + moneyValue(shippingCost || 0);
}

function billableOrderTotal(order) {
  const deliveries = getDeliveryHistory(order);
  const ongkir = orderShippingCost(order);

  if (deliveries.length > 0) {
    return shipmentItemsTotal(normalizeShipmentItems(order)) + ongkir;
  }

  if (Array.isArray(order?.shippedItems) && order.shippedItems.length > 0) {
    return shipmentItemsTotal(normalizeShipmentItems(order)) + ongkir;
  }

  if (order?.deliveredTotal !== undefined && order?.deliveredTotal !== null) {
    return Number(order.deliveredTotal || 0) + ongkir;
  }

  return 0;
}

function orderDeliveryStatus(order) {
  const items = normalizeShipmentItems(order);
  const totalOrdered = items.reduce((sum, it) => sum + Number(it.orderedQty || 0), 0);
  const totalShipped = items.reduce((sum, it) => sum + Number(it.shippedQty || 0), 0);
  if (totalShipped <= 0) return "Proses";
  if (totalShipped < totalOrdered) return "Dikirim Sebagian";
  return "Selesai";
}

// ─── UI Primitives ───────────────────────────────────────────────────────────

function Select({ label, value, onChange, children }) {
  return (
    <div className="space-y-1 relative z-30">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <select
        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-400 bg-white relative z-30"
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
                onClick={() => {
                  const y = today.getFullYear();
                  const m = String(today.getMonth() + 1).padStart(2, "0");
                  const d = String(today.getDate()).padStart(2, "0");
                  setCursor({ year: y, month: today.getMonth() });
                  onChange(`${y}-${m}-${d}`);
                  setOpen(false);
                  setView("day");
                }}
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

function TabBar({ tab, setTab, badgeCount = 0 }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "🏠" },
    { id: "orders", label: "Pesanan", icon: "🧾" },
    { id: "products", label: "Produk", icon: "🏷️" },
    { id: "purchases", label: "Supplier", icon: "🛍️" },
    { id: "expenses", label: "Pengeluaran", icon: "💸" },
    { id: "stock", label: "Stok", icon: "🧵" },
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

// ─── Invoice Modal ────────────────────────────────────────────────────────────
function InvoiceModal({ customerName, orders, onClose, getOrderPayments = (order) => order?.payments || [] }) {
  const canvasRef = React.useRef(null);
  const [imgUrl, setImgUrl] = React.useState(null);
  const [invoiceAction, setInvoiceAction] = React.useState(null);

  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  const customerOrders = orders
    .filter(o => {
      if (normalizeName(o.customer) !== normalizeName(customerName)) return false;
      // Hanya masukkan pesanan yang sudah dikirim atau selesai
      const s = String(o.status || "").toLowerCase();
      return s.includes("kirim") || s.includes("sent") || s.includes("shipped") ||
             s.includes("terkirim") || s === "selesai" || s === "lunas" || s.includes("done") || s.includes("complete");
    })
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  // Pesanan belum dikirim (tidak masuk invoice)
  const ordersBelumKirim = orders.filter(o => {
    if (normalizeName(o.customer) !== normalizeName(customerName)) return false;
    const s = String(o.status || "").toLowerCase();
    return !(s.includes("kirim") || s.includes("sent") || s.includes("shipped") ||
             s.includes("terkirim") || s === "selesai" || s === "lunas" || s.includes("done") || s.includes("complete"));
  });

  // Hitung total invoice dari rincian item + ongkir secara realtime.
  // Ini lebih aman untuk data lama yang nilai o.total-nya belum memasukkan ongkir.
  const invoiceOrderTotal = (order) => orderItemsTotal(normalizeOrderItems(order)) + orderShippingCost(order);

  const totalTagihan = customerOrders.reduce((s, o) => s + invoiceOrderTotal(o), 0);
  const totalBayar = customerOrders.reduce((s, o) =>
    s + getOrderPayments(o).reduce((a, p) => a + Number(moneyValue(p.amount || 0) || 0), 0), 0);
  const totalSisa = Math.max(Number(totalTagihan || 0) - Number(totalBayar || 0), 0);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setImgUrl(null);
    const ctx = canvas.getContext("2d");
    const W = 340;

    let estimatedH = 260;
    customerOrders.forEach(o => {
      const productRows = Math.max(normalizeShipmentItems(o).length, 1);
      const payments = getOrderPayments(o);
      estimatedH += 74;
      estimatedH += productRows * 86;
      estimatedH += orderShippingCost(o) > 0 ? 24 : 0;
      estimatedH += payments.length > 0 ? 42 + payments.length * 30 : 30;
      estimatedH += 54;
    });
    estimatedH += 190;

    canvas.width = W;
    canvas.height = estimatedH;

    ctx.fillStyle = "#fff9fc";
    ctx.fillRect(0, 0, W, estimatedH);
    ctx.fillStyle = "#fce7f3";
    ctx.fillRect(0, 0, 6, estimatedH);
    ctx.fillRect(W - 6, 0, 6, estimatedH);

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

    ctx.fillStyle = "#fff9fc";
    for (let x = 6; x < W - 6; x += 14) {
      ctx.beginPath();
      ctx.arc(x + 7, 110, 7, 0, Math.PI);
      ctx.fill();
    }

    ctx.fillStyle = "#ec4899";
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "center";
    ctx.fillText("─── RINCIAN PESANAN ───", W / 2, 142);

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

    customerOrders.forEach((o, idx) => {
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

      const invoiceItems = normalizeShipmentItems(o);
      ctx.fillStyle = "#a855f7";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Rincian Produk:", 20, curY);
      curY += 16;
      invoiceItems.forEach((it) => {
        const subtotal = Number(it.shippedQty || 0) * moneyValue(it.price || 0);
        const selisih = Number(it.shippedQty || 0) - Number(it.orderedQty || 0);
        ctx.fillStyle = "#1e293b";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "left";
        ctx.fillText(it.name || "Produk", 24, curY);
        ctx.fillStyle = "#64748b";
        ctx.font = "10px Arial";
        ctx.textAlign = "right";
        ctx.fillText(`Kirim ${it.shippedQty || 0}/${it.orderedQty || 0} pcs`, W - 20, curY);
        curY += 16;
        ctx.fillStyle = selisih < 0 ? "#e11d48" : "#64748b";
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.fillText(`Selisih ${selisih} pcs`, 24, curY);
        ctx.fillStyle = "#ec4899";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "right";
        ctx.fillText(`Subtotal Rp ${subtotal.toLocaleString("id-ID")}`, W - 20, curY);
        curY += 14;
        ctx.fillStyle = selisih < 0 ? "#e11d48" : selisih > 0 ? "#059669" : "#64748b";
        ctx.font = "9px Arial";
        ctx.textAlign = "left";
        ctx.fillText(it.note || shipmentAutoNote(it.orderedQty, it.shippedQty), 24, curY);
        curY += 18;
      });
      const ongkir = orderShippingCost(o);
      if (ongkir > 0) {
        drawRow("Subtotal Produk", `Rp ${orderItemsTotal(normalizeOrderItems(o)).toLocaleString("id-ID")}`, "#64748b", "#64748b", false);
        drawRow("Ongkir", `Rp ${ongkir.toLocaleString("id-ID")}`, "#64748b", "#ec4899", true);
      }
      drawRow("Total Pesanan", `Rp ${invoiceOrderTotal(o).toLocaleString("id-ID")}`, "#64748b", "#64748b", false);
      drawRow("Total Tagihan", `Rp ${invoiceOrderTotal(o).toLocaleString("id-ID")}`, "#64748b", "#1e293b", true);

      const statusColors = { Proses: "#f59e0b", Selesai: "#3b82f6", Lunas: "#10b981" };
      const sc = statusColors[o.status] || "#94a3b8";
      ctx.fillStyle = sc;
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`● ${o.status || "Proses"}`, 20, curY);
      curY += 18;

      const payments = getOrderPayments(o);
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
          ctx.fillText(`+ Rp ${moneyValue(p.amount || 0).toLocaleString("id-ID")}`, W - 20, curY);
          curY += 20;
        });
      } else {
        ctx.fillStyle = "#fca5a5";
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.fillText("Belum ada pembayaran", 20, curY);
        curY += 18;
      }

      const paid = payments.reduce((s, p) => s + moneyValue(p.amount || 0), 0);
      const sisa = Math.max(Number(invoiceOrderTotal(o) || 0) - Number(paid || 0), 0);
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
    ctx.fillText(rupiah(totalSisa), W - 24, curY + 78);

    curY += 100;

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
  }, [customerName, orders]);

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
        await navigator.share({ files: [file], title: `Invoice ${customerName}`, text: `Rincian pesanan ${customerName} dari Gallery Kerudung 💕` });
      } else {
        const link = document.createElement("a");
        link.download = `invoice-${safeName}.png`;
        link.href = imgUrl;
        link.click();
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

      {/* Notif pesanan belum dikirim */}
      {ordersBelumKirim.length > 0 && (
        <div className="rounded-xl px-3 py-2.5 mb-3 text-xs font-semibold" style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#b45309" }}>
          ⚠️ <strong>{ordersBelumKirim.length} pesanan</strong> belum dikirim, tidak dimasukkan ke invoice:
          <ul className="mt-1 space-y-0.5 font-normal">
            {ordersBelumKirim.map((o, i) => (
              <li key={i}>• {o.invoice || o.item || "-"} · {o.qty} pcs · <span style={{ color: "#92400e" }}>{o.status || "belum dikirim"}</span></li>
            ))}
          </ul>
        </div>
      )}

      {customerOrders.length === 0 && (
        <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: "#f9fafb", color: "#94a3b8" }}>
          Belum ada pesanan yang sudah dikirim untuk <strong>{customerName}</strong>.
        </div>
      )}

      {!imgUrl && customerOrders.length > 0 && (
        <div className="flex items-center justify-center py-10 gap-3">
          <div className="w-5 h-5 border-2 border-pink-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500">Membuat invoice...</span>
        </div>
      )}
      {imgUrl && (
        <div className="space-y-3">
          <img src={imgUrl} alt="invoice" className="w-full rounded-2xl border border-slate-100" />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setInvoiceAction("download")} className="w-full" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>⬇️ Download</Button>
            <Button onClick={() => setInvoiceAction("share")} className="w-full" style={{ background: "linear-gradient(135deg,#10b981,#25d366)" }}>📤 Kirim WA</Button>
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
                onClick={() => { const action = invoiceAction; setInvoiceAction(null); if (action === "download") downloadGambar(); else shareGambar(); }}
                className="flex-1 rounded-2xl py-3 font-semibold text-white"
                style={{ background: invoiceAction === "download" ? "linear-gradient(135deg,#7c3aed,#a855f7)" : "linear-gradient(135deg,#10b981,#25d366)" }}>
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
function GrafikKas({ transfers, transfersOut, expenses }) {
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
    (transfers || []).forEach((t) => {
      const k = getKey(t.date);
      if (!map[k]) map[k] = { bulan: k, masuk: 0, keluar: 0 };
      map[k].masuk += moneyValue(t.amount || 0);
    });
    (transfersOut || []).forEach((t) => {
      const k = getKey(t.date);
      if (!map[k]) map[k] = { bulan: k, masuk: 0, keluar: 0 };
      map[k].keluar += moneyValue(t.amount || 0);
    });
    expenses.forEach((e) => {
      const k = getKey(e.date);
      if (!map[k]) map[k] = { bulan: k, masuk: 0, keluar: 0 };
      map[k].keluar += moneyValue(e.amount || 0);
    });
    return Object.values(map).sort((a, b) => a.bulan.localeCompare(b.bulan)).slice(-6);
  }, [transfers, transfersOut, expenses]);

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
      map[k].nilai += moneyValue(o.total || 0);
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
  const [loginLoading, setLoginLoading] = useState(false);
  const [firestoreError, setFirestoreError] = useState("");

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
    if (loginLoading) return;

    setLoginLoading(true);
    try {
      setAuthError("");
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = e?.code || "";
      if (code === "auth/cancelled-popup-request" || code === "auth/popup-closed-by-user") {
        setAuthError("Login dibatalkan. Refresh halaman lalu klik Masuk dengan Google satu kali.");
      } else if (code === "auth/popup-blocked") {
        setAuthError("Popup login diblokir browser. Izinkan popup untuk situs ini, lalu coba lagi.");
      } else {
        setAuthError("Login gagal: " + (e?.message || code || "Terjadi kesalahan"));
      }
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() { await signOut(auth); }

  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [orders, setOrders] = useState([]);
  const [payrollExpenses, setPayrollExpenses] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [transfersOut, setTransfersOut] = useState([]);
  const [materialsStock, setMaterialsStock] = useState([]);
  const [productMasters, setProductMasters] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [editData, setEditData] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTransferInName, setFilterTransferInName] = useState("semua");
  const [filterTransferOutName, setFilterTransferOutName] = useState("semua");
  const [rekapStartDate, setRekapStartDate] = useState("");
  const [rekapEndDate, setRekapEndDate] = useState("");
  const [invoiceStartDate, setInvoiceStartDate] = useState("");
  const [invoiceEndDate, setInvoiceEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filterOrder, setFilterOrder] = useState("semua");
  const [sortOrder, setSortOrder] = useState("terbaru");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetSupplier, setConfirmResetSupplier] = useState(false); // step 1
  const [confirmResetSupplier2, setConfirmResetSupplier2] = useState(false); // step 2 (double confirm)
  const [rekapConfirm, setRekapConfirm] = useState(null);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [kirimModal, setKirimModal] = useState(null);
  const [tanggalKirim, setTanggalKirim] = useState(todayStr());
  const [kirimItems, setKirimItems] = useState([]);
  const [invoiceCustomer, setInvoiceCustomer] = useState(null);
  const [dashboardDetail, setDashboardDetail] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const legacyPaymentMigrationStartedRef = useRef(false);
  const legacySupplierPaymentMigrationStartedRef = useRef(false);

  const [orderForm, setOrderForm] = useState({
    date: todayStr(), customer: "", phone: "", items: [emptyOrderItem()], shippingCost: 0, dp: 0,
  });
  const [orderDraftLoaded, setOrderDraftLoaded] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({
    date: todayStr(), supplier: "", materials: [emptyPurchaseMaterial()], shippingCost: 0, dp: 0,
  });
  const emptyProductForm = {
    imageUrl: "", name: "", category: "", defaultPrice: 0, mainMaterial: "", materialQtyPerPcs: "",
    unit: "yard", bahanPricePerUnit: 0, bahanCost: 0, productionCost: 0, distributionCost: 0, otherCost: 0, isActive: true,
  };
  const [productForm, setProductForm] = useState(emptyProductForm);

  // ── Transfer form ──
  const [transferForm, setTransferForm] = useState({
    date: todayStr(), customer: "", bank: "", note: "", amount: 0,
  });
  const [transferOutForm, setTransferOutForm] = useState({
    date: todayStr(), supplier: "", bank: "", note: "", amount: 0,
  });

  async function handleProductImageUpload(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("File harus berupa gambar.");
    if (file.size > 8 * 1024 * 1024) return alert("Ukuran foto maksimal 8 MB.");
    try {
      const dataUrl = await resizeImageToDataUrl(file, 520, 0.72);
      setProductForm((f) => ({ ...f, imageUrl: dataUrl }));
    } catch (e) { alert("Gagal membaca foto: " + e.message); }
  }

  function resizeImageToDataUrl(file, maxSize = 520, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Foto tidak bisa dibuka."));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("File tidak bisa dibaca."));
      reader.readAsDataURL(file);
    });
  }

  const [expenseForm, setExpenseForm] = useState({ date: todayStr(), category: "", note: "", amount: 0 });
  const [orderPayForm, setOrderPayForm] = useState({ customer: "", date: todayStr(), bank: "", note: "", amount: 0 });
  const [supplierPayForm, setSupplierPayForm] = useState({ supplier: "", date: todayStr(), note: "", amount: 0 });

  const loadedRef = useRef({ orders: false, purchases: false, expenses: false, materials: false, products: false, productCategories: false, transfers: false, transfersOut: false, payroll: false });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gk_audit_logs") || "[]");
      setAuditLogs(Array.isArray(saved) ? saved.slice(0, 50) : []);
    } catch (e) { setAuditLogs([]); }
  }, []);

  useEffect(() => {
    if (!user || orderDraftLoaded) return;
    try {
      const saved = JSON.parse(localStorage.getItem("gk_order_draft") || "null");
      if (saved && typeof saved === "object") {
        setOrderForm({
          date: saved.date || todayStr(),
          customer: saved.customer || "",
          phone: saved.phone || "",
          items: Array.isArray(saved.items) && saved.items.length > 0 ? saved.items : [emptyOrderItem()],
          shippingCost: moneyValue(saved.shippingCost || saved.ongkir || 0),
          dp: Number(saved.dp || 0),
        });
      }
    } catch (e) {}
    finally { setOrderDraftLoaded(true); }
  }, [user, orderDraftLoaded]);

  useEffect(() => {
    if (!user || !orderDraftLoaded) return;
    const hasDraft = Boolean(orderForm.customer || orderForm.phone || moneyValue(orderForm.dp || 0) > 0 || moneyValue(orderForm.shippingCost || 0) > 0 || (orderForm.items || []).some((it) => it.name || Number(it.qty || 0) > 0 || moneyValue(it.price || 0) > 0));
    try {
      if (hasDraft) localStorage.setItem("gk_order_draft", JSON.stringify(orderForm));
      else localStorage.removeItem("gk_order_draft");
    } catch (e) {}
  }, [user, orderDraftLoaded, orderForm]);

  useEffect(() => {
    if (!user) {
      setOrders([]); setPurchases([]); setExpenses([]); setMaterialsStock([]); setProductMasters([]); setProductCategories([]); setTransfers([]); setTransfersOut([]); setPayrollExpenses([]);
      setFirestoreError(""); setLoading(false); return;
    }
    setLoading(true); setFirestoreError("");
    loadedRef.current = { orders: false, purchases: false, expenses: false, materials: false, products: false, productCategories: false, transfers: false, transfersOut: false, payroll: false };

    const checkAllLoaded = () => {
      const r = loadedRef.current;
      if (r.orders && r.purchases && r.expenses && r.materials && r.products && r.productCategories && r.transfers && r.transfersOut && r.payroll) setLoading(false);
    };

    const handleSnapshotError = (key, label, err) => {
      console.error(`${label}:`, err);
      loadedRef.current[key] = true;
      setFirestoreError((prev) => {
        const msg = `${label}: ${err?.message || "Gagal memuat data"}`;
        return prev ? `${prev}\n${msg}` : msg;
      });
      checkAllLoaded();
    };

    const unsubOrders = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.orders) { loadedRef.current.orders = true; checkAllLoaded(); }
    }, err => handleSnapshotError("orders", "orders", err));

    const unsubPurchases = onSnapshot(collection(db, "purchases"), (snap) => {
      setPurchases(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.purchases) { loadedRef.current.purchases = true; checkAllLoaded(); }
    }, err => handleSnapshotError("purchases", "purchases", err));

    const unsubExpenses = onSnapshot(collection(db, "expenses"), (snap) => {
      setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.expenses) { loadedRef.current.expenses = true; checkAllLoaded(); }
    }, err => handleSnapshotError("expenses", "expenses", err));

    const unsubMaterials = onSnapshot(collection(db, "materials"), (snap) => {
      setMaterialsStock(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.materials) { loadedRef.current.materials = true; checkAllLoaded(); }
    }, err => handleSnapshotError("materials", "materials", err));

    const unsubProducts = onSnapshot(collection(db, "products"), (snap) => {
      setProductMasters(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.products) { loadedRef.current.products = true; checkAllLoaded(); }
    }, err => handleSnapshotError("products", "products", err));

    const unsubProductCategories = onSnapshot(collection(db, "productCategories"), (snap) => {
      setProductCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.productCategories) { loadedRef.current.productCategories = true; checkAllLoaded(); }
    }, err => handleSnapshotError("productCategories", "productCategories", err));

    // ── Listener Transfers ──
    const unsubTransfers = onSnapshot(collection(db, "transfers"), (snap) => {
      setTransfers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.transfers) { loadedRef.current.transfers = true; checkAllLoaded(); }
    }, err => handleSnapshotError("transfers", "transfers", err));

    // ── Listener Transfers Keluar ──
    const unsubTransfersOut = onSnapshot(collection(db, "transfersOut"), (snap) => {
      setTransfersOut(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.transfersOut) { loadedRef.current.transfersOut = true; checkAllLoaded(); }
    }, err => handleSnapshotError("transfersOut", "transfersOut", err));

    // ── Listener Payroll Expenses (dari gallery-produksi, Firebase sama) ──
    const unsubPayroll = onSnapshot(collection(db, "payroll_expenses"), (snap) => {
      setPayrollExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (!loadedRef.current.payroll) { loadedRef.current.payroll = true; checkAllLoaded(); }
    }, err => handleSnapshotError("payroll", "payroll_expenses", err));

    return () => { unsubOrders(); unsubPurchases(); unsubExpenses(); unsubMaterials(); unsubProducts(); unsubProductCategories(); unsubTransfers(); unsubTransfersOut(); unsubPayroll(); };
  }, [user]);

  useEffect(() => {
    if (!user || loading || legacyPaymentMigrationStartedRef.current) return;
    const hasLegacyPayments = orders.some((order) => (order.payments || []).some((payment) => !payment.transferId && moneyValue(payment.amount || 0) > 0));
    if (!hasLegacyPayments) return;
    legacyPaymentMigrationStartedRef.current = true;
    (async () => {
      try {
        await migrateLegacyOrderPaymentsToUnifiedTransfers({ silent: true });
        await linkLegacyOrderPaymentsToTransfers({ silent: true });
      } catch (e) {
        console.warn("Migrasi/link pembayaran lama gagal:", e);
      } finally {
        legacyPaymentMigrationStartedRef.current = false;
      }
    })();
  }, [user, loading, orders, transfers]);

  useEffect(() => {
    if (!user || loading || legacySupplierPaymentMigrationStartedRef.current) return;
    const hasLegacySupplierPayments = purchases.some((purchase) =>
      (purchase.payments || []).some((payment) => !payment.transferOutId && moneyValue(payment.amount || 0) > 0)
    );
    if (!hasLegacySupplierPayments) return;
    legacySupplierPaymentMigrationStartedRef.current = true;
    (async () => {
      try {
        await migrateLegacySupplierPaymentsToUnifiedTransfersOut({ silent: true });
        await linkLegacySupplierPaymentsToTransfersOut({ silent: true });
      } catch (e) {
        console.warn("Migrasi/link pembayaran supplier lama gagal:", e);
      } finally {
        legacySupplierPaymentMigrationStartedRef.current = false;
      }
    })();
  }, [user, loading, purchases, transfersOut]);

  // ── Helper functions ──
  function orderSortValue(order) {
    return dateSerial(order?.createdAt || order?.date || order?.tanggal || "");
  }

  function orderPaymentTarget(order) {
    // Untuk alokasi FIFO, tagihan order harus tetap dihitung meskipun pengiriman belum lengkap.
    // Jika sudah ada realisasi pengiriman, nilai billableOrderTotal akan ikut dipertimbangkan.
    return Math.max(moneyValue(order?.total || 0), billableOrderTotal(order));
  }

  function customerOrdersSorted(customerName) {
    const key = normalizeName(customerName || "");
    return [...(orders || [])]
      .filter((o) => normalizeName(o.customer || "") === key)
      .sort((a, b) => {
        const dateDiff = orderSortValue(a) - orderSortValue(b);
        if (dateDiff !== 0) return dateDiff;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
  }

  function cleanCustomerPaymentNote(note) {
    const text = String(note || "").trim();
    if (!text) return "Pembayaran Customer";
    if (text.toLowerCase().includes("migrasi")) return "Pembayaran Customer";
    return text;
  }

  function isMigratedPaymentSource(value) {
    const haystack = typeof value === "object" && value !== null
      ? [value.source, value.note, value.bank, value.transferNote, value.legacyGroupKey, value.id].join(" ")
      : String(value || "");
    const text = haystack.toLowerCase();
    return text.includes("migrasi") || text.includes("saldo awal") || text.includes("opening balance");
  }

  function sortPaymentEvents(a, b) {
    const dateDiff = dateSerial(b.date || "") - dateSerial(a.date || "");
    if (dateDiff !== 0) return dateDiff;
    const createdDiff = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (createdDiff !== 0) return createdDiff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  }

  function customerPaymentEventsSorted(customerName) {
    const key = normalizeName(customerName || "");
    if (!key) return [];

    // Sumber utama pembayaran customer adalah transfers, karena ini catatan kas masuk yang utuh.
    // Data migrasi lama bisa berisi pecahan alokasi lama, jadi jika ada transfer input asli,
    // riwayat FIFO memakai transfer input asli saja agar tanggal/nominal tidak terlihat acak.
    const allTransferEvents = [...(transfers || [])]
      .filter((t) => normalizeName(t.customer || "") === key && moneyValue(t.amount || 0) > 0)
      .map((t) => ({
        id: t.id || "",
        date: t.date || t.createdAt?.slice?.(0, 10) || todayStr(),
        createdAt: t.createdAt || "",
        note: cleanCustomerPaymentNote(t.note || t.bank || "Pembayaran Customer"),
        amount: moneyValue(t.amount || 0),
        source: t.source || "transfers",
        transferId: t.id || "",
        transferAmount: moneyValue(t.amount || 0),
        transferNote: t.note || "",
      }));

    // Semua transfer valid tetap ikut FIFO untuk menghitung sisa tagihan.
    // Namun transfer migrasi hanya dipakai sebagai saldo/alokasi internal, bukan ditampilkan sebagai riwayat pembayaran real.
    if (allTransferEvents.length > 0) {
      return allTransferEvents
        .map((t) => ({ ...t, hiddenFromHistory: isMigratedPaymentSource(t) }))
        .sort(sortPaymentEvents);
    }

    // Fallback hanya untuk data lama yang benar-benar belum pernah punya transfers.
    const legacyEvents = customerOrdersSorted(customerName).flatMap((order) =>
      (order.payments || [])
        .filter((pay) => moneyValue(pay.amount || 0) > 0)
        .map((pay, idx) => ({
          id: `${order.id || "legacy"}-${idx}`,
          date: pay.date || order.createdAt || todayStr(),
          createdAt: order.createdAt || "",
          note: cleanCustomerPaymentNote(pay.note || "Pembayaran Customer"),
          amount: moneyValue(pay.amount || 0),
          source: "legacy_order_payment",
          transferId: pay.transferId || "",
          transferAmount: moneyValue(pay.transferAmount || pay.amount || 0),
          transferNote: pay.transferNote || pay.note || "",
        }))
    );

    return legacyEvents.sort(sortPaymentEvents);
  }

  function customerFifoPaymentMap(customerName) {
    const customerKey = normalizeName(customerName || "");
    const result = {};
    if (!customerKey) return result;

    const customerOrderList = customerOrdersSorted(customerName)
      .map((o) => ({ ...o, remaining: Math.max(0, orderPaymentTarget(o)) }))
      .filter((o) => o.id && o.remaining > 0);

    const customerPayments = customerPaymentEventsSorted(customerName);

    let orderIndex = 0;
    for (const payment of customerPayments) {
      let paymentLeft = moneyValue(payment.amount || 0);
      while (paymentLeft > 0 && orderIndex < customerOrderList.length) {
        const order = customerOrderList[orderIndex];
        if (order.remaining <= 0) { orderIndex += 1; continue; }

        const amount = Math.min(paymentLeft, order.remaining);
        if (amount > 0) {
          if (!result[order.id]) result[order.id] = [];
          result[order.id].push({
            date: payment.date || todayStr(),
            note: cleanCustomerPaymentNote(payment.note || "Pembayaran Customer"),
            amount,
            transferId: payment.transferId || "",
            transferAmount: payment.transferAmount || moneyValue(payment.amount || 0),
            transferNote: payment.transferNote || "",
            source: payment.source || "fifo_customer_payment",
            hiddenFromHistory: payment.hiddenFromHistory === true,
          });
          order.remaining = Math.max(0, order.remaining - amount);
          paymentLeft = Math.max(0, paymentLeft - amount);
        }

        if (order.remaining <= 0) orderIndex += 1;
      }
    }

    return result;
  }

  function orderPaymentRowsForCalculation(order) {
    if (!order?.id) return [];
    const fifoRows = customerFifoPaymentMap(order.customer)[order.id] || [];
    if (fifoRows.length > 0) return fifoRows;
    return Array.isArray(order?.payments) ? order.payments : [];
  }


  function paymentHistoryForDisplay(rows, defaultNote) {
    const list = Array.isArray(rows) ? rows : [];

    // FINAL AUDIT RULE:
    // 1) Baris pembayaran asli harus tampil per tanggal input dan boleh terpotong sesuai FIFO.
    // 2) Baris migrasi/saldo lama TIDAK boleh disamar menjadi pembayaran asli,
    //    karena nominal itu bukan input user per tanggal. Kalau masih ikut melunasi nota,
    //    tampilkan sebagai "Saldo Awal" agar total pembayaran dan sisa hutang tetap sinkron
    //    tanpa membuat riwayat pembayaran palsu.
    // 3) Jangan gabungkan saldo awal ke baris pembayaran asli.
    const visible = list
      .filter((p) => p.hiddenFromHistory !== true && !isMigratedPaymentSource(p) && moneyValue(p.amount || 0) > 0)
      .map((p) => ({ ...p, note: p.note || defaultNote, isOpeningBalance: false }));

    const openingBalance = list
      .filter((p) => (p.hiddenFromHistory === true || isMigratedPaymentSource(p)) && moneyValue(p.amount || 0) > 0)
      .map((p) => ({
        ...p,
        hiddenFromHistory: false,
        note: "Saldo Awal",
        isOpeningBalance: true,
      }));

    // CLEAN FINAL DISPLAY RULE:
    // Kalau saldo awal hampir melunasi nota lalu ada potongan pembayaran kecil
    // hanya untuk menutup selisih receh FIFO, gabungkan ke Saldo Awal.
    // Contoh Teh Susi: Saldo Awal 20.001.460 + Pembayaran 1.000
    // tampil sebagai Saldo Awal 20.002.460 agar riwayat tidak terlihat aneh.
    const SMALL_FIFO_REMAINDER = 10000;
    const visibleTotal = visible.reduce((sum, p) => sum + moneyValue(p.amount || 0), 0);
    if (openingBalance.length > 0 && visible.length > 0 && visibleTotal > 0 && visibleTotal <= SMALL_FIFO_REMAINDER) {
      const sortedOpening = [...openingBalance].sort(sortPaymentEvents);
      const firstOpening = sortedOpening[0];
      const mergedOpening = {
        ...firstOpening,
        amount: moneyValue(firstOpening.amount || 0) + visibleTotal,
        note: "Saldo Awal",
        isOpeningBalance: true,
      };
      return [mergedOpening, ...sortedOpening.slice(1)].sort(sortPaymentEvents);
    }

    return [...openingBalance, ...visible].sort(sortPaymentEvents);
  }

  function orderPaymentHistory(order) {
    return paymentHistoryForDisplay(orderPaymentRowsForCalculation(order), "Pembayaran Customer");
  }

  function orderPaidTotal(order) {
    return Math.round(orderPaymentRowsForCalculation(order).reduce((s, p) => s + moneyValue(p.amount || 0), 0));
  }

  function sisaOrder(order) {
    return Math.max(0, Math.round(Number(orderPaymentTarget(order) || 0) - Number(orderPaidTotal(order) || 0)));
  }

  function sisaOrderUntukAlokasi(order) {
    const target = orderPaymentTarget(order);
    return Math.max(0, Math.round(Number(target || 0) - Number(orderPaidTotal(order) || 0)));
  }

  function effectiveOrderStatus(order) {
    if (orderDeliveryStatus(order) === "Selesai" && sisaOrder(order) <= 0 && orderPaymentTarget(order) > 0) return "Lunas";
    return orderDeliveryStatus(order);
  }

  function isDeliveryComplete(order) {
    return orderDeliveryStatus(order) === "Selesai";
  }

  function supplierTransferOutTotal(supplierName) {
    const key = normalizeName(supplierName || "");
    if (!key) return 0;
    return Math.round((transfersOut || [])
      .filter((t) => normalizeName(t.supplier || "") === key && moneyValue(t.amount || 0) > 0)
      .reduce((s, t) => s + moneyValue(t.amount || 0), 0));
  }

  function purchaseSortValue(purchase) {
    return dateSerial(purchase?.createdAt || purchase?.date || purchase?.tanggal || "");
  }

  function supplierPurchasesSorted(supplierName) {
    const key = normalizeName(supplierName || "");
    return [...(purchases || [])]
      .filter((p) => normalizeName(p.supplier || "") === key)
      .sort((a, b) => {
        const dateDiff = purchaseSortValue(a) - purchaseSortValue(b);
        if (dateDiff !== 0) return dateDiff;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
  }

  function cleanSupplierPaymentNote(note) {
    const text = String(note || "").trim();
    if (!text) return "Pembayaran Supplier";
    if (text.toLowerCase().includes("migrasi")) return "Pembayaran Supplier";
    return text;
  }

  function usesOpeningBalanceForSupplier(supplierName) {
    // Business rule: Teh Susi notes were historically always paid lunas.
    // Opening balance / migration rows may be used only for these suppliers.
    // Other suppliers (example: Cii Dian) must rely on real payment inputs so
    // fake aggregate migration amounts do not appear as cicilan.
    const key = normalizeName(supplierName || "");
    return ["teh susi"].includes(key);
  }

  function supplierPaymentEventsSorted(supplierName) {
    const key = normalizeName(supplierName || "");
    if (!key) return [];

    // Sumber utama pembayaran supplier adalah transfersOut, karena ini catatan kas keluar yang utuh.
    // Data migrasi lama bisa berisi pecahan alokasi lama, jadi jika ada transfer input asli,
    // riwayat FIFO memakai transfer input asli saja agar tanggal/nominal mengikuti input Bayar Supplier.
    const allTransferEvents = [...(transfersOut || [])]
      .filter((t) => normalizeName(t.supplier || "") === key && moneyValue(t.amount || 0) > 0)
      .map((t) => ({
        id: t.id || "",
        date: t.date || t.createdAt?.slice?.(0, 10) || todayStr(),
        createdAt: t.createdAt || "",
        note: cleanSupplierPaymentNote(t.note || t.bank || "Pembayaran Supplier"),
        amount: moneyValue(t.amount || 0),
        source: t.source || "transfersOut",
        transferOutId: t.id || "",
        transferOutAmount: moneyValue(t.amount || 0),
        transferOutNote: t.note || "",
      }));

    // Semua transfer valid tetap ikut FIFO untuk menghitung sisa hutang.
    // Namun transfer migrasi hanya dipakai sebagai saldo/alokasi internal, bukan ditampilkan sebagai riwayat pembayaran real.
    if (allTransferEvents.length > 0) {
      return allTransferEvents
        .map((t) => ({ ...t, hiddenFromHistory: isMigratedPaymentSource(t) }))
        .sort(sortPaymentEvents);
    }

    // Fallback hanya untuk data lama yang benar-benar belum pernah punya transfersOut.
    const legacyEvents = supplierPurchasesSorted(supplierName).flatMap((purchase) =>
      (purchase.payments || [])
        .filter((pay) => moneyValue(pay.amount || 0) > 0)
        .map((pay, idx) => ({
          id: `${purchase.id || "legacy"}-${idx}`,
          date: pay.date || purchase.createdAt || todayStr(),
          createdAt: purchase.createdAt || "",
          note: cleanSupplierPaymentNote(pay.note || "Pembayaran Supplier"),
          amount: moneyValue(pay.amount || 0),
          source: "legacy_purchase_payment",
          transferOutId: pay.transferOutId || "",
          transferOutAmount: moneyValue(pay.transferOutAmount || pay.amount || 0),
          transferOutNote: pay.transferOutNote || pay.note || "",
        }))
    );

    return legacyEvents.sort(sortPaymentEvents);
  }

  function supplierFifoPaymentMap(supplierName) {
    const supplierKey = normalizeName(supplierName || "");
    const result = {};
    if (!supplierKey) return result;

    const supplierPurchases = supplierPurchasesSorted(supplierName)
      .map((p) => ({ ...p, remaining: Math.max(0, purchaseInvoiceTotal(p)) }))
      .filter((p) => p.id && p.remaining > 0);

    const supplierPayments = supplierPaymentEventsSorted(supplierName);
    const allowOpeningBalance = usesOpeningBalanceForSupplier(supplierName);

    let purchaseIndex = 0;
    for (const payment of supplierPayments) {
      // Do not let aggregate migration/saldo rows pay suppliers that should show
      // real cicilan history only. This prevents fake values like 29.336.910
      // from making Cii Dian look lunas without real payment rows.
      if (payment.hiddenFromHistory === true && !allowOpeningBalance) continue;
      let paymentLeft = moneyValue(payment.amount || 0);
      while (paymentLeft > 0 && purchaseIndex < supplierPurchases.length) {
        const purchase = supplierPurchases[purchaseIndex];
        if (purchase.remaining <= 0) { purchaseIndex += 1; continue; }

        const amount = Math.min(paymentLeft, purchase.remaining);
        if (amount > 0) {
          if (!result[purchase.id]) result[purchase.id] = [];
          result[purchase.id].push({
            date: payment.date || todayStr(),
            note: cleanSupplierPaymentNote(payment.note || "Pembayaran Supplier"),
            amount,
            transferOutId: payment.transferOutId || "",
            transferOutAmount: payment.transferOutAmount || moneyValue(payment.amount || 0),
            transferOutNote: payment.transferOutNote || "",
            source: payment.source || "fifo_supplier_payment",
            hiddenFromHistory: payment.hiddenFromHistory === true,
          });
          purchase.remaining = Math.max(0, purchase.remaining - amount);
          paymentLeft = Math.max(0, paymentLeft - amount);
        }

        if (purchase.remaining <= 0) purchaseIndex += 1;
      }
    }

    return result;
  }

  function supplierTransferAllocationDetails(transferOut) {
    const supplierName = transferOut?.supplier || "";
    const transferId = transferOut?.id || "";
    if (!supplierName || !transferId) return [];

    const fifoMap = supplierFifoPaymentMap(supplierName);
    return supplierPurchasesSorted(supplierName).flatMap((purchase) => {
      const rows = fifoMap[purchase.id] || [];
      return rows
        .filter((payment) => payment.transferOutId === transferId)
        .map((payment) => ({
          purchaseId: purchase.id,
          purchaseDate: purchase.createdAt || purchase.date || todayStr(),
          material: purchaseMaterialsSummary(purchase),
          amount: moneyValue(payment.amount || 0),
          purchaseTotal: purchaseInvoiceTotal(purchase),
        }));
    });
  }

  function purchasePaymentRowsForCalculation(purchase) {
    if (!purchase?.id) return [];
    const fifoRows = supplierFifoPaymentMap(purchase.supplier)[purchase.id] || [];
    if (fifoRows.length > 0) return fifoRows;
    return Array.isArray(purchase?.payments) ? purchase.payments : [];
  }

  function purchasePaymentHistory(purchase) {
    return paymentHistoryForDisplay(purchasePaymentRowsForCalculation(purchase), "Pembayaran Supplier");
  }

  function purchasePaidTotal(purchase) {
    const paid = purchasePaymentRowsForCalculation(purchase)
      .reduce((s, p) => s + moneyValue(p.amount || 0), 0);
    return Math.round(paid);
  }

  function sisaPurchase(purchase) {
    const total = Math.round(Number(purchaseInvoiceTotal(purchase) || 0));
    const paid = Math.round(Number(purchasePaidTotal(purchase) || 0));
    return Math.max(0, total - paid);
  }

  function hutangPurchase(purchase) {
    return Math.max(0, Math.round(sisaPurchase(purchase)));
  }

  function depositSupplier(purchase) {
    return Math.max(0, Math.round(purchasePaidTotal(purchase) - purchaseInvoiceTotal(purchase)));
  }


  // ── Stats ──
  const stats = useMemo(() => {
    const customerPaid = transfers.reduce((s, t) => s + safeSummaryMoney(t.amount || 0), 0);
    const transferTotal = customerPaid;
    const receivable = orders.reduce((s, o) => s + Math.max(0, orderPaymentTarget(o) - orderPaidTotal(o)), 0);
    const supplierPaid = transfersOut.reduce((s, t) => s + safeSummaryMoney(t.amount || 0), 0);
    const supplierDebt = purchases.reduce((s, p) => s + hutangPurchase(p), 0);
    const otherExpense = expenses.reduce((s, e) => s + safeSummaryMoney(e.amount || 0), 0);
    const cashOut = supplierPaid + otherExpense;
    const netCash = customerPaid - cashOut;
    return { customerPaid, transferTotal, cashOut, receivable, supplierDebt, netCash };
  }, [orders, purchases, expenses, transfers, transfersOut]);

  const pesananTelat = useMemo(() => {
    const now = new Date();
    return orders.filter((o) => {
      if (effectiveOrderStatus(o) === "Lunas") return false;
      const sisa = sisaOrder(o);
      if (sisa <= 0) return false;
      const paymentHistory = orderPaymentHistory(o);
      const lastPayStr = paymentHistory.length > 0 ? paymentHistory[paymentHistory.length - 1].date : (o.createdAt || null);
      if (!lastPayStr) return true;
      const lastPayDate = new Date(lastPayStr + "T00:00:00");
      if (isNaN(lastPayDate.getTime())) return true;
      const diffDays = Math.floor((now - lastPayDate) / (1000 * 60 * 60 * 24));
      return diffDays >= 7;
    });
  }, [orders, transfers]);

  const uniqueCustomers = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const name = capitalizeWords(o.customer || "");
      const key = normalizeName(name);
      if (!key) return;
      if (!map[key]) map[key] = { name, totalSisa: 0, totalPesanan: 0, pesananAktif: 0, totalRealisasiSisa: 0 };
      map[key].totalPesanan += 1;
      const sisaAlokasi = Math.max(0, sisaOrderUntukAlokasi(o));
      const sisaRealisasi = Math.max(0, sisaOrder(o));
      if (sisaAlokasi > 0) {
        map[key].totalSisa += sisaAlokasi;
        map[key].totalRealisasiSisa += sisaRealisasi;
        map[key].pesananAktif += 1;
      }
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, transfers]);

  const uniqueSuppliers = useMemo(() => {
    const map = {};
    purchases.forEach(p => {
      const name = capitalizeWords(p.supplier || "");
      const key = normalizeName(name);
      if (!key) return;
      if (!map[key]) map[key] = { name, totalSisa: 0, totalBelanja: 0, belanjaAktif: 0 };
      map[key].totalBelanja += 1;
      const sisa = hutangPurchase(p);
      if (sisa > 0) { map[key].totalSisa += sisa; map[key].belanjaAktif += 1; }
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [purchases, transfersOut]);

  // ── Search filter ──
  const q = search.toLowerCase();
  const filteredOrders = useMemo(() => orders
    .filter((o) => {
      const itemText = normalizeOrderItems(o).map((it) => it.name).join(" ").toLowerCase();
      return !q || o.customer?.toLowerCase().includes(q) || o.invoice?.toLowerCase().includes(q) || itemText.includes(q);
    })
    .sort(sortOldestBottom), [orders, q]);

  const filteredPurchases = useMemo(() => [...purchases]
    .filter((p) => {
      const bahanText = normalizePurchaseMaterials(p).map((it) => it.name).join(" ").toLowerCase();
      return !q || p.supplier?.toLowerCase().includes(q) || p.material?.toLowerCase().includes(q) || bahanText.includes(q);
    })
    .sort(sortPurchaseNewestFirst), [purchases, q]);

  const filteredMaterialsStock = useMemo(() => (materialsStock || []).filter((m) => {
    return !q || String(m?.name || "").toLowerCase().includes(q) || String(m?.category || "").toLowerCase().includes(q);
  }), [materialsStock, q]);

  const filteredProductMasters = useMemo(() => (productMasters || []).filter((p) => {
    return !q || String(p?.name || "").toLowerCase().includes(q) || String(p?.category || "").toLowerCase().includes(q) || String(p?.mainMaterial || "").toLowerCase().includes(q);
  }), [productMasters, q]);

  const filteredExpenses = useMemo(() => (expenses || [])
    .filter((e) => !q || String(e?.category || "").toLowerCase().includes(q) || String(e?.note || "").toLowerCase().includes(q))
    .sort(sortOldestBottom), [expenses, q]);

  const combinedExpenseRows = useMemo(() => {
    const manualRows = (filteredExpenses || []).map((e) => ({
      id: e.id,
      rowType: "expense",
      date: e.date || todayStr(),
      title: e.category || "Pengeluaran",
      subtitle: e.note || "Biaya operasional",
      amount: moneyValue(e.amount || 0),
      raw: e,
    }));

    const supplierTransferRows = (transfersOut || [])
      .map((t) => ({
        id: t.id || `${t.date || todayStr()}-${t.supplier || "supplier"}-${t.amount || 0}`,
        rowType: "supplier_transfer",
        date: t.date || t.createdAt?.slice?.(0, 10) || todayStr(),
        title: t.supplier || "Supplier",
        subtitle: `${t.bank || "Bayar Supplier"}${t.note ? ` · ${t.note}` : ""}`,
        amount: moneyValue(t.amount || 0),
        raw: t,
      }))
      .filter((t) => t.amount > 0 && (!q || String(t.title || "").toLowerCase().includes(q) || String(t.subtitle || "").toLowerCase().includes(q)));

    return [...manualRows, ...supplierTransferRows].sort(sortOldestBottom);
  }, [filteredExpenses, transfersOut, q]);

  const totalCombinedExpenses = useMemo(() => (
    combinedExpenseRows.reduce((s, row) => s + moneyValue(row.amount || 0), 0)
  ), [combinedExpenseRows]);

  const filteredTransfers = useMemo(() => (transfers || [])
    .filter((t) => !q || String(t?.customer || "").toLowerCase().includes(q) || String(t?.bank || "").toLowerCase().includes(q) || String(t?.note || "").toLowerCase().includes(q))
    .sort(sortOldestBottom), [transfers, q]);

  const filteredTransfersOut = useMemo(() => (transfersOut || [])
    .filter((t) => !q || String(t?.supplier || "").toLowerCase().includes(q) || String(t?.bank || "").toLowerCase().includes(q) || String(t?.note || "").toLowerCase().includes(q))
    .sort(sortOldestBottom), [transfersOut, q]);

  const autoTransferInRows = useMemo(() => {
    return (transfers || [])
      .map((t) => ({
        id: t.id || `${t.date || todayStr()}-${t.customer || "customer"}-${t.amount || 0}`,
        date: t.date || t.createdAt?.slice?.(0, 10) || todayStr(),
        customer: t.customer || "Customer",
        bank: t.bank || "Bayar Customer",
        note: cleanCustomerPaymentNote(t.note || ""),
        amount: moneyValue(t.amount || 0),
      }))
      .filter((t) => t.amount > 0 && (!q || String(t.customer || "").toLowerCase().includes(q) || String(t.bank || "").toLowerCase().includes(q) || String(t.note || "").toLowerCase().includes(q)))
      .sort(sortOldestBottom);
  }, [transfers, q]);

  const autoTransferOutRows = useMemo(() => {
    return (transfersOut || [])
      .map((t) => ({
        id: t.id || `${t.date || todayStr()}-${t.supplier || "supplier"}-${t.amount || 0}`,
        date: t.date || t.createdAt?.slice?.(0, 10) || todayStr(),
        supplier: t.supplier || "Supplier",
        bank: t.bank || "Bayar Supplier",
        note: cleanSupplierPaymentNote(t.note || ""),
        amount: moneyValue(t.amount || 0),
      }))
      .filter((t) => t.amount > 0 && (!q || String(t.supplier || "").toLowerCase().includes(q) || String(t.bank || "").toLowerCase().includes(q) || String(t.note || "").toLowerCase().includes(q)))
      .sort(sortOldestBottom);
  }, [transfersOut, q]);

  const transferInNameOptions = useMemo(() => {
    const names = new Set();
    autoTransferInRows.forEach((t) => {
      const name = capitalizeWords(t.customer || "");
      if (name) names.add(name);
    });
    return ["semua", ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [autoTransferInRows]);

  const transferOutNameOptions = useMemo(() => {
    const names = new Set();
    autoTransferOutRows.forEach((t) => {
      const name = capitalizeWords(t.supplier || "");
      if (name) names.add(name);
    });
    return ["semua", ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [autoTransferOutRows]);

  const selectedTransferInRows = useMemo(() => {
    if (filterTransferInName === "semua") return autoTransferInRows;
    const selected = normalizeName(filterTransferInName);
    return autoTransferInRows.filter((t) => normalizeName(t.customer) === selected);
  }, [autoTransferInRows, filterTransferInName]);

  const selectedTransferOutRows = useMemo(() => {
    if (filterTransferOutName === "semua") return autoTransferOutRows;
    const selected = normalizeName(filterTransferOutName);
    return autoTransferOutRows.filter((t) => normalizeName(t.supplier) === selected);
  }, [autoTransferOutRows, filterTransferOutName]);

  const totalSelectedTransferIn = useMemo(() => (
    selectedTransferInRows.reduce((s, t) => s + moneyValue(t.amount || 0), 0)
  ), [selectedTransferInRows]);

  const totalSelectedTransferOut = useMemo(() => (
    selectedTransferOutRows.reduce((s, t) => s + moneyValue(t.amount || 0), 0)
  ), [selectedTransferOutRows]);

  const productCategoryOptions = useMemo(() => {
    const map = {};
    productCategories.forEach((c) => { const name = capitalizeWords(c.name || ""); if (name) map[normalizeName(name)] = name; });
    productMasters.forEach((p) => { const name = capitalizeWords(p.category || ""); if (name) map[normalizeName(name)] = name; });
    ["Kerudung", "Mukena", "Baju Anak", "Gamis", "Lainnya"].forEach((name) => { if (!map[normalizeName(name)]) map[normalizeName(name)] = name; });
    return Object.values(map).sort((a, b) => a.localeCompare(b));
  }, [productCategories, productMasters]);

  function findProductMaster(name) {
    return productMasters.find((p) => normalizeName(p.name) === normalizeName(name));
  }

  // ── CRUD ──
  async function upsertProductCategory(categoryName) {
    const name = capitalizeWords(categoryName || "Lainnya");
    if (!name) return;
    const existing = productCategories.find((c) => normalizeName(c.name) === normalizeName(name));
    if (!existing?.id) await addDoc(collection(db, "productCategories"), { name, createdAt: todayStr(), updatedAt: todayStr(), source: "auto_dari_pesanan" });
  }

  async function upsertProductMastersFromOrder(items) {
    for (const it of items) {
      const name = capitalizeWords(it.name || "");
      if (!name) continue;
      const category = capitalizeWords(it.category || "Lainnya");
      await upsertProductCategory(category);
      const existing = productMasters.find((p) => normalizeName(p.name) === normalizeName(name));
      if (existing?.id && existing?.source === "manual_template") continue;
      const payload = {
        name, category,
        defaultPrice: moneyValue(it.price || 0),
        bahanCost: moneyValue(it.bahanCost || existing?.bahanCost || 0),
        hppPerPcs: moneyValue(it.hppPerPcs || existing?.hppPerPcs || 0),
        mainMaterial: it.mainMaterial || existing?.mainMaterial || "",
        materialQtyPerPcs: Number(it.materialQtyPerPcs || existing?.materialQtyPerPcs || 0),
        unit: it.unit || existing?.unit || "yard",
        updatedAt: todayStr(), source: "auto_dari_pesanan",
      };
      if (existing?.id) await updateDoc(doc(db, "products", existing.id), payload);
      else await addDoc(collection(db, "products"), { ...payload, createdAt: todayStr() });
    }
  }

  async function recordMaterialMutation(line) {
    try {
      await addDoc(collection(db, "materialMutations"), {
        date: line.date || todayStr(), type: line.type || "adjustment",
        materialName: capitalizeWords(line.name || line.materialName || ""),
        category: line.category || "Bahan", unit: normalizeMaterialUnit(line.name || line.materialName, line.unit),
        qty: Number(line.qty || 0), total: moneyValue(line.total || 0),
        refType: line.refType || "manual", refId: line.refId || "", refLabel: line.refLabel || "",
        note: line.note || "", createdAt: new Date().toISOString(), user: user?.email || "-",
      });
    } catch (e) { console.warn("Gagal mencatat mutasi bahan:", e); }
  }

  async function applyMaterialMovements(items, options = {}) {
    const direction = Number(options.direction || 1) >= 0 ? 1 : -1;
    const refType = options.refType || "manual";
    const refId = options.refId || "";
    const refLabel = options.refLabel || "";
    const date = options.date || todayStr();
    const allowMinus = options.allowMinus === true;
    const aggregated = aggregateMaterialLines(items);
    if (aggregated.length === 0) return;

    const localMap = {};
    (materialsStock || []).forEach((m) => {
      const unit = normalizeMaterialUnit(m.name, m.unit);
      localMap[materialLineKey(m.name, unit)] = { ...m, unit };
    });

    for (const it of aggregated) {
      const name = capitalizeWords(it.name || "");
      const unit = normalizeMaterialUnit(name, it.unit);
      const key = materialLineKey(name, unit);
      const qty = assertReasonableQty(it.qty || 0, `Qty ${name}`);
      const qtyDelta = qty * direction;
      let existing = localMap[key];
      let mutationTotalDelta = 0;

      if (!existing?.id && direction < 0) throw new Error(`Stok bahan ${name} belum ada, tidak bisa dikurangi.`);
      if (existing?.id && existing.unit && existing.unit !== unit) throw new Error(`Satuan bahan ${name} sudah tercatat sebagai ${existing.unit}. Tidak bisa digabung dengan ${unit}.`);

      if (!existing?.id) {
        const stock = Math.max(0, qty);
        const totalValue = Math.round(Math.max(0, moneyValue(it.total || 0)));
        mutationTotalDelta = totalValue;
        const avgCost = stock > 0 ? Math.round(totalValue / stock) : 0;
        if (avgCost > LIMITS.MAX_AVG_COST || totalValue > LIMITS.MAX_STOCK_VALUE_PER_MATERIAL) {
          throw new Error(`Nilai stok ${name} tidak masuk akal. Cek harga/qty sebelum menyimpan.`);
        }
        const payload = { name, category: it.category || "Bahan", unit, stock, minStock: unit === "kg" ? 5 : 20, avgCost, totalValue, createdAt: todayStr(), updatedAt: todayStr(), source: refType === "purchase" ? "auto_dari_belanja_supplier" : "auto_dari_mutasi" };
        const created = await addDoc(collection(db, "materials"), payload);
        existing = { id: created.id, ...payload };
        localMap[key] = existing;
      } else {
        const oldStock = Number(existing.stock || 0);
        const oldValue = safeMaterialStockValue(existing);
        const movementValue = direction < 0
          ? (moneyValue(it.total || 0) > 0 ? Math.round(moneyValue(it.total || 0)) : Math.round(qty * Math.round(Number(existing.avgCost || 0))))
          : Math.round(moneyValue(it.total || 0));
        const totalDelta = movementValue * direction;
        mutationTotalDelta = totalDelta;
        const nextStockRaw = oldStock + qtyDelta;
        if (!allowMinus && nextStockRaw < -0.000001) throw new Error(`Stok ${name} tidak cukup. Sisa ${oldStock.toLocaleString("id-ID")} ${unit}, butuh ${Math.abs(qtyDelta).toLocaleString("id-ID")} ${unit}.`);
        const newStock = allowMinus ? nextStockRaw : Math.max(0, nextStockRaw);
        const newValue = Math.round(Math.max(0, oldValue + totalDelta));
        const avgCost = newStock > 0 ? Math.round(newValue / newStock) : Math.round(Number(existing.avgCost || 0));
        if (avgCost > LIMITS.MAX_AVG_COST || newValue > LIMITS.MAX_STOCK_VALUE_PER_MATERIAL) {
          throw new Error(`Nilai stok ${name} tidak masuk akal. Cek harga/qty atau bersihkan data stok lama terlebih dahulu.`);
        }
        const payload = { name, category: it.category || existing.category || "Bahan", unit, stock: newStock, avgCost, totalValue: newValue, updatedAt: todayStr() };
        await updateDoc(doc(db, "materials", existing.id), payload);
        existing = { ...existing, ...payload };
        localMap[key] = existing;
      }

      await recordMaterialMutation({ date, type: direction > 0 ? "masuk" : "keluar", name, category: it.category || existing.category || "Bahan", unit, qty: qtyDelta, total: mutationTotalDelta, refType, refId, refLabel, note: options.note || (direction > 0 ? "Stok masuk" : "Stok keluar") });
    }
  }

  async function applyPurchaseStock(purchase) {
    await applyMaterialMovements(normalizePurchaseMaterials(purchase), { direction: 1, refType: "purchase", refId: purchase?.id || "", refLabel: purchase?.supplier || "Belanja supplier", date: purchase?.createdAt || todayStr(), note: "Belanja supplier" });
  }

  async function rollbackPurchaseStock(purchase) {
    await applyMaterialMovements(normalizePurchaseMaterials(purchase), { direction: -1, refType: "purchase_rollback", refId: purchase?.id || "", refLabel: purchase?.supplier || "Rollback supplier", date: todayStr(), note: "Rollback edit/hapus belanja supplier", allowMinus: false });
  }

  async function saveProductTemplate() {
    if (!productForm.name.trim()) return alert("Nama produk wajib diisi");
    if (!productForm.category.trim()) return alert("Kategori wajib diisi");
    if (!moneyValue(productForm.defaultPrice || 0)) return alert("Harga jual wajib diisi");
    setIsSaving(true);
    try {
      const name = capitalizeWords(productForm.name);
      const category = capitalizeWords(productForm.category || "Lainnya");
      await upsertProductCategory(category);
      const existing = productMasters.find((p) => normalizeName(p.name) === normalizeName(name));
      const materialQtyPerPcs = numberValue(productForm.materialQtyPerPcs || 0);
      const bahanPricePerUnit = moneyValue(productForm.bahanPricePerUnit || 0);
      const bahanCost = bahanPricePerUnit > 0 && materialQtyPerPcs > 0
        ? Math.round(bahanPricePerUnit * materialQtyPerPcs)
        : moneyValue(productForm.bahanCost || 0);
      const hppPerPcs = calculateProductHpp({ ...productForm, bahanCost });
      const payload = {
        imageUrl: productForm.imageUrl || "", name, category,
        defaultPrice: moneyValue(productForm.defaultPrice || 0),
        mainMaterial: capitalizeWords(productForm.mainMaterial || ""),
        materialQtyPerPcs,
        unit: productForm.unit === "kg" ? "kg" : "yard",
        bahanPricePerUnit,
        bahanCost,
        productionCost: moneyValue(productForm.productionCost || 0),
        distributionCost: moneyValue(productForm.distributionCost || 0),
        otherCost: moneyValue(productForm.otherCost || 0),
        hppPerPcs,
        isActive: productForm.isActive !== false,
        updatedAt: todayStr(), source: "manual_template",
      };
      if (existing?.id) await updateDoc(doc(db, "products", existing.id), payload);
      else await addDoc(collection(db, "products"), { ...payload, createdAt: todayStr() });
      addAuditLog("Simpan Template Produk", `${name} - HPP ${rupiah(payload.hppPerPcs)}`);
      setProductForm(emptyProductForm); setModal(null);
    } catch (e) { alert("Gagal menyimpan produk: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addOrder() {
    if (!orderForm.customer.trim()) return alert("Nama customer wajib diisi");
    const cleanItems = (orderForm.items || [])
      .map((it) => ({
        name: (it.name || "").trim(), category: capitalizeWords(it.category || "Lainnya"),
        qty: Number(it.qty || 0), price: moneyValue(it.price || 0),
        bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0),
        productId: it.productId || "", mainMaterial: it.mainMaterial || "",
        materialQtyPerPcs: numberValue(it.materialQtyPerPcs || 0), unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit),
        note: shipmentAutoNote(Number(it.orderedQty || 0), Number(it.shippedQty || 0)),
      }))
      .filter((it) => it.name && it.qty > 0 && it.price >= 0);
    if (cleanItems.length === 0) return alert("Minimal isi 1 produk dengan nama dan jumlah pcs.");
    if (cleanItems.some((it) => it.qty < 0)) return alert("Jumlah pcs tidak boleh negatif");
    const subtotal = orderItemsTotal(cleanItems);
    const shippingCost = moneyValue(orderForm.shippingCost || 0);
    const total = subtotal + shippingCost;
    if (!total) return alert("Total pesanan wajib diisi");
    setIsSaving(true);
    try {
      const dp = moneyValue(orderForm.dp || 0);
      const firstItem = cleanItems[0] || {};
      await upsertProductMastersFromOrder(cleanItems);
      const newOrder = {
        invoice: generateInvoice(), customer: capitalizeWords(orderForm.customer),
        phone: orderForm.phone || "", items: cleanItems,
        item: firstItem.name || "Produk", qty: cleanItems.reduce((s, it) => s + Number(it.qty || 0), 0),
        hargaPcs: moneyValue(firstItem.price || 0), subtotal, shippingCost, ongkir: shippingCost, total,
        status: "Proses", createdAt: orderForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Awal", amount: dp }] : [],
      };
      await addDoc(collection(db, "orders"), newOrder);
      addAuditLog("Tambah Pesanan", `${newOrder.customer} - ${newOrder.invoice} - ${rupiah(newOrder.total)}`);
      resetOrderDraft(); setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addPurchase() {
    if (!purchaseForm.supplier.trim()) return alert("Nama supplier wajib diisi");
    const cleanMaterials = (purchaseForm.materials || [])
      .map((it) => {
        const name = capitalizeWords(it.name || "");
        const qty = assertReasonableQty(it.qty || 0, `Qty ${name || "bahan"}`);
        const pricePerUnit = assertReasonableMoney(it.pricePerUnit || 0, `Harga ${name || "bahan"}`, LIMITS.MAX_PRICE_PER_UNIT);
        return { name, category: it.category || "Kain", qty, unit: normalizeMaterialUnit(name, it.unit), pricePerUnit, total: qty * pricePerUnit };
      })
      .filter((it) => it.name && it.qty > 0 && it.pricePerUnit > 0);
    if (cleanMaterials.length === 0) return alert("Minimal isi 1 bahan, qty, dan harga per yard/kg.");
    if (cleanMaterials.some((it) => it.qty < 0)) return alert("Qty bahan tidak boleh negatif");
    const subtotal = purchaseMaterialsTotal(cleanMaterials);
    const shippingCost = moneyValue(purchaseForm.shippingCost || purchaseForm.ongkir || 0);
    const total = subtotal + shippingCost;
    if (!total) return alert("Total belanja wajib diisi");
    setIsSaving(true);
    let purchaseRef = null; let stockApplied = false;
    try {
      const dp = moneyValue(purchaseForm.dp || 0);
      const firstMaterial = cleanMaterials[0] || {};
      const newPurchasePayload = {
        supplier: purchaseForm.supplier.trim(), materials: cleanMaterials,
        material: cleanMaterials.map((it) => it.name).join(", ") || "Bahan Baku",
        qty: cleanMaterials.map((it) => `${it.qty} ${it.unit}`).join(", "),
        category: firstMaterial.category || "Kain", subtotal, shippingCost, ongkir: shippingCost, total, createdAt: purchaseForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Supplier", amount: dp }] : [],
      };
      purchaseRef = await addDoc(collection(db, "purchases"), newPurchasePayload);
      if (dp > 0) {
        await addDoc(collection(db, "transfersOut"), {
          date: todayStr(),
          supplier: capitalizeWords(newPurchasePayload.supplier),
          bank: "DP Supplier",
          note: `DP awal · ${purchaseMaterialsSummary(newPurchasePayload)}`,
          amount: dp,
          source: "dp_supplier",
          purchaseId: purchaseRef.id,
          createdAt: new Date().toISOString(),
          user: user?.email || "-",
        });
      }
      await applyPurchaseStock({ id: purchaseRef.id, ...newPurchasePayload });
      stockApplied = true;
      addAuditLog("Tambah Supplier", `${newPurchasePayload.supplier} - ${rupiah(newPurchasePayload.total)}`);
      setPurchaseForm({ date: todayStr(), supplier: "", materials: [emptyPurchaseMaterial()], shippingCost: 0, dp: 0 }); setModal(null);
    } catch (e) {
      try {
        if (stockApplied && purchaseRef?.id) { const cp = purchases.find((p) => p.id === purchaseRef.id); if (cp) await rollbackPurchaseStock(cp); }
        if (purchaseRef?.id) await deleteDoc(doc(db, "purchases", purchaseRef.id));
      } catch (cleanupErr) { console.warn("Cleanup tambah supplier gagal:", cleanupErr); }
      alert("Gagal menyimpan: " + e.message);
    }
    finally { setIsSaving(false); }
  }

  async function addExpense() {
    if (!expenseForm.category.trim()) return alert("Kategori wajib diisi");
    if (!expenseForm.amount) return alert("Nominal wajib diisi");
    setIsSaving(true);
    try {
      const payload = { date: expenseForm.date || todayStr(), category: expenseForm.category.trim(), note: expenseForm.note || "", amount: moneyValue(expenseForm.amount || 0) };
      await addDoc(collection(db, "expenses"), payload);
      addAuditLog("Tambah Pengeluaran", `${payload.category} - ${rupiah(payload.amount)}`);
      setExpenseForm({ date: todayStr(), category: "", note: "", amount: 0 }); setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  // ── Tambah Transfer ──
  async function addTransfer() {
    if (!transferForm.customer.trim()) return alert("Nama customer/pengirim wajib diisi");
    if (!transferForm.bank.trim()) return alert("Bank/metode transfer wajib diisi");
    if (!parseMoney(transferForm.amount)) return alert("Nominal wajib diisi");
    setIsSaving(true);
    try {
      const payload = {
        date: transferForm.date || todayStr(),
        customer: capitalizeWords(transferForm.customer),
        bank: transferForm.bank.trim(),
        note: transferForm.note || "",
        amount: parseMoney(transferForm.amount),
        createdAt: new Date().toISOString(),
        user: user?.email || "-",
      };
      await addDoc(collection(db, "transfers"), payload);
      addAuditLog("Catat Transfer Masuk", `${payload.customer} - ${payload.bank} - ${rupiah(payload.amount)}`);
      setTransferForm({ date: todayStr(), customer: "", bank: "", note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  // ── Tambah Transfer Keluar ──
  async function addTransferOut() {
    if (!transferOutForm.supplier.trim()) return alert("Nama supplier/penerima wajib diisi");
    if (!transferOutForm.bank.trim()) return alert("Bank/metode transfer wajib diisi");
    if (!parseMoney(transferOutForm.amount)) return alert("Nominal wajib diisi");
    setIsSaving(true);
    try {
      const payload = {
        date: transferOutForm.date || todayStr(),
        supplier: capitalizeWords(transferOutForm.supplier),
        bank: transferOutForm.bank.trim(),
        note: transferOutForm.note || "",
        amount: parseMoney(transferOutForm.amount),
        createdAt: new Date().toISOString(),
        user: user?.email || "-",
      };
      await addDoc(collection(db, "transfersOut"), payload);
      addAuditLog("Catat Transfer Keluar", `${payload.supplier} - ${payload.bank} - ${rupiah(payload.amount)}`);
      setTransferOutForm({ date: todayStr(), supplier: "", bank: "", note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function addOrderPayment() {
    if (!orderPayForm.customer.trim()) return alert("Nama customer/pengirim wajib diisi");
    if (!orderPayForm.bank.trim()) return alert("Bank/metode transfer wajib diisi");
    const paymentAmount = parseMoney(orderPayForm.amount);
    if (paymentAmount <= 0) return alert("Nominal pembayaran wajib diisi");

    const customerName = capitalizeWords(orderPayForm.customer);
    const normQ = normalizeName(customerName);
    const customerOrders = orders
      .filter((o) => normalizeName(o.customer) === normQ && sisaOrderUntukAlokasi(o) > 0)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    setIsSaving(true);
    try {
      const date = orderPayForm.date || todayStr();
      const bank = orderPayForm.bank.trim();
      const note = orderPayForm.note || "Pembayaran customer";

      // Transfer masuk disimpan UTUH sebagai mutasi rekening.
      // Jangan dipecah per invoice di collection transfers.
      const transferPayload = {
        date,
        customer: customerName,
        bank,
        note,
        amount: paymentAmount,
        source: "bayar_customer_utuh",
        createdAt: new Date().toISOString(),
        user: user?.email || "-",
      };
      const transferRef = await addDoc(collection(db, "transfers"), transferPayload);

      // Setelah mutasi rekening tersimpan, nominal yang sama boleh dialokasikan
      // ke order/pesanan untuk menjaga piutang dan status lunas tetap akurat.
      let sisa = paymentAmount;
      const alokasi = [];
      for (const order of customerOrders) {
        if (sisa <= 0) break;
        const sisaOrder_ = Math.max(0, sisaOrderUntukAlokasi(order));
        if (sisaOrder_ <= 0) continue;
        const bayar = Math.min(sisa, sisaOrder_);
        sisa -= bayar;
        const newPayment = {
          date,
          note: bank,
          amount: bayar,
          transferId: transferRef.id,
          transferAmount: paymentAmount,
          transferNote: note,
        };
        const updatedPayments = [...(order.payments || []), newPayment];
        await updateDoc(doc(db, "orders", order.id), { payments: updatedPayments });
        await cekDanUpdateLunas(order.id, billableOrderTotal(order), updatedPayments, order);
        alokasi.push({ invoice: order.invoice, bayar });
      }

      addAuditLog("Bayar Customer", `${customerName} - ${bank} - ${rupiah(paymentAmount)}${alokasi.length ? " · dialokasikan ke order" : ""}`);
      const info = alokasi.length > 0
        ? `\n\nAlokasi piutang:\n${alokasi.map(a => `${a.invoice || "Pesanan"}: ${rupiah(a.bayar)}`).join("\n")}`
        : "\n\nTidak ada pesanan aktif, jadi hanya dicatat sebagai transfer masuk.";
      const sisaMsg = sisa > 0 ? `\nSisa ${rupiah(sisa)} tidak dialokasikan ke order.` : "";
      alert(`✅ Transfer masuk tersimpan utuh: ${rupiah(paymentAmount)}${info}${sisaMsg}`);
      setOrderPayForm({ customer: "", date: todayStr(), bank: "", note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  async function migrateLegacyOrderPaymentsToUnifiedTransfers({ silent = false } = {}) {
    const groups = {};
    orders.forEach((order) => {
      (order.payments || []).forEach((payment) => {
        // Payment baru sudah punya transferId, tidak perlu dimigrasi lagi.
        if (payment.transferId) return;
        const amount = moneyValue(payment.amount || 0);
        if (amount <= 0) return;
        const date = payment.date || order.createdAt || todayStr();
        const customer = capitalizeWords(order.customer || "Customer");
        const bank = payment.note || "Bayar Customer";
        const key = `${normalizeName(customer)}__${date}__${normalizeName(bank)}`;
        if (!groups[key]) {
          groups[key] = {
            legacyGroupKey: key,
            date,
            customer,
            bank,
            note: "",
            amount: 0,
            source: "migrasi_order_payment_utuh",
            createdAt: new Date().toISOString(),
            user: user?.email || "-",
          };
        }
        groups[key].amount += amount;
      });
    });

    const existingKeys = new Set((transfers || []).map((t) => t.legacyGroupKey).filter(Boolean));
    const existingSignatures = new Set((transfers || []).map((t) => `${normalizeName(t.customer)}__${t.date || t.createdAt?.slice?.(0, 10) || ""}__${normalizeName(t.bank)}__${moneyValue(t.amount || 0)}`));
    const rows = Object.values(groups).filter((g) => {
      const signature = `${normalizeName(g.customer)}__${g.date}__${normalizeName(g.bank)}__${moneyValue(g.amount || 0)}`;
      return g.amount > 0 && !existingKeys.has(g.legacyGroupKey) && !existingSignatures.has(signature);
    });
    if (rows.length === 0) {
      if (!silent) alert("Tidak ada pembayaran lama yang perlu dimigrasi.");
      return 0;
    }

    for (const row of rows) {
      await addDoc(collection(db, "transfers"), row);
    }
    addAuditLog("Migrasi Pembayaran Lama", `${rows.length} transfer masuk lama disatukan ke collection transfers`);
    if (!silent) alert(`✅ ${rows.length} transfer masuk lama berhasil dimigrasi sebagai transaksi utuh.`);
    return rows.length;
  }

  function legacyOrderPaymentKey(order, payment) {
    const date = payment.date || order.createdAt || todayStr();
    const customer = capitalizeWords(order.customer || "Customer");
    const bank = payment.note || "Bayar Customer";
    return `${normalizeName(customer)}__${date}__${normalizeName(bank)}`;
  }

  function legacySupplierPaymentKey(purchase, payment) {
    const date = payment.date || purchase.createdAt || todayStr();
    const supplier = capitalizeWords(purchase.supplier || "Supplier");
    const bank = payment.note || "Bayar Supplier";
    return `${normalizeName(supplier)}__${date}__${normalizeName(bank)}`;
  }

  async function linkLegacyOrderPaymentsToTransfers({ silent = false } = {}) {
    let changedOrders = 0;
    for (const order of orders) {
      const oldPayments = order.payments || [];
      let changed = false;
      const nextPayments = oldPayments.map((payment) => {
        if (payment.transferId || moneyValue(payment.amount || 0) <= 0) return payment;
        const key = legacyOrderPaymentKey(order, payment);
        const transfer = (transfers || []).find((t) =>
          t.legacyGroupKey === key || (
            normalizeName(t.customer) === normalizeName(order.customer) &&
            (t.date || t.createdAt?.slice?.(0, 10) || "") === (payment.date || order.createdAt || todayStr()) &&
            normalizeName(t.bank) === normalizeName(payment.note || "Bayar Customer")
          )
        );
        if (!transfer?.id) return payment;
        changed = true;
        return {
          ...payment,
          transferId: transfer.id,
          transferAmount: moneyValue(transfer.amount || 0),
          transferNote: transfer.note || "",
          migratedTransferLinked: true,
        };
      });
      if (changed) {
        await updateDoc(doc(db, "orders", order.id), { payments: nextPayments });
        changedOrders += 1;
      }
    }
    if (changedOrders > 0) addAuditLog("Link Pembayaran Lama", `${changedOrders} pesanan ditautkan ke transfer masuk`);
    if (!silent && changedOrders === 0) alert("Tidak ada pembayaran lama yang perlu ditautkan.");
    return changedOrders;
  }

  async function linkLegacySupplierPaymentsToTransfersOut({ silent = false } = {}) {
    let changedPurchases = 0;
    for (const purchase of purchases) {
      const oldPayments = purchase.payments || [];
      let changed = false;
      const nextPayments = oldPayments.map((payment) => {
        if (payment.transferOutId || moneyValue(payment.amount || 0) <= 0) return payment;
        const key = legacySupplierPaymentKey(purchase, payment);
        const transferOut = (transfersOut || []).find((t) =>
          t.legacyGroupKey === key || (
            normalizeName(t.supplier) === normalizeName(purchase.supplier) &&
            (t.date || t.createdAt?.slice?.(0, 10) || "") === (payment.date || purchase.createdAt || todayStr()) &&
            normalizeName(t.bank) === normalizeName(payment.note || "Bayar Supplier")
          )
        );
        if (!transferOut?.id) return payment;
        changed = true;
        return {
          ...payment,
          transferOutId: transferOut.id,
          transferOutAmount: moneyValue(transferOut.amount || 0),
          transferOutNote: transferOut.note || "",
          migratedTransferLinked: true,
        };
      });
      if (changed) {
        await updateDoc(doc(db, "purchases", purchase.id), { payments: nextPayments });
        changedPurchases += 1;
      }
    }
    if (changedPurchases > 0) addAuditLog("Link Pembayaran Supplier Lama", `${changedPurchases} belanja ditautkan ke transfer keluar`);
    if (!silent && changedPurchases === 0) alert("Tidak ada pembayaran supplier lama yang perlu ditautkan.");
    return changedPurchases;
  }

  async function migrateLegacySupplierPaymentsToUnifiedTransfersOut({ silent = false } = {}) {
    const groups = {};
    purchases.forEach((purchase) => {
      (purchase.payments || []).forEach((payment) => {
        // Payment supplier baru sudah punya transferOutId, tidak perlu dimigrasi lagi.
        if (payment.transferOutId) return;
        const amount = moneyValue(payment.amount || 0);
        if (amount <= 0) return;
        const date = payment.date || purchase.createdAt || todayStr();
        const supplier = capitalizeWords(purchase.supplier || "Supplier");
        const bank = payment.note || "Bayar Supplier";
        const key = `${normalizeName(supplier)}__${date}__${normalizeName(bank)}`;
        if (!groups[key]) {
          groups[key] = {
            legacyGroupKey: key,
            date,
            supplier,
            bank,
            note: "Pembayaran Supplier",
            amount: 0,
            source: "migrasi_supplier_payment_utuh",
            createdAt: new Date().toISOString(),
            user: user?.email || "-",
          };
        }
        groups[key].amount += amount;
      });
    });

    const existingKeys = new Set((transfersOut || []).map((t) => t.legacyGroupKey).filter(Boolean));
    const existingSignatures = new Set((transfersOut || []).map((t) => `${normalizeName(t.supplier)}__${t.date || t.createdAt?.slice?.(0, 10) || ""}__${normalizeName(t.bank)}__${moneyValue(t.amount || 0)}`));
    const rows = Object.values(groups).filter((g) => {
      const signature = `${normalizeName(g.supplier)}__${g.date}__${normalizeName(g.bank)}__${moneyValue(g.amount || 0)}`;
      return g.amount > 0 && !existingKeys.has(g.legacyGroupKey) && !existingSignatures.has(signature);
    });

    if (rows.length === 0) {
      if (!silent) alert("Tidak ada pembayaran supplier lama yang perlu dimigrasi.");
      return 0;
    }

    for (const row of rows) {
      await addDoc(collection(db, "transfersOut"), row);
    }
    addAuditLog("Migrasi Pembayaran Supplier Lama", `${rows.length} transfer keluar supplier lama disatukan ke collection transfersOut`);
    if (!silent) alert(`✅ ${rows.length} pembayaran supplier lama berhasil masuk ke pengeluaran/transfer keluar.`);
    return rows.length;
  }

  async function addSupplierPayment() {
    if (!supplierPayForm.supplier) return alert("Pilih nama supplier terlebih dahulu");
    const supplierPaymentAmount = parseMoney(supplierPayForm.amount);
    if (supplierPaymentAmount <= 0) return alert("Nominal pembayaran wajib diisi");
    if (supplierPaymentAmount > LIMITS.MAX_MONEY_INPUT) return alert(`Nominal pembayaran terlalu besar: ${rupiah(supplierPaymentAmount)}`);

    const supplierName = capitalizeWords(supplierPayForm.supplier);
    const normQ = normalizeName(supplierName);
    const supplierPurchases = purchases
      .filter((p) => normalizeName(p.supplier) === normQ && sisaPurchase(p) > 0)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    if (supplierPurchases.length === 0) return alert("Tidak ada hutang aktif untuk supplier ini.");

    setIsSaving(true);
    try {
      let sisa = supplierPaymentAmount;
      const date = supplierPayForm.date || todayStr();
      const note = supplierPayForm.note || "Pembayaran Supplier";

      // Transfer keluar disimpan utuh sebagai mutasi kas, lalu dialokasikan ke hutang supplier.
      const transferOutPayload = {
        date,
        supplier: supplierName,
        bank: note,
        note,
        amount: supplierPaymentAmount,
        source: "bayar_supplier_utuh",
        createdAt: new Date().toISOString(),
        user: user?.email || "-",
      };
      const transferOutRef = await addDoc(collection(db, "transfersOut"), transferOutPayload);

      const alokasi = [];
      for (const purchase of supplierPurchases) {
        if (sisa <= 0) break;
        const sisaHutang = Math.max(0, sisaPurchase(purchase));
        if (sisaHutang <= 0) continue;
        const bayar = Math.min(sisa, sisaHutang);
        sisa -= bayar;
        const newPayment = {
          date,
          note,
          amount: bayar,
          transferOutId: transferOutRef.id,
          transferOutAmount: supplierPaymentAmount,
          transferOutNote: note,
        };
        const updatedPayments = [...(purchase.payments || []), newPayment];
        await updateDoc(doc(db, "purchases", purchase.id), { payments: updatedPayments });
        alokasi.push({ tanggal: purchase.createdAt || "-", material: purchaseMaterialsSummary(purchase), bayar });
      }

      const info = alokasi.map(a => `${a.tanggal} - ${a.material}: ${rupiah(a.bayar)}`).join("\n");
      const sisaMsg = sisa > 0 ? `\n\nSisa ${rupiah(sisa)} dicatat sebagai transfer keluar, belum dialokasikan ke hutang.` : "";
      addAuditLog("Pembayaran Supplier", `${supplierName} - ${rupiah(supplierPaymentAmount)}`);
      alert(`✅ Transfer keluar tersimpan utuh: ${rupiah(supplierPaymentAmount)}\n\nAlokasi hutang:\n${info}${sisaMsg}`);
      setSupplierPayForm({ supplier: "", date: todayStr(), note: "", amount: 0 }); setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  function deleteItem(type, id) { setConfirmDelete({ type, id }); }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    setConfirmDelete(null);
    let oldPurchase = null; let stockRolledBack = false;
    try {
      if (type === "purchases") {
        oldPurchase = purchases.find((p) => p.id === id) || null;
        if (oldPurchase) { await rollbackPurchaseStock(oldPurchase); stockRolledBack = true; }
      }
      await deleteDoc(doc(db, type, id));
      addAuditLog("Hapus Data", `${type} - ${id}`);
    } catch (e) {
      try { if (type === "purchases" && oldPurchase && stockRolledBack) await applyPurchaseStock(oldPurchase); } catch (restoreErr) { console.warn("Restore stok gagal:", restoreErr); }
      alert("Gagal menghapus: " + e.message);
    }
  }

  async function resetSemuaSupplier() {
    setConfirmResetSupplier2(false);
    setIsSaving(true);
    try {
      // Hapus semua purchases
      const purchaseDeletes = purchases.map((p) => deleteDoc(doc(db, "purchases", p.id)));
      // Hapus semua transfersOut
      const transfersOutDeletes = transfersOut.map((t) => deleteDoc(doc(db, "transfersOut", t.id)));
      await Promise.all([...purchaseDeletes, ...transfersOutDeletes]);
      addAuditLog(
        "Reset Semua Supplier",
        `Hapus ${purchases.length} purchase + ${transfersOut.length} transfersOut. Tanpa rollback stok.`
      );
      alert(`✅ Reset selesai.\n${purchases.length} nota purchase & ${transfersOut.length} pembayaran supplier telah dihapus.\nStok bahan tidak diubah.`);
    } catch (e) {
      alert("Gagal reset: " + e.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function tandaiDikirim() {
    if (!kirimModal) return;
    const order = orders.find((o) => o.id === kirimModal);
    if (!order) return alert("Pesanan tidak ditemukan.");
    const cleanDeliveryItems = kirimItems
      .map((it, idx) => ({ itemIndex: Number(it.itemIndex ?? idx), name: it.name || "Produk", qty: Number(it.shippedQty || 0), price: moneyValue(it.price || 0), bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0), mainMaterial: it.mainMaterial || "", materialQtyPerPcs: Number(it.materialQtyPerPcs || 0), unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit) }))
      .filter((it) => it.name && it.qty > 0);
    if (cleanDeliveryItems.length === 0) return alert("Isi minimal 1 qty pengiriman hari ini.");
    const newDelivery = { date: tanggalKirim || todayStr(), items: cleanDeliveryItems, total: deliveryItemsTotal(cleanDeliveryItems) };
    const nextDeliveries = [...getDeliveryHistory(order), newDelivery];
    const tempOrder = { ...order, deliveries: nextDeliveries };
    const deliveredTotal = billableOrderTotal(tempOrder);
    const paid = (order.payments || []).reduce((sum, p) => sum + moneyValue(p.amount || 0), 0);
    const deliveryStatus = orderDeliveryStatus(tempOrder);
    const newStatus = paid >= deliveredTotal && deliveredTotal > 0 && deliveryStatus === "Selesai" ? "Lunas" : deliveryStatus;
    setIsSaving(true);
    const usage = buildMaterialUsageFromDeliveryItems(cleanDeliveryItems);
    let stockDeducted = false;
    try {
      if (usage.length > 0) { await applyMaterialMovements(usage, { direction: -1, refType: "delivery", refId: kirimModal, refLabel: order.invoice || order.customer || "Pengiriman", date: tanggalKirim || todayStr(), note: "Pemakaian bahan saat pengiriman" }); stockDeducted = true; }
      await updateDoc(doc(db, "orders", kirimModal), { status: newStatus, tanggalKirim: tanggalKirim || todayStr(), deliveries: nextDeliveries, deliveredTotal, deliveredHppTotal: billableOrderHppTotal(tempOrder) });
      addAuditLog("Input Pengiriman", `${order.customer} - ${rupiah(deliveredTotal)}`);
      setKirimModal(null); setTanggalKirim(todayStr()); setKirimItems([]);
    } catch (e) {
      try { if (stockDeducted && usage.length > 0) await applyMaterialMovements(usage, { direction: 1, refType: "delivery_rollback", refId: kirimModal, refLabel: order.invoice || order.customer || "Rollback", date: tanggalKirim || todayStr(), note: "Rollback stok" }); } catch (rb) { console.warn("Rollback gagal:", rb); }
      alert("Gagal menyimpan: " + e.message);
    }
    finally { setIsSaving(false); }
  }

  function openKirimModal(order) {
    const deliveryItems = normalizeShipmentItems(order).map((it, idx) => {
      const remaining = Math.max(Number(it.orderedQty || 0) - Number(it.shippedQty || 0), 0);
      return { itemIndex: idx, name: it.name, orderedQty: Number(it.orderedQty || 0), alreadyShipped: Number(it.shippedQty || 0), remainingQty: remaining, shippedQty: remaining, price: moneyValue(it.price || 0), bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0), mainMaterial: it.mainMaterial || "", materialQtyPerPcs: Number(it.materialQtyPerPcs || 0), unit: it.unit || "yard", note: it.note || shipmentAutoNote(Number(it.orderedQty || 0), Number(it.shippedQty || 0)) };
    });
    setKirimModal(order.id); setTanggalKirim(todayStr()); setKirimItems(deliveryItems);
  }

  function statusSetelahPembayaran(order, payments = order?.payments || []) {
    const paid = (payments || []).reduce((s, p) => s + moneyValue(p.amount || 0), 0);
    const tagihan = billableOrderTotal({ ...order, payments });
    const deliveryStatus = orderDeliveryStatus(order);
    if (deliveryStatus === "Selesai" && tagihan > 0 && paid >= tagihan) return "Lunas";
    return deliveryStatus;
  }

  async function cekDanUpdateLunas(orderId, total, updatedPayments, orderRef = null) {
    const paid = updatedPayments.reduce((s, p) => s + moneyValue(p.amount || 0), 0);
    const complete = orderRef ? isDeliveryComplete(orderRef) : true;
    if (complete && paid >= moneyValue(total || 0) && moneyValue(total || 0) > 0) {
      try { await updateDoc(doc(db, "orders", orderId), { status: "Lunas" }); } catch (e) {}
    }
  }

  async function realokasiTransferMasuk(transferId, payload) {
    const customerName = capitalizeWords(payload.customer || "");
    const amount = parseMoney(payload.amount || 0);

    // 1) Hapus dulu alokasi lama dari semua order yang pernah memakai transfer ini.
    const cleanedOrders = [];
    for (const order of orders) {
      const oldPayments = order.payments || [];
      const nextPayments = oldPayments.filter((p) => p.transferId !== transferId);
      if (nextPayments.length !== oldPayments.length) {
        const nextStatus = statusSetelahPembayaran(order, nextPayments);
        await updateDoc(doc(db, "orders", order.id), { payments: nextPayments, status: nextStatus });
        cleanedOrders.push({ ...order, payments: nextPayments, status: nextStatus });
      } else {
        cleanedOrders.push(order);
      }
    }

    // 2) Update mutasi rekening utuh.
    await updateDoc(doc(db, "transfers", transferId), payload);

    // 3) Alokasikan ulang hanya untuk transfer pembayaran customer.
    if (!payload.source || !(String(payload.source).includes("bayar_customer") || String(payload.source).includes("migrasi_order_payment"))) return [];

    let sisa = amount;
    const alokasi = [];
    const targetOrders = cleanedOrders
      .filter((o) => normalizeName(o.customer) === normalizeName(customerName) && sisaOrderUntukAlokasi(o) > 0)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    for (const order of targetOrders) {
      if (sisa <= 0) break;
      const sisaOrder_ = Math.max(0, sisaOrderUntukAlokasi(order));
      if (sisaOrder_ <= 0) continue;
      const bayar = Math.min(sisa, sisaOrder_);
      sisa -= bayar;
      const newPayment = {
        date: payload.date || todayStr(),
        note: payload.bank || "Pembayaran customer",
        amount: bayar,
        transferId,
        transferAmount: amount,
        transferNote: payload.note || "",
      };
      const updatedPayments = [...(order.payments || []), newPayment];
      await updateDoc(doc(db, "orders", order.id), { payments: updatedPayments, status: statusSetelahPembayaran(order, updatedPayments) });
      alokasi.push({ invoice: order.invoice || "Pesanan", bayar });
    }
    return alokasi;
  }

  async function realokasiTransferKeluar(transferOutId, payload) {
    const supplierName = capitalizeWords(payload.supplier || "");
    const amount = parseMoney(payload.amount || 0);

    // 1) Hapus dulu alokasi lama dari semua belanja supplier.
    const cleanedPurchases = [];
    for (const purchase of purchases) {
      const oldPayments = purchase.payments || [];
      const nextPayments = oldPayments.filter((p) => p.transferOutId !== transferOutId);
      if (nextPayments.length !== oldPayments.length) {
        await updateDoc(doc(db, "purchases", purchase.id), { payments: nextPayments });
        cleanedPurchases.push({ ...purchase, payments: nextPayments });
      } else {
        cleanedPurchases.push(purchase);
      }
    }

    // 2) Update mutasi kas keluar utuh.
    await updateDoc(doc(db, "transfersOut", transferOutId), payload);

    // 3) Alokasikan ulang hanya untuk transfer pembayaran supplier.
    if (!payload.source || !(String(payload.source).includes("bayar_supplier") || String(payload.source).includes("migrasi_supplier_payment"))) return [];

    let sisa = amount;
    const alokasi = [];
    const targetPurchases = cleanedPurchases
      .filter((p) => normalizeName(p.supplier) === normalizeName(supplierName) && sisaPurchase(p) > 0)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    for (const purchase of targetPurchases) {
      if (sisa <= 0) break;
      const sisaHutang = Math.max(0, sisaPurchase(purchase));
      if (sisaHutang <= 0) continue;
      const bayar = Math.min(sisa, sisaHutang);
      sisa -= bayar;
      const newPayment = {
        date: payload.date || todayStr(),
        note: payload.note || payload.bank || "Pembayaran Supplier",
        amount: bayar,
        transferOutId,
        transferOutAmount: amount,
        transferOutNote: payload.note || "",
      };
      const updatedPayments = [...(purchase.payments || []), newPayment];
      await updateDoc(doc(db, "purchases", purchase.id), { payments: updatedPayments });
      alokasi.push({ tanggal: purchase.createdAt || "-", material: purchaseMaterialsSummary(purchase), bayar });
    }
    return alokasi;
  }


  async function pulihkanHistoriPembayaranSupplier(purchaseId) {
    const purchase = purchases.find((p) => p.id === purchaseId);
    if (!purchase) return alert("Data supplier tidak ditemukan.");

    const supplierName = capitalizeWords(purchase.supplier || "");
    if (!supplierName) return alert("Nama supplier kosong.");

    const totalHutang = hutangPurchase(purchase);
    if (totalHutang <= 0) return alert("Data supplier ini sudah tidak memiliki hutang aktif.");

    const usedTransferOutIds = new Set();
    purchases.forEach((p) => {
      if (p.id === purchaseId) return;
      (p.payments || []).forEach((pay) => {
        if (pay.transferOutId) usedTransferOutIds.add(pay.transferOutId);
      });
    });

    const existingPaymentTransferIds = new Set((purchase.payments || []).map((pay) => pay.transferOutId).filter(Boolean));
    const relatedTransfers = (transfersOut || [])
      .filter((t) => {
        const sameSupplier = normalizeName(t.supplier) === normalizeName(supplierName);
        const validAmount = moneyValue(t.amount || 0) > 0;
        const notAlreadyInThisPurchase = !existingPaymentTransferIds.has(t.id);
        const notUsedByOtherPurchase = !usedTransferOutIds.has(t.id);
        return sameSupplier && validAmount && notAlreadyInThisPurchase && notUsedByOtherPurchase;
      })
      .sort((a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || ""));

    if (relatedTransfers.length === 0) {
      return alert(`Tidak ada transfer keluar lama yang belum terpakai untuk supplier ${supplierName}.`);
    }

    const totalTransfer = relatedTransfers.reduce((sum, t) => sum + moneyValue(t.amount || 0), 0);
    const lanjut = window.confirm(
      `Pulihkan histori pembayaran supplier ${supplierName}?\n\n` +
      `Ditemukan ${relatedTransfers.length} transfer keluar lama.\n` +
      `Total transfer: ${rupiah(totalTransfer)}\n` +
      `Sisa hutang data ini: ${rupiah(totalHutang)}\n\n` +
      `Transfer akan ditempel ke data supplier ini tanpa membuat kas keluar baru.`
    );
    if (!lanjut) return;

    let sisaHutang = totalHutang;
    const restoredPayments = [];

    for (const transfer of relatedTransfers) {
      if (sisaHutang <= 0) break;
      const transferAmount = moneyValue(transfer.amount || 0);
      const amount = Math.min(transferAmount, sisaHutang);
      if (amount <= 0) continue;

      restoredPayments.push({
        date: transfer.date || transfer.createdAt?.slice?.(0, 10) || todayStr(),
        note: transfer.note || transfer.bank || "Pembayaran Supplier Lama",
        amount,
        transferOutId: transfer.id,
        transferOutAmount: transferAmount,
        transferOutNote: transfer.note || "",
        restoredFromDeletedPurchase: true,
      });

      sisaHutang -= amount;
    }

    if (restoredPayments.length === 0) return alert("Tidak ada pembayaran yang bisa dipulihkan.");

    await updateDoc(doc(db, "purchases", purchaseId), {
      payments: [...(purchase.payments || []), ...restoredPayments],
    });

    addAuditLog("Pulihkan Histori Supplier", `${supplierName} - ${restoredPayments.length} pembayaran - ${rupiah(restoredPayments.reduce((s, p) => s + moneyValue(p.amount || 0), 0))}`);
    alert(`✅ ${restoredPayments.length} histori pembayaran berhasil dipulihkan ke ${supplierName}.`);
    setEditData(null);
  }

  async function saveEdit() {
    if (!editData) return;
    setIsSaving(true);
    try {
      const { type, id } = editData;
      let payload = {};
      if (type === "orders") {
        const cleanItems = normalizeOrderItems(editData).map((it) => ({ productId: it.productId || "", name: (it.name || "").trim(), category: capitalizeWords(it.category || "Lainnya"), qty: Number(it.qty || 0), price: moneyValue(it.price || 0), bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0), mainMaterial: it.mainMaterial || "", materialQtyPerPcs: Number(it.materialQtyPerPcs || 0), unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit) })).filter((it) => it.name && it.qty > 0);
        const subtotal = orderItemsTotal(cleanItems);
        const shippingCost = moneyValue(editData.shippingCost || editData.ongkir || 0);
        const total = subtotal + shippingCost;
        const firstItem = cleanItems[0] || {};
        payload = { customer: capitalizeWords(editData.customer || ""), phone: editData.phone || "", items: cleanItems, item: firstItem.name || "", qty: cleanItems.reduce((s, it) => s + Number(it.qty || 0), 0), hargaPcs: moneyValue(firstItem.price || 0), subtotal, shippingCost, ongkir: shippingCost, total, status: editData.status || "Proses", createdAt: editData.createdAt || todayStr() };
      } else if (type === "purchases") {
        const cleanMaterials = normalizePurchaseMaterials(editData).map((it) => {
          const materialName = capitalizeWords(it.name || "");
          const qty = numberValue(it.qty || 0);
          const pricePerUnit = moneyValue(it.pricePerUnit || 0);
          return { name: materialName, category: it.category || "Kain", qty, unit: normalizeMaterialUnit(materialName, it.unit), pricePerUnit, total: qty * pricePerUnit };
        }).filter((it) => it.name && it.qty > 0 && it.pricePerUnit > 0);
        const total = cleanMaterials.length > 0 ? purchaseMaterialsTotal(cleanMaterials) : moneyValue(editData.total || 0);
        const firstMaterial = cleanMaterials[0] || {};
        payload = { supplier: editData.supplier || "", materials: cleanMaterials, material: cleanMaterials.map((it) => it.name).join(", ") || editData.material || "Bahan Baku", qty: cleanMaterials.map((it) => `${it.qty} ${it.unit}`).join(", ") || editData.qty || "", category: firstMaterial.category || editData.category || "Kain", total, createdAt: editData.createdAt || todayStr() };
      } else if (type === "expenses") {
        payload = { category: editData.category || "", note: editData.note || "", amount: moneyValue(editData.amount || 0), date: editData.date || todayStr() };
      } else if (type === "transfers") {
        payload = {
          date: editData.date || todayStr(),
          customer: capitalizeWords(editData.customer || ""),
          bank: editData.bank || "",
          note: editData.note || "",
          amount: parseMoney(editData.amount || 0),
          source: editData.source || "transfer_manual",
          updatedAt: new Date().toISOString(),
          updatedBy: user?.email || "-",
        };
      } else if (type === "transfersOut") {
        payload = {
          date: editData.date || todayStr(),
          supplier: capitalizeWords(editData.supplier || ""),
          bank: editData.bank || "",
          note: editData.note || "",
          amount: parseMoney(editData.amount || 0),
          source: editData.source || "transfer_keluar_manual",
          updatedAt: new Date().toISOString(),
          updatedBy: user?.email || "-",
        };
      }

      if (type === "transfers") {
        const alokasi = await realokasiTransferMasuk(id, payload);
        addAuditLog("Edit Transfer Masuk", `${payload.customer} - ${rupiah(payload.amount)}${alokasi.length ? " · realokasi order" : ""}`);
        setEditData(null); return;
      }

      if (type === "transfersOut") {
        const alokasi = await realokasiTransferKeluar(id, payload);
        addAuditLog("Edit Transfer Keluar", `${payload.supplier} - ${rupiah(payload.amount)}${alokasi.length ? " · realokasi hutang" : ""}`);
        setEditData(null); return;
      }

      if (type !== "purchases") {
        await updateDoc(doc(db, type, id), payload);
        addAuditLog("Edit Data", `${type} - ${id}`);
        setEditData(null); return;
      }

      const oldPurchase = purchases.find((p) => p.id === id) || null;
      let oldStockRolledBack = false; let newStockApplied = false;
      try {
        if (oldPurchase) { await rollbackPurchaseStock(oldPurchase); oldStockRolledBack = true; }
        await updateDoc(doc(db, type, id), payload);
        await applyPurchaseStock({ ...editData, ...payload, id }); newStockApplied = true;
      } catch (purchaseErr) {
        try {
          if (newStockApplied) await rollbackPurchaseStock({ ...editData, ...payload, id });
          if (oldPurchase) { await updateDoc(doc(db, type, id), { supplier: oldPurchase.supplier || "", materials: normalizePurchaseMaterials(oldPurchase), material: oldPurchase.material || "", qty: oldPurchase.qty || "", category: oldPurchase.category || "Kain", total: moneyValue(oldPurchase.total || 0), createdAt: oldPurchase.createdAt || todayStr(), payments: oldPurchase.payments || [] }); if (oldStockRolledBack) await applyPurchaseStock(oldPurchase); }
        } catch (restoreErr) { console.warn("Restore edit supplier gagal:", restoreErr); }
        throw purchaseErr;
      }
      addAuditLog("Edit Data", `${type} - ${id}`); setEditData(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); }
  }

  // ── Rekap ──
  function buildRows(period) {
    const rows = [];
    transfers.forEach((t) => {
      if (period === "all" || samePeriod(t.date, period))
        rows.push({ tanggal: t.date, jenis: "Transfer Masuk", nama: t.customer || "Customer", keterangan: `${t.bank || "Bayar Customer"}${t.note ? ` · ${t.note}` : ""}`, masuk: t.amount, keluar: 0 });
    });
    transfersOut.forEach((t) => {
      if (period === "all" || samePeriod(t.date, period))
        rows.push({ tanggal: t.date, jenis: "Transfer Keluar", nama: t.supplier || "Supplier", keterangan: `${t.bank || "Bayar Supplier"}${t.note ? ` · ${t.note}` : ""}`, masuk: 0, keluar: t.amount });
    });
    expenses.forEach((expense) => {
      if (period === "all" || samePeriod(expense.date, period))
        rows.push({ tanggal: expense.date, jenis: "Biaya", nama: expense.category, keterangan: expense.note, masuk: 0, keluar: expense.amount });
    });
    return rows.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
  }

  function buildSupplierRows(period) {
    const rows = [];
    purchases.filter((p) => period === "all" || samePeriod(p.createdAt, period)).forEach((purchase) => {
      const sudahDibayar = purchasePaidTotal(purchase);
      const totalPurchase = purchaseInvoiceTotal(purchase);
      const sisaUtang = Math.max(0, Math.round(totalPurchase - sudahDibayar));
      const bahanList = normalizePurchaseMaterials(purchase);
      let akumulasiDibayar = 0; let akumulasiSisa = 0;
      bahanList.forEach((bahan, idx) => {
        const proporsi = totalPurchase > 0 ? moneyValue(bahan.total || 0) / totalPurchase : 0;
        const isLast = idx === bahanList.length - 1;
        const dibayarBaris = isLast ? Math.max(0, sudahDibayar - akumulasiDibayar) : Math.round(sudahDibayar * proporsi);
        const sisaBaris = isLast ? Math.max(0, sisaUtang - akumulasiSisa) : Math.round(sisaUtang * proporsi);
        akumulasiDibayar += dibayarBaris; akumulasiSisa += sisaBaris;
        rows.push({ tanggalBelanja: purchase.createdAt || "", supplier: purchase.supplier || "", jenisBahan: bahan.name || "Bahan Baku", kategori: bahan.category || "Kain", banyak: `${Number(bahan.qty || 0).toLocaleString("id-ID")} ${bahan.unit || "yard"}`, hargaSatuan: moneyValue(bahan.pricePerUnit || 0), totalBelanja: moneyValue(bahan.total || 0), sudahDibayar: dibayarBaris, sisaUtang: sisaBaris });
      });
      const ongkirSupplier = moneyValue(purchase.shippingCost ?? purchase.ongkir ?? 0);
      if (ongkirSupplier > 0) {
        const paidMaterials = rows
          .filter((r) => r.tanggalBelanja === (purchase.createdAt || "") && r.supplier === (purchase.supplier || ""))
          .reduce((sum, r) => sum + moneyValue(r.sudahDibayar || 0), 0);
        const sisaMaterials = rows
          .filter((r) => r.tanggalBelanja === (purchase.createdAt || "") && r.supplier === (purchase.supplier || ""))
          .reduce((sum, r) => sum + moneyValue(r.sisaUtang || 0), 0);
        rows.push({
          tanggalBelanja: purchase.createdAt || "",
          supplier: purchase.supplier || "",
          jenisBahan: "Ongkir Supplier",
          kategori: "Ongkir",
          banyak: "1 x",
          hargaSatuan: ongkirSupplier,
          totalBelanja: ongkirSupplier,
          sudahDibayar: Math.max(0, sudahDibayar - paidMaterials),
          sisaUtang: Math.max(0, sisaUtang - sisaMaterials),
        });
      }
    });
    return rows.sort((a, b) => new Date(a.tanggalBelanja || 0) - new Date(b.tanggalBelanja || 0));
  }

  function buildCustomerRows(period) {
    const map = {};
    orders.filter((o) => period === "all" || samePeriod(o.createdAt, period)).forEach((order) => {
      const key = normalizeName(order.customer || "Tanpa Nama");
      const name = capitalizeWords(order.customer || "Tanpa Nama");
      const total = orderPaymentTarget(order);
      const paid = orderPaidTotal(order);
      const sisa = total - paid;
      if (!map[key]) map[key] = { customer: name, jumlahPesanan: 0, totalTagihan: 0, sudahDibayar: 0, sisaTagihan: 0, invoices: [] };
      map[key].jumlahPesanan += 1; map[key].totalTagihan += total; map[key].sudahDibayar += paid; map[key].sisaTagihan += sisa;
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
    pdf.setFontSize(16); pdf.setFont("helvetica", "bold");
    pdf.text("Gallery Kerudung", 14, 12);
    pdf.setFontSize(10); pdf.setFont("helvetica", "normal");
    pdf.text("made by order", 14, 19);
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(14); pdf.setFont("helvetica", "bold");
    pdf.text(title, 14, 40);
    pdf.setFontSize(10); pdf.setFont("helvetica", "normal");
    pdf.text(`Periode: ${pdfPeriodLabel(period)}`, 14, 47);
    pdf.text(`Dicetak: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`, 14, 53);
  }

  function downloadFinancialRekapPdf(period) {
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[period];
    const rows = buildRows(period);
    if (rows.length === 0) return alert("Tidak ada data rekap untuk periode ini.");
    const totalMasuk = rows.reduce((s, r) => s + Number(r.masuk || 0), 0);
    const totalKeluar = rows.reduce((s, r) => s + Number(r.keluar || 0), 0);
    const saldo = totalMasuk - totalKeluar;
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Keuangan", period);
    autoTable(pdf, {
      startY: 62,
      head: [["Tanggal", "Jenis", "Nama", "Keterangan", "Kas Masuk", "Kas Keluar"]],
      body: rows.map((r) => [r.tanggal || "-", r.jenis || "-", r.nama || "-", r.keterangan || "-", Number(r.masuk || 0) > 0 ? rupiah(r.masuk) : "-", Number(r.keluar || 0) > 0 ? rupiah(r.keluar) : "-"]),
      foot: [["", "", "", "TOTAL", rupiah(totalMasuk), rupiah(totalKeluar)]],
      theme: "grid", headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [253, 242, 248], textColor: [190, 24, 93], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 4: { halign: "right" }, 5: { halign: "right" } },
    });
    const finalY = pdf.lastAutoTable?.finalY || 70;
    pdf.setFontSize(11); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(saldo >= 0 ? 5 : 225, saldo >= 0 ? 150 : 29, saldo >= 0 ? 105 : 72);
    pdf.text(`Saldo Bersih: ${rupiah(saldo)}`, 14, Math.min(finalY + 12, 285));
    pdf.save(`rekap-keuangan-${label}.pdf`);
  }

  function downloadSupplierRekapPdf(period) {
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[period];
    const rows = buildSupplierRows(period);
    if (rows.length === 0) return alert("Tidak ada data supplier untuk periode ini.");
    const totalBelanja = rows.reduce((s, r) => s + moneyValue(r.totalBelanja || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + moneyValue(r.sudahDibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + moneyValue(r.sisaUtang || 0), 0);
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Pembayaran Supplier", period);
    autoTable(pdf, {
      startY: 62,
      head: [["Tanggal", "Supplier", "Jenis Bahan", "Banyak", "Total", "Dibayar", "Sisa Utang"]],
      body: rows.map((r) => [r.tanggalBelanja || "-", r.supplier || "-", r.jenisBahan || "-", r.banyak || "-", rupiah(r.totalBelanja), rupiah(r.sudahDibayar), rupiah(r.sisaUtang)]),
      foot: [["", "", "", "TOTAL", rupiah(totalBelanja), rupiah(totalDibayar), rupiah(totalSisa)]],
      theme: "grid", headStyles: { fillColor: [168, 85, 247], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [253, 242, 248], textColor: [190, 24, 93], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    });
    pdf.save(`rekap-supplier-${label}.pdf`);
  }

  function downloadCustomerRekapPdf(period) {
    const label = { month: "bulanan", year: "tahunan", all: "semua" }[period];
    const rows = buildCustomerRows(period);
    if (rows.length === 0) return alert("Tidak ada data customer untuk periode ini.");
    const totalTagihan = rows.reduce((s, r) => s + moneyValue(r.totalTagihan || 0), 0);
    const totalDibayar = rows.reduce((s, r) => s + moneyValue(r.sudahDibayar || 0), 0);
    const totalSisa = rows.reduce((s, r) => s + moneyValue(r.sisaTagihan || 0), 0);
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Customer", period);
    autoTable(pdf, {
      startY: 62,
      head: [["Customer", "Pesanan", "Invoice", "Total Tagihan", "Dibayar", "Sisa"]],
      body: rows.map((r) => [r.customer || "-", r.jumlahPesanan, r.invoices.slice(0, 4).join(", ") + (r.invoices.length > 4 ? "..." : ""), rupiah(r.totalTagihan), rupiah(r.sudahDibayar), rupiah(r.sisaTagihan)]),
      foot: [["TOTAL", rows.reduce((s, r) => s + Number(r.jumlahPesanan || 0), 0), "", rupiah(totalTagihan), rupiah(totalDibayar), rupiah(totalSisa)]],
      theme: "grid", headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [253, 242, 248], textColor: [190, 24, 93], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    pdf.save(`rekap-customer-${label}.pdf`);
  }

  function downloadLabaRugiPdf() {
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Laporan Laba Rugi & Cashflow", "all");
    const bs = businessSummary;
    const rows = [
      ["Total Pesanan Awal", rupiah(bs.totalPesananAwal)],
      ["Total Realisasi Kirim", rupiah(bs.totalRealisasi)],
      ["Total Belanja Supplier", rupiah(bs.totalBelanjaSupplier)],
      ["Nilai Stok Bahan", rupiah(bs.nilaiStok)],
      ["Estimasi HPP Bahan Terpakai", rupiah(bs.estimasiHppBahanTerpakai)],
      ["Total Pengeluaran Operasional", rupiah(bs.totalPengeluaran)],
      ["Laba Kotor", rupiah(bs.labaKotor)],
      ["Laba Bersih", rupiah(bs.labaBersih)],
      ["Transfer Masuk dari Bayar Customer", rupiah(bs.totalPembayaranCustomer)],
      ["Transfer Keluar dari Bayar Supplier", rupiah(bs.totalBayarSupplier)],
      ["Cashflow Bersih", rupiah(bs.cashflowBersih)],
      ["Piutang Customer", rupiah(bs.piutang)],
      ["Hutang Supplier", rupiah(bs.hutangSupplier)],
    ];
    autoTable(pdf, {
      startY: 62, head: [["Keterangan", "Nominal"]], body: rows, theme: "grid",
      headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 10, cellPadding: 3 }, columnStyles: { 1: { halign: "right" } },
    });
    pdf.save(`laporan-laba-rugi-cashflow-${todayStr()}.pdf`);
    addAuditLog("Download Laba Rugi PDF", "Export laporan bisnis lengkap");
  }

  function downloadRekap(period) { downloadFinancialRekapPdf(period); }
  function doDownloadRekap() { if (!rekapConfirm) return; downloadFinancialRekapPdf(rekapConfirm); setRekapConfirm(null); }

  function rangeLabel() {
    const dari = rekapStartDate || "awal";
    const sampai = rekapEndDate || "akhir";
    return `${dari} s/d ${sampai}`;
  }

  function inRekapRange(dateValue) {
    const serial = dateSerial(dateValue || "");
    if (!serial) return false;
    const start = rekapStartDate ? dateSerial(rekapStartDate) : 0;
    const end = rekapEndDate ? dateSerial(rekapEndDate) : 99999999;
    return serial >= start && serial <= end;
  }

  function productMasterForItem(item) {
    const productId = item?.productId || "";
    if (productId) {
      const byId = productMasters.find((p) => p.id === productId);
      if (byId) return byId;
    }
    const itemName = normalizeName(item?.name || item?.item || "");
    if (!itemName) return null;
    return productMasters.find((p) => normalizeName(p.name || "") === itemName) || null;
  }

  function hppPerPcsForItem(item) {
    // Prioritas 1: product master (selalu paling up-to-date)
    const master = productMasterForItem(item);
    if (master) {
      const masterHpp = moneyValue(master.hppPerPcs || 0) || calculateProductHpp(master);
      if (masterHpp > 0) return masterHpp;
    }
    // Prioritas 2: hppPerPcs tersimpan di item pesanan
    const direct = moneyValue(item?.hppPerPcs || 0);
    if (direct > 0) return direct;
    // Prioritas 3: bahanCost di item pesanan
    const bahan = moneyValue(item?.bahanCost || item?.materialCost || 0);
    if (bahan > 0) return bahan;
    return 0;
  }

  function orderHppTotalWithMaster(order) {
    const items = normalizeShipmentItems(order);
    const shippedQty = items.reduce((sum, it) => sum + Number(it.shippedQty || 0), 0);
    const basis = shippedQty > 0 ? items : normalizeOrderItems(order).map((it) => ({ ...it, shippedQty: Number(it.qty || 0) }));
    return basis.reduce((sum, it) => sum + Number(it.shippedQty || it.qty || 0) * hppPerPcsForItem(it), 0);
  }

  function rekapScopedData() {
    const scopedOrders = (orders || []).filter((o) => inRekapRange(o.createdAt || o.date || o.tanggal || ""));
    const scopedPurchases = (purchases || []).filter((p) => inRekapRange(p.createdAt || p.date || p.tanggal || ""));
    const scopedExpenses = (expenses || []).filter((e) => inRekapRange(e.date || e.createdAt || ""));
    const scopedTransfers = (transfers || []).filter((t) => inRekapRange(t.date || t.createdAt || ""));
    const scopedTransfersOut = (transfersOut || []).filter((t) => inRekapRange(t.date || t.createdAt || ""));
    return { scopedOrders, scopedPurchases, scopedExpenses, scopedTransfers, scopedTransfersOut };
  }

  function rekapSummary() {
    const { scopedOrders, scopedPurchases, scopedExpenses, scopedTransfers, scopedTransfersOut } = rekapScopedData();
    const omzet = scopedOrders.reduce((s, o) => s + orderPaymentTarget(o), 0);
    const realisasi = scopedOrders.reduce((s, o) => s + billableOrderTotal(o), 0);
    const hpp = scopedOrders.reduce((s, o) => s + orderHppTotalWithMaster(o), 0);
    const bayarCustomer = scopedTransfers.reduce((s, t) => s + moneyValue(t.amount || 0), 0);
    const bayarSupplier = scopedTransfersOut.reduce((s, t) => s + moneyValue(t.amount || 0), 0);
    const pengeluaran = scopedExpenses.reduce((s, e) => s + moneyValue(e.amount || 0), 0);
    const piutang = scopedOrders.reduce((s, o) => s + Math.max(0, orderPaymentTarget(o) - orderPaidTotal(o)), 0);
    const hutangSupplier = scopedPurchases.reduce((s, p) => s + Math.max(0, sisaPurchase(p)), 0);
    const gajiProduksi = payrollExpenses.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
    const laba = realisasi - hpp - pengeluaran - gajiProduksi;
    return { scopedOrders, scopedPurchases, scopedExpenses, scopedTransfers, scopedTransfersOut, omzet, realisasi, hpp, bayarCustomer, bayarSupplier, pengeluaran, gajiProduksi, piutang, hutangSupplier, laba };
  }

  function customerRowsInRekapRange() {
    const { scopedOrders } = rekapSummary();
    const map = {};
    scopedOrders.forEach((o) => {
      const name = capitalizeWords(o.customer || "");
      const key = normalizeName(name);
      if (!key) return;
      if (!map[key]) map[key] = { name, orders: [], totalTagihan: 0, totalBayar: 0, sisa: 0 };
      map[key].orders.push(o);
      map[key].totalTagihan += orderPaymentTarget(o);
      map[key].totalBayar += orderPaidTotal(o);
      map[key].sisa += Math.max(0, orderPaymentTarget(o) - orderPaidTotal(o));
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }

  function downloadRekapTanggalPdf() {
    const s = rekapSummary();
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Gallery Kerudung", "all");
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(`Periode: ${rangeLabel()}`, 14, 58);
    const rows = [
      ["Omzet Pesanan", rupiah(s.omzet)],
      ["Realisasi Terkirim", rupiah(s.realisasi)],
      ["HPP", rupiah(s.hpp)],
      ["Pengeluaran Operasional", rupiah(s.pengeluaran)],
      ["Laba", rupiah(s.laba)],
      ["Pembayaran Customer", rupiah(s.bayarCustomer)],
      ["Transfer Keluar Supplier", rupiah(s.bayarSupplier)],
      ["Piutang Customer", rupiah(s.piutang)],
      ["Hutang Supplier", rupiah(s.hutangSupplier)],
      ["Jumlah Pesanan", `${s.scopedOrders.length} pesanan`],
    ];
    autoTable(pdf, {
      startY: 66,
      head: [["Ringkasan", "Nilai"]],
      body: rows,
      theme: "grid",
      headStyles: { fillColor: [236, 72, 153], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 1: { halign: "right" } },
    });

    const customerRows = customerRowsInRekapRange();
    if (customerRows.length > 0) {
      autoTable(pdf, {
        startY: pdf.lastAutoTable.finalY + 10,
        head: [["Customer", "Pesanan", "Tagihan", "Dibayar", "Sisa"]],
        body: customerRows.map((c) => [c.name, c.orders.length, rupiah(c.totalTagihan), rupiah(c.totalBayar), rupiah(c.sisa)]),
        theme: "grid",
        headStyles: { fillColor: [168, 85, 247], textColor: 255, fontStyle: "bold" },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
    }

    pdf.save(`rekap-gallery-kerudung-${rekapStartDate || "awal"}-${rekapEndDate || "akhir"}.pdf`);
    addAuditLog("Download Rekap PDF", `Periode ${rangeLabel()}`);
  }

  function shareRekapTanggalWA() {
    const s = rekapSummary();
    const text = [
      "📊 Rekap Gallery Kerudung",
      `Periode: ${rangeLabel()}`,
      "",
      `Pesanan: ${s.scopedOrders.length}`,
      `Omzet: ${rupiah(s.omzet)}`,
      `Realisasi: ${rupiah(s.realisasi)}`,
      `HPP: ${rupiah(s.hpp)}`,
      `Pengeluaran: ${rupiah(s.pengeluaran)}`,
      `Laba: ${rupiah(s.laba)}`,
      `Piutang: ${rupiah(s.piutang)}`,
      `Hutang Supplier: ${rupiah(s.hutangSupplier)}`,
      "",
      "Log:",
      `Transfer Masuk: ${rupiah(s.bayarCustomer)}`,
      `Transfer Keluar: ${rupiah(s.bayarSupplier)}`,
    ].join("\\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    addAuditLog("Kirim Rekap WA", `Periode ${rangeLabel()}`);
  }

  function addAuditLog(action, detail = "") {
    try {
      const entry = { time: new Date().toLocaleString("id-ID"), action, detail, user: user?.email || "-" };
      const next = [entry, ...auditLogs].slice(0, 50);
      setAuditLogs(next);
      localStorage.setItem("gk_audit_logs", JSON.stringify(next));
      if (user?.email) {
        addDoc(collection(db, "auditLogs"), { ...entry, createdAt: new Date().toISOString() }).catch(() => {});
      }
    } catch (e) {}
  }

  function openOrderModal(prefill = null) { if (prefill) setOrderForm(prefill); setModal("order"); }

  function resetOrderDraft() {
    const blank = { date: todayStr(), customer: "", phone: "", items: [emptyOrderItem()], shippingCost: 0, dp: 0 };
    setOrderForm(blank);
    try { localStorage.removeItem("gk_order_draft"); } catch (e) {}
  }

  function duplicateOrder(order) {
    const items = normalizeOrderItems(order).map((it) => ({ name: it.name || "", category: it.category || "Lainnya", qty: it.qty || "", price: moneyValue(it.price || 0), bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0), mainMaterial: it.mainMaterial || "", materialQtyPerPcs: it.materialQtyPerPcs || 0, unit: it.unit || "yard" }));
    openOrderModal({ date: todayStr(), customer: order.customer || "", phone: order.phone || "", items: items.length > 0 ? items : [emptyOrderItem()], shippingCost: orderShippingCost(order), dp: 0 });
  }

  function shareOrderWhatsApp(order) {
    const phone = String(order.phone || "").replace(/\D/g, "").replace(/^0/, "62");
    const paid = orderPaidTotal(order);
    const total = billableOrderTotal(order);
    const ongkir = orderShippingCost(order);
    const sisa = total - paid;
    const items = normalizeShipmentItems(order).map((it) => `- ${it.name}: kirim ${Number(it.shippedQty || 0)}/${Number(it.orderedQty || 0)} pcs x ${rupiah(it.price)}`).join("\n");
    const text = [`Halo Kak ${order.customer || ""},`, `Invoice: ${order.invoice || "-"}`, items, ongkir > 0 ? `Ongkir: ${rupiah(ongkir)}` : "", `Total tagihan: ${rupiah(total)}`, `Sudah dibayar: ${rupiah(paid)}`, sisa > 0 ? `Sisa: ${rupiah(sisa)}` : `Status: Lunas`, `Terima kasih 🙏`].filter(Boolean).join("\n");
    const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }


  function payrollExpenseAmount(row) {
    const amount = safeSummaryMoney(row?.totalAmount ?? row?.amount ?? 0);
    if (amount <= 0) return 0;
    const type = String(row?.type || "").toLowerCase();
    const source = String(row?.source || "").toLowerCase();
    const status = String(row?.status || "").toLowerCase();
    if (type.includes("marker") || type.includes("status") || type.includes("sudah") || status.includes("marker") || status.includes("sudah")) return 0;
    if (type && !type.includes("gaji") && !type.includes("payroll")) return 0;
    if (source && source.includes("marker")) return 0;
    return amount;
  }

  const payrollExpenseRows = useMemo(() => (payrollExpenses || [])
    .map((p) => ({ ...p, safeAmount: payrollExpenseAmount(p) }))
    .filter((p) => p.safeAmount > 0)
    .sort((a, b) => dateSerial(b.tanggalSetor || b.tanggalBayar || b.date || b.tanggal || b.createdAt || "") - dateSerial(a.tanggalSetor || a.tanggalBayar || a.date || a.tanggal || a.createdAt || "")),
  [payrollExpenses]);

  const productProfitSummary = useMemo(() => {
    const map = {};
    orders.forEach((o) => normalizeShipmentItems(o).forEach((it) => {
      const qty = Number(it.shippedQty || 0);
      if (qty <= 0) return;
      const key = normalizeName(it.name || "Produk");
      const revenue = qty * moneyValue(it.price || 0);
      const hppPerPcs = hppPerPcsForItem(it);
      const hpp = qty * hppPerPcs;
      if (!map[key]) map[key] = { name: it.name || "Produk", qty: 0, revenue: 0, hpp: 0, laba: 0, missingHpp: 0 };
      map[key].qty += qty; map[key].revenue += revenue; map[key].hpp += hpp; map[key].laba += revenue - hpp;
      if (hppPerPcs <= 0) map[key].missingHpp += qty;
    }));
    return Object.values(map).sort((a, b) => b.laba - a.laba);
  }, [orders, productMasters]);

  const businessSummary = useMemo(() => {
    const totalPesananAwal = orders.reduce((s, o) => s + moneyValue(o.total || 0), 0);
    const totalRealisasi = orders.reduce((s, o) => s + billableOrderTotal(o), 0);
    const totalPembayaranCustomer = transfers.reduce((s, t) => s + safeSummaryMoney(t.amount || 0), 0);
    const totalBelanjaSupplier = purchases.reduce((s, p) => s + purchaseInvoiceTotal(p), 0);
    const totalBayarSupplier = transfersOut.reduce((s, t) => s + safeSummaryMoney(t.amount || 0), 0);
    const totalPengeluaran = expenses.reduce((s, e) => s + safeSummaryMoney(e.amount || 0), 0);
    const totalGajiProduksi = payrollExpenseRows.reduce((s, p) => s + safeSummaryMoney(p.safeAmount || 0), 0);
    const nilaiStok = materialsStock.reduce((s, m) => s + safeMaterialStockValue(m), 0);
    const hppDariProduk = orders.reduce((s, o) => s + orderHppTotalWithMaster(o), 0);
    const estimasiHppBahanTerpakai = hppDariProduk > 0 ? hppDariProduk : Math.max(0, totalBelanjaSupplier - nilaiStok);
    const labaKotor = totalRealisasi - estimasiHppBahanTerpakai;
    const labaBersih = totalRealisasi - estimasiHppBahanTerpakai - totalPengeluaran - totalGajiProduksi;
    const cashflowBersih = totalPembayaranCustomer - totalBayarSupplier - totalPengeluaran - totalGajiProduksi;
    const piutang = orders.reduce((s, o) => s + Math.max(0, orderPaymentTarget(o) - orderPaidTotal(o)), 0);
    const hutangSupplier = purchases.reduce((s, p) => s + Math.max(0, sisaPurchase(p)), 0);
    const stokKritis = materialsStock.filter((m) => Number(m.minStock || 0) > 0 && Number(m.stock || 0) <= Number(m.minStock || 0));
    const customerBelumLunas = uniqueCustomers.filter((c) => Number(c.totalSisa || 0) > 0);
    const supplierBelumLunas = uniqueSuppliers.filter((s) => Number(s.totalSisa || 0) > 0);
    const supplierDataWarnings = purchases.filter((p) =>
      hasAbnormalMoney(p.total) ||
      hasAbnormalMoney(p.subtotal) ||
      hasAbnormalMoney(p.shippingCost ?? p.ongkir) ||
      normalizePurchaseMaterials(p).some((it) => hasAbnormalMoney(it.total) || hasAbnormalMoney(it.pricePerUnit || it.unitPrice || it.hargaSatuan))
    );
    return { totalPesananAwal, totalRealisasi, totalPembayaranCustomer, totalBelanjaSupplier, totalBayarSupplier, totalPengeluaran, totalGajiProduksi, nilaiStok, estimasiHppBahanTerpakai, labaKotor, labaBersih, cashflowBersih, piutang, hutangSupplier, stokKritis, customerBelumLunas, supplierBelumLunas, supplierDataWarnings };
  }, [orders, purchases, expenses, transfers, transfersOut, materialsStock, uniqueCustomers, uniqueSuppliers, productMasters, payrollExpenseRows]);


  const dashboardDetailData = useMemo(() => {
    const orderRows = [...(orders || [])]
      .sort(sortOldestBottom)
      .map((o) => ({
        id: o.id,
        title: `${o.customer || "Customer"}${o.invoice ? ` · ${o.invoice}` : ""}`,
        subtitle: `Tanggal ${o.createdAt || o.date || "-"} · Status ${effectiveOrderStatus(o)}`,
        amount: billableOrderTotal(o),
        rightNote: `Bayar ${rupiah(orderPaidTotal(o))} · Sisa ${rupiah(sisaOrder(o))}`,
      }));

    const labaRows = [
      { id: "realisasi", title: "Omzet/Realisasi", subtitle: "Total tagihan berdasarkan qty terkirim", amount: businessSummary.totalRealisasi, tone: "plus" },
      { id: "hpp", title: "HPP", subtitle: "Estimasi biaya bahan/produk terpakai", amount: -businessSummary.estimasiHppBahanTerpakai, tone: "minus" },
      { id: "gaji", title: "Gaji Produksi", subtitle: "Dari payroll_expenses yang valid", amount: -businessSummary.totalGajiProduksi, tone: "minus" },
      { id: "expense", title: "Pengeluaran Lain", subtitle: "Biaya operasional manual", amount: -businessSummary.totalPengeluaran, tone: "minus" },
      { id: "net", title: "Laba Bersih", subtitle: "Omzet - HPP - gaji - pengeluaran", amount: businessSummary.labaBersih, tone: businessSummary.labaBersih >= 0 ? "plus" : "minus" },
    ];

    const piutangRows = [...(uniqueCustomers || [])]
      .filter((c) => Number(c.totalSisa || 0) > 0)
      .sort((a, b) => Number(b.totalSisa || 0) - Number(a.totalSisa || 0))
      .map((c) => ({
        id: c.name,
        title: c.name,
        subtitle: `${c.pesananAktif || 0} pesanan aktif · ${c.totalPesanan || 0} total pesanan`,
        amount: Number(c.totalSisa || 0),
      }));

    const hutangRows = [...(uniqueSuppliers || [])]
      .filter((s) => Number(s.totalSisa || 0) > 0)
      .sort((a, b) => Number(b.totalSisa || 0) - Number(a.totalSisa || 0))
      .map((sp) => ({
        id: sp.name,
        title: sp.name,
        subtitle: `${sp.belanjaAktif || 0} nota aktif · ${sp.totalBelanja || 0} total nota`,
        amount: Number(sp.totalSisa || 0),
      }));

    const hppRows = [...(productProfitSummary || [])]
      .sort((a, b) => Number(b.hpp || 0) - Number(a.hpp || 0))
      .map((p) => ({
        id: p.name,
        title: p.name,
        subtitle: `Terjual ${Number(p.qty || 0).toLocaleString("id-ID")} pcs · omzet ${rupiah(p.revenue || 0)}`,
        amount: Number(p.hpp || 0),
        rightNote: `Laba ${rupiah(p.laba || 0)}`,
      }));

    const gajiRows = payrollExpenseRows.map((p, idx) => {
      const worker = p.employeeName || p.nama || p.workerName || p.pekerja || "Pekerja";
      const proses = [p.process || p.proses, p.model || p.productModel || p.productType].filter(Boolean).join(" · ");
      const tanggal = p.tanggalSetor || p.tanggalBayar || p.date || p.tanggal || p.createdAt?.slice?.(0, 10) || "-";
      const pcs = Number(p.qtySetor || p.qty || p.pcs || 0);
      return {
        id: p.id || `${worker}-${idx}`,
        title: worker,
        subtitle: `${tanggal}${proses ? ` · ${proses}` : ""}${pcs > 0 ? ` · ${pcs.toLocaleString("id-ID")} pcs` : ""}`,
        amount: Number(p.safeAmount || 0),
        rightNote: p.invoice || p.orderInvoice || p.customer || "",
      };
    });

    const expenseRows = [...(expenses || [])]
      .sort(sortOldestBottom)
      .map((e) => ({
        id: e.id,
        title: e.category || "Pengeluaran",
        subtitle: `${e.date || e.createdAt || "-"}${e.note ? ` · ${e.note}` : ""}`,
        amount: safeSummaryMoney(e.amount || 0),
      }));

    const stockRows = [...(materialsStock || [])]
      .sort((a, b) => safeMaterialStockValue(b) - safeMaterialStockValue(a))
      .map((m) => ({
        id: m.id || m.name,
        title: m.name || "Bahan",
        subtitle: `Stok ${Number(m.stock || 0).toLocaleString("id-ID")} ${m.unit || "yard"} · Avg ${rupiah(m.avgCost || 0)}`,
        amount: safeMaterialStockValue(m),
        rightNote: Number(m.minStock || 0) > 0 && Number(m.stock || 0) <= Number(m.minStock || 0) ? "Stok kritis" : "",
      }));

    const supplierWarningRows = (businessSummary.supplierDataWarnings || []).map((p) => ({
      id: p.id || `${p.supplier}-${p.createdAt}`,
      title: p.supplier || "Supplier",
      subtitle: `${p.createdAt || p.date || "-"} · ${purchaseMaterialsSummary(p)}`,
      amount: moneyValue(p.total || p.subtotal || 0),
      rightNote: "Perlu cek/edit",
    }));

    return {
      omzet: { title: "Rincian Omzet", total: businessSummary.totalRealisasi, subtitle: "Semua pesanan berdasarkan realisasi pengiriman", rows: orderRows },
      laba: { title: "Rincian Laba Bersih", total: businessSummary.labaBersih, subtitle: "Komponen perhitungan laba bersih", rows: labaRows },
      piutang: { title: "Rincian Piutang Customer", total: businessSummary.piutang, subtitle: "Customer dengan sisa tagihan", rows: piutangRows },
      hutang: { title: "Rincian Hutang Supplier", total: businessSummary.hutangSupplier, subtitle: "Supplier dengan sisa hutang aktif", rows: hutangRows },
      hpp: { title: "Rincian HPP", total: businessSummary.estimasiHppBahanTerpakai, subtitle: "HPP per produk berdasarkan pengiriman", rows: hppRows },
      gaji: { title: "Rincian Gaji Produksi", total: businessSummary.totalGajiProduksi, subtitle: "Hanya payroll valid dari Gallery Produksi; marker status gajian nominal 0 diabaikan", rows: gajiRows },
      pengeluaran: { title: "Rincian Pengeluaran Lain", total: businessSummary.totalPengeluaran, subtitle: "Biaya operasional manual", rows: expenseRows },
      stok: { title: "Rincian Nilai Stok", total: businessSummary.nilaiStok, subtitle: "Nilai stok bahan saat ini", rows: stockRows },
      supplierWarnings: { title: "Data Supplier Perlu Dicek", total: supplierWarningRows.length, subtitle: "Data lama bernominal tidak wajar dan tidak dihitung di ringkasan", rows: supplierWarningRows },
    };
  }, [orders, uniqueCustomers, uniqueSuppliers, productProfitSummary, payrollExpenseRows, expenses, materialsStock, businessSummary]);

  function openDashboardDetail(type) {
    setDashboardDetail(type);
  }

  function SummaryDetailCard({ type, label, value, colorClass, bgClass, negative = false }) {
    return (
      <button type="button" onClick={() => openDashboardDetail(type)} className={`rounded-2xl ${bgClass} p-3 text-left active:scale-[0.99] transition-all`}>
        <div className="text-xs text-slate-400">{label}</div>
        <div className={`text-lg font-bold ${colorClass}`}>{negative && value > 0 ? "-" : ""}{rupiah(Math.abs(Number(value || 0)))}</div>
        <div className="mt-1 text-[10px] font-semibold text-slate-400">Ketuk untuk rincian</div>
      </button>
    );
  }

  function DashboardDetailModal() {
    const detail = dashboardDetailData[dashboardDetail];
    if (!detail) return null;
    const rows = Array.isArray(detail.rows) ? detail.rows : [];
    return (
      <SimpleModal title={detail.title} onClose={() => setDashboardDetail(null)}>
        <div className="space-y-3">
          <div className="rounded-3xl p-4" style={{ background: "linear-gradient(135deg,#fdf2f8,#ede9fe)", border: "1.5px solid #f9a8d4" }}>
            <div className="text-xs font-semibold text-slate-500">Total</div>
            <div className={`text-2xl font-black ${Number(detail.total || 0) < 0 ? "text-rose-600" : "text-pink-600"}`}>{rupiah(detail.total)}</div>
            <div className="mt-1 text-xs text-slate-500">{detail.subtitle}</div>
          </div>
          {rows.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-400">Belum ada rincian untuk kategori ini.</div>
          ) : (
            <div className="space-y-2 max-h-[62vh] overflow-auto pr-1">
              {rows.map((row, idx) => (
                <div key={row.id || idx} className="rounded-2xl bg-white p-3" style={{ border: "1px solid #f1f5f9" }}>
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-800 truncate">{row.title}</div>
                      <div className="text-xs text-slate-400 leading-relaxed">{row.subtitle}</div>
                      {row.rightNote && <div className="mt-1 text-[11px] font-semibold text-slate-500">{row.rightNote}</div>}
                    </div>
                    <div className={`shrink-0 text-right font-bold ${Number(row.amount || 0) < 0 || row.tone === "minus" ? "text-rose-600" : row.tone === "plus" ? "text-emerald-600" : "text-pink-600"}`}>
                      {Number(row.amount || 0) < 0 ? "-" : ""}{rupiah(Math.abs(Number(row.amount || 0)))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SimpleModal>
    );
  }

  const topCustomers = useMemo(() => {
    const map = {};
    orders.forEach((o) => { const key = normalizeName(o.customer || ""); if (!key) return; if (!map[key]) map[key] = { name: capitalizeWords(o.customer || ""), count: 0, total: 0 }; map[key].count += 1; map[key].total += moneyValue(o.total || 0); });
    return Object.values(map).sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 6);
  }, [orders]);

  const topProducts = useMemo(() => {
    const map = {};
    orders.forEach((o) => normalizeOrderItems(o).forEach((it) => { const key = normalizeName(it.name || ""); if (!key) return; if (!map[key]) map[key] = { name: it.name, qty: 0, total: 0 }; map[key].qty += Number(it.qty || 0); map[key].total += Number(it.qty || 0) * moneyValue(it.price || 0); }));
    return Object.values(map).sort((a, b) => b.qty - a.qty || b.total - a.total).slice(0, 6);
  }, [orders]);



  function exportBackupJson() {
    const payload = { app: "Gallery Kerudung", exportedAt: new Date().toISOString(), exportedBy: user?.email || "-", version: "backup-manual-v1", orders, purchases, expenses, transfers, transfersOut, materialsStock, productMasters, productCategories, auditLogs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `backup-gallery-kerudung-${todayStr()}.json`; link.click();
    addAuditLog("Backup JSON", "Export semua data bisnis");
  }

  function exportBackupTsv() {
    const SEP = "\t";
    const bs = businessSummary;
    const lines = [
      "Gallery Kerudung - Backup Ringkas",
      `Tanggal Export${SEP}${new Date().toLocaleString("id-ID")}`,
      `User${SEP}${user?.email || "-"}`, "",
      "RINGKASAN",
      ["Total Realisasi", bs.totalRealisasi].join(SEP),
      ["Transfer Masuk dari Bayar Customer", bs.totalPembayaranCustomer].join(SEP),
      ["Belanja Supplier", bs.totalBelanjaSupplier].join(SEP),
      ["Transfer Keluar dari Bayar Supplier", bs.totalBayarSupplier].join(SEP),
      ["Biaya Operasional", bs.totalPengeluaran].join(SEP),
      ["Transfer Keluar Supplier", bs.totalBayarSupplier].join(SEP),
      ["Total Pengeluaran Kas", bs.totalPengeluaran + bs.totalBayarSupplier].join(SEP),
      ["Laba Bersih", bs.labaBersih].join(SEP),
      ["Cashflow Bersih", bs.cashflowBersih].join(SEP),
      ["Piutang", bs.piutang].join(SEP),
      ["Hutang Supplier", bs.hutangSupplier].join(SEP), "",
      "PESANAN",
      ["Tanggal", "Invoice", "Customer", "Subtotal", "Ongkir", "Total", "Tagihan", "Dibayar", "Sisa", "Status"].join(SEP),
      ...orders.map((o) => [o.createdAt || "", o.invoice || "", o.customer || "", orderItemsTotal(normalizeOrderItems(o)), orderShippingCost(o), moneyValue(o.total || 0), billableOrderTotal(o), orderPaidTotal(o), sisaOrder(o), o.status || ""].join(SEP)), "",
      "SUPPLIER",
      ["Tanggal", "Supplier", "Bahan", "Total", "Dibayar", "Sisa"].join(SEP),
      ...purchases.map((p) => [p.createdAt || "", p.supplier || "", purchaseMaterialsSummary(p), purchaseInvoiceTotal(p), purchasePaidTotal(p), sisaPurchase(p)].join(SEP)), "",
      "PENGELUARAN",
      ["Tanggal", "Jenis", "Nama/Kategori", "Catatan", "Nominal"].join(SEP),
      ...expenses.map((e) => [e.date || "", "Biaya Operasional", e.category || "", e.note || "", moneyValue(e.amount || 0)].join(SEP)),
      ...transfersOut.map((t) => [t.date || t.createdAt?.slice?.(0, 10) || "", "Transfer Keluar Supplier", t.supplier || "", `${t.bank || "Bayar Supplier"}${t.note ? ` · ${t.note}` : ""}`, moneyValue(t.amount || 0)].join(SEP)),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/tab-separated-values;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `backup-ringkas-gallery-kerudung-${todayStr()}.tsv`; link.click();
    addAuditLog("Backup Excel/TSV", "Export ringkasan, pesanan, transfer, supplier, pengeluaran");
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
      <div className="w-full max-w-sm rounded-3xl bg-white/80 backdrop-blur p-8 shadow-xl text-center" style={{ border: "1.5px solid #f9a8d4" }}>
        <div className="mb-2 text-4xl">🧕✨</div>
        <div className="mb-1 text-3xl font-bold" style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Gallery Kerudung</div>
        <div className="mb-6 text-sm font-medium" style={{ color: "#c084fc" }}>💕 made by order 💕</div>
        {authError && <div className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-500 border border-rose-100">{authError}</div>}
        <button onClick={handleLogin} disabled={loginLoading} className="flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 font-bold text-white shadow-lg disabled:opacity-60" style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)" }}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 32.8 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8 12.9 4.8 4 13.7 4 24.8s8.9 20 20 20c11 0 19.5-7.7 19.5-20 0-1.3-.1-2.6-.3-3.8z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.4 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1L37 9.9C33.5 6.7 29 4.8 24 4.8c-7.5 0-14 4.2-17.7 9.9z"/><path fill="#4CAF50" d="M24 44c4.9 0 9.3-1.8 12.7-4.6l-5.9-4.9C29 36.3 26.6 37 24 37c-5.3 0-9.6-3.2-11.3-7.8L6 34.2C9.7 39.8 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.4-4.6 5.8l5.9 4.9C40.2 35.2 44 30.4 44 24c0-1.3-.1-2.6-.4-4z"/></svg>
          {loginLoading ? "Memproses login..." : "Masuk dengan Google"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-md" style={{ background: "#fdf2f8" }}>
      {/* Header */}
      <div className="p-5 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)" }}>
        <div className="flex items-center justify-between relative z-10">
          <div>
            <div className="text-3xl font-bold tracking-tight">Gallery Kerudung</div>
            <div className="mt-1 text-sm font-medium opacity-80">💕 made by order ✨</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <img src="/logo-gk.png" className="h-16 w-16 rounded-2xl shadow-lg" alt="logo" style={{ border: "2px solid rgba(255,255,255,0.4)" }} />
            <button onClick={handleLogout} className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: "rgba(255,255,255,0.25)" }}>Keluar</button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl px-4 py-3 flex items-center gap-3 relative z-10" style={{ background: "rgba(255,255,255,0.2)" }}>
          <span>🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari pesanan, supplier, transfer..." className="bg-transparent outline-none flex-1 text-white placeholder-pink-100 text-sm" />
          {search && <button onClick={() => setSearch("")} className="text-pink-200 font-bold">✕</button>}
        </div>
      </div>

      <TabBar tab={tab} setTab={setTab} badgeCount={pesananTelat.length} />

      {loading && <div className="flex justify-center py-10 text-slate-400">Memuat data...</div>}

      {firestoreError && (
        <div className="mx-4 mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 whitespace-pre-line">
          <div className="font-bold mb-1">Data gagal dimuat dari Firebase</div>
          <div>{firestoreError}</div>
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {!loading && tab === "dashboard" && (
        <>
          <div className="grid grid-cols-3 gap-2 p-4 pb-0">
            <button onClick={() => openOrderModal()} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#ec4899", border: "1.5px solid #f9a8d4" }}>+ Pesanan</button>
            <button onClick={() => setModal("purchase")} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#7c3aed", border: "1.5px solid #c4b5fd" }}>+ Belanja</button>
            <button onClick={() => setModal("pay")} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#059669", border: "1.5px solid #bbf7d0" }}>+ Bayar</button>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 pt-2 pb-0">
            <button onClick={() => setTab("orders")} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#0284c7", border: "1.5px solid #bae6fd" }}>🚚 Kirim</button>
            <button onClick={() => setModal("expense")} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#64748b", border: "1.5px solid #e2e8f0" }}>💸 Biaya</button>
          </div>

          {pesananTelat.length > 0 && (
            <div className="mx-4 mt-4 rounded-2xl bg-rose-50 border border-rose-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔔</span>
                <span className="font-bold text-rose-700">{pesananTelat.length} Pesanan Belum Bayar 7+ Hari</span>
              </div>
              <div className="space-y-2">
                {pesananTelat.map((o) => (
                  <div key={o.id} className="flex justify-between items-center bg-white rounded-xl px-3 py-2">
                    <div><div className="font-semibold text-sm text-slate-800">{o.customer}</div><div className="text-xs text-slate-400">{o.invoice}</div></div>
                    <div className="text-sm font-bold text-rose-600">{rupiah(sisaOrder(o))}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 p-4">
            <Card title="Kas Masuk" value={stats.customerPaid} note="Cicilan pelanggan" bg="bg-emerald-50" icon="💚" />
            <Card title="Transfer Masuk" value={stats.transferTotal} note="Manual dari Bayar Customer" bg="bg-cyan-50" icon="💙" />
            <Card title="Piutang" value={stats.receivable} note="Tagihan pelanggan" bg="bg-purple-50" icon="💜" />
            <Card title="Hutang Supplier" value={stats.supplierDebt} note="Bahan baku" bg="bg-yellow-50" icon="⭐" />
            <Card title="Transfer Keluar" value={stats.supplierPaid} note="Total transfer keluar supplier" bg="bg-rose-50" icon="🔴" />
            <Card title="Kas Bersih" value={stats.netCash} note="Masuk - supplier - biaya" bg="bg-slate-50" icon="💰" />
          </div>

          <div className="px-4 pb-4">
            <div className="rounded-3xl p-5 shadow-sm relative overflow-hidden" style={{ background: "linear-gradient(135deg, #fdf2f8, #ede9fe)", border: "1.5px solid #f9a8d4" }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold" style={{ color: "#a855f7" }}>✨ Saldo Cashflow</div>
                <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: stats.netCash >= 0 ? "#dcfce7" : "#fee2e2", color: stats.netCash >= 0 ? "#059669" : "#e11d48" }}>
                  {stats.netCash >= 0 ? "✅ POSITIF" : "⚠️ MINUS"}
                </span>
              </div>
              <div className="mt-3 text-5xl font-bold" style={{ color: stats.netCash >= 0 ? "#059669" : "#e11d48" }}>
                {stats.netCash < 0 ? "-" : ""}{rupiah(Math.abs(stats.netCash))}
              </div>
              <div className="mt-2 text-xs" style={{ color: "#c084fc" }}>💕 Kas masuk dikurangi pembayaran supplier dan biaya lain</div>
            </div>
          </div>

          <GrafikKas transfers={transfers} transfersOut={transfersOut} expenses={expenses} />
          <GrafikPesanan orders={orders} />

          <div className="mx-4 mb-4 rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
            <div className="text-lg font-bold mb-1" style={{ color: "#ec4899" }}>📌 Ringkasan Bisnis</div>
            <div className="grid grid-cols-2 gap-2">
              <SummaryDetailCard type="omzet" label="Omzet" value={businessSummary.totalRealisasi} colorClass="text-pink-600" bgClass="bg-emerald-50" />
              <SummaryDetailCard type="laba" label="Laba Bersih" value={businessSummary.labaBersih} colorClass={businessSummary.labaBersih >= 0 ? "text-emerald-600" : "text-rose-600"} bgClass="bg-emerald-50" />
              <SummaryDetailCard type="piutang" label="Piutang Customer" value={businessSummary.piutang} colorClass="text-sky-600" bgClass="bg-sky-50" />
              <SummaryDetailCard type="hutang" label="Hutang Supplier" value={businessSummary.hutangSupplier} colorClass="text-rose-600" bgClass="bg-rose-50" />
              <SummaryDetailCard type="hpp" label="HPP" value={businessSummary.estimasiHppBahanTerpakai} colorClass="text-violet-600" bgClass="bg-violet-50" />
              <SummaryDetailCard type="gaji" label="Gaji Produksi" value={businessSummary.totalGajiProduksi} colorClass="text-amber-600" bgClass="bg-amber-50" />
              <SummaryDetailCard type="pengeluaran" label="Pengeluaran Lain" value={businessSummary.totalPengeluaran} colorClass="text-orange-600" bgClass="bg-orange-50" />
              <SummaryDetailCard type="stok" label="Nilai Stok" value={businessSummary.nilaiStok} colorClass="text-purple-600" bgClass="bg-purple-50" />
            </div>
            {businessSummary.supplierDataWarnings?.length > 0 && (
              <button type="button" onClick={() => openDashboardDetail("supplierWarnings")} className="mt-3 w-full rounded-2xl px-3 py-2 text-left text-xs font-semibold" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}>
                ⚠️ {businessSummary.supplierDataWarnings.length} data supplier lama punya nominal tidak wajar dan diabaikan dari Ringkasan Bisnis. Ketuk untuk lihat data bermasalah.
              </button>
            )}
            {businessSummary.stokKritis.length > 0 && (
              <div className="mt-4 rounded-2xl bg-rose-50 p-3 border border-rose-100">
                <div className="font-bold text-rose-600 text-sm mb-2">⚠️ Stok bahan kritis</div>
                {businessSummary.stokKritis.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex justify-between text-xs text-slate-600"><span>{m.name}</span><span className="font-bold text-rose-600">{Number(m.stock || 0).toLocaleString("id-ID")} {m.unit || "yard"}</span></div>
                ))}
              </div>
            )}
          </div>

          {productProfitSummary.length > 0 && (
            <div className="mx-4 mb-4 rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #bbf7d0" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-bold text-emerald-700">🏆 Laba per Produk</div>
                <div className="text-xs text-slate-400">{productProfitSummary.length} produk</div>
              </div>
              <div className="space-y-2">
                {(showAllProducts ? productProfitSummary : productProfitSummary.slice(0, 5)).map((p) => {
                  const margin = p.revenue > 0 ? Math.round((p.laba / p.revenue) * 100) : 0;
                  return (
                    <div key={p.name} className="rounded-2xl bg-slate-50 p-3">
                      <div className="flex justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                          <div className="text-xs text-slate-400">Terjual {p.qty} pcs · margin {margin}%</div>
                          {p.missingHpp > 0 && <div className="mt-1 text-xs font-semibold text-amber-600">⚠️ {p.missingHpp} pcs belum punya HPP</div>}
                        </div>
                        <div className={`font-bold ${p.laba >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{rupiah(p.laba)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {productProfitSummary.length > 5 && (
                <button onClick={() => setShowAllProducts(v => !v)} className="mt-3 w-full rounded-2xl bg-emerald-50 py-2 text-sm font-semibold text-emerald-700">
                  {showAllProducts ? "▲ Tampilkan lebih sedikit" : `▼ Lihat semua ${productProfitSummary.length} produk`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── ORDERS TAB ── */}
      {!loading && tab === "orders" && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => openOrderModal()} style={{ background: "linear-gradient(135deg,#ec4899,#f472b6)" }}>+ Pesanan</Button>
            <Button onClick={() => setModal("pay")} style={{ background: "linear-gradient(135deg,#10b981,#34d399)" }}>+ Bayar Masuk</Button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select className="flex-1 rounded-2xl border px-3 py-2 text-sm bg-white outline-none" style={{ borderColor: "#f9a8d4", minWidth: 100 }} value={filterOrder} onChange={(e) => setFilterOrder(e.target.value)}>
              <option value="semua">Semua</option>
              <option value="belum-kirim">Belum Kirim</option>
              <option value="sebagian">Sebagian</option>
              <option value="belum-lunas">Belum Lunas</option>
              <option value="selesai">Selesai</option>
              <option value="lunas">Lunas</option>
            </select>
            <select className="flex-1 rounded-2xl border px-3 py-2 text-sm bg-white outline-none" style={{ borderColor: "#f9a8d4", minWidth: 100 }} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="terbaru">Terbaru</option>
              <option value="terlama">Terlama</option>
              <option value="customer">Per Customer</option>
            </select>
          </div>

          {(() => {
            let list = [...filteredOrders];
            if (filterOrder === "belum-kirim") list = list.filter(o => orderDeliveryStatus(o) === "Proses");
            if (filterOrder === "sebagian") list = list.filter(o => orderDeliveryStatus(o) === "Dikirim Sebagian");
            if (filterOrder === "belum-lunas") list = list.filter(o => sisaOrder(o) > 0);
            if (filterOrder === "selesai") list = list.filter(o => orderDeliveryStatus(o) === "Selesai");
            if (filterOrder === "lunas") list = list.filter(o => sisaOrder(o) <= 0);
            if (sortOrder === "terbaru") list.sort(sortOldestBottom);
            if (sortOrder === "terlama") list.sort(sortOldestTop);
            if (sortOrder === "customer") list.sort((a, b) => (a.customer||"").localeCompare(b.customer||"") || sortOldestBottom(a, b));
            if (list.length === 0) return <div className="text-center py-10 text-slate-400">Tidak ada pesanan ditemukan</div>;
            return list.map((o) => {
              const paid = orderPaidTotal(o);
              const sisa = orderPaymentTarget(o) - paid;
              return (
                <div key={o.id} className="rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-lg">{o.customer}</div>
                      {o.phone && <a href={`https://wa.me/62${o.phone.replace(/^0/, "")}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 font-semibold">📱 WA {o.phone}</a>}
                      <div className="text-sm text-slate-500">{o.invoice} · {orderItemsSummary(o)}</div>
                      <div className="mt-2 rounded-2xl bg-slate-50 p-3 space-y-1">
                        {normalizeShipmentItems(o).map((it, idx) => {
                          const orderedQty = Number(it.orderedQty || 0);
                          const shippedQty = Number(it.shippedQty || 0);
                          const sisaKirim = Math.max(orderedQty - shippedQty, 0);
                          const selisih = shippedQty - orderedQty;
                          const subtotal = shippedQty * moneyValue(it.price || 0);
                          return (
                            <div key={idx} className="rounded-xl bg-white px-3 py-2 text-xs">
                              <div className="flex justify-between gap-2"><span className="font-bold text-slate-700">{it.name}</span><span className="font-semibold text-purple-600">{rupiah(subtotal)}</span></div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-slate-500">
                                <span>Pesan {orderedQty} pcs</span><span>· Terkirim {shippedQty} pcs</span><span>· Sisa kirim {sisaKirim} pcs</span>
                                {selisih !== 0 && <span className={selisih < 0 ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>· Selisih {selisih} pcs</span>}
                              </div>
                              <div className={selisih < 0 ? "mt-1 text-rose-500" : selisih > 0 ? "mt-1 text-emerald-600" : "mt-1 text-slate-400"}>{it.note || shipmentAutoNote(orderedQty, shippedQty)}</div>
                            </div>
                          );
                        })}
                      </div>
                      {o.createdAt && <div className="text-xs text-slate-400">📅 {o.createdAt}</div>}
                      <div className="mt-1 flex flex-wrap gap-2">
                        <StatusBadge status={effectiveOrderStatus(o)} />
                        {o.statusProduksi && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold"
                            style={{
                              background: o.statusProduksi === "Selesai" ? "#dcfce7" : "#ede9fe",
                              color: o.statusProduksi === "Selesai" ? "#16a34a" : "#7c3aed",
                            }}>
                            {o.statusProduksi === "Selesai" ? "✅" : "🧵"} Produksi: {o.statusProduksi}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{rupiah(orderPaymentTarget(o))}</div>
                      {orderPaymentTarget(o) !== moneyValue(o.total || 0) && <div className="text-xs text-slate-400">Pesanan {rupiah(o.total)}</div>}
                      {sisa >= 0 ? <div className="text-sm text-rose-500">Sisa {rupiah(sisa)}</div> : <div className="text-sm text-emerald-600">Deposit {rupiah(Math.abs(sisa))}</div>}
                    </div>
                  </div>
                  {orderPaymentHistory(o).length > 0 && (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3 space-y-1">
                      <div className="text-xs font-semibold text-slate-500 mb-2">Riwayat Pembayaran</div>
                      {orderPaymentHistory(o).map((p, i) => (
                        <div key={i} className="flex justify-between text-sm"><span className="text-slate-500">{p.date} · {cleanCustomerPaymentNote(p.note)}</span><span className="font-semibold text-emerald-600">{rupiah(p.amount)}</span></div>
                      ))}
                      <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-sm font-bold">
                        <span className="text-slate-700">Total Pembayaran</span>
                        <span className="text-emerald-600">{rupiah(paid)}</span>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {orderDeliveryStatus(o) !== "Selesai" && (
                      <button onClick={() => openKirimModal(o)} className="w-full rounded-2xl bg-sky-600 py-2 text-sm font-semibold text-white">🚚 Input Pengiriman</button>
                    )}
                    {o.tanggalKirim && <div className="text-xs text-slate-400">🚚 Dikirim: {o.tanggalKirim}</div>}
                    {effectiveOrderStatus(o) === "Lunas" && <div className="text-xs text-emerald-600 font-semibold">✅ Lunas otomatis</div>}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button className="bg-sky-600" onClick={() => setEditData({ type: "orders", ...o })}>Edit</Button>
                    <Button className="bg-rose-600" onClick={() => deleteItem("orders", o.id)}>Hapus</Button>
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
          <button
            onClick={() => setConfirmResetSupplier(true)}
            className="w-full rounded-2xl border border-rose-300 py-2 text-xs font-bold text-rose-500 bg-rose-50"
          >
            🗑️ Reset Semua Data Supplier (Hapus Purchases + Pembayaran)
          </button>
          {filteredPurchases.length === 0 && <div className="text-center py-10 text-slate-400">Tidak ada data supplier</div>}
          {[...filteredPurchases].sort(sortPurchaseNewestFirst).map((p) => {
            const paid = purchasePaidTotal(p);
            const sisa = hutangPurchase(p);
            return (
              <div key={p.id} className="rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-lg">{p.supplier}</div>
                    <div className="text-sm text-slate-500">{purchaseMaterialsSummary(p)}</div>
                    {p.createdAt && <div className="text-xs text-slate-400">📅 {p.createdAt}</div>}
                    <div className="mt-2 space-y-1">
                      {normalizePurchaseMaterials(p).slice(0, 4).map((it, i) => (
                        <div key={i} className="text-xs text-slate-500">• {it.name}: {it.qty} {it.unit} · {rupiah(it.total)}</div>
                      ))}
                      {moneyValue(p.shippingCost || p.ongkir || 0) > 0 && (
                        <div className="text-xs text-slate-500">• Ongkir: {rupiah(p.shippingCost || p.ongkir || 0)}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right"><div className="font-bold">{rupiah(purchaseInvoiceTotal(p))}</div><div className="text-sm text-rose-500">Sisa hutang {rupiah(sisa)}</div></div>
                </div>
                {purchasePaymentHistory(p).length > 0 && (
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3 space-y-1">
                    <div className="text-xs font-semibold text-slate-500 mb-2">Riwayat Pembayaran</div>
                    {purchasePaymentHistory(p).map((x, i) => (
                      <div key={i} className="flex justify-between text-sm"><span className="text-slate-500">{x.date} · {cleanSupplierPaymentNote(x.note)}</span><span className="font-semibold text-emerald-600">{rupiah(x.amount)}</span></div>
                    ))}
                    <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-sm font-bold">
                      <span className="text-slate-700">Total Pembayaran</span>
                      <span className="text-emerald-600">{rupiah(paid)}</span>
                    </div>
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

          <div className="rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #fecaca" }}>
            <div className="flex justify-between items-center">
              <div>
                <div className="font-bold text-slate-800">Total Pengeluaran</div>
                <div className="text-xs text-slate-400">Biaya operasional + transfer keluar supplier</div>
              </div>
              <div className="text-xl font-bold text-rose-600">{rupiah(totalCombinedExpenses)}</div>
            </div>
          </div>

          {combinedExpenseRows.length === 0 && <div className="text-center py-10 text-slate-400">Tidak ada pengeluaran</div>}
          {combinedExpenseRows.map((row) => (
            <div key={`${row.rowType}-${row.id}`} className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="font-bold">{row.title}</div>
                  <div className="text-sm text-slate-500">{row.date}</div>
                  {row.subtitle && <div className="text-sm text-slate-400 mt-1">{row.subtitle}</div>}
                  <div className={`inline-flex mt-2 rounded-full px-2 py-1 text-[10px] font-bold ${row.rowType === "supplier_transfer" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
                    {row.rowType === "supplier_transfer" ? "Auto · Transfer Supplier" : "Manual · Biaya Operasional"}
                  </div>
                </div>
                <div className="font-bold text-rose-600 whitespace-nowrap">{rupiah(row.amount)}</div>
              </div>
              {row.rowType === "expense" && (
                <div className="mt-4 flex gap-2">
                  <Button className="bg-sky-600 flex-1" onClick={() => setEditData({ type: "expenses", ...row.raw })}>Edit</Button>
                  <Button className="bg-rose-600 flex-1" onClick={() => deleteItem("expenses", row.id)}>Hapus</Button>
                </div>
              )}
              {row.rowType === "supplier_transfer" && (
                <div className="mt-4 space-y-2">
                  <div className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-500">
                    Transfer supplier ini bisa diedit. Setelah disimpan, alokasi hutang supplier akan dihitung ulang otomatis.
                  </div>
                  <Button className="bg-sky-600 w-full" onClick={() => setEditData({ type: "transfersOut", ...row.raw })}>Edit Transfer Keluar</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── PRODUCTS TAB ── */}
      {!loading && tab === "products" && (
        <div className="space-y-4 p-4">
          <div className="rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #c4b5fd" }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div><div className="text-lg font-bold" style={{ color: "#7c3aed" }}>🏷️ Template Produk</div><div className="text-xs text-slate-400">Setup sekali, pesanan harian tinggal pilih produk.</div></div>
              <Button onClick={() => setModal("product")} className="text-xs" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>+ Produk</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-2xl bg-purple-50 p-3"><div className="text-slate-400">Total Produk</div><div className="text-xl font-bold text-purple-600">{productMasters.length}</div></div>
              <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-slate-400">Aktif</div><div className="text-xl font-bold text-emerald-600">{productMasters.filter(p => p.isActive !== false).length}</div></div>
            </div>
          </div>
          {filteredProductMasters.length === 0 && <div className="text-center py-10 text-slate-400">Belum ada template produk</div>}
          {filteredProductMasters.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((p) => {
            const hpp = calculateProductHpp(p);
            const margin = moneyValue(p.defaultPrice || 0) - hpp;
            const marginPct = moneyValue(p.defaultPrice || 0) > 0 ? Math.round((margin / moneyValue(p.defaultPrice || 0)) * 100) : 0;
            return (
              <div key={p.id} className="rounded-3xl bg-white p-4 shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
                <div className="flex gap-3">
                  <div className="h-16 w-16 rounded-2xl bg-pink-50 flex items-center justify-center overflow-hidden shrink-0">
                    {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" /> : <span className="text-2xl">📦</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2"><div className="font-bold text-slate-800 truncate">{p.name}</div><span className="rounded-full bg-purple-50 px-2 py-1 text-xs font-bold text-purple-600">{p.category || "Lainnya"}</span></div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><div className="text-slate-400">Jual</div><div className="font-bold text-pink-600">{rupiah(p.defaultPrice)}</div></div>
                      <div><div className="text-slate-400">HPP</div><div className="font-bold text-orange-600">{rupiah(hpp)}</div></div>
                      <div><div className="text-slate-400">Margin</div><div className={margin >= 0 ? "font-bold text-emerald-600" : "font-bold text-rose-600"}>{marginPct}%</div></div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button className="bg-sky-600 flex-1" onClick={() => {
                    const qty = numberValue(p.materialQtyPerPcs || 0);
                    const bahanCost = moneyValue(p.bahanCost || 0);
                    // Pakai bahanPricePerUnit tersimpan, atau hitung balik dari bahanCost ÷ qty
                    const bahanPricePerUnit = moneyValue(p.bahanPricePerUnit || 0) > 0
                      ? moneyValue(p.bahanPricePerUnit || 0)
                      : (qty > 0 && bahanCost > 0 ? Math.round(bahanCost / qty) : 0);
                    setProductForm({ ...emptyProductForm, ...p, bahanPricePerUnit });
                    setModal("product");
                  }}>Edit</Button>
                  <Button className="bg-pink-600 flex-1" onClick={() => setOrderForm(f => ({ ...f, items: [...(f.items || []), { ...emptyOrderItem(), productId: p.id, name: p.name, category: p.category, price: p.defaultPrice, bahanCost: moneyValue(p.bahanCost || 0), hppPerPcs: hpp, mainMaterial: p.mainMaterial || "", materialQtyPerPcs: p.materialQtyPerPcs || 0, unit: p.unit || "yard" }] }))}>Pakai</Button>
                  <Button className="bg-rose-600 flex-1" onClick={() => deleteItem("products", p.id)}>Hapus</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── STOCK TAB ── */}
      {!loading && tab === "stock" && (
        <div className="space-y-4 p-4">
          <div className="rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #fed7aa" }}>
            <div className="text-lg font-bold mb-1" style={{ color: "#ea580c" }}>🧵 Stok Bahan</div>
            {filteredMaterialsStock.length === 0 && <div className="text-center py-6 text-slate-400">Belum ada stok bahan</div>}
            <div className="space-y-3">
              {filteredMaterialsStock.map((m) => {
                const stock = Number(m.stock || 0);
                const minStock = Number(m.minStock || 0);
                const low = minStock > 0 && stock <= minStock;
                // Sanitasi: kalau totalValue corrupt (> 1 triliun), pakai stock × avgCost
                const rawTotalValue = Number(m.totalValue);
                const safeAvgCost = Math.round(Number(m.avgCost || 0));
                const safeTotalValue = Number.isFinite(rawTotalValue) && rawTotalValue < 1e12
                  ? Math.round(rawTotalValue)
                  : Math.round(stock * safeAvgCost);
                return (
                  <div key={m.id} className="rounded-2xl p-4" style={{ background: low ? "#fff1f2" : "#f8fafc", border: low ? "1px solid #fecdd3" : "1px solid #e2e8f0" }}>
                    <div className="flex justify-between items-start gap-3">
                      <div><div className="font-bold text-slate-800">{m.name}</div><div className="text-xs text-slate-400">{m.category || "Kain"} · min {Number(m.minStock || 0)} {m.unit || "yard"}</div></div>
                      <div className="text-right"><div className={`text-lg font-bold ${low ? "text-rose-600" : "text-emerald-600"}`}>{stock.toLocaleString("id-ID")} {m.unit || "yard"}</div><div className="text-xs text-slate-400">Modal avg {rupiah(safeAvgCost)}/{m.unit || "yard"}</div></div>
                    </div>
                    <div className="mt-2 flex justify-between text-xs">
                      <span className={low ? "font-bold text-rose-600" : "font-semibold text-emerald-600"}>{low ? "⚠️ Stok menipis" : "✅ Stok aman"}</span>
                      <span className="text-slate-400">Nilai stok {rupiah(safeTotalValue)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
            <div className="text-lg font-bold mb-1" style={{ color: "#ec4899" }}>🧾 Master Produk</div>
            {productMasters.length === 0 && <div className="text-center py-6 text-slate-400">Belum ada master produk</div>}
            <div className="space-y-2">
              {productMasters.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-2xl bg-pink-50 p-3">
                  <div><div className="font-bold text-sm text-slate-800">{p.name}</div><div className="text-xs text-slate-400">{p.category || "Lainnya"}</div></div>
                  <div className="text-sm font-bold text-pink-600">{rupiah(p.defaultPrice || 0)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REKAP TAB ── */}
      {!loading && tab === "rekap" && (() => {
        const s = rekapSummary();
        const customerRows = customerRowsInRekapRange();
        const transferInRows = [...autoTransferInRows].filter((t) => inRekapRange(t.date || ""));
        const transferOutRows = [...autoTransferOutRows].filter((t) => inRekapRange(t.date || ""));
        return (
          <div className="p-4 space-y-4">

            {/* Pilih Periode */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
              <div className="text-xl font-bold mb-1" style={{ color: "#ec4899" }}>📊 Rekap</div>
              <div className="text-xs text-slate-400 mb-4">Satu periode untuk PDF, WA, invoice customer, log bayar, dan log transfer keluar.</div>
              <div className="grid grid-cols-2 gap-3">
                <DatePicker label="Dari Tanggal" value={rekapStartDate} onChange={setRekapStartDate} />
                <DatePicker label="Sampai Tanggal" value={rekapEndDate} onChange={setRekapEndDate} />
              </div>
              <div className="mt-4">
                <Button onClick={downloadRekapTanggalPdf} className="w-full" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>📄 Download PDF</Button>
              </div>
            </div>

            {/* Ringkasan */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #c4b5fd" }}>
              <div className="text-lg font-bold mb-3" style={{ color: "#7c3aed" }}>Ringkasan Bisnis</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-pink-50 p-3"><div className="text-xs text-slate-400">Omzet</div><div className="font-bold text-pink-600">{rupiah(s.omzet)}</div></div>
                <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-xs text-slate-400">Laba</div><div className={`font-bold ${s.laba >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{rupiah(s.laba)}</div></div>
                <div className="rounded-2xl bg-sky-50 p-3"><div className="text-xs text-slate-400">Piutang Customer</div><div className="font-bold text-sky-600">{rupiah(s.piutang)}</div></div>
                <div className="rounded-2xl bg-rose-50 p-3"><div className="text-xs text-slate-400">Hutang Supplier</div><div className="font-bold text-rose-600">{rupiah(s.hutangSupplier)}</div></div>
                <div className="rounded-2xl bg-violet-50 p-3"><div className="text-xs text-slate-400">HPP</div><div className="font-bold text-violet-600">{rupiah(s.hpp)}</div></div>
                <div className="rounded-2xl bg-amber-50 p-3"><div className="text-xs text-slate-400">Gaji Produksi</div><div className="font-bold text-amber-600">{rupiah(s.gajiProduksi)}</div></div>
                <div className="rounded-2xl bg-orange-50 p-3"><div className="text-xs text-slate-400">Pengeluaran Lain</div><div className="font-bold text-orange-600">{rupiah(s.pengeluaran)}</div></div>
              </div>
            </div>

            {/* Invoice Customer */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
              <div className="text-lg font-bold mb-1" style={{ color: "#ec4899" }}>📄 Invoice Customer</div>
              <div className="text-xs text-slate-400 mb-3">Customer sesuai periode tanggal di bawah.</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <DatePicker label="Dari Tanggal" value={invoiceStartDate} onChange={setInvoiceStartDate} />
                <DatePicker label="Sampai Tanggal" value={invoiceEndDate} onChange={setInvoiceEndDate} />
              </div>
              <div className="space-y-2">
                {(() => {
                  const invoiceRows = (() => {
                    const map = {};
                    (orders || []).filter((o) => {
                      const d = o.createdAt || o.date || o.tanggal || "";
                      const s = dateSerial(d);
                      if (!s) return true;
                      if (invoiceStartDate && s < dateSerial(invoiceStartDate)) return false;
                      if (invoiceEndDate && s > dateSerial(invoiceEndDate)) return false;
                      return true;
                    }).forEach((o) => {
                      const name = capitalizeWords(o.customer || "");
                      const key = normalizeName(name);
                      if (!key) return;
                      if (!map[key]) map[key] = { name, orders: [], totalTagihan: 0, totalBayar: 0, sisa: 0 };
                      map[key].orders.push(o);
                      map[key].totalTagihan += orderPaymentTarget(o);
                      map[key].totalBayar += orderPaidTotal(o);
                      map[key].sisa += Math.max(0, orderPaymentTarget(o) - orderPaidTotal(o));
                    });
                    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
                  })();
                  return invoiceRows.length === 0
                    ? <div className="text-center py-4 text-slate-400">Tidak ada customer pada periode ini</div>
                    : invoiceRows.map((c) => (
                      <div key={c.name} className="flex items-center justify-between rounded-2xl p-3" style={{ background: "#fdf2f8", border: "1px solid #fce7f3" }}>
                        <div>
                          <div className="font-bold text-sm text-slate-800">{c.name}</div>
                          <div className="text-xs text-slate-400">{c.orders.length} pesanan · sisa {rupiah(c.sisa)}</div>
                        </div>
                        <button onClick={() => setInvoiceCustomer(c.name)} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#25d366,#128c7e)" }}>WA</button>
                      </div>
                    ));
                })()}
              </div>
            </div>

            {/* Log Pembayaran Customer */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #a5f3fc" }}>
              <div className="text-lg font-bold mb-1" style={{ color: "#0891b2" }}>💙 Log Pembayaran Customer</div>
              <div className="text-xs text-slate-400 mb-3">Mengikuti periode tanggal di atas.</div>
              <div className="space-y-2 max-h-80 overflow-auto">
                {transferInRows.length === 0 && <div className="text-center py-4 text-slate-400">Tidak ada pembayaran customer</div>}
                {transferInRows.sort(sortOldestBottom).map((t) => (
                  <div key={t.id} className="rounded-2xl p-3 flex justify-between items-center" style={{ background: "#ecfeff", border: "1px solid #a5f3fc" }}>
                    <div>
                      <div className="font-bold text-sm text-slate-800">{t.customer}</div>
                      <div className="text-xs text-slate-500">📅 {t.date} · {t.bank}</div>
                      {t.note && <div className="text-xs text-slate-400">{t.note}</div>}
                    </div>
                    <div className="font-bold text-cyan-600">{rupiah(t.amount)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Log Transfer Keluar */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #fecaca" }}>
              <div className="text-lg font-bold mb-1" style={{ color: "#dc2626" }}>🔴 Log Transfer Keluar</div>
              <div className="text-xs text-slate-400 mb-3">Tetap sesuai input manual transfer keluar, mengikuti periode tanggal.</div>
              <div className="space-y-2 max-h-80 overflow-auto">
                {transferOutRows.length === 0 && <div className="text-center py-4 text-slate-400">Tidak ada transfer keluar</div>}
                {transferOutRows.sort(sortOldestBottom).map((t) => (
                  <div key={t.id} className="rounded-2xl p-3 flex justify-between items-center" style={{ background: "#fff1f2", border: "1px solid #fecaca" }}>
                    <div>
                      <div className="font-bold text-sm text-slate-800">{t.supplier}</div>
                      <div className="text-xs text-slate-500">📅 {t.date} · {t.bank}</div>
                      {t.note && <div className="text-xs text-slate-400">{t.note}</div>}
                    </div>
                    <div className="font-bold text-rose-600">{rupiah(t.amount)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Backup tetap ada, tapi tidak memenuhi layar */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #e2e8f0" }}>
              <div className="text-lg font-bold mb-3 text-slate-700">🛡️ Backup Data</div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={exportBackupJson} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>Backup JSON</Button>
                <Button onClick={exportBackupTsv} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>Backup Excel</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════ MODALS ════ */}

      {dashboardDetail && <DashboardDetailModal />}

      {/* Modal Transfer Keluar */}
      {modal === "transferOut" && (
        <SimpleModal title="Catat Transfer Keluar" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">
              🔴 Catatan transfer keluar bebas — tidak otomatis dikurangi dari hutang supplier. Hanya sebagai bukti kas keluar real per tanggal.
            </div>
            <DatePicker label="Tanggal Transfer" value={transferOutForm.date} onChange={(v) => setTransferOutForm(f => ({ ...f, date: v }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#dc2626" }}>Nama Supplier / Penerima</label>
              <input list="supplier-list-transfer-out" value={transferOutForm.supplier}
                onChange={(e) => setTransferOutForm(f => ({ ...f, supplier: e.target.value }))}
                placeholder="Ketik nama penerima..."
                className="w-full px-4 py-3 outline-none text-sm"
                style={{ borderRadius: 14, border: "1.5px solid #fecaca", background: "#fff1f2", color: "#7f1d1d" }} />
              <datalist id="supplier-list-transfer-out">
                {uniqueSuppliers.map(s => <option key={s.name} value={s.name} />)}
              </datalist>
            </div>
            <Input label="Bank / Metode Transfer" value={transferOutForm.bank} onChange={(v) => setTransferOutForm(f => ({ ...f, bank: v }))} placeholder="Contoh: BRI, BCA, DANA, GoPay, Tunai" />
            <Input label="Keterangan (opsional)" value={transferOutForm.note} onChange={(v) => setTransferOutForm(f => ({ ...f, note: v }))} placeholder="Contoh: Bayar kain ceruty" />
            <Input label="Nominal Transfer" type="money" value={transferOutForm.amount} onChange={(v) => setTransferOutForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addTransferOut} className="w-full" style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)" }}>🔴 Simpan Transfer Keluar</Button>
          </div>
        </SimpleModal>
      )}

      {/* Modal Transfer Masuk */}
      {modal === "transfer" && (
        <SimpleModal title="Catat Transfer Masuk" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="rounded-2xl bg-cyan-50 p-3 text-xs text-cyan-700">
              💙 Catatan transfer bebas — tidak otomatis dialokasikan ke pesanan. Hanya sebagai bukti kas masuk real per tanggal.
            </div>
            <DatePicker label="Tanggal Transfer" value={transferForm.date} onChange={(v) => setTransferForm(f => ({ ...f, date: v }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#0891b2" }}>Nama Customer / Pengirim</label>
              <input list="customer-list-transfer" value={transferForm.customer}
                onChange={(e) => setTransferForm(f => ({ ...f, customer: e.target.value }))}
                placeholder="Ketik nama pengirim..."
                className="w-full px-4 py-3 outline-none text-sm"
                style={{ borderRadius: 14, border: "1.5px solid #a5f3fc", background: "#ecfeff", color: "#164e63" }} />
              <datalist id="customer-list-transfer">
                {uniqueCustomers.map(c => <option key={c.name} value={c.name} />)}
              </datalist>
            </div>
            <Input label="Bank / Metode Transfer" value={transferForm.bank} onChange={(v) => setTransferForm(f => ({ ...f, bank: v }))} placeholder="Contoh: BRI, BCA, DANA, GoPay, Tunai" />
            <Input label="Keterangan (opsional)" value={transferForm.note} onChange={(v) => setTransferForm(f => ({ ...f, note: v }))} placeholder="Contoh: Pelunasan pesanan mukena" />
            <Input label="Nominal Transfer" type="money" value={transferForm.amount} onChange={(v) => setTransferForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addTransfer} className="w-full" style={{ background: "linear-gradient(135deg,#0891b2,#06b6d4)" }}>💙 Simpan Transfer</Button>
          </div>
        </SimpleModal>
      )}

      {modal === "product" && (
        <SimpleModal title="Template Produk" onClose={() => { setModal(null); setProductForm(emptyProductForm); }}>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Foto Produk (opsional)</label>
              <div className="rounded-2xl p-3" style={{ background: "#fdf2f8", border: "1.5px solid #f9a8d4" }}>
                <div className="flex items-center gap-3">
                  <div className="h-20 w-20 rounded-2xl bg-white overflow-hidden flex items-center justify-center border border-pink-100 shrink-0">
                    {productForm.imageUrl ? <img src={productForm.imageUrl} alt="preview" className="h-full w-full object-cover" /> : <span className="text-3xl">📷</span>}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="block w-full cursor-pointer rounded-2xl px-4 py-3 text-center text-sm font-bold text-white" style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}>
                      Upload Foto
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleProductImageUpload(e.target.files?.[0])} />
                    </label>
                    {productForm.imageUrl && (<button type="button" onClick={() => setProductForm(f => ({ ...f, imageUrl: "" }))} className="w-full rounded-2xl bg-white px-4 py-2 text-xs font-bold text-rose-500 border border-rose-100">Hapus Foto</button>)}
                  </div>
                </div>
              </div>
            </div>
            <Input label="Nama Produk *" value={productForm.name} onChange={(v) => setProductForm(f => ({ ...f, name: v }))} placeholder="Contoh: Mukena Rayon Premium" />
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Kategori *</label>
              <input list="product-category-list-modal" value={productForm.category} onChange={(e) => setProductForm(f => ({ ...f, category: e.target.value }))} placeholder="Kerudung / Mukena / Baju Anak" className="w-full px-4 py-3 outline-none text-sm" style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }} />
              <datalist id="product-category-list-modal">{productCategoryOptions.map(name => <option key={name} value={name} />)}</datalist>
            </div>
            <Input label="Harga Jual *" type="money" value={productForm.defaultPrice} onChange={(v) => setProductForm(f => ({ ...f, defaultPrice: v }))} />
            <div className="rounded-2xl p-3 space-y-2" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div className="font-bold text-slate-700">HPP Produk (opsional)</div>
              <Input label="Bahan Utama" value={productForm.mainMaterial} onChange={(v) => setProductForm(f => ({ ...f, mainMaterial: v }))} placeholder="Contoh: Rayon Twill" />
              <div className="grid grid-cols-2 gap-2">
                <Input label="Kebutuhan / pcs" type="number" value={productForm.materialQtyPerPcs} onChange={(v) => {
                  const qty = Number(v || 0);
                  const pricePerUnit = moneyValue(productForm.bahanPricePerUnit || 0);
                  const bahanCost = pricePerUnit > 0 && qty > 0 ? Math.round(pricePerUnit * qty) : 0;
                  setProductForm(f => ({ ...f, materialQtyPerPcs: v, bahanCost }));
                }} />
                <Select label="Satuan" value={productForm.unit} onChange={(v) => setProductForm(f => ({ ...f, unit: v }))}><option value="yard">yard</option><option value="kg">kg</option></Select>
              </div>
              <Input label={`Harga Bahan / ${productForm.unit || "yard"}`} type="money" value={productForm.bahanPricePerUnit} onChange={(v) => {
                const pricePerUnit = moneyValue(v || 0);
                const qty = Number(productForm.materialQtyPerPcs || 0);
                const bahanCost = pricePerUnit > 0 && qty > 0 ? Math.round(pricePerUnit * qty) : 0;
                setProductForm(f => ({ ...f, bahanPricePerUnit: v, bahanCost }));
              }} placeholder={`Harga per ${productForm.unit || "yard"}`} />
              {moneyValue(productForm.bahanPricePerUnit || 0) > 0 && Number(productForm.materialQtyPerPcs || 0) > 0 && (
                <div className="flex justify-between rounded-xl px-3 py-2 text-xs" style={{ background: "#f5f3ff" }}>
                  <span className="text-slate-500">Biaya bahan / pcs</span>
                  <span className="font-bold text-purple-600">
                    {rupiah(moneyValue(productForm.bahanPricePerUnit || 0))} × {Number(productForm.materialQtyPerPcs || 0)} {productForm.unit || "yard"} = <strong>{rupiah(Math.round(moneyValue(productForm.bahanPricePerUnit || 0) * Number(productForm.materialQtyPerPcs || 0)))}</strong>
                  </span>
                </div>
              )}
              <Input label="Produksi" type="money" value={productForm.productionCost} onChange={(v) => setProductForm(f => ({ ...f, productionCost: v }))} />
              <Input label="Distribusi" type="money" value={productForm.distributionCost} onChange={(v) => setProductForm(f => ({ ...f, distributionCost: v }))} />
              <Input label="Lain-lain" type="money" value={productForm.otherCost} onChange={(v) => setProductForm(f => ({ ...f, otherCost: v }))} />
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4 flex justify-between items-center">
              <div><div className="text-xs text-slate-500">HPP otomatis</div><div className="text-xl font-bold text-emerald-600">{rupiah(calculateProductHpp(productForm))}</div></div>
              <div className="text-right"><div className="text-xs text-slate-500">Estimasi margin</div><div className="text-lg font-bold text-pink-600">{rupiah(moneyValue(productForm.defaultPrice || 0) - calculateProductHpp(productForm))}</div></div>
            </div>
            <Button onClick={saveProductTemplate} className="w-full" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>Simpan Template Produk</Button>
          </div>
        </SimpleModal>
      )}

      {modal === "order" && (
        <SimpleModal title="Tambah Pesanan" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <DatePicker label="Tanggal Pesanan" value={orderForm.date} onChange={(v) => setOrderForm(f => ({ ...f, date: v }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Nama Customer</label>
              <input list="customer-list" value={orderForm.customer} onChange={(e) => setOrderForm(f => ({ ...f, customer: e.target.value }))} placeholder="Ketik atau pilih nama customer..." className="w-full px-4 py-3 outline-none text-sm" style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }} />
              <datalist id="customer-list">{uniqueCustomers.map(c => <option key={c.name} value={c.name} />)}</datalist>
            </div>
            <Input label="No HP Customer (opsional)" type="number" value={orderForm.phone} onChange={(v) => setOrderForm(f => ({ ...f, phone: v }))} placeholder="08xxxxxxxxxx" />
            {topCustomers.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold" style={{ color: "#a855f7" }}>Customer favorit</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {topCustomers.map((c) => (<button key={c.name} type="button" onClick={() => setOrderForm(f => ({ ...f, customer: c.name }))} className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-bold shadow-sm" style={{ color: "#7c3aed", border: "1px solid #ddd6fe" }}>{c.name}</button>))}
                </div>
              </div>
            )}
            <div className="flex gap-2"><button type="button" onClick={resetOrderDraft} className="w-full rounded-2xl bg-slate-100 py-2 text-xs font-bold text-slate-500">Reset draft</button></div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Produk Pesanan</label>
                <button type="button" onClick={() => setOrderForm(f => ({ ...f, items: [...(f.items || []), emptyOrderItem()] }))} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}>+ Tambah Produk</button>
              </div>
              {(orderForm.items || []).map((it, idx) => (
                <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#fdf2f8", border: "1.5px solid #f9a8d4" }}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold" style={{ color: "#ec4899" }}>Produk #{idx + 1}</div>
                    {(orderForm.items || []).length > 1 && (<button type="button" onClick={() => setOrderForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))} className="rounded-xl px-3 py-1 text-xs font-bold text-rose-600 bg-rose-50">Hapus</button>)}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Nama Produk</label>
                    <input list="product-master-list" value={it.name}
                      onChange={(e) => { const v = e.target.value; const master = findProductMaster(v); setOrderForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, name: v, productId: master?.id || x.productId || "", category: master?.category || x.category || "", price: master?.defaultPrice !== undefined ? moneyValue(master.defaultPrice || 0) : x.price, bahanCost: master ? moneyValue(master.bahanCost || 0) : moneyValue(x.bahanCost || 0), hppPerPcs: master ? calculateProductHpp(master) : moneyValue(x.hppPerPcs || 0), mainMaterial: master?.mainMaterial || x.mainMaterial || "", materialQtyPerPcs: master?.materialQtyPerPcs || x.materialQtyPerPcs || 0, unit: master?.unit || x.unit || "yard" } : x) })); }}
                      placeholder="Contoh: Mukena Rayon Anak" className="w-full px-4 py-3 outline-none text-sm" style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }} />
                    <datalist id="product-master-list">{productMasters.map(p => <option key={p.id} value={p.name} />)}</datalist>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Kategori</label>
                    <input list="product-category-list" value={it.category || ""} onChange={(e) => setOrderForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, category: e.target.value } : x) }))} placeholder="Kerudung / Mukena / Baju Anak" className="w-full px-4 py-3 outline-none text-sm" style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }} />
                    <datalist id="product-category-list">{productCategoryOptions.map(name => <option key={name} value={name} />)}</datalist>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Jumlah pcs" type="number" value={it.qty} onChange={(v) => setOrderForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, qty: v } : x) }))} />
                    <Input label="Harga/pcs" type="money" value={it.price} onChange={(v) => setOrderForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, price: v } : x) }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex justify-between rounded-xl bg-white px-3 py-2 text-sm"><span className="text-slate-500">Subtotal</span><span className="font-bold" style={{ color: "#be185d" }}>{rupiah(Number(it.qty || 0) * moneyValue(it.price || 0))}</span></div>
                    <div className="flex justify-between rounded-xl bg-white px-3 py-2 text-sm"><span className="text-slate-500">Est. Laba</span><span className="font-bold text-emerald-600">{rupiah((moneyValue(it.price || 0) - moneyValue(it.hppPerPcs || 0)) * Number(it.qty || 0))}</span></div>
                  </div>
                </div>
              ))}
            </div>
            <Input label="Ongkir (opsional)" type="money" value={orderForm.shippingCost} onChange={(v) => setOrderForm(f => ({ ...f, shippingCost: v }))} />
            <div className="w-full px-4 py-3 text-sm font-bold rounded-2xl space-y-1" style={{ border: "1.5px solid #f9a8d4", background: "#fce7f3", color: "#be185d" }}>
              <div className="flex justify-between"><span>Subtotal</span><span>{rupiah(orderItemsTotal(orderForm.items))}</span></div>
              <div className="flex justify-between"><span>Ongkir</span><span>{rupiah(orderForm.shippingCost)}</span></div>
              <div className="flex justify-between border-t border-pink-200 pt-1"><span>Total</span><span>{rupiah(orderGrandTotal(orderForm.items, orderForm.shippingCost))}</span></div>
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
            <div className="rounded-2xl p-3 space-y-3" style={{ background: "#fff7ed", border: "1.5px solid #fed7aa" }}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm" style={{ color: "#ea580c" }}>🧵 Item Bahan</div>
                <button type="button" onClick={() => setPurchaseForm(f => ({ ...f, materials: [...(f.materials || []), emptyPurchaseMaterial()] }))} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>+ Tambah Bahan</button>
              </div>
              {(purchaseForm.materials || []).map((it, idx) => (
                <div key={idx} className="rounded-2xl bg-white p-3 space-y-2" style={{ border: "1px solid #fed7aa" }}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-orange-600">Bahan #{idx + 1}</div>
                    {(purchaseForm.materials || []).length > 1 && (<button type="button" onClick={() => setPurchaseForm(f => ({ ...f, materials: f.materials.filter((_, i) => i !== idx) }))} className="text-xs font-bold text-rose-500">Hapus</button>)}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Nama Bahan</label>
                    <input list="material-master-list" value={it.name} onChange={(e) => setPurchaseForm(f => ({ ...f, materials: f.materials.map((x, i) => i === idx ? { ...x, name: e.target.value } : x) }))} placeholder="Contoh: Ceruty Babydoll" className="w-full px-4 py-3 outline-none text-sm" style={{ borderRadius: 14, border: "1.5px solid #f9a8d4", background: "#fdf2f8", color: "#2d1b69" }} />
                    <datalist id="material-master-list">{materialsStock.map(m => <option key={m.id} value={m.name} />)}</datalist>
                  </div>
                  <Input label="Kategori" value={it.category} onChange={(v) => setPurchaseForm(f => ({ ...f, materials: f.materials.map((x, i) => i === idx ? { ...x, category: v } : x) }))} placeholder="Kain, Karet, Aksesoris" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Qty" type="number" value={it.qty} onChange={(v) => setPurchaseForm(f => ({ ...f, materials: f.materials.map((x, i) => i === idx ? { ...x, qty: v } : x) }))} />
                    <Select label="Satuan" value={it.unit || "yard"} onChange={(v) => setPurchaseForm(f => ({ ...f, materials: f.materials.map((x, i) => i === idx ? { ...x, unit: v } : x) }))}><option value="yard">yard</option><option value="kg">kg</option></Select>
                  </div>
                  <Input label={`Harga per ${it.unit || "yard"}`} type="money" value={it.pricePerUnit || 0} onChange={(v) => setPurchaseForm(f => ({ ...f, materials: f.materials.map((x, i) => i === idx ? { ...x, pricePerUnit: v, total: numberValue(x.qty || 0) * moneyValue(v || 0) } : x) }))} />
                  <div className="flex justify-between rounded-xl bg-orange-50 px-3 py-2 text-sm"><span className="text-slate-500">Total Harga Bahan</span><span className="font-bold text-orange-600">{rupiah(numberValue(it.qty || 0) * moneyValue(it.pricePerUnit || 0))}</span></div>
                </div>
              ))}
            </div>
            <div className="w-full px-4 py-3 text-sm font-bold rounded-2xl" style={{ border: "1.5px solid #fed7aa", background: "#fff7ed", color: "#ea580c" }}>Subtotal Bahan: {rupiah(purchaseMaterialsTotal(purchaseForm.materials))}</div>
            <Input label="Ongkir Supplier (opsional)" type="money" value={purchaseForm.shippingCost || 0} onChange={(v) => setPurchaseForm(f => ({ ...f, shippingCost: v }))} />
            <div className="w-full px-4 py-3 text-sm font-bold rounded-2xl" style={{ border: "1.5px solid #fed7aa", background: "#fff7ed", color: "#ea580c" }}>Total Tagihan Supplier: {rupiah(purchaseMaterialsTotal(purchaseForm.materials) + moneyValue(purchaseForm.shippingCost || 0))}</div>
            <Input label="DP Supplier (opsional)" type="money" value={purchaseForm.dp} onChange={(v) => setPurchaseForm(f => ({ ...f, dp: v }))} />
            <Button onClick={addPurchase} className="w-full bg-yellow-500">Simpan Supplier & Update Stok</Button>
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
        <SimpleModal title="Catat Bayar Customer" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="rounded-2xl bg-cyan-50 p-3 text-xs text-cyan-700">
              💙 Transfer masuk dicatat utuh sebagai mutasi rekening. Setelah itu nominalnya otomatis dialokasikan ke piutang/pesanan customer.
            </div>
            <DatePicker label="Tanggal Bayar" value={orderPayForm.date} onChange={(v) => setOrderPayForm(f => ({ ...f, date: v }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#0891b2" }}>Nama Customer / Pengirim</label>
              <input list="customer-list-pay" value={orderPayForm.customer}
                onChange={(e) => setOrderPayForm(f => ({ ...f, customer: e.target.value }))}
                placeholder="Ketik nama customer/pengirim..."
                className="w-full px-4 py-3 outline-none text-sm"
                style={{ borderRadius: 14, border: "1.5px solid #a5f3fc", background: "#ecfeff", color: "#164e63" }} />
              <datalist id="customer-list-pay">
                {uniqueCustomers.map(c => <option key={c.name} value={c.name} />)}
              </datalist>
            </div>
            <Input label="Bank / Metode Transfer" value={orderPayForm.bank} onChange={(v) => setOrderPayForm(f => ({ ...f, bank: v }))} placeholder="Contoh: BRI, BCA, DANA, GoPay, Tunai" />
            <Input label="Keterangan (opsional)" value={orderPayForm.note} onChange={(v) => setOrderPayForm(f => ({ ...f, note: v }))} placeholder="Contoh: DP, pelunasan, catatan transfer" />
            <Input label="Nominal Pembayaran" type="money" value={orderPayForm.amount} onChange={(v) => setOrderPayForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addOrderPayment} className="w-full" style={{ background: "linear-gradient(135deg,#10b981,#34d399)" }}>💚 Simpan Transfer Masuk</Button>
          </div>
        </SimpleModal>
      )}

      {modal === "supplierPay" && (
        <SimpleModal title="Bayar Supplier" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Select label="Pilih Supplier" value={supplierPayForm.supplier} onChange={(v) => setSupplierPayForm(f => ({ ...f, supplier: v }))}>
              <option value="">-- Pilih Supplier --</option>
              {uniqueSuppliers.filter(s => s.belanjaAktif > 0).map((s) => (<option key={s.name} value={s.name}>{s.name} — {s.belanjaAktif} belanja, sisa {rupiah(s.totalSisa)}</option>))}
            </Select>
            {supplierPayForm.supplier && (() => {
              const list = purchases.filter(p => normalizeName(p.supplier) === normalizeName(supplierPayForm.supplier) && sisaPurchase(p) > 0).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
              return list.length > 0 ? (
                <div className="rounded-2xl p-3 space-y-1" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                  <div className="text-xs font-bold mb-2" style={{ color: "#f97316" }}>📋 Akan dialokasikan ke hutang terlama:</div>
                  {list.map((p, i) => (<div key={p.id} className="flex justify-between gap-2 text-xs"><span style={{ color: "#64748b" }}>{i + 1}. {p.createdAt || "-"} · {purchaseMaterialsSummary(p)}</span><span className="font-semibold" style={{ color: "#e11d48" }}>sisa {rupiah(sisaPurchase(p))}</span></div>))}
                </div>
              ) : null;
            })()}
            <DatePicker label="Tanggal Bayar" value={supplierPayForm.date} onChange={(v) => setSupplierPayForm(f => ({ ...f, date: v }))} />
            <Input label="Keterangan" value={supplierPayForm.note} onChange={(v) => setSupplierPayForm(f => ({ ...f, note: v }))} placeholder="Contoh: Transfer supplier" />
            <Input label="Nominal Pembayaran" type="money" value={supplierPayForm.amount} onChange={(v) => setSupplierPayForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addSupplierPayment} className="w-full" style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>🧡 Simpan & Alokasi Otomatis</Button>
          </div>
        </SimpleModal>
      )}

      {/* Invoice per Customer Modal */}
      {invoiceCustomer && <InvoiceModal key={invoiceCustomer} customerName={invoiceCustomer} orders={orders} getOrderPayments={orderPaymentHistory} onClose={() => setInvoiceCustomer(null)} />}

      {/* Modal Edit */}
      {editData && (
        <SimpleModal title="Edit Data" onClose={() => setEditData(null)}>
          <div className="space-y-3">
            {editData.type === "orders" && <>
              <DatePicker label="Tanggal Pesanan" value={editData.createdAt || ""} onChange={(v) => setEditData(d => ({ ...d, createdAt: v }))} />
              <Input label="Nama Customer" value={editData.customer || ""} onChange={(v) => setEditData(d => ({ ...d, customer: v }))} />
              <Input label="No HP Customer" type="number" value={editData.phone || ""} onChange={(v) => setEditData(d => ({ ...d, phone: v }))} />
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold" style={{ color: "#a855f7" }}>Produk Pesanan</label>
                <button type="button" onClick={() => setEditData(d => ({ ...d, items: [...normalizeOrderItems(d), emptyOrderItem()] }))} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}>+ Tambah</button>
              </div>
              {normalizeOrderItems(editData).map((it, idx) => (
                <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#fdf2f8", border: "1.5px solid #f9a8d4" }}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold" style={{ color: "#ec4899" }}>Produk #{idx + 1}</div>
                    {normalizeOrderItems(editData).length > 1 && (<button type="button" onClick={() => setEditData(d => ({ ...d, items: normalizeOrderItems(d).filter((_, i) => i !== idx) }))} className="rounded-xl px-3 py-1 text-xs font-bold text-rose-600 bg-rose-50">Hapus</button>)}
                  </div>
                  <Input label="Nama Produk" value={it.name} onChange={(v) => setEditData(d => ({ ...d, items: normalizeOrderItems(d).map((x, i) => i === idx ? { ...x, name: v } : x) }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Jumlah pcs" type="number" value={it.qty} onChange={(v) => setEditData(d => ({ ...d, items: normalizeOrderItems(d).map((x, i) => i === idx ? { ...x, qty: v } : x) }))} />
                    <Input label="Harga/pcs" type="money" value={it.price} onChange={(v) => setEditData(d => ({ ...d, items: normalizeOrderItems(d).map((x, i) => i === idx ? { ...x, price: v } : x) }))} />
                  </div>
                </div>
              ))}
              <Input label="Ongkir" type="money" value={editData.shippingCost || editData.ongkir || 0} onChange={(v) => setEditData(d => ({ ...d, shippingCost: v, ongkir: v }))} />
              <div className="flex gap-2">
                {["Proses", "Selesai", "Lunas"].map((s) => (<button key={s} onClick={() => setEditData(d => ({ ...d, status: s }))} className={`rounded-full px-4 py-2 text-sm font-semibold border transition-all ${editData.status === s ? "bg-pink-600 text-white border-pink-600" : "bg-white text-slate-500 border-slate-200"}`}>{s}</button>))}
              </div>
            </>}
            {editData.type === "purchases" && <>
              <DatePicker label="Tanggal Belanja" value={editData.createdAt || ""} onChange={(v) => setEditData(d => ({ ...d, createdAt: v }))} />
              <Input label="Nama Supplier" value={editData.supplier || ""} onChange={(v) => setEditData(d => ({ ...d, supplier: v }))} />
              <div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-700">
                Kalau data lama sudah terhapus, klik Pulihkan Histori Pembayaran untuk menempelkan transfer keluar lama ke data supplier baru tanpa membuat kas keluar dobel.
              </div>
              {normalizePurchaseMaterials(editData).map((it, idx) => (
                <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#fff7ed", border: "1.5px solid #fed7aa" }}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-orange-600">Bahan #{idx + 1}</div>
                    {normalizePurchaseMaterials(editData).length > 1 && (
                      <button type="button" onClick={() => setEditData(d => ({ ...d, materials: normalizePurchaseMaterials(d).filter((_, i) => i !== idx) }))} className="rounded-xl bg-rose-100 px-3 py-1 text-xs font-bold text-rose-600">Hapus</button>
                    )}
                  </div>
                  <Input label="Bahan" value={it.name || ""} onChange={(v) => setEditData(d => ({ ...d, materials: normalizePurchaseMaterials(d).map((x, i) => i === idx ? { ...x, name: v } : x) }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Qty" type="number" value={it.qty || ""} onChange={(v) => setEditData(d => ({ ...d, materials: normalizePurchaseMaterials(d).map((x, i) => i === idx ? { ...x, qty: v, total: numberValue(v || 0) * moneyValue(x.pricePerUnit || 0) } : x) }))} />
                    <Select label="Satuan" value={it.unit || "yard"} onChange={(v) => setEditData(d => ({ ...d, materials: normalizePurchaseMaterials(d).map((x, i) => i === idx ? { ...x, unit: v } : x) }))}><option value="yard">yard</option><option value="kg">kg</option></Select>
                  </div>
                  <Input label={`Harga per ${it.unit || "yard"}`} type="money" value={it.pricePerUnit || 0} onChange={(v) => setEditData(d => ({ ...d, materials: normalizePurchaseMaterials(d).map((x, i) => i === idx ? { ...x, pricePerUnit: v, total: numberValue(x.qty || 0) * moneyValue(v || 0) } : x) }))} />
                  <div className="flex justify-between rounded-xl bg-orange-50 px-3 py-2 text-sm"><span className="text-slate-500">Total Harga Bahan</span><span className="font-bold text-orange-600">{rupiah(numberValue(it.qty || 0) * moneyValue(it.pricePerUnit || 0))}</span></div>
                </div>
              ))}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button type="button" onClick={() => setEditData(d => ({ ...d, materials: [...normalizePurchaseMaterials(d), emptyPurchaseMaterial()] }))} className="w-full" style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>+ Tambah Bahan</Button>
                <Button type="button" onClick={() => pulihkanHistoriPembayaranSupplier(editData.id)} className="w-full" style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}>Pulihkan Histori Pembayaran</Button>
              </div>
            </>}
            {editData.type === "expenses" && <>
              <DatePicker label="Tanggal" value={editData.date || ""} onChange={(v) => setEditData(d => ({ ...d, date: v }))} />
              <Input label="Kategori" value={editData.category || ""} onChange={(v) => setEditData(d => ({ ...d, category: v }))} />
              <Input label="Keterangan" value={editData.note || ""} onChange={(v) => setEditData(d => ({ ...d, note: v }))} />
              <Input label="Nominal" type="money" value={editData.amount || 0} onChange={(v) => setEditData(d => ({ ...d, amount: v }))} />
            </>}
            {editData.type === "transfers" && <>
              <div className="rounded-2xl bg-cyan-50 p-3 text-xs text-cyan-700">
                Jika nominal/nama customer diubah, alokasi pembayaran pada pesanan customer akan dihapus lalu dihitung ulang otomatis dari pesanan terlama.
              </div>
              <DatePicker label="Tanggal Transfer" value={editData.date || ""} onChange={(v) => setEditData(d => ({ ...d, date: v }))} />
              <Input label="Nama Customer / Pengirim" value={editData.customer || ""} onChange={(v) => setEditData(d => ({ ...d, customer: v }))} />
              <Input label="Bank / Metode" value={editData.bank || ""} onChange={(v) => setEditData(d => ({ ...d, bank: v }))} />
              <Input label="Keterangan" value={editData.note || ""} onChange={(v) => setEditData(d => ({ ...d, note: v }))} />
              <Input label="Nominal" type="money" value={editData.amount || 0} onChange={(v) => setEditData(d => ({ ...d, amount: v }))} />
            </>}
            {editData.type === "transfersOut" && <>
              <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">
                Jika nominal/nama supplier diubah, alokasi pembayaran pada hutang supplier akan dihapus lalu dihitung ulang otomatis dari belanja terlama.
              </div>
              <DatePicker label="Tanggal Transfer" value={editData.date || ""} onChange={(v) => setEditData(d => ({ ...d, date: v }))} />
              <Input label="Nama Supplier / Penerima" value={editData.supplier || ""} onChange={(v) => setEditData(d => ({ ...d, supplier: v }))} />
              <Input label="Bank / Metode" value={editData.bank || ""} onChange={(v) => setEditData(d => ({ ...d, bank: v }))} />
              <Input label="Keterangan" value={editData.note || ""} onChange={(v) => setEditData(d => ({ ...d, note: v }))} />
              <Input label="Nominal" type="money" value={editData.amount || 0} onChange={(v) => setEditData(d => ({ ...d, amount: v }))} />
            </>}
            <Button onClick={saveEdit} className="w-full bg-sky-600">Simpan Perubahan</Button>
          </div>
        </SimpleModal>
      )}

      {/* Modal Tandai Dikirim */}
      {kirimModal && (() => {
        const order = orders.find((o) => o.id === kirimModal);
        const totalPesanan = order ? moneyValue(order.total || 0) : 0;
        const totalSebelumKirim = order ? billableOrderTotal(order) : 0;
        const totalKirimHariIni = deliveryItemsTotal(kirimItems.map((it) => ({ qty: it.shippedQty, price: it.price })));
        const totalSetelahKirim = totalSebelumKirim + totalKirimHariIni;
        const selisihNominal = totalSetelahKirim - totalPesanan;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md max-h-[92vh] overflow-auto rounded-3xl bg-white p-6 shadow-xl">
              <div className="text-xl font-bold text-slate-800 mb-1">🚚 Input Pengiriman Bertahap</div>
              <div className="text-slate-500 text-sm mb-4">Isi qty yang dikirim hari ini.</div>
              <DatePicker label="Tanggal Kirim" value={tanggalKirim} onChange={(v) => setTanggalKirim(v)} />
              <div className="mt-4 space-y-3">
                {kirimItems.map((it, idx) => {
                  const totalAkanTerkirim = Number(it.alreadyShipped || 0) + Number(it.shippedQty || 0);
                  const selisih = totalAkanTerkirim - Number(it.orderedQty || 0);
                  const subtotal = Number(it.shippedQty || 0) * moneyValue(it.price || 0);
                  return (
                    <div key={idx} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="font-bold text-sm text-slate-800">{it.name}</div>
                      <div className="text-xs text-slate-400 mb-2">Pesanan {it.orderedQty} pcs · Sudah terkirim {it.alreadyShipped || 0} pcs · Sisa {it.remainingQty || 0} pcs</div>
                      <Input label="Qty Dikirim Hari Ini" type="number" value={it.shippedQty} onChange={(v) => setKirimItems(items => items.map((x, i) => i === idx ? { ...x, shippedQty: v, note: shipmentAutoNote(x.orderedQty, v) } : x))} />
                      <div className="mt-2 flex justify-between text-xs">
                        <span className={selisih < 0 ? "font-bold text-rose-600" : "font-semibold text-emerald-600"}>Selisih {selisih} pcs</span>
                        <span className="font-bold text-purple-600">Subtotal {rupiah(subtotal)}</span>
                      </div>
                      <div className={`mt-2 rounded-xl px-3 py-2 text-xs font-semibold ${selisih < 0 ? "bg-rose-50 text-rose-600" : selisih > 0 ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
                        📝 {shipmentAutoNote(it.orderedQty, totalAkanTerkirim)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 rounded-2xl bg-pink-50 p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Nilai kirim hari ini</span><span className="font-semibold text-sky-600">{rupiah(totalKirimHariIni)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Tagihan setelah kirim</span><span className="font-bold text-pink-600">{rupiah(totalSetelahKirim)}</span></div>
                <div className="flex justify-between text-sm border-t pt-2"><span className="font-semibold">Selisih vs pesanan</span><span className={selisihNominal < 0 ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>{rupiah(selisihNominal)}</span></div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => { setKirimModal(null); setKirimItems([]); }} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
                <button onClick={tandaiDikirim} className="flex-1 rounded-2xl bg-sky-600 py-3 font-semibold text-white">Simpan</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Konfirmasi Reset Supplier - Step 1 */}
      {confirmResetSupplier && !confirmResetSupplier2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-rose-700 mb-2">⚠️ Reset Data Supplier?</div>
            <div className="text-slate-600 mb-3 text-sm leading-relaxed">
              Ini akan menghapus <strong>semua nota purchase</strong> dan <strong>semua riwayat pembayaran supplier</strong> (transfersOut) secara permanen.
            </div>
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 mb-5 text-sm text-amber-800">
              ✅ Stok bahan <strong>tidak akan diubah</strong>.<br />
              ❌ Data yang dihapus <strong>tidak bisa dikembalikan</strong>.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmResetSupplier(false)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
              <button onClick={() => { setConfirmResetSupplier(false); setConfirmResetSupplier2(true); }} className="flex-1 rounded-2xl bg-rose-600 py-3 font-semibold text-white">Lanjut →</button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi Reset Supplier - Step 2 (Double Confirm) */}
      {confirmResetSupplier2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-rose-700 mb-2">🔴 Konfirmasi Terakhir</div>
            <div className="text-slate-600 mb-2 text-sm">
              Kamu yakin ingin menghapus <strong>{purchases.length} nota</strong> dan <strong>{transfersOut.length} pembayaran</strong>?
            </div>
            <div className="text-slate-500 mb-5 text-xs">Aksi ini tidak bisa dibatalkan.</div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmResetSupplier2(false)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
              <button onClick={resetSemuaSupplier} className="flex-1 rounded-2xl bg-rose-700 py-3 font-semibold text-white">Ya, Hapus Semua</button>
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