import assert from 'node:assert/strict';
import test from 'node:test';
import { materialFlowOrder } from '../engine/flow-order.ts';
import { runStressTest } from '../engine/stress-test.ts';

const process = (id, x, data = {}) => ({ id, kind: 'process', x, y: 0, label: id, data: { tc: 60, setup: 0, lote: 1, recurso: 1, disp: 100, qualidade: 100, ...data } });
const arrow = (from, to, kind = 'arrow-push') => ({
  id: `${from}-${to}`, kind, x1: 0, y1: 0, x2: 1, y2: 1,
  startAnchor: { elementId: from, x: 1, y: 0.5 }, endAnchor: { elementId: to, x: 0, y: 0.5 },
});
const ids = (order) => order.processes.map((element) => element.id);

test('sem setas a ordem segue a posição no mapa', () => {
  const order = materialFlowOrder([process('b', 300), process('a', 0), process('c', 600)]);
  assert.deepEqual(ids(order), ['a', 'b', 'c']);
  assert.equal(order.source, 'posicao');
});

test('setas de material definem a ordem mesmo contra a posição', () => {
  const elements = [process('c', 0), process('a', 300), process('b', 600)];
  const order = materialFlowOrder(elements, [arrow('a', 'b'), arrow('b', 'c')]);
  assert.deepEqual(ids(order), ['a', 'b', 'c']);
  assert.equal(order.source, 'setas');
});

test('o caminho passa por estoques e os registra entre os processos', () => {
  const stock = { id: 'stock', kind: 'inventory', x: 900, y: 0, label: '', data: { qty: 40 } };
  const order = materialFlowOrder([process('b', 0), process('a', 300), stock], [arrow('a', 'stock'), arrow('stock', 'b')]);
  assert.deepEqual(ids(order), ['a', 'b']);
  assert.deepEqual(order.between.get('a').map((element) => element.id), ['stock']);
});

test('seta puxada vai do cliente ao fornecedor e é lida no sentido contrário', () => {
  const order = materialFlowOrder([process('b', 0), process('a', 300)], [arrow('b', 'a', 'arrow-pull')]);
  assert.deepEqual(ids(order), ['a', 'b']);
});

test('setas de informação não alteram a ordem', () => {
  const order = materialFlowOrder([process('a', 0), process('b', 300)], [arrow('b', 'a', 'arrow-info-manual')]);
  assert.deepEqual(ids(order), ['a', 'b']);
  assert.equal(order.source, 'posicao');
});

test('ciclo de retrabalho não trava a ordenação', () => {
  const order = materialFlowOrder([process('a', 0), process('b', 300)], [arrow('a', 'b'), arrow('b', 'a')]);
  assert.deepEqual(ids(order).sort(), ['a', 'b']);
});

test('teste de estresse usa a ordem e os estoques ligados pelas setas', () => {
  const assumptions = {
    monthlyDemand: 0, workdaysPerMonth: 20, availableMinutesPerDay: 480,
    productMix: [{ id: 'product-a', name: 'Produto A', monthlyDemand: 6000, packSize: 1 }],
  };
  const settings = {
    days: 1, demandPercent: 100, cycleVariationPercent: 0, extraDowntimePercent: 0,
    shiftsPerDay: 1, minutesPerShift: 480, breakMinutesPerShift: 0,
    failureProcessId: '', failureStartMinute: 0, failureDurationMinutes: 0,
    supplierDelayMinutes: 0, transportDelayMinutes: 0,
  };
  const stock = { id: 'stock', kind: 'inventory', x: 1000, y: 0, label: '', data: { qty: 100 } };
  const elements = [process('assembly', 0), process('cut', 500), stock];
  const result = runStressTest(elements, assumptions, settings, [arrow('cut', 'stock'), arrow('stock', 'assembly')]);
  assert.deepEqual(result.processResults.map((item) => item.id), ['cut', 'assembly']);
  assert.ok(result.processResults[1].maxQueue >= 100);
});
