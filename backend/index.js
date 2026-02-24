const express = require('express');
const cors = require('cors');
const moment = require('moment');

const app = express();
app.use(cors());
app.use(express.json());

// Mock DB
let bookings = []; 
let leaves = [];

const BATCH_SCHEDULE = {
    1: { week1: ['Mon', 'Tue', 'Wed'], week2: ['Thu', 'Fri'] },
    2: { week1: ['Thu', 'Fri'], week2: ['Mon', 'Tue', 'Wed'] }
};

// --- FIX: Returns an object to satisfy sRes.data.seats.map() ---
app.get('/api/seats', (req, res) => {
    const { date } = req.query;
    
    let seatMap = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        type: i < 40 ? 'designated' : 'floating',
        status: 'available',
        bookedBy: null
    }));

    // Convert seats to floating if on leave
    leaves.filter(l => l.date === date).forEach(leave => {
        const seat = seatMap.find(s => s.id === leave.seatId);
        if (seat && seat.id <= 40) {
            seat.type = 'floating';
            seat.status = 'available'; 
        }
    });

    // Mark bookings
    bookings.filter(b => b.date === date).forEach(booking => {
        const seat = seatMap.find(s => s.id === booking.seatId);
        if (seat) {
            seat.status = 'occupied';
            seat.bookedBy = booking.userId;
        }
    });

    const floatingTotal = seatMap.filter(s => s.type === 'floating').length;

    res.json({
        seats: seatMap,
        floatingTotal: floatingTotal
    });
});

// --- FIX: Defining the Mark Leave Route ---
app.post('/api/mark-leave', (req, res) => {
    const { userId, date, seatId } = req.body;
    
    // Add to leaves
    leaves.push({ userId, date, seatId });
    
    // Remove existing booking for that user on that day
    bookings = bookings.filter(b => !(b.userId === userId && b.date === date));
    
    res.json({ message: "Leave marked. Seat is now floating." });
});

// Standard Booking
app.post('/api/book', (req, res) => {
    const { userId, seatId, date, batch, week } = req.body;
    const now = moment();
    // 3 PM Logic
    if (seatId > 40 && now.hour() < 15) {
        return res.status(400).json({ error: "Floating seats open at 3:00 PM." });
    }
    bookings.push({ userId, seatId, date });
    res.json({ message: "Booked!" });
});

app.get('/api/stats/:userId', (req, res) => {
    const count = bookings.filter(b => b.userId === req.params.userId).length;
    res.json({ count, target: 5 });
});

// backend/index.js
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});