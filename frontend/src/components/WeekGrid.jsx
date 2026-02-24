import { useState } from "react";

const initialDays = [
  { name: "Mon", type: "designated", booked: true },
  { name: "Tue", type: "designated", booked: true },
  { name: "Wed", type: "designated", booked: true },
  { name: "Thu", type: "floating", booked: false },
  { name: "Fri", type: "floating", booked: false },
];

const WeekGrid = () => {
  const [days, setDays] = useState(initialDays);

  const handleClick = (index) => {
    if (days[index].type === "designated") return;

    const updated = [...days];
    updated[index].booked = !updated[index].booked;
    setDays(updated);
  };

  return (
    <div className="flex gap-4 mt-8">
      {days.map((d, i) => (
        <div
          key={d.name}
          onClick={() => handleClick(i)}
          className={`w-24 h-24 flex flex-col items-center justify-center rounded-lg shadow cursor-pointer
          ${
            d.type === "designated"
              ? "bg-green-200 cursor-not-allowed"
              : d.booked
              ? "bg-blue-300"
              : "bg-yellow-200 hover:bg-yellow-300"
          }`}
        >
          <div>{d.name}</div>
          {d.booked && d.type === "floating" && (
            <span className="text-xs mt-1">Booked</span>
          )}
        </div>
      ))}
    </div>
  );
};

export default WeekGrid;