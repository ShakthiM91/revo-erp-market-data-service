/**
 * CSE market hours: Mon-Fri 10:30-14:30 Asia/Colombo (GMT+5:30)
 * Returns TTL in seconds for Redis cache:
 * - Market open: 3600 (1 hour)
 * - Market closed: seconds until next market open
 */
function isMarketOpen() {
  const now = new Date();
  const colombo = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
  const day = colombo.getDay();
  const hour = colombo.getHours();
  const min = colombo.getMinutes();
  const totalMins = hour * 60 + min;

  if (day === 0 || day === 6) return false;
  const openMins = 10 * 60 + 30;
  const closeMins = 14 * 60 + 30;
  return totalMins >= openMins && totalMins < closeMins;
}

function getCacheTTL() {
  if (isMarketOpen()) return 3600;

  const now = new Date();
  const colombo = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
  const day = colombo.getDay();
  const hour = colombo.getHours();
  const min = colombo.getMinutes();
  const totalMins = hour * 60 + min;

  const openMins = 10 * 60 + 30;
  let minsUntilOpen = 0;

  if (day === 0) {
    minsUntilOpen = 24 * 60 - totalMins + (24 * 60) + openMins;
  } else if (day === 6) {
    minsUntilOpen = 24 * 60 - totalMins + openMins;
  } else if (totalMins < openMins) {
    minsUntilOpen = openMins - totalMins;
  } else {
    minsUntilOpen = 24 * 60 - totalMins + (24 * 60) + openMins;
  }

  return Math.max(3600, minsUntilOpen * 60);
}

module.exports = { isMarketOpen, getCacheTTL };
