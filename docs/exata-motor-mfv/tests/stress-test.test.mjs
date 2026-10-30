import assert from 'node:assert/strict';
import test from 'node:test';
import { runStressTest } from '../engine/stress-test.ts';

const assumptions = {
  monthlyDemand: 0,
  workdaysPerMonth: 20,
  availableMinutesPerDay: 480,
  productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 6000, packSize: 1 }],
};

const processes = [
  { id: 'cut', kind: 'process', x: 0, y: 0, label: 'Corte', data: { tc: 60, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100 } },
  { id: 'assembly', kind: 'process', x: 250, y: 0, label: 'Montagem', data: { tc: 60, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100 } },
];

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

test('mais turnos aumentam a entrega disponível', () => {
  const oneShift = runStressTest(processes, assumptions, baseSettings);
  const twoShifts = runStressTest(processes, assumptions, { ...baseSettings, shiftsPerDay: 2 });
  assert.ok(twoShifts.deliveredUnits > oneShift.deliveredUnits);
  assert.equal(twoShifts.status, 'stable');
});

test('falha direcionada afeta somente o processo escolhido', () => {
  const result = runStressTest(processes, assumptions, {
    ...baseSettings,
    failureProcessId: 'assembly',
    failureDurationMinutes: 180,
  });
  assert.equal(result.processResults[0].failureMinutes, 0);
  assert.equal(result.processResults[1].failureMinutes, 360);
  assert.equal(result.constraintId, 'assembly');
});

test('intervalos são contabilizados em cada turno e processo', () => {
  const result = runStressTest(processes, assumptions, {
    ...baseSettings,
    shiftsPerDay: 2,
    breakMinutesPerShift: 30,
  });
  assert.equal(result.processResults[0].breakMinutes, 120);
  assert.equal(result.processResults[1].breakMinutes, 120);
});

test('atraso integral de material identifica o fornecedor', () => {
  const result = runStressTest(processes, assumptions, { ...baseSettings, supplierDelayMinutes: 480 });
  assert.equal(result.status, 'rupture');
  assert.equal(result.constraintLabel, 'Fornecedor');
  assert.equal(result.deliveredUnits, 0);
});

test('produto em trânsito identifica a logística externa', () => {
  const result = runStressTest(processes, assumptions, { ...baseSettings, transportDelayMinutes: 480 });
  assert.equal(result.status, 'rupture');
  assert.equal(result.constraintLabel, 'Transporte ao cliente');
  assert.ok(result.deliveredUnits < result.processResults.at(-1).goodOutput);
});

test('dados produtivos incompletos impedem um falso diagnóstico', () => {
  const invalid = [{ ...processes[0], data: { ...processes[0].data, tc: 0 } }];
  const result = runStressTest(invalid, assumptions, baseSettings);
  assert.equal(result.status, 'invalid');
  assert.equal(result.processResults.length, 0);
});
