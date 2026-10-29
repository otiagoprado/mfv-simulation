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

test('a produção começa com a primeira peça; o lote é regra de saída', () => {
  const flow = live([process('a', 0, 60, { lote: 5 }), process('b', 300, 60)], 500);
  assert.equal(flow.stations[0].waiting, 0);
  assert.equal(flow.stations[0].processing, 0);
  assert.equal(flow.stations[0].holding, 4);
  assert.equal(atStation(flow, 1).length, 0);
});

test('o lote inteiro sai junto assim que a quinta peça fica pronta', () => {
  const flow = live([process('a', 0, 60, { lote: 5 }), process('b', 300, 60)], 830);
  // Lote 1 saiu aos 600 s; no processo a já estão a 6ª (pronta) e a 7ª (em produção).
  assert.equal(flow.stations[0].holding, 1);
  assert.equal(flow.stations[0].processing, 1);
  assert.equal(atStation(flow, 1).length, 3);
  assert.equal(flow.stations[1].processing, 1);
  assert.equal(flow.stations[1].waiting, 2);
});

test('o processo seguinte recebe o lote de uma vez e o consome peça a peça', () => {
  const flow = live([process('a', 0, 60, { lote: 5 }), process('b', 300, 60)], 700);
  assert.equal(flow.stations[1].processing, 1);
  assert.equal(flow.stations[1].waiting, 4);
  assert.equal(flow.stations[0].holding, 0);
});

test('o campo Lote de produção sozinho ativa a produção em lotes em todos os processos', () => {
  const flow = live([process('a', 0, 60, { lote: 5 }), process('b', 300, 60, { lote: 5 }), process('c', 600, 60, { lote: 5 })], 60 * 60);
  // Nenhuma peça passa pelo segundo processo sozinha: o que saiu dele são lotes inteiros de 5.
  const passedSecond = flow.completed + flow.units.filter((unit) => unit.stage.station >= 2).length;
  assert.ok(passedSecond > 0);
  assert.equal(passedSecond % 5, 0);
  assert.ok(flow.stations[1].waiting + flow.stations[1].processing + flow.stations[1].holding <= 5);
});

test('o gargalo forma fila, mas o fluxo continua no ritmo dele', () => {
  const flow = live([process('a', 0, 60), process('b', 300, 300)], 480 * 60);
  assert.ok(flow.completed >= 90, `concluídas: ${flow.completed}`);
  assert.ok(flow.stations[1].waiting > 50);
  assert.equal(flow.stations[0].waiting, 0);
});

test('as peças prontas se acumulam no buffer de saída enquanto o lote não fecha', () => {
  const flow = live([process('a', 0, 60, { lote: 5 }), process('b', 300, 60)], 910);
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
  assert.equal(run({ lote: 5 }).completed, 0);
});

test('produtos prontos ficam na expedição até completar o lote de expedição', () => {
  const shipping = { id: 'ship', kind: 'shipping-point', x: 900, y: 0, label: 'Expedição', data: { lote: 10 } };
  const flow = live([process('a', 0, 60), shipping], 40 * 60);
  assert.equal(flow.shipping.lot, 10);
  assert.ok(flow.shipping.waiting > 0 && flow.shipping.waiting < 10, `na expedição: ${flow.shipping.waiting}`);
  assert.equal(flow.completed, 10);
});

test('sem lote de expedição cada produto é entregue ao chegar', () => {
  const shipping = { id: 'ship', kind: 'shipping-point', x: 900, y: 0, label: 'Expedição', data: {} };
  const flow = live([process('a', 0, 60), shipping], 40 * 60);
  assert.equal(flow.shipping.lot, 1);
  assert.equal(flow.shipping.waiting, 0);
  assert.ok(flow.completed > 10);
});

test('a simulação ao vivo continua nos dias seguintes', () => {
  const daySec = assumptions.availableMinutesPerDay * 60;
  const flow = live([process('a', 0, 60)], daySec * 2 + 600);
  assert.ok(flow.launched > daySec / 120, `liberadas: ${flow.launched}`);
});

test('peças por ciclo: o ciclo espera encher e produz todas as peças juntas', () => {
  // Masseira: um ciclo de 60 s faz massa para 5 pães; as peças chegam uma a cada 120 s.
  const flow = live([process('a', 0, 60, { pecasCiclo: 5 }), process('b', 300, 60)], 590);
  assert.equal(flow.stations[0].waiting, 0);
  assert.equal(flow.stations[0].processing, 5);
  assert.equal(atStation(flow, 1).length, 0);
});

test('peças por ciclo: as 5 peças saem juntas e a seguinte espera o próximo ciclo encher', () => {
  const flow = live([process('a', 0, 60, { pecasCiclo: 5 }), process('b', 300, 60)], 700);
  assert.equal(flow.stations[0].waiting, 1);
  assert.equal(flow.stations[0].processing, 0);
  assert.equal(atStation(flow, 1).length, 5);
});
