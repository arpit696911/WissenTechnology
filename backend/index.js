const express = require('express');
const cors = require('cors');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

/* ---------------- CONSTANTS & MODELS ---------------- */

const TOTAL_EMPLOYEES = 80;
const LOCK_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const MAX_SEATS_PER_BOOKING = 5;
const FLOATER_SEAT_COUNT = 10;

// Two-week batch rotation
// Week1 = odd ISO week, Week2 = even ISO week
const DEFAULT_BATCH_SCHEDULE = {
  batch1: { week1: ['Mon', 'Tue', 'Wed'], week2: ['Thu', 'Fri'] },
  batch2: { week1: ['Thu', 'Fri'], week2: ['Mon', 'Tue', 'Wed'] }
};

let batchSchedule = { ...DEFAULT_BATCH_SCHEDULE };

// Holidays as ISO date strings "YYYY-MM-DD"
let holidays = new Set();

/**
 * User shape:
 * {
 *   userId,
 *   name,
 *   email,
 *   passwordHash,
 *   batch: "batch1" | "batch2",
 *   designatedSeatId: null | seatId,
 *   floaterLeaveCount: number,
 *   isAdmin: boolean
 * }
 */
const users = new Map(); // key: userId
const usersByEmail = new Map(); // key: email -> userId

/**
 * In-memory session store:
 * token -> userId
 */
const sessions = new Map();

/**
 * Seat base model (office layout, independent of date):
 * {
 *   seatId: number,
 *   type: "designated" | "floater",
 *   assignedTo: null | userId
 * }
 */
let seatDefinitions = [];

/**
 * Per-day dynamic state stored separately for DB-readiness:
 * - bookings: confirmed seats
 * - locks: temporary holds for atomic booking
 * - leaves: designated users releasing their seat for specific date
 *
 * bookings: { date, seatId, userId, bookedAt }
 * locks:    { date, seatId, userId, lockExpiry }
 * leaves:   { date, userId, seatId }
 */
let bookings = [];
let locks = [];
let leaves = [];

const initSeatDefinitions = () => {
  seatDefinitions = [];
  const totalSeats = 50; // Example floor size: 40 designated + 10 floater
  const floaterStart = totalSeats - FLOATER_SEAT_COUNT + 1;

  for (let seatId = 1; seatId <= totalSeats; seatId += 1) {
    const type = seatId >= floaterStart ? 'floater' : 'designated';
    seatDefinitions.push({
      seatId,
      type,
      assignedTo: null
    });
  }
};

initSeatDefinitions();

/* ---------------- UTILITIES ---------------- */

const nowTs = () => Date.now();

const getSeatDefinition = (seatId) => seatDefinitions.find((s) => s.seatId === seatId);

const publicUserView = (user) => ({
  userId: user.userId,
  name: user.name,
  email: user.email,
  batch: user.batch,
  designatedSeatId: user.designatedSeatId,
  floaterLeaveCount: user.floaterLeaveCount || 0,
  isAdmin: !!user.isAdmin
});

const createUserId = (email) => {
  const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'user';
  const suffix = users.size + 1;
  return `${prefix}${suffix}`;
};

const createSession = (userId) => {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, userId);
  return token;
};

const getUserByToken = (token) => {
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.get(userId) || null;
};

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  return next();
};

const adminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
};

const validateSeatIds = (seatIds) => {
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    return 'seatIds must be a non-empty array';
  }
  const invalid = seatIds.find((id) => !getSeatDefinition(id));
  if (invalid) {
    return `Seat ${invalid} does not exist`;
  }
  return null;
};

const isWeekend = (dateStr) => {
  const d = moment(dateStr, 'YYYY-MM-DD');
  const day = d.day(); // 0 Sunday, 6 Saturday
  return day === 0 || day === 6;
};

const isHoliday = (dateStr) => holidays.has(dateStr);

const getWeekType = (dateStr) => {
  const d = moment(dateStr, 'YYYY-MM-DD');
  const isoWeek = d.isoWeek();
  return isoWeek % 2 === 0 ? 'week2' : 'week1';
};

const getDayName = (dateStr) => moment(dateStr, 'YYYY-MM-DD').format('ddd');

const isBatchScheduledOnDate = (batch, dateStr) => {
  const weekType = getWeekType(dateStr);
  const dayName = getDayName(dateStr);
  const schedule = batchSchedule[batch];
  if (!schedule) return false;
  const allowedDays = schedule[weekType] || [];
  return allowedDays.includes(dayName);
};

const getCycleBounds = (dateStr) => {
  const d = moment(dateStr, 'YYYY-MM-DD');
  const isoWeek = d.isoWeek();
  const isWeek1 = isoWeek % 2 === 1;
  const week1Num = isWeek1 ? isoWeek : isoWeek - 1;
  const week2Num = week1Num + 1;

  const start = moment(d).isoWeek(week1Num).startOf('isoWeek');
  const end = moment(d).isoWeek(week2Num).endOf('isoWeek');
  return { start, end };
};

const getAttendanceCountForCycle = (userId, dateStr) => {
  const { start, end } = getCycleBounds(dateStr);
  const days = new Set();
  bookings
    .filter((b) => b.userId === userId)
    .forEach((b) => {
      const d = moment(b.date, 'YYYY-MM-DD');
      if (d.isBetween(start, end, 'day', '[]')) {
        days.add(b.date);
      }
    });
  return days.size;
};

const clearExpiredLocksForDate = (dateStr) => {
  const now = nowTs();
  locks = locks.filter((l) => {
    if (l.date !== dateStr) return true;
    return l.lockExpiry > now;
  });
};

const getSeatStateForDate = (dateStr) => {
  clearExpiredLocksForDate(dateStr);
  const now = nowTs();

  return seatDefinitions.map((def, index) => {
    const booking = bookings.find((b) => b.date === dateStr && b.seatId === def.seatId);
    const lock = locks.find((l) => l.date === dateStr && l.seatId === def.seatId && l.lockExpiry > now);

    let status = 'available';
    let bookedBy = null;
    let lockedBy = null;
    let lockExpiry = null;

    if (booking) {
      status = 'occupied';
      bookedBy = booking.userId;
    } else if (lock) {
      status = 'locked';
      lockedBy = lock.userId;
      lockExpiry = lock.lockExpiry;
    }

    // Derive a row/number purely for UI, 10 seats per row
    const rowIndex = Math.floor(index / 10);
    const row = String.fromCharCode('A'.charCodeAt(0) + rowIndex);
    const number = (index % 10) + 1;

    return {
      seatId: def.seatId,
      row,
      number,
      status,
      bookedBy,
      lockedBy,
      lockExpiry,
      type: def.type,
      assignedTo: def.assignedTo
    };
  });
};

const isUserOnLeave = (userId, dateStr) =>
  leaves.some((l) => l.userId === userId && l.date === dateStr);

const buildPolicySummary = ({ user, dateStr }) => {
  const weekend = isWeekend(dateStr);
  const holiday = isHoliday(dateStr);
  const isWeekendOrHoliday = weekend || holiday;
  const isBatchDay = isBatchScheduledOnDate(user.batch, dateStr);

  const canUseDesignatedToday = isBatchDay;
  const isFloaterOnlyDay = !isBatchDay && !isWeekendOrHoliday;

  const attendanceCount = getAttendanceCountForCycle(user.userId, dateStr);
  const attendanceRequired = 5;

  const onLeave = isUserOnLeave(user.userId, dateStr);
  const warnings = [];
  if (isWeekendOrHoliday) {
    warnings.push('Booking disabled on weekends and holidays.');
  } else if (isFloaterOnlyDay) {
    warnings.push('Your batch is not scheduled today. Only floater seats are allowed.');
  }
  if (attendanceCount < attendanceRequired) {
    warnings.push(
      `You have attended ${attendanceCount} days in this 2-week cycle. Minimum required: ${attendanceRequired}.`
    );
  }

  if (onLeave) {
    warnings.push('You have marked leave for this date. Booking is blocked.');
  }

  return {
    isWeekendOrHoliday,
    isBatchDay,
    canUseDesignatedToday,
    isFloaterOnlyDay,
    attendanceCount,
    attendanceRequired,
    onLeave,
    warnings
  };
};

/* ---------------- POLICY VALIDATION ---------------- */

const validateBookingPolicy = ({ user, dateStr, seatIds }) => {
  const today = moment();
  const bookingDate = moment(dateStr, 'YYYY-MM-DD');

  // 1. Weekend / holiday
  if (isWeekend(dateStr) || isHoliday(dateStr)) {
    return 'Booking is not allowed on weekends or holidays.';
  }

  // 2. Leave status (blocks any booking)
  if (isUserOnLeave(user.userId, dateStr)) {
    return 'You have marked leave for this date. Booking is not allowed.';
  }

  // 3. Batch schedule eligibility
  const isBatchDay = isBatchScheduledOnDate(user.batch, dateStr);

  // 4. Advance booking time (3 PM rule) for "tomorrow" bookings
  if (bookingDate.isSame(today.clone().add(1, 'day'), 'day')) {
    const hour = today.hour();
    if (hour < 15) {
      return 'Advance booking for tomorrow opens after 3 PM today.';
    }
  }

  // 5. Seat ownership (designated vs floater) & cross-batch override
  for (const seatId of seatIds) {
    const def = getSeatDefinition(seatId);
    if (!def) {
      return `Seat ${seatId} does not exist`;
    }

    if (def.type === 'designated') {
      const ownerId = def.assignedTo;
      if (!ownerId) {
        // Unassigned designated seat behaves like floater
        continue;
      }

      const ownerOnLeave = isUserOnLeave(ownerId, dateStr);

      // If owner is on leave for this date, this seat behaves as floater for all users
      if (ownerOnLeave) {
        continue;
      }

      // Owner not on leave: only the owner can book it, and only on their batch days
      if (ownerId !== user.userId) {
        return `Seat ${seatId} is a designated seat and not assigned to you.`;
      }

      if (!isBatchDay) {
        return 'Your designated seat can only be booked on your scheduled batch days.';
      }
    }

    // Floater seats are allowed for anyone; availability and locks are validated later.
  }

  return null;
};

/* ---------------- AUTH ---------------- */

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      batch,
      designatedSeatId
    } = req.body;

    if (!name || !email || !password || !batch) {
      return res.status(400).json({ error: 'name, email, password and batch are required' });
    }

    if (!['batch1', 'batch2'].includes(batch)) {
      return res.status(400).json({ error: 'batch must be "batch1" or "batch2"' });
    }

    if (usersByEmail.has(email)) {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    const userId = createUserId(email);
    const passwordHash = await bcrypt.hash(password, 10);

    let designatedSeat = null;
    if (designatedSeatId != null) {
      const def = getSeatDefinition(Number(designatedSeatId));
      if (!def) {
        return res.status(400).json({ error: 'Invalid designatedSeatId' });
      }
      def.type = 'designated';
      def.assignedTo = userId;
      designatedSeat = def.seatId;
    }

    const user = {
      userId,
      name,
      email,
      passwordHash,
      batch,
      designatedSeatId: designatedSeat,
      floaterLeaveCount: 0,
      isAdmin: false
    };

    users.set(userId, user);
    usersByEmail.set(email, userId);

    const token = createSession(userId);

    return res.json({
      token,
      user: publicUserView(user)
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Signup error', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const userId = usersByEmail.get(email);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users.get(userId);
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = createSession(user.userId);

    return res.json({
      token,
      user: publicUserView(user)
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Current user
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: publicUserView(req.user) });
});

/* ---------------- SEAT QUERIES ---------------- */

// Get seat layout and policy for a specific date and authenticated user
app.get('/api/seats', authMiddleware, (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }

  const user = req.user;

  const seatState = getSeatStateForDate(date);
  const policy = buildPolicySummary({ user, dateStr: date });

  const seatsWithUserFlags = seatState.map((seat) => {
    const isDesignatedSeat = seat.type === 'designated';
    const isUserDesignated =
      isDesignatedSeat && seat.assignedTo && seat.assignedTo === user.userId;

    const ownerOnLeave = seat.assignedTo
      ? isUserOnLeave(seat.assignedTo, date)
      : false;

    // Effective type for this user on this date:
    // if designated owner is on leave, treat as floater for everyone
    const effectiveType =
      isDesignatedSeat && ownerOnLeave ? 'floater' : seat.type;

    return {
      ...seat,
      userId: user.userId,
      isUserDesignatedSeat: isUserDesignated,
      effectiveType
    };
  });

  res.json({
    seats: seatsWithUserFlags,
    policy
  });
});

// User-specific bookings across all dates (authenticated)
app.get('/api/bookings/me', authMiddleware, (req, res) => {
  const userBookings = bookings.filter((b) => b.userId === req.user.userId);
  res.json({ bookings: userBookings });
});

/* ---------------- LEAVE / VACATION ---------------- */

// Mark leave for a specific day
app.post('/api/leave', authMiddleware, (req, res) => {
  const user = req.user;

  const { date } = req.body;
  if (!date) {
    return res.status(400).json({ success: false, message: 'date is required' });
  }

  // If already on leave for that date, do nothing special
  const existing = leaves.find(
    (l) => l.userId === user.userId && l.date === date
  );
  if (!existing) {
    leaves.push({
      userId: user.userId,
      date,
      seatId: user.designatedSeatId || null
    });

    // Increment floater leave counter when a designated user takes leave
    if (user.designatedSeatId) {
      user.floaterLeaveCount = (user.floaterLeaveCount || 0) + 1;
    }
  }

  // Remove any existing booking by the user for that date
  bookings = bookings.filter(
    (b) =>
      !(
        b.userId === user.userId &&
        b.date === date
      )
  );

  return res.json({
    success: true,
    message: 'Leave recorded for this date'
  });
});

/* ---------------- SEAT LOCKING ---------------- */

app.post('/api/lock', authMiddleware, (req, res) => {
  const user = req.user;

  const { date, seatIds } = req.body;
  if (!date) {
    return res.status(400).json({ success: false, message: 'date is required', bookedSeats: [] });
  }

  const validationError = validateSeatIds(seatIds);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError, bookedSeats: [] });
  }

  // Apply similar policy as booking, but without the 3 PM rule.
  if (isWeekend(date) || isHoliday(date)) {
    return res.status(400).json({
      success: false,
      message: 'Locking is not allowed on weekends or holidays.',
      bookedSeats: []
    });
  }

  // Basic seat ownership and leave logic: reuse validateBookingPolicy without 3PM rule
  const policyError = validateBookingPolicy({ user, dateStr: date, seatIds });
  if (policyError) {
    return res.status(400).json({
      success: false,
      message: policyError,
      bookedSeats: []
    });
  }

  clearExpiredLocksForDate(date);

  // Availability and locking checks (per-date)
  const now = nowTs();
  const lockExpiry = now + LOCK_DURATION_MS;

  for (const seatId of seatIds) {
    const booking = bookings.find((b) => b.date === date && b.seatId === seatId);
    if (booking) {
      return res.status(400).json({
        success: false,
        message: `Seat ${seatId} is already booked`,
        bookedSeats: []
      });
    }

    const existingLock = locks.find((l) => l.date === date && l.seatId === seatId);
    if (existingLock && existingLock.userId !== user.userId && existingLock.lockExpiry > now) {
      return res.status(400).json({
        success: false,
        message: `Seat ${seatId} is locked by another user`,
        bookedSeats: []
      });
    }
  }

  seatIds.forEach((seatId) => {
    const existingLockIndex = locks.findIndex(
      (l) => l.date === date && l.seatId === seatId && l.userId === user.userId
    );
    const newLock = {
      date,
      seatId,
      userId: user.userId,
      lockExpiry
    };
    if (existingLockIndex >= 0) {
      locks[existingLockIndex] = newLock;
    } else {
      locks.push(newLock);
    }
  });

  return res.json({
    success: true,
    message: 'Seats locked',
    bookedSeats: []
  });
});

app.post('/api/unlock', authMiddleware, (req, res) => {
  const user = req.user;

  const { date, seatIds } = req.body;
  if (!date) {
    return res.status(400).json({ success: false, message: 'date is required' });
  }

  const validationError = validateSeatIds(seatIds);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  locks = locks.filter(
    (l) =>
      !(
        l.date === date &&
        seatIds.includes(l.seatId) &&
        l.userId === user.userId
      )
  );

  return res.json({ success: true, message: 'Seats unlocked' });
});

/* ---------------- BOOKING (ATOMIC) ---------------- */

app.post('/api/book', authMiddleware, (req, res) => {
  const user = req.user;

  const { date, seatIds } = req.body;
  if (!date) {
    return res.status(400).json({ success: false, message: 'date is required', bookedSeats: [] });
  }

  const validationError = validateSeatIds(seatIds);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError, bookedSeats: [] });
  }

  if (seatIds.length > MAX_SEATS_PER_BOOKING) {
    return res.status(400).json({
      success: false,
      message: `You can book a maximum of ${MAX_SEATS_PER_BOOKING} seats per booking`,
      bookedSeats: []
    });
  }

  // Higher-level policy validation (weekend/holiday, leave status, batch schedule, 3PM rule, seat ownership)
  const policyError = validateBookingPolicy({ user, dateStr: date, seatIds });
  if (policyError) {
    return res.status(400).json({
      success: false,
      message: policyError,
      bookedSeats: []
    });
  }

  // Availability and locking (atomic)
  clearExpiredLocksForDate(date);
  const now = nowTs();

  for (const seatId of seatIds) {
    const booking = bookings.find((b) => b.date === date && b.seatId === seatId);
    if (booking) {
      return res.status(400).json({
        success: false,
        message: `Seat ${seatId} is already booked`,
        bookedSeats: []
      });
    }

    const lock = locks.find((l) => l.date === date && l.seatId === seatId);
    if (lock) {
      if (lock.userId !== user.userId && lock.lockExpiry > now) {
        return res.status(400).json({
          success: false,
          message: `Seat ${seatId} is locked by another user`,
          bookedSeats: []
        });
      }
      if (lock.lockExpiry <= now) {
        return res.status(400).json({
          success: false,
          message: `Lock for seat ${seatId} has expired`,
          bookedSeats: []
        });
      }
    }
  }

  // If all checks pass, perform atomic booking
  const bookedAt = new Date().toISOString();
  const newBookings = [];

  seatIds.forEach((seatId) => {
    bookings.push({
      date,
      seatId,
      userId: user.userId,
      bookedAt
    });
    newBookings.push({
      seatId
    });

    // Remove any locks on this seat/date
    locks = locks.filter(
      (l) => !(l.date === date && l.seatId === seatId)
    );
  });

  return res.json({
    success: true,
    message: 'Booking successful',
    bookedSeats: newBookings
  });
});

/* ---------------- CANCELLATION ---------------- */

app.post('/api/cancel', authMiddleware, (req, res) => {
  const user = req.user;

  const { date, seatIds } = req.body;
  if (!date) {
    return res.status(400).json({ success: false, message: 'date is required' });
  }

  const validationError = validateSeatIds(seatIds);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const invalidSeat = seatIds.find((seatId) => {
    const booking = bookings.find(
      (b) => b.date === date && b.seatId === seatId && b.userId === user.userId
    );
    return !booking;
  });

  if (invalidSeat) {
    return res.status(400).json({
      success: false,
      message: `You can only cancel your own booked seats for the given date. Problem with seat ${invalidSeat}`
    });
  }

  bookings = bookings.filter(
    (b) =>
      !(
        b.date === date &&
        seatIds.includes(b.seatId) &&
        b.userId === user.userId
      )
  );

  // Clear any associated locks as well
  locks = locks.filter(
    (l) =>
      !(
        l.date === date &&
        seatIds.includes(l.seatId) &&
        l.userId === user.userId
      )
  );

  return res.json({
    success: true,
    message: 'Booking cancelled'
  });
});

/* ---------------- USER BATCH SWITCHING ---------------- */

app.patch('/api/user/batch', authMiddleware, (req, res) => {
  const user = req.user;
  const { newBatch, date } = req.body;

  if (!newBatch || !['batch1', 'batch2'].includes(newBatch)) {
    return res.status(400).json({ error: 'newBatch must be "batch1" or "batch2"' });
  }

  const targetDate = date || moment().format('YYYY-MM-DD');

  const activeBookingToday = bookings.some(
    (b) => b.userId === user.userId && b.date === targetDate
  );
  if (activeBookingToday) {
    return res.status(400).json({
      error: 'Cannot switch batch while you have an active booking for this date'
    });
  }

  user.batch = newBatch;
  return res.json({ user: publicUserView(user) });
});

/* ---------------- ADMIN APIS ---------------- */

// Reset all dynamic state and restore default layout
app.post('/api/admin/reset', authMiddleware, adminMiddleware, (req, res) => {
  initSeatDefinitions();
  bookings = [];
  locks = [];
  leaves = [];
  batchSchedule = { ...DEFAULT_BATCH_SCHEDULE };
  holidays = new Set();
  res.json({ success: true, message: 'System reset to default configuration' });
});

// View all bookings (history)
app.get('/api/admin/bookings', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ bookings });
});

// Force cancel a specific seat booking on a given date
app.post('/api/admin/force-cancel', authMiddleware, adminMiddleware, (req, res) => {
  const { date, seatId } = req.body;
  if (!date || !seatId) {
    return res
      .status(400)
      .json({ success: false, message: 'date and seatId are required' });
  }

  bookings = bookings.filter(
    (b) => !(b.date === date && b.seatId === seatId)
  );
  locks = locks.filter(
    (l) => !(l.date === date && l.seatId === seatId)
  );

  return res.json({ success: true, message: `Seat ${seatId} booking cleared for ${date}` });
});

// Modify batch rotation schedule
app.post('/api/admin/batch-schedule', authMiddleware, adminMiddleware, (req, res) => {
  const { schedule } = req.body;
  if (!schedule) {
    return res
      .status(400)
      .json({ success: false, message: 'schedule is required' });
  }
  batchSchedule = schedule;
  return res.json({ success: true, message: 'Batch schedule updated' });
});

// Convert seat type designated <-> floater
app.post('/api/admin/seat-type', authMiddleware, adminMiddleware, (req, res) => {
  const { seatId, type } = req.body;
  if (!seatId || !type) {
    return res
      .status(400)
      .json({ success: false, message: 'seatId and type are required' });
  }
  if (!['designated', 'floater'].includes(type)) {
    return res
      .status(400)
      .json({ success: false, message: 'type must be "designated" or "floater"' });
  }

  const def = getSeatDefinition(seatId);
  if (!def) {
    return res.status(404).json({ success: false, message: 'Seat not found' });
  }

  def.type = type;
  if (type === 'floater') {
    def.assignedTo = null;
  }

  return res.json({ success: true, message: `Seat ${seatId} converted to ${type}` });
});

// Assign designated seats
app.post('/api/admin/assign-seat', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, seatId } = req.body;
  if (!userId || !seatId) {
    return res.status(400).json({
      success: false,
      message: 'userId and seatId are required'
    });
  }

  const def = getSeatDefinition(seatId);
  if (!def) {
    return res.status(404).json({ success: false, message: 'Seat not found' });
  }

  const user = users.get(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  def.type = 'designated';
  def.assignedTo = userId;

  user.designatedSeatId = seatId;

  return res.json({
    success: true,
    message: `Seat ${seatId} assigned as designated seat to ${userId}`
  });
});

// Mark or unmark holidays
app.post('/api/admin/holidays', authMiddleware, adminMiddleware, (req, res) => {
  const { date, isHoliday: markHoliday } = req.body;
  if (!date) {
    return res
      .status(400)
      .json({ success: false, message: 'date is required' });
  }

  if (markHoliday === false) {
    holidays.delete(date);
  } else {
    holidays.add(date);
  }

  return res.json({ success: true, message: 'Holiday configuration updated' });
});

// Leave statistics and floater usage
app.get('/api/admin/leaves', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ leaves });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const allUsers = Array.from(users.values()).map(publicUserView);
  res.json({ users: allUsers });
});

/* ---------------- START SERVER ---------------- */

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));