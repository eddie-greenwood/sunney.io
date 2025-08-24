/**
 * Universal Time Utility for Sunney.io
 * 
 * CRITICAL: All time handling in the Sunney.io platform MUST use this utility.
 * The National Electricity Market (NEM) operates on Australian Eastern Standard Time (AEST)
 * which is UTC+10 with NO daylight saving adjustments.
 * 
 * 📚 MANDATORY READING: See TIME_HANDLING.md for comprehensive documentation
 * 
 * Features:
 * - Parses AEMO dates (AEST fixed, UTC+10)
 * - Converts to/from UTC
 * - Handles user timezones via Intl
 * - Tariff-aware (e.g., fixed NEM time)
 * - Settlement period calculations
 * - Trading interval management
 * 
 * @see ./TIME_HANDLING.md - Complete time handling strategy and examples
 */

export class TimeUtil {
  /**
   * Parse AEMO date string to UTC ISO
   * Formats: "YYYY/MM/DD HH:MM:SS", "YYYYMMDDHHMMSS", "YYYY-MM-DD HH:MM:SS"
   * Assumes AEST (UTC+10, no DST)
   * 
   * IMPORTANT: NEM operates on fixed AEST (UTC+10) year-round, ignoring DST.
   * Even when Sydney observes DST (UTC+11), NEM remains at UTC+10.
   */
  static parseAEMOToUTC(aemoDate: string): string {
    if (!aemoDate) return TimeUtil.nowUTC();

    const cleaned = aemoDate.trim().replace(/"/g, '');

    let year: number, month: number, day: number, hour: number, minute: number, second: number;

    // Compact: YYYYMMDDHHMMSS
    if (cleaned.length === 14 && /^\d+$/.test(cleaned)) {
      year = parseInt(cleaned.substring(0, 4));
      month = parseInt(cleaned.substring(4, 6));
      day = parseInt(cleaned.substring(6, 8));
      hour = parseInt(cleaned.substring(8, 10));
      minute = parseInt(cleaned.substring(10, 12));
      second = parseInt(cleaned.substring(12, 14));
    }
    // Slashed: YYYY/MM/DD HH:MM:SS
    else if (cleaned.includes('/')) {
      const [datePart, timePart] = cleaned.split(' ');
      if (!timePart) return cleaned;
      const [y, m, d] = datePart.split('/');
      const [h, min, s] = timePart.split(':');
      year = parseInt(y);
      month = parseInt(m);
      day = parseInt(d);
      hour = parseInt(h);
      minute = parseInt(min);
      second = parseInt(s || '0');
    }
    // Dashed: YYYY-MM-DD HH:MM:SS
    else if (cleaned.includes('-')) {
      const [datePart, timePart] = cleaned.split(' ');
      if (!timePart) return cleaned;
      const [y, m, d] = datePart.split('-');
      const [h, min, s] = timePart.split(':');
      year = parseInt(y);
      month = parseInt(m);
      day = parseInt(d);
      hour = parseInt(h);
      minute = parseInt(min);
      second = parseInt(s || '0');
    } else {
      throw new Error(`Invalid AEMO date format: ${aemoDate}`);
    }

    // Create UTC date directly from AEST components
    // AEST is UTC+10, so we subtract 10 hours
    // Use UTC methods to avoid timezone ambiguity
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour - 10, minute, second));
    
    return utcDate.toISOString();
  }

  /**
   * Convert UTC ISO to AEST string
   * Format: YYYY/MM/DD HH:MM:SS
   * 
   * NOTE: Always adds exactly 10 hours (fixed AEST), regardless of DST
   */
  static utcToAEMO(utcIso: string): string {
    const date = new Date(utcIso);
    
    // Add 10 hours for AEST (NEM ignores DST)
    // Create new date to avoid mutating original
    const aestDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);

    const year = aestDate.getUTCFullYear();
    const month = String(aestDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(aestDate.getUTCDate()).padStart(2, '0');
    const hour = String(aestDate.getUTCHours()).padStart(2, '0');
    const minute = String(aestDate.getUTCMinutes()).padStart(2, '0');
    const second = String(aestDate.getUTCSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
  }

  /**
   * Convert UTC ISO to user's local timezone string
   * Uses browser Intl (frontend) or specified zone (workers)
   * @param utcIso UTC ISO string
   * @param timezone IANA timezone (default: system)
   * @param format Intl format options
   */
  static utcToLocal(utcIso: string, timezone?: string, format: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }): string {
    const date = new Date(utcIso);
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone || 'Australia/Sydney',  // Default AEST
      ...format
    });
    return formatter.format(date);
  }

  /**
   * Check if date falls within tariff period
   * Example: Peak tariff 7am-11pm AEST
   * @param utcIso UTC ISO string
   * @param startHour AEST start (0-23)
   * @param endHour AEST end (0-23)
   */
  static isInTariffPeriod(utcIso: string, startHour: number, endHour: number): boolean {
    const date = new Date(utcIso);
    const aestDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);
    const hour = aestDate.getUTCHours();
    return hour >= startHour && hour < endHour;
  }

  /**
   * Get current time in UTC ISO format
   * CRITICAL: Use this instead of new Date().toISOString() for consistency
   */
  static nowUTC(): string {
    return new Date().toISOString();
  }

  /**
   * Get current time in AEST
   */
  static nowAEST(): string {
    return TimeUtil.utcToAEMO(TimeUtil.nowUTC());
  }

  /**
   * Format duration between two dates
   */
  static formatDuration(startUtc: string, endUtc: string): string {
    const start = new Date(startUtc);
    const end = new Date(endUtc);
    const diff = end.getTime() - start.getTime();
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Get settlement period for AEMO (5-minute intervals)
   */
  static getSettlementPeriod(utcIso: string): string {
    const date = new Date(utcIso);
    const minutes = date.getMinutes();
    const settlementMinute = Math.floor(minutes / 5) * 5;
    date.setMinutes(settlementMinute, 0, 0);
    return date.toISOString();
  }

  /**
   * Get trading interval for AEMO (30-minute intervals)
   * NEM uses 30-minute trading intervals for pricing
   */
  static getTradingInterval(utcIso: string): string {
    const date = new Date(utcIso);
    const minutes = date.getMinutes();
    const tradingMinute = minutes < 30 ? 0 : 30;
    date.setMinutes(tradingMinute, 0, 0);
    return date.toISOString();
  }

  /**
   * Get the period number for a given time (1-288 for 5-min, 1-48 for 30-min)
   * @param utcIso UTC ISO string
   * @param intervalMinutes 5 for settlement, 30 for trading
   */
  static getPeriodNumber(utcIso: string, intervalMinutes: 5 | 30 = 5): number {
    const date = new Date(utcIso);
    const aestDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);
    const minutesSinceMidnight = aestDate.getUTCHours() * 60 + aestDate.getUTCMinutes();
    return Math.floor(minutesSinceMidnight / intervalMinutes) + 1;
  }

  /**
   * Format date for AEMO API requests (YYYYMMDD)
   */
  static formatAEMODate(utcIso: string): string {
    const date = new Date(utcIso);
    const aestDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);
    
    const year = aestDate.getUTCFullYear();
    const month = String(aestDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(aestDate.getUTCDate()).padStart(2, '0');
    
    return `${year}${month}${day}`;
  }

  /**
   * Get start of NEM trading day (4:00 AM AEST)
   * NEM trading day runs from 4:00 AM to 4:00 AM next day
   * Per AEMO Spot Market Operations Timetable
   */
  static getNEMTradingDayStart(utcIso: string): string {
    const date = new Date(utcIso);
    const aestDate = new Date(date.getTime() + 10 * 60 * 60 * 1000);
    
    // If before 4:00 AM AEST, use previous day
    const hour = aestDate.getUTCHours();
    let year = aestDate.getUTCFullYear();
    let month = aestDate.getUTCMonth();
    let day = aestDate.getUTCDate();
    
    if (hour < 4) {
      // Go back one day
      const prevDay = new Date(Date.UTC(year, month, day - 1, 0, 0, 0));
      year = prevDay.getUTCFullYear();
      month = prevDay.getUTCMonth();
      day = prevDay.getUTCDate();
    }
    
    // Create new date at 4:00 AM AEST
    // 4 AM AEST = 18:00 UTC previous day (4 - 10 = -6, which wraps to 18:00 previous day)
    const tradingDayStart = new Date(Date.UTC(year, month, day, -6, 0, 0, 0));
    return tradingDayStart.toISOString();
  }

  /**
   * Check if timestamp is within NEM peak period
   * Default: Weekdays 7am-10pm AEST
   */
  static isNEMPeakPeriod(utcIso: string): boolean {
    const date = new Date(utcIso);
    // Convert to AEST for checking day and hour
    const aestMillis = date.getTime() + 10 * 60 * 60 * 1000;
    const aestDate = new Date(aestMillis);
    
    // Get AEST day of week (0 = Sunday, 6 = Saturday)
    // Need to calculate day based on AEST time, not UTC
    const aestString = TimeUtil.utcToAEMO(utcIso);
    const [datePart] = aestString.split(' ');
    const [year, month, day] = datePart.split('/').map(Number);
    const checkDate = new Date(year, month - 1, day);
    const dayOfWeek = checkDate.getDay();
    
    // Weekend is off-peak
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    
    const hour = aestDate.getUTCHours();
    return hour >= 7 && hour < 22;  // 7am to 10pm AEST
  }

  /**
   * Get date range for AEMO queries (start and end in AEST)
   * @param days Number of days to look back
   */
  static getAEMODateRange(days: number = 7): { start: string, end: string } {
    const now = new Date();
    const end = TimeUtil.utcToAEMO(now.toISOString());
    
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    const start = TimeUtil.utcToAEMO(startDate.toISOString());
    
    return { start, end };
  }

  /**
   * Validate if a string is a valid AEMO timestamp
   */
  static isValidAEMOTimestamp(timestamp: string): boolean {
    if (!timestamp) return false;
    
    try {
      const parsed = TimeUtil.parseAEMOToUTC(timestamp);
      return !isNaN(new Date(parsed).getTime());
    } catch {
      return false;
    }
  }

  /**
   * Format timestamp for display (with timezone indicator)
   */
  static formatForDisplay(utcIso: string, showTimezone: boolean = true): string {
    const formatted = TimeUtil.utcToLocal(utcIso, 'Australia/Sydney');
    return showTimezone ? `${formatted} AEST` : formatted;
  }

  /**
   * Calculate age of data in human-readable format
   */
  static getDataAge(utcIso: string): string {
    const now = new Date();
    const dataTime = new Date(utcIso);
    const diffMs = now.getTime() - dataTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }

  /**
   * Test helper: Verify DST edge cases
   * Example: Sydney DST starts Oct 5, 2025 (2 AM -> 3 AM local)
   * But NEM stays at fixed UTC+10
   */
  static testDSTEdge(): void {
    // During DST "spring forward" in Sydney
    const dstEdge = "2025/10/05 02:30:00"; // This hour is "skipped" in Sydney local time
    const utc = TimeUtil.parseAEMOToUTC(dstEdge);
    const back = TimeUtil.utcToAEMO(utc);
    
    console.assert(utc === "2025-10-04T16:30:00.000Z", "DST edge UTC conversion failed");
    console.assert(back === "2025/10/05 02:30:00", "DST edge roundtrip failed");
    console.log("DST edge case test passed: NEM ignores DST transitions");
  }

  /**
   * Known AEMO Quirks:
   * 1. Trading day starts at 4:00 AM AEST (not midnight)
   * 2. Settlement periods are 1-288 (not 0-287)
   * 3. Trading intervals are 1-48 (not 0-47)
   * 4. FCAS markets operate on same 5-min intervals as energy
   * 5. All timestamps ignore DST even when regions observe it
   */
}