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

test('lote de produção 1 é fluxo contínuo e não adiciona atraso de lote', () => {
  const settings = batchSettings({ data: { tc: 60, setup: 5, lote: 1 } });
  assert.equal(settings.mode, 'unitario');
  assert.equal(settings.transferBatch, 1);
  assert.equal(batchLeadTime(settings, 120).totalSec, 0);
});

test('atraso por lote soma espera na saída e setup', () => {
  const settings = batchSettings({ data: { tc: 60, setup: 5, lote: 10 } });
  const lead = batchLeadTime(settings, 120);
  assert.equal(settings.transferBatch, 10);
  assert.equal(lead.formationSec, 9 * 120);
  assert.equal(lead.processingSec, 5 * 60);
  assert.equal(lead.totalSec, lead.formationSec + lead.processingSec);
});

test('o lote inteiro anda junto: lote de transferência é igual ao lote de produção', () => {
  const settings = batchSettings({ data: { tc: 60, lote: 10, loteTransf: 2 } });
  assert.equal(settings.mode, 'lote');
  assert.equal(settings.transferBatch, 10);
});

test('fabricação por lotes acumula WIP e registra espera para formar o lote', () => {
  const unit = runStressTest(line(), assumptions, baseSettings);
  const batch = runStressTest(line({ lote: 50 }), assumptions, baseSettings);
  assert.equal(batch.processResults[0].batchMode, true);
  assert.equal(unit.processResults[0].batchMode, false);
  assert.ok(batch.processResults[0].batchWaitMinutes > 0);
  assert.ok(batch.maxWip > unit.maxWip);
});

test('lote de produção menor entrega mais cedo', () => {
  const bigLot = runStressTest(line({ lote: 100 }), assumptions, baseSettings);
  const smallLot = runStressTest(line({ lote: 10 }), assumptions, baseSettings);
  assert.ok(smallLot.deliveredUnits > bigLot.deliveredUnits);
});

test('setup do lote ocupa o processo antes da produção', () => {
  const withSetup = runStressTest(line({ lote: 50, setup: 30 }), assumptions, baseSettings);
  const withoutSetup = runStressTest(line({ lote: 50 }), assumptions, baseSettings);
  assert.ok(withSetup.deliveredUnits < withoutSetup.deliveredUnits);
});
