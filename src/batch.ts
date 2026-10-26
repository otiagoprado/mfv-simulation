import type { CanvasElement } from './canvas-types';

export type ManufacturingMode = 'unitario' | 'lote';

export interface BatchSettings {
  mode: ManufacturingMode;
  /** Lote de produção: unidades processadas a cada setup. */
  batchSize: number;
  /** Lote de transferência: unidades liberadas juntas ao próximo processo. */
  transferBatch: number;
  setupMin: number;
  /** Tempo por unidade sem setup, já considerando recursos paralelos e disponibilidade. */
  runCycleSec: number;
}

export interface BatchLeadTime {
  /** Espera da primeira peça até o lote ficar completo na entrada. */
  formationSec: number;
  /** Setup + processamento do lote de transferência antes de a peça seguir. */
  processingSec: number;
  totalSec: number;
}

export function manufacturingMode(data: CanvasElement['data']): ManufacturingMode {
  return data.fabricacao === 'lote' ? 'lote' : 'unitario';
}

export function batchSettings(element: Pick<CanvasElement, 'data'>): BatchSettings {
  const { data } = element;
  const mode = manufacturingMode(data);
  const batchSize = Math.max(1, Math.round(Number(data.lote) || 1));
  const rawTransfer = Math.round(Number(data.loteTransf) || batchSize);
  const transferBatch = mode === 'lote' ? Math.min(batchSize, Math.max(1, rawTransfer)) : 1;
  const resources = Math.max(1, Number(data.recurso) || 1);
  const availability = Math.min(100, Math.max(1, Number(data.disp) || 100)) / 100;
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
 * o setup e o processamento do seu lote de transferência antes de seguir.
 */
export function batchLeadTime(settings: BatchSettings, taktTimeSec: number): BatchLeadTime {
  if (settings.mode !== 'lote') return { formationSec: 0, processingSec: 0, totalSec: 0 };
  const arrivalInterval = Number.isFinite(taktTimeSec) && taktTimeSec > 0 ? taktTimeSec : 0;
  const formationSec = (settings.batchSize - 1) * arrivalInterval;
  const processingSec = settings.setupMin * 60 + (settings.transferBatch - 1) * settings.runCycleSec;
  return { formationSec, processingSec, totalSec: formationSec + processingSec };
}
