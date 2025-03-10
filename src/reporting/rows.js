import { formatMoney } from '../core/money.js';

/**
 * Turning cent integers into strings for a report, once, rather than in every
 * report. The money columns are named by the caller because a report that
 * guesses which column is money eventually formats a car number as currency.
 */

export function plainMoneyRows(rows, moneyColumns = []) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const column of moneyColumns) {
      if (typeof copy[column] === 'number') {
        copy[column] = formatMoney(copy[column], { symbol: '', grouping: false });
      }
    }
    return copy;
  });
}

export function moneyRows(rows, moneyColumns = []) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const column of moneyColumns) {
      if (typeof copy[column] === 'number') {
        copy[column] = formatMoney(copy[column]);
      }
    }
    return copy;
  });
}
