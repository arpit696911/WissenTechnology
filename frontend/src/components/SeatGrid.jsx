import React from 'react';

const SeatGrid = ({ seats, onSeatClick }) => {
 const getSeatStyles = (seat) => {
  // 1. Your active booking (Blue)
  if (seat.status === 'occupied' && seat.bookedBy === 'U101') {
    return "bg-blue-600 text-white shadow-md scale-105 z-10 ring-4 ring-blue-50";
  }

  // 2. Occupied by others (Grey)
  if (seat.status === 'occupied') {
    return "bg-slate-100 text-slate-300 cursor-not-allowed";
  }

  // 3. Floating Seats (Yellow) - including converted designated seats
  if (seat.type === 'floating') {
    return "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100";
  }

  // 4. Default: Designated (Green)
  return "bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100";
};

  return (
    <div className="grid grid-cols-5 md:grid-cols-10 gap-4">
      {seats.map((seat) => (
        <button
          key={seat.id}
          // Only disable if someone else booked it. 
          // If it's yours, you click it to cancel.
          disabled={seat.status === 'occupied' && !seat.isUserSeat}
          onClick={() => onSeatClick(seat)}
          className={`
            aspect-square rounded-xl text-sm font-bold transition-all duration-200 
            flex flex-col items-center justify-center gap-1
            ${getSeatStyles(seat)}
          `}
        >
          <span className="opacity-60 text-[10px] uppercase">Seat</span>
          {seat.id}
          {/* Requirement: Floating availability check - show label if converted */}
          {seat.id <= 40 && seat.type === 'floating' && (
             <span className="text-[8px] text-amber-500 font-extrabold">FLOAT</span>
          )}
        </button>
      ))}
    </div>
  );
};

export default SeatGrid;