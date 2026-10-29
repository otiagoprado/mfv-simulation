// Relatório da simulação ao vivo: resume a linha do tempo peça a peça em indicadores,
// composição do tempo de cada unidade, carga por processo e séries para os gráficos.
import type { calculateCanvasSimulation, calculateLiveFlow } from './flow-engine.ts';

type LiveFlow = ReturnType<typeof calculateLiveFlow>;
type Simulation = ReturnType<typeof calculateCanvasSimulation>;

export interface LiveReportProcess {
  id: string;
  label: string;
  /** Unidades que já saíram deste processo. */
  unitsDone: number;
  /** Tempo ocupado (setup + produção), em segundos. */
  busySec: number;
  /** Ocupação em relação ao tempo simulado (0–1). */
  utilization: number;
  /** Médias por unidade, em segundos. */
  avgQueueSec: number;
  avgProcessSec: number;
  avgHoldingSec: number;
  /** Maior fila de entrada observada. */
  maxQueue: number;
  /** Quando a primeira peça chegou a este processo (espera inicial da operação), ou null se ainda não chegou. */
  firstArrivalSec: number | null;
  /** Quando a primeira peça ficou pronta neste processo, ou null se ainda não ficou. */
  firstFinishSec: number | null;
}

export interface LiveReportPoint {
  timeSec: number;
  launched: number;
  completed: number;
}

export interface LiveReport {
  mode: 'ordem' | 'continuo';
  quantity: number;
  elapsedSec: number;
  launched: number;
  completed: number;
  done: boolean;
  firstDoneSec: number | null;
  lastDoneSec: number | null;
  deliveredSec: number | null;
  /** Tempo total dividido pelas unidades concluídas: ritmo médio de saída. */
  avgPerUnitSec: number | null;
  /** Atravessamento médio de uma unidade, da liberação até ficar pronta na expedição. */
  avgLeadTimeSec: number | null;
  taktTimeSec: number;
  throughputPerHour: number | null;
  /** Composição média do atravessamento de uma unidade concluída, em segundos. */
  composition: { queue: number; processing: number; holding: number; transit: number };
  processes: LiveReportProcess[];
  bottleneckId: string | null;
  series: LiveReportPoint[];
}

const finiteBefore = (value: number, limit: number) => Number.isFinite(value) && value <= limit;

export function buildLiveReport(flow: LiveFlow, simulation: Simulation, elapsedSec: number): LiveReport {
  const { timeline, release, unitCount, stationSpecs } = flow;
  const stations = simulation.processMetrics;
  const launchedUnits = Array.from({ length: unitCount }, (_, unit) => unit).filter((unit) => release[unit] <= elapsedSec);
  const readyUnits = launchedUnits.filter((unit) => finiteBefore(timeline.shippingArrival[unit], elapsedSec));

  const composition = { queue: 0, processing: 0, holding: 0, transit: 0 };
  readyUnits.forEach((unit) => {
    stations.forEach((_, station) => {
      const leftPrevious = station === 0 ? release[unit] : timeline.depart[station - 1][unit];
      composition.transit += timeline.arrival[station][unit] - leftPrevious;
      composition.queue += timeline.start[station][unit] - timeline.arrival[station][unit];
      composition.processing += timeline.finish[station][unit] - timeline.start[station][unit];
      composition.holding += timeline.depart[station][unit] - timeline.finish[station][unit];
    });
    const lastDepart = stations.length ? timeline.depart[stations.length - 1][unit] : release[unit];
    composition.transit += timeline.shippingArrival[unit] - lastDepart;
  });
  const readyCount = readyUnits.length;
  if (readyCount) {
    composition.queue /= readyCount;
    composition.processing /= readyCount;
    composition.holding /= readyCount;
    composition.transit /= readyCount;
  }
  const avgLeadTimeSec = readyCount
    ? readyUnits.reduce((sum, unit) => sum + (timeline.shippingArrival[unit] - release[unit]), 0) / readyCount
    : null;

  const processes: LiveReportProcess[] = stations.map((metric, station) => {
    const spec = stationSpecs[station];
    const arrivals = timeline.arrival[station];
    const starts = timeline.start[station];
    const finishes = timeline.finish[station];
    const departs = timeline.depart[station];
    const doneUnits = launchedUnits.filter((unit) => finiteBefore(departs[unit], elapsedSec));
    // Ciclos com várias peças compartilham o mesmo intervalo: conta o tempo ocupado uma vez por ciclo.
    const seenCycles = new Set<number>();
    let busySec = 0;
    launchedUnits.forEach((unit) => {
      if (!finiteBefore(starts[unit], elapsedSec)) return;
      if (seenCycles.has(starts[unit])) return;
      seenCycles.add(starts[unit]);
      busySec += Math.min(finishes[unit], elapsedSec) - starts[unit];
    });
    const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const events: { time: number; delta: number }[] = [];
    launchedUnits.forEach((unit) => {
      if (finiteBefore(arrivals[unit], elapsedSec)) events.push({ time: arrivals[unit], delta: 1 });
      if (finiteBefore(starts[unit], elapsedSec)) events.push({ time: starts[unit], delta: -1 });
    });
    events.sort((left, right) => left.time - right.time || left.delta - right.delta);
    let queue = 0;
    let maxQueue = 0;
    events.forEach((event) => { queue += event.delta; maxQueue = Math.max(maxQueue, queue); });
    const firstArrivals = launchedUnits.map((unit) => arrivals[unit]).filter((time) => finiteBefore(time, elapsedSec));
    const firstFinishes = launchedUnits.map((unit) => finishes[unit]).filter((time) => finiteBefore(time, elapsedSec));
    return {
      firstArrivalSec: firstArrivals.length ? Math.min(...firstArrivals) : null,
      firstFinishSec: firstFinishes.length ? Math.min(...firstFinishes) : null,
      id: metric.element.id,
      label: metric.element.label || 'Processo',
      unitsDone: doneUnits.length,
      busySec,
      utilization: elapsedSec > 0 ? Math.min(1, busySec / elapsedSec) : 0,
      avgQueueSec: average(doneUnits.map((unit) => starts[unit] - arrivals[unit])),
      avgProcessSec: average(doneUnits.map((unit) => (finishes[unit] - starts[unit]) / Math.max(1, spec?.piecesPerCycle ?? 1))),
      avgHoldingSec: average(doneUnits.map((unit) => departs[unit] - finishes[unit])),
      maxQueue,
    };
  });
  const bottleneck = processes.reduce<LiveReportProcess | null>((best, process) => (!best || process.busySec > best.busySec ? process : best), null);

  // Série acumulada: liberadas e concluídas ao longo do tempo simulado.
  const samples = 48;
  const horizon = Math.max(1, elapsedSec);
  const exits = launchedUnits.map((unit) => timeline.exit[unit]).filter((time) => finiteBefore(time, elapsedSec)).sort((a, b) => a - b);
  const releases = launchedUnits.map((unit) => release[unit]).sort((a, b) => a - b);
  const countBefore = (sorted: number[], time: number) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle] <= time) low = middle + 1; else high = middle;
    }
    return low;
  };
  const series: LiveReportPoint[] = Array.from({ length: samples + 1 }, (_, index) => {
    const timeSec = (horizon * index) / samples;
    return { timeSec, launched: countBefore(releases, timeSec), completed: countBefore(exits, timeSec) };
  });

  const order = flow.order;
  const completed = flow.completed;
  const totalSec = order?.done && order.deliveredSec !== null ? order.deliveredSec : elapsedSec;
  return {
    mode: order ? 'ordem' : 'continuo',
    quantity: order?.quantity ?? flow.demanded,
    elapsedSec,
    launched: flow.launched,
    completed,
    done: order?.done ?? false,
    firstDoneSec: order?.firstDoneSec ?? (exits.length ? exits[0] : null),
    lastDoneSec: order?.lastDoneSec ?? null,
    deliveredSec: order?.deliveredSec ?? null,
    avgPerUnitSec: completed > 0 ? totalSec / completed : null,
    avgLeadTimeSec,
    taktTimeSec: simulation.taktTimeSec,
    throughputPerHour: elapsedSec > 0 ? (completed / elapsedSec) * 3600 : null,
    composition,
    processes,
    bottleneckId: bottleneck?.id ?? null,
    series,
  };
}
