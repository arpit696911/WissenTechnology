import apiClient from './client';

export const signup = async (payload) => {
  const res = await apiClient.post('/signup', payload);
  return res.data;
};

export const login = async (payload) => {
  const res = await apiClient.post('/login', payload);
  return res.data;
};

export const fetchMe = async () => {
  const res = await apiClient.get('/me');
  return res.data;
};

export const fetchSeats = async ({ date }) => {
  const res = await apiClient.get('/seats', {
    params: {
      date
    }
  });
  return res.data;
};

export const lockSeats = async ({ date, seatIds }) => {
  const res = await apiClient.post('/lock', {
    date,
    seatIds
  });
  return res.data;
};

export const unlockSeats = async ({ date, seatIds }) => {
  const res = await apiClient.post('/unlock', {
    date,
    seatIds
  });
  return res.data;
};

export const bookSeats = async ({ date, seatIds }) => {
  const res = await apiClient.post('/book', {
    date,
    seatIds
  });
  return res.data;
};

export const cancelSeats = async ({ date, seatIds }) => {
  const res = await apiClient.post('/cancel', {
    date,
    seatIds
  });
  return res.data;
};

export const fetchUserBookings = async () => {
  const res = await apiClient.get('/bookings/me');
  return res.data;
};

export const markLeave = async ({ date }) => {
  const res = await apiClient.post('/leave', {
    date
  });
  return res.data;
};

// Admin APIs
export const adminResetSeats = async () => {
  const res = await apiClient.post('/admin/reset');
  return res.data;
};

export const adminGetAllBookings = async () => {
  const res = await apiClient.get('/admin/bookings');
  return res.data;
};

export const adminForceCancelSeat = async ({ date, seatId }) => {
  const res = await apiClient.post('/admin/force-cancel', { date, seatId });
  return res.data;
};

export const adminUpdateBatchSchedule = async (schedule) => {
  const res = await apiClient.post('/admin/batch-schedule', { schedule });
  return res.data;
};

export const adminUpdateSeatType = async ({ seatId, type }) => {
  const res = await apiClient.post('/admin/seat-type', { seatId, type });
  return res.data;
};

export const adminAssignSeat = async ({ userId, seatId }) => {
  const res = await apiClient.post('/admin/assign-seat', { userId, seatId });
  return res.data;
};

export const adminMarkHoliday = async ({ date, isHoliday }) => {
  const res = await apiClient.post('/admin/holidays', { date, isHoliday });
  return res.data;
};

export const adminGetLeaves = async () => {
  const res = await apiClient.get('/admin/leaves');
  return res.data;
};

export const adminGetUsers = async () => {
  const res = await apiClient.get('/admin/users');
  return res.data;
};

