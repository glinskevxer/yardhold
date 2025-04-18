import { describe, expect, it } from 'vitest';
import {
  accountEntry,
  accountText,
  fromCreditMemo,
  fromInvoice,
  fromPayment,
  fromWriteOff,
  isClear,
  isInCredit,
  statementOfAccount,
} from '../../src/settlement/statementOfAccount.js';
import { ValidationError } from '../../src/core/errors.js';

const invoice = { number: 'INV-202403-00012', issuedOn: '2024-04-05', total: 100000 };
const memo = {
  number: 'CRM-202404-00003',
  issuedOn: '2024-04-30',
  amount: 25000,
  reason: 'storm allowed',
};
const payment = { id: 'abcd1234', receivedOn: '2024-04-30', amount: 60000, reference: 'ACH-9912' };
const written = {
  invoiceNumber: 'INV-202403-00012',
  writtenOn: '2024-05-15',
  amount: 15000,
  reason: 'de-minimis',
};

describe('accountEntry', () => {
  it('parses the date and keeps the text', () => {
    const entry = accountEntry({ kind: 'invoice', date: '2024-04-05', reference: 'X', amount: 1 });
    expect(entry.on.month).toBe(4);
    expect(entry.date).toBe('2024-04-05');
  });

  it('needs a kind, a reference and a date', () => {
    expect(() => accountEntry({ date: '2024-04-05', reference: 'X' })).toThrow(ValidationError);
    expect(() => accountEntry({ kind: 'invoice', date: '2024-04-05' })).toThrow(ValidationError);
    expect(() => accountEntry({ kind: 'invoice', reference: 'X' })).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(
      Object.isFrozen(
        accountEntry({ kind: 'invoice', date: '2024-04-05', reference: 'X', amount: 1 })
      )
    ).toBe(true);
  });
});

describe('the adapters', () => {
  it('reads an invoice as a charge', () => {
    expect(fromInvoice(invoice).amount).toBe(100000);
  });

  it('reads a credit memo, a payment and a write off as relief', () => {
    expect(fromCreditMemo(memo).amount).toBe(-25000);
    expect(fromPayment(payment).amount).toBe(-60000);
    expect(fromWriteOff(written).amount).toBe(-15000);
  });

  it('falls back to the payment id when there is no remittance reference', () => {
    expect(fromPayment({ ...payment, reference: undefined }).reference).toBe('abcd1234');
  });

  it('carries the reason onto the account', () => {
    expect(fromCreditMemo(memo).note).toBe('storm allowed');
    expect(fromWriteOff(written).note).toBe('de-minimis');
  });
});

describe('statementOfAccount', () => {
  const account = statementOfAccount({
    consigneeId: ' delta ',
    entries: [
      fromPayment(payment),
      fromWriteOff(written),
      fromInvoice(invoice),
      fromCreditMemo(memo),
    ],
  });

  it('uppercases the consignee', () => {
    expect(account.consigneeId).toBe('DELTA');
  });

  it('runs in date order', () => {
    expect(account.rows.map((row) => row.date)).toEqual([
      '2024-04-05',
      '2024-04-30',
      '2024-04-30',
      '2024-05-15',
    ]);
  });

  it('puts the credit before the payment on the same day', () => {
    expect(account.rows[1].kind).toBe('credit');
    expect(account.rows[2].kind).toBe('payment');
  });

  it('never dips the running balance below what was charged', () => {
    expect(account.rows.map((row) => row.balance)).toEqual([100000, 75000, 15000, 0]);
  });

  it('foots to nothing when everything was settled', () => {
    expect(account.closingBalance).toBe(0);
    expect(isClear(account)).toBe(true);
    expect(isInCredit(account)).toBe(false);
  });

  it('splits what was charged from what was relieved', () => {
    expect(account.charged).toBe(100000);
    expect(account.relieved).toBe(-100000);
  });

  it('starts from an opening balance', () => {
    const carried = statementOfAccount({
      consigneeId: 'DELTA',
      entries: [fromInvoice(invoice)],
      openingBalance: 25000,
    });
    expect(carried.rows[0].balance).toBe(125000);
    expect(carried.closingBalance).toBe(125000);
  });

  it('reports an overpaid account as in credit', () => {
    const over = statementOfAccount({
      consigneeId: 'DELTA',
      entries: [fromInvoice(invoice), fromPayment({ ...payment, amount: 120000 })],
    });
    expect(over.closingBalance).toBe(-20000);
    expect(isInCredit(over)).toBe(true);
  });

  it('handles an account with nothing on it', () => {
    const empty = statementOfAccount({ consigneeId: 'DELTA' });
    expect(empty.rows).toEqual([]);
    expect(empty.closingBalance).toBe(0);
  });

  it('needs a consignee', () => {
    expect(() => statementOfAccount({})).toThrow(ValidationError);
  });

  it('refuses a non array of entries', () => {
    expect(() => statementOfAccount({ consigneeId: 'DELTA', entries: 'nope' })).toThrow(
      ValidationError
    );
  });
});

describe('accountText', () => {
  const account = statementOfAccount({
    consigneeId: 'DELTA',
    entries: [fromInvoice(invoice), fromPayment(payment)],
  });

  it('heads with the consignee and the opening balance', () => {
    const lines = accountText(account).split('\n');
    expect(lines[0]).toBe('Account DELTA');
    expect(lines[1]).toBe('Opening $0.00');
  });

  it('lists every movement with a running balance', () => {
    const text = accountText(account);
    expect(text).toContain('INV-202403-00012');
    expect(text).toContain('ACH-9912');
    expect(text).toContain('$400.00');
  });

  it('foots with the closing balance', () => {
    expect(accountText(account)).toContain('Closing $400.00');
  });
});
