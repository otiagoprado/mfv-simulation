import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCanvasSimulation, calculateKanbanSizing, calculateScenario } from '../engine/flow-engine.ts';

const assumptions = {
  monthlyDemand: 4800,
  workdaysPerMonth: 20,
  availableMinutesPerDay: 480,
  productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 4800, packSize: 1 }],
};
const process = (id, x, tc, data = {}) => ({ id, kind: 'process', x, y: 0, label: id, data: { tc, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100, ...data } });
const canvas = (elements, arrows = []) => ({ elements, arrows, assumptions, themeColor: '#0071e3' });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('takt time vem da demanda diária e do tempo disponível', () => {
  const scenario = calculateScenario(assumptions);
  assert.equal(scenario.dailyDemand, 240);
  assert.equal(scenario.taktTimeSec, 120);
});

test('o processo acima do takt é o gargalo e fica sobrecarregado', () => {
  const result = calculateCanvasSimulation(canvas([process('a', 0, 60), process('b', 300, 150), process('c', 600, 90)]));
  assert.equal(result.bottleneck.id, 'b');
  close(result.bottleneckCapacity, 192);
  assert.deepEqual(result.overloadedProcesses.map((metric) => metric.element.id), ['b']);
});

test('estoque em dias compõe o lead time', () => {
  const stock = { id: 'stock', kind: 'inventory', x: 150, y: 0, label: '', data: { qty: 480 } };
  const result = calculateCanvasSimulation(canvas([process('a', 0, 60), stock, process('b', 300, 60)]));
  close(result.inventoryDays, 2);
  close(result.leadTimeDays, 2);
});

test('fabricação por lotes soma o atraso do lote ao lead time', () => {
  const result = calculateCanvasSimulation(canvas([process('a', 0, 60, { lote: 10 }), process('b', 300, 60)]));
  close(result.batchLeadTimeSec, 9 * 120);
  close(result.leadTimeDays, (9 * 120) / (480 * 60));
  assert.equal(result.batchProcessCount, 1);
});

test('disponibilidade zerada sobrecarrega o processo em vez de virar 100%', () => {
  const result = calculateCanvasSimulation(canvas([process('a', 0, 60, { disp: 0 })]));
  assert.equal(result.overloadedProcesses.length, 1);
});

test('a ordem dos processos segue as setas de material', () => {
  const arrow = { id: 'flow', kind: 'arrow-push', x1: 0, y1: 0, x2: 1, y2: 1, startAnchor: { elementId: 'a', x: 1, y: 0.5 }, endAnchor: { elementId: 'b', x: 0, y: 0.5 } };
  const result = calculateCanvasSimulation(canvas([process('b', 0, 60), process('a', 300, 60)], [arrow]));
  assert.deepEqual(result.processElements.map((element) => element.id), ['a', 'b']);
  assert.equal(result.flowOrderSource, 'setas');
});

test('kanban recomenda cartões pela demanda durante a reposição', () => {
  const kanban = { id: 'k', kind: 'kanban-withdrawal', x: 0, y: 0, label: '', data: { replenishmentMin: 60, safetyPercent: 0, packSize: 5 } };
  const sizing = calculateKanbanSizing(kanban, assumptions);
  close(sizing.demandDuringReplenishment, 30);
  assert.equal(sizing.recommendedCards, 6);
});

test('peças por ciclo multiplicam a capacidade do processo', () => {
  const single = calculateCanvasSimulation(canvas([process('a', 0, 60)]));
  const five = calculateCanvasSimulation(canvas([process('a', 0, 60, { pecasCiclo: 5 })]));
  close(five.processMetrics[0].capacityPerDay, single.processMetrics[0].capacityPerDay * 5);
});
