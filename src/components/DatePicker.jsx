import { useState } from "react";

export const BULAN_FULL = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];

export default function DatePicker({ label, value, onChange }) {
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
