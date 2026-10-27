import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCanvasSimulation, calculateLiveFlow } from '../src/flow-engine.ts';

// Demanda de 240 peças/dia em 480 min: uma peça liberada a cada 120 s.
const assumptions = {
  monthlyDemand: 4800,
  workdaysPerMonth: 20,
  availableMinutesPerDay: 480,
  productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 4800, packSize: 1 }],
};
const process = (id, x, tc, data = {}) => ({ id, kind: 'process', x, y: 0, label: id, data: { tc, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100, ...data } });
const live = (elements, elapsedSec) => {
  const canvas = { elements, arrows: [], assumptions, themeColor: '#0071e3' };
  return calculateLiveFlow(calculateCanvasSimulation(canvas), assumptions, elapsedSec);
};
const atStation = (flow, station) => flow.units.filter((unit) => unit.stage.station === station && unit.stage.kind !== 'transit');

test('o lote só começa quando as 5 peças chegam', () => {
  const flow = live([process('a', 0, 60, { fabricacao: 'lote', lote: 5 }), process('b', 300, 60)], 500);
  assert.equal(flow.stations[0].waiting, 4);
  assert.equal(flow.stations[0].processing, 0);
  assert.equal(atStation(flow, 1).length, 0);
});

test('as peças prontas esperam o lote terminar antes de seguir', () => {
  const flow = live([process('a', 0, 60, { fabricacao: 'lote', lote: 5 }), process('b', 300, 60)], 830);
  assert.equal(flow.stations[0].holding, 4);
  assert.equal(flow.stations[0].processing, 1);
  assert.equal(flow.units.filter((unit) => unit.stage.station === 1).length, 0);
});

test('o lote inteiro chega junto ao processo seguinte', () => {
  const flow = live([process('a', 0, 60, { fabricacao: 'lote', lote: 5 }), process('b', 300, 60)], 910);
  assert.equal(flow.stations[1].processing, 1);
  assert.equal(flow.stations[1].waiting, 4);
});

test('lote de transferência menor libera as peças antes do fim do lote', () => {
  const flow = live([process('a', 0, 60, { fabricacao: 'lote', lote: 5, loteTransf: 2 }), process('b', 300, 60)], 830);
  assert.ok(flow.units.some((unit) => unit.stage.station === 1));
});

test('o gargalo forma fila, mas o fluxo continua no ritmo dele', () => {
  const flow = live([process('a', 0, 60), process('b', 300, 300)], 480 * 60);
  assert.ok(flow.completed >= 90, `concluídas: ${flow.completed}`);
  assert.ok(flow.stations[1].waiting > 50);
  assert.equal(flow.stations[0].waiting, 0);
});

test('dentro do lote o operador faz uma peça por vez e as acumula no buffer de saída', () => {
  const flow = live([process('a', 0, 60, { fabricacao: 'lote', lote: 5 }), process('b', 300, 60)], 700);
  assert.equal(flow.stations[0].processing, 1);
  assert.equal(flow.stations[0].holding, 2);
});

test('como no vídeo: com lotes de 5 a primeira peça demora muito mais a sair que no fluxo unitário', () => {
  // Demanda alta (uma peça a cada 12 s) e 4 estações de 1 min/peça.
  const fast = { ...assumptions, monthlyDemand: 48000, productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 48000, packSize: 1 }] };
  const run = (data) => {
    const elements = [0, 1, 2, 3].map((index) => process(`s${index}`, index * 300, 60, data));
    const canvas = { elements, arrows: [], assumptions: fast, themeColor: '#0071e3' };
    return calculateLiveFlow(calculateCanvasSimulation(canvas), fast, 15 * 60);
  };
  assert.ok(run({}).completed >= 1);
  assert.equal(run({ fabricacao: 'lote', lote: 5 }).completed, 0);
});
