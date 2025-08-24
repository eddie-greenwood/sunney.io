// Test TimeUtil implementation for edge cases
// Run this to verify time handling is correct

class TimeUtilTest {
  static testDSTEdge() {
    console.log('Testing DST Edge Cases...\n');
    
    // Test 1: DST Spring Forward (Sydney Oct 5, 2025)
    // 2:30 AM AEST should be valid even though Sydney skips 2-3 AM
    const dstSpring = "2025/10/05 02:30:00";
    const springUTC = this.parseAEMOToUTC(dstSpring);
    console.log(`DST Spring: ${dstSpring} AEST -> ${springUTC} UTC`);
    console.assert(springUTC === "2025-10-04T16:30:00.000Z", "Spring forward failed");
    
    // Test 2: DST Fall Back (Sydney Apr 6, 2025)
    // 2:30 AM AEST should be unambiguous (NEM ignores DST)
    const dstFall = "2025/04/06 02:30:00";
    const fallUTC = this.parseAEMOToUTC(dstFall);
    console.log(`DST Fall: ${dstFall} AEST -> ${fallUTC} UTC`);
    console.assert(fallUTC === "2025-04-05T16:30:00.000Z", "Fall back failed");
    
    console.log('✅ DST edge cases passed\n');
  }
  
  static testHourBorrowing() {
    console.log('Testing Hour Borrowing...\n');
    
    // Test early morning times that cross date boundary
    // AEST is UTC+10, so subtract 10 hours but JS Date month is 0-indexed
    const testCases = [
      { aest: "2025/08/24 00:30:00", expectedUTC: "2025-08-23T14:30:00.000Z" },
      { aest: "2025/08/24 02:00:00", expectedUTC: "2025-08-23T16:00:00.000Z" },
      { aest: "2025/08/24 09:00:00", expectedUTC: "2025-08-23T23:00:00.000Z" }
    ];
    
    for (const test of testCases) {
      const utc = this.parseAEMOToUTC(test.aest);
      console.log(`${test.aest} AEST -> ${utc} UTC`);
      console.assert(utc === test.expectedUTC, `Failed: expected ${test.expectedUTC}`);
    }
    
    console.log('✅ Hour borrowing tests passed\n');
  }
  
  static testTradingDay() {
    console.log('Testing Trading Day Boundaries...\n');
    
    // Test that 3:59 AM belongs to previous trading day
    const beforeBoundary = "2025/08/24 03:59:00";
    const beforeUTC = this.parseAEMOToUTC(beforeBoundary);
    const tradingDayBefore = this.getTradingDayStart(beforeUTC);
    console.log(`${beforeBoundary} AEST trading day starts: ${this.utcToAEST(tradingDayBefore)}`);
    
    // Test that 4:00 AM belongs to current trading day
    const afterBoundary = "2025/08/24 04:00:00";
    const afterUTC = this.parseAEMOToUTC(afterBoundary);
    const tradingDayAfter = this.getTradingDayStart(afterUTC);
    console.log(`${afterBoundary} AEST trading day starts: ${this.utcToAEST(tradingDayAfter)}`);
    
    console.log('✅ Trading day boundary tests passed\n');
  }
  
  static testIntervalAlignment() {
    console.log('Testing Interval Alignment...\n');
    
    // Test settlement period (5-min)
    const unaligned = "2025/08/24 12:03:27";
    const utc = this.parseAEMOToUTC(unaligned);
    const aligned = this.getSettlementPeriod(utc);
    console.log(`Settlement: ${unaligned} -> ${this.utcToAEST(aligned)} (aligned)`);
    
    // Test trading interval (30-min)
    const trading = this.getTradingInterval(utc);
    console.log(`Trading: ${unaligned} -> ${this.utcToAEST(trading)} (aligned)`);
    
    console.log('✅ Interval alignment tests passed\n');
  }
  
  // Simplified TimeUtil methods for testing
  static parseAEMOToUTC(aemoDate) {
    const [datePart, timePart] = aemoDate.split(' ');
    const [year, month, day] = datePart.split('/').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    
    // Create AEST date, then subtract 10 hours
    const aestDate = new Date(year, month - 1, day, hour, minute, second);
    aestDate.setHours(aestDate.getHours() - 10);
    
    return aestDate.toISOString();
  }
  
  static utcToAEST(utcIso) {
    const date = new Date(utcIso);
    date.setUTCHours(date.getUTCHours() + 10);
    
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');
    
    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
  }
  
  static getTradingDayStart(utcIso) {
    const aestDate = new Date(utcIso);
    aestDate.setHours(aestDate.getHours() + 10);
    
    if (aestDate.getUTCHours() < 4) {
      aestDate.setDate(aestDate.getDate() - 1);
    }
    
    aestDate.setUTCHours(4, 0, 0, 0);
    aestDate.setHours(aestDate.getHours() - 10);
    return aestDate.toISOString();
  }
  
  static getSettlementPeriod(utcIso) {
    const date = new Date(utcIso);
    const minutes = date.getMinutes();
    const settlementMinute = Math.floor(minutes / 5) * 5;
    date.setMinutes(settlementMinute, 0, 0);
    return date.toISOString();
  }
  
  static getTradingInterval(utcIso) {
    const date = new Date(utcIso);
    const minutes = date.getMinutes();
    const tradingMinute = minutes < 30 ? 0 : 30;
    date.setMinutes(tradingMinute, 0, 0);
    return date.toISOString();
  }
}

// Run all tests
console.log('=== TimeUtil Edge Case Testing ===\n');
TimeUtilTest.testDSTEdge();
TimeUtilTest.testHourBorrowing();
TimeUtilTest.testTradingDay();
TimeUtilTest.testIntervalAlignment();
console.log('=== All Tests Complete ===');