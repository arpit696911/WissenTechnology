import React from 'react';

const SeatGrid = ({ seats, currentUserId, selectedSeatIds, onSeatClick }) => {
  const isSelected = (seatId) => selectedSeatIds.includes(seatId);

  const getSeatStyles = (seat) => {
    const selected = isSelected(seat.seatId);
    const isMine = seat.bookedBy === currentUserId;
    const isFloater = seat.type === 'floater';

    if (seat.status === 'occupied' && isMine) {
      return 'bg-indigo-500 text-white shadow-lg ring-2 ring-indigo-300 scale-[1.02]';
    }

    if (seat.status === 'occupied') {
      return 'bg-slate-800 text-slate-500 cursor-not-allowed';
    }

    if (seat.status === 'locked' && seat.lockedBy && seat.lockedBy !== currentUserId) {
      return 'bg-amber-500/20 text-amber-400 border border-amber-500/40 cursor-not-allowed';
    }

    if (selected) {
      return 'bg-sky-500 text-slate-900 shadow-lg ring-2 ring-sky-300';
    }

    if (isFloater) {
      return 'bg-emerald-300/20 text-emerald-100 border border-emerald-300/40 hover:bg-emerald-300/30';
    }

    return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/25';
  };

  const isDisabled = (seat) => {
    if (seat.status === 'occupied' && seat.bookedBy !== currentUserId) return true;
    if (seat.status === 'locked' && seat.lockedBy && seat.lockedBy !== currentUserId) return true;
    return false;
  };

  return (
    <div className="grid grid-cols-5 md:grid-cols-10 gap-3">
      {seats.map((seat) => (
        <button
          key={seat.seatId}
          type="button"
          disabled={isDisabled(seat)}
          onClick={() => onSeatClick(seat)}
          className={`
            aspect-square rounded-xl text-xs font-semibold transition-all duration-200 
            flex flex-col items-center justify-center gap-1
            ${getSeatStyles(seat)}
            ${isDisabled(seat) ? 'cursor-not-allowed opacity-80' : 'hover:scale-[1.03]'}
          `}
        >
          <span className="opacity-60 text-[9px] uppercase tracking-wide">Seat</span>
          <span className="text-sm">
            {seat.row}
            {seat.number}
          </span>
          <span className="text-[9px] text-slate-300">
            {seat.type === 'floater' ? 'Floater' : 'Designated'}
          </span>
          {seat.status === 'locked' && seat.lockedBy === currentUserId && (
            <span className="text-[9px] text-sky-100">Locked by you</span>
          )}
          {seat.status === 'locked' && seat.lockedBy && seat.lockedBy !== currentUserId && (
            <span className="text-[9px] text-amber-300">Locked</span>
          )}
          {seat.status === 'occupied' && seat.bookedBy === currentUserId && (
            <span className="text-[9px] text-slate-100">My booking</span>
          )}
        </button>
      ))}
    </div>
  );
};

export default SeatGrid;
