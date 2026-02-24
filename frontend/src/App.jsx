import React, { useState, useEffect, useMemo } from 'react';
import SeatGrid from './components/SeatGrid';
import {
  signup,
  login,
  fetchMe,
  fetchSeats,
  lockSeats,
  unlockSeats,
  bookSeats,
  cancelSeats,
  fetchUserBookings,
  markLeave,
  adminGetUsers,
  adminGetLeaves
} from './api/seats';

const POLL_INTERVAL_MS = 5000;
const todayIso = new Date().toISOString().slice(0, 10);

const App = () => {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    password: '',
    batch: 'batch1'
  });

  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [seats, setSeats] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState([]);
  const [isLoadingSeats, setIsLoadingSeats] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [toast, setToast] = useState(null);
  const [bookingHistory, setBookingHistory] = useState([]);
  const [isMarkingLeave, setIsMarkingLeave] = useState(false);
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLeaves, setAdminLeaves] = useState([]);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const loadMe = async () => {
    try {
      const data = await fetchMe();
      setUser(data.user);
    } catch {
      setUser(null);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    try {
      if (authMode === 'signup') {
        const res = await signup({
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
          batch: authForm.batch
        });
        window.localStorage.setItem('seatAppToken', res.token);
        setUser(res.user);
        showToast('success', 'Signup successful');
      } else {
        const res = await login({
          email: authForm.email,
          password: authForm.password
        });
        window.localStorage.setItem('seatAppToken', res.token);
        setUser(res.user);
        showToast('success', 'Logged in');
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Authentication failed';
      showToast('error', message);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem('seatAppToken');
    setUser(null);
    setSeats([]);
    setBookingHistory([]);
    setPolicy(null);
    setSelectedSeatIds([]);
  };

  const loadSeats = async () => {
    if (!user) return;
    try {
      setIsLoadingSeats(true);
      const data = await fetchSeats({
        date: selectedDate
      });
      const allSeats = data.seats || [];
      setSeats(allSeats);
      setPolicy(data.policy || null);

      // keep only seats still locked by current user and not yet occupied
      setSelectedSeatIds((prev) =>
        prev.filter((id) => {
          const seat = allSeats.find((s) => s.seatId === id);
          return seat && seat.status === 'locked' && seat.lockedBy === user.userId;
        })
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to load seats', err);
      showToast('error', 'Failed to load seats');
    } finally {
      setIsLoadingSeats(false);
    }
  };

  const loadHistory = async () => {
    if (!user) return;
    try {
      const data = await fetchUserBookings();
      setBookingHistory(data.bookings || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to load booking history', err);
    }
  };

  const loadAdminData = async () => {
    if (!user?.isAdmin) return;
    try {
      const [usersRes, leavesRes] = await Promise.all([adminGetUsers(), adminGetLeaves()]);
      setAdminUsers(usersRes.users || []);
      setAdminLeaves(leavesRes.leaves || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to load admin data', err);
    }
  };

  useEffect(() => {
    const token = window.localStorage.getItem('seatAppToken');
    if (token) {
      loadMe();
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadSeats();
    loadHistory();
    loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedDate]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (!isMutating) {
        loadSeats();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isMutating, selectedDate, user]);

  const myCurrentSeatsForDay = useMemo(
    () => seats.filter((s) => s.bookedBy === user?.userId),
    [seats, user]
  );

  const handleSeatClick = async (seat) => {
    if (!user) return;
    if (seat.status === 'occupied' && seat.bookedBy !== user.userId) {
      return;
    }
    if (seat.status === 'locked' && seat.lockedBy && seat.lockedBy !== user.userId) {
      return;
    }

    const isSelected = selectedSeatIds.includes(seat.seatId);

    try {
      setIsMutating(true);

      if (isSelected) {
        await unlockSeats({
          date: selectedDate,
          seatIds: [seat.seatId]
        });
        setSelectedSeatIds((prev) => prev.filter((id) => id !== seat.seatId));
      } else {
        const nextSelectedCount = selectedSeatIds.length + 1;
        if (nextSelectedCount > 5) {
          showToast('error', 'You can select a maximum of 5 seats');
          return;
        }

        const res = await lockSeats({
          date: selectedDate,
          seatIds: [seat.seatId]
        });
        if (!res.success) {
          showToast('error', res.message || 'Failed to lock seat');
        } else {
          setSelectedSeatIds((prev) => [...prev, seat.seatId]);
        }
      }

      await loadSeats();
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Seat action failed';
      showToast('error', message);
      await loadSeats();
    } finally {
      setIsMutating(false);
    }
  };

  const handleConfirmBooking = async () => {
    if (!selectedSeatIds.length || !user) return;

    try {
      setIsBooking(true);
      setIsMutating(true);

      const res = await bookSeats({
        date: selectedDate,
        seatIds: selectedSeatIds
      });
      if (!res.success) {
        showToast('error', res.message || 'Booking failed');
      } else {
        showToast('success', res.message || 'Booking successful');
        setSelectedSeatIds([]);
        await loadHistory();
      }

      await loadSeats();
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Booking failed';
      showToast('error', message);
      await loadSeats();
    } finally {
      setIsBooking(false);
      setIsMutating(false);
    }
  };

  const handleCancelSeat = async (seatId) => {
    if (!user) return;
    try {
      setIsMutating(true);
      const res = await cancelSeats({
        date: selectedDate,
        seatIds: [seatId]
      });
      if (!res.success) {
        showToast('error', res.message || 'Cancellation failed');
      } else {
        showToast('success', 'Seat cancelled');
      }
      await loadSeats();
      await loadHistory();
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Cancellation failed';
      showToast('error', message);
      await loadSeats();
    } finally {
      setIsMutating(false);
    }
  };

  const handleMarkLeave = async () => {
    if (!user) return;
    try {
      setIsMarkingLeave(true);
      const res = await markLeave({
        date: selectedDate
      });
      if (!res.success) {
        showToast('error', res.message || 'Failed to mark leave');
      } else {
        showToast('success', res.message || 'Leave marked');
        await loadSeats();
        await loadMe();
        await loadAdminData();
      }
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Failed to mark leave';
      showToast('error', message);
    } finally {
      setIsMarkingLeave(false);
    }
  };

  const handleBatchChange = async (e) => {
    const newBatch = e.target.value;
    if (!user || newBatch === user.batch) return;
    try {
      setIsBatchUpdating(true);
      const res = await fetch('/api/user/batch', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${window.localStorage.getItem('seatAppToken') || ''}`
        },
        body: JSON.stringify({ newBatch })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Batch update failed');
      }
      const body = await res.json();
      setUser(body.user);
      showToast('success', 'Batch updated');
      await loadSeats();
      await loadAdminData();
    } catch (err) {
      showToast('error', err.message || 'Batch update failed');
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const isConfirmDisabled =
    !selectedSeatIds.length ||
    isBooking ||
    isLoadingSeats ||
    (policy && (policy.isWeekendOrHoliday || policy.onLeave));

  const attendanceText =
    policy && typeof policy.attendanceCount === 'number'
      ? `${policy.attendanceCount} / ${policy.attendanceRequired}`
      : '—';

  const batchLabel = user?.batch === 'batch1' ? 'Batch 1' : 'Batch 2';

  const allowedTodayText = policy
    ? policy.isWeekendOrHoliday
      ? 'Office closed (weekend / holiday)'
      : policy.onLeave
        ? 'You are on leave for this date'
        : policy.isBatchDay
          ? 'You are scheduled to come today'
          : 'Not your batch day (floater only)'
    : '';

  const allowedTodayToneClass = policy
    ? policy.isWeekendOrHoliday
      ? 'bg-rose-500/10 text-rose-200 border-rose-500/40'
      : policy.onLeave
        ? 'bg-rose-500/10 text-rose-200 border-rose-500/40'
        : policy.isBatchDay
          ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/40'
          : 'bg-amber-500/10 text-amber-100 border-amber-500/40'
    : 'bg-slate-800 text-slate-200 border-slate-700';

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-slate-900/70 border border-slate-800 rounded-3xl p-8 shadow-xl space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Seat Booking</h1>
            <button
              type="button"
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="text-xs text-sky-300 hover:text-sky-200"
            >
              {authMode === 'login' ? 'Need an account?' : 'Already have an account?'}
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4 text-xs">
            {authMode === 'signup' && (
              <>
                <div className="space-y-1">
                  <label className="block text-slate-300">Name</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800"
                    value={authForm.name}
                    onChange={(e) => setAuthForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="block text-slate-300">Email</label>
              <input
                type="email"
                className="w-full px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800"
                value={authForm.email}
                onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-300">Password</label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800"
                value={authForm.password}
                onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
            </div>

            {authMode === 'signup' && (
              <div className="space-y-1">
                <label className="block text-slate-300">Batch</label>
                <select
                  className="w-full px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800"
                  value={authForm.batch}
                  onChange={(e) => setAuthForm((f) => ({ ...f, batch: e.target.value }))}
                >
                  <option value="batch1">Batch 1</option>
                  <option value="batch2">Batch 2</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              className="w-full mt-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-semibold"
            >
              {authMode === 'login' ? 'Login' : 'Sign up'}
            </button>
          </form>
        </div>

        {toast && (
          <div className="fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-lg text-sm border border-slate-800 bg-slate-900/90">
            <div
              className={`font-semibold mb-1 ${
                toast.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {toast.type === 'success' ? 'Success' : 'Error'}
            </div>
            <div className="text-slate-200">{toast.message}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-80 space-y-6">
          <div className="bg-slate-900/60 backdrop-blur p-6 rounded-3xl shadow border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold">Workspace Policy</h1>
                <p className="text-xs text-slate-400 mt-1">
                  {user.name || user.email}{' '}
                  <span className="text-slate-500">·</span>{' '}
                  <span className="font-semibold">{batchLabel}</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Floater leave count:{' '}
                  <span className="font-semibold">{user.floaterLeaveCount ?? 0}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                Logout
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-[11px] text-slate-400 uppercase tracking-wide">
                Booking date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full mt-1 p-2.5 rounded-xl bg-slate-950/40 border border-slate-800 text-xs"
              />
            </div>

            <div
              className={`text-xs border rounded-2xl px-3 py-2.5 flex flex-col gap-1 ${allowedTodayToneClass}`}
            >
              <span className="font-semibold">Allowed to come today?</span>
              <span>{allowedTodayText}</span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>2-week attendance</span>
              <span className="font-semibold">{attendanceText}</span>
            </div>

            {policy?.warnings?.length ? (
              <div className="border border-amber-500/40 bg-amber-500/10 rounded-2xl px-3 py-2.5 text-[11px] text-amber-100 space-y-1">
                {policy.warnings.map((w) => (
                  <div key={w}>• {w}</div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-300">Switch batch</span>
              <select
                value={user.batch}
                onChange={handleBatchChange}
                disabled={isBatchUpdating}
                className="px-2 py-1 rounded-lg bg-slate-950/50 border border-slate-700 text-[11px]"
              >
                <option value="batch1">Batch 1</option>
                <option value="batch2">Batch 2</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleMarkLeave}
              disabled={isMarkingLeave}
              className={`w-full text-xs mt-1 rounded-xl px-3 py-2 border ${
                isMarkingLeave
                  ? 'border-slate-700 text-slate-400 cursor-not-allowed'
                  : 'border-sky-500/60 text-sky-200 hover:bg-sky-500/10'
              }`}
            >
              {isMarkingLeave ? 'Saving leave…' : 'Mark leave for this date'}
            </button>

            {user.isAdmin && (
              <div className="mt-2 border border-indigo-500/40 bg-indigo-500/10 rounded-2xl px-3 py-2.5 text-[11px] space-y-1">
                <div className="font-semibold text-indigo-200 mb-1">Admin</div>
                <div className="text-slate-200">
                  Users with designated seats:{' '}
                  {adminUsers.filter((u) => u.designatedSeatId != null).length}
                </div>
                <div className="text-slate-200">
                  Total leaves recorded:{' '}
                  {adminLeaves.length}
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-900/60 backdrop-blur p-6 rounded-3xl shadow border border-slate-800">
            <h2 className="text-sm font-semibold mb-3">My bookings on this day</h2>
            {myCurrentSeatsForDay.length === 0 ? (
              <p className="text-xs text-slate-400">You have no active bookings.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {myCurrentSeatsForDay.map((seat) => (
                  <li key={seat.seatId} className="flex items-center justify-between">
                    <span>
                      Seat{' '}
                      <span className="font-semibold">
                        {seat.row}
                        {seat.number}
                      </span>{' '}
                      <span className="text-[10px] text-slate-400">
                        ({seat.effectiveType === 'floater' ? 'Floater' : 'Designated'})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCancelSeat(seat.seatId)}
                      className="text-[11px] text-rose-300 hover:text-rose-200"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-slate-900/60 backdrop-blur p-6 rounded-3xl shadow border border-slate-800">
            <h2 className="text-sm font-semibold mb-3">Booking history</h2>
            {bookingHistory.length === 0 ? (
              <p className="text-xs text-slate-400">No bookings yet.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto pr-1 text-xs space-y-1">
                {bookingHistory
                  .slice()
                  .reverse()
                  .map((b, index) => (
                    <div key={`${b.seatId}-${b.bookedAt}-${index}`} className="flex justify-between">
                      <span>
                        Seat <span className="font-semibold">{b.seatId}</span>
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(b.bookedAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 bg-slate-900/60 backdrop-blur p-8 rounded-3xl shadow border border-slate-800 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold">Seat map</h2>
              <p className="text-xs text-slate-400 mt-1">
                Select up to 5 seats. Selection locks a seat for 2 minutes.
              </p>
            </div>
            <button
              type="button"
              onClick={handleConfirmBooking}
              disabled={isConfirmDisabled}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                isConfirmDisabled
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900'
              }`}
            >
              {isBooking ? 'Booking...' : `Confirm (${selectedSeatIds.length})`}
            </button>
          </div>

          <div className="mb-4 text-[11px] text-slate-300 flex flex-wrap gap-3">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-emerald-500/70" /> Available (designated)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-emerald-300/80" /> Available (floater)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-sky-500" /> Selected / locked by me
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-indigo-500" /> My booked seat
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-slate-600" /> Occupied
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-amber-500" /> Locked by others
            </span>
          </div>

          <div className="flex-1 relative">
            {isLoadingSeats && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 z-10">
                <div className="text-xs text-slate-300">Loading seats...</div>
              </div>
            )}
            <SeatGrid
              seats={seats}
              currentUserId={user.userId}
              selectedSeatIds={selectedSeatIds}
              onSeatClick={handleSeatClick}
            />
          </div>
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-lg text-sm border border-slate-800 bg-slate-900/90">
          <div
            className={`font-semibold mb-1 ${
              toast.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {toast.type === 'success' ? 'Success' : 'Error'}
          </div>
          <div className="text-slate-200">{toast.message}</div>
        </div>
      )}
    </div>
  );
};

export default App;