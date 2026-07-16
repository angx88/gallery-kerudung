import { useMemo } from "react";
import { moneyValue, todayStr } from "../utils";

export default function GrafikPesanan({ orders }) {
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
