import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditEntry, auditTrail } from '../../src/audit/trail.js';
import { carOrder, orderSchedule } from '../../src/bunching/orderSchedule.js';
import { buildProgram } from '../../src/cli/program.js';
import { eventTrail, explainText } from '../../src/cli/commands/explain.js';
import { exclusionRegistry } from '../../src/exclusions/registry.js';
import { EVIDENCE, EXCLUSION } from '../../src/exclusions/exclusion.js';
import { emit, writeOutput } from '../../src/io/output.js';
import { OUTPUT } from '../../src/cli/format.js';
import { notice } from '../../src/events/notice.js';
import { NOTICE_METHOD } from '../../src/site/party.js';
import { reliefKpis } from '../../src/reporting/kpi.js';
import { moneyRows, plainMoneyRows } from '../../src/reporting/rows.js';
import { statementOfAccount } from '../../src/settlement/statementOfAccount.js';
import { assessStorage } from '../../src/storage/storageCharge.js';
import { interchange, timeAtJunctionMinutes } from '../../src/switching/interchange.js';
import { pageAsAmended, supplementSeries } from '../../src/tariff/amendment.js';
import { tariff } from '../../src/tariff/tariff.js';
import { DEFAULT_OFFSET_MINUTES } from '../../src/time/instant.js';

/**
 * The defaults.
 *
 * Nearly every function here takes an options object it can do without, and a
 * default nobody exercises is a default nobody has read. These call each one
 * with as little as it will accept and check it behaves the way the comment
 * beside it says.
 */

describe('the audit trail', () => {
  it('stamps the default station offset', () => {
    const entry = auditEntry({
      action: 'assessed',
      at: '2024-04-05T09:00',
      actor: 'clerk',
      subject: 'BNSF 1',
    });
    expect(entry.offsetMinutes).toBe(DEFAULT_OFFSET_MINUTES);
    expect(entry.inputs).toEqual([]);
  });

  it('starts empty', () => {
    expect(auditTrail().size).toBe(0);
    expect(auditTrail().all()).toEqual([]);
  });

  it('has no last entry for a subject it has never seen', () => {
    expect(auditTrail().lastFor('nobody')).toBeUndefined();
  });
});

describe('the order schedule', () => {
  it('starts empty', () => {
    const schedule = orderSchedule();
    expect(schedule.size).toBe(0);
    expect(schedule.all()).toEqual([]);
    expect(schedule.forConsignee('DELTA')).toEqual([]);
  });

  it('leaves the optional fields out', () => {
    const order = carOrder({
      consigneeId: 'DELTA',
      splc: '412300',
      wantedOn: '2024-03-04',
      cars: 1,
    });
    expect(order.commodityClass).toBeUndefined();
    expect(order.reference).toBeUndefined();
  });
});

describe('the exclusion register', () => {
  it('starts empty and matches everything', () => {
    const registry = exclusionRegistry();
    expect(registry.size).toBe(0);
    expect(registry.forCar()).toEqual([]);
    expect(registry.windows({})).toEqual([]);
  });

  it('takes a car query with no span', () => {
    const registry = exclusionRegistry([
      {
        kind: EXCLUSION.WEATHER,
        from: '2024-03-07T06:00',
        to: '2024-03-08T18:00',
        splc: '412300',
        evidence: EVIDENCE.CARRIER_BULLETIN,
      },
    ]);
    expect(registry.forCar({ splc: '412300' })).toHaveLength(1);
  });
});

describe('notices', () => {
  it('uses the standard office hours when none are given', () => {
    const record = notice({
      carId: 'BNSF 1',
      method: NOTICE_METHOD.PHONE,
      sentAt: '2024-03-04T03:00',
    });
    expect(record.officeOpensMinute).toBe(480);
    expect(record.officeClosesMinute).toBe(1020);
    expect(record.consigneeId).toBeUndefined();
  });
});

describe('storage', () => {
  it('assesses a loaded car when told nothing else', () => {
    const page = tariff({
      id: 'X',
      carrier: 'BNSF',
      ladder: [{ fromDay: 1, rate: '80.00' }],
    });
    const result = assessStorage({ carId: 'GATX 77', page });
    expect(result.chargeableDays).toBe(0);
    expect(result.nextIndex).toBe(1);
  });
});

describe('interchange', () => {
  it('measures nothing when nobody says when it settled', () => {
    const record = interchange({
      carId: 'BNSF 1',
      junction: 'MEM',
      deliveringCarrier: 'BNSF',
      receivingCarrier: 'UP',
      offeredAt: '2024-03-04T06:00',
    });
    expect(timeAtJunctionMinutes(record)).toBe(0);
    expect(record.settledAt).toBeUndefined();
    expect(record.refusalReason).toBeUndefined();
  });
});

describe('amendments', () => {
  it('returns the page untouched with no supplements at all', () => {
    const page = tariff({ id: 'X', carrier: 'BNSF', ladder: [{ fromDay: 1, rate: '1.00' }] });
    const result = pageAsAmended(page, supplementSeries(), '2024-03-01');
    expect(result.page).toBe(page);
    expect(result.applied).toEqual([]);
  });
});

describe('reporting helpers', () => {
  it('leaves rows alone when no money columns are named', () => {
    expect(plainMoneyRows([{ a: 15000 }])).toEqual([{ a: 15000 }]);
    expect(moneyRows([{ a: 15000 }])).toEqual([{ a: 15000 }]);
  });

  it('reports nothing for relief on an empty month', () => {
    expect(reliefKpis([])).toEqual({ applied: 0, declined: 0, acceptanceRate: 0, byKind: {} });
  });
});

describe('the account', () => {
  it('starts at nothing with no entries and no opening balance', () => {
    const account = statementOfAccount({ consigneeId: 'DELTA' });
    expect(account.openingBalance).toBe(0);
    expect(account.charged).toBe(0);
    expect(account.relieved).toBe(0);
  });
});

describe('explain', () => {
  it('renders without a world', () => {
    const explanation = {
      carId: 'BNSF 1',
      splc: '412300',
      page: 'DEM-4000',
      selection: 'x',
      total: 0,
      detentions: [],
      freeDays: [],
      chargedDays: [],
      skippedDays: [],
      reliefApplied: [],
      reliefDeclined: [],
    };
    expect(explainText(explanation)).toContain('BNSF 1');
  });

  it('lists relief applied when there is any', () => {
    const explanation = {
      carId: 'BNSF 1',
      splc: '412300',
      page: 'DEM-4000',
      selection: 'x',
      total: 0,
      detentions: [{ placement: 'actual', track: 'IT-9', open: true }],
      freeDays: [],
      chargedDays: [],
      skippedDays: ['2024-03-09'],
      reliefApplied: ['weather'],
      reliefDeclined: [],
    };
    const text = explainText(explanation);
    expect(text).toContain('relief applied');
    expect(text).toContain('not counted');
    expect(text).not.toContain('relief declined');
  });

  it('has an empty trail for a feed with no events', () => {
    expect(eventTrail({ events: [] }, 'BNSF 1')).toEqual([]);
  });
});

describe('the program with no injected output', () => {
  it('builds without any dependencies at all', () => {
    const program = buildProgram();
    expect(program.name()).toBe('spurtally');
    expect(program.commands.length).toBeGreaterThan(4);
  });
});

describe('writing a file for real', () => {
  it('creates the directory and writes through node', () => {
    const base = mkdtempSync(join(tmpdir(), 'spurtally-'));
    try {
      const path = join(base, 'nested', 'march.csv');
      const result = writeOutput(path, 'car,amount\nBNSF 1,150.00', OUTPUT.CSV);
      expect(readFileSync(result.path, 'utf8')).toBe('car,amount\nBNSF 1,150.00\n');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('emits through the writer it is given', () => {
    const printed = [];
    expect(emit('hello', {}, { write: (text) => printed.push(text) }).written).toBe(false);
    expect(printed).toEqual(['hello']);
  });
});
