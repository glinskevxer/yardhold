import { requireInteger, requireObject, requireString } from '../core/guards.js';
import { creditsNeededFor, debitsCoveredBy } from './agreement.js';
import { totalCredits, totalDebits } from './credits.js';

/**
 * Closing the month.
 *
 * Credits buy debits at the agreement's ratio and whatever is left over either
 * carries or expires. Carry over is the clause worth reading twice: without it
 * a plant that turned everything round in a quiet March gets nothing for it in
 * a bad April, and with it the same plant can bank a quarter of good behaviour
 * and spend it all in one week.
 */

export function reconcile(ledger, agreement, { period, carriedIn = 0 } = {}) {
  requireObject(agreement, 'agreement');
  requireString(period, 'period');
  requireInteger(carriedIn, 'carriedIn', { min: 0 });
  const earned = totalCredits(ledger);
  const debits = totalDebits(ledger);
  const opening = agreement.carryOver ? carriedIn : 0;
  const available = earned + opening;
  const offsetable = debitsCoveredBy(agreement, available);
  const offset = Math.min(debits, offsetable);
  const spent = creditsNeededFor(agreement, offset);
  const leftover = available - spent;
  return {
    period,
    agreementId: agreement.id,
    consigneeId: agreement.consigneeId,
    earnedCredits: earned,
    openingCredits: opening,
    availableCredits: available,
    debits,
    offsetDebits: offset,
    billableDebits: debits - offset,
    creditsSpent: spent,
    creditsLeft: leftover,
    carriedOut: agreement.carryOver ? leftover : 0,
    expiredCredits: agreement.carryOver ? 0 : leftover,
    cars: ledger.length,
  };
}

export function isSettledInFull(settlement) {
  return settlement.billableDebits === 0;
}

export function creditUtilisation(settlement) {
  if (settlement.availableCredits === 0) {
    return 0;
  }
  return settlement.creditsSpent / settlement.availableCredits;
}

export function runPeriods(ledgersByPeriod, agreement) {
  const periods = [...ledgersByPeriod.keys()].sort();
  const settlements = [];
  let carried = 0;
  for (const period of periods) {
    const settlement = reconcile(ledgersByPeriod.get(period), agreement, {
      period,
      carriedIn: carried,
    });
    carried = settlement.carriedOut;
    settlements.push(settlement);
  }
  return settlements;
}

export function describeSettlement(settlement) {
  return `${settlement.period} ${settlement.consigneeId}: ${settlement.debits} debits, ${settlement.offsetDebits} offset, ${settlement.billableDebits} billable`;
}
