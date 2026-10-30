import type { CanvasElement } from './canvas-types';
import { percentValue } from './numbers.ts';

export type ManufacturingMode = 'unitario' | 'lote';

export interface BatchSettings {
  mode: ManufacturingMode;
  /** Lote de produção: unidades processadas a cada setup. */
  batchSize: number;
  /** Unidades liberadas juntas ao próximo processo (igual ao lote de produção). */
  transferBatch: number;
  setupMin: number;
  /** Peças produzidas juntas em um ciclo (ex.: masseira que faz massa para 5 pães por ciclo). */
  piecesPerCycle: number;
  /** Duração de um ciclo completo (todas as peças do ciclo), já com recursos paralelos e disponibilidade. */
  cycleSec: number;
  /** Tempo médio por unidade sem setup (ciclo dividido pelas peças por ciclo). */
  runCycleSec: number;
}

export interface BatchLeadTime {
  /** Espera da primeira peça no buffer de saída até a última do lote ficar pronta. */
  formationSec: number;
  /** Setup no início do lote. */
  processingSec: number;
  totalSec: number;
}

export function batchSizeOf(data: CanvasElement['data']): number {
  return Math.max(1, Math.round(Number(data.lote) || 1));
}

/** Peças produzidas juntas em um ciclo; 1 é uma peça por ciclo. */
export function piecesPerCycleOf(data: CanvasElement['data']): number {
  return Math.max(1, Math.round(Number(data.pecasCiclo) || 1));
}

/** Lote de produção maior que 1 significa fabricação por lotes; lote 1 é fluxo contínuo, peça a peça. */
export function manufacturingMode(data: CanvasElement['data']): ManufacturingMode {
  return batchSizeOf(data) > 1 ? 'lote' : 'unitario';
}

export function batchSettings(element: Pick<CanvasElement, 'data'>): BatchSettings {
  const { data } = element;
  const mode = manufacturingMode(data);
  const batchSize = batchSizeOf(data);
  // O lote inteiro anda junto: só segue ao próximo processo quando a última peça fica pronta.
  const transferBatch = batchSize;
  const resources = Math.max(1, Number(data.recurso) || 1);
  const availability = Math.min(100, Math.max(1, percentValue(data.disp))) / 100;
  const cycleTime = Math.max(0, Number(data.tc) || 0);
  const piecesPerCycle = piecesPerCycleOf(data);
  const cycleSec = cycleTime / (resources * availability);
  return {
    mode,
    batchSize,
    transferBatch,
    setupMin: Math.max(0, Number(data.setup) || 0),
    piecesPerCycle,
    cycleSec,
    runCycleSec: cycleSec / piecesPerCycle,
  };
}

/**
 * Tempo extra que a fabricação por lotes adiciona ao atravessamento de uma peça.
 * A primeira peça do lote é produzida assim que chega, mas fica no buffer de saída até as
 * demais chegarem (no ritmo do takt) e serem produzidas; o setup entra no início de cada lote.
 */
export function batchLeadTime(settings: BatchSettings, taktTimeSec: number): BatchLeadTime {
  if (settings.mode !== 'lote') return { formationSec: 0, processingSec: 0, totalSec: 0 };
  const arrivalInterval = Number.isFinite(taktTimeSec) && taktTimeSec > 0 ? taktTimeSec : 0;
  const formationSec = (settings.batchSize - 1) * Math.max(arrivalInterval, settings.runCycleSec);
  const processingSec = settings.setupMin * 60;
  return { formationSec, processingSec, totalSec: formationSec + processingSec };
}
