import assert from 'node:assert/strict';
import test from 'node:test';
import { batchLeadTime, batchSettings } from '../src/batch.ts';
import { runStressTest } from '../src/stress-test.ts';

const assumptions = {
  monthlyDemand: 0,
  workdaysPerMonth: 20,
  availableMinutesPerDay: 480,
  productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 6000, packSize: 1 }],
};

const baseSettings = {
  days: 2,
  demandPercent: 100,
  cycleVariationPercent: 0,
  extraDowntimePercent: 0,
  shiftsPerDay: 1,
  minutesPerShift: 480,
  breakMinutesPerShift: 0,
  failureProcessId: '',
  failureStartMinute: 120,
  failureDurationMinutes: 0,
  supplierDelayMinutes: 0,
  transportDelayMinutes: 0,
};

const line = (cutData = {}) => [
  { id: 'cut', kind: 'process', x: 0, y: 0, label: 'Corte', data: { tc: 60, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100, ...cutData } },
  { id: 'assembly', kind: 'process', x: 250, y: 0, label: 'Montagem', data: { tc: 60, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100 } },
];

test('fluxo unitário é o padrão e não adiciona atraso de lote', () => {
  const settings = batchSettings({ data: { tc: 60, setup: 5, lote: 10 } });
  assert.equal(settings.mode, 'unitario');
  assert.equal(settings.transferBatch, 1);
  assert.equal(batchLeadTime(settings, 120).totalSec, 0);
});

test('atraso por lote soma formação, setup e lote de transferência', () => {
  const settings = batchSettings({ data: { tc: 60, setup: 5, lote: 10, fabricacao: 'lote' } });
  const lead = batchLeadTime(settings, 120);
  assert.equal(settings.transferBatch, 10);
  assert.equal(lead.formationSec, 9 * 120);
  assert.equal(lead.processingSec, 5 * 60 + 9 * 60);
  assert.equal(lead.totalSec, lead.formationSec + lead.processingSec);
});

test('lote de transferência nunca passa do lote de produção', () => {
  const settings = batchSettings({ data: { tc: 60, lote: 10, loteTransf: 50, fabricacao: 'lote' } });
  assert.equal(settings.transferBatch, 10);
});

test('fabricação por lotes acumula WIP e registra espera para formar o lote', () => {
  const unit = runStressTest(line(), assumptions, baseSettings);
  const batch = runStressTest(line({ lote: 50, fabricacao: 'lote' }), assumptions, baseSettings);
  assert.equal(batch.processResults[0].batchMode, true);
  assert.equal(unit.processResults[0].batchMode, false);
  assert.ok(batch.processResults[0].batchWaitMinutes > 0);
  assert.ok(batch.maxWip > unit.maxWip);
});

test('lote de transferência menor entrega mais cedo', () => {
  const fullTransfer = runStressTest(line({ lote: 100, fabricacao: 'lote' }), assumptions, baseSettings);
  const smallTransfer = runStressTest(line({ lote: 100, loteTransf: 10, fabricacao: 'lote' }), assumptions, baseSettings);
  assert.ok(smallTransfer.deliveredUnits > fullTransfer.deliveredUnits);
});

test('setup do lote ocupa o processo antes da produção', () => {
  const withSetup = runStressTest(line({ lote: 50, setup: 30, fabricacao: 'lote' }), assumptions, baseSettings);
  const withoutSetup = runStressTest(line({ lote: 50, fabricacao: 'lote' }), assumptions, baseSettings);
  assert.ok(withSetup.deliveredUnits < withoutSetup.deliveredUnits);
});
