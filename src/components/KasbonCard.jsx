import { useState } from "react";
import { parseMoney, moneySum } from "../utils";

export default function KasbonCard({ kasbon, onCicilan, onHapus, onBatalCicilan, isSaving, lunas = false }) {
  const [showCicilan, setShowCicilan] = useState(false);
  const [cicilanForm, setCicilanForm] = useState({ jumlah: "", tanggal: "" });
  const totalKasbon = parseMoney(kasbon.jumlah ?? kasbon.amount ?? 0);
  const totalCicilan = moneySum(kasbon.cicilan || [], (c) => c.jumlah ?? c.amount ?? 0);
  // Prioritaskan sisaKasbon dari Firestore (sudah termasuk potongan gaji dari Gallery Produksi).
  // Fallback ke kalkulasi manual hanya jika field tidak ada (data sangat lama).
  const sisaKasbon = kasbon.sisaKasbon !== undefined && kasbon.sisaKasbon !== null
    ? Math.max(0, parseMoney(kasbon.sisaKasbon))
    : Math.max(0, totalKasbon - totalCicilan);

  function rupiah(num) {
    return `Rp ${Math.round(Number(num || 0)).toLocaleString("id-ID")}`;
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm" style={{ border: lunas ? "1.5px solid #bbf7d0" : "1.5px solid #fde68a" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-black text-base" style={{ color: "#2d1b69" }}>👤 {kasbon.employeeName}</div>
          <div className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>📅 {kasbon.tanggal}{kasbon.keterangan ? ` · ${kasbon.keterangan}` : ""}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-bold shrink-0 ${lunas ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {lunas ? "✅ Lunas" : "⏳ Aktif"}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl p-2" style={{ background: "#f8fafc" }}>
          <div className="text-[10px] text-slate-400">Total Kasbon</div>
          <div className="text-sm font-black" style={{ color: "#2d1b69" }}>{rupiah(totalKasbon)}</div>
        </div>
        <div className="rounded-2xl p-2" style={{ background: "#f0fdf4" }}>
          <div className="text-[10px] text-slate-400">Sudah Cicil</div>
          <div className="text-sm font-black text-emerald-600">{rupiah(totalCicilan)}</div>
        </div>
        <div className="rounded-2xl p-2" style={{ background: lunas ? "#f0fdf4" : "#fefce8" }}>
          <div className="text-[10px] text-slate-400">Sisa</div>
          <div className={`text-sm font-black ${lunas ? "text-emerald-600" : "text-amber-600"}`}>{rupiah(sisaKasbon)}</div>
        </div>
      </div>

      {/* Riwayat cicilan */}
      {(kasbon.cicilan || []).length > 0 && (
        <div className="mt-3 rounded-2xl p-3 space-y-1" style={{ background: "#f8fafc" }}>
          <div className="text-[10px] font-bold text-slate-500 mb-2">Riwayat Bayar/Cicil</div>
          {[...kasbon.cicilan].sort((a, b) => (a.tanggal || "").localeCompare(b.tanggal || "")).map((c, i) => (
            <div key={c.id || i} className="flex justify-between items-center text-xs gap-2">
              <span className="text-slate-500">
                {c.tanggal}{" "}
                {c.sumber === "rekap_gaji"
                  ? <span className="inline-flex items-center gap-0.5 text-blue-500 font-semibold">🔄 Dipotong gaji</span>
                  : "· Manual"}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-bold text-emerald-600">{rupiah(c.jumlah)}</span>
                {onBatalCicilan && c.sumber === "rekap_gaji" && (
                  <button
                    type="button"
                    onClick={() => onBatalCicilan(kasbon.id, c)}
                    disabled={isSaving}
                    className="rounded-xl px-2 py-0.5 text-[10px] font-bold text-rose-500 disabled:opacity-40"
                    style={{ background: "#fff1f2", border: "1px solid #fecaca" }}
                  >Batal</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form tambah cicilan */}
      {!lunas && showCicilan && (
        <div className="mt-3 rounded-2xl p-3 space-y-2" style={{ background: "#fefce8", border: "1px solid #fde68a" }}>
          <div className="text-xs font-bold text-amber-700">Bayar/Cicil Kasbon</div>
          <input
            type="date"
            value={cicilanForm.tanggal || todayStr()}
            onChange={(e) => setCicilanForm(f => ({ ...f, tanggal: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-xl outline-none"
            style={{ border: "1.5px solid #fde68a", background: "white" }}
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="Jumlah bayar/cicil"
            value={cicilanForm.jumlah}
            onChange={(e) => setCicilanForm(f => ({ ...f, jumlah: e.target.value }))}
            className="w-full px-3 py-2 text-sm rounded-xl outline-none"
            style={{ border: "1.5px solid #fde68a", background: "white" }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowCicilan(false); setCicilanForm({ jumlah: "", tanggal: "" }); }}
              className="flex-1 rounded-xl py-2 text-xs font-bold text-slate-500"
              style={{ border: "1px solid #e2e8f0" }}
            >Batal</button>
            <button
              type="button"
              disabled={isSaving}
              onClick={async () => {
                await onCicilan(kasbon.id, parseMoney(cicilanForm.jumlah), cicilanForm.tanggal || todayStr());
                setShowCicilan(false);
                setCicilanForm({ jumlah: "", tanggal: "" });
              }}
              className="flex-1 rounded-xl py-2 text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}
            >Simpan Bayar/Cicil</button>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {!lunas && (
          <button
            type="button"
            onClick={() => setShowCicilan(!showCicilan)}
            className="flex-1 rounded-2xl py-2.5 text-xs font-bold"
            style={{ background: "#fef3c7", color: "#d97706", border: "1px solid #fde68a" }}
          >
            {showCicilan ? "Tutup" : "💵 Bayar/Cicil"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onHapus(kasbon.id)}
          className="rounded-2xl px-4 py-2.5 text-xs font-bold text-rose-500"
          style={{ background: "#fff1f2", border: "1px solid #fecaca" }}
        >
          Hapus
        </button>
      </div>
    </div>
  );
}
