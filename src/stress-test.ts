// Extensão explícita: os testes executam este arquivo direto no Node.
import { batchSettings, type BatchSettings } from './batch.ts';
import { percentValue } from './numbers.ts';
import type { CanvasArrow, CanvasElement, ScenarioAssumptions } from './canvas-types';
import { materialFlowOrder } from './flow-order.ts';

export interface StressTestSettings {
  days: number;
  demandPercent: number;
  cycleVariationPercent: number;
  extraDowntimePercent: number;
  shiftsPerDay: number;
  minutesPerShift: number;
  breakMinutesPerShift: number;
  failureProcessId: string;
  failureStartMinute: number;
  failureDurationMinutes: number;
  supplierDelayMinutes: number;
  transportDelayMinutes: number;
}

export interface StressProcessResult {
  id: string;
  label: string;
  produced: number;
  goodOutput: number;
  utilizationPercent: number;
  maxQueue: number;
  starvationMinutes: number;
  blockedMinutes: number;
  lostMinutes: number;
  breakMinutes: number;
  failureMinutes: number;
  downtimeMinutes: number;
  /** Minutos com material na entrada, mas aguardando completar o lote de produção. */
  batchWaitMinutes: number;
  batchMode: boolean;
  effectiveCycleSec: number;
}

export interface StressDayResult {
  day: number;
  required: number;
  delivered: number;
  backlog: number;
  serviceLevelPercent: number;
  wip: number;
}

export interface StressTestResult {
  status: 'stable' | 'attention' | 'rupture' | 'invalid';
  requestedUnits: number;
  deliveredUnits: number;
  backlogUnits: number;
  serviceLevelPercent: number;
  maxWip: number;
  ruptureDay: number | null;
  constraintId: string | null;
  constraintLabel: string;
  headline: string;
  explanation: string;
  recommendation: string;
  processResults: StressProcessResult[];
  dayResults: StressDayResult[];
}

interface PreparedProcess {
  element: CanvasElement;
  effectiveCycleSec: number;
  capacityPerMinute: number;
  quality: number;
  bufferLimit: number;
  initialQueue: number;
  batch: BatchSettings;
}

const STOCK_KINDS = ['inventory', 'safety-stock', 'buffer', 'supermarket', 'fifo'] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function elementWidth(element: CanvasElement) {
  return Math.max(30, Number(element.data.width) || (element.kind === 'shared-process' ? 170 : 150));
}

function isStock(element: CanvasElement) {
  return STOCK_KINDS.includes(element.kind as typeof STOCK_KINDS[number]);
}

function prepareProcesses(elements: CanvasElement[], arrows: CanvasArrow[]) {
  const flowOrder = materialFlowOrder(elements, arrows);
  const rawProcesses = flowOrder.processes;
  const stocks = elements.filter(isStock);

  return rawProcesses.map((element, index): PreparedProcess => {
    const cycleTime = Math.max(0, Number(element.data.tc) || 0);
    const setupPerUnitSec = (Math.max(0, Number(element.data.setup) || 0) * 60)
      / Math.max(1, Number(element.data.lote) || 1);
    const resources = Math.max(1, Number(element.data.recurso) || 1);
    const availability = clamp(percentValue(element.data.disp), 1, 100) / 100;
    const quality = clamp(percentValue(element.data.qualidade), 0.1, 100) / 100;
    const effectiveCycleSec = cycleTime > 0 ? (cycleTime + setupPerUnitSec) / (resources * availability) : 0;
    const next = rawProcesses[index + 1];
    const processEnd = element.x + elementWidth(element);
    const nextStart = next?.x ?? Infinity;
    // Estoques ligados por setas entre os dois processos; sem eles, vale o que está entre os dois na tela.
    const linkedStocks = (flowOrder.between.get(element.id) ?? []).filter(isStock);
    const stockBetween = linkedStocks.length ? linkedStocks : stocks.filter((stock) => {
      const center = stock.x + Math.max(30, Number(stock.data.width) || 70) / 2;
      return center > processEnd && center < nextStart;
    });
    const initialQueue = stockBetween.reduce((sum, stock) => sum + Math.max(0, Number(stock.data.qty) || 0), 0);
    const controlledLimits = stockBetween
      .filter((stock) => stock.kind === 'supermarket' || stock.kind === 'fifo' || stock.kind === 'buffer')
      .map((stock) => Math.max(0, Number(stock.data.qty) || 0))
      .filter((quantity) => quantity > 0);
    const bufferLimit = controlledLimits.length ? Math.min(...controlledLimits) : Infinity;
    return {
      element,
      effectiveCycleSec,
      capacityPerMinute: effectiveCycleSec > 0 ? 60 / effectiveCycleSec : 0,
      quality,
      bufferLimit,
      initialQueue: index === rawProcesses.length - 1 ? 0 : initialQueue,
      batch: batchSettings(element),
    };
  });
}

export function runStressTest(
  elements: CanvasElement[],
  assumptions: ScenarioAssumptions,
  settings: StressTestSettings,
  arrows: CanvasArrow[] = [],
): StressTestResult {
  const days = clamp(Math.round(settings.days) || 1, 1, 30);
  const shiftsPerDay = clamp(Math.round(settings.shiftsPerDay) || 1, 1, 3);
  const minutesPerShift = clamp(Math.round(settings.minutesPerShift) || Math.round(assumptions.availableMinutesPerDay) || 1, 60, 720);
  const minutesPerDay = shiftsPerDay * minutesPerShift;
  const breakMinutesPerShift = clamp(Math.round(settings.breakMinutesPerShift) || 0, 0, Math.max(0, minutesPerShift - 1));
  const failureStartMinute = clamp(Math.round(settings.failureStartMinute) || 0, 0, Math.max(0, minutesPerDay - 1));
  const failureDurationMinutes = clamp(Math.round(settings.failureDurationMinutes) || 0, 0, minutesPerDay);
  const supplierDelayMinutes = clamp(Math.round(settings.supplierDelayMinutes) || 0, 0, minutesPerDay);
  const transportDelayMinutes = clamp(Math.round(settings.transportDelayMinutes) || 0, 0, minutesPerDay * 2);
  const workdays = Math.max(1, assumptions.workdaysPerMonth);
  const baseDailyDemand = Math.max(0, assumptions.productMix.reduce((sum, product) => sum + Math.max(0, product.monthlyDemand), 0)) / workdays;
  const dailyDemand = baseDailyDemand * clamp(settings.demandPercent, 10, 300) / 100;
  const variation = clamp(settings.cycleVariationPercent, 0, 100) / 100;
  const downtime = clamp(settings.extraDowntimePercent, 0, 80) / 100;
  const processes = prepareProcesses(elements, arrows);

  if (!processes.length || processes.some((process) => process.effectiveCycleSec <= 0) || dailyDemand <= 0) {
    return {
      status: 'invalid', requestedUnits: 0, deliveredUnits: 0, backlogUnits: 0,
      serviceLevelPercent: 0, maxWip: 0, ruptureDay: null, constraintId: null,
      constraintLabel: 'Dados incompletos',
      headline: 'O teste ainda não pode ser executado',
      explanation: dailyDemand <= 0
        ? 'Informe uma demanda maior que zero para gerar a carga do cenário.'
        : 'Preencha o tempo de ciclo de todos os processos produtivos antes de testar o fluxo.',
      recommendation: 'Complete os dados destacados no MFV e execute o teste novamente.',
      processResults: [], dayResults: [],
    };
  }

  const totalMinutes = days * minutesPerDay;
  const queues = Array.from({ length: processes.length }, (_, index) => index === 0 ? 0 : processes[index - 1].initialQueue);
  const produced = processes.map(() => 0);
  const goodOutput = processes.map(() => 0);
  const busyMinutes = processes.map(() => 0);
  const starvationMinutes = processes.map(() => 0);
  const blockedMinutes = processes.map(() => 0);
  const lostMinutes = processes.map(() => 0);
  const breakMinutes = processes.map(() => 0);
  const failureMinutes = processes.map(() => 0);
  const downtimeMinutes = processes.map(() => 0);
  const batchWaitMinutes = processes.map(() => 0);
  // Estado dos processos em lote: entrada já retirada da fila, setup pendente e saída aguardando transferência.
  const batchRemaining = processes.map(() => 0);
  const setupRemaining = processes.map(() => 0);
  const transferProgress = processes.map(() => 0);
  const outputHold = processes.map(() => 0);
  const maxQueues = processes.map((_, index) => queues[index]);
  const supplierWindowMinutes = Math.max(1, minutesPerDay - supplierDelayMinutes);
  const dailyReleaseRate = supplierDelayMinutes < minutesPerDay ? dailyDemand / supplierWindowMinutes : 0;
  const pendingDeliveries = Array.from({ length: totalMinutes + transportDelayMinutes + 1 }, () => 0);
  let unitsInTransport = 0;
  let delivered = 0;
  let maxWip = queues.reduce((sum, queue) => sum + queue, 0);
  let ruptureDay: number | null = null;
  const dayResults: StressDayResult[] = [];
  const currentWip = () => queues.reduce((sum, queue) => sum + queue, 0)
    + batchRemaining.reduce((sum, units) => sum + units, 0)
    + outputHold.reduce((sum, units) => sum + units, 0)
    + unitsInTransport;
  const deliverFromLast = (minute: number, good: number) => {
    if (transportDelayMinutes <= 0) delivered += good;
    else {
      pendingDeliveries[minute + transportDelayMinutes] += good;
      unitsInTransport += good;
    }
  };
  /** Libera a saída retida de um processo em lote; devolve false se o próximo estoque não tem espaço. */
  const releaseBatchOutput = (index: number, minute: number) => {
    if (outputHold[index] <= 0.0001) return true;
    if (index === processes.length - 1) {
      deliverFromLast(minute, outputHold[index]);
      outputHold[index] = 0;
      return true;
    }
    const space = Math.max(0, processes[index].bufferLimit - queues[index + 1]);
    const moved = Math.min(outputHold[index], space);
    queues[index + 1] += moved;
    outputHold[index] -= moved;
    return outputHold[index] <= 0.0001;
  };

  for (let minute = 0; minute < totalMinutes; minute += 1) {
    const minuteInDay = minute % minutesPerDay;
    const arrivingCustomer = pendingDeliveries[minute] || 0;
    if (arrivingCustomer > 0) {
      delivered += arrivingCustomer;
      unitsInTransport = Math.max(0, unitsInTransport - arrivingCustomer);
    }
    if (minuteInDay >= supplierDelayMinutes) queues[0] += dailyReleaseRate;

    for (let index = processes.length - 1; index >= 0; index -= 1) {
      const process = processes[index];
      const minuteInShift = minuteInDay % minutesPerShift;
      const breakStart = Math.floor((minutesPerShift - breakMinutesPerShift) / 2);
      const plannedBreak = breakMinutesPerShift > 0 && minuteInShift >= breakStart && minuteInShift < breakStart + breakMinutesPerShift;
      const specificFailure = process.element.id === settings.failureProcessId
        && failureDurationMinutes > 0
        && minuteInDay >= failureStartMinute
        && minuteInDay < failureStartMinute + failureDurationMinutes;
      const stopWindow = Math.round(minutesPerDay * downtime);
      const stopStart = stopWindow > 0
        ? Math.floor(((index + 1) * minutesPerDay) / (processes.length + 2))
        : -1;
      const stopped = stopWindow > 0 && minuteInDay >= stopStart && minuteInDay < stopStart + stopWindow;
      if (plannedBreak || specificFailure || stopped) {
        lostMinutes[index] += 1;
        if (plannedBreak) breakMinutes[index] += 1;
        else if (specificFailure) failureMinutes[index] += 1;
        else downtimeMinutes[index] += 1;
        continue;
      }

      const wave = Math.sin((minute + 1) * (0.071 + index * 0.013) + index * 1.7);
      const cycleMultiplier = Math.max(0.2, 1 + variation * wave);
      if (process.batch.mode === 'lote') {
        const { batch } = process;
        const idle = batchRemaining[index] <= 0.0001 && setupRemaining[index] <= 0.0001;
        if (idle && !releaseBatchOutput(index, minute)) {
          blockedMinutes[index] += 1;
          continue;
        }
        if (idle) {
          if (queues[index] + 0.0001 < batch.batchSize) {
            if (queues[index] <= 0.0001) starvationMinutes[index] += 1;
            else batchWaitMinutes[index] += 1;
            continue;
          }
          queues[index] -= batch.batchSize;
          batchRemaining[index] = batch.batchSize;
          setupRemaining[index] = batch.setupMin;
          transferProgress[index] = 0;
        }
        let minuteLeft = 1;
        if (setupRemaining[index] > 0.0001) {
          const used = Math.min(setupRemaining[index], minuteLeft);
          setupRemaining[index] -= used;
          minuteLeft -= used;
          busyMinutes[index] += used;
        }
        if (minuteLeft > 0.0001 && batchRemaining[index] > 0.0001) {
          const runCapacity = (batch.runCycleSec > 0 ? 60 / batch.runCycleSec : Infinity) / cycleMultiplier;
          const processed = Math.min(batchRemaining[index], runCapacity * minuteLeft);
          batchRemaining[index] -= processed;
          transferProgress[index] += processed;
          const good = processed * process.quality;
          produced[index] += processed;
          goodOutput[index] += good;
          outputHold[index] += good;
          busyMinutes[index] += Number.isFinite(runCapacity) ? processed / runCapacity : 0;
        }
        const batchFinished = batchRemaining[index] <= 0.0001 && setupRemaining[index] <= 0.0001;
        if (batchFinished || transferProgress[index] + 0.0001 >= batch.transferBatch) {
          transferProgress[index] = 0;
          releaseBatchOutput(index, minute);
        }
        continue;
      }

      const minuteCapacity = process.capacityPerMinute / cycleMultiplier;
      if (queues[index] <= 0.0001) {
        starvationMinutes[index] += 1;
        continue;
      }

      const downstreamSpace = index === processes.length - 1
        ? Infinity
        : Math.max(0, process.bufferLimit - queues[index + 1]);
      const maximumInputBySpace = Number.isFinite(downstreamSpace)
        ? downstreamSpace / process.quality
        : Infinity;
      const processed = Math.min(queues[index], minuteCapacity, maximumInputBySpace);
      if (processed <= 0.0001) {
        blockedMinutes[index] += 1;
        continue;
      }
      if (processed + 0.0001 < Math.min(queues[index], minuteCapacity)) blockedMinutes[index] += 1;
      queues[index] -= processed;
      const good = processed * process.quality;
      produced[index] += processed;
      goodOutput[index] += good;
      busyMinutes[index] += processed / Math.max(minuteCapacity, 0.0001);
      if (index === processes.length - 1) deliverFromLast(minute, good);
      else queues[index + 1] += good;
    }

    queues.forEach((queue, index) => { maxQueues[index] = Math.max(maxQueues[index], queue); });
    maxWip = Math.max(maxWip, currentWip());

    if (minuteInDay === minutesPerDay - 1) {
      const day = Math.floor(minute / minutesPerDay) + 1;
      const required = dailyDemand * day;
      const backlog = Math.max(0, required - delivered);
      const serviceLevelPercent = required > 0 ? Math.min(100, delivered / required * 100) : 100;
      if (backlog >= Math.max(1, dailyDemand * 0.05) && ruptureDay === null) ruptureDay = day;
      dayResults.push({
        day,
        required,
        delivered,
        backlog,
        serviceLevelPercent,
        wip: currentWip(),
      });
    }
  }

  const requestedUnits = dailyDemand * days;
  const backlogUnits = Math.max(0, requestedUnits - delivered);
  const serviceLevelPercent = requestedUnits > 0 ? Math.min(100, delivered / requestedUnits * 100) : 100;
  const processResults = processes.map((process, index): StressProcessResult => ({
    id: process.element.id,
    label: process.element.label,
    produced: produced[index],
    goodOutput: goodOutput[index],
    utilizationPercent: totalMinutes > 0 ? Math.min(100, busyMinutes[index] / totalMinutes * 100) : 0,
    maxQueue: maxQueues[index],
    starvationMinutes: starvationMinutes[index],
    blockedMinutes: blockedMinutes[index],
    lostMinutes: lostMinutes[index],
    breakMinutes: breakMinutes[index],
    failureMinutes: failureMinutes[index],
    downtimeMinutes: downtimeMinutes[index],
    batchWaitMinutes: batchWaitMinutes[index],
    batchMode: process.batch.mode === 'lote',
    effectiveCycleSec: process.effectiveCycleSec,
  }));
  const processConstraint = processResults.reduce((worst, process, index) => {
    const upstreamQueue = maxQueues[index];
    const score = process.utilizationPercent + upstreamQueue * 2 + process.blockedMinutes / Math.max(1, totalMinutes) * 30;
    return !worst || score > worst.score ? { process, score } : worst;
  }, undefined as { process: StressProcessResult; score: number } | undefined)?.process;
  const status: StressTestResult['status'] = backlogUnits >= Math.max(1, requestedUnits * 0.05)
    ? 'rupture'
    : (maxWip > dailyDemand || serviceLevelPercent < 99 ? 'attention' : 'stable');
  const inTransitAtEnd = unitsInTransport;
  const supplierIsConstraint = backlogUnits > 0.1 && supplierDelayMinutes >= minutesPerDay;
  const transportIsConstraint = backlogUnits > 0.1 && inTransitAtEnd > 0 && inTransitAtEnd >= backlogUnits * 0.5;
  const constraint = transportIsConstraint
    ? { id: null, label: 'Transporte ao cliente' }
    : supplierIsConstraint
      ? { id: null, label: 'Fornecedor' }
      : { id: processConstraint?.id ?? null, label: processConstraint?.label ?? '—' };
  const bottleneckQueue = processConstraint ? processResults.find((process) => process.id === processConstraint.id)?.maxQueue ?? 0 : 0;
  const headline = status === 'rupture'
    ? `O fluxo rompe no dia ${ruptureDay ?? days}`
    : status === 'attention'
      ? 'O fluxo atende, mas opera sob pressão'
      : 'O fluxo permanece estável no teste';
  const explanation = status === 'rupture'
    ? `${constraint.label} limita a entrega. Ao final, ${backlogUnits.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} unidade(s) ficam atrasadas e a maior fila chega a ${bottleneckQueue.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.`
    : status === 'attention'
      ? `A demanda foi atendida em ${serviceLevelPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%, porém o WIP chegou a ${maxWip.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} unidade(s).`
      : `A linha entregou ${delivered.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} unidade(s), sem atraso relevante e com WIP máximo de ${maxWip.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.`;
  const batchHolder = processResults
    .filter((process) => process.batchMode && process.batchWaitMinutes >= totalMinutes * 0.1)
    .sort((left, right) => right.batchWaitMinutes - left.batchWaitMinutes)[0];
  const batchRecommendation = batchHolder && status !== 'stable'
    ? `${batchHolder.label} passou ${batchHolder.batchWaitMinutes.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} min esperando completar o lote. Teste um lote de produção menor ou um lote de transferência menor. `
    : '';
  const recommendation = batchRecommendation + (status === 'rupture'
    ? transportIsConstraint
      ? 'Reduza o tempo de transporte, antecipe a coleta ou crie uma frequência adicional de expedição antes de aumentar a produção.'
      : supplierIsConstraint
        ? 'Revise a janela de entrega do fornecedor ou proteja a entrada com estoque dimensionado para o atraso observado.'
        : `Atue primeiro em ${constraint.label}: teste redução de ciclo/setup, disponibilidade ou recurso adicional antes de aumentar estoques.`
    : status === 'attention'
      ? `Observe ${constraint?.label ?? 'o processo mais carregado'} e reduza a liberação excessiva antes que a fila se transforme em atraso.`
      : 'O cenário suporta esta pressão. Aumente gradualmente a demanda ou as perdas para descobrir a margem real de segurança.');

  return {
    status,
    requestedUnits,
    deliveredUnits: delivered,
    backlogUnits,
    serviceLevelPercent,
    maxWip,
    ruptureDay,
    constraintId: constraint.id,
    constraintLabel: constraint.label,
    headline,
    explanation,
    recommendation,
    processResults,
    dayResults,
  };
}
