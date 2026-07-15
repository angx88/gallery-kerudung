// ─── Helpers ────────────────────────────────────────────────────────────────
// File ini dipecah dari App.jsx (langkah 1 dari refactor bertahap).
// Isinya murni fungsi bantu / kalkulasi tanpa state React — aman dipisah
// karena tidak bergantung pada apapun di dalam komponen GalleryKerudungApp.
// generateInvoice() butuh akses Firestore, jadi db/doc/runTransaction diimport di sini juga.

import { db } from "./firebase";
import { doc, runTransaction } from "firebase/firestore";

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

// moneyValue dihapus — langsung pakai parseMoney di seluruh file
const moneyValue = parseMoney;

function moneySum(rows = [], picker = (x) => x) {
  return Math.round((rows || []).reduce((sum, row) => sum + moneyValue(picker(row) || 0), 0));
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

function normalizeAbnormalMoneyToSafe(value, max = SAFE_SUMMARY_MAX) {
  let n = moneyValue(value);
  if (!Number.isFinite(Number(n)) || n < 0) return 0;
  if (n <= max) return Math.round(n);

  // Data lama tertentu pernah tersimpan dengan pemisah ribuan/desimal berulang,
  // contoh 16.746.329.999.999.998 yang sebenarnya adalah 16.746.330.
  // Turunkan per 1.000 sampai kembali ke rentang bisnis yang wajar.
  let fixed = Number(n);
  let guard = 0;
  while (fixed > max && guard < 8) {
    fixed = Math.round(fixed / 1000);
    guard += 1;
  }
  return isReasonableMoney(fixed, max) ? Math.round(fixed) : 0;
}

function sanitizePurchaseMaterialForRepair(item, purchase = {}) {
  const name = item?.name || item?.material || purchase?.material || "Bahan Baku";
  const qty = numberValue(item?.qty ?? purchase?.qty ?? 0);
  const unit = normalizeMaterialUnit(name, item?.unit || purchase?.unit);
  const rawPrice = item?.pricePerUnit ?? item?.unitPrice ?? item?.hargaSatuan ?? 0;
  const rawTotal = item?.total ?? 0;

  let pricePerUnit = normalizeAbnormalMoneyToSafe(rawPrice, LIMITS.MAX_PRICE_PER_UNIT);
  let total = normalizeAbnormalMoneyToSafe(rawTotal, LIMITS.MAX_MONEY_INPUT);

  if (qty > 0 && total > 0 && (pricePerUnit <= 0 || hasAbnormalMoney(rawPrice, LIMITS.MAX_PRICE_PER_UNIT))) {
    pricePerUnit = Math.round(total / qty);
  }
  if (qty > 0 && pricePerUnit > 0 && (total <= 0 || hasAbnormalMoney(rawTotal, LIMITS.MAX_MONEY_INPUT))) {
    total = Math.round(qty * pricePerUnit);
  }

  return {
    name: capitalizeWords(name),
    category: item?.category || purchase?.category || "Kain",
    qty,
    unit,
    pricePerUnit,
    total,
  };
}

function purchaseHasAbnormalData(purchase) {
  return hasAbnormalMoney(purchase?.total) ||
    hasAbnormalMoney(purchase?.subtotal) ||
    hasAbnormalMoney(purchase?.shippingCost ?? purchase?.ongkir) ||
    normalizePurchaseMaterials(purchase).some((it) =>
      hasAbnormalMoney(it.total) ||
      hasAbnormalMoney(it.pricePerUnit || it.unitPrice || it.hargaSatuan)
    );
}

function buildSupplierRepairPayload(purchase) {
  const rawMaterials = Array.isArray(purchase?.materials) && purchase.materials.length > 0
    ? purchase.materials
    : normalizePurchaseMaterials(purchase);

  const materials = rawMaterials
    .map((it) => sanitizePurchaseMaterialForRepair(it, purchase))
    .filter((it) => it.name && Number(it.qty || 0) > 0 && Number(it.pricePerUnit || 0) > 0 && Number(it.total || 0) > 0);

  const subtotal = materials.reduce((sum, it) => sum + moneyValue(it.total || 0), 0);
  const shippingCost = normalizeAbnormalMoneyToSafe(purchase?.shippingCost ?? purchase?.ongkir ?? 0, LIMITS.MAX_MONEY_INPUT);
  const total = subtotal + shippingCost;

  if (subtotal <= 0 || total <= 0) {
    throw new Error("Data supplier tidak cukup untuk diperbaiki otomatis. Edit manual di tab Supplier.");
  }

  return {
    materials,
    material: materials.map((it) => it.name).join(", "),
    qty: materials.map((it) => `${it.qty} ${it.unit}`).join(", "),
    category: materials[0]?.category || purchase?.category || "Kain",
    subtotal,
    shippingCost,
    ongkir: shippingCost,
    total,
    repairedSupplierData: true,
    repairedAt: new Date().toISOString(),
    repairNote: "Nominal supplier abnormal diperbaiki otomatis dari qty dan harga/total yang masih wajar.",
  };
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

function safeMaterialPurchaseCostInfo(material, purchases = []) {
  const materialKey = normalizeName(material?.name || "");
  if (!materialKey) return { qty: 0, total: 0, avgCost: 0 };

  let qtyTotal = 0;
  let costTotal = 0;

  (purchases || []).forEach((purchase) => {
    const rawRows = Array.isArray(purchase?.materials) && purchase.materials.length > 0
      ? purchase.materials
      : normalizePurchaseMaterials(purchase);

    rawRows.forEach((raw) => {
      let row;
      try {
        row = sanitizePurchaseMaterialForRepair(raw, purchase);
      } catch (_) {
        row = normalizePurchaseMaterials({ ...purchase, materials: [raw] })[0];
      }

      if (normalizeName(row?.name || row?.material || "") !== materialKey) return;

      const qty = numberValue(row?.qty || 0);
      const price = moneyValue(row?.pricePerUnit || row?.unitPrice || row?.hargaSatuan || 0);
      const total = moneyValue(row?.total || 0);
      const cost = total > 0 ? total : (qty > 0 && price > 0 ? Math.round(qty * price) : 0);
      const avg = qty > 0 ? Math.round(cost / qty) : 0;

      if (
        qty > 0 && qty <= LIMITS.MAX_QTY &&
        cost > 0 && isReasonableMoney(cost, LIMITS.MAX_MONEY_INPUT) &&
        avg > 0 && avg <= LIMITS.MAX_PRICE_PER_UNIT
      ) {
        qtyTotal += qty;
        costTotal += cost;
      }
    });
  });

  return {
    qty: qtyTotal,
    total: costTotal,
    avgCost: qtyTotal > 0 ? Math.round(costTotal / qtyTotal) : 0,
  };
}

function safeMaterialStockInfo(material, purchases = []) {
  const rawStock = Number(material?.stock || 0);
  const safeStock = Number.isFinite(rawStock) && rawStock >= 0 && rawStock <= LIMITS.MAX_QTY ? rawStock : 0;
  const rawAvgCost = moneyValue(material?.avgCost || 0);
  const rawTotalValue = moneyValue(material?.totalValue || 0);
  let repaired = false;
  let source = "stored";

  const purchaseCost = safeMaterialPurchaseCostInfo(material, purchases);
  let avgCost = purchaseCost.avgCost > 0 ? purchaseCost.avgCost : rawAvgCost;

  // Jika ada riwayat pembelian yang valid, gunakan itu sebagai sumber utama.
  // Ini mencegah kasus Balon dinormalisasi terlalu jauh menjadi Rp 2 ribuan/kg.
  if (purchaseCost.avgCost > 0) {
    source = "purchaseHistory";
    repaired = rawAvgCost > 0 && Math.abs(rawAvgCost - purchaseCost.avgCost) > Math.max(1000, purchaseCost.avgCost * 5);
  } else if (safeStock > 0 && rawTotalValue > 0 && isReasonableMoney(rawTotalValue, LIMITS.MAX_MONEY_INPUT)) {
    const avgFromValue = Math.round(rawTotalValue / safeStock);
    if (avgFromValue > 0 && avgFromValue <= LIMITS.MAX_PRICE_PER_UNIT && (avgCost <= 0 || hasAbnormalMoney(avgCost, LIMITS.MAX_PRICE_PER_UNIT))) {
      avgCost = avgFromValue;
      source = "storedTotalValue";
      repaired = true;
    }
  } else if (hasAbnormalMoney(avgCost, LIMITS.MAX_PRICE_PER_UNIT)) {
    // Fallback terakhir untuk data lama tanpa riwayat pembelian: turunkan sekali-sekali,
    // tapi jangan dipaksa sampai nilai stok di bawah batas kecil yang bisa membuat harga jadi tidak realistis.
    avgCost = normalizeAbnormalMoneyToSafe(avgCost, LIMITS.MAX_PRICE_PER_UNIT);
    repaired = true;
  }

  const safeAvgCost = Number.isFinite(avgCost) && avgCost >= 0 && avgCost <= LIMITS.MAX_PRICE_PER_UNIT ? Math.round(avgCost) : 0;
  const calculatedValue = Math.round(safeStock * safeAvgCost);
  const safeTotalValue = Number.isFinite(calculatedValue) && calculatedValue >= 0 ? calculatedValue : 0;

  return {
    stock: safeStock,
    avgCost: safeAvgCost,
    totalValue: safeTotalValue,
    repaired,
    source,
    purchaseQty: purchaseCost.qty,
    abnormal: repaired || rawAvgCost > LIMITS.MAX_AVG_COST || rawTotalValue > LIMITS.MAX_STOCK_VALUE_PER_MATERIAL,
  };
}

function safeMaterialStockValue(material, purchases = []) {
  return safeMaterialStockInfo(material, purchases).totalValue;
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
  return String(name ?? "").trim().toLowerCase();
}

// Strip gelar/sapaan umum untuk perbandingan nama customer
const NAME_PREFIXES = ["teh", "bu", "ibu", "pak", "bapak", "hj", "haji", "hajah", "dr", "dra", "kak", "mas", "mbak", "nn", "ny", "nyonya", "tn", "tuan"];
function stripNamePrefix(name) {
  const parts = normalizeName(name).split(/\s+/);
  const filtered = parts.filter((p) => !NAME_PREFIXES.includes(p.replace(/\./g, "")));
  return filtered.join(" ").trim() || normalizeName(name);
}

// Levenshtein distance sederhana untuk deteksi typo
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Dua nama dianggap mirip kalau setelah strip prefix, core name-nya sama atau hampir sama
function customerNamesSimilar(nameA, nameB) {
  const a = stripNamePrefix(nameA);
  const b = stripNamePrefix(nameB);
  if (!a || !b) return false;
  if (a === b) return true; // identik setelah strip
  // Fuzzy: jarak levenshtein <= 2 dan panjang minimal 4 karakter
  if (a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 2) return true;
  return false;
}

// Unit yang dipilih user adalah sumber utama.
// Whitelist nama hanya sebagai fallback saat unit tidak diisi sama sekali.
const MATERIAL_KG_NAMES = new Set(["balon", "balon sublime", "jaguard", "jaguar", "rayon", "nigiri", "embos", "florencia"]);
function normalizeMaterialUnit(name, unit) {
  if (unit === "kg") return "kg";
  if (unit === "yard") return "yard";
  if (!unit && MATERIAL_KG_NAMES.has(normalizeName(name))) return "kg";
  return "yard";
}

// Normalisasi alias nama bahan — "Balon Sublime" dianggap sama dengan "Balon"
const MATERIAL_NAME_ALIASES = {
  "balon sublime": "Balon",
  "jaguar": "Jaguard",
  "katun rayon": "Rayon Katun",
  "rayonkatun": "Rayon Katun",
  "katunrayon": "Rayon Katun",
};
function normalizeMaterialAlias(name) {
  const key = normalizeName(name);
  const compactK = key.replace(/\s+/g, "");
  return MATERIAL_NAME_ALIASES[key] || MATERIAL_NAME_ALIASES[compactK] || name;
}

function capitalizeWords(name) {
  return String(name ?? "").trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function orderInvoiceDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safeDate.getFullYear()}${String(safeDate.getMonth() + 1).padStart(2, "0")}${String(safeDate.getDate()).padStart(2, "0")}`;
}

async function generateInvoice() {
  // Nomor invoice harus dibuat di dalam transaction supaya aman saat 2 admin
  // menyimpan pesanan di waktu bersamaan. Counter dipisah per tanggal.
  const dateKey = orderInvoiceDateKey();
  const counterRef = doc(db, "appCounters", "orderInvoice");

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const data = snap.exists() ? snap.data() : {};
    const lastByDate = data?.lastByDate && typeof data.lastByDate === "object" ? data.lastByDate : {};
    const current = Number(lastByDate[dateKey] || 0);
    const next = Number.isFinite(current) && current >= 0 ? Math.floor(current) + 1 : 1;
    const invoice = `ORD-${dateKey}-${String(next).padStart(4, "0")}`;

    transaction.set(counterRef, {
      lastDate: dateKey,
      lastNumber: next,
      lastInvoice: invoice,
      lastByDate: { ...lastByDate, [dateKey]: next },
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return invoice;
  });
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
    hppMaterials: [],
  };
}

function emptyHppMaterialLine() {
  return { part: "", name: "", usagePerPcs: "", unit: "yard", pricePerUnit: 0, total: 0 };
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
        total: moneyValue(purchase?.subtotal ?? purchase?.total ?? 0),
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
  const hasMaterialRows = Array.isArray(purchase?.materials) && purchase.materials.length > 0;
  const materialsTotal = purchaseMaterialsTotal(normalizePurchaseMaterials(purchase));
  const shippingCost = safeSummaryMoney(purchase?.shippingCost ?? purchase?.ongkir ?? 0);
  const savedSubtotal = safeSummaryMoney(purchase?.subtotal || 0);
  const savedTotal = safeSummaryMoney(purchase?.total || 0);

  // Sumber kebenaran supplier:
  // 1) Jika ada rincian bahan, total wajib dihitung dari rincian bahan + ongkir.
  //    Jangan pakai subtotal/total tersimpan karena bisa stale setelah edit.
  // 2) Jika data lama belum punya rincian bahan, pakai subtotal+ongkir atau total tersimpan.
  if (hasMaterialRows && materialsTotal > 0) {
    const calculated = materialsTotal + shippingCost;
    return isReasonableMoney(calculated) ? Math.round(calculated) : 0;
  }

  if (savedSubtotal > 0) {
    const calculated = savedSubtotal + shippingCost;
    return isReasonableMoney(calculated) ? Math.round(calculated) : 0;
  }

  if (savedTotal > 0) return savedTotal;

  const fallback = materialsTotal + shippingCost;
  return isReasonableMoney(fallback) ? Math.round(fallback) : 0;
}

function normalizeHppMaterials(source) {
  const rawRows = Array.isArray(source?.hppMaterials) && source.hppMaterials.length > 0
    ? source.hppMaterials
    : (Array.isArray(source?.materialsHpp) && source.materialsHpp.length > 0 ? source.materialsHpp : []);

  const rows = rawRows.map((row) => {
    const name = capitalizeWords(row?.name || row?.materialName || row?.mainMaterial || row?.bahan || "");
    const usagePerPcs = numberValue(row?.usagePerPcs ?? row?.materialQtyPerPcs ?? row?.qtyPerPcs ?? row?.qty ?? 0);
    const unit = normalizeMaterialUnit(name || row?.name || row?.materialName, row?.unit);
    const pricePerUnit = moneyValue(row?.pricePerUnit ?? row?.unitCost ?? row?.bahanPricePerUnit ?? row?.hargaPerUnit ?? row?.hargaBahan ?? 0);
    const savedTotal = moneyValue(row?.total ?? row?.subtotal ?? row?.bahanCost ?? row?.materialCost ?? 0);
    const total = pricePerUnit > 0 && usagePerPcs > 0 ? Math.round(pricePerUnit * usagePerPcs) : savedTotal;
    return {
      part: capitalizeWords(row?.part || row?.bagian || ""),
      name,
      usagePerPcs,
      unit,
      pricePerUnit,
      total,
    };
  }).filter((row) => row.name && (row.usagePerPcs > 0 || row.pricePerUnit > 0 || row.total > 0));

  if (rows.length > 0) return rows;

  const legacyName = capitalizeWords(source?.mainMaterial || source?.materialName || "");
  const legacyUsage = numberValue(source?.materialQtyPerPcs ?? source?.usagePerPcs ?? 0);
  const legacyUnit = normalizeMaterialUnit(legacyName, source?.unit);
  const legacyPrice = moneyValue(source?.bahanPricePerUnit ?? source?.pricePerUnit ?? 0);
  const legacyCost = moneyValue(source?.bahanCost ?? source?.materialCost ?? 0);
  const legacyTotal = legacyPrice > 0 && legacyUsage > 0 ? Math.round(legacyPrice * legacyUsage) : legacyCost;

  if (legacyName && (legacyUsage > 0 || legacyPrice > 0 || legacyTotal > 0)) {
    return [{ part: "Utama", name: legacyName, usagePerPcs: legacyUsage, unit: legacyUnit, pricePerUnit: legacyPrice, total: legacyTotal }];
  }

  return [];
}

function hppMaterialsCost(source) {
  return normalizeHppMaterials(source).reduce((sum, row) => sum + moneyValue(row.total || 0), 0);
}

function calculateProductHpp(product) {
  const bahanMulti = hppMaterialsCost(product);
  const bahan = bahanMulti > 0 ? bahanMulti : moneyValue(product?.bahanCost || product?.materialCost || 0);
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
  const materialRows = [];
  (items || []).forEach((it) => {
    const qty = Number(it.qty || 0);
    if (qty <= 0) return;
    const hppMaterials = normalizeHppMaterials(it);
    if (hppMaterials.length > 0) {
      hppMaterials.forEach((mat) => {
        if (!mat.name || Number(mat.usagePerPcs || 0) <= 0) return;
        materialRows.push({
          name: mat.name,
          category: "Kain",
          unit: normalizeMaterialUnit(mat.name, mat.unit),
          qty: qty * Number(mat.usagePerPcs || 0),
          total: moneyValue(mat.total || 0) * qty,
          source: mat.part ? `${it.name || "Produksi"} - ${mat.part}` : (it.name || "Produksi"),
        });
      });
      return;
    }
    if (it.mainMaterial && Number(it.materialQtyPerPcs || 0) > 0) {
      materialRows.push({
        name: it.mainMaterial,
        category: "Kain",
        unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit),
        qty: qty * Number(it.materialQtyPerPcs || 0),
        total: moneyValue(it.bahanCost || 0) * qty,
        source: it.name || "Produksi",
      });
    }
  });
  return aggregateMaterialLines(materialRows);
}

function normalizeOrderItems(order) {
  const rawItems = Array.isArray(order?.items) && order.items.length > 0
    ? order.items
    : [{ name: order?.item || "Pesanan Kerudung", qty: order?.qty || 0, price: order?.hargaPcs || 0 }];

  return rawItems.map((it) => {
    const qty = Number(it.qty || 0);
    let price = resolveSalePrice(it, {}, order);

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
      hppMaterials: normalizeHppMaterials(it),
    };
  });
}


function firstPositiveMoney(...values) {
  for (const value of values) {
    const n = moneyValue(value);
    if (n > 0) return n;
  }
  return 0;
}

function findProductMaster(productMasters = [], item = {}, base = {}) {
  if (!Array.isArray(productMasters) || productMasters.length === 0) return null;
  const ids = [
    item?.productId, item?.product_id, item?.masterProductId, item?.productMasterId,
    base?.productId, base?.product_id, base?.masterProductId, base?.productMasterId,
  ].map((x) => String(x || "").trim()).filter(Boolean);
  if (ids.length > 0) {
    const byId = productMasters.find((p) => ids.includes(String(p.id || p.productId || p.product_id || p.masterProductId || "").trim()));
    if (byId) return byId;
  }

  const names = [
    item?.name, item?.nama, item?.productName, item?.originalName,
    base?.name, base?.nama, base?.productName,
  ].map((x) => normalizeName(x || "")).filter(Boolean);
  if (names.length === 0) return null;
  return productMasters.find((p) => names.includes(normalizeName(p.name || p.nama || p.productName || ""))) || null;
}

function unitPriceFromLineTotal(source = {}, fallbackQty = 0) {
  const qty = Number(source?.shippedQty ?? source?.qtyKirim ?? source?.kirim ?? source?.qty ?? fallbackQty ?? 0);
  if (qty <= 0) return 0;
  const lineTotal = firstPositiveMoney(
    source?.lineTotal, source?.subtotal, source?.subTotal, source?.totalHarga, source?.hargaTotal,
    source?.totalJual, source?.jumlah, source?.amount, source?.total
  );
  if (lineTotal <= 0) return 0;
  return Math.round(lineTotal / qty);
}

function findMatchingOrderItem(rawOrderItems = [], item = {}, fallbackIndex = null) {
  if (!Array.isArray(rawOrderItems) || rawOrderItems.length === 0) return null;

  const itemIndex = item?.itemIndex !== undefined && item?.itemIndex !== null ? Number(item.itemIndex) : null;
  if (itemIndex !== null && rawOrderItems[itemIndex]) return rawOrderItems[itemIndex];

  const ids = [item?.productId, item?.product_id, item?.masterProductId, item?.productMasterId]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (ids.length > 0) {
    const byId = rawOrderItems.find((row) => ids.includes(String(row?.productId || row?.product_id || row?.masterProductId || row?.productMasterId || "").trim()));
    if (byId) return byId;
  }

  const itemName = normalizeName(item?.name || item?.nama || item?.productName || item?.item || "");
  if (itemName) {
    const byName = rawOrderItems.find((row) => normalizeName(row?.name || row?.nama || row?.productName || row?.item || "") === itemName);
    if (byName) return byName;
  }

  if (fallbackIndex !== null && fallbackIndex !== undefined && rawOrderItems[Number(fallbackIndex)]) return rawOrderItems[Number(fallbackIndex)];
  if (rawOrderItems.length === 1) return rawOrderItems[0];
  return null;
}

function orderSubtotalForUnitPrice(order = {}) {
  const explicitSubtotal = firstPositiveMoney(order?.subtotal, order?.subTotal, order?.itemsTotal, order?.produkTotal);
  if (explicitSubtotal > 0) return explicitSubtotal;

  const grand = firstPositiveMoney(order?.grandTotal, order?.total);
  if (grand <= 0) return 0;
  const shipping = orderShippingCost(order);
  const withoutShipping = grand - shipping;
  return withoutShipping > 0 ? withoutShipping : grand;
}

function resolveSalePrice(item = {}, base = {}, order = {}, productMasters = []) {
  const direct = firstPositiveMoney(
    item?.price, item?.harga, item?.hargaJual, item?.hargaPcs, item?.sellingPrice, item?.salePrice, item?.unitPrice, item?.hargaSatuan
  );
  if (direct > 0) return direct;

  const qtyForItem = Number(item?.shippedQty ?? item?.qtyKirim ?? item?.kirim ?? item?.qty ?? base?.qty ?? order?.qty ?? 0);
  const directFromLineTotal = unitPriceFromLineTotal(item, qtyForItem);
  if (directFromLineTotal > 0) return directFromLineTotal;

  const basePrice = firstPositiveMoney(
    base?.price, base?.harga, base?.hargaJual, base?.hargaPcs, base?.sellingPrice, base?.salePrice, base?.unitPrice, base?.hargaSatuan
  );
  if (basePrice > 0) return basePrice;

  const baseFromLineTotal = unitPriceFromLineTotal(base, base?.qty ?? qtyForItem);
  if (baseFromLineTotal > 0) return baseFromLineTotal;

  const rawOrderItems = Array.isArray(order?.items) && order.items.length > 0
    ? order.items
    : (order?.item || order?.qty || order?.hargaPcs ? [{ name: order?.item, qty: order?.qty, price: order?.hargaPcs }] : []);

  const matchedOrderItem = findMatchingOrderItem(rawOrderItems, item, item?.itemIndex);
  if (matchedOrderItem) {
    const matchedPrice = firstPositiveMoney(
      matchedOrderItem?.price, matchedOrderItem?.harga, matchedOrderItem?.hargaJual, matchedOrderItem?.hargaPcs,
      matchedOrderItem?.sellingPrice, matchedOrderItem?.salePrice, matchedOrderItem?.unitPrice, matchedOrderItem?.hargaSatuan
    );
    if (matchedPrice > 0) return matchedPrice;

    const matchedFromLineTotal = unitPriceFromLineTotal(matchedOrderItem, matchedOrderItem?.qty ?? qtyForItem);
    if (matchedFromLineTotal > 0) return matchedFromLineTotal;
  }

  const master = findProductMaster(productMasters, item, base);
  const masterPrice = firstPositiveMoney(master?.defaultPrice, master?.price, master?.hargaJual, master?.sellingPrice, master?.salePrice, master?.hargaPcs, master?.unitPrice);
  if (masterPrice > 0) return masterPrice;

  const singlePrice = rawOrderItems.length === 1
    ? firstPositiveMoney(rawOrderItems[0]?.price, rawOrderItems[0]?.harga, rawOrderItems[0]?.hargaJual, rawOrderItems[0]?.hargaPcs, order?.hargaPcs, order?.price, order?.hargaJual)
    : 0;
  if (singlePrice > 0) return singlePrice;

  const qty = Number(item?.shippedQty ?? item?.qtyKirim ?? item?.qty ?? base?.qty ?? order?.qty ?? 0);
  const orderSubtotal = orderSubtotalForUnitPrice(order);
  if (qty > 0 && orderSubtotal > 0 && rawOrderItems.length <= 1) return Math.round(orderSubtotal / qty);

  return 0;
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
  if (Array.isArray(order?.deliveries)) return order.deliveries;
  if (Array.isArray(order?.raw?.deliveries)) return order.raw.deliveries;
  return [];
}


function invoiceDateKeyFromValue(value) {
  if (!value) return "";
  const raw = String(value || "").trim();
  const m = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(raw.includes("T") ? raw : raw + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDeliveryDateKey(delivery, order) {
  // Urutan prioritas: tanggal di delivery dulu, lalu tanggalKirim order (lebih akurat dari createdAt),
  // baru fallback ke tanggal order dibuat. Ini mencegah invoice menampilkan tanggal pesanan
  // sebagai tanggal kirim untuk data lama yang delivery.date-nya kosong.
  return invoiceDateKeyFromValue(
    delivery?.date || delivery?.tanggal || delivery?.deliveredAt || delivery?.shippedAt ||
    delivery?.batchDate || delivery?.createdAt ||
    order?.tanggalKirim || order?.deliveryDate || order?.shippedAt ||
    order?.createdAt || order?.date || order?.tanggal || ""
  );
}

function deliveryItemsToInvoiceItems(order, delivery, productMasters = []) {
  const orderItems = normalizeOrderItems(order);
  const rawItems = Array.isArray(delivery?.items) ? delivery.items : [];
  if (rawItems.length === 0) return [];
  return rawItems.map((it, idx) => {
    const itemIndex = it.itemIndex !== undefined && it.itemIndex !== null ? Number(it.itemIndex) : null;
    const base = orderItemForDeliveryItem(order, it, idx) || {};
    const orderedQty = Number(it.orderedQty ?? base.qty ?? 0);
    const shippedQty = Number(it.shippedQty ?? it.qty ?? it.kirim ?? 0);

    // Prioritas harga: order item (harga saat pesanan dibuat) → delivery item → fallback lainnya
    // Ini mencegah harga delivery yang salah input menimpa harga yang sudah benar di order.
    const basePrice = firstPositiveMoney(
      base?.price, base?.harga, base?.hargaJual, base?.hargaPcs,
      base?.sellingPrice, base?.salePrice, base?.unitPrice, base?.hargaSatuan
    );
    const price = basePrice > 0
      ? basePrice
      : resolveSalePrice(it, base, order, productMasters);

    return {
      // Nama yang tampil mengikuti pesanan customer terbaru. Nama lama dari riwayat kirim
      // disimpan sebagai originalName supaya HPP masih bisa dicari bila perlu.
      name: base.name || it.name || "Produk",
      originalName: it.name || "",
      productId: base.productId || it.productId || it.product_id || it.masterProductId || "",
      itemIndex: itemIndex ?? idx,
      orderedQty,
      shippedQty,
      price,
      bahanCost: moneyValue(it.bahanCost ?? base.bahanCost ?? 0),
      hppPerPcs: moneyValue(it.hppPerPcs ?? base.hppPerPcs ?? 0),
      mainMaterial: it.mainMaterial || base.mainMaterial || "",
      materialQtyPerPcs: Number(it.materialQtyPerPcs ?? base.materialQtyPerPcs ?? 0),
      unit: it.unit || base.unit || "yard",
      note: it.note || it.keterangan || shipmentAutoNote(orderedQty, shippedQty),
    };
  }).filter((it) => Number(it.shippedQty || 0) > 0);
}

function getOrderInvoiceBatches(order, productMasters = [], lookupPrice = null) {
  const deliveries = getDeliveryHistory(order);
  if (deliveries.length > 0) {
    return deliveries.map((delivery, idx) => {
      const items = deliveryItemsToInvoiceItems(order, delivery, productMasters);
      const dateKey = getDeliveryDateKey(delivery, order);
      const total = deliveryItemsTotal(items, lookupPrice);
      return {
        id: delivery.id || delivery.deliveryId || `${order?.id || order?.invoice || "order"}-${dateKey || "no-date"}-${idx}`,
        order,
        delivery,
        index: idx,
        dateKey,
        items,
        total,
      };
    }).filter((batch) => batch.items.length > 0 || batch.total > 0);
  }

  const fallbackItems = normalizeShipmentItems(order, productMasters).filter((it) => Number(it.shippedQty || 0) > 0);
  if (fallbackItems.length === 0) return [];
  const dateKey = invoiceDateKeyFromValue(order?.deliveryDate || order?.shippedAt || order?.tanggalKirim || order?.createdAt || order?.date || order?.tanggal || "");
  return [{
    id: `${order?.id || order?.invoice || "order"}-${dateKey || "fallback"}`,
    order,
    delivery: null,
    index: 0,
    dateKey,
    items: fallbackItems,
    total: shipmentItemsTotal(fallbackItems, lookupPrice),
  }];
}

function isDateKeyInRange(dateKey, startDate = "", endDate = "") {
  const hasDateFilter = Boolean(startDate || endDate);
  const s = dateSerial(dateKey || "");
  if (!s) return !hasDateFilter;
  if (startDate && s < dateSerial(startDate)) return false;
  if (endDate && s > dateSerial(endDate)) return false;
  return true;
}

function totalDeliveredQtyForItem(order, itemIndex, itemName) {
  return getDeliveryHistory(order).reduce((sum, delivery) => {
    const items = delivery.items || [];
    // Prioritas 1: cocokkan berdasarkan nama — itemIndex dari Gallery Produksi bisa salah urutan
    if (itemName) {
      const byName = items.find((it) => normalizeName(it.name || "") === normalizeName(itemName));
      if (byName) return sum + Number(byName.qty ?? byName.shippedQty ?? 0);
    }
    // Prioritas 2: itemIndex sebagai fallback untuk data lama tanpa nama
    const byIndex = items.find((it) => it.itemIndex !== undefined && it.itemIndex !== null && Number(it.itemIndex) === itemIndex);
    if (byIndex) return sum + Number(byIndex.qty ?? byIndex.shippedQty ?? 0);
    // Prioritas 3: posisi array untuk data lama tanpa itemIndex
    const legacyByPosition = items[itemIndex];
    if (legacyByPosition && (legacyByPosition.itemIndex === undefined || legacyByPosition.itemIndex === null)) {
      return sum + Number(legacyByPosition.qty ?? legacyByPosition.shippedQty ?? 0);
    }
    return sum;
  }, 0);
}

function orderItemForDeliveryItem(order, deliveryItem, fallbackIndex = null) {
  const orderItems = normalizeOrderItems(order);
  // Prioritas 1: cocokkan berdasarkan nama — lebih reliable karena itemIndex bisa beda urutan
  const byName = orderItems.find((x) => normalizeName(x.name) === normalizeName(deliveryItem?.name));
  if (byName) return byName;
  // Prioritas 2: itemIndex sebagai fallback kalau nama tidak ketemu
  const itemIndex = deliveryItem?.itemIndex !== undefined && deliveryItem?.itemIndex !== null ? Number(deliveryItem.itemIndex) : null;
  if (itemIndex !== null && orderItems[itemIndex]) return orderItems[itemIndex];
  if (fallbackIndex !== null && fallbackIndex !== undefined && orderItems[Number(fallbackIndex)]) return orderItems[Number(fallbackIndex)];
  if (orderItems.length === 1) return orderItems[0];
  return null;
}

function normalizeShipmentItems(order, productMasters = []) {
  const orderItems = normalizeOrderItems(order);
  const deliveries = getDeliveryHistory(order);

  if (deliveries.length > 0) {
    return orderItems.map((it, idx) => {
      const shippedQty = totalDeliveredQtyForItem(order, idx, it.name);
      return {
        name: it.name,
        productId: it.productId || it.product_id || it.masterProductId || "",
        category: it.category || "",
        orderedQty: Number(it.qty || 0),
        shippedQty,
        price: resolveSalePrice(it, it, order, productMasters),
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
      productId: it.productId || it.product_id || it.masterProductId || "",
      category: it.category || "",
      orderedQty: Number(it.qty || 0),
      shippedQty: 0,
      price: resolveSalePrice(it, it, order, productMasters),
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
      productId: it.productId || it.product_id || it.masterProductId || base.productId || base.product_id || base.masterProductId || "",
      category: it.category || base.category || "",
      orderedQty,
      shippedQty,
      price: firstPositiveMoney(base?.price, base?.harga, base?.hargaJual, base?.hargaPcs, base?.sellingPrice, base?.salePrice, base?.unitPrice, base?.hargaSatuan) || resolveSalePrice(it, base, order, productMasters),
      bahanCost: moneyValue(it.bahanCost ?? base.bahanCost ?? 0),
      hppPerPcs: moneyValue(it.hppPerPcs ?? base.hppPerPcs ?? 0),
      mainMaterial: it.mainMaterial || base.mainMaterial || "",
      materialQtyPerPcs: Number(it.materialQtyPerPcs ?? base.materialQtyPerPcs ?? 0),
      unit: it.unit || base.unit || "yard",
      note: it.note || it.keterangan || shipmentAutoNote(orderedQty, shippedQty),
    };
  });
}

function shipmentItemsTotal(items, lookupPrice = null) {
  return (items || []).reduce((sum, it) => {
    let price = moneyValue(it.price || 0);
    if (!price && lookupPrice) price = lookupPrice(it.name || it.nama || "");
    return sum + Number(it.shippedQty || 0) * price;
  }, 0);
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

function deliveryItemsTotal(items, lookupPrice = null) {
  // Invoice batch harus memakai qty yang dikirim pada batch/tanggal itu.
  // Data lama bisa memakai `qty`, sedangkan data baru dari App Produksi memakai
  // `shippedQty` / `qtyKirim`. Tanpa fallback ini, nota gabungan resmi dari
  // shipment_batches bisa tampil dengan total Rp 0 walaupun itemnya ada.
  // lookupPrice: opsional, dipakai sebagai fallback jika harga item = 0 (misal dari master produk).
  return (items || []).reduce((sum, it) => {
    const qty = Number(it.shippedQty ?? it.qtyKirim ?? it.qty ?? it.kirim ?? 0);
    let price = moneyValue(it.price || it.harga || 0);
    if (!price && lookupPrice) price = lookupPrice(it.name || it.nama || "");
    return sum + qty * price;
  }, 0);
}

function orderShippingCost(order) {
  // Ongkir HANYA dari order GK (diisi saat buat pesanan di Gallery Kerudung).
  // Ongkir dari order.deliveries TIDAK dibaca karena itu ongkir GP yang bisa
  // berupa pembagian rata dari batch multi-pesanan — tidak akurat untuk tagihan per pesanan.
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
  if (order?.shortShipmentClosed === true) return "Ditutup Kurang Kirim";
  const items = normalizeShipmentItems(order);
  const totalOrdered = items.reduce((sum, it) => sum + Number(it.orderedQty || 0), 0);
  const totalShipped = items.reduce((sum, it) => sum + Number(it.shippedQty || 0), 0);
  if (totalShipped <= 0) return "Proses";
  if (totalOrdered > 0 && totalShipped < totalOrdered) return "Dikirim Sebagian";
  // App Kerudung hanya membaca realisasi kirim dari App Produksi.
  // Kelebihan kirim adalah kondisi bisnis valid, bukan bug/penolakan.
  if (totalOrdered > 0 && totalShipped > totalOrdered) return "Kelebihan Kirim";
  return "Selesai";
}

function isFinalDeliveryStatus(status) {
  return ["Selesai", "Kelebihan Kirim", "Ditutup Kurang Kirim", "Lunas"].includes(String(status || ""));
}

export {
  rupiah, parseMoney, moneyValue, moneySum,
  LIMITS, SAFE_SUMMARY_MAX,
  isReasonableMoney, safeSummaryMoney, hasAbnormalMoney, normalizeAbnormalMoneyToSafe,
  sanitizePurchaseMaterialForRepair, purchaseHasAbnormalData, buildSupplierRepairPayload,
  assertReasonableMoney, assertReasonableQty,
  safeMaterialPurchaseCostInfo, safeMaterialStockInfo, safeMaterialStockValue, validateMaterialPayload,
  numberValue, todayStr, dateSerial, getRowDate, sortOldestBottom, sortOldestTop, sortPurchaseNewestFirst,
  getDateValue, samePeriod,
  normalizeName, stripNamePrefix, levenshtein, customerNamesSimilar,
  normalizeMaterialUnit, normalizeMaterialAlias, capitalizeWords,
  orderInvoiceDateKey, generateInvoice,
  emptyOrderItem, emptyHppMaterialLine, emptyPurchaseMaterial,
  normalizePurchaseMaterials, purchaseMaterialTotal, purchaseMaterialsTotal, purchaseInvoiceTotal,
  normalizeHppMaterials, hppMaterialsCost, calculateProductHpp, hppItemsTotal, orderItemsHppTotal,
  purchaseMaterialsSummary, normalizeMaterialKey, materialLineKey, aggregateMaterialLines,
  buildMaterialUsageFromDeliveryItems, normalizeOrderItems,
  firstPositiveMoney, findProductMaster, unitPriceFromLineTotal, findMatchingOrderItem,
  orderSubtotalForUnitPrice, resolveSalePrice, orderItemsTotal, orderItemsSummary, shipmentAutoNote,
  getDeliveryHistory, invoiceDateKeyFromValue, getDeliveryDateKey, deliveryItemsToInvoiceItems,
  getOrderInvoiceBatches, isDateKeyInRange, totalDeliveredQtyForItem, orderItemForDeliveryItem,
  normalizeShipmentItems, shipmentItemsTotal, shipmentItemsHppTotal, billableOrderHppTotal,
  deliveryItemsTotal, orderShippingCost, orderGrandTotal, billableOrderTotal,
  orderDeliveryStatus, isFinalDeliveryStatus,
};
