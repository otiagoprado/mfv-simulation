// Motor de cálculo do MFV: takt, nivelamento, kanban, carga dos processos, lead time e fluxo ao vivo.
// Fica fora do App.tsx para ser testado direto no Node (por isso os imports com extensão .ts).
import { batchLeadTime, batchSettings, piecesPerCycleOf } from './batch.ts';
import { LIBRARY, makeId, type CanvasElement, type CanvasState, type ElementKind, type ProductMixItem, type ScenarioAssumptions } from './canvas-types.ts';
import { materialFlowOrder } from './flow-order.ts';
import { percentValue } from './numbers.ts';

export const KANBAN_CONTROL_KINDS: ElementKind[] = ['kanban-production','kanban-withdrawal','signal-kanban','kanban-post'];

export interface HeijunkaSlot {
  productId: string;
  name: string;
  code: string;
  color: string;
  packSize: number;
  pitchTimeSec: number;
}

export const PRODUCT_SEQUENCE_COLORS = ['#2f80ed','#f2994a','#27ae60','#9b51e0','#eb5757','#00a6a6','#c08b00','#536d8c'];

export function defaultElementDimensions(element: Pick<CanvasElement, 'kind'>) {
  if (element.kind === 'identification') return { width: 390, height: 100 };
  if (element.kind === 'planning') return { width: 190, height: 170 };
  const item = LIBRARY.find((candidate) => candidate.kind === element.kind);
  return { width: item?.w || 120, height: item?.h || 80 };
}

export function elementDimensions(element: CanvasElement) {
  const defaults = defaultElementDimensions(element);
  return {
    width: Math.min(1200, Math.max(30, Number(element.data.width) || defaults.width)),
    height: Math.min(800, Math.max(30, Number(element.data.height) || defaults.height)),
  };
}

export const DEFAULT_ASSUMPTIONS: ScenarioAssumptions = {
  monthlyDemand: 5,
  workdaysPerMonth: 21,
  availableMinutesPerDay: 558,
  productMix: [{ id: 'product-base', name: 'Produto principal', monthlyDemand: 5, packSize: 1 }],
};

export function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizedProductMix(value: unknown, fallbackDemand: number): ProductMixItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ id: 'product-base', name: 'Produto principal', monthlyDemand: fallbackDemand, packSize: 1 }];
  }
  const normalized = value.map((item, index) => {
    const candidate = item as Partial<ProductMixItem>;
    return {
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `product-${index + 1}-${makeId()}`,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `Produto ${index + 1}`,
      monthlyDemand: Math.max(0, Number(candidate.monthlyDemand) || 0),
      packSize: Math.max(1, Math.round(Number(candidate.packSize) || 1)),
    };
  });
  return normalized;
}

export function calculateScenario(assumptions: ScenarioAssumptions) {
  const productMix = normalizedProductMix(assumptions.productMix, assumptions.monthlyDemand);
  const monthlyDemand = productMix.reduce((sum, item) => sum + item.monthlyDemand, 0);
  const dailyDemand = monthlyDemand / assumptions.workdaysPerMonth;
  const taktTimeSec = dailyDemand > 0
    ? (assumptions.availableMinutesPerDay * 60) / dailyDemand
    : 0;
  const weightedPackSize = monthlyDemand > 0
    ? productMix.reduce((sum, item) => sum + item.packSize * item.monthlyDemand, 0) / monthlyDemand
    : 1;
  const pitchTimeSec = taktTimeSec * weightedPackSize;
  const productMetrics = productMix.map((item) => ({
    ...item,
    share: monthlyDemand > 0 ? item.monthlyDemand / monthlyDemand : 0,
    dailyDemand: item.monthlyDemand / assumptions.workdaysPerMonth,
    pitchTimeSec: taktTimeSec * item.packSize,
  }));
  return { monthlyDemand, dailyDemand, taktTimeSec, weightedPackSize, pitchTimeSec, productMetrics };
}

export function buildLeveledSequence(productMetrics: ReturnType<typeof calculateScenario>['productMetrics']) {
  const active = productMetrics.filter((item) => item.monthlyDemand > 0).map((item, index) => ({
    ...item,
    code: `P${index + 1}`,
    color: PRODUCT_SEQUENCE_COLORS[index % PRODUCT_SEQUENCE_COLORS.length],
    packsPerDay: item.packSize > 0 ? item.dailyDemand / item.packSize : 0,
    assigned: 0,
  }));
  const totalPacksPerDay = active.reduce((sum, item) => sum + item.packsPerDay, 0);
  if (!active.length || totalPacksPerDay <= 0) return { slots: [] as HeijunkaSlot[], totalPacksPerDay: 0 };
  const slotCount = Math.min(24, Math.max(active.length, Math.ceil(totalPacksPerDay)));
  const slots: HeijunkaSlot[] = [];
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const selected = active.reduce((best, item) => {
      const deficit = (item.packsPerDay / totalPacksPerDay) * (slotIndex + 1) - item.assigned;
      const bestDeficit = (best.packsPerDay / totalPacksPerDay) * (slotIndex + 1) - best.assigned;
      return deficit > bestDeficit ? item : best;
    }, active[0]);
    selected.assigned += 1;
    slots.push({ productId: selected.id, name: selected.name, code: selected.code, color: selected.color, packSize: selected.packSize, pitchTimeSec: selected.pitchTimeSec });
  }
  return { slots, totalPacksPerDay };
}

export function calculateKanbanSizing(element: CanvasElement, assumptions: ScenarioAssumptions) {
  const scenario = calculateScenario(assumptions);
  const productId = String(element.data.productId ?? '');
  const product = scenario.productMetrics.find((item) => item.id === productId);
  const dailyDemand = product?.dailyDemand ?? scenario.dailyDemand;
  const inheritedPackSize = product?.packSize ?? Math.max(1, Math.round(scenario.weightedPackSize));
  const packSize = Math.max(1, Math.round(Number(element.data.packSize) || inheritedPackSize));
  const replenishmentMin = Math.max(0, Number(element.data.replenishmentMin) || 0);
  const safetyPercent = Math.max(0, Number(element.data.safetyPercent) || 0);
  const demandDuringReplenishment = assumptions.availableMinutesPerDay > 0
    ? dailyDemand * (replenishmentMin / assumptions.availableMinutesPerDay)
    : 0;
  const protectedDemand = demandDuringReplenishment * (1 + safetyPercent / 100);
  const recommendedCards = protectedDemand > 0 ? Math.ceil(protectedDemand / packSize) : 0;
  const cards = Math.max(0, Math.floor(Number(element.data.qty) || 0));
  return {
    productId,
    productName: product?.name ?? 'Mix total',
    dailyDemand,
    packSize,
    replenishmentMin,
    safetyPercent,
    demandDuringReplenishment,
    recommendedCards,
    recommendedUnits: recommendedCards * packSize,
    cards,
    authorizedUnits: cards * packSize,
  };
}

export function calculateProcessLoad(element: CanvasElement, dailyDemand: number, cumulativeYield: number, availableMinutesPerDay: number) {
  const rawCycleTime = Math.max(0, Number(element.data.tc) || 0);
  // Um ciclo pode produzir várias peças de uma vez; o tempo por peça é o ciclo dividido por elas.
  const cycleTime = rawCycleTime / piecesPerCycleOf(element.data);
  const setupPerUnit = (Math.max(0, Number(element.data.setup) || 0) * 60)
    / Math.max(1, Number(element.data.lote) || 1);
  const resources = Math.max(1, Number(element.data.recurso) || 1);
  const availability = Math.min(100, Math.max(1, percentValue(element.data.disp))) / 100;
  const effectiveCycleSec = (cycleTime + setupPerUnit) / (resources * availability);
  const rawCapacityPerDay = effectiveCycleSec > 0
    ? (availableMinutesPerDay * 60) / effectiveCycleSec
    : Infinity;
  const requiredInputPerDay = cumulativeYield > 0 ? dailyDemand / cumulativeYield : Infinity;
  const capacityPerDay = rawCapacityPerDay * cumulativeYield;
  const loadPercent = rawCapacityPerDay > 0 && Number.isFinite(requiredInputPerDay)
    ? (requiredInputPerDay / rawCapacityPerDay) * 100
    : 0;
  const valid = rawCycleTime > 0;
  return { effectiveCycleSec, loadPercent, valid, overloaded: valid && loadPercent > 100, capacityPerDay, requiredInputPerDay };
}

export function nearestProcess(marker: CanvasElement, processes: CanvasElement[]) {
  if (!processes.length) return undefined;
  const markerSize = elementDimensions(marker);
  const markerCenter = { x: marker.x + markerSize.width / 2, y: marker.y + markerSize.height / 2 };
  return processes.reduce((nearest, process) => {
    const processSize = elementDimensions(process);
    const distance = Math.hypot(
      markerCenter.x - (process.x + processSize.width / 2),
      markerCenter.y - (process.y + processSize.height / 2),
    );
    return !nearest || distance < nearest.distance ? { process, distance } : nearest;
  }, undefined as { process: CanvasElement; distance: number } | undefined)?.process;
}

export function calculateCanvasSimulation(canvas: CanvasState) {
  const scenario = calculateScenario(canvas.assumptions);
  const leveling = buildLeveledSequence(scenario.productMetrics);
  const { dailyDemand, taktTimeSec } = scenario;
  const rawMaterialEntry = canvas.elements
    .filter((element) => element.kind === 'raw-material')
    .sort((a, b) => a.x - b.x)[0];
  const finalCustomer = canvas.elements
    .filter((element) => element.kind === 'customer')
    .sort((a, b) => b.x - a.x)[0];
  // Os produtos prontos se acumulam na expedição e só saem quando completam o lote de expedição.
  const shippingPoint = canvas.elements
    .filter((element) => element.kind === 'shipping-point')
    .sort((a, b) => b.x - a.x)[0];
  const shippingLot = Math.max(1, Math.round(Number(shippingPoint?.data.lote) || 1));
  const routeKinds: ElementKind[] = [
    'warehouse','inventory','safety-stock','buffer','supermarket','fifo','process','shared-process','waiting-time',
    'finished-goods','shipping-point','truck','transport-air','transport-ship','forklift','milk-run',
  ];
  const routeStartX = rawMaterialEntry ? rawMaterialEntry.x + elementDimensions(rawMaterialEntry).width / 2 : 0;
  const routeEndX = finalCustomer ? finalCustomer.x + elementDimensions(finalCustomer).width / 2 : 0;
  const productionRouteElements = rawMaterialEntry && finalCustomer
    ? [
        rawMaterialEntry,
        ...canvas.elements
          .filter((element) => routeKinds.includes(element.kind))
          .filter((element) => {
            const centerX = element.x + elementDimensions(element).width / 2;
            return centerX >= Math.min(routeStartX, routeEndX) && centerX <= Math.max(routeStartX, routeEndX);
          })
          .sort((a, b) => routeStartX <= routeEndX ? a.x - b.x : b.x - a.x),
        finalCustomer,
      ]
    : [];
  const flowOrder = materialFlowOrder(canvas.elements, canvas.arrows);
  const processElements = flowOrder.processes;
  let cumulativeYield = 1;
  const processMetrics = [...processElements].reverse().map((element) => {
    const quality = Math.min(100, Math.max(0.1, percentValue(element.data.qualidade))) / 100;
    cumulativeYield *= quality;
    const batch = batchSettings(element);
    return {
      element,
      quality,
      batch,
      batchLead: batchLeadTime(batch, taktTimeSec),
      ...calculateProcessLoad(element, dailyDemand, cumulativeYield, canvas.assumptions.availableMinutesPerDay),
    };
  }).reverse();
  const batchProcessCount = processMetrics.filter((metric) => metric.batch.mode === 'lote').length;
  const batchLeadTimeSec = processMetrics.reduce((sum, metric) => sum + metric.batchLead.totalSec, 0);
  const batchLeadTimeDays = canvas.assumptions.availableMinutesPerDay > 0
    ? batchLeadTimeSec / (canvas.assumptions.availableMinutesPerDay * 60)
    : 0;
  const finiteCapacities = processMetrics.map((metric) => metric.capacityPerDay).filter(Number.isFinite);
  const bottleneckCapacity = finiteCapacities.length ? Math.min(...finiteCapacities) : 0;
  const bottleneck = processMetrics.find((metric) => metric.capacityPerDay === bottleneckCapacity)?.element;
  const pacemakerMarkers = canvas.elements.filter((element) => element.kind === 'pacemaker');
  const pacemakerMarker = pacemakerMarkers[0];
  const linkedPacemaker = pacemakerMarker
    ? processElements.find((element) => element.id === pacemakerMarker.data.processId)
      ?? nearestProcess(pacemakerMarker, processElements)
    : undefined;
  const pacemakerMetric = processMetrics.find((metric) => metric.element.id === linkedPacemaker?.id);
  const pacemakerSetupSec = Math.max(0, Number(linkedPacemaker?.data.setup) || 0) * 60;
  const availableSeconds = canvas.assumptions.availableMinutesPerDay * 60;
  const pacemakerResources = Math.max(1, Number(linkedPacemaker?.data.recurso) || 1);
  const pacemakerAvailability = Math.min(100, Math.max(1, percentValue(linkedPacemaker?.data.disp))) / 100;
  const pacemakerRunSecPerDay = linkedPacemaker
    ? (Math.max(0, Number(linkedPacemaker.data.tc) || 0) / (pacemakerResources * pacemakerAvailability)) * dailyDemand
    : 0;
  const setupCapacitySecPerDay = Math.max(0, availableSeconds - pacemakerRunSecPerDay);
  const activeProductCount = scenario.productMetrics.filter((item) => item.monthlyDemand > 0).length;
  const mixChangeovers = activeProductCount > 1 ? activeProductCount : 0;
  const epeiDays = mixChangeovers > 0 && pacemakerSetupSec > 0 && setupCapacitySecPerDay > 0
    ? (mixChangeovers * pacemakerSetupSec) / setupCapacitySecPerDay
    : mixChangeovers > 0 && pacemakerSetupSec > 0
      ? Infinity
      : 0;
  const heijunkaBoxes = canvas.elements.filter((element) => element.kind === 'heijunka');
  const pullBuffers = canvas.elements.filter((element) => ['supermarket','fifo'].includes(element.kind));
  const kanbanControls = canvas.elements.filter((element) => KANBAN_CONTROL_KINDS.includes(element.kind));
  const kanbanSizing = kanbanControls.map((element) => ({ element, ...calculateKanbanSizing(element, canvas.assumptions) }));
  const kanbanCardTotal = kanbanSizing.reduce((sum, sizing) => sum + sizing.cards, 0);
  const kanbanAuthorizedUnits = kanbanSizing.reduce((sum, sizing) => sum + sizing.authorizedUnits, 0);
  const configuredPullLimits = [
    ...pullBuffers.map((element) => Math.floor(Math.max(0, Number(element.data.qty) || 0))),
    ...kanbanSizing.map((sizing) => sizing.authorizedUnits),
  ]
    .filter((quantity) => quantity > 0);
  const pullWipLimit = configuredPullLimits.length ? Math.min(...configuredPullLimits) : 0;
  const pullSystemActive = pullBuffers.length > 0 && kanbanControls.length > 0 && pullWipLimit > 0;
  const leanWarnings: string[] = [];
  if (!pacemakerMarker) leanWarnings.push('Defina um processo marcapasso.');
  if (pacemakerMarkers.length > 1) leanWarnings.push('Mantenha somente um marcapasso.');
  if (pacemakerMarker && !linkedPacemaker) leanWarnings.push('Vincule o marcapasso a um processo.');
  if (heijunkaBoxes.length > 0 && !linkedPacemaker) leanWarnings.push('O heijunka precisa de um marcapasso válido.');
  if (pullBuffers.length > 0 && kanbanControls.length === 0) leanWarnings.push('Adicione Kanban ao supermercado ou FIFO.');
  if (kanbanControls.length > 0 && pullBuffers.length === 0) leanWarnings.push('Adicione supermercado ou FIFO ao circuito Kanban.');
  if ((pullBuffers.length > 0 || kanbanControls.length > 0) && pullWipLimit === 0) leanWarnings.push('Informe um limite maior que zero no controle puxado.');
  const stockKinds: ElementKind[] = ['inventory','safety-stock','buffer','supermarket','fifo','waiting-time'];
  const inventoryElements = canvas.elements
    .filter((element) => stockKinds.includes(element.kind))
    .sort((a, b) => a.x - b.x);
  const physicalInventoryElements = inventoryElements.filter((element) => element.kind !== 'waiting-time');
  const waitingElements = inventoryElements.filter((element) => element.kind === 'waiting-time');
  const totalInventory = physicalInventoryElements
    .reduce((sum, element) => sum + Math.max(0, Number(element.data.qty) || 0), 0);
  const inventoryDays = dailyDemand > 0 ? totalInventory / dailyDemand : 0;
  const waitingTimeMin = waitingElements.reduce((sum, element) => sum + Math.max(0, Number(element.data.durationMin) || 0), 0);
  const waitingLeadTimeDays = canvas.assumptions.availableMinutesPerDay > 0 ? waitingTimeMin / canvas.assumptions.availableMinutesPerDay : 0;
  const processingTimeMin = processElements.reduce((sum, element) => sum + Math.max(0, Number(element.data.tc) || 0), 0) / 60;
  const timelineItems = [
    ...processElements.map((element) => {
      const size = elementDimensions(element);
      return {
        id: element.id,
        type: 'process' as const,
        x: element.x + size.width / 2,
        width: size.width,
        value: Math.max(0, Number(element.data.tc) || 0) / 60,
      };
    }),
    ...inventoryElements.map((element) => {
      const size = elementDimensions(element);
      const value = element.kind === 'waiting-time'
        ? Math.max(0, Number(element.data.durationMin) || 0) / canvas.assumptions.availableMinutesPerDay
        : dailyDemand > 0
          ? Math.max(0, Number(element.data.qty) || 0) / dailyDemand
          : 0;
      return { id: element.id, type: 'inventory' as const, x: element.x + size.width / 2, width: size.width, value };
    }),
  ].sort((a, b) => a.x - b.x);
  return {
    dailyDemand,
    taktTimeSec,
    monthlyDemand: scenario.monthlyDemand,
    productMetrics: scenario.productMetrics,
    activeProductCount,
    weightedPackSize: scenario.weightedPackSize,
    pitchTimeSec: scenario.pitchTimeSec,
    epeiDays,
    leveledSequence: leveling.slots,
    totalPacksPerDay: leveling.totalPacksPerDay,
    processElements,
    flowOrderSource: flowOrder.source,
    processMetrics,
    invalidProcesses: processMetrics.filter((metric) => !metric.valid),
    overloadedProcesses: processMetrics.filter((metric) => metric.overloaded),
    bottleneckCapacity,
    bottleneck,
    pacemakerMarkers,
    pacemaker: linkedPacemaker,
    pacemakerMetric,
    heijunkaBoxes,
    pullBuffers,
    kanbanControls,
    kanbanSizing,
    kanbanCardTotal,
    kanbanAuthorizedUnits,
    pullWipLimit,
    pullSystemActive,
    leanWarnings,
    inventoryDays,
    waitingTimeMin,
    waitingLeadTimeDays,
    batchProcessCount,
    batchLeadTimeSec,
    batchLeadTimeDays,
    processingTimeMin,
    leadTimeDays: inventoryDays + waitingLeadTimeDays + batchLeadTimeDays,
    timelineItems,
    inventoryElements,
    rawMaterialEntry,
    finalCustomer,
    shippingPoint,
    shippingLot,
    routeReady: Boolean(rawMaterialEntry && finalCustomer),
    productionRouteElements,
  };
}

/** Tempo de deslocamento entre dois processos na simulação ao vivo. */
export const LIVE_TRANSIT_SEC = 60;
/** A simulação ao vivo segue por vários dias úteis seguidos, para os lotes atravessarem a linha inteira. */
export const LIVE_MAX_DAYS = 10;

export type LiveUnitStage =
  /** A caminho do processo `station` (ou do cliente, quando `station` é o número de processos). */
  | { kind: 'transit'; station: number; progress: number }
  /** No buffer de entrada do processo, esperando a vez ou o lote completar. */
  | { kind: 'queue'; station: number; position: number }
  /** Em setup ou sendo produzida no processo. */
  | { kind: 'processing'; station: number; position: number }
  /** Pronta no buffer de saída, esperando o restante do lote para seguir. */
  | { kind: 'holding'; station: number; position: number }
  /** Produto acabado na expedição, esperando completar o lote de expedição. */
  | { kind: 'shipping'; station: number; position: number };

export interface LiveUnit {
  index: number;
  packIndex: number;
  product: HeijunkaSlot;
  stage: LiveUnitStage;
}

export interface LiveStationState {
  id: string;
  waiting: number;
  processing: number;
  holding: number;
}

interface LiveStation {
  id: string;
  batchMode: boolean;
  batchSize: number;
  transferBatch: number;
  setupSec: number;
  /** Peças processadas juntas em um ciclo. */
  piecesPerCycle: number;
  /** Duração de um ciclo (todas as suas peças). */
  cycleSec: number;
}

/**
 * Simula o dia peça a peça: cada peça é liberada no ritmo programado, atravessa os processos
 * em ordem (fila única por processo) e respeita a fabricação por lotes. Devolve onde cada peça
 * está em `elapsedSec` e os totais exibidos no painel da simulação.
 */
export function calculateLiveFlow(simulation: ReturnType<typeof calculateCanvasSimulation>, assumptions: ScenarioAssumptions, elapsedSec: number) {
  const availableSeconds = assumptions.availableMinutesPerDay * 60;
  const pacemakerInterval = simulation.pacemakerMetric?.capacityPerDay && Number.isFinite(simulation.pacemakerMetric.capacityPerDay)
    ? availableSeconds / simulation.pacemakerMetric.capacityPerDay
    : 0;
  const packSize = Math.max(1, Math.round(simulation.weightedPackSize));
  const fallbackSlot: HeijunkaSlot = { productId: 'product-base', name: 'Produto', code: 'P1', color: PRODUCT_SEQUENCE_COLORS[0], packSize, pitchTimeSec: simulation.pitchTimeSec };
  const sequence = simulation.leveledSequence.length ? simulation.leveledSequence : [fallbackSlot];
  const stations: LiveStation[] = simulation.processMetrics.map((metric) => ({
    id: metric.element.id,
    batchMode: metric.batch.mode === 'lote',
    batchSize: metric.batch.batchSize,
    transferBatch: metric.batch.transferBatch,
    setupSec: metric.batch.setupMin * 60,
    piecesPerCycle: metric.batch.piecesPerCycle,
    // No fluxo unitário o setup é diluído por peça (tempo efetivo); por lote ele entra no início do lote.
    cycleSec: (metric.batch.mode === 'lote' ? metric.batch.runCycleSec : metric.effectiveCycleSec) * metric.batch.piecesPerCycle,
  }));
  // O primeiro processo é alimentado pela matéria-prima, que já está disponível: um ciclo de várias
  // peças puxa o material do ciclo inteiro de uma vez, então as liberações são agrupadas por ciclo.
  const firstCycle = stations[0]?.piecesPerCycle ?? 1;
  const demandedBatches: { batchIndex: number; product: HeijunkaSlot; packSize: number; releaseTime: number; interval: number }[] = [];
  let scheduledTime = 0;
  let batchIndex = 0;
  let unitsSoFar = 0;
  while ((scheduledTime <= elapsedSec || unitsSoFar % firstCycle !== 0) && scheduledTime < availableSeconds * LIVE_MAX_DAYS && batchIndex < 5000) {
    const product = sequence[batchIndex % sequence.length];
    const interval = Math.max(product.pitchTimeSec, pacemakerInterval * product.packSize);
    if (!Number.isFinite(interval) || interval <= 0) break;
    demandedBatches.push({ batchIndex, product, packSize: product.packSize, releaseTime: scheduledTime, interval });
    scheduledTime += interval;
    batchIndex += 1;
    unitsSoFar += product.packSize;
  }
  const demandedPacks = demandedBatches.length;
  const demanded = demandedBatches.reduce((sum, batch) => sum + batch.packSize, 0);
  const finalLegSec = LIVE_TRANSIT_SEC + simulation.waitingTimeMin * 60;
  const shippingLot = simulation.shippingLot;
  const units = demandedBatches.flatMap((batch) => Array.from({ length: batch.packSize }, () => batch));
  const scheduled = units.map((batch, unit) => firstCycle > 1 ? units[Math.floor(unit / firstCycle) * firstCycle].releaseTime : batch.releaseTime);
  const wipLimit = simulation.pullSystemActive ? Math.max(1, simulation.pullWipLimit) : Infinity;

  // Linha do tempo de cada peça em cada processo: chegada, início, fim da produção e saída.
  const runTimeline = (release: number[]) => {
    const arrival: number[][] = [];
    const start: number[][] = [];
    const finish: number[][] = [];
    const depart: number[][] = [];
    stations.forEach((station, stationIndex) => {
      const previous = stationIndex === 0 ? release : depart[stationIndex - 1];
      const stationArrival = previous.map((time) => time + LIVE_TRANSIT_SEC);
      const stationStart = units.map(() => Infinity);
      const stationFinish = units.map(() => Infinity);
      const stationDepart = units.map(() => Infinity);
      let freeAt = 0;
      // Um ciclo processa até `piecesPerCycle` peças juntas (ex.: masseira para 5 pães): espera o ciclo
      // encher e produz todas ao mesmo tempo. Com 1 peça por ciclo é o fluxo peça a peça.
      // O setup por lote entra no ciclo que começa um lote novo.
      let next = 0;
      while (next < units.length && Number.isFinite(stationArrival[next])) {
        const members: number[] = [];
        while (members.length < station.piecesPerCycle && next < units.length && Number.isFinite(stationArrival[next])) {
          members.push(next);
          next += 1;
        }
        // Ciclo incompleto (as demais peças ainda não foram liberadas) fica esperando na entrada.
        if (members.length < station.piecesPerCycle) break;
        const ready = Math.max(...members.map((unit) => stationArrival[unit]));
        const setup = station.batchMode && members.some((unit) => unit % station.batchSize === 0) ? station.setupSec : 0;
        const start = Math.max(ready, freeAt);
        const finish = start + setup + station.cycleSec;
        members.forEach((unit) => {
          stationStart[unit] = start;
          stationFinish[unit] = finish;
        });
        freeAt = finish;
      }
      if (!station.batchMode) {
        units.forEach((_, unit) => { stationDepart[unit] = stationFinish[unit]; });
      } else {
        // O lote é regra de saída, não de entrada: a peça entra em produção assim que chega
        // e fica no buffer de saída até o lote completar. O lote inteiro segue junto quando a última fica pronta.
        for (let first = 0; first < units.length; first += station.batchSize) {
          const members = Array.from({ length: Math.min(station.batchSize, units.length - first) }, (_, offset) => first + offset);
          const complete = members.length === station.batchSize && members.every((unit) => Number.isFinite(stationFinish[unit]));
          const groupReady = complete ? Math.max(...members.map((unit) => stationFinish[unit])) : Infinity;
          members.forEach((unit) => { stationDepart[unit] = groupReady; });
        }
      }
      arrival.push(stationArrival);
      start.push(stationStart);
      finish.push(stationFinish);
      depart.push(stationDepart);
    });
    const lastDepart = stations.length ? depart[stations.length - 1] : release;
    const shippingArrival = lastDepart.map((time) => time + finalLegSec);
    // Cada lote de expedição sai junto quando a última peça dele chega; lote incompleto fica esperando.
    const exit = shippingArrival.map((_, unit) => {
      const first = Math.floor(unit / shippingLot) * shippingLot;
      const members = shippingArrival.slice(first, first + shippingLot);
      return members.length === shippingLot ? Math.max(...members) : Infinity;
    });
    return { arrival, start, finish, depart, shippingArrival, exit };
  };

  // No sistema puxado, uma peça só é liberada quando outra sai e abre espaço no limite de WIP.
  let release = [...scheduled];
  let timeline = runTimeline(release);
  if (Number.isFinite(wipLimit)) {
    for (let pass = 0; pass < 30; pass += 1) {
      const gated = scheduled.map((time, unit) => unit >= wipLimit ? Math.max(time, timeline.exit[unit - wipLimit]) : time);
      if (gated.every((time, unit) => time === release[unit])) break;
      release = gated;
      timeline = runTimeline(release);
    }
  }

  const launchedUnits = units.map((_, unit) => unit).filter((unit) => release[unit] <= elapsedSec);
  const launchedBatches = demandedBatches.filter((batch) => units.some((candidate, unit) => candidate === batch && release[unit] <= elapsedSec));
  const stationStates: LiveStationState[] = stations.map((station) => ({ id: station.id, waiting: 0, processing: 0, holding: 0 }));
  const liveUnits: LiveUnit[] = [];
  let completed = 0;
  let shippingWaiting = 0;
  launchedUnits.forEach((unit) => {
    if (timeline.exit[unit] <= elapsedSec) {
      completed += 1;
      return;
    }
    let stage: LiveUnitStage | null = null;
    for (let station = 0; station < stations.length && !stage; station += 1) {
      const leftAt = station === 0 ? release[unit] : timeline.depart[station - 1][unit];
      const arrival = timeline.arrival[station][unit];
      if (elapsedSec < arrival) stage = { kind: 'transit', station, progress: (elapsedSec - leftAt) / Math.max(1, arrival - leftAt) };
      else if (elapsedSec < timeline.start[station][unit]) stage = { kind: 'queue', station, position: stationStates[station].waiting++ };
      else if (elapsedSec < timeline.finish[station][unit]) stage = { kind: 'processing', station, position: stationStates[station].processing++ };
      else if (elapsedSec < timeline.depart[station][unit]) stage = { kind: 'holding', station, position: stationStates[station].holding++ };
    }
    if (!stage) {
      const leftAt = stations.length ? timeline.depart[stations.length - 1][unit] : release[unit];
      const arrival = timeline.shippingArrival[unit];
      stage = elapsedSec < arrival
        ? { kind: 'transit', station: stations.length, progress: (elapsedSec - leftAt) / Math.max(1, arrival - leftAt) }
        : { kind: 'shipping', station: stations.length, position: shippingWaiting++ };
    }
    const batch = units[unit];
    liveUnits.push({ index: unit, packIndex: batch.batchIndex, product: batch.product, stage });
  });

  const launched = launchedUnits.length;
  const completionInterval = simulation.bottleneckCapacity > 0 ? availableSeconds / simulation.bottleneckCapacity : Infinity;
  return {
    releaseInterval: demandedBatches[demandedBatches.length - 1]?.interval ?? Math.max(simulation.pitchTimeSec, pacemakerInterval * packSize),
    packSize,
    demandedPacks,
    demandedBatches,
    launchedBatches,
    demanded,
    launched,
    completed,
    wip: Math.max(0, launched - completed),
    blocked: Math.max(0, demanded - launched),
    completionInterval,
    units: liveUnits,
    stations: stationStates,
    shipping: { waiting: shippingWaiting, lot: shippingLot },
  };
}
