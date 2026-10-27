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
  /** Tempo por unidade sem setup, já considerando recursos paralelos e disponibilidade. */
  runCycleSec: number;
}

export interface BatchLeadTime {
  /** Espera da primeira peça até o lote ficar completo na entrada. */
  formationSec: number;
  /** Setup + produção do lote antes de a peça seguir. */
  processingSec: number;
  totalSec: number;
}

export function batchSizeOf(data: CanvasElement['data']): number {
  return Math.max(1, Math.round(Number(data.lote) || 1));
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
  return {
    mode,
    batchSize,
    transferBatch,
    setupMin: Math.max(0, Number(data.setup) || 0),
    runCycleSec: cycleTime / (resources * availability),
  };
}

/**
 * Tempo extra que a fabricação por lotes adiciona ao atravessamento de uma peça.
 * A primeira peça do lote espera as demais chegarem no ritmo do takt, depois espera
 * o setup e a produção do lote inteiro antes de seguir.
 */
export function batchLeadTime(settings: BatchSettings, taktTimeSec: number): BatchLeadTime {
  if (settings.mode !== 'lote') return { formationSec: 0, processingSec: 0, totalSec: 0 };
  const arrivalInterval = Number.isFinite(taktTimeSec) && taktTimeSec > 0 ? taktTimeSec : 0;
  const formationSec = (settings.batchSize - 1) * arrivalInterval;
  const processingSec = settings.setupMin * 60 + (settings.transferBatch - 1) * settings.runCycleSec;
  return { formationSec, processingSec, totalSec: formationSec + processingSec };
}
