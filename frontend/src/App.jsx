import React, { useState, useEffect } from 'react';
import axios from 'axios';
import SeatGrid from './components/SeatGrid';

const App = () => {
  const [seats, setSeats] = useState([]);
  const [stats, setStats] = useState({ count: 0, target: 5 });
  const [floatingTotal, setFloatingTotal] = useState(10);
  const [selectedDate, setSelectedDate] = useState("2026-02-24");
  const [user] = useState({ id: 'U101', batch: 1, week: 1, designatedSeatId: 13 });

  useEffect(() => { fetchData(); }, [selectedDate]);

  const fetchData = async () => {
    try {
      const sRes = await axios.get(`http://localhost:5000/api/seats`, { params: { date: selectedDate } });
      const aRes = await axios.get(`http://localhost:5000/api/stats/${user.id}`);
      
      const enrichedSeats = sRes.data.seats.map(seat => ({
        ...seat,
        isUserSeat: seat.bookedBy === user.id 
      }));
      
      setSeats(enrichedSeats);
      setFloatingTotal(sRes.data.floatingTotal);
      setStats(aRes.data);
    } catch (err) { 
      console.error("Fetch error:", err); 
    }
  };

  const handleMarkLeave = async () => {
    try {
      await axios.post('http://localhost:5000/api/mark-leave', {
        userId: user.id,
        date: selectedDate,
        seatId: user.designatedSeatId
      });
      alert("Leave confirmed. Your designated seat is now a Floating slot.");
      fetchData();
    } catch (err) {
      console.error("Mark Leave failed:", err);
    }
  };

  const handleSeatClick = async (seat) => {
    const now = new Date();
    if (seat.type === 'floating' && now.getHours() < 15) {
      alert("SmartSeat Policy: Floating seats are restricted until 3:00 PM.");
      return;
    }
    try {
      await axios.post('http://localhost:5000/api/book', { 
        userId: user.id, seatId: seat.id, date: selectedDate, 
        batch: user.batch, week: user.week 
      });
      fetchData();
    } catch (err) { alert(err.response?.data?.error || "Booking failed"); }
  };

  return (
    // PROFESSIONAL BACKGROUND: Slate-100 for depth
    <div className="min-h-screen bg-[#f1f5f9] p-4 md:p-10 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-8">
        
        {/* SIDEBAR: Glassmorphism Style */}
        <aside className="lg:w-96 space-y-6">
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200/60">
            <h1 className="text-xl font-bold text-indigo-900 mb-4 tracking-tight">SmartSeat Portal</h1>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select Work Date</label>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full mt-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          {/* POLICY CARD: Professional Dark Navy */}
          <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-xl shadow-slate-200 relative overflow-hidden">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-indigo-400">Office Rules</h2>
            <ul className="space-y-4 text-xs opacity-90 leading-relaxed">
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">01</span> Floating seats open after 3 PM.</li>
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">02</span> Batch 1 assigned Mon-Wed.</li>
              <li className="flex gap-3"><span className="text-indigo-400 font-bold">03</span> Target: 5 office days per cycle.</li>
            </ul>
          </div>

          {/* STATS & ACTION CARD */}
          <div className="bg-white p-7 rounded-[2rem] shadow-sm border border-slate-200/60">
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase">Cycle Progress</h2>
              <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">{stats.count} / 5</span>
            </div>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mb-8">
              <div className="bg-indigo-600 h-full transition-all duration-1000" style={{width: `${(stats.count/5)*100}%`}}></div>
            </div>

            <button 
              onClick={handleMarkLeave}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95"
            >
              Mark Leave for Today
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT: Large Clean Canvas */}
        <main className="flex-1 bg-white p-8 md:p-12 rounded-[3rem] shadow-sm border border-slate-200/60">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
            <div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">Floor 4 Plan</h2>
              <p className="text-slate-500 mt-1 font-medium italic">
                Currently providing <span className="text-amber-600 font-bold underline">{floatingTotal}</span> floating slots
              </p>
            </div>
            
            {/* LEGEND SECTION */}
            <div className="flex gap-4 p-2 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-2 px-2">
                <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Designated</span>
              </div>
              <div className="flex items-center gap-2 px-2">
                <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Floating</span>
              </div>
              <div className="flex items-center gap-2 px-2">
                <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Your Seat</span>
              </div>
            </div>
          </header>

          <div className="p-4 bg-slate-50/50 rounded-[2rem] border border-dashed border-slate-200">
            <SeatGrid seats={seats} onSeatClick={handleSeatClick} />
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;