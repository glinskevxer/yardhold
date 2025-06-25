/**
 * The public surface.
 *
 * Deliberately small. Everything underneath is reachable by path, but these are
 * the entry points that will keep working: build a world, read a feed, assess a
 * month, cut the paper and check it against the carrier. Anything not on this
 * list is internal, and the tests treat this file as the contract.
 */

export {
  loadConfig,
  calendarFor,
  agreementFor,
  pageFor,
  worldSummary,
} from './config/loadConfig.js';
export { checkDocument, parseDocument, sectionCounts, settingsOf } from './config/schema.js';
export { validateWorld, errorsOnly, isUsable } from './config/validate.js';

export { ingestCsv, ingestRecords, ingestSummary } from './io/ingestEvents.js';
export { readEdi322, isLikely322 } from './io/edi322.js';
export { readCarrierInvoice } from './io/carrierInvoice.js';
export { parseCsv, parseCsvRecords, toCsv } from './io/csv.js';
export { writeOutput, emit } from './io/output.js';

export { eventLedger, groupByCar } from './events/ledger.js';
export { normalizeStream, PROBLEM } from './events/normalize.js';
export { trackEvent, EVENT_SOURCE } from './events/event.js';
export { waybill, waybillBook, MOVEMENT } from './events/waybill.js';
export { notice } from './events/notice.js';
export { routeChange, CHANGE } from './events/diversion.js';

export { tariff, freeTimeFor, describeTariff } from './tariff/tariff.js';
export { tariffBook, tariffFiling, explainSelection } from './tariff/tariffBook.js';
export { rateLadder, rateForDay, LADDER_RESET } from './tariff/rateLadder.js';
export { freeTimeTable, SERVICE, DAY_KIND } from './tariff/freeTimeTable.js';
export { commodityBook, STANDARD_COMMODITIES } from './tariff/commodity.js';
export { contract, applyDiscount, selectContract } from './tariff/contract.js';

export { buildDetentions } from './clock/detention.js';
export { countChargeableDays } from './clock/chargeableDays.js';
export { resolvePlacement, PLACEMENT } from './clock/placement.js';
export { suspensionsFrom } from './clock/suspension.js';

export { exclusion, EXCLUSION, EVIDENCE } from './exclusions/exclusion.js';
export { exclusionRegistry } from './exclusions/registry.js';
export { isEligible, eligibleExclusions, explainRefusal } from './exclusions/eligibility.js';
export { relieveSpan, reliefSummary } from './exclusions/apply.js';

export { assessCar, assessmentTotal } from './assessment/assess.js';
export { assessMonth, assessmentsFor, monthTotal, consigneesIn } from './assessment/runMonth.js';
export { recomputeForClaim, summariseRecompute } from './assessment/recompute.js';
export { runScenarios, scenario } from './assessment/scenario.js';

export { averageAgreement, CREDIT_BASIS } from './average/agreement.js';
export { creditLedger, totalCredits, totalDebits } from './average/credits.js';
export { reconcile as reconcileAverage, runPeriods } from './average/reconcile.js';

export { orderSchedule, carOrder } from './bunching/orderSchedule.js';
export { matchPlacements } from './bunching/grouping.js';
export { bunchingRelief } from './bunching/relief.js';

export { assessStorage, LOAD_STATE } from './storage/storageCharge.js';
export { hireBook, hireCharge, HIRE_BASIS } from './storage/perDiem.js';
export { serviceBook, chargeService, SERVICE_KIND } from './storage/ancillary.js';

export { switchOrder, SWITCH_KIND } from './switching/switchOrder.js';
export { switchTariff, chargeSwitches } from './switching/switchCharge.js';
export { interchange, responsibleCarrier } from './switching/interchange.js';

export { invoice, INVOICE_STATUS, withStatus } from './invoice/invoice.js';
export { buildInvoice, creditMemoLine } from './invoice/build.js';
export { lineItem, CHARGE_TYPE } from './invoice/lineItem.js';
export { renderInvoice, RENDER_FORMAT } from './invoice/render.js';

export { claim, GROUND, CLAIM_STATUS } from './disputes/claim.js';
export { adjudicate, reopenableInputs } from './disputes/adjudicate.js';
export { isTimely, filingDeadline, groundsStillOpen } from './disputes/timeLimits.js';
export { creditMemo, allocateOverCars } from './disputes/creditMemo.js';

export { payment, applyPayment, applyAll } from './settlement/payment.js';
export { ageInvoices, bucketTotals } from './settlement/aging.js';
export { writeOff, WRITE_OFF_REASON } from './settlement/writeoff.js';
export { statementOfAccount, accountText } from './settlement/statementOfAccount.js';

export { statement, statementText } from './reporting/statement.js';
export { exceptionReport, EXCEPTION } from './reporting/exceptions.js';
export { assessmentKpis, reliefKpis } from './reporting/kpi.js';
export { dwellSummary, fromDetentions } from './reporting/dwell.js';
export { buildRegister, registerText } from './reporting/register.js';
export { reconcile as reconcileCarrier, VERDICT } from './reporting/reconciliation.js';

export { auditTrail, ACTION } from './audit/trail.js';
export { SpurtallyError, ValidationError, NotFoundError, isSpurtallyError } from './core/errors.js';
export { formatMoney, parseMoney } from './core/money.js';
export { main as runCli, VERSION } from './cli/program.js';
