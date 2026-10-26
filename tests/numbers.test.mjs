import assert from 'node:assert/strict';
import test from 'node:test';
import { percentValue } from '../src/numbers.ts';
import { runStressTest } from '../src/stress-test.ts';

test('percentual zero é mantido e só o campo ausente usa o padrão', () => {
  assert.equal(percentValue(0), 0);
  assert.equal(percentValue('0'), 0);
  assert.equal(percentValue(85), 85);
  assert.equal(percentValue(undefined), 100);
  assert.equal(percentValue(''), 100);
  assert.equal(percentValue('abc'), 100);
});

test('disponibilidade zerada não é tratada como 100% no teste de estresse', () => {
  const assumptions = {
    monthlyDemand: 0,
    workdaysPerMonth: 20,
    availableMinutesPerDay: 480,
    productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 6000, packSize: 1 }],
  };
  const settings = {
    days: 1, demandPercent: 100, cycleVariationPercent: 0, extraDowntimePercent: 0,
    shiftsPerDay: 1, minutesPerShift: 480, breakMinutesPerShift: 0,
    failureProcessId: '', failureStartMinute: 0, failureDurationMinutes: 0,
    supplierDelayMinutes: 0, transportDelayMinutes: 0,
  };
  const line = (disp) => [{ id: 'cut', kind: 'process', x: 0, y: 0, label: 'Corte', data: { tc: 60, setup: 0, lote: 1, recurso: 1, disp, qualidade: 100 } }];
  const stopped = runStressTest(line(0), assumptions, settings);
  const running = runStressTest(line(100), assumptions, settings);
  assert.ok(stopped.deliveredUnits < running.deliveredUnits / 10);
});
