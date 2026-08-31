// Gallery Kerudung - scan manual & repair data produk 2026-06-13
import SimpleModal from "./components/SimpleModal";
import StatusBadge from "./components/StatusBadge";
import Card from "./components/Card";
import Input from "./components/Input";
import Button from "./components/Button";
import Select from "./components/Select";
import DatePicker, { BULAN_FULL } from "./components/DatePicker";
import KasbonCard from "./components/KasbonCard";
import TabBar from "./components/TabBar";
import InvoiceModal from "./components/InvoiceModal";
import GrafikKas from "./components/GrafikKas";
import GrafikPesanan from "./components/GrafikPesanan";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "./firebase";
import {
  collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc, doc, runTransaction, writeBatch,
} from "firebase/firestore";
import "./App.css";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";

// Firebase deduplicates getAuth() calls secara internal sehingga selalu
// mengembalikan instance yang sama. Ini aman dan tidak memerlukan import dinamis.
const auth = getAuth();
const provider = new GoogleAuthProvider();
const ALLOWED_EMAILS = ["angx89@gmail.com", "astriapriani.aa@gmail.com"];

const KASBON_COLLECTION = "kasbon_pegawai"; // collection bersama dengan Gallery Produksi

// Mode hemat reads Firestore:
// - Cache lokal mencegah app membaca ulang semua collection saat halaman direfresh berulang.
// - Realtime listener dimatikan; data tetap bisa diperbarui lewat tombol Refresh Data
//   dan otomatis sesudah simpan/edit/hapus.
const FIRESTORE_CACHE_KEY = "gk_firestore_cache_v2";
const FIRESTORE_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam — disamakan dengan gallery-produksi untuk hemat kuota Firestore.
// Data milik user sendiri tetap langsung update setelah simpan/edit/hapus (lihat scheduleRefresh/refreshCollections),
// TTL ini cuma memengaruhi seberapa cepat perubahan dari staf/device lain terlihat setelah buka app lagi.
const FIRESTORE_REFRESH_DEBOUNCE_MS = 700;


// ─── Helpers ────────────────────────────────────────────────────────────────
// Dipindah ke ./utils.js (langkah 1 refactor bertahap) — lihat file itu untuk isinya.
import {
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
  orderDeliveryStatus, isFinalDeliveryStatus, loadPdfTools,
} from "./utils";


// ─── Main App ────────────────────────────────────────────────────────────────
export default function GalleryKerudungApp() {
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
  const [shipmentBatches, setShipmentBatches] = useState([]);
  const [payrollExpenses, setPayrollExpenses] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [transfersOut, setTransfersOut] = useState([]);
  const [materialsStock, setMaterialsStock] = useState([]);
  const [productMasters, setProductMasters] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [returns, setReturns] = useState([]); // catatan retur barang dari customer
  const [editData, setEditData] = useState(null);
  const [search, setSearch] = useState("");
  const [filterTransferInName, setFilterTransferInName] = useState("semua");
  const [filterTransferOutName, setFilterTransferOutName] = useState("semua");
  const [rekapStartDate, setRekapStartDate] = useState("");
  const [rekapEndDate, setRekapEndDate] = useState("");
  const [rekapDateBasis, setRekapDateBasis] = useState("kirim"); // "kirim" = tanggal kirim/realisasi, "order" = tanggal order
  const [invoiceStartDate, setInvoiceStartDate] = useState("");
  const [invoiceEndDate, setInvoiceEndDate] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("semua");
  const [loading, setLoading] = useState(true);
  const [refreshingData, setRefreshingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [filterOrder, setFilterOrder] = useState("semua");
  const [productQuickFilter, setProductQuickFilter] = useState("semua");
  const [sortOrder, setSortOrder] = useState("terbaru");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetSupplier, setConfirmResetSupplier] = useState(false); // step 1
  const [confirmResetSupplier2, setConfirmResetSupplier2] = useState(false); // step 2 (double confirm)
  const [rekapConfirm, setRekapConfirm] = useState(null);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [kirimModal, setKirimModal] = useState(null);
  const [tanggalKirim, setTanggalKirim] = useState(todayStr());
  const [kirimItems, setKirimItems] = useState([]);
  const [returModal, setReturModal] = useState(null); // order yang sedang diinput retur-nya
  const [returForm, setReturForm] = useState({ itemIndex: 0, qty: "", alasan: "", kondisi: "bisa_dijual_lagi", catatan: "", tanggal: todayStr() });
  const [returFilter, setReturFilter] = useState("semua"); // filter tab Retur: semua | siap_dijual | rugi
  const [returJualPending, setReturJualPending] = useState(null); // id retur yang sedang dibuatkan pesanan baru (auto tandai sudah terjual setelah simpan)
  const [invoiceCustomer, setInvoiceCustomer] = useState(null);
  const [dashboardDetail, setDashboardDetail] = useState(null);
  const [issueCenterOpen, setIssueCenterOpen] = useState(false);
  const [issueCenterFilter, setIssueCenterFilter] = useState("semua");
  const [ignoredIssues, setIgnoredIssues] = useState([]); // array of {id: docId, issueId} — docId disimpan agar unignore tidak perlu getDocs
  const [repairingSupplierData, setRepairingSupplierData] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [kasbonList, setKasbonList] = useState([]);
  const [kasbonForm, setKasbonForm] = useState({ employeeName: "", tanggal: "", jumlah: "", keterangan: "" });
  const [masterPekerja, setMasterPekerja] = useState([]); // daftar nama pekerja dari Firestore master_pekerja
  const [showKelolaPekerja, setShowKelolaPekerja] = useState(false);
  const [namaPekerjaInput, setNamaPekerjaInput] = useState("");
  const backUiRef = useRef({});
  const lastBackPressRef = useRef(0);
  const refreshTimerRef = useRef(null);
  const pendingRefreshRef = useRef(null);

  const [orderForm, setOrderForm] = useState({
    date: todayStr(), customer: "", phone: "", items: [emptyOrderItem()], shippingCost: 0, dp: 0,
  });
  const [orderDraftLoaded, setOrderDraftLoaded] = useState(false);

  // ── Repair produk ──
  const [repairModal, setRepairModal] = useState(null);
  const [repairIssues, setRepairIssues] = useState({});
  const [repairPriceEdits, setRepairPriceEdits] = useState({});
  const [repairScanned, setRepairScanned] = useState(false);

  // ── Repair qty pengiriman terbalik ──
  const [repairQtyModal, setRepairQtyModal] = useState(false);
  const [repairQtyIssues, setRepairQtyIssues] = useState([]);
  const [repairQtyScanning, setRepairQtyScanning] = useState(false);

  // ── Edit qty delivery langsung ──
  const [editDeliveryModal, setEditDeliveryModal] = useState(null); // { order, deliveryIdx, items }
  const [editDeliveryItems, setEditDeliveryItems] = useState([]);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");

  const [purchaseForm, setPurchaseForm] = useState({
    date: todayStr(), supplier: "", materials: [emptyPurchaseMaterial()], shippingCost: 0, dp: 0,
  });
  const emptyProductForm = {
    imageUrl: "", name: "", category: "", defaultPrice: 0, mainMaterial: "", materialQtyPerPcs: "",
    unit: "yard", bahanPricePerUnit: 0, bahanCost: 0, hppMaterials: [emptyHppMaterialLine()], productionCost: 0, distributionCost: 0, otherCost: 0, isActive: true,
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

  // ── Scan semua orders untuk temukan item yang namanya tidak cocok master ──
  // Bermasalah HANYA jika nama beda kapital/spasi dari master.
  // Harga TIDAK dicek — harga per pesanan adalah harga yang disepakati saat itu.
  function scanRepairIssues(ordersData, mastersData) {
    if (!Array.isArray(ordersData) || !Array.isArray(mastersData) || mastersData.length === 0) return {};
    const result = {}; // { masterProductId: [issue, ...] }

    const addIssue = (key, issue) => {
      if (!result[key]) result[key] = [];
      const dupKey = `${issue.orderId}_${issue.source}_${issue.deliveryIdx}_${issue.itemIdx}`;
      const already = result[key].some(
        (x) => `${x.orderId}_${x.source}_${x.deliveryIdx}_${x.itemIdx}` === dupKey
      );
      if (!already) result[key].push(issue);
    };

    ordersData.forEach((order) => {
      const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
      const orderItems = Array.isArray(order.items) ? order.items : [];

      // Scan di deliveries
      deliveries.forEach((delivery, deliveryIdx) => {
        const dItems = Array.isArray(delivery.items) ? delivery.items : [];
        dItems.forEach((dItem, itemIdx) => {
          const rawName = dItem.name || dItem.nama || "";
          if (!rawName) return;
          const master = mastersData.find((p) => normalizeName(p.name || "") === normalizeName(rawName));
          if (!master) return; // tidak dikenali di master → lewati
          if ((dItem.name || "") === master.name) return; // nama sudah persis benar → skip
          // Nama beda kapital/spasi → bermasalah
          // Sertakan harga dari order.items untuk koreksi otomatis di delivery
          const orderItems = Array.isArray(order.items) ? order.items : [];
          const matchedOrderItem = orderItems.find((oi) =>
            normalizeName(oi.name || "") === normalizeName(rawName)
          ) || orderItems[itemIdx] || {};
          const orderItemPrice = moneyValue(matchedOrderItem.price || matchedOrderItem.harga || 0);

          addIssue(master.id, {
            orderId: order.id,
            orderDoc: order,
            deliveryIdx,
            itemIdx,
            source: "delivery",
            customer: order.customer || order.customerName || "-",
            date: delivery.date || delivery.tanggal || order.tanggalKirim || order.date || "-",
            oldName: dItem.name || rawName,
            oldPrice: moneyValue(dItem.price || dItem.harga || 0),
            orderItemPrice,
            newName: master.name,
            shippedQty: Number(dItem.shippedQty || dItem.qty || 0),
          });
        });
      });

      // Scan di order.items
      orderItems.forEach((oItem, itemIdx) => {
        const rawName = oItem.name || oItem.nama || "";
        if (!rawName) return;
        const master = mastersData.find((p) => normalizeName(p.name || "") === normalizeName(rawName));
        if (!master) return;
        if ((oItem.name || "") === master.name) return;
        addIssue(master.id, {
          orderId: order.id,
          orderDoc: order,
          deliveryIdx: null,
          itemIdx,
          source: "orderItem",
          customer: order.customer || order.customerName || "-",
          date: order.date || order.tanggal || order.createdAt || "-",
          oldName: oItem.name || rawName,
          oldPrice: moneyValue(oItem.price || oItem.harga || 0),
          newName: master.name,
          shippedQty: Number(oItem.qty || 0),
        });
      });
    });

    return result;
  }

  // Scan manual — dipanggil saat user klik tombol Scan Data
  function jalankanScan() {
    if (!orders.length || !productMasters.length) {
      alert("Data orders atau produk belum dimuat. Coba Refresh Data dulu.");
      return;
    }
    const issues = scanRepairIssues(orders, productMasters);
    setRepairIssues(issues);
    setRepairScanned(true);
    const totalIssues = Object.values(issues).reduce((sum, arr) => sum + arr.length, 0);
    const totalProduk = Object.keys(issues).length;
    if (totalIssues === 0) {
      alert("✅ Semua data produk sudah benar. Tidak ada yang perlu diperbaiki.");
    } else {
      alert(`⚠️ Ditemukan ${totalIssues} data bermasalah di ${totalProduk} produk. Lihat indikator ⚠️ di kartu produk.`);
    }
  }

  // ── Scan qty pengiriman terbalik dari Gallery Produksi ──
  async function scanRepairQtyPengiriman() {
    setRepairQtyScanning(true);
    setRepairQtyIssues([]);
    try {
      const issues = [];
      orders.forEach((order) => {
        const rawOrder = order.raw || order;
        const deliveries = getDeliveryHistory(order);
        const orderItems = normalizeOrderItems(order);
        if (orderItems.length < 2) return;

        deliveries.forEach((delivery, deliveryIdx) => {
          const dItems = Array.isArray(delivery.items) ? delivery.items : [];
          if (dItems.length < 2) return;

          const mismatches = [];
          dItems.forEach((dItem) => {
            const dName = normalizeName(dItem.name || "");
            const dQty = Number(dItem.shippedQty || dItem.qty || 0);
            if (!dName || dQty <= 0) return;

            const matchedOrderItem = orderItems.find((oi) => normalizeName(oi.name || "") === dName);
            if (!matchedOrderItem) return;

            const oQty = Number(matchedOrderItem.qty || 0);
            if (oQty <= 0) return;

            if (dQty !== oQty) {
              mismatches.push({ name: dItem.name || "-", deliveryQty: dQty, orderQty: oQty });
            }
          });

          if (mismatches.length === 0) return;

          const correctItems = dItems.map((dItem) => {
            const matched = orderItems.find((oi) => normalizeName(oi.name || "") === normalizeName(dItem.name || ""));
            return { name: dItem.name || "-", qty: Number(matched?.qty || dItem.shippedQty || dItem.qty || 0) };
          });

          issues.push({
            orderId: order.id, orderDoc: rawOrder, deliveryIdx,
            customer: rawOrder.customer || "-",
            date: delivery.date || delivery.tanggalKirim || "-",
            currentItems: dItems.map((it) => ({ name: it.name || "-", qty: Number(it.shippedQty || it.qty || 0) })),
            correctItems, mismatches,
          });
        });
      });

      setRepairQtyIssues(issues);
      setRepairQtyModal(true);


    } catch (err) {
      alert("Gagal scan: " + err.message);
    } finally {
      setRepairQtyScanning(false);
    }
  }

  async function runRepairQtyPengiriman() {
    if (repairQtyIssues.length === 0) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      // Group by orderId
      const byOrder = {};
      repairQtyIssues.forEach((issue) => {
        if (!byOrder[issue.orderId]) byOrder[issue.orderId] = { orderDoc: issue.orderDoc, issues: [] };
        byOrder[issue.orderId].issues.push(issue);
      });

      Object.entries(byOrder).forEach(([orderId, { orderDoc, issues }]) => {
        const deliveriesSource = Array.isArray(orderDoc.deliveries) ? orderDoc.deliveries
          : Array.isArray(orderDoc.raw?.deliveries) ? orderDoc.raw.deliveries : [];
        const newDeliveries = JSON.parse(JSON.stringify(deliveriesSource));

        issues.forEach((issue) => {
          const delivery = newDeliveries[issue.deliveryIdx];
          if (!delivery) return;

          // Koreksi qty setiap item berdasarkan nama dari shipment (sumber kebenaran)
          if (Array.isArray(delivery.items)) {
            delivery.items = delivery.items.map((dItem) => {
              const correct = issue.correctItems.find(
                (ci) => normalizeName(ci.name) === normalizeName(dItem.name || "")
              );
              if (!correct) return dItem;
              return {
                ...dItem,
                shippedQty: correct.qty,
                qty: correct.qty,
              };
            });
          }
        });

        batch.update(doc(db, "orders", orderId), {
          deliveries: newDeliveries,
          updatedAt: new Date().toISOString(),
        });
      });

      await batch.commit();

      // Refresh via refreshCollections agar cache juga diperbarui
      await refreshCollections("orders");
      setRepairQtyModal(false);
      setRepairQtyIssues([]);
      alert(`✅ ${repairQtyIssues.length} delivery berhasil dikoreksi.`);
    } catch (err) {
      alert("Gagal repair: " + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  // Hitung total issue per produk
  function getIssueCountForProduct(productId) {
    return (repairIssues[productId] || []).length;
  }

  // Jalankan repair untuk satu produk
  async function runRepairForProduct(productId) {
    const issues = repairIssues[productId] || [];
    if (issues.length === 0) return;
    setIsSaving(true);
    try {
      // Group issues by orderId agar update per dokumen order
      const byOrder = {};
      issues.forEach((issue) => {
        if (!byOrder[issue.orderId]) byOrder[issue.orderId] = { orderDoc: issue.orderDoc, issues: [] };
        byOrder[issue.orderId].issues.push(issue);
      });

      const batch = writeBatch(db);

      Object.entries(byOrder).forEach(([orderId, { orderDoc, issues: orderIssues }]) => {
        // Clone deliveries dan items dari order
        const newDeliveries = JSON.parse(JSON.stringify(Array.isArray(orderDoc.deliveries) ? orderDoc.deliveries : []));
        const newItems = JSON.parse(JSON.stringify(Array.isArray(orderDoc.items) ? orderDoc.items : []));

        orderIssues.forEach((issue) => {
          if (issue.source === "delivery" && issue.deliveryIdx !== null) {
            const dItem = newDeliveries[issue.deliveryIdx]?.items?.[issue.itemIdx];
            if (dItem) {
              dItem.name = issue.newName;
              // Koreksi harga otomatis dari order.items (harga saat pesanan dibuat)
              if (issue.orderItemPrice > 0) dItem.price = issue.orderItemPrice;
            }
          } else if (issue.source === "orderItem") {
            const oItem = newItems[issue.itemIdx];
            if (oItem) {
              oItem.name = issue.newName;
              // harga order.items sudah benar, tidak perlu diubah
            }
          }
        });

        const orderRef = doc(db, "orders", orderId);
        const patch = {};
        if (newDeliveries.length > 0) patch.deliveries = newDeliveries;
        if (newItems.length > 0) patch.items = newItems;
        patch.updatedAt = new Date().toISOString();
        batch.update(orderRef, patch);
      });

      await batch.commit();

      // Refresh via refreshCollections agar cache juga diperbarui
      await refreshCollections("orders");
      setRepairModal(null);
      setRepairPriceEdits({});
      // Scan ulang dijalankan via useEffect saat orders state berubah (lihat scanRepairIssues useEffect)
      alert(`✅ ${issues.length} data berhasil diperbaiki.`);
    } catch (err) {
      alert("Gagal repair: " + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEditDelivery() {
    if (!editDeliveryModal) return;
    const { order, deliveryIdx } = editDeliveryModal;
    setIsSaving(true);
    try {
      const rawOrder = order.raw || order;
      const deliveries = JSON.parse(JSON.stringify(
        Array.isArray(rawOrder.deliveries) ? rawOrder.deliveries :
        Array.isArray(order.deliveries) ? order.deliveries : []
      ));
      if (!deliveries[deliveryIdx]) throw new Error("Delivery tidak ditemukan.");

      // Update qty dan tanggal
      const finalDate = editDeliveryDate || todayStr();
      deliveries[deliveryIdx].items = editDeliveryItems.map((it) => ({
        ...it,
        qty: Number(it.qty || 0),
        shippedQty: Number(it.qty || 0),
      }));
      deliveries[deliveryIdx].date = finalDate;

      // Hitung ulang shippedItems ringkasan
      const orderItems = normalizeOrderItems(order);
      const shippedItems = orderItems.map((base, idx) => {
        const totalShipped = deliveries.reduce((sum, d) => {
          const found = (d.items || []).find((it) =>
            normalizeName(it.name || "") === normalizeName(base.name || "")
          );
          return sum + Number(found?.shippedQty || found?.qty || 0);
        }, 0);
        return {
          name: base.name,
          orderedQty: Number(base.qty || 0),
          shippedQty: totalShipped,
          price: moneyValue(base.price || 0),
        };
      });

      await updateDoc(doc(db, "orders", order.id), {
        deliveries,
        shippedItems,
        tanggalKirim: finalDate,
        updatedAt: new Date().toISOString(),
      });

      await refreshCollections("orders");
      setEditDeliveryModal(null);
      setEditDeliveryItems([]);
      setEditDeliveryDate("");
      alert("✅ Qty pengiriman berhasil dikoreksi.");
    } catch (err) {
      alert("Gagal: " + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  const [expenseForm, setExpenseForm] = useState({ date: todayStr(), category: "", note: "", amount: 0 });
  const [orderPayForm, setOrderPayForm] = useState({ customer: "", date: todayStr(), bank: "", note: "", amount: 0 });
  const [supplierPayForm, setSupplierPayForm] = useState({ supplier: "", date: todayStr(), note: "", amount: 0 });

  const loadedRef = useRef({ orders: false, shipmentBatches: false, purchases: false, expenses: false, materials: false, products: false, productCategories: false, transfers: false, transfersOut: false, payroll: false, kasbon: false, masterPekerja: false });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gk_audit_logs") || "[]");
      setAuditLogs(Array.isArray(saved) ? saved.slice(0, 50) : []);
    } catch (e) { setAuditLogs([]); }
  }, []);

  // Sync state ke backUiRef agar back button guard selalu punya state terbaru
  useEffect(() => {
    backUiRef.current = {
      tab,
      modal,
      confirmDelete,
      confirmResetSupplier,
      confirmResetSupplier2,
      kirimModal,
      invoiceCustomer,
      dashboardDetail,
      issueCenterOpen,
      rekapConfirm,
      search,
    };
  });

  // Back button guard — tombol back HP menutup modal dulu sebelum keluar
  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    const pushGuardState = () => {
      window.history.pushState({ galleryKerudungBackGuard: true }, "", window.location.href);
    };

    pushGuardState();

    const closeTopLayer = () => {
      const ui = backUiRef.current || {};
      if (ui.confirmDelete) { setConfirmDelete(null); return true; }
      if (ui.confirmResetSupplier2) { setConfirmResetSupplier2(false); return true; }
      if (ui.confirmResetSupplier) { setConfirmResetSupplier(false); return true; }
      if (ui.rekapConfirm) { setRekapConfirm(null); return true; }
      if (ui.invoiceCustomer) { setInvoiceCustomer(null); return true; }
      if (ui.kirimModal) { setKirimModal(null); return true; }
      if (ui.dashboardDetail) { setDashboardDetail(null); return true; }
      if (ui.issueCenterOpen) { setIssueCenterOpen(false); return true; }
      if (ui.modal) { setModal(null); return true; }
      if (ui.search) { setSearch(""); return true; }
      if (ui.tab && ui.tab !== "dashboard") { setTab("dashboard"); return true; }
      return false;
    };

    const onPopState = () => {
      if (closeTopLayer()) {
        pushGuardState();
        return;
      }
      const now = Date.now();
      if (now - lastBackPressRef.current < 1600) {
        window.removeEventListener("popstate", onPopState);
        window.history.back();
        return;
      }
      lastBackPressRef.current = now;
      // Toast tidak ada di Kerudung, cukup push guard ulang
      pushGuardState();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [user]);

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

  async function loadFirestoreData({ showLoading = false, useCache = true } = {}) {
    if (!user) return;
    if (showLoading) setLoading(true);
    else setRefreshingData(true);
    setFirestoreError("");

    const cacheKey = `${FIRESTORE_CACHE_KEY}_${user?.email || "anon"}`;
    const applyRows = (rows = {}) => {
      setOrders(Array.isArray(rows.ordersRows) ? rows.ordersRows : []);
      setShipmentBatches(Array.isArray(rows.shipmentBatchRows) ? rows.shipmentBatchRows : []);
      setPurchases(Array.isArray(rows.purchaseRows) ? rows.purchaseRows : []);
      setExpenses(Array.isArray(rows.expenseRows) ? rows.expenseRows : []);
      setMaterialsStock(Array.isArray(rows.materialRows) ? rows.materialRows : []);
      setProductMasters(Array.isArray(rows.productRows) ? rows.productRows : []);
      setProductCategories(Array.isArray(rows.productCategoryRows) ? rows.productCategoryRows : []);
      setTransfers(Array.isArray(rows.transferRows) ? rows.transferRows : []);
      setTransfersOut(Array.isArray(rows.transferOutRows) ? rows.transferOutRows : []);
      setReturns(Array.isArray(rows.returnRows) ? rows.returnRows : []);
      setPayrollExpenses(Array.isArray(rows.payrollRows) ? rows.payrollRows : []);
      setKasbonList(Array.isArray(rows.kasbonRows) ? rows.kasbonRows : []);
      setMasterPekerja(Array.isArray(rows.masterPekerjaRows) ? rows.masterPekerjaRows : []);
      setIgnoredIssues(
        (Array.isArray(rows.ignoredIssueRows) ? rows.ignoredIssueRows : [])
          .filter((r) => r.issueId)
          .map((r) => ({ id: r.id, issueId: r.issueId }))
      );
      loadedRef.current = {
        orders: true,
        shipmentBatches: true,
        purchases: true,
        expenses: true,
        materials: true,
        products: true,
        productCategories: true,
        transfers: true,
        transfersOut: true,
        returns: true,
        payroll: true,
        kasbon: true,
        masterPekerja: true,
      };
    };

    try {
      const errors = [];
      const readCollection = async (collectionName, label, optional = false) => {
        try {
          const snap = await getDocs(collection(db, collectionName));
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (err) {
          console.error(`${label}:`, err);
          if (!optional) errors.push(`${label}: ${err?.message || "Gagal memuat data"}`);
          return [];
        }
      };

      // Fetch payroll/kasbon/master_pekerja di background dan merge ke cache + state.
      // Dipanggil baik dari path cache-hit maupun path fetch penuh, supaya cache yang
      // belum sempat berisi data secondary (mis. tab ditutup sebelum Promise ini selesai)
      // tetap bisa disembuhkan sendiri alih-alih terus menampilkan 0.
      const fetchSecondary = (baseRows) => {
        Promise.all([
          readCollection("payroll_expenses", "payroll_expenses"),
          readCollection(KASBON_COLLECTION, KASBON_COLLECTION),
          readCollection("master_pekerja", "master_pekerja"),
        ]).then(([payrollRows, kasbonRows, masterPekerjaRows]) => {
          const merged = { ...baseRows, payrollRows, kasbonRows, masterPekerjaRows };
          applyRows(merged);
          try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), rows: merged })); } catch (e) {}
        }).catch((err) => console.warn("Secondary load gagal:", err));
      };

      if (useCache) {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
          if (cached?.savedAt && Date.now() - cached.savedAt < FIRESTORE_CACHE_TTL_MS && cached?.rows) {
            applyRows(cached.rows);
            setLoading(false);
            setRefreshingData(false);
            // Kalau cache yang tersimpan belum punya data payroll/kasbon (race dari load
            // sebelumnya), tarik ulang secondary collections di background.
            if (!Array.isArray(cached.rows.payrollRows) || !Array.isArray(cached.rows.kasbonRows)) {
              fetchSecondary(cached.rows);
            }
            return;
          }
        } catch (e) {}
      }

      const rows = {};
      // PERFORMA: load core collections dulu (dibutuhkan dashboard/pesanan/keuangan),
      // lalu secondary collections di-fetch async tanpa memblokir render awal.
      [
        rows.ordersRows,
        rows.shipmentBatchRows,
        rows.purchaseRows,
        rows.expenseRows,
        rows.materialRows,
        rows.productRows,
        rows.productCategoryRows,
        rows.transferRows,
        rows.transferOutRows,
        rows.returnRows,
        rows.ignoredIssueRows,
      ] = await Promise.all([
        readCollection("orders", "orders"),
        readCollection("shipment_batches", "shipment_batches", true),
        readCollection("purchases", "purchases"),
        readCollection("expenses", "expenses"),
        readCollection("materials", "materials"),
        readCollection("products", "products"),
        readCollection("productCategories", "productCategories"),
        readCollection("transfers", "transfers"),
        readCollection("transfersOut", "transfersOut"),
        readCollection("returns", "returns", true),
        readCollection("ignoredIssues", "ignoredIssues", true),
      ]);

      applyRows(rows);
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), rows })); } catch (e) {}
      if (errors.length > 0) setFirestoreError(errors.join("\n"));

      // Secondary collections: payroll, kasbon, master_pekerja — tidak dibutuhkan saat loading awal,
      // fetch di background setelah render pertama selesai.
      fetchSecondary(rows);
    } finally {
      setLoading(false);
      setRefreshingData(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setOrders([]); setShipmentBatches([]); setPurchases([]); setExpenses([]); setMaterialsStock([]); setProductMasters([]); setProductCategories([]); setTransfers([]); setTransfersOut([]); setPayrollExpenses([]); setKasbonList([]); setMasterPekerja([]);
      loadedRef.current = { orders: false, shipmentBatches: false, purchases: false, expenses: false, materials: false, products: false, productCategories: false, transfers: false, transfersOut: false, payroll: false, kasbon: false, masterPekerja: false };
      setFirestoreError(""); setLoading(false); setRefreshingData(false);
      // Reset draft agar akun berikutnya tidak melihat draft akun sebelumnya
      setOrderDraftLoaded(false);
      return;
    }

    // Hemat reads Firestore:
    // Tidak memasang onSnapshot ke collection besar. App membaca data sekali saat masuk,
    // memakai cache 12 jam (FIRESTORE_CACHE_TTL_MS), lalu bisa diperbarui dari tombol Refresh Data
    // atau otomatis setelah simpan/edit/hapus. Ini menjaga fungsi tetap sama, tetapi mengurangi reads
    // yang biasanya muncul dari realtime listener dan refresh berulang.
    loadFirestoreData({ showLoading: true, useCache: true }).catch((err) => {
      console.warn("Load data gagal:", err);
      setLoading(false);
      setRefreshingData(false);
    });

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [user]);

  // Peta: nama logis → { collectionName, setter, rowKey }
  const COLLECTION_MAP = {
    orders:            { col: "orders",             setter: setOrders,           rowKey: "ordersRows" },
    shipmentBatches:   { col: "shipment_batches",   setter: setShipmentBatches,  rowKey: "shipmentBatchRows", optional: true },
    purchases:         { col: "purchases",           setter: setPurchases,         rowKey: "purchaseRows" },
    expenses:          { col: "expenses",            setter: setExpenses,          rowKey: "expenseRows" },
    materials:         { col: "materials",           setter: setMaterialsStock,    rowKey: "materialRows" },
    products:          { col: "products",            setter: setProductMasters,    rowKey: "productRows" },
    productCategories: { col: "productCategories",  setter: setProductCategories, rowKey: "productCategoryRows" },
    transfers:         { col: "transfers",           setter: setTransfers,         rowKey: "transferRows" },
    transfersOut:      { col: "transfersOut",        setter: setTransfersOut,      rowKey: "transferOutRows" },
    returns:           { col: "returns",             setter: setReturns,           rowKey: "returnRows", optional: true },
    kasbon:            { col: KASBON_COLLECTION,     setter: setKasbonList,        rowKey: "kasbonRows" },
    masterPekerja:     { col: "master_pekerja",      setter: setMasterPekerja,     rowKey: "masterPekerjaRows" },
    ignoredIssues:     { col: "ignoredIssues",       setter: (rows) => setIgnoredIssues(rows.filter((r) => r.issueId).map((r) => ({ id: r.id, issueId: r.issueId }))), rowKey: "ignoredIssueRows", optional: true },
  };

  // Targeted refresh: hanya baca collection yang benar-benar berubah.
  // Jauh lebih hemat reads dibanding loadFirestoreData() yang membaca semua 12 collection.
  // Cache localStorage diperbarui parsial agar tombol Refresh manual tetap dapat data terbaru.
  async function refreshCollections(...names) {
    if (!user) return;
    const readOne = async ({ col, optional = false }) => {
      try {
        const snap = await getDocs(collection(db, col));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn(`refreshCollections ${col}:`, err);
        if (!optional) throw err;
        return null; // optional → biarkan state lama tetap
      }
    };

    const results = await Promise.allSettled(
      names.map((name) => {
        const entry = COLLECTION_MAP[name];
        if (!entry) return Promise.resolve(null);
        return readOne(entry);
      })
    );

    // Update state + patch cache parsial
    const cacheKey = `${FIRESTORE_CACHE_KEY}_${user?.email || "anon"}`;
    let cachedRows = {};
    try { cachedRows = JSON.parse(localStorage.getItem(cacheKey) || "null")?.rows || {}; } catch (_) {}

    results.forEach((result, i) => {
      const name = names[i];
      const entry = COLLECTION_MAP[name];
      if (!entry) return;
      if (result.status === "fulfilled" && result.value !== null) {
        entry.setter(result.value);
        cachedRows[entry.rowKey] = result.value;
      }
    });

    try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), rows: cachedRows })); } catch (_) {}
  }

  // Helper: jadwalkan refreshCollections dengan debounce (mencegah double-call
  // jika satu aksi memanggil refreshCollections dua kali berturutan).
  function scheduleRefresh(...names) {
    if (pendingRefreshRef.current) clearTimeout(pendingRefreshRef.current);
    pendingRefreshRef.current = setTimeout(() => {
      refreshCollections(...names).catch((err) => console.warn("Targeted refresh gagal:", err));
    }, FIRESTORE_REFRESH_DEBOUNCE_MS);
  }

  // ── Sinkron stok otomatis dari riwayat pengiriman lama ──────────────────────
  // Jalan sekali saat orders & materialsStock sudah loaded dan user sudah login.
  // Flag `materialStockDeliverySync` di Firestore (appCounters) mencegah sync jalan dua kali.
  const stockSyncRunRef = useRef(false);
  useEffect(() => {
    if (!user || !orders.length || !materialsStock.length || stockSyncRunRef.current) return;

    (async () => {
      stockSyncRunRef.current = true;
      try {
        const flagRef = doc(db, "appCounters", "materialStockDeliverySync");
        const flagSnap = await getDoc(flagRef);
        if (flagSnap.exists() && flagSnap.data()?.synced === true && flagSnap.data()?.version === "v11") return; // sudah sync versi terbaru

        // Hitung total pemakaian bahan dari SEMUA delivery yang ada
        const allUsage = {};
        // Buat index master produk untuk lookup cepat
        const masterByExactName = new Map(productMasters.map((p) => [normalizeName(p.name), p]));
        const masterById = new Map(productMasters.map((p) => [String(p.id || ""), p]));

        (orders || []).forEach((order) => {
          const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
          deliveries.forEach((delivery) => {
            const items = Array.isArray(delivery.items) ? delivery.items : [];
            const usageFromDelivery = buildMaterialUsageFromDeliveryItems(
              items.map((it) => {
                // Prioritas 1: dari order.items berdasarkan nama
                const orderItems = normalizeOrderItems(order);
                const base = orderItems.find((o) => normalizeName(o.name) === normalizeName(it.name || "")) || {};

                // Prioritas 2: dari productMasters — coba exact name, lalu productId, lalu partial
                const itName = normalizeName(it.name || "");
                const itProductId = String(it.productId || it.product_id || it.masterProductId || base.productId || "");
                let master = masterByExactName.get(itName) || (itProductId ? masterById.get(itProductId) : null);
                if (!master) {
                  // Partial match: cari master yang namanya mengandung kata-kata dari delivery item
                  master = productMasters.find((p) => {
                    const pName = normalizeName(p.name);
                    return itName && pName && (pName.includes(itName) || itName.includes(pName));
                  }) || null;
                }

                const hppMaterials = base.hppMaterials?.length > 0
                  ? base.hppMaterials
                  : normalizeHppMaterials(master || {}).length > 0
                    ? normalizeHppMaterials(master || {})
                    : [];
                const mainMaterial = it.mainMaterial || base.mainMaterial || master?.mainMaterial || master?.materialName || "";
                const materialQtyPerPcs = Number(it.materialQtyPerPcs ?? base.materialQtyPerPcs ?? master?.materialQtyPerPcs ?? 0);
                const unit = it.unit || base.unit || master?.unit || "yard";
                return {
                  ...it,
                  qty: Number(it.qty ?? it.shippedQty ?? 0),
                  hppMaterials,
                  mainMaterial,
                  materialQtyPerPcs,
                  unit,
                };
              })
            );
            usageFromDelivery.forEach((u) => {
              const resolvedName = capitalizeWords(normalizeMaterialAlias(u.name));
              const resolvedUnit = normalizeMaterialUnit(resolvedName, u.unit);
              const key = materialLineKey(resolvedName, resolvedUnit);
              if (!allUsage[key]) allUsage[key] = { ...u, name: resolvedName, unit: resolvedUnit, qty: 0 };
              allUsage[key].qty += Number(u.qty || 0);
            });
          });
        });

        const usageList = Object.values(allUsage).filter((u) => u.qty > 0);

        // Helper: sorted-words key untuk fuzzy match nama bahan
        const sortedWordsKey = (name) => normalizeName(name).split(/\s+/).sort().join(" ");
        const compactKey = (name) => normalizeName(name).replace(/\s+/g, "");

        // Stok bersih = stok tersimpan saat ini (sudah include semua purchases) - pemakaian dari deliveries
        // Pendekatan: kurangi langsung dari stok yang ada, tanpa recalculate dari purchases
        // karena purchases sudah terakumulasi dengan benar di stok Firestore.
        const wb = writeBatch(db);
        let updated = 0;

        // Bangun lookup usage dengan fuzzy matching
        const usageByExact = {};
        const usageBySorted = {};
        const usageByCompact = {};
        const usageByNameOnly = {};
        Object.entries(allUsage).forEach(([k, v]) => {
          usageByExact[k] = v;
          usageBySorted[`${sortedWordsKey(v.name)}__${v.unit === "kg" ? "kg" : "yard"}`] = v;
          usageByCompact[`${compactKey(v.name)}__${v.unit === "kg" ? "kg" : "yard"}`] = v;
          usageByNameOnly[compactKey(v.name)] = v;
        });

        (materialsStock || []).forEach((m) => {
          const unit = normalizeMaterialUnit(m.name, m.unit);
          const key = materialLineKey(m.name, unit);
          const sKey = `${sortedWordsKey(m.name)}__${unit === "kg" ? "kg" : "yard"}`;
          const cKey = `${compactKey(m.name)}__${unit === "kg" ? "kg" : "yard"}`;
          const mNameOnly = compactKey(m.name);

          const usageData = usageByExact[key] || usageBySorted[sKey] || usageByCompact[cKey] || usageByNameOnly[mNameOnly];
          if (!usageData) return;

          const currentStock = Number(m.stock || 0);
          const totalOut = usageData.qty || 0;
          const avgCost = Number(m.avgCost || 0);
          const newStock = Math.max(0, currentStock - totalOut);
          const newValue = Math.round(newStock * avgCost);

          wb.update(doc(db, "materials", m.id), {
            stock: newStock,
            totalValue: newValue,
            updatedAt: new Date().toISOString(),
          });
          updated++;
        });

        if (updated === 0 && usageList.length === 0) {
          wb.set(flagRef, { synced: true, version: "v11", syncedAt: new Date().toISOString(), note: "Tidak ada perubahan stok." }, { merge: true });
          await wb.commit();
          return;
        }

        // Simpan flag sync versi v2
        wb.set(flagRef, { synced: true, version: "v11", syncedAt: new Date().toISOString(), note: `Sync v3: ${updated} bahan diperbarui, ${usageList.length} pemakaian terdeteksi.` }, { merge: true });
        await wb.commit();

        // Refresh stok di state
        await refreshCollections("materials");
        console.log(`✅ Stok sinkron v9: ${updated} bahan diperbarui.`);
        console.log("Pemakaian terdeteksi:", Object.values(allUsage).map((v) => `${v.name}: ${v.qty.toFixed(3)} ${v.unit}`));
        const tidakCocok = Object.values(allUsage).filter((v) => {
          const resolvedName = capitalizeWords(normalizeMaterialAlias(v.name));
          const resolvedUnit = normalizeMaterialUnit(resolvedName, v.unit);
          const key = materialLineKey(resolvedName, resolvedUnit);
          const sKey = `${v.name.toLowerCase().split(" ").sort().join(" ")}__${resolvedUnit}`;
          const cKey = `${resolvedName.toLowerCase().replace(/\s+/g, "")}__${resolvedUnit}`;
          const nKey = resolvedName.toLowerCase().replace(/\s+/g, "");
          return !(materialsStock || []).some((m) => {
            const mUnit = normalizeMaterialUnit(m.name, m.unit);
            const mKey = materialLineKey(m.name, mUnit);
            const msKey = `${m.name.toLowerCase().split(" ").sort().join(" ")}__${mUnit}`;
            const mcKey = `${m.name.toLowerCase().replace(/\s+/g, "")}__${mUnit}`;
            const mnKey = m.name.toLowerCase().replace(/\s+/g, "");
            return mKey === key || msKey === sKey || mcKey === cKey || mnKey === nKey;
          });
        }).map((v) => v.name);
        if (tidakCocok.length > 0) console.warn("Bahan tidak cocok nama di stok:", tidakCocok);
      } catch (e) {
        console.warn("Sync stok dari delivery gagal:", e);
        stockSyncRunRef.current = false; // izinkan retry jika gagal
      }
    })();
  }, [user, orders, materialsStock, productMasters]);
  function orderSortValue(order) {
    return dateSerial(order?.createdAt || order?.date || order?.tanggal || "");
  }

  // Lookup harga dari master produk — fallback terakhir jika harga di item = 0.
  // Fungsi ini mirror dari lookupMasterPrice di InvoiceModal agar scope App punya akses yang sama.
  function lookupProductMasterPrice(name) {
    if (!name || !productMasters.length) return 0;
    const norm = normalizeName(name);
    const found = productMasters.find((p) => normalizeName(p.name) === norm);
    return moneyValue(found?.defaultPrice ?? found?.price ?? found?.hargaJual ?? found?.sellingPrice ?? found?.salePrice ?? found?.hargaPcs ?? found?.unitPrice ?? 0);
  }

  function officialShipmentSubtotalForOrder(order) {
    if (!order?.id && !order?.invoice) return 0;
    const orderId = String(order?.id || "").trim();
    const invoice = String(order?.invoice || "").trim();
    const customerKey = normalizeName(order?.customer || "");

    return (shipmentBatches || []).reduce((sum, batch) => {
      const batchItems = Array.isArray(batch.items) ? batch.items : [];
      const batchCustomer = normalizeName(batch.customerName || batch.customer || batch.receiver || batch.penerima || "");
      const batchOrderIds = [
        batch.orderId, batch.pesananId,
        ...(Array.isArray(batch.orderIds) ? batch.orderIds : []),
        ...(Array.isArray(batch.pesananIds) ? batch.pesananIds : []),
      ].map((x) => String(x || "").trim()).filter(Boolean);
      const batchInvoices = [
        batch.invoice,
        ...(Array.isArray(batch.invoices) ? batch.invoices : []),
      ].map((x) => String(x || "").trim()).filter(Boolean);

      const batchMatchesOrder = (orderId && batchOrderIds.includes(orderId)) || (invoice && batchInvoices.includes(invoice));
      const batchMatchesCustomer = customerKey && batchCustomer === customerKey;

      // Untuk tagihan per pesanan, jangan cocokkan batch hanya dari nama customer.
      // Satu customer bisa punya beberapa pesanan; customer-only match bisa menggandakan invoice
      // ke semua pesanan customer tersebut. Data lama tanpa orderId/invoice tetap dihitung dari
      // order.deliveries/shippedItems melalui normalizeShipmentItems().
      if (!batchMatchesOrder) return sum;

      const rows = Array.isArray(batch.orders) && batch.orders.length > 0 ? batch.orders : [];
      let rawItems = [];

      const matchedRows = rows.filter((row) => {
        const rowOrderId = String(row.orderId || row.pesananId || "").trim();
        const rowInvoice = String(row.invoice || "").trim();
        const rowCustomer = normalizeName(row.customer || row.customerName || "");
        return (orderId && rowOrderId === orderId) || (invoice && rowInvoice === invoice) || (!rowOrderId && !rowInvoice && batchMatchesOrder) || (!rowOrderId && !rowInvoice && batchMatchesCustomer && rowCustomer === customerKey);
      });

      if (matchedRows.length > 0) {
        rawItems = matchedRows.flatMap((row) => Array.isArray(row.items) && row.items.length > 0 ? row.items : batchItems.filter((it) => {
          const itOrderId = String(it.orderId || it.pesananId || "").trim();
          const itInvoice = String(it.invoice || "").trim();
          return (orderId && itOrderId === orderId) || (invoice && itInvoice === invoice);
        }));
      } else if (batchMatchesOrder) {
        rawItems = batchItems.filter((it) => {
          const itOrderId = String(it.orderId || it.pesananId || "").trim();
          const itInvoice = String(it.invoice || "").trim();
          return (!itOrderId && !itInvoice) || (orderId && itOrderId === orderId) || (invoice && itInvoice === invoice);
        });
      } else if (batchMatchesCustomer && rows.length === 0 && batchItems.length > 0) {
        rawItems = batchItems.filter((it) => {
          const itOrderId = String(it.orderId || it.pesananId || "").trim();
          const itInvoice = String(it.invoice || "").trim();
          return (orderId && itOrderId === orderId) || (invoice && itInvoice === invoice);
        });
      }

      const batchOngkir = moneyValue(batch.ongkir ?? batch.shippingCost ?? 0);

      if (rawItems.length > 0) {
        const lineTotal = rawItems.reduce((lineSum, it, idx) => {
          const qty = Number(it.shippedQty ?? it.qtyKirim ?? it.qty ?? it.kirim ?? 0);
          if (qty <= 0) return lineSum;
          const base = orderItemForDeliveryItem(order, it, idx) || {};
          // Harga HANYA dari order GK atau master produk — TIDAK dari item batch GP.
          // item batch GP (it) bisa punya harga yang include ongkir atau salah.
          const basePrice = firstPositiveMoney(
            base?.price, base?.harga, base?.hargaJual, base?.hargaPcs,
            base?.sellingPrice, base?.salePrice, base?.unitPrice, base?.hargaSatuan
          );
          // Fallback ke master produk berdasarkan nama — bukan dari it (GP item)
          const price = basePrice > 0
            ? basePrice
            : lookupProductMasterPrice(base.name || it.name || it.nama || "");
          if (!price) return lineSum; // skip jika harga tidak ditemukan
          return lineSum + qty * price;
        }, 0);
        if (lineTotal > 0) return sum + lineTotal;
      }

      // totalTagihanBatch dari GP tidak dipakai karena mungkin include ongkir dibagi rata
      // ke semua pesanan dalam batch — menyebabkan tagihan per pesanan tidak akurat.
      // Kalau rawItems kosong, fallback ke 0 dan biarkan orderPaymentTarget pakai deliverySubtotal.

      return sum;
    }, 0);
  }

  // Total koreksi tagihan dari retur yang SUDAH diproses admin (klik "Kurangi Tagihan Sekarang").
  // Retur yang belum diproses (tagihanDikurangi belum true) tidak memotong apa pun di sini —
  // sesuai desain: retur baru mengurangi tagihan setelah admin klik tombolnya secara manual.
  // Nominalnya dari retur.tagihanDikurangiNominal (dicatat saat tombol diklik), BUKAN dari
  // qty pesanan/pengiriman — karena tagihan pesanan dihitung dari data pengiriman
  // (shipment_batches/getDeliveryHistory), bukan dari order.items, sehingga mengubah qty
  // di order.items tidak pernah benar-benar memengaruhi tagihan.
  function returAdjustmentForOrder(order) {
    const orderId = String(order?.id || "").trim();
    const invoice = String(order?.invoice || "").trim();
    if (!orderId && !invoice) return 0;
    return (returns || [])
      .filter((r) => r.tagihanDikurangi)
      .filter((r) => (orderId && String(r.orderId || "").trim() === orderId) || (invoice && String(r.invoice || "").trim() === invoice))
      .reduce((sum, r) => sum + Number(r.tagihanDikurangiNominal || 0), 0);
  }

  function orderPaymentTarget(order) {
    const orderId = String(order?.id || "").trim();
    const invoice = String(order?.invoice || "").trim();

    // Ongkir GK dari order langsung
    const ongkirGK = orderShippingCost(order);

    // Ongkir: hanya dari GK (order.shippingCost).
    // Ongkir GP (shipment_batches) tidak masuk ke tagihan per pesanan — Opsi A:
    // ongkir GP hanya tampil di invoice canvas, tidak di kartu pesanan/customer.
    const ongkir = ongkirGK;
    const officialSubtotal = officialShipmentSubtotalForOrder(order);
    const deliverySubtotal = shipmentItemsTotal(normalizeShipmentItems(order, productMasters), lookupProductMasterPrice) + ongkir;
    const base = Math.round(officialSubtotal > 0 ? (officialSubtotal + ongkir) : deliverySubtotal);
    return Math.max(0, base - returAdjustmentForOrder(order));
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

  function sortPaymentEventsAsc(a, b) {
    const dateDiff = dateSerial(a.date || "") - dateSerial(b.date || "");
    if (dateDiff !== 0) return dateDiff;
    const createdDiff = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (createdDiff !== 0) return createdDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
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

    const transferEventKeys = new Set(allTransferEvents.map((t) => `${t.date}__${moneyValue(t.amount || 0)}__${normalizeName(t.note || "")}`));
    const standaloneOrderPaymentEvents = customerOrdersSorted(customerName).flatMap((order) =>
      (order.payments || [])
        .filter((pay) => moneyValue(pay.amount || 0) > 0)
        .filter((pay) => !pay.transferId && !isMigratedPaymentSource(pay))
        .map((pay, idx) => ({
          id: `${order.id || "order"}-standalone-${idx}`,
          date: pay.date || order.createdAt || todayStr(),
          createdAt: pay.createdAt || order.createdAt || "",
          note: cleanCustomerPaymentNote(pay.note || "Pembayaran Customer"),
          amount: moneyValue(pay.amount || 0),
          source: pay.source || "standalone_order_payment",
          transferId: "",
          transferAmount: moneyValue(pay.amount || 0),
          transferNote: pay.note || "",
        }))
        .filter((pay) => !transferEventKeys.has(`${pay.date}__${moneyValue(pay.amount || 0)}__${normalizeName(pay.note || "")}`))
    );

    // Semua transfer valid tetap ikut FIFO untuk menghitung sisa tagihan.
    // Pembayaran yang tersimpan langsung di order tanpa transferId (mis. DP Awal)
    // tetap ikut FIFO agar tidak hilang saat customer juga punya transfer kas masuk.
    if (allTransferEvents.length > 0) {
      return [...allTransferEvents, ...standaloneOrderPaymentEvents]
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

  // PERFORMA: customerFifoPaymentMap dipanggil ulang untuk SETIAP order saat filter/sort/render
  // daftar Pesanan (lewat orderPaidTotal/sisaOrder). Tanpa cache, mengetik satu huruf di form
  // manapun (yang re-render GalleryKerudungApp) memicu perhitungan FIFO ulang untuk semua
  // customer × semua order — ini penyebab utama ketikan terasa lemot. Cache di-invalidate
  // otomatis begitu referensi `orders` atau `transfers` benar-benar berubah (data baru dari
  // Firestore/aksi user), bukan pada re-render biasa. Logika perhitungan di dalam TIDAK diubah.
  const fifoPaymentMapCacheRef = useRef({ orders: null, transfers: null, cache: new Map() });
  function customerFifoPaymentMap(customerName) {
    const cacheBox = fifoPaymentMapCacheRef.current;
    if (cacheBox.orders !== orders || cacheBox.transfers !== transfers) {
      cacheBox.orders = orders;
      cacheBox.transfers = transfers;
      cacheBox.cache = new Map();
    }
    const cacheKey = normalizeName(customerName || "");
    if (cacheBox.cache.has(cacheKey)) return cacheBox.cache.get(cacheKey);
    const computed = computeCustomerFifoPaymentMap(customerName);
    cacheBox.cache.set(cacheKey, computed);
    return computed;
  }

  function computeCustomerFifoPaymentMap(customerName) {
    const customerKey = normalizeName(customerName || "");
    const result = {};
    if (!customerKey) return result;

    const customerOrderList = customerOrdersSorted(customerName)
      .map((o) => ({ ...o, remaining: Math.max(0, orderPaymentTarget(o)) }))
      .filter((o) => o.id && o.remaining > 0);

    const customerPayments = customerPaymentEventsSorted(customerName).sort(sortPaymentEventsAsc);

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

  function customerHasDirectTransfer(customerName) {
    const key = normalizeName(customerName || "");
    return key && (transfers || []).some((t) => normalizeName(t.customer || "") === key && moneyValue(t.amount || 0) > 0);
  }

  function orderPaymentRowsForCalculation(order) {
    if (!order?.id) return [];
    const fifoRows = customerFifoPaymentMap(order.customer)[order.id] || [];
    if (fifoRows.length > 0) return fifoRows;
    // Jika customer sudah punya catatan transfer utuh, jangan fallback ke order.payments
    // untuk order yang tidak mendapat alokasi FIFO. Ini mencegah dobel hitung
    // antara transfers dan payments lama yang tersimpan di order.
    if (customerHasDirectTransfer(order.customer)) return [];
    return Array.isArray(order?.payments) ? order.payments : [];
  }


  function paymentHistoryForDisplay(rows, defaultNote) {
    const list = Array.isArray(rows) ? rows : [];

    // FINAL AUDIT RULE:
    // 1) Baris pembayaran asli harus tampil per tanggal input dan boleh terpotong sesuai FIFO.
    // 2) Baris migrasi/saldo lama TIDAK boleh disamar menjadi pembayaran asli,
    //    karena nominal itu bukan input user per tanggal. Kalau masih ikut melunasi nota,
    //    tampilkan sebagai "Saldo Awal" agar total pembayaran dan sisa tagihan tetap sinkron
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
    const deliveryStatus = orderDeliveryStatus(order);
    if (isFinalDeliveryStatus(deliveryStatus) && sisaOrder(order) <= 0 && orderPaymentTarget(order) > 0) return "Lunas";
    return deliveryStatus;
  }

  function isDeliveryComplete(order) {
    return isFinalDeliveryStatus(orderDeliveryStatus(order));
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

    // Semua transfer valid tetap ikut FIFO untuk menghitung sisa tagihan.
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

  // PERFORMA: sama seperti customerFifoPaymentMap — cache per supplier supaya tidak
  // dihitung ulang untuk setiap purchase saat filter/sort/render Supplier/Pengeluaran,
  // atau saat mengetik di form manapun (yang re-render seluruh komponen).
  const fifoSupplierMapCacheRef = useRef({ purchases: null, transfersOut: null, cache: new Map() });
  function supplierFifoPaymentMap(supplierName) {
    const cacheBox = fifoSupplierMapCacheRef.current;
    if (cacheBox.purchases !== purchases || cacheBox.transfersOut !== transfersOut) {
      cacheBox.purchases = purchases;
      cacheBox.transfersOut = transfersOut;
      cacheBox.cache = new Map();
    }
    const cacheKey = normalizeName(supplierName || "");
    if (cacheBox.cache.has(cacheKey)) return cacheBox.cache.get(cacheKey);
    const computed = computeSupplierFifoPaymentMap(supplierName);
    cacheBox.cache.set(cacheKey, computed);
    return computed;
  }

  function computeSupplierFifoPaymentMap(supplierName) {
    const supplierKey = normalizeName(supplierName || "");
    const result = {};
    if (!supplierKey) return result;

    const supplierPurchases = supplierPurchasesSorted(supplierName)
      .map((p) => ({ ...p, remaining: Math.max(0, purchaseInvoiceTotal(p)) }))
      .filter((p) => p.id && p.remaining > 0);

    const supplierPayments = supplierPaymentEventsSorted(supplierName).sort(sortPaymentEventsAsc);
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

  function supplierHasDirectTransfer(supplierName) {
    const key = normalizeName(supplierName || "");
    return key && (transfersOut || []).some((t) => normalizeName(t.supplier || "") === key && moneyValue(t.amount || 0) > 0);
  }

  function purchasePaymentRowsForCalculation(purchase) {
    if (!purchase?.id) return [];
    const fifoRows = supplierFifoPaymentMap(purchase.supplier)[purchase.id] || [];
    if (fifoRows.length > 0) return fifoRows;
    // Sama seperti customer: kalau sudah ada transfersOut utuh untuk supplier ini,
    // jangan fallback ke purchase.payments agar tidak dobel hitung.
    if (supplierHasDirectTransfer(purchase.supplier)) return [];
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
    // PERFORMA: pakai Map untuk lookup O(1) per key, bukan find() O(n) di dalam reduce()
    const customerByKey = new Map();
    (orders || []).forEach((o) => {
      const key = normalizeName(o.customer || "");
      if (key && !customerByKey.has(key)) customerByKey.set(key, o);
    });
    const customerNames = [...customerByKey.keys()];
    const customerPaid = customerNames.reduce((sum, key) => {
      const order = customerByKey.get(key);
      return sum + moneySum(customerPaymentEventsSorted(order?.customer || key), (p) => p.amount);
    }, 0);
    const transferTotal = customerPaid;
    const receivable = totalPiutangCustomerAktif();
    const supplierByKey = new Map();
    (purchases || []).forEach((p) => {
      const key = normalizeName(p.supplier || "");
      if (key && !supplierByKey.has(key)) supplierByKey.set(key, p);
    });
    const supplierNames = [...supplierByKey.keys()];
    const supplierPaid = supplierNames.reduce((sum, key) => {
      const purchase = supplierByKey.get(key);
      return sum + moneySum(supplierPaymentEventsSorted(purchase?.supplier || key), (p) => p.amount);
    }, 0);
    const supplierDebt = purchases.reduce((s, p) => s + hutangPurchase(p), 0);
    const otherExpense = moneySum(expenses, (e) => e.amount);
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
      if (!map[key]) map[key] = { name, totalSisa: 0, sisa: 0, tagihan: 0, totalBayar: 0, totalPesanan: 0, pesananAktif: 0, totalRealisasiSisa: 0 };
      map[key].totalPesanan += 1;
      const sisaAlokasi = Math.max(0, sisaOrderUntukAlokasi(o));
      const sisaRealisasi = Math.max(0, sisaOrder(o));
      map[key].tagihan += Math.max(0, orderPaymentTarget(o));
      map[key].totalBayar += Math.max(0, orderPaidTotal(o));
      map[key].sisa += sisaRealisasi;
      if (sisaAlokasi > 0) {
        map[key].totalSisa += sisaAlokasi;
        map[key].totalRealisasiSisa += sisaRealisasi;
        map[key].pesananAktif += 1;
      }
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, transfers]);

  function customerReceivableTotals(customerName) {
    const key = normalizeName(customerName || "");
    if (!key) return { name: "", orders: [], totalTagihan: 0, totalBayar: 0, sisa: 0, orderCount: 0 };
    const customerOrders = (orders || []).filter((o) => normalizeName(o.customer || "") === key);
    const totalTagihan = customerOrders.reduce((sum, o) => sum + Math.max(0, orderPaymentTarget(o)), 0);
    const totalBayar = customerOrders.reduce((sum, o) => sum + Math.max(0, orderPaidTotal(o)), 0);
    const sisa = customerOrders.reduce((sum, o) => sum + Math.max(0, sisaOrder(o)), 0);
    return {
      name: capitalizeWords(customerOrders[0]?.customer || customerName || ""),
      orders: customerOrders,
      totalTagihan: Math.round(totalTagihan),
      totalBayar: Math.round(totalBayar),
      sisa: Math.round(sisa),
      orderCount: customerOrders.length,
    };
  }

  function totalPiutangCustomerAktif() {
    const customerKeys = [...new Set((orders || []).map((o) => normalizeName(o.customer || "")).filter(Boolean))];
    return customerKeys.reduce((sum, key) => sum + customerReceivableTotals(key).sisa, 0);
  }

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
  // PERFORMA: debounce 250ms agar tidak filter ulang semua data setiap ketukan keyboard
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const q = debouncedSearch.toLowerCase();
  const filteredOrders = useMemo(() => orders
    .filter((o) => {
      const itemText = normalizeOrderItems(o).map((it) => it.name).join(" ").toLowerCase();
      return !q || o.customer?.toLowerCase().includes(q) || o.invoice?.toLowerCase().includes(q) || itemText.includes(q);
    })
    .sort(sortOldestBottom), [orders, q]);

  // PERFORMA: filter+sort tab Pesanan dipisah dari JSX supaya tidak dihitung ulang
  // setiap render (mis. saat mengetik di modal tambah pesanan). sisaOrder() dipakai
  // di filter "belum-lunas"/"lunas" dan nilainya bisa berubah kalau ada pembayaran baru
  // (transfers) meski `orders` sendiri tidak berubah, makanya transfers ikut jadi dependency.
  const ordersTabList = useMemo(() => {
    let list = [...filteredOrders];
    if (filterOrder === "belum-kirim") list = list.filter(o => orderDeliveryStatus(o) === "Proses");
    if (filterOrder === "sebagian") list = list.filter(o => orderDeliveryStatus(o) === "Dikirim Sebagian");
    if (filterOrder === "belum-lunas") list = list.filter(o => sisaOrder(o) > 0);
    if (filterOrder === "selesai") list = list.filter(o => orderDeliveryStatus(o) === "Selesai");
    if (filterOrder === "lunas") list = list.filter(o => sisaOrder(o) <= 0);
    if (sortOrder === "terbaru") list.sort(sortOldestBottom);
    if (sortOrder === "terlama") list.sort(sortOldestTop);
    if (sortOrder === "customer") list.sort((a, b) => (a.customer || "").localeCompare(b.customer || "") || sortOldestBottom(a, b));
    return list;
  }, [filteredOrders, filterOrder, sortOrder, transfers]);

  const filteredPurchases = useMemo(() => [...purchases]
    .filter((p) => {
      const bahanText = normalizePurchaseMaterials(p).map((it) => it.name).join(" ").toLowerCase();
      return !q || p.supplier?.toLowerCase().includes(q) || p.material?.toLowerCase().includes(q) || bahanText.includes(q);
    })
    .sort(sortPurchaseNewestFirst), [purchases, q]);

  const filteredMaterialsStock = useMemo(() => (materialsStock || []).filter((m) => {
    return !q || String(m?.name || "").toLowerCase().includes(q) || String(m?.category || "").toLowerCase().includes(q);
  }), [materialsStock, q]);

  const productsWithoutHpp = useMemo(() => (productMasters || []).filter((p) => p?.isActive !== false && calculateProductHpp(p) <= 0), [productMasters]);

  const filteredProductMasters = useMemo(() => (productMasters || []).filter((p) => {
    if (productQuickFilter === "missing-hpp" && !(p?.isActive !== false && calculateProductHpp(p) <= 0)) return false;
    return !q || String(p?.name || "").toLowerCase().includes(q) || String(p?.category || "").toLowerCase().includes(q) || String(p?.mainMaterial || "").toLowerCase().includes(q);
  }), [productMasters, q, productQuickFilter]);

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
      const latestPrice = moneyValue(it.price || 0);
      const existingPrice = firstPositiveMoney(existing?.defaultPrice, existing?.price, existing?.hargaJual, existing?.sellingPrice, existing?.salePrice, existing?.hargaPcs, existing?.unitPrice);
      const priceForMaster = latestPrice > 0 ? latestPrice : existingPrice;
      const priceFields = priceForMaster > 0 ? {
        // Harga produk fluktuatif: harga input pesanan customer adalah harga terbaru
        // untuk default pesanan berikutnya. Invoice pesanan lama tetap memakai
        // harga yang tersimpan di item pesanan lama. Jika item lama tidak punya harga,
        // jangan menimpa master produk yang sudah ada menjadi Rp 0.
        defaultPrice: priceForMaster,
        price: priceForMaster,
        hargaJual: priceForMaster,
        sellingPrice: priceForMaster,
        salePrice: priceForMaster,
        hargaPcs: priceForMaster,
        unitPrice: priceForMaster,
      } : {};
      const itemHppMaterials = normalizeHppMaterials(it);
      const existingHppMaterials = normalizeHppMaterials(existing);
      const savedHppMaterials = itemHppMaterials.length > 0 ? itemHppMaterials : existingHppMaterials;
      const savedBahanCost = hppMaterialsCost({ hppMaterials: savedHppMaterials }) || moneyValue(it.bahanCost || existing?.bahanCost || 0);
      const payload = {
        name, category,
        ...priceFields,
        bahanCost: savedBahanCost,
        hppPerPcs: moneyValue(it.hppPerPcs || existing?.hppPerPcs || 0),
        mainMaterial: savedHppMaterials[0]?.name || it.mainMaterial || existing?.mainMaterial || "",
        materialQtyPerPcs: Number(savedHppMaterials[0]?.usagePerPcs || it.materialQtyPerPcs || existing?.materialQtyPerPcs || 0),
        bahanPricePerUnit: moneyValue(savedHppMaterials[0]?.pricePerUnit || existing?.bahanPricePerUnit || 0),
        hppMaterials: savedHppMaterials,
        unit: savedHppMaterials[0]?.unit || it.unit || existing?.unit || "yard",
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
    if (!String(productForm.name || "").trim()) return alert("Nama produk wajib diisi");
    if (!String(productForm.category || "").trim()) return alert("Kategori wajib diisi");
    if (!moneyValue(productForm.defaultPrice || 0)) return alert("Harga jual wajib diisi");
    setIsSaving(true);
    try {
      const name = capitalizeWords(productForm.name);
      const category = capitalizeWords(productForm.category || "Lainnya");
      await upsertProductCategory(category);
      const existing = productMasters.find((p) => normalizeName(p.name) === normalizeName(name));
      const materialRows = normalizeHppMaterials(productForm);
      const firstMaterial = materialRows[0] || null;
      const materialQtyPerPcs = firstMaterial ? numberValue(firstMaterial.usagePerPcs || 0) : numberValue(productForm.materialQtyPerPcs || 0);
      const bahanPricePerUnit = firstMaterial ? moneyValue(firstMaterial.pricePerUnit || 0) : moneyValue(productForm.bahanPricePerUnit || 0);
      const multiBahanCost = materialRows.reduce((sum, row) => sum + moneyValue(row.total || 0), 0);
      const bahanCost = multiBahanCost > 0
        ? multiBahanCost
        : (bahanPricePerUnit > 0 && materialQtyPerPcs > 0 ? Math.round(bahanPricePerUnit * materialQtyPerPcs) : moneyValue(productForm.bahanCost || 0));
      const hppPerPcs = calculateProductHpp({ ...productForm, bahanCost, hppMaterials: materialRows });
      const payload = {
        imageUrl: productForm.imageUrl || "", name, category,
        defaultPrice: moneyValue(productForm.defaultPrice || 0),
        price: moneyValue(productForm.defaultPrice || 0),
        hargaJual: moneyValue(productForm.defaultPrice || 0),
        sellingPrice: moneyValue(productForm.defaultPrice || 0),
        salePrice: moneyValue(productForm.defaultPrice || 0),
        hargaPcs: moneyValue(productForm.defaultPrice || 0),
        unitPrice: moneyValue(productForm.defaultPrice || 0),
        mainMaterial: firstMaterial?.name || capitalizeWords(productForm.mainMaterial || ""),
        materialQtyPerPcs,
        unit: firstMaterial?.unit || (productForm.unit === "kg" ? "kg" : "yard"),
        bahanPricePerUnit,
        bahanCost,
        hppMaterials: materialRows,
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
    finally { setIsSaving(false); scheduleRefresh("products", "productCategories"); }
  }

  async function addOrder() {
    if (!String(orderForm.customer || "").trim()) return alert("Nama customer wajib diisi");
    const cleanItems = (orderForm.items || [])
      .map((it) => ({
        name: String(it.name || "").trim(), category: capitalizeWords(it.category || "Lainnya"),
        qty: Number(it.qty || 0), price: moneyValue(it.price || 0),
        bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0),
        productId: it.productId || "", mainMaterial: it.mainMaterial || "",
        materialQtyPerPcs: numberValue(it.materialQtyPerPcs || 0), unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit),
        hppMaterials: normalizeHppMaterials(it),
        note: shipmentAutoNote(Number(it.qty || 0), 0),
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
        invoice: await generateInvoice(), customer: capitalizeWords(orderForm.customer),
        phone: orderForm.phone || "", items: cleanItems,
        item: firstItem.name || "Produk", qty: cleanItems.reduce((s, it) => s + Number(it.qty || 0), 0),
        hargaPcs: moneyValue(firstItem.price || 0), subtotal, shippingCost, ongkir: shippingCost, total,
        status: "Proses", createdAt: orderForm.date || todayStr(),
        payments: dp > 0 ? [{ date: todayStr(), note: "DP Awal", amount: dp }] : [],
      };
      await addDoc(collection(db, "orders"), newOrder);
      addAuditLog("Tambah Pesanan", `${newOrder.customer} - ${newOrder.invoice} - ${rupiah(newOrder.total)}`);
      if (returJualPending) {
        try {
          await updateDoc(doc(db, "returns", returJualPending), { statusJualUlang: "sudah_terjual", terjualKe: newOrder.customer, terjualInvoice: newOrder.invoice });
        } catch (e) { console.warn("Gagal auto-tandai retur sudah terjual:", e); }
        setReturJualPending(null);
        scheduleRefresh("returns");
      }
      resetOrderDraft(); setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("orders", "products", "productCategories"); }
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
    finally { setIsSaving(false); scheduleRefresh("purchases", "materials", "transfersOut"); }
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
    finally { setIsSaving(false); scheduleRefresh("expenses"); }
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
    finally { setIsSaving(false); scheduleRefresh("transfers"); }
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
    finally { setIsSaving(false); scheduleRefresh("transfersOut"); }
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

      // Gunakan writeBatch agar transfer masuk + alokasi order tersimpan atomik.
      // Kalau salah satu gagal, semua dibatalkan — tidak ada data setengah tersimpan.
      const batch = writeBatch(db);

      const transferRef = doc(collection(db, "transfers"));
      batch.set(transferRef, {
        date,
        customer: customerName,
        bank,
        note,
        amount: paymentAmount,
        source: "bayar_customer_utuh",
        createdAt: new Date().toISOString(),
        user: user?.email || "-",
      });

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
        const billable = orderPaymentTarget(order);
        const totalPaid = Math.round(updatedPayments.reduce((s, p) => s + moneyValue(p.amount || 0), 0));
        const lunas = totalPaid >= billable && billable > 0;
        batch.update(doc(db, "orders", order.id), {
          payments: updatedPayments,
          ...(lunas ? { status: "Lunas" } : {}),
        });
        alokasi.push({ invoice: order.invoice, bayar });
      }

      await batch.commit();

      addAuditLog("Bayar Customer", `${customerName} - ${bank} - ${rupiah(paymentAmount)}${alokasi.length ? "" : ""}`);
      const info = alokasi.length > 0
        ? `\n\nRincian pembayaran:\n${alokasi.map(a => `${a.invoice || "Pesanan"}: ${rupiah(a.bayar)}`).join("\n")}`
        : "\n\nTidak ada pesanan aktif, jadi hanya dicatat sebagai transfer masuk.";
      const sisaMsg = sisa > 0 ? `\nSisa ${rupiah(sisa)} dicatat sebagai kelebihan pembayaran.` : "";
      alert(`✅ Realisasi pembayaran customer tersimpan: ${rupiah(paymentAmount)}`);
      setOrderPayForm({ customer: "", date: todayStr(), bank: "", note: "", amount: 0 });
      setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("transfers", "orders"); }
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

    if (supplierPurchases.length === 0) return alert("Tidak ada tagihan aktif untuk supplier ini.");

    setIsSaving(true);
    try {
      let sisa = supplierPaymentAmount;
      const date = supplierPayForm.date || todayStr();
      const note = supplierPayForm.note || "Pembayaran Supplier";

      // Gunakan writeBatch agar transfer keluar + alokasi tagihan tersimpan atomik.
      const batch = writeBatch(db);

      const transferOutRef = doc(collection(db, "transfersOut"));
      batch.set(transferOutRef, {
        date,
        supplier: supplierName,
        bank: note,
        note,
        amount: supplierPaymentAmount,
        source: "bayar_supplier_utuh",
        createdAt: new Date().toISOString(),
        user: user?.email || "-",
      });

      const alokasi = [];
      for (const purchase of supplierPurchases) {
        if (sisa <= 0) break;
        const sisaTagihan = Math.max(0, sisaPurchase(purchase));
        if (sisaTagihan <= 0) continue;
        const bayar = Math.min(sisa, sisaTagihan);
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
        batch.update(doc(db, "purchases", purchase.id), { payments: updatedPayments });
        alokasi.push({ tanggal: purchase.createdAt || "-", material: purchaseMaterialsSummary(purchase), bayar });
      }

      await batch.commit();

      const info = alokasi.map(a => `${a.tanggal} - ${a.material}: ${rupiah(a.bayar)}`).join("\n");
      const sisaMsg = sisa > 0 ? `\n\nSisa ${rupiah(sisa)} dicatat sebagai transfer keluar, dicatat sebagai kelebihan pembayaran supplier.` : "";
      addAuditLog("Pembayaran Supplier", `${supplierName} - ${rupiah(supplierPaymentAmount)}`);
      alert(`✅ Realisasi pembayaran supplier tersimpan: ${rupiah(supplierPaymentAmount)}`);
      setSupplierPayForm({ supplier: "", date: todayStr(), note: "", amount: 0 }); setModal(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("transfersOut", "purchases"); }
  }

  // ── Kasbon Pegawai ──────────────────────────────────────────────────────────

  async function addKasbon() {
    const nama = (kasbonForm.employeeName || "").trim();
    const jumlah = moneyValue(kasbonForm.jumlah || 0);
    if (!nama) return alert("Nama pegawai wajib diisi");
    if (jumlah <= 0) return alert("Jumlah kasbon wajib diisi");
    if (jumlah > 50_000_000) return alert("Jumlah kasbon terlalu besar");
    const tanggal = kasbonForm.tanggal || todayStr();

    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      // Simpan kasbon ke collection kasbon_pegawai (dibaca juga oleh Gallery Produksi)
      const kasbonRef = doc(collection(db, KASBON_COLLECTION));
      batch.set(kasbonRef, {
        employeeName: nama,
        tanggal,
        jumlah,
        sisaKasbon: jumlah,
        keterangan: (kasbonForm.keterangan || "").trim(),
        status: "aktif", // aktif | lunas
        cicilan: [],
        createdAt: new Date().toISOString(),
        createdBy: user?.email || "-",
      });

      // Otomatis catat ke pengeluaran Gallery Kerudung
      const expenseRef = doc(collection(db, "expenses"));
      batch.set(expenseRef, {
        date: tanggal,
        category: "Kasbon Pegawai",
        note: `Kasbon ${nama}${kasbonForm.keterangan ? " – " + kasbonForm.keterangan : ""}`,
        amount: jumlah,
        kasbonId: kasbonRef.id,
        createdAt: new Date().toISOString(),
      });

      await batch.commit();
      addAuditLog("Kasbon", `${nama} – ${rupiah(jumlah)}`);
      setKasbonForm({ employeeName: "", tanggal: "", jumlah: "", keterangan: "" });
      setModal(null);
    } catch (e) { alert("Gagal simpan kasbon: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("kasbon", "expenses"); }
  }

  async function tambahCicilanKasbon(kasbonId, jumlahCicilan, tanggalCicilan) {
    const kasbon = kasbonList.find((k) => k.id === kasbonId);
    if (!kasbon) return alert("Data kasbon tidak ditemukan");
    const cicilan = moneyValue(jumlahCicilan || 0);
    if (cicilan <= 0) return alert("Jumlah bayar/cicil wajib diisi");

    // Hitung sisa dari Firestore sebagai sumber kebenaran.
    // Cicilan dari Gallery Produksi (sumber: "rekap_gaji") sudah memotong sisaKasbon
    // di Firestore secara atomic. Jangan recalculate dari jumlah-totalCicilan agar
    // potongan gaji tidak "dikembalikan" saat cicilan manual baru ditambahkan.
    const sisaSekarang = Math.max(0, moneyValue(kasbon.sisaKasbon ?? (moneyValue(kasbon.jumlah ?? kasbon.amount ?? 0) - moneySum(kasbon.cicilan || [], (c) => c.jumlah ?? c.amount ?? 0))));
    if (cicilan > sisaSekarang) return alert(`Bayar/cicil (${rupiah(cicilan)}) melebihi sisa kasbon (${rupiah(sisaSekarang)})`);

    setIsSaving(true);
    try {
      const newCicilan = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tanggal: tanggalCicilan || todayStr(),
        jumlah: cicilan,
        sumber: "manual",
      };
      const updatedCicilan = [...(kasbon.cicilan || []), newCicilan];
      // Sisa baru = sisa sekarang (sudah termasuk potongan gaji) dikurangi cicilan manual ini.
      const sisaBaru = Math.max(0, sisaSekarang - cicilan);
      const statusBaru = sisaBaru <= 0 ? "lunas" : "aktif";

      await updateDoc(doc(db, KASBON_COLLECTION, kasbonId), {
        cicilan: updatedCicilan,
        sisaKasbon: sisaBaru,
        status: statusBaru,
        updatedAt: new Date().toISOString(),
      });
      addAuditLog("Cicilan Kasbon", `${kasbon.employeeName} – ${rupiah(cicilan)}${statusBaru === "lunas" ? " (LUNAS)" : ""}`);
    } catch (e) { alert("Gagal simpan cicilan: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("kasbon"); }
  }

  async function hapusKasbon(kasbonId) {
    const kasbon = kasbonList.find((k) => k.id === kasbonId);
    if (!kasbon) return;
    const totalKasbon = moneyValue(kasbon.jumlah ?? kasbon.amount ?? 0);
    if (!window.confirm(`Hapus kasbon ${kasbon.employeeName} (${rupiah(totalKasbon)})? Data ini tidak bisa dikembalikan.`)) return;
    setIsSaving(true);
    try {
      await deleteDoc(doc(db, KASBON_COLLECTION, kasbonId));
      addAuditLog("Hapus Kasbon", `${kasbon.employeeName} – ${rupiah(totalKasbon)}`);
    } catch (e) { alert("Gagal hapus kasbon: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("kasbon"); }
  }

  // Batalkan cicilan rekap_gaji (potongan dari Gallery Produksi) — kembalikan sisa kasbon.
  // Dipakai jika admin salah input gajian atau gajian dibatalkan di Gallery Produksi.
  async function batalCicilanRekap(kasbonId, cicilan) {
    const kasbon = kasbonList.find((k) => k.id === kasbonId);
    if (!kasbon) return;
    const jumlahCicilan = parseMoney(cicilan.jumlah ?? cicilan.amount ?? 0);
    if (jumlahCicilan <= 0) return;
    const periodeInfo = cicilan.periodeGajiDari && cicilan.periodeGajiSampai
      ? ` (periode ${cicilan.periodeGajiDari} s/d ${cicilan.periodeGajiSampai})`
      : "";
    if (!window.confirm(`Batalkan potongan gaji ${rupiah(jumlahCicilan)} untuk ${kasbon.employeeName}${periodeInfo}?\n\nIni akan mengembalikan sisa kasbon sebesar ${rupiah(jumlahCicilan)}. Pastikan gajian terkait sudah dibatalkan di Gallery Produksi.`)) return;
    setIsSaving(true);
    try {
      const existingCicilan = Array.isArray(kasbon.cicilan) ? kasbon.cicilan : [];
      const updatedCicilan = existingCicilan.filter((c) => c.id !== cicilan.id);
      const sisaSekarang = Math.max(0, parseMoney(kasbon.sisaKasbon ?? 0));
      const sisaBaru = Math.min(parseMoney(kasbon.jumlah ?? kasbon.amount ?? 0), sisaSekarang + jumlahCicilan);
      const statusBaru = sisaBaru <= 0 ? "lunas" : "aktif";
      await updateDoc(doc(db, KASBON_COLLECTION, kasbonId), {
        cicilan: updatedCicilan,
        sisaKasbon: sisaBaru,
        status: statusBaru,
        updatedAt: new Date().toISOString(),
      });
      addAuditLog("Batal Cicilan Rekap Gaji", `${kasbon.employeeName} – ${rupiah(jumlahCicilan)} dikembalikan${periodeInfo}`);
    } catch (e) { alert("Gagal membatalkan cicilan: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("kasbon"); }
  }

  async function tambahMasterPekerja(nama) {
    const clean = (nama || "").trim();
    if (!clean) return alert("Nama pekerja tidak boleh kosong.");
    const sudahAda = masterPekerja.some(p => p.nama?.toLowerCase() === clean.toLowerCase());
    if (sudahAda) return alert(`Nama "${clean}" sudah ada dalam daftar.`);
    setIsSaving(true);
    try {
      await addDoc(collection(db, "master_pekerja"), { nama: clean, createdAt: new Date().toISOString() });
      setNamaPekerjaInput("");
    } catch (e) { alert("Gagal menambah pekerja: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("masterPekerja"); }
  }

  async function hapusMasterPekerja(id, nama) {
    if (!window.confirm(`Hapus "${nama}" dari daftar pekerja?`)) return;
    setIsSaving(true);
    try {
      await deleteDoc(doc(db, "master_pekerja", id));
    } catch (e) { alert("Gagal hapus pekerja: " + e.message); }
    finally { setIsSaving(false); scheduleRefresh("masterPekerja"); }
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
    // Targeted: hanya refresh collection yang benar-benar diubah
    const collectionsToRefresh = type === "purchases"
      ? ["purchases", "materials"]
      : type === "orders" ? ["orders"]
      : type === "expenses" ? ["expenses"]
      : type === "transfers" ? ["transfers"]
      : type === "transfersOut" ? ["transfersOut"]
      : ["orders"]; // fallback
    scheduleRefresh(...collectionsToRefresh);
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
      scheduleRefresh("purchases", "transfersOut");
    }
  }

  async function tandaiDikirim() {
    if (!kirimModal) return;
    const order = orders.find((o) => o.id === kirimModal);
    if (!order) return alert("Pesanan tidak ditemukan.");

    const cleanDeliveryItems = kirimItems
      .map((it, idx) => ({
        itemIndex: Number(it.itemIndex ?? idx),
        name: it.name || "Produk",
        qty: Number(it.shippedQty || 0),
        shippedQty: Number(it.shippedQty || 0),
        orderedQty: Number(it.orderedQty || 0),
        price: parseMoney(it.price || 0),
        bahanCost: parseMoney(it.bahanCost || 0),
        hppPerPcs: parseMoney(it.hppPerPcs || 0),
        mainMaterial: it.mainMaterial || "",
        materialQtyPerPcs: Number(it.materialQtyPerPcs || 0),
        unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit),
        hppMaterials: it.hppMaterials || [],
      }))
      .filter((it) => it.name && it.qty > 0);

    if (cleanDeliveryItems.length === 0) return alert("Isi minimal 1 qty pengiriman hari ini.");

    // Sumber order items untuk kalkulasi shippedItems total
    const orderItems = normalizeOrderItems(order);
    const newDelivery = {
      date: tanggalKirim || todayStr(),
      createdAt: new Date().toISOString(),
      source: "gallery-kerudung-koreksi",
      items: cleanDeliveryItems,
      total: deliveryItemsTotal(cleanDeliveryItems.map((it) => ({ qty: it.qty, price: it.price }))),
    };
    const nextDeliveries = [...getDeliveryHistory(order), newDelivery];
    const tempOrder = { ...order, deliveries: nextDeliveries };

    // Hitung shippedItems ringkasan per item (sama seperti addPengiriman di Produksi)
    const shippedItems = orderItems.map((base, idx) => {
      const totalShippedForItem = nextDeliveries.reduce((sum, delivery) => {
        const found = (delivery.items || []).find((it) =>
          it.itemIndex !== undefined ? Number(it.itemIndex) === idx : normalizeName(it.name) === normalizeName(base.name)
        );
        return sum + Number(found?.qty ?? found?.shippedQty ?? 0);
      }, 0);
      const diff = totalShippedForItem - Number(base.qty || 0);
      return {
        name: base.name,
        orderedQty: Number(base.qty || 0),
        shippedQty: totalShippedForItem,
        price: parseMoney(base.price || 0),
        bahanCost: parseMoney(base.bahanCost || 0),
        hppPerPcs: parseMoney(base.hppPerPcs || 0),
        mainMaterial: base.mainMaterial || "",
        materialQtyPerPcs: Number(base.materialQtyPerPcs || 0),
        unit: base.unit || "yard",
        note: diff === 0 ? "Sesuai pesanan" : diff < 0 ? `Kekurangan pengiriman ${Math.abs(diff)} pcs` : `Kelebihan pengiriman ${diff} pcs`,
      };
    });

    const totalOrdered = shippedItems.reduce((s, it) => s + Number(it.orderedQty || 0), 0);
    const totalShipped = shippedItems.reduce((s, it) => s + Number(it.shippedQty || 0), 0);
    const deliveredTotal = billableOrderTotal(tempOrder);
    const deliveredHppTotal = billableOrderHppTotal(tempOrder);
    const deliveryStatus = orderDeliveryStatus(tempOrder);
    const paid = orderPaidTotal(order);
    const newStatus = paid >= deliveredTotal && deliveredTotal > 0 && deliveryStatus === "Selesai" ? "Lunas" : deliveryStatus;

    setIsSaving(true);
    const usage = buildMaterialUsageFromDeliveryItems(cleanDeliveryItems);
    let stockDeducted = false;
    try {
      if (usage.length > 0) {
        await applyMaterialMovements(usage, {
          direction: -1, refType: "delivery", refId: kirimModal,
          refLabel: order.invoice || order.customer || "Koreksi Pengiriman",
          date: tanggalKirim || todayStr(), note: "Pemakaian bahan saat koreksi pengiriman",
        });
        stockDeducted = true;
      }

      // Tulis semua field yang sama dengan addPengiriman di Produksi
      // agar badge dan status di Produksi tetap sinkron.
      await updateDoc(doc(db, "orders", kirimModal), {
        status: newStatus,
        deliveryStatus,
        shippingStatus: deliveryStatus,
        tanggalKirim: tanggalKirim || todayStr(),
        deliveries: nextDeliveries,
        shippedItems,
        totalKirim: totalShipped,
        totalPesan: totalOrdered,
        deliveredTotal,
        deliveredHppTotal,
        updatedAt: todayStr(),
      });

      addAuditLog("Koreksi Pengiriman", `${order.customer} - ${rupiah(deliveredTotal)}`);
      setKirimModal(null); setTanggalKirim(todayStr()); setKirimItems([]);
    } catch (e) {
      try {
        if (stockDeducted && usage.length > 0) {
          await applyMaterialMovements(usage, {
            direction: 1, refType: "delivery_rollback", refId: kirimModal,
            refLabel: order.invoice || order.customer || "Rollback",
            date: tanggalKirim || todayStr(), note: "Rollback stok koreksi",
          });
        }
      } catch (rb) { console.warn("Rollback stok gagal:", rb); }
      alert("Gagal menyimpan: " + e.message);
    } finally {
      setIsSaving(false);
      scheduleRefresh("orders", "materials");
    }
  }

  function openKirimModal(order) {
    const orderItems = normalizeOrderItems(order);
    const deliveryItems = normalizeShipmentItems(order).map((it, idx) => {
      const base = orderItems[idx] || orderItems.find((o) => normalizeName(o.name) === normalizeName(it.name)) || {};
      const remaining = Math.max(Number(it.orderedQty || 0) - Number(it.shippedQty || 0), 0);
      return {
        itemIndex: idx,
        name: it.name,
        orderedQty: Number(it.orderedQty || 0),
        alreadyShipped: Number(it.shippedQty || 0),
        remainingQty: remaining,
        shippedQty: remaining,
        price: moneyValue(it.price || 0),
        bahanCost: moneyValue(it.bahanCost || 0),
        hppPerPcs: moneyValue(it.hppPerPcs || 0),
        mainMaterial: it.mainMaterial || base.mainMaterial || "",
        materialQtyPerPcs: Number(it.materialQtyPerPcs || base.materialQtyPerPcs || 0),
        unit: it.unit || base.unit || "yard",
        hppMaterials: base.hppMaterials || [],
        note: it.note || shipmentAutoNote(Number(it.orderedQty || 0), Number(it.shippedQty || 0)),
      };
    });
    setKirimModal(order.id); setTanggalKirim(todayStr()); setKirimItems(deliveryItems);
  }

  async function hapusDelivery(order, deliveryIndex) {
    if (!order?.id) return;
    const deliveries = getDeliveryHistory(order);
    const target = deliveries[deliveryIndex];
    if (!target) return;
    const tgl = target.date || "-";
    const totalPcs = (target.items || []).reduce((s, it) => s + Number(it.qty || it.shippedQty || 0), 0);
    const ok = window.confirm(`Hapus riwayat pengiriman tanggal ${tgl} (${totalPcs.toLocaleString("id-ID")} pcs)?\n\nStok bahan akan dikembalikan. Data ini tidak bisa dikembalikan.`);
    if (!ok) return;

    setIsSaving(true);

    // Rollback stok bahan yang sempat dikurangi saat pengiriman ini diinput.
    // Hanya delivery dari Gallery Kerudung (source: gallery-kerudung-koreksi) yang
    // mencatat usage bahan; delivery dari Produksi tidak mengurangi stok di sini.
    const deliveryItems = target.items || [];
    const usage = buildMaterialUsageFromDeliveryItems(deliveryItems);

    try {
      // Kembalikan stok dulu (best-effort; jika gagal, lanjut hapus delivery)
      if (usage.length > 0) {
        try {
          await applyMaterialMovements(usage, {
            direction: 1, refType: "delivery_rollback", refId: order.id,
            refLabel: order.invoice || order.customer || "Hapus Delivery",
            date: tgl, note: "Rollback stok dari hapus riwayat pengiriman",
          });
        } catch (stockErr) {
          throw new Error("Rollback stok delivery gagal, proses hapus dibatalkan: " + (stockErr?.message || stockErr));
        }
      }

      const nextDeliveries = deliveries.filter((_, i) => i !== deliveryIndex);
      const tempOrder = { ...order, deliveries: nextDeliveries };
      const deliveredTotal = billableOrderTotal(tempOrder);
      const deliveredHppTotal = billableOrderHppTotal(tempOrder);
      const deliveryStatus = orderDeliveryStatus(tempOrder);
      const paid = orderPaidTotal(order);
      const newStatus = paid >= deliveredTotal && deliveredTotal > 0 && deliveryStatus === "Selesai" ? "Lunas" : deliveryStatus;

      // Hitung ulang shippedItems dari deliveries yang tersisa
      const orderItems = normalizeOrderItems(order);
      const shippedItems = orderItems.map((base, idx) => {
        const shipped = nextDeliveries.reduce((sum, delivery) => {
          const found = (delivery.items || []).find((it) =>
            it.itemIndex !== undefined ? Number(it.itemIndex) === idx : normalizeName(it.name) === normalizeName(base.name)
          );
          return sum + Number(found?.qty ?? found?.shippedQty ?? 0);
        }, 0);
        const diff = shipped - Number(base.qty || 0);
        return {
          name: base.name, orderedQty: Number(base.qty || 0), shippedQty: shipped,
          price: parseMoney(base.price || 0), hppPerPcs: parseMoney(base.hppPerPcs || 0),
          note: diff === 0 ? "Sesuai pesanan" : diff < 0 ? `Kekurangan pengiriman ${Math.abs(diff)} pcs` : `Kelebihan pengiriman ${diff} pcs`,
        };
      });

      await updateDoc(doc(db, "orders", order.id), {
        deliveries: nextDeliveries,
        shippedItems,
        totalKirim: shippedItems.reduce((s, it) => s + Number(it.shippedQty || 0), 0),
        deliveredTotal,
        deliveredHppTotal,
        deliveryStatus,
        shippingStatus: deliveryStatus,
        status: newStatus,
        updatedAt: todayStr(),
      });

      addAuditLog("Hapus Riwayat Pengiriman", `${order.customer} · ${order.invoice || "-"} · tgl ${tgl} · ${totalPcs} pcs`);
      alert("Riwayat pengiriman dihapus");
    } catch (e) {
      alert("Gagal menghapus: " + (e?.message || e));
    } finally {
      setIsSaving(false);
      scheduleRefresh("orders", "materials");
    }
  }

  // ── Retur ────────────────────────────────────────────────────────────────
  // Catatan retur murni sebagai pencatatan/pelacakan, TIDAK mengubah tagihan/invoice/
  // saldo pesanan sama sekali — admin yang menyesuaikan tagihan secara manual di luar fitur ini.
  function openReturModal(order) {
    setReturModal(order);
    setReturForm({ itemIndex: 0, qty: "", alasan: "", kondisi: "bisa_dijual_lagi", catatan: "", tanggal: todayStr() });
  }

  async function simpanRetur() {
    if (!returModal) return;
    const order = returModal;
    const orderItems = normalizeOrderItems(order);
    const item = orderItems[Number(returForm.itemIndex) || 0];
    if (!item) return alert("Item pesanan tidak ditemukan.");
    const qty = Number(returForm.qty || 0);
    if (qty <= 0) return alert("Isi jumlah barang yang diretur.");
    if (!returForm.alasan?.trim()) return alert("Isi alasan retur.");
    if (qty > Number(item.qty || 0)) {
      const lanjut = window.confirm(`Jumlah retur (${qty} pcs) lebih besar dari jumlah item ini di pesanan (${item.qty || 0} pcs). Yakin mau lanjut simpan?`);
      if (!lanjut) return;
    }

    setIsSaving(true);
    try {
      await addDoc(collection(db, "returns"), {
        orderId: order.id,
        invoice: order.invoice || "",
        customer: order.customer || "",
        itemName: item.name || "Produk",
        itemIndex: Number(returForm.itemIndex) || 0,
        qty,
        price: moneyValue(item.price || 0),
        alasan: returForm.alasan.trim(),
        kondisi: returForm.kondisi, // "bisa_dijual_lagi" | "rusak"
        statusJualUlang: returForm.kondisi === "bisa_dijual_lagi" ? "belum_terjual" : null,
        catatan: returForm.catatan || "",
        tanggal: returForm.tanggal || todayStr(),
        createdAt: todayStr(),
        createdBy: user?.email || "",
      });
      addAuditLog("Input Retur", `${order.customer} · ${order.invoice || "-"} · ${item.name} ${qty} pcs · ${returForm.alasan.trim()}`);
      setReturModal(null);
      alert("↩️ Retur tersimpan.");
    } catch (e) {
      alert("Gagal menyimpan retur: " + (e?.message || e));
    } finally {
      setIsSaving(false);
      scheduleRefresh("returns");
    }
  }

  async function tandaiReturTerjual(retur) {
    if (!retur?.id) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "returns", retur.id), {
        statusJualUlang: retur.statusJualUlang === "sudah_terjual" ? "belum_terjual" : "sudah_terjual",
        updatedAt: todayStr(),
      });
    } catch (e) {
      alert("Gagal mengubah status: " + (e?.message || e));
    } finally {
      setIsSaving(false);
      scheduleRefresh("returns");
    }
  }

  async function hapusRetur(retur) {
    if (!retur?.id) return;
    if (!window.confirm(`Hapus catatan retur ${retur.itemName} (${retur.qty} pcs) dari ${retur.customer}?`)) return;
    setIsSaving(true);
    try {
      await deleteDoc(doc(db, "returns", retur.id));
    } catch (e) {
      alert("Gagal menghapus: " + (e?.message || e));
    } finally {
      setIsSaving(false);
      scheduleRefresh("returns");
    }
  }

  // Pintasan: kurangi tagihan pesanan sebesar nilai retur, TANPA mengubah data pesanan/
  // pengiriman (order.items, shipment_batches, dsb).
  //
  // PENTING (perbaikan bug 2026-07-22): versi awal fungsi ini mengurangi qty di
  // order.items — tapi tagihan pesanan TIDAK pernah dihitung dari order.items.
  // Tagihan dihitung dari data pengiriman (officialShipmentSubtotalForOrder / shipment_batches
  // dari Gallery Produksi, atau getDeliveryHistory/shippedItems di GK). Akibatnya mengurangi
  // qty di order.items tidak berpengaruh apa pun ke tagihan/invoice — retur yang sudah
  // "dikurangi" tetap menyisakan tagihan yang sama seperti sebelum dikurangi.
  // Perbaikan: catat nominal koreksi HANYA di dokumen retur (tagihanDikurangiNominal),
  // lalu orderPaymentTarget() (dipakai Dashboard/Piutang/Invoice) mengurangi total tagihan
  // pesanan itu dengan jumlah koreksi ini lewat returAdjustmentForOrder(). Data pesanan asli
  // (qty, item, riwayat pengiriman) tidak disentuh sama sekali — jadi aman dari efek samping.
  async function kurangiTagihanDariRetur(retur) {
    if (!retur?.orderId && !retur?.invoice) return alert("Pesanan asal tidak ditemukan.");
    const order = orders.find((o) => o.id === retur.orderId) || orders.find((o) => retur.invoice && o.invoice === retur.invoice);
    if (!order) return alert("Pesanan asal sudah tidak ada (mungkin sudah dihapus).");

    const nominalPengurangan = Math.round(Number(retur.qty || 0) * moneyValue(retur.price || 0));
    if (nominalPengurangan <= 0) return alert("Nilai retur ini Rp 0, tidak ada yang bisa dikurangi dari tagihan.");

    const ok = window.confirm(`Kurangi tagihan pesanan ${order.invoice || order.customer} sebesar ${rupiah(nominalPengurangan)}, karena retur "${retur.itemName}" (${retur.qty} pcs)?\n\nIni hanya mengoreksi total tagihan customer — data pesanan/pengiriman tidak ikut berubah.`);
    if (!ok) return;

    setIsSaving(true);
    try {
      await updateDoc(doc(db, "returns", retur.id), {
        tagihanDikurangi: true, tagihanDikurangiAt: todayStr(), tagihanDikurangiNominal: nominalPengurangan,
      });
      addAuditLog("Kurangi Tagihan dari Retur", `${order.customer} · ${order.invoice || "-"} · ${retur.itemName} ${retur.qty} pcs · -${rupiah(nominalPengurangan)}`);
      alert(`✅ Tagihan berhasil dikurangi ${rupiah(nominalPengurangan)}.`);
    } catch (e) {
      alert("Gagal mengurangi tagihan: " + (e?.message || e));
    } finally {
      setIsSaving(false);
      scheduleRefresh("orders", "returns");
    }
  }

  // Pintasan: buka form pesanan baru dengan produk & harga sudah keisi dari data retur.
  // Setelah pesanan baru itu berhasil disimpan, retur ini otomatis ditandai "sudah terjual".
  function jualLagiRetur(retur) {
    openOrderModal({
      date: todayStr(), customer: "", phone: "",
      items: [{
        name: retur.itemName || "", category: "Lainnya", qty: retur.qty || "",
        price: moneyValue(retur.price || 0), bahanCost: 0, hppPerPcs: 0,
        mainMaterial: "", materialQtyPerPcs: 0, unit: "yard",
      }],
      shippingCost: 0, dp: 0,
    });
    setReturJualPending(retur.id);
  }

  function statusSetelahPembayaran(order, payments = order?.payments || []) {
    const paid = (payments || []).reduce((s, p) => s + moneyValue(p.amount || 0), 0);
    const tagihan = orderPaymentTarget({ ...order, payments });
    const deliveryStatus = orderDeliveryStatus(order);
    if (isFinalDeliveryStatus(deliveryStatus) && tagihan > 0 && paid >= tagihan) return "Lunas";
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
      const sisaTagihan = Math.max(0, sisaPurchase(purchase));
      if (sisaTagihan <= 0) continue;
      const bayar = Math.min(sisa, sisaTagihan);
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

    const totalTagihan = hutangPurchase(purchase);
    if (totalTagihan <= 0) return alert("Data supplier ini sudah tidak memiliki tagihan aktif.");

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
      `Sisa tagihan data ini: ${rupiah(totalTagihan)}\n\n` +
      `Transfer akan ditempel ke data supplier ini tanpa membuat kas keluar baru.`
    );
    if (!lanjut) return;

    let sisaTagihan = totalTagihan;
    const restoredPayments = [];

    for (const transfer of relatedTransfers) {
      if (sisaTagihan <= 0) break;
      const transferAmount = moneyValue(transfer.amount || 0);
      const amount = Math.min(transferAmount, sisaTagihan);
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

      sisaTagihan -= amount;
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
        const cleanItems = normalizeOrderItems(editData).map((it) => ({ productId: it.productId || "", name: String(it.name || "").trim(), category: capitalizeWords(it.category || "Lainnya"), qty: Number(it.qty || 0), price: moneyValue(it.price || 0), bahanCost: moneyValue(it.bahanCost || 0), hppPerPcs: moneyValue(it.hppPerPcs || 0), mainMaterial: it.mainMaterial || "", materialQtyPerPcs: Number(it.materialQtyPerPcs || 0), unit: normalizeMaterialUnit(it.mainMaterial || it.name, it.unit), hppMaterials: normalizeHppMaterials(it) })).filter((it) => it.name && it.qty > 0);
        const subtotal = orderItemsTotal(cleanItems);
        const shippingCost = moneyValue(editData.shippingCost || editData.ongkir || 0);
        const total = subtotal + shippingCost;
        const firstItem = cleanItems[0] || {};
        const originalOrder = orders.find((o) => o.id === id) || {};
        const originalItems = normalizeOrderItems(originalOrder);
        const changedPriceItems = cleanItems.filter((it, idx) => {
          const original = findMatchingOrderItem(originalItems, it, idx) || originalItems[idx] || {};
          const oldPrice = firstPositiveMoney(original?.price, original?.harga, original?.hargaJual, original?.hargaPcs, original?.sellingPrice, original?.salePrice, original?.unitPrice, original?.hargaSatuan);
          const newPrice = moneyValue(it.price || 0);
          return newPrice > 0 && (!oldPrice || newPrice !== oldPrice);
        });
        if (changedPriceItems.length > 0) await upsertProductMastersFromOrder(changedPriceItems);
        payload = { customer: capitalizeWords(editData.customer || ""), phone: editData.phone || "", items: cleanItems, item: firstItem.name || "", qty: cleanItems.reduce((s, it) => s + Number(it.qty || 0), 0), hargaPcs: moneyValue(firstItem.price || 0), subtotal, shippingCost, ongkir: shippingCost, total, status: editData.status || "Proses", createdAt: editData.createdAt || todayStr() };
      } else if (type === "purchases") {
        const cleanMaterials = normalizePurchaseMaterials(editData).map((it) => {
          const materialName = capitalizeWords(it.name || "");
          const qty = numberValue(it.qty || 0);
          const pricePerUnit = moneyValue(it.pricePerUnit || 0);
          return { name: materialName, category: it.category || "Kain", qty, unit: normalizeMaterialUnit(materialName, it.unit), pricePerUnit, total: qty * pricePerUnit };
        }).filter((it) => it.name && it.qty > 0 && it.pricePerUnit > 0);
        const subtotal = cleanMaterials.length > 0 ? purchaseMaterialsTotal(cleanMaterials) : moneyValue(editData.subtotal || editData.total || 0);
        const shippingCost = moneyValue(editData.shippingCost ?? editData.ongkir ?? 0);
        const total = subtotal + shippingCost;
        const firstMaterial = cleanMaterials[0] || {};
        payload = {
          supplier: editData.supplier || "",
          materials: cleanMaterials,
          material: cleanMaterials.map((it) => it.name).join(", ") || editData.material || "Bahan Baku",
          qty: cleanMaterials.map((it) => `${it.qty} ${it.unit}`).join(", ") || editData.qty || "",
          category: firstMaterial.category || editData.category || "Kain",
          subtotal,
          shippingCost,
          ongkir: shippingCost,
          total,
          createdAt: editData.createdAt || todayStr()
        };
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
        addAuditLog("Edit Transfer Keluar", `${payload.supplier} - ${rupiah(payload.amount)}${alokasi.length ? " · realokasi tagihan" : ""}`);
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
          if (oldPurchase) {
            await updateDoc(doc(db, type, id), {
              supplier: oldPurchase.supplier || "",
              materials: normalizePurchaseMaterials(oldPurchase),
              material: oldPurchase.material || "",
              qty: oldPurchase.qty || "",
              category: oldPurchase.category || "Kain",
              subtotal: purchaseMaterialsTotal(normalizePurchaseMaterials(oldPurchase)),
              shippingCost: moneyValue(oldPurchase.shippingCost ?? oldPurchase.ongkir ?? 0),
              ongkir: moneyValue(oldPurchase.shippingCost ?? oldPurchase.ongkir ?? 0),
              total: purchaseInvoiceTotal(oldPurchase),
              createdAt: oldPurchase.createdAt || todayStr(),
              payments: oldPurchase.payments || []
            });
            if (oldStockRolledBack) await applyPurchaseStock(oldPurchase);
          }
        } catch (restoreErr) { console.warn("Restore edit supplier gagal:", restoreErr); }
        throw purchaseErr;
      }
      addAuditLog("Edit Data", `${type} - ${id}`); setEditData(null);
    } catch (e) { alert("Gagal menyimpan: " + e.message); }
    finally {
      setIsSaving(false);
      // Targeted: pilih collection sesuai type yang diedit
      const { type: t } = editData || {};
      if (t === "purchases") scheduleRefresh("purchases", "materials");
      else if (t === "orders") scheduleRefresh("orders");
      else if (t === "expenses") scheduleRefresh("expenses");
      else if (t === "transfers") scheduleRefresh("transfers", "orders");
      else if (t === "transfersOut") scheduleRefresh("transfersOut", "purchases");
      else scheduleRefresh("orders");
    }
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
      const bahanSubtotal = purchaseMaterialsTotal(bahanList);
      let akumulasiDibayar = 0; let akumulasiSisa = 0;
      bahanList.forEach((bahan, idx) => {
        const bahanTotal = purchaseMaterialTotal(bahan);
        const proporsi = bahanSubtotal > 0 ? bahanTotal / bahanSubtotal : 0;
        const isLast = idx === bahanList.length - 1;
        const dibayarMaterialTotal = Math.min(sudahDibayar, bahanSubtotal);
        const sisaMaterialTotal = Math.min(sisaUtang, bahanSubtotal);
        const dibayarBaris = isLast ? Math.max(0, dibayarMaterialTotal - akumulasiDibayar) : Math.round(dibayarMaterialTotal * proporsi);
        const sisaBaris = isLast ? Math.max(0, sisaMaterialTotal - akumulasiSisa) : Math.round(sisaMaterialTotal * proporsi);
        akumulasiDibayar += dibayarBaris; akumulasiSisa += sisaBaris;
        rows.push({ tanggalBelanja: purchase.createdAt || "", supplier: purchase.supplier || "", jenisBahan: bahan.name || "Bahan Baku", kategori: bahan.category || "Kain", banyak: `${Number(bahan.qty || 0).toLocaleString("id-ID")} ${bahan.unit || "yard"}`, hargaSatuan: moneyValue(bahan.pricePerUnit || 0), totalBelanja: bahanTotal, sudahDibayar: dibayarBaris, sisaUtang: sisaBaris });
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

  async function downloadFinancialRekapPdf(period) {
    const { jsPDF, autoTable } = await loadPdfTools();
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

  async function downloadSupplierRekapPdf(period) {
    const { jsPDF, autoTable } = await loadPdfTools();
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
      head: [["Tanggal", "Supplier", "Jenis Bahan", "Banyak", "Total", "Dibayar", "Sisa Tagihan"]],
      body: rows.map((r) => [r.tanggalBelanja || "-", r.supplier || "-", r.jenisBahan || "-", r.banyak || "-", rupiah(r.totalBelanja), rupiah(r.sudahDibayar), rupiah(r.sisaUtang)]),
      foot: [["", "", "", "TOTAL", rupiah(totalBelanja), rupiah(totalDibayar), rupiah(totalSisa)]],
      theme: "grid", headStyles: { fillColor: [168, 85, 247], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [253, 242, 248], textColor: [190, 24, 93], fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    });
    pdf.save(`rekap-supplier-${label}.pdf`);
  }

  async function downloadCustomerRekapPdf(period) {
    const { jsPDF, autoTable } = await loadPdfTools();
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

  async function downloadLabaRugiPdf() {
    const { jsPDF, autoTable } = await loadPdfTools();
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Laporan Laba Rugi & Cashflow", "all");
    const bs = businessSummary;
    const rows = [
      ["Total Pesanan Awal", rupiah(bs.totalPesananAwal)],
      ["Realisasi Penjualan", rupiah(bs.totalRealisasi)],
      ["Total Belanja Supplier", rupiah(bs.totalBelanjaSupplier)],
      ["Nilai Stok Bahan", rupiah(bs.nilaiStok)],
      ["HPP Terkirim Final", rupiah(bs.estimasiHppBahanTerpakai)],
      ["Gaji Produksi (info, sudah masuk HPP)", rupiah(bs.totalGajiProduksi)],
      ["Total Pengeluaran Operasional", rupiah(bs.totalPengeluaran)],
      ["Laba Kotor", rupiah(bs.labaKotor)],
      [bs.labaBersih < 0 ? "Rugi Bersih" : "Laba Bersih", `${bs.labaBersih < 0 ? "-" : ""}${rupiah(Math.abs(bs.labaBersih))}`],
      ["Status Laba", bs.hppIsValid ? "Valid" : `Belum valid (${Number(bs.hppMissingQty || 0).toLocaleString("id-ID")} pcs tanpa HPP final)`],
      ["Transfer Masuk dari Bayar Customer", rupiah(bs.totalPembayaranCustomer)],
      ["Realisasi Pembayaran ke Supplier", rupiah(bs.totalBayarSupplier)],
      ["Cashflow Bersih", rupiah(bs.cashflowBersih)],
      ["Piutang Customer", rupiah(bs.piutang)],
      ["Tagihan Supplier", rupiah(bs.hutangSupplier)],
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

  function productMasterHppValue(product) {
    if (!product) return 0;
    return Math.max(0,
      componentHpp(product),
      firstPositiveMoney(
        product?.hppPerPcs,
        product?.hpp,
        product?.hppFinal,
        product?.finalHpp,
        product?.hppSatuan,
        product?.hppFinalPerPcs,
        product?.totalHppPerPcs,
        product?.costPerPcs,
        product?.modalPerPcs,
        product?.modalPcs,
        product?.modalSatuan,
        product?.hargaModal,
        product?.hargaPokok,
        product?.unitCost,
        product?.unitHpp,
        product?.finalCost,
        product?.cost,
        product?.modal
      ),
      calculateProductHpp(product)
    );
  }

  function productNameCandidates(item) {
    return [
      item?.name,
      item?.item,
      item?.productName,
      item?.namaProduk,
      item?.title,
      item?.displayName,
      item?.masterName,
      item?.baseProductName,
      item?.variantName,
      item?.originalName,
      item?.oldName,
      item?.previousName,
      item?.sku,
      item?.code,
      item?.kode,
    ].map((x) => normalizeName(x || "")).filter(Boolean);
  }

  function productMasterForItem(item) {
    const productId = item?.productId || item?.product_id || item?.masterProductId || "";
    const byId = productId ? productMasters.find((p) => p.id === productId) : null;

    const itemNames = Array.from(new Set(productNameCandidates(item)));
    const masters = (productMasters || []).filter((p) => normalizeName(p.name || ""));

    // Kalau productId masih mengarah ke master lama yang HPP-nya kosong,
    // jangan langsung berhenti di master lama. Cari lagi berdasarkan nama terbaru
    // dari pesanan customer, supaya setelah nama produk diedit HPP ikut terbaca.
    if (byId && productMasterHppValue(byId) > 0) return byId;
    if (itemNames.length === 0) return byId || null;

    const exactMatches = masters.filter((p) => itemNames.includes(normalizeName(p.name || "")));
    const exactWithHpp = exactMatches.find((p) => productMasterHppValue(p) > 0);
    if (exactWithHpp) return exactWithHpp;
    if (byId && exactMatches.length === 0) return byId;
    if (exactMatches.length > 0) return exactMatches[0];

    // Fallback untuk data lama: kadang item pesanan hanya berubah nama,
    // sementara link productId/HPP lama tidak ikut tersimpan. Cocokkan nama yang
    // sangat mirip dan prioritaskan master yang sudah punya HPP.
    const scored = masters.map((p) => {
      const masterName = normalizeName(p.name || "");
      const masterTokens = masterName.split(" ").filter(Boolean);
      let score = 0;
      itemNames.forEach((itemName) => {
        const itemTokens = itemName.split(" ").filter(Boolean);
        const common = itemTokens.filter((w) => masterTokens.includes(w)).length;
        const ratio = Math.max(itemTokens.length, masterTokens.length) > 0 ? common / Math.max(itemTokens.length, masterTokens.length) : 0;
        const contains = itemName.length >= 4 && masterName.length >= 4 && (itemName.includes(masterName) || masterName.includes(itemName));
        const nextScore = contains ? 0.95 : ratio;
        if (nextScore > score) score = nextScore;
      });
      return { product: p, score, hasHpp: productMasterHppValue(p) > 0 };
    })
      .filter((x) => x.score >= 0.75)
      .sort((a, b) => (Number(b.hasHpp) - Number(a.hasHpp)) || b.score - a.score);

    return scored[0]?.product || byId || null;
  }

  function firstPositiveMoney(...values) {
    for (const value of values) {
      const n = moneyValue(value || 0);
      if (n > 0 && isReasonableMoney(n)) return n;
    }
    return 0;
  }

  function hppFromTotalFields(item, qtyHint = 0) {
    const qty = Number(qtyHint || item?.shippedQty || item?.qty || item?.orderedQty || 0);
    if (qty <= 0) return 0;
    const totalHpp = firstPositiveMoney(
      item?.deliveredHppTotal,
      item?.deliveryHppTotal,
      item?.hppTotal,
      item?.totalHpp,
      item?.hppSubtotal,
      item?.totalCost,
      item?.costTotal
    );
    return totalHpp > 0 ? Math.round(totalHpp / qty) : 0;
  }

  function componentHpp(product) {
    return firstPositiveMoney(product?.bahanCost || product?.materialCost || 0)
      + firstPositiveMoney(product?.productionCost || 0)
      + firstPositiveMoney(product?.accessoriesCost || product?.accessoryCost || product?.aksesorisCost || 0)
      + firstPositiveMoney(product?.packingCost || 0)
      + firstPositiveMoney(product?.distributionCost || 0)
      + firstPositiveMoney(product?.otherCost || 0);
  }

  function hppPerPcsForItem(item) {
    const master = productMasterForItem(item);
    const candidates = [];

    // 1) Total HPP tersimpan dari pengiriman/produksi dibagi qty kirim.
    candidates.push(hppFromTotalFields(item));

    // 2) HPP final per pcs yang tersimpan langsung di item pesanan/pengiriman.
    candidates.push(firstPositiveMoney(
      item?.hppPerPcs,
      item?.hpp,
      item?.hppFinal,
      item?.finalHpp,
      item?.hppSatuan,
      item?.hppFinalPerPcs,
      item?.totalHppPerPcs,
      item?.costPerPcs,
      item?.modalPerPcs,
      item?.modalPcs,
      item?.modalSatuan,
      item?.hargaModal,
      item?.hargaPokok,
      item?.unitCost,
      item?.unitHpp,
      item?.finalCost,
      item?.cost,
      item?.modal
    ));

    // 3) Komponen biaya item lama. HPP di app ini dianggap HPP final,
    //    jadi kalau komponen tersimpan lengkap kita pakai total komponennya.
    candidates.push(componentHpp(item));

    // 4) Master produk sebagai fallback sekaligus pembetul data order lama
    //    yang belum menyimpan HPP final.
    if (master) {
      candidates.push(productMasterHppValue(master));
    }

    // 5) Fallback terakhir: bahanCost. Ini menjaga HPP tidak nol,
    //    tapi Pusat Kendala tetap menandai jika data final HPP tidak lengkap.
    candidates.push(firstPositiveMoney(item?.bahanCost, item?.materialCost));

    const valid = candidates.filter((n) => Number(n || 0) > 0 && isReasonableMoney(n));
    if (valid.length === 0) return 0;

    // Jangan lagi mengambil nilai terbesar, karena pada data lama ada field total/modal
    // yang bisa terbaca sebagai HPP per pcs dan membuat laba produk menjadi minus palsu.
    // Prioritaskan HPP yang masuk akal terhadap harga jual item.
    const price = moneyValue(item?.price || item?.salePrice || item?.defaultPrice || 0);
    if (price > 0) {
      const notMinus = valid.find((n) => n <= price);
      if (notMinus > 0) return notMinus;
    }
    return valid[0];
  }

  function orderHppTotalWithMaster(order) {
    // Untuk laporan bisnis, HPP harus mengikuti basis yang sama dengan realisasi penjualan:
    // hanya barang yang sudah dikirim. Perhitungan memakai fallback HPP master/komponen/hasil produksi.
    return deliveryBusinessTotals(order).hpp;
  }

  function deliveryItemHppPerPcs(order, deliveryItem, fallbackIndex = null) {
    const base = orderItemForDeliveryItem(order, deliveryItem, fallbackIndex) || {};
    return hppPerPcsForItem({
      ...(deliveryItem || {}),
      ...base,
      name: base?.name || deliveryItem?.name,
      originalName: deliveryItem?.name || "",
      oldName: deliveryItem?.name || "",
      productId: base?.productId || base?.product_id || base?.masterProductId || deliveryItem?.productId || deliveryItem?.product_id || deliveryItem?.masterProductId || "",
    });
  }

  function deliveryLevelHppTotal(delivery) {
    return firstPositiveMoney(
      delivery?.deliveredHppTotal,
      delivery?.deliveryHppTotal,
      delivery?.hppTotal,
      delivery?.totalHpp,
      delivery?.hppSubtotal,
      delivery?.totalCost,
      delivery?.costTotal
    );
  }

  function orderLevelDeliveredHppTotal(order) {
    return firstPositiveMoney(
      order?.deliveredHppTotal,
      order?.deliveryHppTotal,
      order?.hppDeliveredTotal,
      order?.hppTotalDelivered,
      order?.totalDeliveredHpp,
      order?.hppTotal,
      order?.totalHpp
    );
  }

  function deliveryBusinessTotals(order, deliveryDatePredicate = null) {
    const deliveries = getDeliveryHistory(order);
    let revenue = 0;
    let hpp = 0;

    if (deliveries.length > 0) {
      deliveries.forEach((delivery) => {
        const d = delivery.date || delivery.tanggal || delivery.createdAt?.slice?.(0, 10) || order?.tanggalKirim || order?.createdAt || order?.date || "";
        if (deliveryDatePredicate && !deliveryDatePredicate(d)) return;
        let deliveryRevenue = 0;
        let deliveryItemHpp = 0;
        (delivery.items || []).forEach((it, itemIdx) => {
          const qty = Number(it.qty ?? it.shippedQty ?? 0);
          if (qty <= 0) return;
          const base = orderItemForDeliveryItem(order, it, itemIdx) || {};
          deliveryRevenue += qty * moneyValue(it.price ?? base.price ?? 0);
          deliveryItemHpp += qty * deliveryItemHppPerPcs(order, it, itemIdx);
        });
        revenue += deliveryRevenue;
        const deliveryTotalHpp = deliveryLevelHppTotal(delivery);
        hpp += Math.max(deliveryItemHpp, deliveryTotalHpp);
      });
      const hasIncludedDelivery = !deliveryDatePredicate || deliveries.some((delivery) => {
        const d = delivery.date || delivery.tanggal || delivery.createdAt?.slice?.(0, 10) || order?.tanggalKirim || order?.createdAt || order?.date || "";
        return deliveryDatePredicate(d);
      });
      if (hasIncludedDelivery && revenue > 0) revenue += orderShippingCost(order);
      return { revenue, hpp };
    }

    // Fallback untuk data lama yang hanya punya shippedItems/deliveredTotal tanpa deliveries.
    // Anggap tanggal realisasi dari tanggalKirim, lalu fallback ke tanggal order.
    const fallbackDate = order?.tanggalKirim || order?.deliveryDate || order?.shippingDate || order?.createdAt || order?.date || order?.tanggal || "";
    if (deliveryDatePredicate && !deliveryDatePredicate(fallbackDate)) return { revenue: 0, hpp: 0 };
    const revenueFallback = orderPaymentTarget(order);
    const itemHppFallback = normalizeShipmentItems(order).reduce((sum, it) => sum + Number(it.shippedQty || 0) * hppPerPcsForItem(it), 0);
    const totalHppFallback = orderLevelDeliveredHppTotal(order);
    return { revenue: revenueFallback, hpp: Math.max(itemHppFallback, totalHppFallback) };
  }

  function orderBusinessTotalsInRekap(order) {
    if (rekapDateBasis === "order") {
      if (!inRekapRange(order.createdAt || order.date || order.tanggal || "")) return { revenue: 0, hpp: 0 };
      return { revenue: orderPaymentTarget(order), hpp: orderHppTotalWithMaster(order) };
    }
    return deliveryBusinessTotals(order, (dateValue) => inRekapRange(dateValue));
  }

  function rekapScopedData() {
    const scopedOrders = (orders || []).filter((o) => {
      const totals = orderBusinessTotalsInRekap(o);
      if (totals.revenue > 0 || totals.hpp > 0) return true;
      if (rekapDateBasis === "order") return inRekapRange(o.createdAt || o.date || o.tanggal || "");
      return false;
    });
    const scopedPurchases = (purchases || []).filter((p) => inRekapRange(p.createdAt || p.date || p.tanggal || ""));
    const scopedExpenses = (expenses || []).filter((e) => inRekapRange(e.date || e.createdAt || ""));
    const scopedTransfers = (transfers || []).filter((t) => inRekapRange(t.date || t.createdAt || ""));
    const scopedTransfersOut = (transfersOut || []).filter((t) => inRekapRange(t.date || t.createdAt || ""));
    return { scopedOrders, scopedPurchases, scopedExpenses, scopedTransfers, scopedTransfersOut };
  }

  function rekapSummary() {
    const { scopedOrders, scopedPurchases, scopedExpenses, scopedTransfers, scopedTransfersOut } = rekapScopedData();
    const realisasi = scopedOrders.reduce((s, o) => s + orderBusinessTotalsInRekap(o).revenue, 0);
    const hpp = scopedOrders.reduce((s, o) => s + orderBusinessTotalsInRekap(o).hpp, 0);
    const bayarCustomer = scopedTransfers.reduce((s, t) => s + moneyValue(t.amount || 0), 0);
    const bayarSupplier = scopedTransfersOut.reduce((s, t) => s + moneyValue(t.amount || 0), 0);
    const pengeluaran = scopedExpenses.reduce((s, e) => s + moneyValue(e.amount || 0), 0);
    // Piutang customer adalah saldo hutang aktif saat ini, bukan angka periode.
    // Dashboard dan Rekap harus memakai satu sumber kebenaran yang sama agar tidak
    // muncul dua nominal piutang berbeda untuk customer yang sama. Filter tanggal
    // tetap berlaku untuk omzet/HPP/pembayaran/pengeluaran, tetapi piutang selalu
    // menunjukkan saldo belum lunas terbaru dari seluruh invoice terkirim.
    const piutang = totalPiutangCustomerAktif();
    const hutangSupplier = scopedPurchases.reduce((s, p) => s + Math.max(0, sisaPurchase(p)), 0);
    const gajiProduksi = payrollExpenseRows
      .filter((p) => inRekapRange(p.tanggalSetor || p.tanggalBayar || p.date || p.tanggal || p.createdAt?.slice?.(0, 10) || ""))
      .reduce((s, p) => s + safeSummaryMoney(p.safeAmount || 0), 0);
    // HPP produk saat ini sudah termasuk biaya produksi/accessories, jadi gaji produksi
    // tidak dikurangkan lagi dari laba agar tidak double count.
    const laba = realisasi - hpp - pengeluaran;
    return { scopedOrders, scopedPurchases, scopedExpenses, scopedTransfers, scopedTransfersOut, omzet: realisasi, realisasi, hpp, bayarCustomer, bayarSupplier, pengeluaran, gajiProduksi, piutang, hutangSupplier, laba };
  }

  function customerRowsInRekapRange() {
    // Piutang customer tidak lagi dihitung sebagai angka periode.
    // Semua tampilan piutang wajib memakai saldo aktif saat ini agar tidak ada 2 nominal.
    const customerKeys = [...new Set((orders || []).map((o) => normalizeName(o.customer || "")).filter(Boolean))];
    return customerKeys
      .map((key) => customerReceivableTotals(key))
      .filter((row) => Number(row.sisa || 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function downloadRekapTanggalPdf() {
    const { jsPDF, autoTable } = await loadPdfTools();
    const s = rekapSummary();
    const pdf = new jsPDF("p", "mm", "a4");
    addPdfHeader(pdf, "Rekap Gallery Kerudung", "all");
    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(`Periode: ${rangeLabel()}`, 14, 58);
    const rows = [
      ["Realisasi Penjualan", rupiah(s.realisasi)],
      ["Realisasi Terkirim", rupiah(s.realisasi)],
      ["HPP Terkirim", rupiah(s.hpp)],
      ["Pengeluaran Operasional", rupiah(s.pengeluaran)],
      ["Laba", rupiah(s.laba)],
      ["Pembayaran Customer", rupiah(s.bayarCustomer)],
      ["Transfer Keluar Supplier", rupiah(s.bayarSupplier)],
      ["Piutang Customer Saat Ini", rupiah(s.piutang)],
      ["Tagihan Supplier", rupiah(s.hutangSupplier)],
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
        head: [["Customer", "Pesanan", "Tagihan Saat Ini", "Dibayar FIFO", "Piutang Saat Ini"]],
        body: customerRows.map((c) => [c.name, c.orderCount || c.orders.length, rupiah(c.totalTagihan), rupiah(c.totalBayar), rupiah(c.sisa)]),
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
      `Realisasi Penjualan: ${rupiah(s.realisasi)}`,
      `Realisasi: ${rupiah(s.realisasi)}`,
      `HPP Terkirim: ${rupiah(s.hpp)}`,
      `Pengeluaran: ${rupiah(s.pengeluaran)}`,
      `${s.laba < 0 ? "Rugi Bersih" : "Laba Bersih"}: ${s.laba < 0 ? "-" : ""}${rupiah(Math.abs(s.laba))}`,
      `Status Laba: ${businessSummary.hppIsValid ? "Valid" : "Belum valid - ada barang terkirim tanpa HPP final"}`,
      `Piutang Saat Ini: ${rupiah(s.piutang)}`,
      `Tagihan Supplier: ${rupiah(s.hutangSupplier)}`,
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
    const total = orderPaymentTarget(order);
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
    const type = String(row?.type || "");
    const source = String(row?.source || "");
    // Pencocokan persis (bukan .includes() fuzzy) — meniru persis fungsi
    // isOfficialGajiPayroll() di Gallery Produksi (App.jsx) yang jadi sumber data ini,
    // supaya klasifikasi "pengeluaran gaji asli" vs "penanda status gajian" konsisten
    // di kedua app dan tidak salah tebak kalau ada type/source baru yang kebetulan mirip.
    if (source === "gallery-produksi-gaji-marker") return 0; // penanda status gajian, bukan pengeluaran
    if (type === "status_gajian_periode") return 0; // penanda status gajian, bukan pengeluaran
    if (type === "gaji_borongan") return amount; // data resmi gaji borongan dari Gallery Produksi
    // Fallback data lama sebelum field type distandarkan: tetap dihitung kalau jelas dari Gallery Produksi.
    if (source === "gallery-produksi" && (row?.entryId || row?.setorBatchId || row?.employeeName)) return amount;
    return 0;
  }

  const payrollExpenseRows = useMemo(() => (payrollExpenses || [])
    .map((p) => ({ ...p, safeAmount: payrollExpenseAmount(p) }))
    .filter((p) => p.safeAmount > 0)
    .sort((a, b) => dateSerial(b.tanggalSetor || b.tanggalBayar || b.date || b.tanggal || b.createdAt || "") - dateSerial(a.tanggalSetor || a.tanggalBayar || a.date || a.tanggal || a.createdAt || "")),
  [payrollExpenses]);

  function orderHppCoverage(order, deliveryDatePredicate = null) {
    const rows = [];
    let totalQty = 0;
    let missingQty = 0;
    const addRow = (item, qty, date = "", hasDeliveryLevelHpp = false) => {
      if (qty <= 0) return;
      totalQty += qty;
      const hppPerPcs = hppPerPcsForItem(item);
      if (hppPerPcs <= 0 && !hasDeliveryLevelHpp) {
        missingQty += qty;
        rows.push({
          orderId: order?.id || "",
          invoice: order?.invoice || order?.orderNumber || "",
          customer: order?.customer || "",
          product: item?.name || item?.item || "Produk",
          qty,
          date,
        });
      }
    };

    const deliveries = getDeliveryHistory(order);
    if (deliveries.length > 0) {
      deliveries.forEach((delivery) => {
        const date = delivery.date || delivery.tanggal || delivery.createdAt?.slice?.(0, 10) || order?.tanggalKirim || order?.createdAt || order?.date || "";
        if (deliveryDatePredicate && !deliveryDatePredicate(date)) return;
        const hasDeliveryLevelHpp = deliveryLevelHppTotal(delivery) > 0;
        (delivery.items || []).forEach((it, itemIdx) => {
          const qty = Number(it.qty ?? it.shippedQty ?? 0);
          const base = orderItemForDeliveryItem(order, it, itemIdx);
          addRow({ ...(base || {}), ...(it || {}), name: base?.name || it?.name, originalName: it?.name || "" }, qty, date, hasDeliveryLevelHpp);
        });
      });
      return { totalQty, missingQty, missingRows: rows };
    }

    const fallbackDate = order?.tanggalKirim || order?.deliveryDate || order?.shippingDate || order?.createdAt || order?.date || order?.tanggal || "";
    if (deliveryDatePredicate && !deliveryDatePredicate(fallbackDate)) return { totalQty: 0, missingQty: 0, missingRows: [] };
    const hasOrderLevelHpp = orderLevelDeliveredHppTotal(order) > 0;
    normalizeShipmentItems(order).forEach((it) => addRow(it, Number(it.shippedQty || 0), fallbackDate, hasOrderLevelHpp));
    return { totalQty, missingQty, missingRows: rows };
  }

  const productProfitSummary = useMemo(() => {
    const map = {};
    orders.forEach((o) => normalizeShipmentItems(o).forEach((it) => {
      const qty = Number(it.shippedQty || 0);
      if (qty <= 0) return;
      const key = normalizeName(it.name || "Produk");
      const revenue = qty * moneyValue(it.price || 0);
      const hppPerPcs = hppPerPcsForItem(it);
      const rawHpp = qty * hppPerPcs;
      // Di kartu Laba per Produk, HPP yang lebih besar dari nilai jual biasanya berasal
      // dari data lama/field total yang terbaca sebagai HPP satuan. Supaya tampilan
      // tidak menjadi minus palsu, batasi HPP maksimal sebesar omzet item.
      const hpp = revenue > 0 ? Math.min(rawHpp, revenue) : rawHpp;
      if (!map[key]) map[key] = { name: it.name || "Produk", qty: 0, revenue: 0, hpp: 0, laba: 0, missingHpp: 0 };
      map[key].qty += qty; map[key].revenue += revenue; map[key].hpp += hpp; map[key].laba += Math.max(0, revenue - hpp);
      if (hppPerPcs <= 0) map[key].missingHpp += qty;
    }));
    return Object.values(map).sort((a, b) => b.laba - a.laba);
  }, [orders, productMasters]);

  const businessSummary = useMemo(() => {
    const totalPesananAwal = orders.reduce((s, o) => s + moneyValue(o.total || 0), 0);
    const totalRealisasi = orders.reduce((s, o) => s + orderPaymentTarget(o), 0);
    // PERFORMA: Map lookup O(1) per customer/supplier, bukan find() O(n) di dalam reduce()
    const customerMapForSummary = new Map();
    (orders || []).forEach((o) => {
      const key = normalizeName(o.customer || "");
      if (key && !customerMapForSummary.has(key)) customerMapForSummary.set(key, o);
    });
    const totalPembayaranCustomer = [...customerMapForSummary.keys()].reduce((sum, key) => {
      const order = customerMapForSummary.get(key);
      return sum + moneySum(customerPaymentEventsSorted(order?.customer || key), (p) => p.amount);
    }, 0);
    const totalBelanjaSupplier = purchases.reduce((s, p) => s + purchaseInvoiceTotal(p), 0);
    const supplierMapForSummary = new Map();
    (purchases || []).forEach((p) => {
      const key = normalizeName(p.supplier || "");
      if (key && !supplierMapForSummary.has(key)) supplierMapForSummary.set(key, p);
    });
    const totalBayarSupplier = [...supplierMapForSummary.keys()].reduce((sum, key) => {
      const purchase = supplierMapForSummary.get(key);
      return sum + moneySum(supplierPaymentEventsSorted(purchase?.supplier || key), (p) => p.amount);
    }, 0);
    const totalPengeluaran = moneySum(expenses, (e) => e.amount);
    const totalGajiProduksi = payrollExpenseRows.reduce((s, p) => s + safeSummaryMoney(p.safeAmount || 0), 0);
    const nilaiStok = materialsStock.reduce((s, m) => s + safeMaterialStockValue(m, purchases), 0);
    const hppDariProduk = orders.reduce((s, o) => s + orderHppTotalWithMaster(o), 0);
    const estimasiHppBahanTerpakai = hppDariProduk > 0 ? hppDariProduk : 0;
    const hppCoverage = orders.reduce((acc, o) => {
      const c = orderHppCoverage(o);
      acc.totalQty += c.totalQty;
      acc.missingQty += c.missingQty;
      acc.missingRows += c.missingRows.length;
      if (c.missingRows.length > 0) acc.samples.push(...c.missingRows.slice(0, 3));
      return acc;
    }, { totalQty: 0, missingQty: 0, missingRows: 0, samples: [] });
    const labaKotor = totalRealisasi - estimasiHppBahanTerpakai;
    // HPP produk sudah termasuk biaya produksi/accessories, jadi Gaji Produksi
    // hanya ditampilkan sebagai info operasional dan tidak dikurangkan lagi dari laba.
    const labaBersih = totalRealisasi - estimasiHppBahanTerpakai - totalPengeluaran;
    const cashflowBersih = totalPembayaranCustomer - totalBayarSupplier - totalPengeluaran - totalGajiProduksi;
    const piutang = totalPiutangCustomerAktif();
    const hutangSupplier = purchases.reduce((s, p) => s + Math.max(0, sisaPurchase(p)), 0);
    const stokKritis = materialsStock.filter((m) => Number(m.minStock || 0) > 0 && Number(m.stock || 0) <= Number(m.minStock || 0));
    const customerBelumLunas = uniqueCustomers.filter((c) => Number(c.totalSisa || 0) > 0);
    const supplierBelumLunas = uniqueSuppliers.filter((s) => Number(s.totalSisa || 0) > 0);
    const supplierDataWarnings = purchases.filter((p) => purchaseHasAbnormalData(p));
    return { totalPesananAwal, totalRealisasi, totalPembayaranCustomer, totalBelanjaSupplier, totalBayarSupplier, totalPengeluaran, totalGajiProduksi, nilaiStok, estimasiHppBahanTerpakai, labaKotor, labaBersih, cashflowBersih, piutang, hutangSupplier, stokKritis, customerBelumLunas, supplierBelumLunas, supplierDataWarnings, hppCoverage, hppMissingQty: hppCoverage.missingQty, hppMissingRows: hppCoverage.missingRows, hppMissingSamples: hppCoverage.samples.slice(0, 8), hppIsValid: hppCoverage.missingQty <= 0 };
  }, [orders, purchases, expenses, transfers, transfersOut, materialsStock, uniqueCustomers, uniqueSuppliers, productMasters, payrollExpenseRows]);


  async function repairOneSupplierPurchase(purchase) {
    if (!purchase?.id) return;
    const payload = buildSupplierRepairPayload(purchase);
    await updateDoc(doc(db, "purchases", purchase.id), payload);
    addAuditLog("Perbaiki Data Supplier", `${purchase.supplier || "Supplier"} - ${rupiah(payload.total)}`);
  }

  async function repairSupplierWarningData() {
    const rows = businessSummary.supplierDataWarnings || [];
    if (rows.length === 0) return alert("Tidak ada data supplier bermasalah.");
    const ok = window.confirm(`Perbaiki otomatis ${rows.length} data supplier bermasalah?\n\nApp akan menormalkan nominal rusak seperti 16.746.329.999.999.998 menjadi nominal wajar berdasarkan qty dan harga/total yang masih bisa dihitung.`);
    if (!ok) return;
    setRepairingSupplierData(true);
    try {
      for (const purchase of rows) {
        await repairOneSupplierPurchase(purchase);
      }
      alert(`✅ ${rows.length} data supplier berhasil diperbaiki. Ringkasan Bisnis akan update otomatis.`);
      setDashboardDetail(null);
    } catch (e) {
      alert("Gagal memperbaiki data supplier: " + (e?.message || e));
    } finally {
      setRepairingSupplierData(false);
    }
  }

  function buildDashboardDetailData() {
    const orderRows = [...(orders || [])]
      .sort(sortOldestBottom)
      .map((o) => ({
        id: o.id,
        title: `${o.customer || "Customer"}${o.invoice ? ` · ${o.invoice}` : ""}`,
        subtitle: `Tanggal ${o.createdAt || o.date || "-"} · Status ${effectiveOrderStatus(o)}`,
        amount: orderPaymentTarget(o),
        rightNote: `Bayar ${rupiah(orderPaidTotal(o))} · Sisa ${rupiah(sisaOrder(o))}`,
      }));

    const labaRows = [
      { id: "realisasi", title: "Realisasi Penjualan", subtitle: "Nilai barang yang sudah dikirim", amount: businessSummary.totalRealisasi, tone: "plus" },
      { id: "hpp", title: "HPP Terkirim", subtitle: "HPP final barang yang sudah dikirim", amount: -businessSummary.estimasiHppBahanTerpakai, tone: "minus" },
      { id: "gaji", title: "Gaji Produksi", subtitle: "Info operasional; tidak dikurangkan lagi karena sudah masuk HPP", amount: businessSummary.totalGajiProduksi, tone: "info" },
      { id: "expense", title: "Pengeluaran Lain", subtitle: "Biaya operasional manual", amount: -businessSummary.totalPengeluaran, tone: "minus" },
      { id: "net", title: businessSummary.labaBersih < 0 ? "Rugi Bersih" : "Laba Bersih", subtitle: "Realisasi Penjualan - HPP Terkirim - Pengeluaran Lain", amount: businessSummary.labaBersih, tone: businessSummary.labaBersih >= 0 ? "plus" : "minus" },
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
      .sort((a, b) => safeMaterialStockValue(b, purchases) - safeMaterialStockValue(a, purchases))
      .map((m) => ({
        id: m.id || m.name,
        title: m.name || "Bahan",
        subtitle: (() => { const info = safeMaterialStockInfo(m, purchases); return `Stok ${Number(info.stock || 0).toLocaleString("id-ID")} ${m.unit || "yard"} · Avg ${rupiah(info.avgCost || 0)}${info.abnormal ? " · diperbaiki" : ""}`; })(),
        amount: safeMaterialStockValue(m, purchases),
        rightNote: Number(m.minStock || 0) > 0 && Number(m.stock || 0) <= Number(m.minStock || 0) ? "Stok kritis" : "",
      }));

    const supplierWarningRows = (businessSummary.supplierDataWarnings || []).map((p) => {
      const tanggal = p.createdAt || p.date || "-";
      const bahan = purchaseMaterialsSummary(p);
      let rightNote = "Nominal lama rusak. Klik Perbaiki Otomatis di atas, atau edit manual di tab Supplier.";
      try {
        const repairPayload = buildSupplierRepairPayload(p);
        rightNote = `Nominal lama rusak. Estimasi perbaikan ${rupiah(repairPayload.total)}. Klik Perbaiki Otomatis di atas.`;
      } catch (e) {
        rightNote = "Nominal lama rusak dan belum cukup data untuk diperbaiki otomatis. Edit manual di tab Supplier.";
      }
      return {
        id: p.id || `${p.supplier}-${tanggal}`,
        title: p.supplier || "Supplier",
        subtitle: `${tanggal} · ${bahan}`,
        amount: 0,
        amountLabel: "Perlu edit",
        rightNote,
        tone: "minus",
      };
    });

    return {
      omzet: { title: "Rincian Realisasi Penjualan", total: businessSummary.totalRealisasi, subtitle: "Nilai barang yang sudah dikirim", rows: orderRows },
      laba: { title: businessSummary.labaBersih < 0 ? "Rincian Rugi Bersih" : "Rincian Laba Bersih", total: businessSummary.labaBersih, subtitle: "Realisasi Penjualan - HPP Terkirim - Pengeluaran Lain", rows: labaRows },
      piutang: { title: "Rincian Piutang Customer", total: businessSummary.piutang, subtitle: "Customer dengan sisa tagihan", rows: piutangRows },
      hutang: { title: "Rincian Tagihan Supplier", total: businessSummary.hutangSupplier, subtitle: "Supplier dengan sisa tagihan aktif", rows: hutangRows },
      hpp: { title: "Rincian HPP Terkirim", total: businessSummary.estimasiHppBahanTerpakai, subtitle: "HPP final per produk berdasarkan barang terkirim", rows: hppRows },
      gaji: { title: "Rincian Gaji Produksi", total: businessSummary.totalGajiProduksi, subtitle: "Info operasional; tidak dikurangkan lagi dari laba karena sudah masuk HPP", rows: gajiRows },
      pengeluaran: { title: "Rincian Pengeluaran Lain", total: businessSummary.totalPengeluaran, subtitle: "Biaya operasional manual", rows: expenseRows },
      stok: { title: "Rincian Nilai Stok", total: businessSummary.nilaiStok, subtitle: "Nilai stok bahan saat ini", rows: stockRows },
      supplierWarnings: { title: "Data Supplier Perlu Dicek", total: supplierWarningRows.length, subtitle: "Data lama bernominal rusak tidak dihitung di Ringkasan Bisnis. Buka tab Supplier lalu edit nota yang ditandai.", rows: supplierWarningRows },
    };
  }

  function openDashboardDetail(type) {
    setDashboardDetail(type);
  }

  const auditData = useMemo(() => {
    const supplierAbnormal = (purchases || []).filter((p) => purchaseHasAbnormalData(p));
    const stockAbnormal = (materialsStock || []).filter((m) => safeMaterialStockInfo(m, purchases).abnormal);
    const orderWithoutItems = (orders || []).filter((o) => normalizeOrderItems(o).length === 0 || normalizeOrderItems(o).every((it) => Number(it.qty || 0) <= 0));
    const deliveryWithoutIndex = [];
    const shortFinal = [];
    const overDelivered = [];
    const legacySentNoDetail = [];

    (orders || []).forEach((o) => {
      const items = normalizeShipmentItems(o);
      const ordered = items.reduce((s, it) => s + Number(it.orderedQty || 0), 0);
      const shipped = items.reduce((s, it) => s + Number(it.shippedQty || 0), 0);
      if (o.shortShipmentClosed === true) shortFinal.push(o);
      if (ordered > 0 && shipped > ordered) overDelivered.push({ ...o, overQty: shipped - ordered });
      if ((o.deliveries || []).some((d) => (d.items || []).some((it) => it.itemIndex === undefined || it.itemIndex === null))) deliveryWithoutIndex.push(o);
      const rawStatus = `${o.status || ""} ${o.deliveryStatus || ""} ${o.shippingStatus || ""}`.toLowerCase();
      const looksSent = /(dikirim|terkirim|selesai|lunas)/.test(rawStatus);
      const hasDetail = getDeliveryHistory(o).length > 0 || (Array.isArray(o.shippedItems) && o.shippedItems.length > 0);
      if (looksSent && !hasDetail) legacySentNoDetail.push(o);
    });

    const payrollAbnormal = (payrollExpenses || []).filter((p) => payrollExpenseAmount(p) <= 0 && moneyValue(p.totalAmount ?? p.amount ?? 0) > 0);

    return { supplierAbnormal, stockAbnormal, orderWithoutItems, deliveryWithoutIndex, shortFinal, overDelivered, legacySentNoDetail, payrollAbnormal };
  }, [purchases, materialsStock, orders, payrollExpenses]);

  const issueCenter = useMemo(() => {
    const issues = [];
    const seen = new Set();
    const addIssue = (issue) => {
      const id = issue.id || `${issue.category || "umum"}-${issue.title || "kendala"}-${issue.search || ""}`;
      if (seen.has(id)) return;
      seen.add(id);
      issues.push({ priority: "sedang", category: "Umum", tone: "amber", ...issue, id });
    };

    const orderByCustomer = {};
    (orders || []).forEach((o) => {
      const key = normalizeName(o.customer || "");
      if (!key) return;
      if (!orderByCustomer[key]) orderByCustomer[key] = [];
      orderByCustomer[key].push(o);
    });

    (orders || []).forEach((o) => {
      const customer = o.customer || "Customer";
      const invoice = o.invoice || o.kode || "Pesanan";
      const searchText = invoice || customer;
      const items = normalizeOrderItems(o);
      const shipmentItems = normalizeShipmentItems(o);
      const orderedQty = shipmentItems.reduce((sum, it) => sum + Number(it.orderedQty || 0), 0);
      const shippedQty = shipmentItems.reduce((sum, it) => sum + Number(it.shippedQty || 0), 0);
      const savedTotal = moneyValue(o.total || 0);
      const calculatedTotal = orderGrandTotal(items, orderShippingCost(o));
      const paid = orderPaidTotal(o);
      const hasDelivery = getDeliveryHistory(o).length > 0 || (Array.isArray(o.shippedItems) && o.shippedItems.length > 0) || shippedQty > 0;

      // 1. Barang terkirim tapi harga = 0 → tagihan jadi Rp 0
      const kirimTanpaHarga = shipmentItems.filter((it) => Number(it.shippedQty || 0) > 0 && moneyValue(it.price || 0) <= 0);
      if (kirimTanpaHarga.length > 0) addIssue({ id: `kirim-harga-kosong-${o.id}`, category: "Tagihan", priority: "tinggi", tone: "rose", title: `${customer} barang terkirim tanpa harga → tagihan Rp 0`, subtitle: `${invoice} · ${kirimTanpaHarga.slice(0, 3).map((it) => it.name || "Produk").join(", ")}. Edit harga di pesanan.`, targetTab: "orders", search: searchText });

      // Total pesanan vs hitung ulang tidak relevan ke tagihan — yang ditagihkan adalah terkirim

      // 3. Lebih bayar → ada uang customer yang tidak tercatat dengan benar
      if (paid > Math.max(savedTotal, orderPaymentTarget(o), calculatedTotal) && paid > 0) addIssue({ id: `order-bayar-lebih-${o.id}`, category: "Tagihan", priority: "tinggi", tone: "amber", title: `${customer} lebih bayar`, subtitle: `${invoice} · bayar ${rupiah(paid)}, tagihan ${rupiah(orderPaymentTarget(o))}. Cek apakah ada pembayaran dobel.`, targetTab: "orders", search: searchText });

      // 4. Data kirim dari Gallery Produksi tidak terbaca → qty terkirim = 0, tagihan tidak muncul
      if (hasDelivery && orderedQty > 0 && shippedQty <= 0) addIssue({ id: `kirim-tidak-terbaca-${o.id}`, category: "Tagihan", priority: "tinggi", tone: "rose", title: `${customer} data kirim tidak terbaca → tagihan hilang`, subtitle: `${invoice} · ada riwayat kirim tapi qty terkirim 0. Gunakan Repair Qty di tab Pesanan.`, targetTab: "orders", search: searchText });

      // 5. Qty pengiriman tertukar dari Gallery Produksi → tagihan salah hitung
      const rawDeliveries = Array.isArray((o.raw || o).deliveries) ? (o.raw || o).deliveries : [];
      rawDeliveries.forEach((d, dIdx) => {
        const dItems = Array.isArray(d.items) ? d.items : [];
        const orderItemsList = normalizeOrderItems(o);
        if (dItems.length < 2 || orderItemsList.length < 2) return;
        // Deteksi tertukar: total qty pengiriman ≈ total qty pesanan, tapi distribusi per item terbalik
        const totalOrdered = orderItemsList.reduce((s, it) => s + Number(it.qty || 0), 0);
        const totalDelivered = dItems.reduce((s, it) => s + Number(it.shippedQty || it.qty || 0), 0);
        const totalsMatch = totalOrdered > 0 && Math.abs(totalOrdered - totalDelivered) <= Math.ceil(totalOrdered * 0.05);
        const hasMismatch = dItems.some((dItem) => {
          const byName = orderItemsList.find((oi) => normalizeName(oi.name || "") === normalizeName(dItem.name || ""));
          if (!byName) return false;
          const dQty = Number(dItem.shippedQty || dItem.qty || 0);
          const oQty = Number(byName.qty || 0);
          return dQty > 0 && oQty > 0 && dQty > oQty * 3;
        });
        // Flag jika ada item yang jauh melebihi pesanan DAN total keseluruhan masih masuk akal (indikasi tertukar)
        if (hasMismatch && totalsMatch) addIssue({ id: `qty-tertukar-${o.id}-${dIdx}`, category: "Kirim", priority: "tinggi", tone: "rose", title: `${customer} qty pengiriman kemungkinan tertukar`, subtitle: `${invoice} · pengiriman ${d.date || d.tanggal || "-"}: distribusi qty antar produk tidak sesuai pesanan tapi total sama. Cek Koreksi Qty.`, targetTab: "orders", search: searchText });
        // Flag juga jika ada item yang sangat jauh melebihi pesanan tanpa indikasi tertukar (kelebihan murni besar)
        else if (hasMismatch && !totalsMatch) addIssue({ id: `qty-tertukar-${o.id}-${dIdx}`, category: "Kirim", priority: "tinggi", tone: "rose", title: `${customer} qty pengiriman tertukar → tagihan salah`, subtitle: `${invoice} · pengiriman ${d.date || d.tanggal || "-"}. Gunakan Repair Qty di tab Pesanan.`, targetTab: "orders", search: searchText });
      });

      // 6. Anomali tanggal pengiriman
      const orderDateSerial = dateSerial(o.date || o.createdAt || o.tanggal || "");
      const kirimDate = o.tanggalKirim || "";
      const kirimSerial = dateSerial(kirimDate);
      // 6a. tanggalKirim sebelum tanggal pesanan → mustahil
      if (orderDateSerial && kirimSerial && kirimSerial < orderDateSerial) {
        addIssue({ id: `tanggal-kirim-sebelum-pesan-${o.id}`, category: "Kirim", priority: "tinggi", tone: "rose", title: `${customer} tanggal kirim sebelum tanggal pesanan`, subtitle: `${invoice} · pesanan ${o.date || o.createdAt?.slice(0,10) || "-"}, dikirim ${kirimDate}. Koreksi tanggal via Edit Pengiriman.`, targetTab: "orders", search: searchText });
      }
      // 6b. tanggalKirim jauh setelah tanggal pesanan (> 60 hari) → kemungkinan salah input
      if (orderDateSerial && kirimSerial && (kirimSerial - orderDateSerial) > 600) {
        addIssue({ id: `tanggal-kirim-jauh-${o.id}`, category: "Kirim", priority: "sedang", tone: "amber", title: `${customer} tanggal kirim jauh dari tanggal pesanan`, subtitle: `${invoice} · pesanan ${o.date || o.createdAt?.slice(0,10) || "-"}, dikirim ${kirimDate} (selisih > 60 hari). Mungkin salah input tanggal.`, targetTab: "orders", search: searchText });
      }
      // 6c. Delivery date kosong padahal ada riwayat pengiriman
      rawDeliveries.forEach((d, dIdx) => {
        if (!d.date && !d.tanggal) {
          addIssue({ id: `delivery-tanggal-kosong-${o.id}-${dIdx}`, category: "Kirim", priority: "sedang", tone: "amber", title: `${customer} riwayat kirim tanpa tanggal`, subtitle: `${invoice} · pengiriman ke-${dIdx + 1} tidak punya tanggal. Koreksi via Edit Pengiriman.`, targetTab: "orders", search: searchText });
        }
      });
      // 6d. Status Selesai/Lunas tapi tanggalKirim kosong
      const statusFinal = `${o.status || ""} ${o.deliveryStatus || ""}`.toLowerCase();
      if (/(selesai|lunas)/.test(statusFinal) && !kirimDate && getDeliveryHistory(o).length === 0) {
        addIssue({ id: `selesai-tanpa-tanggal-kirim-${o.id}`, category: "Kirim", priority: "sedang", tone: "amber", title: `${customer} status selesai tapi tanggal kirim kosong`, subtitle: `${invoice} · tidak ada tanggal kirim tercatat. Bisa mempengaruhi rekap pengiriman.`, targetTab: "orders", search: searchText });
      }

    });

    const phoneGroups = {};
    (orders || []).forEach((o) => {
      const phoneKey = String(o.phone || "").replace(/\D/g, "");
      if (!phoneKey || phoneKey.length < 8) return;
      if (!phoneGroups[phoneKey]) phoneGroups[phoneKey] = [];
      phoneGroups[phoneKey].push(o);
    });
    Object.entries(phoneGroups).forEach(([phoneKey, rows]) => {
      const customerNames = Array.from(new Set(rows.map((o) => normalizeName(o.customer || "")).filter(Boolean)));
      if (customerNames.length > 1) {

      }
    });

    Object.values(orderByCustomer).forEach((rows) => {


    });

    // Deteksi duplikat order: nama customer mirip + produk sama + qty sama + harga sama
    // PERFORMA: fingerprint item per order dulu O(n), lalu group by item signature → hanya
    // bandingkan customer dalam grup yang sama (jauh lebih kecil dari O(n²) penuh).
    const allOrders = orders || [];
    const itemSigMap = new Map(); // itemSig → [order, ...]
    allOrders.forEach((o) => {
      const items = normalizeOrderItems(o);
      if (items.length === 0) return;
      if (!normalizeName(o.customer || "")) return;
      const itemSig = items
        .map((it) => `${normalizeName(it.name || "")}:${Number(it.qty || 0)}:${Math.round(moneyValue(it.price || 0) / 100)}`)
        .sort()
        .join("|");
      if (!itemSigMap.has(itemSig)) itemSigMap.set(itemSig, []);
      itemSigMap.get(itemSig).push(o);
    });
    // Hanya loop di dalam grup yang punya item signature sama (biasanya kecil)
    const dupGroups = new Map();
    itemSigMap.forEach((groupOrders) => {
      if (groupOrders.length < 2) return;
      for (let i = 0; i < groupOrders.length; i++) {
        for (let j = i + 1; j < groupOrders.length; j++) {
          const a = groupOrders[i];
          const b = groupOrders[j];
          if (!customerNamesSimilar(a.customer || "", b.customer || "")) continue;
          // Item sudah cocok (sama sig), customer juga mirip → duplikat
          let found = false;
          for (const [, group] of dupGroups) {
            if (group.ids.has(a.id) || group.ids.has(b.id)) {
              group.ids.add(a.id); group.ids.add(b.id);
              found = true; break;
            }
          }
          if (!found) {
            dupGroups.set(`${a.id}-${b.id}`, {
              customer: a.customer || b.customer || "Customer",
              ids: new Set([a.id, b.id]),
              searchName: normalizeName(a.customer || ""),
            });
          }
        }
      }
    });
    dupGroups.forEach((group) => {
      const customerLabel = group.customer;
      const matchingOrders = allOrders.filter((o) => group.ids.has(o.id));
      const invoiceList = matchingOrders.map((o) => o.invoice || o.kode || o.id).join(", ");
      addIssue({
        id: `duplikat-order-${[...group.ids].sort().join("|")}`,
        category: "Pesanan",
        priority: "tinggi",
        tone: "rose",
        title: `${customerLabel} kemungkinan order duplikat`,
        subtitle: `${invoiceList} — punya produk, qty, dan harga yang sama. Cek apakah ada yang perlu dihapus.`,
        targetTab: "orders",
        search: group.searchName,
      });
    });

    (productMasters || []).forEach((p) => {
      const name = p.name || "Produk";
      const hpp = calculateProductHpp(p);
      const price = moneyValue(p.defaultPrice || p.price || 0);
      const soldBefore = (orders || []).some((o) => normalizeOrderItems(o).some((it) => normalizeName(it.name) === normalizeName(name) || (p.id && it.productId === p.id)));

      if (price <= 0) addIssue({ id: `produk-harga-kosong-${p.id}`, category: "Produk", priority: "tinggi", tone: "rose", title: `${name} harga jual kosong`, subtitle: `Harga jual wajib diisi sebelum produk dipakai.`, targetTab: "master", search: name });

      // Kendala margin minus tidak ditampilkan agar dashboard tidak dipenuhi peringatan
      // dari data lama yang HPP/totalnya belum seragam.

    });

    (productProfitSummary || []).forEach((p) => {
      // Kendala "terjual tapi HPP kosong" sengaja tidak ditampilkan di pusat kendala
      // agar daftar kendala tidak penuh oleh produk lama yang sudah pernah terjual.

    });



    (materialsStock || []).forEach((m) => {
      const stock = Number(m.stock || 0);
      const name = m.name || "Stok";



      const info = safeMaterialStockInfo(m, purchases);

    });

    (purchases || []).forEach((p) => {
      const supplier = p.supplier || "Supplier";
      const searchText = supplier;




    });

    (transfers || []).forEach((t) => {
      const name = t.customer || "Transfer masuk";



    });

    (transfersOut || []).forEach((t) => {
      const name = t.supplier || "Transfer keluar";



    });

    (kasbonList || []).forEach((k) => {
      const name = k.employeeName || k.nama || "Kasbon";
      const amount = moneyValue(k.jumlah || k.amount || 0);
      // Pakai sisaKasbon dari Firestore (sudah dipotong gaji dari Gallery Produksi).
      const sisa = k.sisaKasbon !== undefined && k.sisaKasbon !== null
        ? Math.max(0, parseMoney(k.sisaKasbon))
        : Math.max(0, amount - moneySum(k.cicilan || [], (c) => c.jumlah ?? c.amount ?? 0));




    });

    const priorityRank = { tinggi: 0, sedang: 1, rendah: 2 };
    return issues.sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || Number(b.amount || 0) - Number(a.amount || 0) || String(a.category).localeCompare(String(b.category)));
  }, [orders, purchases, materialsStock, productMasters, productProfitSummary, transfers, transfersOut, kasbonList, pesananTelat]);

  const ignoredIssueIds = useMemo(() => new Set(ignoredIssues.map((x) => x.issueId)), [ignoredIssues]);
  const activeIssueCenter = useMemo(() => issueCenter.filter((x) => !ignoredIssueIds.has(x.id)), [issueCenter, ignoredIssueIds]);

  const issueSummary = useMemo(() => {
    const categories = ["Keuangan", "Produk", "Kirim", "Invoice/Nota", "Customer", "Supplier", "Stok", "Kasbon", "Sinkron Produksi", "Pesanan"];
    return categories.map((category) => ({ category, count: activeIssueCenter.filter((x) => x.category === category).length })).filter((x) => x.count > 0);
  }, [activeIssueCenter]);

  // Filter list selalu menampilkan semua kategori utama (meski count 0) agar konsisten
  const issueFilters = ["semua", "Prioritas Tinggi", "Tagihan", "Pesanan", "Produk", "Customer", "Kirim", "Invoice/Nota", "Keuangan", "Supplier", "Kasbon", "Stok", "Sinkron Produksi", "Diabaikan"];

  const filteredIssueCenter = useMemo(() => {
    const active = issueCenter.filter((x) => !ignoredIssueIds.has(x.id));
    if (issueCenterFilter === "semua") return active;
    if (issueCenterFilter === "Prioritas Tinggi") return active.filter((x) => x.priority === "tinggi");
    if (issueCenterFilter === "Diabaikan") return issueCenter.filter((x) => ignoredIssueIds.has(x.id));
    return active.filter((x) => x.category === issueCenterFilter);
  }, [issueCenter, issueCenterFilter, ignoredIssueIds]);

  function openIssueTarget(issue) {
    if (!issue) return;
    setIssueCenterOpen(false);
    setDashboardDetail(null);
    setModal(null);
    setTab(issue.targetTab || "orders");
    setSearch(issue.search || "");
    if (issue.targetTab === "orders" && issue.customerForInvoice) {
      setInvoiceCustomer(issue.customerForInvoice);
    }
  }

  async function ignoreIssue(issueId) {
    if (!issueId || ignoredIssueIds.has(issueId)) return;
    try {
      const docRef = await addDoc(collection(db, "ignoredIssues"), {
        issueId,
        ignoredAt: new Date().toISOString(),
        ignoredBy: user?.email || "-",
      });
      setIgnoredIssues((prev) => [...prev, { id: docRef.id, issueId }]);
    } catch (e) {
      console.warn("Gagal abaikan kendala:", e);
    }
  }

  async function unignoreIssue(issueId) {
    if (!issueId) return;
    try {
      // Pakai state — tidak perlu getDocs karena docId sudah tersimpan di state
      const match = ignoredIssues.find((x) => x.issueId === issueId);
      if (match?.id) {
        await deleteDoc(doc(db, "ignoredIssues", match.id));
        setIgnoredIssues((prev) => prev.filter((x) => x.issueId !== issueId));
      }
    } catch (e) {
      console.warn("Gagal batalkan abaikan kendala:", e);
    }
  }

  function IssueCenterCard() {
    const topIssues = activeIssueCenter.slice(0, 5);
    return (
      <div className="mx-4 mt-4 rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-black text-rose-600">⚠️ Pusat Kendala Kerudung</div>
            <div className="mt-1 text-xs text-slate-500">Semua data yang perlu dilengkapi, diperbaiki, atau dicek ulang.</div>
          </div>
          <button type="button" onClick={() => { setIssueCenterFilter("semua"); setIssueCenterOpen(true); }} className="rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}>Buka Semua</button>
        </div>

        {activeIssueCenter.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700" style={{ border: "1px solid #bbf7d0" }}>
            ✅ <b>Semua data utama aman.</b><br />Tidak ada pesanan bermasalah, produk tanpa HPP, pengiriman belum lengkap, atau nota/invoice yang perlu diperbaiki.
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {issueSummary.slice(0, 6).map((x) => (
                <button key={x.category} type="button" onClick={() => { setIssueCenterFilter(x.category); setIssueCenterOpen(true); }} className="rounded-2xl bg-rose-50 px-3 py-2 text-left" style={{ border: "1px solid #fecdd3" }}>
                  <div className="text-lg font-black text-rose-600">{x.count}</div>
                  <div className="text-[11px] font-bold text-rose-700">{x.category}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {topIssues.map((issue) => (
                <button key={issue.id} type="button" onClick={() => openIssueTarget(issue)} className="w-full rounded-2xl bg-slate-50 p-3 text-left active:scale-[0.99]" style={{ border: "1px solid #f1f5f9" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800 truncate">{issue.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{issue.subtitle}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${issue.priority === "tinggi" ? "bg-rose-100 text-rose-700" : issue.priority === "sedang" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{issue.priority}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  function IssueCenterModal() {
    if (!issueCenterOpen) return null;
    const ignoredCount = ignoredIssues.filter((x) => issueCenter.some((ic) => ic.id === x.issueId)).length;
    return (
      <SimpleModal title="Pusat Kendala Kerudung" onClose={() => setIssueCenterOpen(false)}>
        <div className="space-y-3">
          <div className="rounded-3xl p-4" style={{ background: "linear-gradient(135deg,#fff1f2,#fdf2f8)", border: "1.5px solid #fecdd3" }}>
            <div className="text-xs font-semibold text-slate-500">Kendala Aktif</div>
            <div className="text-3xl font-black text-rose-600">{activeIssueCenter.length} data</div>
            <div className="mt-1 text-xs text-slate-500">Ketuk item untuk langsung pindah ke tab dan pencarian data bermasalah. Ketuk <b>Bukan Kendala</b> untuk menyembunyikan item yang sudah dikonfirmasi aman.{ignoredCount > 0 ? ` · ${ignoredCount} kendala diabaikan.` : ""}</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {issueFilters.map((filter) => {
              const count = filter === "semua"
                ? activeIssueCenter.length
                : filter === "Prioritas Tinggi"
                  ? activeIssueCenter.filter((x) => x.priority === "tinggi").length
                  : filter === "Diabaikan"
                    ? ignoredCount
                    : activeIssueCenter.filter((x) => x.category === filter).length;
              return (
                <button key={filter} type="button" onClick={() => setIssueCenterFilter(filter)} className="shrink-0 rounded-full px-3 py-2 text-xs font-bold" style={{ background: issueCenterFilter === filter ? "#ec4899" : "#fdf2f8", color: issueCenterFilter === filter ? "white" : "#be185d", border: "1px solid #f9a8d4" }}>
                  {filter}{count > 0 ? ` (${count})` : ""}
                </button>
              );
            })}
          </div>
          {filteredIssueCenter.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-center text-sm text-emerald-700">✅ Tidak ada kendala pada filter ini.</div>
          ) : (
            <div className="max-h-[64vh] space-y-2 overflow-auto pr-1">
              {filteredIssueCenter.map((issue) => {
                const isIgnored = ignoredIssueIds.has(issue.id);
                return (
                  <div key={issue.id} className="w-full rounded-2xl bg-white p-3 text-left" style={{ border: `1px solid ${isIgnored ? "#d1fae5" : "#f1f5f9"}` }}>
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => !isIgnored && openIssueTarget(issue)}>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{issue.category}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isIgnored ? "bg-emerald-100 text-emerald-700" : issue.priority === "tinggi" ? "bg-rose-100 text-rose-700" : issue.priority === "sedang" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{isIgnored ? "diabaikan" : issue.priority}</span>
                        </div>
                        <div className={`mt-1 text-sm font-bold ${isIgnored ? "text-slate-400 line-through" : "text-slate-800"}`}>{issue.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{issue.subtitle}</div>
                      </button>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {!isIgnored && <div className="text-xs font-bold text-pink-600">Buka ›</div>}
                        <button
                          type="button"
                          onClick={() => isIgnored ? unignoreIssue(issue.id) : ignoreIssue(issue.id)}
                          className="rounded-full px-2 py-1 text-[10px] font-bold"
                          style={{ background: isIgnored ? "#d1fae5" : "#f1f5f9", color: isIgnored ? "#065f46" : "#64748b" }}
                        >
                          {isIgnored ? "↩ Aktifkan" : "Bukan Kendala"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SimpleModal>
    );
  }

  function AuditSection({ title, count, tone = "rose", children }) {
    const cls = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800";
    return (
      <div className={`rounded-3xl border p-4 ${cls}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold">{title}</div>
          <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold">{count} data</div>
        </div>
        <div className="mt-3 space-y-2 text-sm">{children}</div>
      </div>
    );
  }

  function SummaryDetailCard({ type, label, value, colorClass, bgClass, negative = false }) {
    return (
      <button type="button" onClick={() => openDashboardDetail(type)} className={`rounded-2xl ${bgClass} p-3 text-left active:scale-[0.99] transition-all`}>
        <div className="text-xs text-slate-400">{label}</div>
        <div className={`text-lg font-bold ${colorClass}`}>{Number(value || 0) < 0 || (negative && value > 0) ? "-" : ""}{rupiah(Math.abs(Number(value || 0)))}</div>
        <div className="mt-1 text-[10px] font-semibold text-slate-400">Ketuk untuk rincian</div>
      </button>
    );
  }

  function DashboardDetailModal() {
    const detail = buildDashboardDetailData()[dashboardDetail];
    if (!detail) return null;
    const rows = Array.isArray(detail.rows) ? detail.rows : [];
    return (
      <SimpleModal title={detail.title} onClose={() => setDashboardDetail(null)}>
        <div className="space-y-3">
          <div className="rounded-3xl p-4" style={{ background: "linear-gradient(135deg,#fdf2f8,#ede9fe)", border: "1.5px solid #f9a8d4" }}>
            <div className="text-xs font-semibold text-slate-500">{dashboardDetail === "supplierWarnings" ? "Jumlah Data" : "Total"}</div>
            <div className={`text-2xl font-black ${Number(detail.total || 0) < 0 ? "text-rose-600" : "text-pink-600"}`}>
              {dashboardDetail === "supplierWarnings" ? `${rows.length} data` : `${Number(detail.total || 0) < 0 ? "-" : ""}${rupiah(Math.abs(Number(detail.total || 0)))}`}
            </div>
            <div className="mt-1 text-xs text-slate-500">{detail.subtitle}</div>
            {dashboardDetail === "supplierWarnings" && rows.length > 0 && (
              <button
                type="button"
                disabled={repairingSupplierData}
                onClick={repairSupplierWarningData}
                className="mt-3 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}
              >
                {repairingSupplierData ? "Memperbaiki data..." : `Perbaiki Otomatis ${rows.length} Data Supplier`}
              </button>
            )}
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
                      {row.amountLabel || `${Number(row.amount || 0) < 0 ? "-" : ""}${rupiah(Math.abs(Number(row.amount || 0)))}`}
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
    orders.forEach((o) => { const key = normalizeName(o.customer || ""); if (!key) return; if (!map[key]) map[key] = { name: capitalizeWords(o.customer || ""), count: 0, total: 0 }; map[key].count += 1; map[key].total += orderPaymentTarget(o); });
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

  async function exportBackupXlsx() {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs");
    const bs = businessSummary;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Ringkasan
    const ringkasan = [
      ["Gallery Kerudung - Backup Data"],
      ["Tanggal Export", new Date().toLocaleString("id-ID")],
      ["User", user?.email || "-"],
      [],
      ["RINGKASAN BISNIS", "Nominal"],
      ["Total Realisasi Penjualan", bs.totalRealisasi],
      ["Transfer Masuk dari Bayar Customer", bs.totalPembayaranCustomer],
      ["Belanja Supplier", bs.totalBelanjaSupplier],
      ["Realisasi Pembayaran ke Supplier", bs.totalBayarSupplier],
      ["Biaya Operasional", bs.totalPengeluaran],
      ["Total Pengeluaran Kas", bs.totalPengeluaran + bs.totalBayarSupplier],
      [bs.labaBersih < 0 ? "Rugi Bersih" : "Laba Bersih", bs.labaBersih],
      ["Cashflow Bersih", bs.cashflowBersih],
      ["Piutang Customer", bs.piutang],
      ["Tagihan Supplier", bs.hutangSupplier],
    ];
    const wsRingkasan = XLSX.utils.aoa_to_sheet(ringkasan);
    wsRingkasan["!cols"] = [{ wch: 35 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsRingkasan, "Ringkasan");

    // Sheet 2: Pesanan
    const pesananRows = [
      ["Tanggal", "Invoice", "Customer", "Subtotal", "Ongkir", "Total Pesanan", "Tagihan", "Dibayar", "Sisa", "Status"],
      ...orders.map((o) => [
        o.createdAt || "", o.invoice || "", o.customer || "",
        orderItemsTotal(normalizeOrderItems(o)), orderShippingCost(o),
        moneyValue(o.total || 0), orderPaymentTarget(o), orderPaidTotal(o), sisaOrder(o), o.status || ""
      ]),
    ];
    const wsPesanan = XLSX.utils.aoa_to_sheet(pesananRows);
    wsPesanan["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsPesanan, "Pesanan");

    // Sheet 3: Supplier
    const supplierRows = [
      ["Tanggal", "Supplier", "Bahan", "Total", "Dibayar", "Sisa"],
      ...purchases.map((p) => [
        p.createdAt || "", p.supplier || "", purchaseMaterialsSummary(p),
        purchaseInvoiceTotal(p), purchasePaidTotal(p), sisaPurchase(p)
      ]),
    ];
    const wsSupplier = XLSX.utils.aoa_to_sheet(supplierRows);
    wsSupplier["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsSupplier, "Supplier");

    // Sheet 4: Pengeluaran
    const pengeluaranRows = [
      ["Tanggal", "Jenis", "Kategori/Supplier", "Catatan", "Nominal"],
      ...expenses.map((e) => [e.date || "", "Biaya Operasional", e.category || "", e.note || "", moneyValue(e.amount || 0)]),
      ...transfersOut.map((t) => [t.date || t.createdAt?.slice?.(0, 10) || "", "Transfer Keluar Supplier", t.supplier || "", `${t.bank || "Bayar Supplier"}${t.note ? ` · ${t.note}` : ""}`, moneyValue(t.amount || 0)]),
    ];
    const wsPengeluaran = XLSX.utils.aoa_to_sheet(pengeluaranRows);
    wsPengeluaran["!cols"] = [{ wch: 15 }, { wch: 25 }, { wch: 25 }, { wch: 30 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsPengeluaran, "Pengeluaran");

    XLSX.writeFile(wb, `backup-gallery-kerudung-${todayStr()}.xlsx`);
    addAuditLog("Backup Excel", "Export ringkasan, pesanan, supplier, pengeluaran ke .xlsx");
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
    <div className="gk-hd-ui mx-auto min-h-screen max-w-md" style={{ background: "#fdf2f8" }}>
      <style>{`
        .gk-hd-ui {
          color: #0f172a;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }
        .gk-hd-ui button {
          min-height: 44px;
          touch-action: manipulation;
          letter-spacing: .01em;
        }
        .gk-hd-ui input,
        .gk-hd-ui select,
        .gk-hd-ui textarea {
          min-height: 46px;
          font-size: 15px;
        }
        .gk-hd-ui .rounded-2xl,
        .gk-hd-ui .rounded-3xl {
          box-shadow: 0 1px 0 rgba(15, 23, 42, .04);
        }
        .gk-hd-ui .shadow-sm {
          box-shadow: 0 8px 24px rgba(15, 23, 42, .07);
        }
        .gk-hd-ui .text-slate-400 { color: #64748b; }
        .gk-hd-ui .text-slate-500 { color: #475569; }
        .gk-hd-ui .text-slate-600 { color: #334155; }
        .gk-hd-ui .text-xs { font-size: 12px; line-height: 1.45; }
        .gk-hd-ui .text-sm { font-size: 14.5px; line-height: 1.5; }
        .gk-hd-ui .text-lg { font-size: 19px; line-height: 1.35; }
        .gk-hd-ui .truncate {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (max-width: 430px) {
          .gk-hd-ui .p-3 { padding: .9rem; }
          .gk-hd-ui .p-4 { padding: 1.05rem; }
          .gk-hd-ui .px-3 { padding-left: .9rem; padding-right: .9rem; }
          .gk-hd-ui .py-2 { padding-top: .62rem; padding-bottom: .62rem; }
          .gk-hd-ui .py-3 { padding-top: .88rem; padding-bottom: .88rem; }
          .gk-hd-ui .gap-2 { gap: .62rem; }
          .gk-hd-ui .gap-3 { gap: .85rem; }
        }
      `}</style>
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
          {search && <button type="button" onClick={() => setSearch("")} className="text-pink-200 font-bold">✕</button>}
          <button
            type="button"
            onClick={() => loadFirestoreData({ showLoading: false, useCache: false })}
            disabled={loading || refreshingData}
            className="rounded-full px-3 py-1 text-xs font-bold text-white disabled:opacity-60"
            style={{ background: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.35)" }}
          >
            {refreshingData ? "... Memuat" : "↻ Refresh"}
          </button>
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

      {/* ── DASHBOARD SIMPLE HEMAT READS ── */}
      {!loading && tab === "dashboard" && (
        <>
          <div className="grid grid-cols-3 gap-2 p-4 pb-0">
            <button onClick={() => openOrderModal()} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#ec4899", border: "1.5px solid #f9a8d4" }}>+ Pesanan</button>
            <button onClick={() => setModal("pay")} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#059669", border: "1.5px solid #bbf7d0" }}>+ Bayar</button>
            <button onClick={() => setModal("expense")} className="rounded-2xl bg-white p-3 text-xs font-bold shadow-sm" style={{ color: "#64748b", border: "1.5px solid #e2e8f0" }}>+ Biaya</button>
          </div>

          <div className="mx-4 mt-4 rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-lg font-black" style={{ color: "#ec4899" }}>📌 Dashboard Kerudung</div>
                <div className="text-xs text-slate-500">Ringkas, fokus ke tagihan dan data yang perlu tindakan.</div>
              </div>
              <button type="button" onClick={() => loadFirestoreData({ showLoading: false, useCache: false })} disabled={loading || refreshingData} className="rounded-full px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#ec4899,#a855f7)" }}>
                {refreshingData ? "Memuat..." : "Refresh"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setSearch(""); setFilterOrder("belum-lunas"); setTab("orders"); }}
                className="rounded-3xl bg-rose-50 p-4 text-left active:scale-[0.99] transition-transform"
                style={{ border: "1px solid #fecdd3" }}
              >
                <div className="flex items-center justify-between gap-2"><span className="text-xl">💰</span><span className="text-[10px] font-bold text-rose-500">Buka piutang ›</span></div>
                <div className="mt-2 text-xl font-black text-rose-600">{rupiah(businessSummary.piutang || 0)}</div>
                <div className="text-xs font-bold text-slate-700">Belum Lunas</div>
                <div className="text-[10px] text-slate-500">Customer yang masih punya sisa tagihan.</div>
              </button>

              <button
                type="button"
                onClick={() => { setSearch(""); setFilterOrder("sebagian"); setTab("orders"); }}
                className="rounded-3xl bg-amber-50 p-4 text-left active:scale-[0.99] transition-transform"
                style={{ border: "1px solid #fde68a" }}
              >
                <div className="flex items-center justify-between gap-2"><span className="text-xl">🚚</span><span className="text-[10px] font-bold text-amber-600">Buka kirim ›</span></div>
                <div className="mt-2 text-2xl font-black text-amber-600">{(orders || []).filter((o) => orderDeliveryStatus(o) === "Dikirim Sebagian").length.toLocaleString("id-ID")}</div>
                <div className="text-xs font-bold text-slate-700">Kirim Belum Lengkap</div>
                <div className="text-[10px] text-slate-500">Pesanan yang sudah kirim sebagian.</div>
              </button>

              <button
                type="button"
                onClick={() => setDashboardDetail(dashboardDetail === "kasbon" ? null : "kasbon")}
                className="rounded-3xl bg-pink-50 p-4 text-left active:scale-[0.99] transition-transform"
                style={{ border: "1px solid #f9a8d4" }}
              >
                <div className="flex items-center justify-between gap-2"><span className="text-xl">💳</span><span className="text-[10px] font-bold text-pink-600">{dashboardDetail === "kasbon" ? "Tutup ✕" : "Lihat kasbon ›"}</span></div>
                <div className="mt-2 text-2xl font-black text-pink-600">{kasbonList.filter((k) => k.status !== "lunas").length.toLocaleString("id-ID")}</div>
                <div className="text-xs font-bold text-slate-700">Kasbon Aktif</div>
                <div className="text-[10px] text-slate-500">Pegawai yang masih punya sisa kasbon belum lunas.</div>
              </button>

              <button
                type="button"
                onClick={() => { setIssueCenterFilter("Prioritas Tinggi"); setIssueCenterOpen(true); }}
                className="rounded-3xl bg-violet-50 p-4 text-left active:scale-[0.99] transition-transform"
                style={{ border: "1px solid #ddd6fe" }}
              >
                <div className="flex items-center justify-between gap-2"><span className="text-xl">⚠️</span><span className="text-[10px] font-bold text-violet-600">Buka kendala ›</span></div>
                <div className="mt-2 text-2xl font-black text-violet-600">{activeIssueCenter.filter((x) => x.priority === "tinggi").length.toLocaleString("id-ID")}</div>
                <div className="text-xs font-bold text-slate-700">Prioritas Tinggi</div>
                <div className="text-[10px] text-slate-500">Data yang paling berisiko ke uang/invoice.</div>
              </button>
            </div>
          </div>

          {/* Kasbon inline — muncul saat card Kasbon Aktif diklik */}
          {dashboardDetail === "kasbon" && (() => {
            const kasbonAktif = kasbonList.filter((k) => k.status !== "lunas").sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""));
            const kasbonLunas = kasbonList.filter((k) => k.status === "lunas").sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""));
            const totalAktif = kasbonAktif.reduce((s, k) => s + Number(k.sisaKasbon || 0), 0);
            return (
              <div className="mx-4 mt-2 rounded-3xl bg-white p-4 shadow-sm space-y-3" style={{ border: "1.5px solid #f9a8d4" }}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-black text-pink-600">💳 Kasbon Pegawai</div>
                  <button type="button" onClick={() => setModal("kasbon")} className="rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>+ Kasbon Baru</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-amber-50 p-3" style={{ border: "1px solid #fde68a" }}>
                    <div className="text-xs font-semibold text-amber-600">Sisa Aktif</div>
                    <div className="text-lg font-black text-amber-700">{rupiah(totalAktif)}</div>
                    <div className="text-xs text-slate-400">{kasbonAktif.length} pegawai</div>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-3" style={{ border: "1px solid #d1fae5" }}>
                    <div className="text-xs font-semibold text-emerald-600">Total Diberikan</div>
                    <div className="text-lg font-black text-emerald-700">{rupiah(kasbonList.reduce((s, k) => s + Number(k.jumlah || 0), 0))}</div>
                    <div className="text-xs text-slate-400">{kasbonList.length} catatan</div>
                  </div>
                </div>
                {kasbonAktif.length > 0 && (
                  <div>
                    <div className="text-xs font-black text-amber-700 mb-2">⏳ Belum Lunas ({kasbonAktif.length})</div>
                    <div className="space-y-2">
                      {kasbonAktif.map((k) => (
                        <KasbonCard key={k.id} kasbon={k} onCicilan={tambahCicilanKasbon} onHapus={hapusKasbon} onBatalCicilan={batalCicilanRekap} isSaving={isSaving} />
                      ))}
                    </div>
                  </div>
                )}
                {kasbonLunas.length > 0 && (
                  <div>
                    <div className="text-xs font-black text-emerald-700 mb-2">✅ Sudah Lunas ({kasbonLunas.length})</div>
                    <div className="space-y-2">
                      {kasbonLunas.map((k) => (
                        <KasbonCard key={k.id} kasbon={k} onCicilan={tambahCicilanKasbon} onHapus={hapusKasbon} onBatalCicilan={batalCicilanRekap} isSaving={isSaving} lunas />
                      ))}
                    </div>
                  </div>
                )}
                {kasbonList.length === 0 && (
                  <div className="rounded-2xl bg-slate-50 p-6 text-center text-slate-400 text-sm">Belum ada data kasbon</div>
                )}
              </div>
            );
          })()}

          <div className="mx-4 mt-4 rounded-3xl bg-white p-5 shadow-sm" style={{ border: "1.5px solid #fed7aa", background: "linear-gradient(135deg,#fff7ed,#ffffff)" }}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-sm font-black" style={{ color: "#c2410c" }}>✅ Prioritas Hari Ini</div>
                <div className="text-[11px]" style={{ color: "#9a3412" }}>Maksimal 5 data terpenting. Ketuk item untuk langsung membuka data terkait.</div>
              </div>
              <button type="button" onClick={() => { setIssueCenterFilter("semua"); setIssueCenterOpen(true); }} className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: "#ffedd5", color: "#c2410c" }}>Lihat semua ›</button>
            </div>
            {activeIssueCenter.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700" style={{ border: "1px solid #bbf7d0" }}>✅ Semua data utama aman.</div>
            ) : (
              <div className="space-y-2">
                {activeIssueCenter.slice(0, 5).map((issue) => (
                  <button key={issue.id} type="button" onClick={() => openIssueTarget(issue)} className="w-full rounded-2xl bg-white p-3 text-left active:scale-[0.99]" style={{ border: "1px solid #fed7aa" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">{issue.title}</div>
                        <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{issue.subtitle}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${issue.priority === "tinggi" ? "bg-rose-100 text-rose-700" : issue.priority === "sedang" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{issue.priority}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 p-4">
            <button type="button" onClick={() => openDashboardDetail("hutang")} className="rounded-3xl bg-white p-4 text-left shadow-sm active:scale-[0.99]" style={{ border: "1px solid #fecdd3" }}>
              <div className="text-[10px] font-bold text-slate-400">Rincian supplier ›</div>
              <div className="mt-1 text-lg font-black text-rose-600">{rupiah(businessSummary.hutangSupplier || 0)}</div>
              <div className="text-xs font-bold text-slate-700">Tagihan Supplier</div>
            </button>
            <button type="button" onClick={() => openDashboardDetail("stok")} className="rounded-3xl bg-white p-4 text-left shadow-sm active:scale-[0.99]" style={{ border: "1px solid #bbf7d0" }}>
              <div className="text-[10px] font-bold text-slate-400">Buka stok kritis ›</div>
              <div className="mt-1 text-lg font-black text-emerald-600">{(businessSummary.stokKritis || []).length.toLocaleString("id-ID")}</div>
              <div className="text-xs font-bold text-slate-700">Stok Kritis</div>
            </button>
          </div>
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
            const list = ordersTabList;
            if (list.length === 0) return <div className="text-center py-10 text-slate-400">Tidak ada pesanan ditemukan</div>;
            return list.map((o) => {
              const paid = orderPaidTotal(o);
              const sisa = sisaOrder(o); // Math.max(0, ...) sudah ada di sisaOrder()
              const paymentHistory = orderPaymentHistory(o); // dipakai 2x di bawah, hitung sekali saja
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
                                {selisih !== 0 && <span className={selisih < 0 ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>· {selisih < 0 ? `Kurang kirim ${Math.abs(selisih)} pcs` : `Lebih kirim ${selisih} pcs`}</span>}
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
                    <div className="text-right space-y-0.5 min-w-[120px]">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Total Pesanan</div>
                      <div className="font-bold text-slate-700">{rupiah(moneyValue(o.total || 0))}</div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1">Total Tagihan</div>
                      <div className="font-bold text-purple-600">{rupiah(orderPaymentTarget(o))}</div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1">Sudah Dibayar</div>
                      <div className="font-bold text-emerald-600">{rupiah(paid)}</div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1">Sisa Tagihan</div>
                      {sisa > 0
                        ? <div className="font-bold text-rose-500">{rupiah(sisa)}</div>
                        : paid > 0
                          ? <div className="font-bold text-emerald-600">Lunas ✅</div>
                          : <div className="font-bold text-slate-400">Rp 0</div>
                      }
                    </div>
                  </div>
                  {paymentHistory.length > 0 && (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3 space-y-1">
                      <div className="text-xs font-semibold text-slate-500 mb-2">Riwayat Pembayaran</div>
                      {paymentHistory.map((p, i) => (
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
                      <button onClick={() => openKirimModal(o)} className="w-full rounded-2xl bg-sky-600 py-2 text-sm font-semibold text-white">✏️ Koreksi Pengiriman</button>
                    )}
                    {o.tanggalKirim && <div className="text-xs text-slate-400">🚚 Dikirim: {o.tanggalKirim}</div>}
                    {effectiveOrderStatus(o) === "Lunas" && <div className="text-xs text-emerald-600 font-semibold">✅ Lunas otomatis</div>}
                    {getDeliveryHistory(o).length > 0 && (
                      <div className="mt-2 rounded-2xl bg-sky-50 p-3 space-y-2" style={{ border: "1px solid #bae6fd" }}>
                        <div className="text-xs font-bold text-sky-700">🚚 Riwayat Pengiriman ({getDeliveryHistory(o).length}x)</div>
                        {getDeliveryHistory(o).map((delivery, dIdx) => (
                          <div key={dIdx} className="rounded-xl bg-white p-2.5 space-y-1" style={{ border: "1px solid #e0f2fe" }}>
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-bold text-sky-800">
                                📦 {delivery.date || "-"} {delivery.courier || delivery.ekspedisi ? `· ${delivery.courier || delivery.ekspedisi}` : ""}
                              </div>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => {
                                    setEditDeliveryModal({ order: o, deliveryIdx: dIdx });
                                    setEditDeliveryItems((delivery.items || []).map((it) => ({
                                      ...it,
                                      qty: Number(it.qty ?? it.shippedQty ?? 0),
                                    })));
                                    setEditDeliveryDate(delivery.date || delivery.tanggal || todayStr());
                                  }}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg"
                                  style={{ background: "#dbeafe", color: "#1d4ed8" }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  onClick={() => hapusDelivery(o, dIdx)}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg"
                                  style={{ background: "#fee2e2", color: "#dc2626" }}
                                >
                                  Hapus
                                </button>
                              </div>
                            </div>
                            {(delivery.items || []).map((it, iIdx) => {
                              const base = orderItemForDeliveryItem(o, it, iIdx) || {};
                              const qty = Number(it.qty ?? it.shippedQty ?? 0);
                              const price = moneyValue(it.price ?? base.price ?? 0);
                              return (
                                <div key={iIdx} className="text-xs text-slate-600 flex justify-between gap-3">
                                  <span className="min-w-0 truncate">{base.name || it.name || "Produk"}</span>
                                  <span className="font-semibold text-right shrink-0">{qty.toLocaleString("id-ID")} pcs · {rupiah(qty * price)}</span>
                                </div>
                              );
                            })}
                            {delivery.source === "gallery-produksi" && (
                              <div className="text-[10px] font-bold" style={{ color: "#7c3aed" }}>via Gallery Produksi</div>
                            )}
                            {(() => {
                              const gid = delivery.groupId || delivery.noteNumber || "";
                              const ongkirDelivery = gid
                                ? (shipmentBatches || []).find(b => b.groupId === gid || b.noteNumber === gid)
                                : null;
                              const ongkir = moneyValue(ongkirDelivery?.ongkir ?? ongkirDelivery?.shippingCost ?? delivery.ongkir ?? delivery.shippingCost ?? 0);
                              return ongkir > 0 ? (
                                <div className="text-xs text-slate-500 flex justify-between">
                                  <span>🚚 Ongkir</span>
                                  <span className="font-semibold">{rupiah(ongkir)}</span>
                                </div>
                              ) : null;
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => openReturModal(o)} className="mt-3 w-full rounded-2xl bg-amber-500 py-2 text-sm font-semibold text-white">↩️ Input Retur</button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
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
          {/* PERFORMA: filteredPurchases sudah disortir sortPurchaseNewestFirst di useMemo-nya, tidak perlu sort ulang di sini setiap render */}
          {filteredPurchases.map((p) => {
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
                        <div key={i} className="text-xs text-slate-500">• {it.name}: {it.qty} {it.unit} · {rupiah(purchaseMaterialTotal(it))}</div>
                      ))}
                      {moneyValue(p.shippingCost || p.ongkir || 0) > 0 && (
                        <div className="text-xs text-slate-500">• Ongkir: {rupiah(p.shippingCost || p.ongkir || 0)}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right"><div className="font-bold">{rupiah(purchaseInvoiceTotal(p))}</div><div className="text-sm text-rose-500">Sisa tagihan {rupiah(sisa)}</div></div>
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
                    Transfer supplier ini bisa diedit. Setelah disimpan, realisasi pembayaran supplier akan ikut diperbarui.
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
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div className="rounded-2xl bg-purple-50 p-3"><div className="text-slate-400">Total Produk</div><div className="text-xl font-bold text-purple-600">{productMasters.length}</div></div>
              <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-slate-400">Aktif</div><div className="text-xl font-bold text-emerald-600">{productMasters.filter(p => p.isActive !== false).length}</div></div>
            </div>
            <button
              type="button"
              onClick={jalankanScan}
              className="w-full rounded-2xl py-3 text-sm font-bold"
              style={{ background: repairScanned ? "#f0fdf4" : "linear-gradient(135deg,#f97316,#ea580c)", color: repairScanned ? "#166534" : "#fff", border: repairScanned ? "1.5px solid #bbf7d0" : "none" }}
            >
              {repairScanned
                ? `✅ Scan selesai — ${Object.keys(repairIssues).length > 0 ? `${Object.values(repairIssues).reduce((s, a) => s + a.length, 0)} data bermasalah di ${Object.keys(repairIssues).length} produk` : "Semua data bersih"} · Scan ulang`
                : "🔍 Scan Data Produk"}
            </button>
          </div>
          {productQuickFilter === "missing-hpp" && (
            <div className="rounded-2xl bg-pink-50 p-3 text-xs font-bold text-pink-700 flex items-center justify-between gap-2" style={{ border: "1px solid #f9a8d4" }}>
              <span>Menampilkan produk aktif yang belum punya HPP saja.</span>
              <button type="button" onClick={() => setProductQuickFilter("semua")} className="rounded-full bg-white px-3 py-1 text-pink-600">Tampilkan semua</button>
            </div>
          )}
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
                  {getIssueCountForProduct(p.id) > 0 && (
                    <button type="button" onClick={() => { setRepairModal({ productId: p.id, productName: p.name }); setRepairPriceEdits({}); }}
                      className="w-full rounded-2xl py-2 text-xs font-bold"
                      style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", color: "#ea580c" }}>
                      ⚠️ {getIssueCountForProduct(p.id)} data bermasalah — Perbaiki
                    </button>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button className="bg-sky-600 flex-1" onClick={() => {
                    const qty = numberValue(p.materialQtyPerPcs || 0);
                    const bahanCost = moneyValue(p.bahanCost || 0);
                    const bahanPricePerUnit = moneyValue(p.bahanPricePerUnit || 0) > 0 ? moneyValue(p.bahanPricePerUnit || 0) : (qty > 0 && bahanCost > 0 ? Math.round(bahanCost / qty) : 0);
                    setProductForm({ ...emptyProductForm, ...p, bahanPricePerUnit, hppMaterials: normalizeHppMaterials(p).length > 0 ? normalizeHppMaterials(p) : [emptyHppMaterialLine()] });
                    setModal("product");
                  }}>Edit</Button>
                  <Button className="bg-pink-600 flex-1" onClick={() => setOrderForm(f => ({ ...f, items: [...(f.items || []), { ...emptyOrderItem(), productId: p.id, name: p.name, category: p.category, price: p.defaultPrice, bahanCost: hppMaterialsCost(p) || moneyValue(p.bahanCost || 0), hppPerPcs: hpp, mainMaterial: p.mainMaterial || "", materialQtyPerPcs: p.materialQtyPerPcs || 0, unit: p.unit || "yard", hppMaterials: normalizeHppMaterials(p) }] }))}>Pakai</Button>
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
                const stockInfo = safeMaterialStockInfo(m, purchases);
                const safeAvgCost = stockInfo.avgCost;
                const safeTotalValue = stockInfo.totalValue;
                return (
                  <div key={m.id} className="rounded-2xl p-4" style={{ background: low ? "#fff1f2" : "#f8fafc", border: low ? "1px solid #fecdd3" : "1px solid #e2e8f0" }}>
                    <div className="flex justify-between items-start gap-3">
                      <div><div className="font-bold text-slate-800">{m.name}</div><div className="text-xs text-slate-400">{m.category || "Kain"} · min {Number(m.minStock || 0)} {m.unit || "yard"}</div></div>
                      <div className="text-right"><div className={`text-lg font-bold ${low ? "text-rose-600" : "text-emerald-600"}`}>{stock.toLocaleString("id-ID")} {m.unit || "yard"}</div><div className="text-xs text-slate-400">Modal avg {rupiah(safeAvgCost)}/{m.unit || "yard"}</div></div>
                    </div>
                    <div className="mt-2 flex justify-between text-xs">
                      <span className={low ? "font-bold text-rose-600" : "font-semibold text-emerald-600"}>{low ? "⚠️ Stok menipis" : "✅ Stok aman"}</span>
                      <span className="text-slate-400">Nilai stok {rupiah(safeTotalValue)}{stockInfo.abnormal ? " · diperbaiki dari riwayat pembelian" : ""}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Audit lama dipindahkan ke Pusat Kendala Kerudung di Dashboard */}

      {/* ── RETUR TAB ── */}
      {!loading && tab === "retur" && (() => {
        const sortedReturns = [...(returns || [])].sort((a, b) => dateSerial(b.tanggal || b.createdAt || "") - dateSerial(a.tanggal || a.createdAt || ""));
        const siapDijualLagi = sortedReturns.filter((r) => r.kondisi === "bisa_dijual_lagi");
        const belumTerjual = siapDijualLagi.filter((r) => r.statusJualUlang !== "sudah_terjual");
        const belumTerjualPcs = belumTerjual.reduce((s, r) => s + Number(r.qty || 0), 0);
        const rugiList = sortedReturns.filter((r) => r.kondisi === "rusak");
        const totalRugi = moneySum(rugiList, (r) => Number(r.qty || 0) * moneyValue(r.price || 0));
        const filtered = returFilter === "siap_dijual" ? siapDijualLagi : returFilter === "rugi" ? rugiList : sortedReturns;

        return (
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl p-3" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                <div className="text-xs text-slate-400">Siap Dijual Lagi (belum laku)</div>
                <div className="text-xl font-bold" style={{ color: "#c2410c" }}>{belumTerjualPcs} pcs</div>
              </div>
              <div className="rounded-2xl p-3" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                <div className="text-xs text-slate-400">Total Rugi Retur</div>
                <div className="text-xl font-bold text-rose-600">{rupiah(totalRugi)}</div>
              </div>
            </div>

            <div className="flex gap-2">
              {[
                { id: "semua", label: "Semua" },
                { id: "siap_dijual", label: "Siap Dijual Lagi" },
                { id: "rugi", label: "Rugi/Rusak" },
              ].map((f) => (
                <button key={f.id} onClick={() => setReturFilter(f.id)}
                  className="flex-1 rounded-2xl py-2 text-xs font-bold"
                  style={{ background: returFilter === f.id ? "#ec4899" : "#fdf2f8", color: returFilter === f.id ? "white" : "#ec4899" }}>
                  {f.label}
                </button>
              ))}
            </div>

            {filtered.length === 0 && <div className="text-center py-10 text-slate-400">Belum ada catatan retur</div>}

            {filtered.map((r) => (
              <div key={r.id} className="rounded-3xl bg-white p-4 shadow-sm" style={{ border: r.kondisi === "rusak" ? "1.5px solid #fecaca" : "1.5px solid #bbf7d0" }}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800">{r.itemName} · {r.qty} pcs</div>
                    <div className="text-xs text-slate-400 mt-0.5">{r.customer} · {r.invoice || "-"}</div>
                    <div className="text-xs text-slate-400">📅 {r.tanggal || "-"}</div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-bold shrink-0 ${r.kondisi === "rusak" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {r.kondisi === "rusak" ? "❌ Rusak" : "✅ Bisa Dijual Lagi"}
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-600">Alasan: {r.alasan}</div>
                {r.catatan && <div className="text-xs text-slate-400 mt-1">Catatan: {r.catatan}</div>}
                <div className="mt-2 text-sm font-semibold" style={{ color: r.kondisi === "rusak" ? "#e11d48" : "#7c3aed" }}>
                  Nilai: {rupiah(Number(r.qty || 0) * moneyValue(r.price || 0))}
                </div>

                {r.tagihanDikurangi ? (
                  <div className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                    ✅ Tagihan dikurangi {rupiah(Number(r.tagihanDikurangiNominal ?? (Number(r.qty || 0) * moneyValue(r.price || 0))))}
                    {r.tagihanDikurangiAt ? ` · ${r.tagihanDikurangiAt}` : ""}
                  </div>
                ) : (
                  <button onClick={() => kurangiTagihanDariRetur(r)} disabled={isSaving} className="mt-3 w-full rounded-2xl py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#0ea5e9,#38bdf8)" }}>
                    💸 Kurangi Tagihan Sekarang
                  </button>
                )}

                {r.kondisi === "bisa_dijual_lagi" && r.statusJualUlang !== "sudah_terjual" && (
                  <button onClick={() => jualLagiRetur(r)} disabled={isSaving} className="mt-2 w-full rounded-2xl py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#a855f7,#c084fc)" }}>
                    🛍️ Jual ke Customer Baru
                  </button>
                )}
                {r.kondisi === "bisa_dijual_lagi" && r.statusJualUlang === "sudah_terjual" && r.terjualKe && (
                  <div className="mt-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: "#faf5ff", color: "#7c3aed" }}>🛍️ Terjual ke {r.terjualKe}{r.terjualInvoice ? ` · ${r.terjualInvoice}` : ""}</div>
                )}

                <div className="mt-2 flex gap-2">
                  {r.kondisi === "bisa_dijual_lagi" && (
                    <button
                      onClick={() => tandaiReturTerjual(r)}
                      disabled={isSaving}
                      className="flex-1 rounded-2xl py-2 text-xs font-bold text-white disabled:opacity-50"
                      style={{ background: r.statusJualUlang === "sudah_terjual" ? "#94a3b8" : "linear-gradient(135deg,#10b981,#34d399)" }}
                    >
                      {r.statusJualUlang === "sudah_terjual" ? "↩️ Tandai Belum Terjual" : "✅ Tandai Sudah Terjual"}
                    </button>
                  )}
                  <button onClick={() => hapusRetur(r)} disabled={isSaving} className="rounded-2xl px-4 py-2 text-xs font-bold text-rose-500 disabled:opacity-50" style={{ background: "#fff1f2", border: "1px solid #fecaca" }}>
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── REKAP TAB ── */}
      {!loading && tab === "rekap" && (() => {
        const s = rekapSummary();
        const customerRows = customerRowsInRekapRange();
        const transferInRowsAll = [...autoTransferInRows].filter((t) => inRekapRange(t.date || ""));
        const transferOutRowsAll = [...autoTransferOutRows].filter((t) => inRekapRange(t.date || ""));
        const transferInNameOptionsInRange = ["semua", ...Array.from(new Set(transferInRowsAll.map((t) => capitalizeWords(t.customer || "")).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
        const transferOutNameOptionsInRange = ["semua", ...Array.from(new Set(transferOutRowsAll.map((t) => capitalizeWords(t.supplier || "")).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
        const transferInRows = filterTransferInName === "semua" ? transferInRowsAll : transferInRowsAll.filter((t) => normalizeName(t.customer) === normalizeName(filterTransferInName));
        const transferOutRows = filterTransferOutName === "semua" ? transferOutRowsAll : transferOutRowsAll.filter((t) => normalizeName(t.supplier) === normalizeName(filterTransferOutName));
        const totalTransferInRows = transferInRows.reduce((sum, t) => sum + moneyValue(t.amount || 0), 0);
        const totalTransferOutRows = transferOutRows.reduce((sum, t) => sum + moneyValue(t.amount || 0), 0);
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
              <div className="mt-3 rounded-2xl bg-pink-50 p-3">
                <div className="text-xs font-bold text-slate-500 mb-2">Dasar periode Ringkasan Bisnis</div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRekapDateBasis("order")} className={`rounded-2xl px-3 py-2 text-xs font-bold ${rekapDateBasis === "order" ? "bg-pink-600 text-white" : "bg-white text-slate-500"}`}>Tanggal Order</button>
                  <button type="button" onClick={() => setRekapDateBasis("kirim")} className={`rounded-2xl px-3 py-2 text-xs font-bold ${rekapDateBasis === "kirim" ? "bg-pink-600 text-white" : "bg-white text-slate-500"}`}>Tanggal Kirim/Realisasi</button>
                </div>
                <div className="mt-2 text-[11px] text-slate-500">Default: Tanggal Kirim/Realisasi. Penjualan dan HPP dihitung dari barang yang sudah dikirim.</div>
              </div>
              <div className="mt-4">
                <Button onClick={downloadRekapTanggalPdf} className="w-full" style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>📄 Download PDF</Button>
              </div>
            </div>

            {/* Ringkasan */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #c4b5fd" }}>
              <div className="text-lg font-bold mb-3" style={{ color: "#7c3aed" }}>Ringkasan Bisnis</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-pink-50 p-3"><div className="text-xs text-slate-400">Realisasi Penjualan</div><div className="font-bold text-pink-600">{rupiah(s.realisasi)}</div></div>
                <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-xs text-slate-400">{s.laba < 0 ? "Rugi Bersih" : "Laba Bersih"}</div><div className={`font-bold ${s.laba >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{s.laba < 0 ? "-" : ""}{rupiah(Math.abs(s.laba))}</div></div>
                <div className="rounded-2xl bg-sky-50 p-3"><div className="text-xs text-slate-400">Piutang Customer Saat Ini</div><div className="font-bold text-sky-600">{rupiah(s.piutang)}</div></div>
                <div className="rounded-2xl bg-rose-50 p-3"><div className="text-xs text-slate-400">Tagihan Supplier</div><div className="font-bold text-rose-600">{rupiah(s.hutangSupplier)}</div></div>
                <div className="rounded-2xl bg-violet-50 p-3"><div className="text-xs text-slate-400">HPP Terkirim</div><div className="font-bold text-violet-600">{rupiah(s.hpp)}</div></div>
                <div className="rounded-2xl bg-amber-50 p-3"><div className="text-xs text-slate-400">Gaji Produksi</div><div className="font-bold text-amber-600">{rupiah(s.gajiProduksi)}</div></div>
                <div className="rounded-2xl bg-orange-50 p-3"><div className="text-xs text-slate-400">Pengeluaran Lain</div><div className="font-bold text-orange-600">{rupiah(s.pengeluaran)}</div></div>
              </div>
            </div>

            {/* Invoice Customer */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #f9a8d4" }}>
              <div className="text-lg font-bold mb-1" style={{ color: "#ec4899" }}>📄 Invoice Customer</div>
              <div className="text-xs text-slate-500 mb-3">Piutang Belum Lunas memakai saldo aktif saat ini agar sama dengan Dashboard. Filter tanggal tetap untuk daftar invoice lunas/semua.</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <DatePicker label="Dari Tanggal" value={invoiceStartDate} onChange={setInvoiceStartDate} />
                <DatePicker label="Sampai Tanggal" value={invoiceEndDate} onChange={setInvoiceEndDate} />
              </div>
              {(invoiceStartDate || invoiceEndDate) && (
                <button type="button" onClick={() => { setInvoiceStartDate(""); setInvoiceEndDate(""); }} className="w-full rounded-2xl py-2 text-xs font-bold" style={{ background: "#f1f5f9", color: "#64748b" }}>
                  ✕ Reset Filter Tanggal
                </button>
              )}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { key: "semua", label: "Semua" },
                  { key: "belum", label: "Belum Lunas" },
                  { key: "lunas", label: "Lunas" },
                ].map((opt) => {
                  const active = invoiceStatusFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setInvoiceStatusFilter(opt.key)}
                      className={`rounded-2xl px-2 py-2 text-xs font-bold border transition ${active ? "text-white" : "text-slate-600 bg-white"}`}
                      style={active ? { background: "linear-gradient(135deg,#ec4899,#f472b6)", borderColor: "#ec4899" } : { borderColor: "#fbcfe8" }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2">
                {(() => {
                  const invoiceRows = (() => {
                    // Khusus filter Belum Lunas, tampilkan piutang aktif saat ini dari satu sumber
                    // yang sama dengan Dashboard dan Ringkasan Rekap. Tanggal periode tidak dipakai
                    // untuk piutang aktif agar tidak muncul dua nominal berbeda.
                    if (invoiceStatusFilter === "belum") {
                      return [...(uniqueCustomers || [])]
                        .map((c) => customerReceivableTotals(c.name))
                        .filter((row) => Number(row.sisa || 0) > 0)
                        .sort((a, b) => a.name.localeCompare(b.name));
                    }

                    const map = {};
                    const allOrders = orders || [];
                    const orderById = new Map(allOrders.map((o) => [String(o.id || "").trim(), o]));
                    const orderByInvoice = new Map(allOrders.map((o) => [String(o.invoice || "").trim(), o]));
                    const officialCoveredKeys = new Set();

                    const ensureRow = (rawName) => {
                      const name = capitalizeWords(rawName || "");
                      const key = normalizeName(name);
                      if (!key) return null;
                      if (!map[key]) {
                        map[key] = {
                          name,
                          ordersMap: new Map(),
                          batchCount: 0,
                        };
                      }
                      return map[key];
                    };

                    // Catatan: totalTagihan/totalBayar/sisa TIDAK diakumulasi manual di sini.
                    // Nilai final selalu diambil dari customerReceivableTotals (current, baris di
                    // bawah) agar satu sumber kebenaran dengan Dashboard/Rekap/card Belum Lunas.
                    // ordersMap dipakai untuk de-dupe order + hitung orderCount sesuai filter tanggal.
                    const addOrderToRow = (row, order) => {
                      if (!row || !order) return;
                      const key = String(order.id || order.invoice || "").trim();
                      if (key) row.ordersMap.set(key, order);
                    };

                    const findOrdersForBatch = (batch) => {
                      const ids = [
                        ...(Array.isArray(batch.orderIds) ? batch.orderIds : []),
                        ...(Array.isArray(batch.pesananIds) ? batch.pesananIds : []),
                        ...(Array.isArray(batch.invoices) ? batch.invoices : []),
                      ].map((x) => String(x || "").trim()).filter(Boolean);

                      const fromBatchRows = (Array.isArray(batch.orders) ? batch.orders : []).flatMap((row) => {
                        const rowOrderId = String(row.orderId || row.pesananId || "").trim();
                        const rowInvoice = String(row.invoice || "").trim();
                        const found = orderById.get(rowOrderId) || orderByInvoice.get(rowInvoice);
                        return found ? [found] : [];
                      });

                      const fromIds = ids.flatMap((id) => {
                        const found = orderById.get(id) || orderByInvoice.get(id);
                        return found ? [found] : [];
                      });

                      return Array.from(new Map([...fromBatchRows, ...fromIds].map((o) => [o.id || o.invoice, o])).values());
                    };

                    const officialBatchTotal = (batch) => {
                      const batchItems = Array.isArray(batch.items) ? batch.items : [];
                      const rows = Array.isArray(batch.orders) && batch.orders.length > 0 ? batch.orders : [];

                      const totalForItems = (items = [], order = {}) => (items || []).reduce((sum, it, idx) => {
                        const qty = Number(it.shippedQty ?? it.qtyKirim ?? it.qty ?? it.kirim ?? 0);
                        if (qty <= 0) return sum;
                        const base = order?.id || order?.invoice ? (orderItemForDeliveryItem(order, it, idx) || {}) : {};
                        const basePrice = firstPositiveMoney(base?.price, base?.harga, base?.hargaJual, base?.hargaPcs, base?.sellingPrice, base?.salePrice, base?.unitPrice, base?.hargaSatuan);
                        const price = basePrice > 0 ? basePrice : resolveSalePrice(it, base, order || {}, productMasters);
                        return sum + qty * price;
                      }, 0);

                      const calculated = rows.length > 0
                        ? rows.reduce((sum, row, rowIdx) => {
                            const rowOrderId = String(row.orderId || row.pesananId || "").trim();
                            const rowInvoice = String(row.invoice || "").trim();
                            const order = orderById.get(rowOrderId) || orderByInvoice.get(rowInvoice) || {};
                            const rowItems = Array.isArray(row.items) && row.items.length > 0
                              ? row.items
                              : batchItems.filter((it) => {
                                  const itOrderId = String(it.orderId || it.pesananId || "").trim();
                                  const itInvoice = String(it.invoice || "").trim();
                                  return (rowOrderId && itOrderId === rowOrderId) || (rowInvoice && itInvoice === rowInvoice);
                                });
                            return sum + totalForItems(rowItems, order);
                          }, 0)
                        : totalForItems(batchItems, findOrdersForBatch(batch)[0] || {});

                      const ongkir = moneyValue(batch.ongkir ?? batch.shippingCost ?? 0);
                      if (calculated > 0) return calculated + ongkir;
                      return moneyValue(batch.totalTagihanBatch ?? batch.totalTagihan ?? batch.totalBatch ?? batch.total ?? 0) + ongkir;
                    };

                    // Prioritas utama: nota gabungan resmi dari App Produksi.
                    // Tanpa bagian ini, halaman Invoice Customer bisa kosong pada periode yang
                    // sebenarnya punya shipment_batches, karena daftar customer sebelumnya hanya
                    // membaca orders.deliveries.
                    (shipmentBatches || []).forEach((batch) => {
                      const dateKey = invoiceDateKeyFromValue(batch.tanggalKirim || batch.date || batch.createdAt || batch.shippedAt || batch.deliveredAt || "");
                      if (!isDateKeyInRange(dateKey, invoiceStartDate, invoiceEndDate)) return;

                      const relatedOrders = findOrdersForBatch(batch);
                      const batchCustomer = capitalizeWords(batch.customerName || batch.customer || batch.receiver || batch.penerima || relatedOrders[0]?.customer || "");
                      const row = ensureRow(batchCustomer);
                      if (!row) return;

                      const total = officialBatchTotal(batch);
                      if (total <= 0) return;

                      row.batchCount += Math.max(1, relatedOrders.length);
                      relatedOrders.forEach((order) => addOrderToRow(row, order));

                      const groupKey = batch.groupId || batch.noteNumber || batch.id || "";
                      relatedOrders.forEach((order) => {
                        const orderKey = order.id || order.invoice || "";
                        if (orderKey && groupKey) officialCoveredKeys.add(`${orderKey}|${groupKey}|${dateKey || ""}`);
                      });
                    });

                    // Fallback data lama: deliveries yang tersimpan di masing-masing order.
                    allOrders.forEach((o) => {
                      const name = capitalizeWords(o.customer || "");
                      const row = ensureRow(name);
                      if (!row) return;

                      const batches = getOrderInvoiceBatches(o)
                        .filter((batch) => isDateKeyInRange(batch.dateKey, invoiceStartDate, invoiceEndDate))
                        .filter((batch) => {
                          const groupKey = batch.delivery?.groupId || batch.delivery?.noteNumber || "";
                          const orderKey = o.id || o.invoice || batch.id;
                          const dateKey = batch.dateKey || "";
                          if (!groupKey) {
                            // Delivery tanpa groupId: cek apakah official batch sudah cover
                            const coveredByOfficial = Array.from(officialCoveredKeys).some(
                              (k) => k.startsWith(`${orderKey}|`) && k.endsWith(`|${dateKey}`)
                            );
                            return !coveredByOfficial;
                          }
                          return !officialCoveredKeys.has(`${orderKey}|${groupKey}|${dateKey}`);
                        });

                      const invoiceTotal = batches.reduce((sum, batch) => sum + Number(batch.total || 0), 0);
                      if (invoiceTotal <= 0) return;

                      row.batchCount += 1;
                      addOrderToRow(row, o);
                    });

                    // Status LUNAS/BELUM LUNAS dan badge tetap pakai saldo aktif global (current)
                    // agar konsisten dengan Dashboard/Rekap — TIDAK diubah.
                    // Tapi "X pesanan" yang ditampilkan harus mengikuti filter tanggal yang
                    // sedang aktif (ordersList, dikumpulkan dari batch yang sudah difilter di atas),
                    // bukan jumlah pesanan customer sepanjang masa. Tanpa filter tanggal, ordersList
                    // otomatis berisi semua pesanan (isDateKeyInRange meloloskan semua jika kosong),
                    // sehingga hasilnya tetap sama seperti sebelumnya.
                    return Object.values(map)
                      .map((row) => {
                        const ordersList = Array.from(row.ordersMap.values());
                        const current = customerReceivableTotals(row.name);
                        return {
                          ...row,
                          orders: ordersList.length > 0 ? ordersList : current.orders,
                          orderCount: ordersList.length || Math.max(row.batchCount || 0, current.orderCount || 0),
                          totalTagihan: current.totalTagihan,
                          totalBayar: current.totalBayar,
                          sisa: current.sisa,
                        };
                      })
                      .filter((row) => {
                        if (Number(row.totalTagihan || 0) <= 0) return false;
                        if (invoiceStatusFilter === "belum") return row.sisa > 0;
                        if (invoiceStatusFilter === "lunas") return row.sisa <= 0 && Number(row.totalTagihan || 0) > 0;
                        return true;
                      })
                      .sort((a, b) => a.name.localeCompare(b.name));
                  })();
                  const emptyText = invoiceStatusFilter === "belum"
                    ? "Tidak ada customer belum lunas pada periode ini"
                    : invoiceStatusFilter === "lunas"
                      ? "Tidak ada customer lunas pada periode ini"
                      : "Tidak ada customer pada periode ini";
                  return invoiceRows.length === 0
                    ? <div className="text-center py-4 text-slate-400">{emptyText}</div>
                    : invoiceRows.map((c) => {
                      const isLunas = c.sisa <= 0;
                      return (
                        <div key={c.name} className="flex items-center justify-between rounded-2xl p-3" style={{ background: isLunas ? "#f0fdf4" : "#fdf2f8", border: `1px solid ${isLunas ? "#bbf7d0" : "#fce7f3"}` }}>
                          <div className="pr-3">
                            <div className="font-bold text-sm text-slate-800">{c.name}</div>
                            <div className="text-xs text-slate-500">{c.orderCount || c.orders.length} pesanan</div>
                            <div className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: isLunas ? "#dcfce7" : "#fee2e2", color: isLunas ? "#047857" : "#be123c" }}>
                              {isLunas ? "LUNAS" : "BELUM LUNAS"}
                            </div>
                          </div>
                          <button
                            onClick={() => setInvoiceCustomer(c.name)}
                            className="rounded-xl px-3 py-2 text-xs font-bold text-white shrink-0"
                            style={{ background: isLunas ? "linear-gradient(135deg,#64748b,#475569)" : "linear-gradient(135deg,#25d366,#128c7e)" }}
                          >
                            {isLunas ? "Lihat" : "WA"}
                          </button>
                        </div>
                      );
                    });
                })()}
              </div>
            </div>

            {/* Log Pembayaran Customer */}
            <div className="rounded-3xl p-5 bg-white shadow-sm" style={{ border: "1.5px solid #a5f3fc" }}>
              <div className="text-lg font-bold mb-1" style={{ color: "#0891b2" }}>💙 Log Pembayaran Customer</div>
              <div className="text-xs text-slate-400 mb-3">Mengikuti periode tanggal di atas.</div>
              <div className="mb-3 grid grid-cols-1 gap-2">
                <Select label="Filter Customer" value={filterTransferInName} onChange={setFilterTransferInName}>
                  {transferInNameOptionsInRange.map((name) => <option key={name} value={name}>{name === "semua" ? "Semua Customer" : name}</option>)}
                </Select>
                <div className="rounded-2xl bg-cyan-50 p-3 text-sm font-bold text-cyan-700">Total tampil: {rupiah(totalTransferInRows)}</div>
              </div>
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
              <div className="mb-3 grid grid-cols-1 gap-2">
                <Select label="Filter Supplier" value={filterTransferOutName} onChange={setFilterTransferOutName}>
                  {transferOutNameOptionsInRange.map((name) => <option key={name} value={name}>{name === "semua" ? "Semua Supplier" : name}</option>)}
                </Select>
                <div className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700">Total tampil: {rupiah(totalTransferOutRows)}</div>
              </div>
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
                <Button onClick={exportBackupXlsx} className="w-full text-xs" style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>Backup Excel</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════ MODALS ════ */}

      {dashboardDetail && <DashboardDetailModal />}
      {issueCenterOpen && <IssueCenterModal />}

      {/* Modal Transfer Keluar */}
      {modal === "transferOut" && (
        <SimpleModal title="Catat Transfer Keluar" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">
              🔴 Catatan transfer keluar bebas — tidak otomatis dikurangi dari tagihan supplier. Hanya sebagai bukti kas keluar real per tanggal.
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
              💙 Catatan transfer bebas — dicatat sebagai bukti kas masuk real per tanggal.
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
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-700">HPP Produk (opsional)</div>
                  <div className="text-[11px] text-slate-500">Bisa lebih dari 1 bahan, misalnya setelan: baju bahan A dan celana bahan B.</div>
                </div>
                <button type="button" onClick={() => setProductForm(f => ({ ...f, hppMaterials: [...(Array.isArray(f.hppMaterials) ? f.hppMaterials : []), emptyHppMaterialLine()] }))} className="rounded-xl bg-purple-100 px-3 py-2 text-xs font-bold text-purple-700">+ Bahan</button>
              </div>
              {(Array.isArray(productForm.hppMaterials) && productForm.hppMaterials.length > 0 ? productForm.hppMaterials : [emptyHppMaterialLine()]).map((mat, idx) => {
                const unit = mat.unit || "yard";
                const usage = numberValue(mat.usagePerPcs || 0);
                const pricePerUnit = moneyValue(mat.pricePerUnit || 0);
                const subtotal = usage > 0 && pricePerUnit > 0 ? Math.round(usage * pricePerUnit) : moneyValue(mat.total || 0);
                const updateMaterial = (patch) => setProductForm(f => {
                  const rows = Array.isArray(f.hppMaterials) && f.hppMaterials.length > 0 ? [...f.hppMaterials] : [emptyHppMaterialLine()];
                  rows[idx] = { ...rows[idx], ...patch };
                  return { ...f, hppMaterials: rows };
                });
                return (
                  <div key={idx} className="rounded-2xl bg-white p-3 space-y-2 border border-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-600">Bahan #{idx + 1}</div>
                      {idx > 0 && <button type="button" onClick={() => setProductForm(f => ({ ...f, hppMaterials: (f.hppMaterials || []).filter((_, i) => i !== idx) }))} className="text-xs font-bold text-rose-500">Hapus</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Bagian" value={mat.part || ""} onChange={(v) => updateMaterial({ part: v })} placeholder="Baju / Celana" />
                      <Input label="Nama Bahan" value={mat.name || ""} onChange={(v) => updateMaterial({ name: v })} placeholder="Bahan A" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Kebutuhan / pcs" type="number" value={mat.usagePerPcs || ""} onChange={(v) => updateMaterial({ usagePerPcs: v, total: Math.round(numberValue(v || 0) * pricePerUnit) })} />
                      <Select label="Satuan" value={unit} onChange={(v) => updateMaterial({ unit: v })}><option value="yard">yard</option><option value="kg">kg</option></Select>
                    </div>
                    <Input label={`Harga Bahan / ${unit}`} type="money" value={mat.pricePerUnit || 0} onChange={(v) => updateMaterial({ pricePerUnit: v, total: Math.round(usage * moneyValue(v || 0)) })} placeholder={`Harga per ${unit}`} />
                    {(usage > 0 || pricePerUnit > 0) && (
                      <div className="flex justify-between rounded-xl px-3 py-2 text-xs" style={{ background: "#f5f3ff" }}>
                        <span className="text-slate-500">Subtotal bahan / pcs</span>
                        <span className="font-bold text-purple-600">{rupiah(pricePerUnit)} × {usage} {unit} = <strong>{rupiah(subtotal)}</strong></span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-between rounded-xl px-3 py-2 text-xs" style={{ background: "#ecfeff" }}>
                <span className="text-slate-500">Total semua bahan / pcs</span>
                <span className="font-bold text-cyan-700">{rupiah(hppMaterialsCost(productForm))}</span>
              </div>
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
                      onChange={(e) => { const v = e.target.value; const master = findProductMaster(v); setOrderForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, name: v, productId: master?.id || x.productId || "", category: master?.category || x.category || "", price: master?.defaultPrice !== undefined ? moneyValue(master.defaultPrice || 0) : x.price, bahanCost: master ? (hppMaterialsCost(master) || moneyValue(master.bahanCost || 0)) : moneyValue(x.bahanCost || 0), hppPerPcs: master ? calculateProductHpp(master) : moneyValue(x.hppPerPcs || 0), mainMaterial: master?.mainMaterial || x.mainMaterial || "", materialQtyPerPcs: master?.materialQtyPerPcs || x.materialQtyPerPcs || 0, unit: master?.unit || x.unit || "yard", hppMaterials: master ? normalizeHppMaterials(master) : normalizeHppMaterials(x) } : x) })); }}
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

      {modal === "kasbon" && (
        <SimpleModal title="💰 Kasbon Pegawai" onClose={() => { setKasbonForm({ employeeName: "", tanggal: "", jumlah: "", keterangan: "" }); setModal(null); }}>
          <div className="space-y-3">
            <div className="rounded-2xl p-3 text-xs font-semibold" style={{ background: "#fefce8", border: "1px solid #fde68a", color: "#92400e" }}>
              💡 Kasbon otomatis tercatat sebagai pengeluaran Gallery Kerudung dan bisa dipotong dari gaji di Gallery Produksi.
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "#d97706" }}>Nama Pegawai</label>
              <input
                list="kasbon-worker-list"
                value={kasbonForm.employeeName}
                onChange={(e) => setKasbonForm(f => ({ ...f, employeeName: e.target.value }))}
                placeholder="Ketik nama pekerja borongan"
                className="w-full px-4 py-3 outline-none text-sm rounded-2xl"
                style={{ border: "1.5px solid #fde68a", background: "#fffbeb", color: "#2d1b69" }}
              />
              <datalist id="kasbon-worker-list">
                {[...new Set([
                  ...masterPekerja.map(p => p.nama).filter(Boolean),
                  ...payrollExpenses.filter(p => p.employeeName).map(p => p.employeeName),
                  ...kasbonList.map(k => k.employeeName).filter(Boolean),
                ])].sort().map(n => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <DatePicker label="Tanggal Kasbon" value={kasbonForm.tanggal || todayStr()} onChange={(v) => setKasbonForm(f => ({ ...f, tanggal: v }))} />
            <Input label="Jumlah Kasbon" type="money" value={kasbonForm.jumlah} onChange={(v) => setKasbonForm(f => ({ ...f, jumlah: v }))} />
            <Input label="Keterangan (opsional)" value={kasbonForm.keterangan} onChange={(v) => setKasbonForm(f => ({ ...f, keterangan: v }))} placeholder="Contoh: Keperluan lebaran" />
            {moneyValue(kasbonForm.jumlah || 0) > 0 && (
              <div className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: "#fef3c7", color: "#92400e" }}>
                Akan dicatat sebagai pengeluaran: <span style={{ color: "#d97706" }}>{rupiah(moneyValue(kasbonForm.jumlah || 0))}</span>
              </div>
            )}
            <Button onClick={addKasbon} className="w-full" style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>
              Simpan Kasbon
            </Button>
          </div>
        </SimpleModal>
      )}

      {modal === "pay" && (
        <SimpleModal title="Catat Bayar Customer" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="rounded-2xl bg-cyan-50 p-3 text-xs text-cyan-700">
              💙 Transfer masuk dicatat sebagai realisasi pembayaran customer per tanggal.
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
                  <div className="text-xs font-bold mb-2" style={{ color: "#f97316" }}>📋 Ringkasan tagihan supplier aktif:</div>
                  {list.map((p, i) => (<div key={p.id} className="flex justify-between gap-2 text-xs"><span style={{ color: "#64748b" }}>{i + 1}. {p.createdAt || "-"} · {purchaseMaterialsSummary(p)}</span><span className="font-semibold" style={{ color: "#e11d48" }}>sisa {rupiah(sisaPurchase(p))}</span></div>))}
                </div>
              ) : null;
            })()}
            <DatePicker label="Tanggal Bayar" value={supplierPayForm.date} onChange={(v) => setSupplierPayForm(f => ({ ...f, date: v }))} />
            <Input label="Keterangan" value={supplierPayForm.note} onChange={(v) => setSupplierPayForm(f => ({ ...f, note: v }))} placeholder="Contoh: Transfer supplier" />
            <Input label="Nominal Pembayaran" type="money" value={supplierPayForm.amount} onChange={(v) => setSupplierPayForm(f => ({ ...f, amount: v }))} />
            <Button onClick={addSupplierPayment} className="w-full" style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>🧡 Simpan Pembayaran Supplier</Button>
          </div>
        </SimpleModal>
      )}

      {/* Invoice per Customer Modal */}
      {invoiceCustomer && <InvoiceModal
        key={`${invoiceCustomer}-${invoiceStartDate}-${invoiceEndDate}-${invoiceStatusFilter}`}
        customerName={invoiceCustomer}
        orders={orders}
        shipmentBatches={shipmentBatches}
        transfers={transfers}
        returns={returns}
        getOrderPayments={orderPaymentHistory}
        getOrderTagihan={orderPaymentTarget}
        startDate={invoiceStartDate}
        endDate={invoiceEndDate}
        statusFilter={invoiceStatusFilter}
        periodLabel={invoiceStartDate || invoiceEndDate ? `${invoiceStartDate || "awal"} s/d ${invoiceEndDate || "akhir"}` : (invoiceStatusFilter === "belum" ? "Belum Lunas" : invoiceStatusFilter === "lunas" ? "Lunas" : "Semua")}
        onClose={() => setInvoiceCustomer(null)}
        productMasters={productMasters}
        overrideTotalTagihan={customerReceivableTotals(invoiceCustomer).totalTagihan}
      />}

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
                Jika nominal/nama customer diubah, realisasi pembayaran customer akan ikut diperbarui.
              </div>
              <DatePicker label="Tanggal Transfer" value={editData.date || ""} onChange={(v) => setEditData(d => ({ ...d, date: v }))} />
              <Input label="Nama Customer / Pengirim" value={editData.customer || ""} onChange={(v) => setEditData(d => ({ ...d, customer: v }))} />
              <Input label="Bank / Metode" value={editData.bank || ""} onChange={(v) => setEditData(d => ({ ...d, bank: v }))} />
              <Input label="Keterangan" value={editData.note || ""} onChange={(v) => setEditData(d => ({ ...d, note: v }))} />
              <Input label="Nominal" type="money" value={editData.amount || 0} onChange={(v) => setEditData(d => ({ ...d, amount: v }))} />
            </>}
            {editData.type === "transfersOut" && <>
              <div className="rounded-2xl bg-rose-50 p-3 text-xs text-rose-700">
                Jika nominal/nama supplier diubah, realisasi pembayaran supplier akan ikut diperbarui.
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
        const totalSebelumKirim = order ? orderPaymentTarget(order) : 0;
        const totalKirimHariIni = deliveryItemsTotal(kirimItems.map((it) => ({ qty: it.shippedQty, price: it.price })));
        const totalSetelahKirim = totalSebelumKirim + totalKirimHariIni;
        const selisihNominal = totalSetelahKirim - totalPesanan;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md max-h-[92vh] overflow-auto rounded-3xl bg-white p-6 shadow-xl">
              <div className="text-xl font-bold text-slate-800 mb-1">✏️ Koreksi Pengiriman</div>
              <div className="text-slate-500 text-sm mb-4">Gunakan ini hanya untuk mengoreksi kesalahan input dari Gallery Produksi.</div>
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
                        <span className={selisih < 0 ? "font-bold text-rose-600" : selisih > 0 ? "font-semibold text-emerald-600" : "font-semibold text-slate-500"}>{selisih < 0 ? `Kurang kirim ${Math.abs(selisih)} pcs` : selisih > 0 ? `Lebih kirim ${selisih} pcs` : "Sesuai"}</span>
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
                <div className="flex justify-between text-sm border-t pt-2"><span className="font-semibold">Status nilai kirim</span><span className={selisihNominal < 0 ? "font-bold text-rose-600" : selisihNominal > 0 ? "font-bold text-emerald-600" : "font-bold text-slate-500"}>{selisihNominal === 0 ? "Sesuai" : rupiah(selisihNominal)}</span></div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => { setKirimModal(null); setKirimItems([]); }} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
                <button onClick={tandaiDikirim} className="flex-1 rounded-2xl bg-sky-600 py-3 font-semibold text-white">Simpan</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Input Retur */}
      {returModal && (() => {
        const order = returModal;
        const orderItems = normalizeOrderItems(order);
        const selectedItem = orderItems[Number(returForm.itemIndex) || 0] || {};
        const nilaiRetur = Number(returForm.qty || 0) * moneyValue(selectedItem.price || 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md max-h-[92vh] overflow-auto rounded-3xl bg-white p-6 shadow-xl">
              <div className="text-xl font-bold text-slate-800 mb-1">↩️ Input Retur</div>
              <div className="text-slate-500 text-sm mb-4">{order.customer} · {order.invoice || "-"}</div>

              <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 mb-4 text-xs text-amber-800">
                Catatan ini hanya untuk pelacakan retur. Tagihan/invoice pesanan <strong>tidak berubah otomatis</strong> — sesuaikan tagihan secara manual kalau perlu.
              </div>

              <div className="space-y-1 mb-3">
                <label className="text-sm font-medium text-slate-700">Item yang diretur</label>
                <select
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-400 bg-white"
                  value={returForm.itemIndex}
                  onChange={(e) => setReturForm((f) => ({ ...f, itemIndex: Number(e.target.value) }))}
                >
                  {orderItems.map((it, idx) => (
                    <option key={idx} value={idx}>{it.name} · {it.qty} pcs · {rupiah(it.price)}</option>
                  ))}
                </select>
              </div>

              <Input label="Jumlah diretur (pcs)" type="number" value={returForm.qty} onChange={(v) => setReturForm((f) => ({ ...f, qty: v }))} placeholder={`Maks ${selectedItem.qty || 0} pcs`} />
              <div className="mt-3"><DatePicker label="Tanggal Retur" value={returForm.tanggal} onChange={(v) => setReturForm((f) => ({ ...f, tanggal: v }))} /></div>

              <div className="mt-3 space-y-1">
                <label className="text-sm font-medium text-slate-700">Alasan Retur</label>
                <input
                  type="text"
                  value={returForm.alasan}
                  onChange={(e) => setReturForm((f) => ({ ...f, alasan: e.target.value }))}
                  placeholder="Contoh: Salah ukuran, cacat jahitan, dll"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-400 bg-white"
                />
              </div>

              <div className="mt-3 space-y-1">
                <label className="text-sm font-medium text-slate-700">Kondisi Barang</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturForm((f) => ({ ...f, kondisi: "bisa_dijual_lagi" }))}
                    className={`rounded-2xl py-2.5 text-sm font-semibold border ${returForm.kondisi === "bisa_dijual_lagi" ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-slate-600 border-slate-200"}`}
                  >✅ Bisa Dijual Lagi</button>
                  <button
                    type="button"
                    onClick={() => setReturForm((f) => ({ ...f, kondisi: "rusak" }))}
                    className={`rounded-2xl py-2.5 text-sm font-semibold border ${returForm.kondisi === "rusak" ? "bg-rose-500 text-white border-rose-500" : "bg-white text-slate-600 border-slate-200"}`}
                  >❌ Rusak / Rugi</button>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                <label className="text-sm font-medium text-slate-700">Catatan (opsional)</label>
                <input
                  type="text"
                  value={returForm.catatan}
                  onChange={(e) => setReturForm((f) => ({ ...f, catatan: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-pink-400 bg-white"
                />
              </div>

              {nilaiRetur > 0 && (
                <div className="mt-4 rounded-2xl bg-pink-50 p-4">
                  <div className="flex justify-between text-sm"><span className="text-slate-500">Nilai retur (info saja)</span><span className="font-bold text-pink-600">{rupiah(nilaiRetur)}</span></div>
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button onClick={() => setReturModal(null)} className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600">Batal</button>
                <button onClick={simpanRetur} disabled={isSaving} className="flex-1 rounded-2xl bg-amber-500 py-3 font-semibold text-white disabled:opacity-50">Simpan Retur</button>
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

      {/* Modal Kelola Daftar Pekerja */}
      {showKelolaPekerja && (
        <SimpleModal title="👷 Daftar Pekerja Konveksi" onClose={() => { setShowKelolaPekerja(false); setNamaPekerjaInput(""); }}>
          <div className="space-y-3">
            <div className="rounded-2xl p-3 text-xs font-semibold" style={{ background: "#eef2ff", border: "1px solid #c7d2fe", color: "#3730a3" }}>
              💡 Nama pekerja di sini akan muncul sebagai pilihan saat input kasbon. Bisa langsung ketik nama baru di field kasbon jika tidak ada di daftar.
            </div>
            {/* Form tambah pekerja baru */}
            <div className="flex gap-2">
              <input
                value={namaPekerjaInput}
                onChange={(e) => setNamaPekerjaInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && tambahMasterPekerja(namaPekerjaInput)}
                placeholder="Nama pekerja baru..."
                className="flex-1 px-4 py-3 outline-none text-sm rounded-2xl"
                style={{ border: "1.5px solid #c7d2fe", background: "#eef2ff", color: "#2d1b69" }}
              />
              <button
                onClick={() => tambahMasterPekerja(namaPekerjaInput)}
                disabled={isSaving}
                className="px-4 py-3 rounded-2xl font-bold text-white text-sm"
                style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}
              >+ Tambah</button>
            </div>
            {/* Daftar pekerja */}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {masterPekerja.length === 0 && (
                <div className="text-center text-slate-400 py-6 text-sm">Belum ada pekerja. Tambahkan di atas.</div>
              )}
              {[...masterPekerja].sort((a, b) => (a.nama || "").localeCompare(b.nama || "")).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0" }}>
                  <span className="font-semibold text-slate-700 text-sm">👤 {p.nama}</span>
                  <button
                    onClick={() => hapusMasterPekerja(p.id, p.nama)}
                    className="text-rose-500 font-bold text-xs px-3 py-1 rounded-xl"
                    style={{ background: "#fff1f2", border: "1px solid #fecdd3" }}
                  >Hapus</button>
                </div>
              ))}
            </div>
          </div>
        </SimpleModal>
      )}

      {/* Modal Repair Data Produk */}
      {repairModal && (() => {
        const issues = repairIssues[repairModal.productId] || [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg max-h-[92vh] overflow-auto rounded-3xl bg-white p-6 shadow-xl">
              <div className="text-xl font-bold text-orange-700 mb-1">🔧 Repair Data: {repairModal.productName}</div>
              <div className="text-slate-500 text-xs mb-4">
                Nama dikoreksi otomatis ke master. Harga delivery disamakan dengan harga saat pesanan dibuat.
              </div>

              {issues.length === 0 && (
                <div className="text-center py-8 text-emerald-600 font-bold">✅ Tidak ada data bermasalah.</div>
              )}

              <div className="space-y-3">
                {issues.map((issue, idx) => (
                  <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#fff7ed", border: "1.5px solid #fed7aa" }}>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span className="font-bold text-slate-700">{issue.customer}</span>
                      <span>{issue.date}</span>
                    </div>
                    <div className="text-xs space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-rose-500 line-through">{issue.oldName}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-emerald-600 font-bold">{issue.newName}</span>
                      </div>
                      {issue.source === "delivery" && issue.orderItemPrice > 0 && issue.orderItemPrice !== issue.oldPrice ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Harga:</span>
                          <span className="text-rose-500 line-through">{rupiah(issue.oldPrice)}</span>
                          <span className="text-slate-400">→</span>
                          <span className="font-semibold text-emerald-600">{rupiah(issue.orderItemPrice)}</span>
                          <span className="text-slate-400 text-[10px]">(dari pesanan)</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Harga tetap:</span>
                          <span className="font-semibold text-slate-700">{rupiah(issue.oldPrice)}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      Qty: {issue.shippedQty} pcs · Sumber: {issue.source === "delivery" ? "data pengiriman" : "data pesanan"}
                    </div>
                  </div>
                ))}
              </div>

              {issues.length > 0 && (
                <div className="mt-4 rounded-2xl bg-orange-50 p-3 text-xs text-orange-700 space-y-1">
                  <div className="font-bold">⚠️ Perhatian:</div>
                  <div>• Nama dikoreksi otomatis ke master</div>
                  <div>• Harga delivery disamakan dengan harga pesanan awal</div>
                  <div>• Aksi ini tidak bisa dibatalkan</div>
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => { setRepairModal(null); setRepairPriceEdits({}); }}
                  className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600"
                >Batal</button>
                {issues.length > 0 && (
                  <button
                    onClick={() => runRepairForProduct(repairModal.productId)}
                    className="flex-1 rounded-2xl py-3 font-semibold text-white"
                    style={{ background: "linear-gradient(135deg,#ea580c,#f97316)" }}
                  >🔧 Perbaiki {issues.length} Data</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Repair Qty Pengiriman */}
      {repairQtyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg max-h-[92vh] overflow-auto rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-indigo-700 mb-1">🔧 Repair Qty Pengiriman</div>
            <div className="text-slate-500 text-xs mb-4">
              Ditemukan {repairQtyIssues.length} pengiriman dengan qty tidak sesuai data Gallery Produksi. Klik Perbaiki untuk mengoreksi otomatis.
            </div>

            {repairQtyIssues.length === 0 && (
              <div className="text-center py-8 text-emerald-600 font-bold">✅ Semua qty pengiriman sudah benar.</div>
            )}

            <div className="space-y-3">
              {repairQtyIssues.map((issue, idx) => (
                <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#eef2ff", border: "1.5px solid #c7d2fe" }}>
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-slate-800">{issue.customer}</span>
                    <span className="text-slate-500">{issue.date}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="font-bold text-rose-600 mb-1">Data lama (salah)</div>
                      {issue.currentItems.map((it, i) => (
                        <div key={i} className="text-slate-600">{it.name}: <span className="font-bold text-rose-500">{it.qty} pcs</span></div>
                      ))}
                    </div>
                    <div>
                      <div className="font-bold text-emerald-600 mb-1">Koreksi (dari GP)</div>
                      {issue.correctItems.map((it, i) => (
                        <div key={i} className="text-slate-600">{it.name}: <span className="font-bold text-emerald-600">{it.qty} pcs</span></div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {repairQtyIssues.length > 0 && (
              <div className="mt-4 rounded-2xl bg-indigo-50 p-3 text-xs text-indigo-700">
                <div className="font-bold mb-1">⚠️ Perhatian:</div>
                <div>• Qty delivery akan dikoreksi sesuai data Gallery Produksi</div>
                <div>• Aksi ini tidak bisa dibatalkan</div>
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setRepairQtyModal(false); setRepairQtyIssues([]); }}
                className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600"
              >Batal</button>
              {repairQtyIssues.length > 0 && (
                <button
                  onClick={runRepairQtyPengiriman}
                  className="flex-1 rounded-2xl py-3 font-semibold text-white"
                  style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}
                >🔧 Perbaiki {repairQtyIssues.length} Delivery</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Pengiriman */}
      {editDeliveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md max-h-[92vh] overflow-auto rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-xl font-bold text-blue-700 mb-1">✏️ Edit Pengiriman</div>
            <div className="text-slate-500 text-xs mb-4">
              {editDeliveryModal.order?.customer} · {(editDeliveryModal.order?.raw?.deliveries || editDeliveryModal.order?.deliveries || [])[editDeliveryModal.deliveryIdx]?.date || "-"}
            </div>
            <div className="mb-4">
              <DatePicker label="Tanggal Kirim" value={editDeliveryDate} onChange={(v) => setEditDeliveryDate(v)} />
            </div>
            <div className="space-y-3">
              {editDeliveryItems.map((it, idx) => (
                <div key={idx} className="rounded-2xl p-3 space-y-2" style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe" }}>
                  <div className="text-sm font-bold text-slate-800">{it.name || "Produk"}</div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-blue-700">Qty (pcs)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={it.qty || ""}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value) || 0);
                        setEditDeliveryItems(prev => prev.map((x, i) => i === idx ? { ...x, qty: val } : x));
                      }}
                      className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                      style={{ border: "1.5px solid #bfdbfe", background: "#fff" }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-blue-50 p-3 text-xs text-blue-700">
              ⚠️ Perubahan ini akan langsung tersimpan ke Firestore dan mempengaruhi invoice customer.
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setEditDeliveryModal(null); setEditDeliveryItems([]); setEditDeliveryDate(""); }}
                className="flex-1 rounded-2xl border border-slate-200 py-3 font-semibold text-slate-600"
              >Batal</button>
              <button
                onClick={saveEditDelivery}
                className="flex-1 rounded-2xl py-3 font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}
              >✅ Simpan Koreksi</button>
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
