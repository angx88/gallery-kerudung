import React from "react";
import SimpleModal from "./SimpleModal";
import Button from "./Button";
import {
  rupiah, moneyValue, dateSerial, normalizeName, firstPositiveMoney, resolveSalePrice,
  shipmentAutoNote, invoiceDateKeyFromValue, getOrderInvoiceBatches, isDateKeyInRange,
  orderItemForDeliveryItem, normalizeShipmentItems, shipmentItemsTotal, deliveryItemsTotal,
  orderShippingCost, orderExtraCharge, orderExtraChargeLabel, orderExtraChargeDateKey, loadPdfTools,
} from "../utils";

export default function InvoiceModal({ customerName, orders, shipmentBatches = [], transfers = [], returns = [], onClose, getOrderPayments = (order) => order?.payments || [], getOrderTagihan = null, startDate = "", endDate = "", periodLabel = "", statusFilter = "semua", overrideTotalTagihan = null, productMasters = [] }) {
  const canvasRef = React.useRef(null);
  const [imgUrl, setImgUrl] = React.useState(null);
  const [invoiceAction, setInvoiceAction] = React.useState(null);

  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  // Lookup harga dari master produk sebagai fallback terakhir jika harga di item/order = 0
  const lookupMasterPrice = (name) => {
    if (!name || !productMasters.length) return 0;
    const norm = normalizeName(name);
    const found = productMasters.find((p) => normalizeName(p.name) === norm);
    return moneyValue(found?.defaultPrice ?? found?.price ?? found?.hargaJual ?? found?.sellingPrice ?? found?.salePrice ?? found?.hargaPcs ?? found?.unitPrice ?? 0);
  };

  // Hitung total invoice dari qty TERKIRIM × harga satuan + ongkir.
  // Bukan dari qty pesanan — karena selisih kirim tidak ditagihkan.
  const invoiceOrderTotal = (order) => {
    // Satu sumber nilai tagihan: kalau parent menyediakan kalkulator resmi,
    // pakai itu agar total invoice, kartu customer, FIFO pembayaran, dan sisa tagihan selalu sinkron.
    const official = typeof getOrderTagihan === "function" ? moneyValue(getOrderTagihan(order) || 0) : 0;
    if (official > 0) return official;
    return shipmentItemsTotal(normalizeShipmentItems(order, productMasters), lookupMasterPrice) + orderShippingCost(order) + orderExtraCharge(order);
  };
  const invoiceOrderPaid = (order) => getOrderPayments(order).reduce((a, p) => a + Number(moneyValue(p.amount || 0) || 0), 0);
  const invoiceOrderSisa = (order) => Math.max(invoiceOrderTotal(order) - invoiceOrderPaid(order), 0);
  const allCustomerOrders = orders
    .filter((o) => normalizeName(o.customer) === normalizeName(customerName));

  const orderById = new Map(allCustomerOrders.map((o) => [String(o.id || "").trim(), o]));
  const orderByInvoice = new Map(allCustomerOrders.map((o) => [String(o.invoice || "").trim(), o]));
  const customerOrderKeys = new Set([
    ...allCustomerOrders.map((o) => String(o.id || "").trim()).filter(Boolean),
    ...allCustomerOrders.map((o) => String(o.invoice || "").trim()).filter(Boolean),
  ]);

  // Retur milik customer ini saja — dicocokkan lewat orderId/invoice pesanan.
  // Hanya untuk ditampilkan sebagai info di invoice, tidak pernah mengubah nominal tagihan.
  const customerReturns = (returns || []).filter((r) => {
    const rOrderKey = String(r.orderId || "").trim();
    const rInvoiceKey = String(r.invoice || "").trim();
    return (rOrderKey && customerOrderKeys.has(rOrderKey)) || (rInvoiceKey && customerOrderKeys.has(rInvoiceKey));
  });

  const officialShipmentBatches = (shipmentBatches || [])
    .filter((batch) => {
      const batchCustomer = normalizeName(batch.customerName || batch.customer || batch.receiver || batch.penerima || "");
      if (batchCustomer && batchCustomer === normalizeName(customerName)) return true;
      const ids = [
        ...(Array.isArray(batch.orderIds) ? batch.orderIds : []),
        ...(Array.isArray(batch.pesananIds) ? batch.pesananIds : []),
        ...(Array.isArray(batch.invoices) ? batch.invoices : []),
      ].map((x) => String(x || "").trim()).filter(Boolean);
      return ids.some((id) => customerOrderKeys.has(id));
    })
    .flatMap((batch) => {
      const dateKey = invoiceDateKeyFromValue(batch.tanggalKirim || batch.date || batch.shippedAt || batch.deliveredAt || batch.createdAt || "");
      const batchGroupId = batch.groupId || batch.noteNumber || batch.id || "";
      const batchItems = Array.isArray(batch.items) ? batch.items : [];
      const batchOrders = Array.isArray(batch.orders) && batch.orders.length > 0
        ? batch.orders
        : [{
            orderId: batch.orderId || batch.pesananId || (Array.isArray(batch.orderIds) ? batch.orderIds[0] : ""),
            invoice: batch.invoice || (Array.isArray(batch.invoices) ? batch.invoices[0] : ""),
            customer: batch.customerName || batch.customer || customerName,
            items: batchItems,
          }];

      return batchOrders.map((row, idx) => {
        const rowOrderId = String(row.orderId || row.pesananId || "").trim();
        const rowInvoice = String(row.invoice || "").trim();
        const order = orderById.get(rowOrderId) || orderByInvoice.get(rowInvoice) || {
          id: rowOrderId || `${batch.id || batchGroupId}-${idx}`,
          invoice: rowInvoice || batch.noteNumber || batchGroupId,
          customer: row.customer || batch.customerName || batch.customer || customerName,
          items: [],
          payments: [],
        };
        const rawItems = Array.isArray(row.items) && row.items.length > 0
          ? row.items
          : batchItems.filter((it) => {
              const itOrderId = String(it.orderId || it.pesananId || "").trim();
              const itInvoice = String(it.invoice || "").trim();
              return (rowOrderId && itOrderId === rowOrderId) || (rowInvoice && itInvoice === rowInvoice);
            });
        const items = rawItems.map((it, iIdx) => {
          const shippedQty = Number(it.shippedQty ?? it.qtyKirim ?? it.qty ?? 0);
          const base = orderItemForDeliveryItem(order, it, iIdx) || {};
          const orderedQty = Number(it.orderedQty ?? it.qtyPesan ?? base.qty ?? 0);
          return {
            name: base.name || it.name || it.nama || it.productName || "Produk",
            originalName: it.name || it.nama || it.productName || "",
            productId: base.productId || it.productId || it.product_id || it.masterProductId || "",
            itemIndex: Number(it.itemIndex ?? iIdx),
            orderedQty,
            shippedQty,
            price: (() => {
              const basePrice = firstPositiveMoney(
                base?.price, base?.harga, base?.hargaJual, base?.hargaPcs,
                base?.sellingPrice, base?.salePrice, base?.unitPrice, base?.hargaSatuan
              );
              return basePrice > 0 ? basePrice : (resolveSalePrice(it, base, order, productMasters) || lookupMasterPrice(base.name || it.name || it.nama || ""));
            })(),
            bahanCost: moneyValue(it.bahanCost ?? base.bahanCost ?? 0),
            hppPerPcs: moneyValue(it.hppPerPcs ?? it.hpp ?? base.hppPerPcs ?? 0),
            mainMaterial: it.mainMaterial || base.mainMaterial || "",
            materialQtyPerPcs: Number(it.materialQtyPerPcs ?? base.materialQtyPerPcs ?? 0),
            unit: it.unit || base.unit || "yard",
            note: it.note || it.keterangan || shipmentAutoNote(orderedQty, shippedQty),
          };
        }).filter((it) => Number(it.shippedQty || 0) > 0);

        return {
          id: `official-${batch.id || batchGroupId}-${order.id || order.invoice || idx}`,
          order,
          delivery: { ...batch, groupId: batchGroupId },
          officialBatch: true,
          groupId: batchGroupId,
          index: idx,
          dateKey,
          items,
          // Prioritaskan ongkir dari shipment_batches (dikirim dari gallery-produksi),
          // fallback ke order.shippingCost (diisi saat buat pesanan di gallery-kerudung).
          // Jika batch punya beberapa order, ongkir sudah include di batch level — jangan dobel.
          // Ongkir hanya dari batch langsung — JANGAN fallback ke orderShippingCost.
          // orderShippingCost(order) adalah ongkir order keseluruhan, bukan per batch,
          // sehingga akan dikali jumlah batch dan menyebabkan Grand Total > Total Tagihan.
          total: deliveryItemsTotal(items, lookupMasterPrice) + (batchOrders.length <= 1 ? moneyValue(batch.ongkir ?? batch.shippingCost ?? 0) : 0),
        };
      });
    })
    .filter((batch) => batch.items.length > 0 || Number(batch.total || 0) > 0);

  const officialKeys = new Set(officialShipmentBatches.map((batch) => {
    const orderKey = batch.order?.id || batch.order?.invoice || batch.id;
    const groupKey = batch.groupId || batch.delivery?.groupId || batch.delivery?.noteNumber || "";
    return `${orderKey}|${groupKey}|${batch.dateKey || ""}`;
  }));

  // Set order yang sudah punya official batch dari Gallery Produksi (apapun tanggalnya).
  // Delivery lama dari order ini tidak perlu ditampilkan karena sudah digantikan official batch.
  const ordersWithOfficialBatch = new Set(
    officialShipmentBatches.map((batch) => batch.order?.id || batch.order?.invoice || "").filter(Boolean)
  );

  const deliveryInvoiceBatches = allCustomerOrders.flatMap((order) =>
    getOrderInvoiceBatches(order, productMasters, lookupMasterPrice)
      .map((batch) => ({ ...batch, order }))
      .filter((batch) => {
        const groupKey = batch.delivery?.groupId || batch.delivery?.noteNumber || "";
        const orderKey = order.id || order.invoice || batch.id;
        const dateKey = batch.dateKey || "";

        if (!groupKey) {
          // Delivery lama (tanpa groupId): skip jika order sudah punya official batch
          // dari Gallery Produksi, apapun tanggalnya. Ini mencegah delivery lama tampil
          // dengan tanggal salah (tanggal pesanan) saat official batch sudah ada.
          if (ordersWithOfficialBatch.has(order.id) || ordersWithOfficialBatch.has(order.invoice)) return false;
          const coveredByOfficial = Array.from(officialKeys).some(
            (k) => k.startsWith(`${orderKey}|`) && k.endsWith(`|${dateKey}`)
          );
          return !coveredByOfficial;
        }
        return !officialKeys.has(`${orderKey}|${groupKey}|${dateKey}`);
      })
  );

  // Perbaikan kecil khusus invoice: ongkir hanya masuk di invoice, tanpa mengubah
  // Dashboard/Rekap/Piutang. Aturan bisnis: ongkir diambil dari salah satu sumber.
  // Jika App Kerudung mengisi ongkir order, pakai itu sebagai koreksi/manual.
  // Jika kosong, pakai ongkir dari App Produksi/batch. Jangan dijumlahkan.
  const rawInvoiceBatches = [...officialShipmentBatches, ...deliveryInvoiceBatches];
  const usedOrderOngkirKeys = new Set();
  const usedGroupOngkirKeys = new Set(); // Ongkir GP hanya 1x per groupId
  const usedOrderExtraChargeKeys = new Set(); // Biaya tambahan hanya 1x per pesanan
  const sortedRawInvoiceBatches = rawInvoiceBatches
    .slice()
    .sort((a, b) => `${a.dateKey || "9999-99-99"}-${a.order?.invoice || a.order?.id || ""}`.localeCompare(`${b.dateKey || "9999-99-99"}-${b.order?.invoice || b.order?.id || ""}`));
  // Biaya tambahan (packing/label dll) ditagihkan di pengiriman TERAKHIR pesanan itu saja,
  // bukan di pengiriman pertama — sesuai kesepakatan bisnis. Karena sortedRawInvoiceBatches
  // sudah urut menaik per tanggal, iterasi biasa dan overwrite per orderKey otomatis
  // menyisakan dateKey pengiriman paling akhir untuk tiap pesanan.
  const lastDateKeyByOrder = new Map();
  sortedRawInvoiceBatches.forEach((batch) => {
    const orderKey = String(batch.order?.id || batch.order?.invoice || batch.id || "").trim();
    if (orderKey) lastDateKeyByOrder.set(orderKey, batch.dateKey || "");
  });
  const allInvoiceBatches = sortedRawInvoiceBatches
    .map((batch) => {
      const orderKey = String(batch.order?.id || batch.order?.invoice || batch.id || "").trim();
      const groupKey = String(batch.delivery?.groupId || batch.groupId || batch.delivery?.noteNumber || "").trim();
      const barangDariItem = deliveryItemsTotal(batch.items || [], lookupMasterPrice);
      const ongkirProduksi = moneyValue(batch.delivery?.ongkir ?? batch.delivery?.shippingCost ?? batch.ongkir ?? batch.shippingCost ?? 0);
      const ongkirKerudung = moneyValue(batch.order?.shippingCost ?? batch.order?.ongkir ?? 0);
      const rawTotal = moneyValue(batch.total || 0);
      const rawTotalSudahTermasukOngkirProduksi = ongkirProduksi > 0 && Math.abs(rawTotal - (barangDariItem + ongkirProduksi)) <= 1;
      const barangTotal = rawTotalSudahTermasukOngkirProduksi ? Math.max(0, rawTotal - ongkirProduksi) : (barangDariItem > 0 ? barangDariItem : rawTotal);

      let invoiceOngkir = 0;
      // Sumber kebenaran ongkir: Gallery Produksi (shipment_batches.ongkir).
      // Pengelolaan pengiriman ada di GP, GK hanya membaca. Satu paket fisik = satu ongkir,
      // meski 1 nota gabungan berisi beberapa pesanan dengan groupId sama, secara fisik
      // kurir hanya dibayar sekali. GP bisa mencatat ongkir per pesanan untuk groupId yang
      // sama (mis. dibagi rata), tapi yang masuk tagihan customer cuma 1x per groupId.
      if (ongkirProduksi > 0) {
        const gpKey = groupKey || orderKey;
        if (gpKey && !usedGroupOngkirKeys.has(gpKey)) {
          invoiceOngkir = ongkirProduksi;
          usedGroupOngkirKeys.add(gpKey);
        }
      }
      // Fallback: pesanan lama yang dibuat sebelum integrasi GP — ongkir hanya tercatat
      // di order.shippingCost (GK). Hanya dipakai kalau GP tidak punya data ongkir.
      else if (ongkirKerudung > 0 && orderKey && !usedOrderOngkirKeys.has(orderKey)) {
        invoiceOngkir = ongkirKerudung;
        usedOrderOngkirKeys.add(orderKey);
      }

      // Biaya tambahan — order-level (Gallery Kerudung). Kalau admin memilih pengiriman
      // tertentu (extraChargeDateKey terisi lewat dropdown di form Edit Pesanan), tempel ke
      // situ. Kalau kosong (default), tempel ke pengiriman TERAKHIR pesanan ini — supaya
      // tidak dobel dan tetap ada perilaku default yang masuk akal kalau tidak dipilih manual.
      let invoiceExtraCharge = 0;
      let invoiceExtraChargeLabel = "";
      const extraChargeAmount = orderExtraCharge(batch.order);
      const extraChargeTargetDateKey = orderExtraChargeDateKey(batch.order) || (lastDateKeyByOrder.get(orderKey) || "");
      if (extraChargeAmount > 0 && orderKey && !usedOrderExtraChargeKeys.has(orderKey) && (batch.dateKey || "") === extraChargeTargetDateKey) {
        invoiceExtraCharge = extraChargeAmount;
        invoiceExtraChargeLabel = orderExtraChargeLabel(batch.order) || "Biaya Tambahan";
        usedOrderExtraChargeKeys.add(orderKey);
      }

      return {
        ...batch,
        invoiceOngkir,
        invoiceExtraCharge,
        invoiceExtraChargeLabel,
        barangTotal,
        total: Math.round(barangTotal + invoiceOngkir + invoiceExtraCharge),
      };
    });

  const orderDeliveredTotalMap = allInvoiceBatches.reduce((map, batch) => {
    const key = batch.order?.id || batch.order?.invoice || batch.id;
    if (!key) return map;
    map.set(key, (map.get(key) || 0) + Number(batch.total || 0));
    return map;
  }, new Map());

  const orderInvoiceKey = (order, fallback = "") => String(order?.id || order?.invoice || fallback || "").trim();
  const getOrderFullDeliveredTotal = (order, fallback = "") => {
    const key = orderInvoiceKey(order, fallback);
    // Tagihan = total terkirim saja. Jika belum ada delivery, fallback ke invoiceOrderTotal.
    // Tidak pakai Math.max karena total pesanan bisa lebih besar dari terkirim
    // dan akan menyebabkan over-report tagihan.
    return orderDeliveredTotalMap.get(key) || invoiceOrderTotal(order);
  };
  const getOrderSisaBelumTerbayar = (order, fallback = "") => {
    const totalKirimOrder = getOrderFullDeliveredTotal(order, fallback);
    return Math.max(totalKirimOrder - invoiceOrderPaid(order), 0);
  };

  const batchAllocationDirectTransferRows = (transfers || [])
    .filter((pay) => normalizeName(pay.customer) === normalizeName(customerName) && moneyValue(pay.amount || 0) > 0)
    .map((pay) => ({
      date: pay.date || pay.createdAt?.slice?.(0, 10) || "",
      createdAt: pay.createdAt || "",
      rowNo: pay.id || "",
      note: pay.bank || pay.note || "Pembayaran customer",
      amount: moneyValue(pay.amount || 0),
    }));

  const batchAllocationFallbackPaymentRows = allCustomerOrders
    .flatMap((order) => getOrderPayments(order).map((pay) => ({
      date: pay.date || "",
      createdAt: pay.createdAt || "",
      rowNo: pay.id || pay.transferId || "",
      note: pay.note || pay.transferNote || "Pembayaran customer",
      amount: moneyValue(pay.transferAmount || pay.amount || 0),
      transferId: pay.transferId || "",
    })))
    .filter((row) => Number(row.amount || 0) > 0)
    .reduce((map, row) => {
      const key = row.transferId || `${row.date}__${row.note}__${row.amount}`;
      if (!map.has(key)) map.set(key, row);
      return map;
    }, new Map());

  const batchAllocationRawPaymentRows = batchAllocationDirectTransferRows.length > 0
    ? batchAllocationDirectTransferRows
    : Array.from(batchAllocationFallbackPaymentRows.values());

  // FINAL RULE 2026-06-09:
  // Tagihan invoice harus sesuai pengiriman, bukan sesuai total pesanan/order.
  // Karena pembayaran customer tidak menempel ke batch kirim tertentu, alokasi sisa invoice
  // dibuat FIFO terhadap batch pengiriman: pembayaran melunasi pengiriman paling lama dulu.
  // Dengan begitu filter tanggal dan filter Belum Lunas hanya menghitung sisa dari barang
  // yang benar-benar sudah dikirim pada tanggal/batch yang tampil.
  const sortedAllInvoiceBatchesForPayment = [...allInvoiceBatches]
    .filter((batch) => Number(batch.total || 0) > 0)
    .sort((a, b) => {
      const dateDiff = dateSerial(a.dateKey || "") - dateSerial(b.dateKey || "");
      if (dateDiff !== 0) return dateDiff;
      const invDiff = String(a.order?.invoice || a.order?.id || "").localeCompare(String(b.order?.invoice || b.order?.id || ""));
      if (invDiff !== 0) return invDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    })
    .map((batch) => ({ ...batch, remainingForPayment: Math.max(0, Math.round(Number(batch.total || 0))) }));

  const invoiceBatchPaymentMap = new Map();
  const paymentRowsForBatchAllocation = [...batchAllocationRawPaymentRows]
    .filter((row) => moneyValue(row.amount || 0) > 0)
    .sort((a, b) => {
      const dateDiff = dateSerial(a.date || "") - dateSerial(b.date || "");
      if (dateDiff !== 0) return dateDiff;
      return String(a.createdAt || a.rowNo || "").localeCompare(String(b.createdAt || b.rowNo || ""));
    });

  let batchPaymentIndex = 0;
  paymentRowsForBatchAllocation.forEach((payment) => {
    let paymentLeft = moneyValue(payment.amount || 0);
    while (paymentLeft > 0 && batchPaymentIndex < sortedAllInvoiceBatchesForPayment.length) {
      const batch = sortedAllInvoiceBatchesForPayment[batchPaymentIndex];
      if (batch.remainingForPayment <= 0) {
        batchPaymentIndex += 1;
        continue;
      }
      const paid = Math.min(paymentLeft, batch.remainingForPayment);
      if (paid > 0) {
        invoiceBatchPaymentMap.set(batch.id, (invoiceBatchPaymentMap.get(batch.id) || 0) + paid);
        batch.remainingForPayment = Math.max(0, batch.remainingForPayment - paid);
        paymentLeft = Math.max(0, paymentLeft - paid);
      }
      if (batch.remainingForPayment <= 0) batchPaymentIndex += 1;
    }
  });

  const getInvoiceBatchPaid = (batch) => Math.round(invoiceBatchPaymentMap.get(batch.id) || 0);
  const getInvoiceBatchSisa = (batch) => Math.max(Math.round(Number(batch.total || 0)) - getInvoiceBatchPaid(batch), 0);

  const representedOrderIds = new Set();
  const invoiceBatches = allInvoiceBatches
    .filter((batch) => isDateKeyInRange(batch.dateKey, startDate, endDate))
    .sort((a, b) => `${a.dateKey || "9999-99-99"}-${a.order?.invoice || ""}`.localeCompare(`${b.dateKey || "9999-99-99"}-${b.order?.invoice || ""}`))
    .filter((batch) => {
      representedOrderIds.add(batch.order?.id || batch.order?.invoice || batch.id);
      const batchSisa = getInvoiceBatchSisa(batch);
      if (statusFilter === "belum") return batchSisa > 0;
      if (statusFilter === "lunas") return batchSisa <= 0;
      return true;
    });

  const customerOrders = Array.from(new Map(invoiceBatches.map((batch) => [batch.order?.id || batch.order?.invoice || batch.id, batch.order])).values());

  const invoiceGroups = Object.values(invoiceBatches.reduce((map, batch) => {
    const key = batch.dateKey || "tanpa-tanggal";
    if (!map[key]) map[key] = { dateKey: key, batches: [], total: 0 };
    map[key].batches.push(batch);
    map[key].total += Number(batch.total || 0);
    return map;
  }, {})).sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));

  // Retur yang SUDAH diproses admin (tombol "Kurangi Tagihan Sekarang" di tab Retur)
  // mengoreksi total tagihan pesanan yang tampil di invoice ini. Hanya dihitung untuk
  // pesanan yang benar-benar direpresentasikan di invoice ini (representedOrderIds),
  // supaya tidak memotong tagihan pesanan lain milik customer yang sama tapi di luar invoice ini.
  const totalTagihanReturAdjustment = customerReturns
    .filter((r) => r.tagihanDikurangi)
    .filter((r) => {
      const rOrderKey = String(r.orderId || "").trim();
      const rInvoiceKey = String(r.invoice || "").trim();
      return (rOrderKey && representedOrderIds.has(rOrderKey)) || (rInvoiceKey && representedOrderIds.has(rInvoiceKey));
    })
    .reduce((sum, r) => sum + Number(r.tagihanDikurangiNominal || 0), 0);

  const totalTagihan = Math.max(0, invoiceBatches.reduce((s, batch) => s + Number(batch.total || 0), 0) - totalTagihanReturAdjustment);

  const customerTagihanRows = allCustomerOrders
    .map((order) => ({
      order,
      date: order?.date || order?.createdAt || order?.tanggal || "",
      invoice: order?.invoice || order?.id || "-",
      // Tagihan dari total terkirim saja, bukan Math.max dengan total pesanan
      tagihan: orderDeliveredTotalMap.get(order?.id || order?.invoice || "") || invoiceOrderTotal(order),
    }))
    .filter((row) => Number(row.tagihan || 0) > 0)
    .sort((a, b) => `${a.date || "9999-99-99"}-${a.invoice}`.localeCompare(`${b.date || "9999-99-99"}-${b.invoice}`));

  const directTransferRows = (transfers || [])
    .filter((pay) => normalizeName(pay.customer) === normalizeName(customerName) && moneyValue(pay.amount || 0) > 0)
    .map((pay) => ({
      date: pay.date || pay.createdAt?.slice?.(0, 10) || "",
      note: pay.bank || pay.note || "Pembayaran customer",
      amount: moneyValue(pay.amount || 0),
    }));

  const fallbackPaymentRows = allCustomerOrders
    .flatMap((order) => getOrderPayments(order).map((pay) => ({
      date: pay.date || "",
      note: pay.note || pay.transferNote || "Pembayaran customer",
      amount: moneyValue(pay.transferAmount || pay.amount || 0),
      transferId: pay.transferId || "",
    })))
    .filter((row) => Number(row.amount || 0) > 0)
    .reduce((map, row) => {
      const key = row.transferId || `${row.date}__${row.note}__${row.amount}`;
      if (!map.has(key)) map.set(key, row);
      return map;
    }, new Map());

  const rawPaymentRows = directTransferRows.length > 0 ? directTransferRows : Array.from(fallbackPaymentRows.values());
  const paymentDetailRows = rawPaymentRows
    .map((row, idx) => ({
      ...row,
      rowNo: idx + 1,
      date: row.date || "tanpa-tanggal",
      amount: moneyValue(row.amount || 0),
    }))
    .sort((a, b) => `${a.date || "9999-99-99"}-${String(a.rowNo).padStart(4, "0")}`.localeCompare(`${b.date || "9999-99-99"}-${String(b.rowNo).padStart(4, "0")}`));
  const latestPaymentRows = paymentDetailRows.slice(-3).reverse();
  const latestPayment = latestPaymentRows[0] || null;

  // totalTagihan selalu dari canvas (Grand Total) — include semua ongkir.
  // overrideTotalTagihan dari App dipakai hanya sebagai fallback jika canvas belum ada data.
  const fallbackTagihanCustomer = overrideTotalTagihan !== null
    ? moneyValue(overrideTotalTagihan || 0)
    : allCustomerOrders.reduce((s, o) => s + Math.max(0, invoiceOrderTotal(o)), 0);
  const totalTagihanCustomerKeseluruhan = totalTagihan > 0
    ? Math.round(totalTagihan)
    : Math.round(fallbackTagihanCustomer);
  // totalBayar harus sescope dengan totalTagihan agar Status Lunas/Belum Lunas tidak
  // membandingkan dua angka beda periode (tagihan periode ini vs bayar sepanjang masa).
  // - Tanpa filter tanggal/status: pakai total transfer aktual (perilaku lama, tidak berubah).
  // - Dengan filter tanggal/status aktif: pakai FIFO per-batch (getInvoiceBatchPaid, sudah
  //   dihitung dari SEMUA pembayaran customer secara global di invoiceBatchPaymentMap) tapi
  //   hanya dijumlah untuk batch yang lolos filter periode ini — sehingga "Sudah Dibayar"
  //   yang tampil benar-benar porsi pembayaran yang sudah teralokasi FIFO ke periode tersebut,
  //   bukan total transfer customer secara keseluruhan yang scope-nya beda dengan totalTagihan.
  const hasScopedInvoiceFilter = Boolean(startDate || endDate) || statusFilter === "belum";
  const totalBayarCustomerKeseluruhan = hasScopedInvoiceFilter
    ? Math.round(invoiceBatches.reduce((s, batch) => s + getInvoiceBatchPaid(batch), 0))
    : Math.round(rawPaymentRows.reduce((s, row) => s + Number(row.amount || 0), 0));
  // Sisa = Grand Total canvas - totalBayar (sescope filter di atas)
  const totalSisaCustomerKeseluruhan = Math.max(totalTagihanCustomerKeseluruhan - totalBayarCustomerKeseluruhan, 0);
  const visibleSisaBelumTerbayar = invoiceBatches.reduce((sum, batch) => sum + getInvoiceBatchSisa(batch), 0);
  const totalBayar = totalBayarCustomerKeseluruhan;
  const totalSisa = totalSisaCustomerKeseluruhan;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setImgUrl(null);

    const formatTgl = (str) => {
      if (!str) return "-";
      const dp = String(str).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dp)) return dp || "-";
      const d = new Date(dp + "T00:00:00");
      if (isNaN(d.getTime())) return dp;
      return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    };
    const trunc = (s, n = 32) => {
      const t = String(s || "");
      return t.length > n ? t.slice(0, n - 1) + "\u2026" : t;
    };

    // Satu invoice = satu customer + satu tanggal kirim.
    // Semua pesanan customer pada tanggal yang sama digabung, tanpa label Pesanan #1/#2.
    // Jika produk yang sama dikirim dari beberapa order pada hari yang sama, qty dan nominalnya dijumlahkan.
    const groupsByDate = new Map();
    invoiceGroups.forEach((group) => {
      const dateKey = group.dateKey || "tanpa-tanggal";
      const label = formatTgl(dateKey);
      if (!groupsByDate.has(dateKey)) {
        groupsByDate.set(dateKey, { dateKey, label, itemMap: new Map(), total: 0, qty: 0, paid: 0, orderKeys: new Set() });
      }
      const target = groupsByDate.get(dateKey);
      group.batches.forEach((batch) => {
        // Catat pesanan (id/invoice) yang tampil di tanggal kirim ini, dipakai untuk
        // mencocokkan baris retur agar muncul di bawah pesanan yang relevan.
        const orderKeyForReturn = String(batch.order?.id || batch.order?.invoice || batch.id || "").trim();
        if (orderKeyForReturn) target.orderKeys.add(orderKeyForReturn);
        // Akumulasi pembayaran FIFO yang sudah teralokasi ke batch ini (per tanggal kirim).
        // Dipakai untuk menampilkan "Sudah dibayar" + "Sisa Pengiriman" per tanggal di filter Belum Lunas.
        target.paid += Number(getInvoiceBatchPaid(batch) || 0);
        // Ongkir invoice sudah dihitung satu sumber di batch.invoiceOngkir.
        // Tampilkan sebagai satu baris "Ongkir" saja.
        const batchOngkir = moneyValue(batch.invoiceOngkir || 0);
        if (batchOngkir > 0) {
          // Satu tanggal kirim = satu baris ongkir. Key flat "__ongkir__" per dateGroup
          // agar tidak dobel meski ada beberapa batch/order di tanggal yang sama.
          // Selalu overwrite dengan nilai terbaru (batch terakhir = pesanan terbaru = paling aktual).
          const ongkirKey = "__ongkir__";
          const existing = target.itemMap.get(ongkirKey);
          const prevOngkir = existing ? existing.price : 0;
          target.itemMap.set(ongkirKey, { name: "Ongkir", shippedQty: 1, price: batchOngkir, subtotal: batchOngkir, isOngkir: true });
          target.total += (batchOngkir - prevOngkir);
        }
        // Biaya tambahan (packing/label dll) — sudah dipastikan unik per pesanan di
        // batch.invoiceExtraCharge (ditempel ke pengiriman terakhir pesanan itu saja).
        // Key per orderKey supaya beberapa pesanan beda di tanggal kirim yang sama
        // tidak saling menimpa barisnya.
        const batchExtraCharge = moneyValue(batch.invoiceExtraCharge || 0);
        if (batchExtraCharge > 0 && orderKeyForReturn) {
          const extraKey = `__extra__${orderKeyForReturn}`;
          target.itemMap.set(extraKey, {
            name: batch.invoiceExtraChargeLabel || "Biaya Tambahan",
            shippedQty: 1,
            price: batchExtraCharge,
            subtotal: batchExtraCharge,
            isExtraCharge: true,
          });
          target.total += batchExtraCharge;
        }
        (batch.items || []).forEach((it) => {
          const shippedQty = Number(it.shippedQty || 0);
          if (shippedQty <= 0) return;
          const name = String(it.name || it.nama || it.productName || "Pesanan").trim() || "Pesanan";
          const price = Number(moneyValue(it.price ?? it.harga ?? it.unitPrice ?? it.sellingPrice ?? 0) || 0) || lookupMasterPrice(name);
          const subtotal = shippedQty * price;
          const rowKey = `${normalizeName(name)}|${price}`;
          const existing = target.itemMap.get(rowKey) || { name, shippedQty: 0, price, subtotal: 0 };
          existing.shippedQty += shippedQty;
          existing.subtotal += subtotal;
          target.itemMap.set(rowKey, existing);
          target.qty += shippedQty;
          target.total += subtotal;
        });
      });
    });

    const dateGroups = Array.from(groupsByDate.values())
      .map((group) => ({
        ...group,
        rows: Array.from(group.itemMap.values()).sort((a, b) => {
          // Ongkir & Biaya Tambahan selalu di bawah semua produk, baru diurutkan alphabetical antar produk
          const aBottom = a.isOngkir || a.isExtraCharge;
          const bBottom = b.isOngkir || b.isExtraCharge;
          if (aBottom && !bBottom) return 1;
          if (!aBottom && bBottom) return -1;
          return a.name.localeCompare(b.name, "id");
        }),
      }))
      .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    const rowsCount = dateGroups.reduce((sum, group) => sum + group.rows.length, 0);

    // Tempelkan baris retur (info-only, tidak mengubah nominal) di bawah pesanan yang relevan.
    // Satu retur hanya ditempel sekali — ke tanggal kirim pertama yang mencocokkan pesanannya.
    const claimedReturnIds = new Set();
    const dateGroupsWithReturns = dateGroups.map((group) => {
      const groupReturns = customerReturns.filter((r) => {
        const rid = r.id || `${r.orderId}-${r.itemIndex}-${r.tanggal}`;
        if (claimedReturnIds.has(rid)) return false;
        const rOrderKey = String(r.orderId || "").trim();
        const rInvoiceKey = String(r.invoice || "").trim();
        const match = (rOrderKey && group.orderKeys.has(rOrderKey)) || (rInvoiceKey && group.orderKeys.has(rInvoiceKey));
        if (match) claimedReturnIds.add(rid);
        return match;
      });
      return { ...group, returnRows: groupReturns };
    });

    const C = {
      bg: "#FFFFFF",
      pageBg: "#FFF7FB",
      title: "#111827",
      body: "#1F2937",
      muted: "#64748B",
      border: "#E5E7EB",
      borderStrong: "#F9A8D4",
      accent: "#DB2777",
      accentDark: "#9D174D",
      accentSoft: "#FCE7F3",
      green: "#059669",
      greenSoft: "#D1FAE5",
      redSoft: "#FFE4E6",
      graySoft: "#F8FAFC",
      tableText: "#0F172A",
      white: "#FFFFFF",
    };

    const W = 1440;
    const PAD = 56;
    const headerH = 155;
    const infoH = 78;
    const tableHeadH = 36;
    const rowH = 36;
    const summaryH = 125;
    const isBelumLunasInvoice = statusFilter === "belum";
    // Saat filter Belum Lunas dipilih, invoice difokuskan ke tagihan yang masih perlu ditagih.
    // Nominal pembayaran customer disembunyikan agar tidak muncul dua angka besar yang membingungkan.
    const showCustomerSummary = !isBelumLunasInvoice;
    const showPaymentSummary = !isBelumLunasInvoice;
    const summaryEffectiveH = showCustomerSummary ? summaryH : 0;
    const paymentSummaryTitleH = showPaymentSummary ? 40 : 0;
    const paymentSummaryHeadH = showPaymentSummary ? 64 : 0;
    const paymentSummaryRecentTitleH = showPaymentSummary && paymentDetailRows.length > 0 ? 30 : 0;
    const paymentSummaryRowH = showPaymentSummary ? 30 : 0;
    const paymentSummaryFooterH = showPaymentSummary ? 38 : 0;
    const paymentSummaryRowsH = showPaymentSummary
      ? (paymentDetailRows.length > 0 ? latestPaymentRows.length * paymentSummaryRowH : paymentSummaryRowH)
      : 0;
    const paymentSummaryCardH = showPaymentSummary
      ? paymentSummaryHeadH + paymentSummaryRecentTitleH + paymentSummaryRowsH + paymentSummaryFooterH + 18
      : 0;
    const paymentDetailH = showPaymentSummary ? paymentSummaryTitleH + paymentSummaryCardH + 22 : 0;
    const footerH = 48;
    // Flat rows: semua item dari semua tanggal digabung dalam satu tabel.
    // Khusus filter Belum Lunas, untuk tanggal kirim yang SUDAH DICICIL SEBAGIAN
    // (paid > 0 dan sisa > 0), tambahkan 2 baris extra di akhir grup tanggal:
    //   1. "− Sudah dibayar" dengan nilai negatif (= -paid grup tanggal itu)
    //   2. "Sisa Pengiriman [tgl]" dengan nilai sisa (= total - paid grup tanggal itu)
    // Tanggal yang belum dicicil sama sekali (paid = 0) tampil apa adanya tanpa baris extra,
    // karena total per item = sisa per item, tidak perlu pengurang.
    const flatRows = dateGroupsWithReturns.flatMap((group) => {
      const groupRows = group.rows.map((row) => ({ ...row, dateLabel: group.label }));
      // Baris retur — muncul di bawah pesanan terkait.
      // - Belum diproses admin (tagihanDikurangi belum true): info-only, subtotal 0,
      //   karena retur TIDAK otomatis mengurangi tagihan sampai admin klik "Kurangi
      //   Tagihan Sekarang" di tab Retur.
      // - Sudah diproses (tagihanDikurangi true): subtotal negatif sebesar nominal yang
      //   sudah dikurangi, supaya Grand Total & Sisa Tagihan di invoice ini benar-benar
      //   mencerminkan koreksinya.
      (group.returnRows || []).forEach((r) => {
        const qty = Number(r.qty || 0);
        const nominal = Number(r.tagihanDikurangiNominal || 0);
        groupRows.push({
          isRetur: true,
          isReturProcessed: Boolean(r.tagihanDikurangi),
          name: `↩️ Retur: ${r.itemName || "Produk"} (${qty} pcs)`,
          note: r.alasan || "",
          kondisiLabel: r.kondisi === "rusak" ? "Rusak" : "Bisa dijual lagi",
          shippedQty: null,
          price: null,
          subtotal: r.tagihanDikurangi ? -nominal : 0,
          dateLabel: group.label,
        });
      });
      const groupSisa = Number(group.total || 0) - Number(group.paid || 0);
      if (isBelumLunasInvoice && Number(group.paid || 0) > 0 && groupSisa > 0) {
        groupRows.push({
          isPengurang: true,
          name: "− Sudah dibayar",
          shippedQty: null,
          price: null,
          subtotal: -Number(group.paid || 0),
          dateLabel: group.label,
        });
        groupRows.push({
          isSisaBatch: true,
          name: `Sisa Pengiriman ${group.label}`,
          shippedQty: null,
          price: null,
          subtotal: 0, // tidak ikut hitung GRAND TOTAL (cuma display)
          displayValue: groupSisa,
          dateLabel: group.label,
        });
      }
      return groupRows;
    });
    const totalFlatRows = Math.max(1, flatRows.length);
    const grandTotalNominalPreview = flatRows.reduce((sum, r) => sum + Number(r.subtotal || 0), 0);
    // Baris kelebihan bayar dihapus — hanya sisa tagihan yang ditampilkan
    const kelebihanBayarH = (totalSisa > 0) ? 32 : 0;
    const contentRowsH = tableHeadH + totalFlatRows * rowH + rowH + kelebihanBayarH + 18;
    const H = Math.max(420, headerH + infoH + 42 + contentRowsH + summaryEffectiveH + paymentDetailH + footerH + 36);
    const DPR = 2;

    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);
    ctx.textBaseline = "alphabetic";

    const roundRect = (x, y, w, h, r, fill, stroke) => {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    };
    const drawShadowCard = (x, y, w, h, r, fill = C.white, stroke = C.border) => {
      ctx.save();
      ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = fill;
      roundRect(x, y, w, h, r, true, false);
      ctx.restore();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      roundRect(x, y, w, h, r, false, true);
    };
    const line = (x1, y1, x2, y2, color = C.border, width = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    ctx.fillStyle = C.pageBg;
    ctx.fillRect(0, 0, W, H);

    const headerGradient = ctx.createLinearGradient(0, 0, W, headerH);
    headerGradient.addColorStop(0, "#FCE7F3");
    headerGradient.addColorStop(0.55, "#FDF2F8");
    headerGradient.addColorStop(1, "#FFF7ED");
    ctx.fillStyle = headerGradient;
    ctx.fillRect(0, 0, W, headerH);

    ctx.fillStyle = "rgba(219, 39, 119, 0.10)";
    ctx.beginPath();
    ctx.arc(W - 120, 12, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(168, 85, 247, 0.08)";
    ctx.beginPath();
    ctx.arc(W - 300, 138, 95, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C.accent;
    ctx.font = "800 32px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Gallery Kerudung", PAD, 54);
    ctx.fillStyle = C.title;
    ctx.font = "900 48px Arial";
    ctx.fillText("Invoice Pengiriman", PAD, 108);

    const chipW = 220;
    drawShadowCard(W - PAD - chipW, 34, chipW, 68, 18, "rgba(255,255,255,0.88)", "rgba(249,168,212,0.9)");
    ctx.textAlign = "right";
    ctx.fillStyle = C.muted;
    ctx.font = "600 14px Arial";
    ctx.fillText(`Dicetak: ${today}`, W - PAD - 14, 58);
    ctx.fillStyle = C.accentDark;
    ctx.font = "800 16px Arial";
    ctx.fillText("087822864625", W - PAD - 14, 84);

    let curY = headerH + 24;
    const infoGap = 18;
    const infoW = (W - PAD * 2 - infoGap) / 2;
    drawShadowCard(PAD, curY, infoW, infoH, 18, C.white, C.border);
    drawShadowCard(PAD + infoW + infoGap, curY, infoW, infoH, 18, C.white, C.border);

    ctx.textAlign = "left";
    ctx.fillStyle = C.muted;
    ctx.font = "800 13px Arial";
    ctx.fillText("CUSTOMER", PAD + 16, curY + 26);
    ctx.fillStyle = C.title;
    ctx.font = "900 24px Arial";
    ctx.fillText(trunc(customerName, 34), PAD + 16, curY + 58);

    ctx.textAlign = "right";
    ctx.fillStyle = C.muted;
    ctx.font = "800 13px Arial";
    ctx.fillText("PERIODE", W - PAD - 16, curY + 26);
    ctx.fillStyle = C.title;
    ctx.font = "900 20px Arial";
    const statusText = statusFilter === "belum" ? "Belum Lunas" : statusFilter === "lunas" ? "Lunas" : "Semua";
    ctx.fillText(periodLabel || statusText || `${customerOrders.length} pesanan`, W - PAD - 16, curY + 58);
    curY += infoH + 24;

    const tableX = PAD;
    const tableW = W - PAD * 2;
    const colDate = tableX + 24;
    const colProduct = tableX + 230;
    const colPrice = tableX + 820;
    const colQty = tableX + 1020;
    const colSubtotal = tableX + tableW - 24;
    const colDateEnd = tableX + 208;
    const colProductEnd = tableX + 710;
    const colPriceEnd = tableX + 890;
    const colQtyEnd = tableX + 1080;
    const tableGridLines = [colDateEnd, colProductEnd, colPriceEnd, colQtyEnd];

    const drawTableHead = () => {
      const g = ctx.createLinearGradient(tableX, curY, tableX + tableW, curY);
      g.addColorStop(0, C.accentDark);
      g.addColorStop(1, C.accent);
      ctx.fillStyle = g;
      ctx.fillRect(tableX, curY, tableW, tableHeadH);
      tableGridLines.forEach((x) => line(x, curY, x, curY + tableHeadH, "rgba(255,255,255,0.45)", 1));
      ctx.fillStyle = C.white;
      ctx.font = "900 14px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Tanggal", colDate, curY + 23);
      ctx.fillText("Nama Produk", colProduct, curY + 23);
      ctx.textAlign = "right";
      ctx.fillText("Harga Satuan", colPrice, curY + 23);
      ctx.fillText("Jumlah Dikirim", colQty, curY + 23);
      ctx.fillText("Total", colSubtotal, curY + 23);
      line(tableX, curY + tableHeadH, tableX + tableW, curY + tableHeadH, C.borderStrong, 1.2);
      curY += tableHeadH;
    };

    if (flatRows.length === 0) {
      drawShadowCard(tableX, curY, tableW, tableHeadH + rowH, 18, C.white, C.border);
      drawTableHead();
      ctx.fillStyle = C.muted;
      ctx.font = "600 14px Arial";
      ctx.textAlign = "center";
      ctx.fillText("Tidak ada data pengiriman pada periode ini.", W / 2, curY + 22);
      curY += rowH + 18;
    } else {
      drawShadowCard(tableX, curY, tableW, tableHeadH + flatRows.length * rowH, 18, C.white, C.border);
      drawTableHead();
      let prevDate = null;
      flatRows.forEach((row, idx) => {
        const isNewDate = row.dateLabel !== prevDate;
        ctx.fillStyle = idx % 2 === 0 ? C.white : "#FDF2F8";
        ctx.fillRect(tableX, curY, tableW, rowH);
        line(tableX, curY + rowH, tableX + tableW, curY + rowH, C.border, 1);
        tableGridLines.forEach((x) => line(x, curY, x, curY + rowH, C.border, 1));

        // Kolom tanggal — tampilkan hanya di baris pertama grup tanggal. Border grid membuat baris lanjutan tetap mudah diikuti.
        if (isNewDate) {
          ctx.fillStyle = C.accentDark;
          ctx.font = "900 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText(row.dateLabel, colDate, curY + 23);
          prevDate = row.dateLabel;
        }

        if (row.isPengurang) {
          // Baris pengurang cicilan — italic hijau, nilai juga hijau dengan tanda minus
          ctx.fillStyle = "#16A34A";
          ctx.font = "italic 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText(row.name, colProduct, curY + 23);
          ctx.textAlign = "right";
          ctx.fillStyle = C.muted;
          ctx.font = "600 12px Arial";
          ctx.fillText("-", colPrice, curY + 23);
          ctx.fillText("-", colQty - 6, curY + 23);
          ctx.fillStyle = "#16A34A";
          ctx.font = "800 13px Arial";
          ctx.fillText(`- ${rupiah(Math.abs(row.subtotal || 0))}`, colSubtotal, curY + 23);
        } else if (row.isSisaBatch) {
          // Baris sisa pengiriman — bold, background highlight tipis, nilai = sisa per pengiriman
          ctx.fillStyle = "#FEF3F2";
          ctx.fillRect(tableX, curY, tableW, rowH);
          line(tableX, curY + rowH, tableX + tableW, curY + rowH, C.border, 1);
          tableGridLines.forEach((x) => line(x, curY, x, curY + rowH, C.border, 1));
          ctx.fillStyle = C.accent;
          ctx.font = "900 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText(trunc(row.name, 42), colProduct, curY + 23);
          ctx.textAlign = "right";
          ctx.fillStyle = C.muted;
          ctx.font = "600 12px Arial";
          ctx.fillText("-", colPrice, curY + 23);
          ctx.fillText("-", colQty - 6, curY + 23);
          ctx.fillStyle = C.accent;
          ctx.font = "900 14px Arial";
          ctx.fillText(rupiah(row.displayValue || 0), colSubtotal, curY + 23);
        } else if (row.isRetur) {
          // Baris retur — kalau sudah diproses admin (subtotal negatif), tampilkan sebagai
          // pengurang tagihan sungguhan (hijau). Kalau belum diproses, tetap info-only (amber).
          const returColor = row.isReturProcessed ? "#16A34A" : "#C2410C";
          ctx.fillStyle = row.isReturProcessed ? "#F0FDF4" : "#FFF7ED";
          ctx.fillRect(tableX, curY, tableW, rowH);
          line(tableX, curY + rowH, tableX + tableW, curY + rowH, C.border, 1);
          tableGridLines.forEach((x) => line(x, curY, x, curY + rowH, C.border, 1));
          ctx.fillStyle = returColor;
          ctx.font = "italic 700 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText(trunc(row.name, 44), colProduct, curY + 23);
          ctx.textAlign = "right";
          ctx.fillStyle = returColor;
          ctx.font = "600 11px Arial";
          ctx.fillText(trunc(row.note ? `${row.kondisiLabel} • ${row.note}` : row.kondisiLabel, 30), colPrice, curY + 23);
          ctx.fillText("-", colQty - 6, curY + 23);
          ctx.fillStyle = returColor;
          ctx.font = "800 12px Arial";
          ctx.fillText(row.isReturProcessed ? `- ${rupiah(Math.abs(row.subtotal || 0))}` : "Tidak mengubah tagihan", colSubtotal, curY + 23);
        } else if (row.isOngkir) {
          // Baris ongkir — ditampilkan italic/muted, tanpa kolom harga satuan dan qty
          ctx.fillStyle = C.muted;
          ctx.font = "600 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText("Ongkir", colProduct, curY + 23);
          ctx.textAlign = "right";
          ctx.fillStyle = C.body;
          ctx.font = "700 13px Arial";
          ctx.fillText("-", colPrice, curY + 23);
          ctx.fillStyle = C.muted;
          ctx.font = "700 13px Arial";
          ctx.fillText("-", colQty - 6, curY + 23);
          ctx.fillStyle = C.accent;
          ctx.font = "900 14px Arial";
          ctx.fillText(rupiah(row.subtotal || 0), colSubtotal, curY + 23);
        } else if (row.isExtraCharge) {
          // Baris biaya tambahan (packing/label dll) — sama gayanya dengan Ongkir,
          // tapi label bebas sesuai keterangan yang diisi admin.
          ctx.fillStyle = C.muted;
          ctx.font = "600 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText(trunc(row.name, 42), colProduct, curY + 23);
          ctx.textAlign = "right";
          ctx.fillStyle = C.body;
          ctx.font = "700 13px Arial";
          ctx.fillText("-", colPrice, curY + 23);
          ctx.fillStyle = C.muted;
          ctx.font = "700 13px Arial";
          ctx.fillText("-", colQty - 6, curY + 23);
          ctx.fillStyle = C.accent;
          ctx.font = "900 14px Arial";
          ctx.fillText(rupiah(row.subtotal || 0), colSubtotal, curY + 23);
        } else {
          ctx.fillStyle = C.tableText;
          ctx.font = "700 14px Arial";
          ctx.textAlign = "left";
          ctx.fillText(trunc(row.name, 42), colProduct, curY + 23);

          ctx.textAlign = "right";
          ctx.fillStyle = row.price > 0 ? C.body : C.muted;
          ctx.font = row.price > 0 ? "700 13px Arial" : "600 12px Arial";
          ctx.fillText(row.price > 0 ? rupiah(row.price) : "— harga belum diisi", colPrice, curY + 23);

          ctx.fillStyle = C.accentSoft;
          roundRect(colQty - 82, curY + 7, 82, 22, 11, true, false);
          ctx.fillStyle = C.accentDark;
          ctx.font = "800 13px Arial";
          ctx.fillText(`${Number(row.shippedQty || 0).toLocaleString("id-ID")} pcs`, colQty - 6, curY + 23);

          ctx.fillStyle = C.accent;
          ctx.font = "900 14px Arial";
          ctx.fillText(rupiah(row.subtotal || 0), colSubtotal, curY + 23);
        }
        curY += rowH;
      });

      // Baris Grand Total
      const grandTotalQty = flatRows
        .filter((r) => !r.isOngkir && !r.isExtraCharge && !r.isPengurang && !r.isSisaBatch && !r.isRetur)
        .reduce((sum, r) => sum + Number(r.shippedQty || 0), 0);
      // GRAND TOTAL otomatis = sum subtotal flatRows:
      //   - Baris item: subtotal positif (qty × harga)
      //   - Baris ongkir: subtotal positif (nilai ongkir)
      //   - Baris pengurang: subtotal negatif (-paid per tanggal)
      //   - Baris sisaBatch: subtotal = 0 (cuma display label, displayValue ditampilkan terpisah)
      // Hasilnya = total items + ongkir - paid = sisa tagihan keseluruhan.
      const grandTotalNominal = flatRows.reduce((sum, r) => sum + Number(r.subtotal || 0), 0);

      const grandTotalH = rowH;
      ctx.fillStyle = C.accentDark;
      ctx.fillRect(tableX, curY, tableW, grandTotalH);
      line(tableX, curY, tableX + tableW, curY, C.borderStrong, 1.5);
      tableGridLines.forEach((x) => line(x, curY, x, curY + grandTotalH, "rgba(255,255,255,0.25)", 1));

      ctx.fillStyle = C.white;
      ctx.font = "900 14px Arial";
      ctx.textAlign = "left";
      ctx.fillText("GRAND TOTAL", colProduct, curY + 23);

      ctx.textAlign = "right";
      ctx.fillStyle = C.white;
      ctx.font = "800 13px Arial";
      ctx.fillText(`${grandTotalQty.toLocaleString("id-ID")} pcs`, colQty - 6, curY + 23);

      ctx.font = "900 14px Arial";
      ctx.fillText(rupiah(grandTotalNominal), colSubtotal, curY + 23);

      curY += grandTotalH;

      {
        const subRowH = 32;
        const subX = tableX + tableW * 0.38;
        const subW = tableW * 0.62;
        const subRows = [
          ...(isBelumLunasInvoice ? [] : [{ label: "Sudah Dibayar", value: rupiah(totalBayar), bg: "#F0FDF4", labelColor: "#16A34A", valueColor: "#16A34A" }]),
          { label: totalSisa > 0 ? "Sisa Tagihan" : "Status", value: totalSisa > 0 ? rupiah(totalSisa) : "Lunas ✅", bg: totalSisa > 0 ? C.redSoft : "#F0FDF4", labelColor: totalSisa > 0 ? C.accent : "#16A34A", valueColor: totalSisa > 0 ? C.accent : "#16A34A" },
        ];
        subRows.forEach(({ label, value, bg, labelColor, valueColor }) => {
          ctx.fillStyle = bg;
          ctx.fillRect(subX, curY, subW, subRowH);
          line(subX, curY, subX + subW, curY, C.border, 0.8);
          ctx.textAlign = "left";
          ctx.fillStyle = labelColor;
          ctx.font = "700 12px Arial";
          ctx.fillText(label, subX + 16, curY + 20);
          ctx.textAlign = "right";
          ctx.fillStyle = valueColor;
          ctx.font = "900 13px Arial";
          ctx.fillText(value, colSubtotal, curY + 20);
          curY += subRowH;
        });
      }

      curY += 18;
    }

    if (showCustomerSummary) {
      curY += 4;
      ctx.fillStyle = C.title;
      ctx.font = "900 20px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Ringkasan Customer", PAD, curY + 4);
      curY += 14;

      const summaryGap = 16;
      const summaryY = curY + 12;
      const summaries = [
        { label: "Total Tagihan", value: rupiah(totalTagihanCustomerKeseluruhan || 0), bg: C.graySoft, color: C.title },
        { label: "Realisasi Pembayaran", value: rupiah(totalBayar || 0), bg: C.greenSoft, color: C.green },
        { label: totalSisa > 0 ? "Sisa Tagihan" : "Status Pembayaran", value: totalSisa > 0 ? rupiah(totalSisa || 0) : "Lunas ✅", bg: totalSisa > 0 ? C.redSoft : C.greenSoft, color: totalSisa > 0 ? C.accent : C.green, strong: true },
      ];
      const summaryCardW = summaries.length === 1
        ? W - PAD * 2
        : (W - PAD * 2 - summaryGap * (summaries.length - 1)) / summaries.length;
      summaries.forEach((item, i) => {
        const x = PAD + i * (summaryCardW + summaryGap);
        drawShadowCard(x, summaryY, summaryCardW, summaryH - 24, 18, item.bg, item.strong ? C.borderStrong : C.border);
        ctx.textAlign = "left";
        ctx.fillStyle = C.muted;
        ctx.font = "900 13px Arial";
        ctx.fillText(item.label, x + 18, summaryY + 30);
        ctx.fillStyle = item.color;
        ctx.font = "900 21px Arial";
        ctx.fillText(item.value, x + 18, summaryY + 66);
      });
      curY += summaryH + 12;
    }

    if (showPaymentSummary) {
      ctx.fillStyle = C.title;
      ctx.font = "900 19px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Ringkasan Pembayaran", PAD, curY + 8);
      curY += paymentSummaryTitleH;

      drawShadowCard(PAD, curY, W - PAD * 2, paymentSummaryCardH, 18, C.white, C.border);
      const payCardX = PAD;
      const payCardW = W - PAD * 2;
      const payPad = 20;
      const payColW = (payCardW - payPad * 2) / 3;
      const payTop = curY + 18;
      const paymentSummaryItems = [
        { label: "Total Sudah Dibayar", value: rupiah(totalBayar || 0), color: C.green },
        { label: "Jumlah Transaksi", value: `${paymentDetailRows.length.toLocaleString("id-ID")}x`, color: C.title },
        { label: "Pembayaran Terakhir", value: latestPayment ? `${formatTgl(latestPayment.date)} - ${rupiah(latestPayment.amount || 0)}` : "Belum ada", color: latestPayment ? C.green : C.muted },
      ];
      paymentSummaryItems.forEach((item, i) => {
        const x = payCardX + payPad + i * payColW;
        if (i > 0) line(x, payTop - 4, x, payTop + paymentSummaryHeadH - 6, C.border, 1);
        ctx.textAlign = "left";
        ctx.fillStyle = C.muted;
        ctx.font = "900 12px Arial";
        ctx.fillText(item.label, x + (i > 0 ? 16 : 0), payTop + 16);
        ctx.fillStyle = item.color;
        ctx.font = i === 2 ? "900 15px Arial" : "900 20px Arial";
        ctx.fillText(trunc(item.value, i === 2 ? 36 : 24), x + (i > 0 ? 16 : 0), payTop + 46);
      });
      curY += paymentSummaryHeadH + 18;
      line(PAD + 20, curY - 4, W - PAD - 20, curY - 4, C.border, 1);

      if (paymentDetailRows.length === 0) {
        ctx.fillStyle = C.muted;
        ctx.font = "700 14px Arial";
        ctx.textAlign = "left";
        ctx.fillText("Belum ada realisasi pembayaran yang tercatat.", PAD + 20, curY + 22);
        curY += paymentSummaryRowH;
      } else {
        ctx.fillStyle = C.title;
        ctx.font = "900 14px Arial";
        ctx.textAlign = "left";
        ctx.fillText("3 Pembayaran Terakhir", PAD + 20, curY + 20);
        ctx.fillStyle = C.muted;
        ctx.font = "700 12px Arial";
        ctx.textAlign = "right";
        ctx.fillText("Detail lengkap tersimpan di riwayat pembayaran customer.", W - PAD - 20, curY + 20);
        curY += paymentSummaryRecentTitleH;

        latestPaymentRows.forEach((row, idx) => {
          const rowY = curY;
          ctx.fillStyle = idx % 2 === 0 ? C.white : C.graySoft;
          ctx.fillRect(PAD + 20, rowY, W - PAD * 2 - 40, paymentSummaryRowH);
          line(PAD + 20, rowY + paymentSummaryRowH, W - PAD - 20, rowY + paymentSummaryRowH, C.border, 1);
          ctx.fillStyle = C.body;
          ctx.font = "800 13px Arial";
          ctx.textAlign = "left";
          ctx.fillText(formatTgl(row.date), PAD + 30, rowY + 21);
          ctx.fillStyle = C.green;
          ctx.font = "900 14px Arial";
          ctx.textAlign = "right";
          ctx.fillText(rupiah(row.amount || 0), W - PAD - 30, rowY + 21);
          curY += paymentSummaryRowH;
        });
      }

      ctx.fillStyle = C.accentSoft;
      ctx.fillRect(PAD + 20, curY + 8, W - PAD * 2 - 40, paymentSummaryFooterH);
      ctx.fillStyle = C.accentDark;
      ctx.font = "900 13px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Invoice ini mencakup seluruh barang yang sudah dikirim. Pembayaran otomatis mengurangi total tagihan customer.", PAD + 34, curY + 33);
      curY += paymentSummaryFooterH + 18;

      curY += 18;
    }
    ctx.fillStyle = C.muted;
    ctx.font = "700 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Terima kasih — Gallery Kerudung", W / 2, curY + 10);

    setImgUrl(canvas.toDataURL("image/jpeg", 0.88));
  }, [customerName, orders, startDate, endDate, statusFilter, periodLabel, shipmentBatches, transfers, returns, totalTagihanCustomerKeseluruhan, totalBayar, totalSisa, hasScopedInvoiceFilter, getOrderTagihan]);

  function downloadGambar() {
    if (!imgUrl) return;
    const safeName = customerName.replace(/\s+/g, "-").toLowerCase();
    const link = document.createElement("a");
    link.download = `invoice-${safeName}.jpg`;
    link.href = imgUrl;
    link.click();
  }

  async function shareGambar() {
    if (!imgUrl) return;
    try {
      const { jsPDF } = await loadPdfTools();
      const canvas = canvasRef.current;
      const imgW = canvas.width / (window.devicePixelRatio || 1);
      const imgH = canvas.height / (window.devicePixelRatio || 1);
      // A4 lebar 210mm, hitung tinggi proporsional
      const pdfW = 210;
      const pdfH = Math.round((imgH / imgW) * pdfW);
      const pdf = new jsPDF({ orientation: pdfH > pdfW ? "portrait" : "landscape", unit: "mm", format: [pdfW, pdfH] });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pdfW, pdfH);
      const safeName = customerName.replace(/\s+/g, "-").toLowerCase();
      const pdfBlob = pdf.output("blob");
      const file = new File([pdfBlob], `invoice-${safeName}.pdf`, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Invoice ${customerName}`, text: `Rincian pesanan ${customerName} dari Gallery Kerudung 💕` });
      } else {
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.download = `invoice-${safeName}.pdf`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        // fallback ke gambar
        const safeName = customerName.replace(/\s+/g, "-").toLowerCase();
        const link = document.createElement("a");
        link.download = `invoice-${safeName}.jpg`;
        link.href = imgUrl;
        link.click();
      }
    }
  }

  return (
    <SimpleModal title={`Invoice — ${customerName}`} onClose={onClose}>
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
      <canvas ref={canvasRef} className="hidden" />

      {customerOrders.length === 0 && (
        <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: "#f9fafb", color: "#94a3b8" }}>
          Tidak ada pesanan sesuai periode dan filter status untuk <strong>{customerName}</strong>.
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
      </div>
    </SimpleModal>
  );
}
