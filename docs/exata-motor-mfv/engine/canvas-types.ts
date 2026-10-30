export type ElementKind =
  // Material
  | 'process'
  | 'supplier'
  | 'customer'
  | 'truck'
  | 'transport-air'
  | 'transport-ship'
  | 'forklift'
  | 'milk-run'
  | 'raw-material'
  | 'finished-goods'
  | 'warehouse'
  | 'inventory'
  | 'safety-stock'
  | 'supermarket'
  | 'fifo'
  | 'buffer'
  | 'shipping-point'
  | 'shared-process'
  | 'machine'
  | 'inspection'
  | 'waiting-time'
  | 'resource-zone'
  | 'kanban-production'
  | 'kanban-withdrawal'
  | 'kanban-board'
  | 'heijunka'
  | 'sequencing-box'
  | 'signal-kanban'
  | 'kanban-post'
  | 'sequenced-pull'
  // Informação
  | 'identification'
  | 'planning'
  | 'data-box'
  | 'customer-demand'
  | 'production-schedule'
  | 'erp-system'
  | 'go-see'
  // Operador
  | 'operator'
  | 'work-cell'
  // Setas (fluxo)
  | 'arrow-push'
  | 'arrow-pull'
  | 'arrow-info-manual'
  | 'arrow-info-electronic'
  | 'arrow-adjustment'
  | 'arrow-schedule'
  | 'arrow-shipment'
  | 'arrow-physical'
  | 'line-straight'
  | 'line-dashed'
  | 'arrow-straight'
  | 'arrow-double'
  | 'arrow-info-manual-straight'
  | 'arrow-info-electronic-straight'
  // Anotação
  | 'kaizen'
  | 'intervention'
  | 'note'
  | 'timeline'
  | 'legend'
  | 'quality-problem'
  | 'bottleneck'
  | 'pacemaker'
  | 'future-principles'
  | 'distance';

export interface CanvasElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  label: string;
  data: Record<string, string | number>;
}

export interface ArrowAnchor {
  elementId: string;
  x: number;
  y: number;
}

export interface CanvasArrow {
  id: string;
  kind: 'arrow-push' | 'arrow-pull' | 'arrow-info-manual' | 'arrow-info-electronic' | 'arrow-adjustment' | 'arrow-schedule' | 'arrow-shipment' | 'arrow-physical' | 'line-straight' | 'line-dashed' | 'arrow-straight' | 'arrow-double' | 'arrow-info-manual-straight' | 'arrow-info-electronic-straight';
  x1: number; y1: number;
  x2: number; y2: number;
  label?: string;
  /** Dobras: pontos intermediários entre a origem e o destino. */
  points?: { x: number; y: number }[];
  startAnchor?: ArrowAnchor;
  endAnchor?: ArrowAnchor;
}

export interface ProductMixItem {
  id: string;
  name: string;
  monthlyDemand: number;
  packSize: number;
}

export interface ScenarioAssumptions {
  monthlyDemand: number;
  workdaysPerMonth: number;
  availableMinutesPerDay: number;
  productMix: ProductMixItem[];
}

export interface CanvasState {
  elements: CanvasElement[];
  arrows: CanvasArrow[];
  assumptions: ScenarioAssumptions;
  themeColor: string;
}

export interface LibraryItem {
  kind: ElementKind;
  label: string;
  group: 'material' | 'logistica' | 'kanban' | 'informacao' | 'operador' | 'fluxo' | 'anotacao';
  defaultData: Record<string, string | number>;
  defaultLabel: string;
  w: number;
  h: number;
}

export const DEFAULT_TRUCK_COLOR = '#eee9df';

export const ARROW_KINDS: ElementKind[] = [
  'arrow-push', 'arrow-pull', 'arrow-info-manual', 'arrow-info-electronic', 'arrow-adjustment',
  'arrow-schedule', 'arrow-shipment', 'arrow-physical',
  'line-straight', 'line-dashed', 'arrow-straight', 'arrow-double',
  'arrow-info-manual-straight', 'arrow-info-electronic-straight',
];

export const LIBRARY: LibraryItem[] = [
  // ── Material
  { kind: 'supplier',          label: 'Fornecedor',         group: 'material',   defaultLabel: 'Fornecedor',          defaultData: { freq: 1, color: DEFAULT_TRUCK_COLOR },           w: 170, h: 120 },
  { kind: 'customer',          label: 'Cliente final',      group: 'material',   defaultLabel: 'Cliente final',       defaultData: { freq: 1, color: DEFAULT_TRUCK_COLOR },           w: 170, h: 120 },
  { kind: 'raw-material',      label: 'Matéria-prima',      group: 'material',   defaultLabel: 'Matéria-prima',       defaultData: { qty: 0, color: DEFAULT_TRUCK_COLOR },            w: 130, h: 110 },
  { kind: 'finished-goods',    label: 'Produto acabado',    group: 'material',   defaultLabel: 'Produto acabado',     defaultData: { qty: 0, color: DEFAULT_TRUCK_COLOR },            w: 130, h: 110 },
  { kind: 'warehouse',         label: 'Armazém',            group: 'material',   defaultLabel: 'Armazém',             defaultData: { qty: 0, color: DEFAULT_TRUCK_COLOR },            w: 180, h: 120 },
  { kind: 'shipping-point',    label: 'Expedição',          group: 'material',   defaultLabel: 'Expedição',           defaultData: { color: DEFAULT_TRUCK_COLOR },                    w: 150, h: 110 },
  { kind: 'process',           label: 'Processo',           group: 'material',   defaultLabel: 'Processo',            defaultData: { tc: 0, setup: 0, lote: 1, op: 1, recurso: 1, disp: 100, qualidade: 100 }, w: 150, h: 160 },
  { kind: 'shared-process',    label: 'Processo compartilhado', group: 'material', defaultLabel: 'Processo compartilhado', defaultData: { tc: 0, setup: 0, lote: 1, op: 1, recurso: 1, disp: 100, qualidade: 100 }, w: 170, h: 160 },
  { kind: 'machine',           label: 'Máquina / equipamento', group: 'material', defaultLabel: 'Máquina',            defaultData: { recurso: 1, disp: 100, color: DEFAULT_TRUCK_COLOR }, w: 150, h: 120 },
  { kind: 'inspection',        label: 'Inspeção / qualidade', group: 'material', defaultLabel: 'Inspeção',            defaultData: { tc: 0, op: 1 },                                 w: 100, h: 86  },
  { kind: 'work-cell',         label: 'Célula de trabalho', group: 'material',   defaultLabel: 'Célula',              defaultData: { op: 1 },                                        w: 160, h: 100 },
  { kind: 'inventory',         label: 'Estoque',            group: 'material',   defaultLabel: 'Estoque',             defaultData: { qty: 0 },                                       w: 60,  h: 60  },
  { kind: 'safety-stock',      label: 'Estoque de segurança', group: 'material', defaultLabel: 'Estoque segurança',   defaultData: { qty: 0 },                                       w: 76,  h: 64  },
  { kind: 'buffer',            label: 'Buffer / Pulmão',    group: 'material',   defaultLabel: 'Buffer',              defaultData: { qty: 0 },                                       w: 80,  h: 60  },
  { kind: 'supermarket',       label: 'Supermercado',       group: 'material',   defaultLabel: 'Supermercado',        defaultData: { qty: 0 },                                       w: 80,  h: 70  },
  { kind: 'fifo',              label: 'Fila FIFO',          group: 'material',   defaultLabel: 'FIFO',                defaultData: { qty: 0 },                                       w: 100, h: 50  },
  { kind: 'waiting-time',      label: 'Espera / secagem',   group: 'material',   defaultLabel: 'Espera',              defaultData: { durationMin: 60 },                               w: 130, h: 76  },
  { kind: 'resource-zone',     label: 'Área de intervenção', group: 'anotacao',  defaultLabel: 'ÁREA DE INTERVENÇÃO', defaultData: {},                                             w: 340, h: 180 },
  // ── Logística
  { kind: 'truck',             label: 'Caminhão',           group: 'logistica',  defaultLabel: 'Entrega',             defaultData: { freq: 1, color: DEFAULT_TRUCK_COLOR },          w: 210, h: 130 },
  { kind: 'transport-air',     label: 'Transporte aéreo',   group: 'logistica',  defaultLabel: 'Aéreo',               defaultData: { freq: 1, color: DEFAULT_TRUCK_COLOR },           w: 180, h: 105 },
  { kind: 'transport-ship',    label: 'Transporte marítimo', group: 'logistica', defaultLabel: 'Marítimo',            defaultData: { freq: 1, color: DEFAULT_TRUCK_COLOR },           w: 180, h: 105 },
  { kind: 'forklift',          label: 'Empilhadeira',       group: 'logistica',  defaultLabel: 'Movimentação',        defaultData: { distance: 0, color: DEFAULT_TRUCK_COLOR },       w: 140, h: 115 },
  { kind: 'milk-run',          label: 'Milk run',           group: 'logistica',  defaultLabel: 'Milk run',            defaultData: { freq: 1, color: DEFAULT_TRUCK_COLOR },           w: 190, h: 110 },
  // ── Kanban
  { kind: 'kanban-production', label: 'Kanban produção',    group: 'kanban',     defaultLabel: 'Kanban\nprodução',    defaultData: { qty: 0, replenishmentMin: 60, safetyPercent: 10 }, w: 60, h: 44 },
  { kind: 'kanban-withdrawal', label: 'Kanban retirada',    group: 'kanban',     defaultLabel: 'Kanban\nretirada',   defaultData: { qty: 0, replenishmentMin: 60, safetyPercent: 10 }, w: 60, h: 44 },
  { kind: 'kanban-board',      label: 'Quadro kanban',      group: 'kanban',     defaultLabel: 'Quadro\nKanban',     defaultData: { cols: 3, rows: 3 },                             w: 120, h: 100 },
  { kind: 'heijunka',          label: 'Heijunka box',       group: 'kanban',     defaultLabel: 'Heijunka',           defaultData: { cols: 5, rows: 2 },                             w: 140, h: 80  },
  { kind: 'sequencing-box',    label: 'Caixa sequenciamento', group: 'kanban',   defaultLabel: 'Sequenciamento',     defaultData: { slots: 6 },                                     w: 120, h: 60  },
  { kind: 'signal-kanban',     label: 'Kanban de sinal',    group: 'kanban',     defaultLabel: 'Kanban sinal',        defaultData: { qty: 0, replenishmentMin: 60, safetyPercent: 10 }, w: 64, h: 56 },
  { kind: 'kanban-post',       label: 'Posto kanban',       group: 'kanban',     defaultLabel: 'Posto Kanban',        defaultData: { qty: 0, replenishmentMin: 60, safetyPercent: 10 }, w: 88, h: 72 },
  { kind: 'sequenced-pull',    label: 'Puxada sequenciada', group: 'kanban',     defaultLabel: 'Puxada sequenciada',  defaultData: { pitch: 0 },                                     w: 150, h: 62  },
  // ── Informação
  { kind: 'planning',          label: 'Controle produção',  group: 'informacao', defaultLabel: 'Controle da\nProdução', defaultData: { demanda: 0, takt: 0 },                     w: 160, h: 110 },
  { kind: 'data-box',          label: 'Caixa de dados',     group: 'informacao', defaultLabel: 'Dados',               defaultData: { tc: 0, tcp: 0, disp: 100, turnos: 1 },        w: 130, h: 90  },
  { kind: 'customer-demand',   label: 'Demanda do cliente', group: 'informacao', defaultLabel: 'Demanda',             defaultData: { qty: 0, periodo: 0 },                          w: 100, h: 80  },
  { kind: 'production-schedule', label: 'Prog. produção',   group: 'informacao', defaultLabel: 'Programação',         defaultData: {},                                               w: 110, h: 70  },
  { kind: 'erp-system',        label: 'Sistema ERP / MRP',  group: 'informacao', defaultLabel: 'ERP / MRP',           defaultData: {},                                               w: 120, h: 76  },
  { kind: 'go-see',            label: 'Programação visual', group: 'informacao', defaultLabel: 'Programação visual',  defaultData: { freq: 1 },                                      w: 130, h: 72  },
  // ── Operador
  { kind: 'operator',          label: 'Operador',           group: 'operador',   defaultLabel: 'Op.',                 defaultData: { qty: 1 },                                       w: 40,  h: 60  },
  // ── Setas
  { kind: 'arrow-push',            label: 'Fluxo empurrado',  group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-pull',            label: 'Fluxo puxado',     group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-info-manual',     label: 'Info manual',      group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-info-electronic', label: 'Info eletrônica',  group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-adjustment',      label: 'Seta ajuste',      group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-schedule',        label: 'Programação curva', group: 'fluxo', defaultLabel: 'Programação', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-shipment',        label: 'Transporte externo', group: 'fluxo', defaultLabel: 'Entrega', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-physical',        label: 'Fluxo físico',      group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'line-straight',         label: 'Linha reta',        group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'line-dashed',           label: 'Linha tracejada',   group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-straight',        label: 'Seta reta',         group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-double',          label: 'Seta dupla',        group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-info-manual-straight', label: 'Info manual reta', group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  { kind: 'arrow-info-electronic-straight', label: 'Info eletrônica reta', group: 'fluxo', defaultLabel: '', defaultData: {}, w: 0, h: 0 },
  // ── Anotação
  { kind: 'kaizen',            label: 'Kaizen burst',       group: 'anotacao',   defaultLabel: 'Kaizen',              defaultData: {},                                               w: 78,  h: 78  },
  { kind: 'intervention',      label: 'Ponto intervenção',  group: 'anotacao',   defaultLabel: 'Melhoria',            defaultData: {},                                               w: 70,  h: 70  },
  { kind: 'note',              label: 'Nota / Post-it',     group: 'anotacao',   defaultLabel: 'Nota...',             defaultData: {},                                               w: 120, h: 80  },
  { kind: 'timeline',          label: 'Linha do tempo',     group: 'anotacao',   defaultLabel: '',                    defaultData: { leadtime: 0, tprocess: 0 },                    w: 400, h: 70  },
  { kind: 'legend',            label: 'Legenda',            group: 'anotacao',   defaultLabel: 'Legenda',             defaultData: {},                                               w: 160, h: 120 },
  { kind: 'quality-problem',   label: 'Problema de qualidade', group: 'anotacao', defaultLabel: 'Qualidade',          defaultData: { qty: 0 },                                       w: 82,  h: 72  },
  { kind: 'bottleneck',        label: 'Restrição / gargalo', group: 'anotacao',  defaultLabel: 'Gargalo',             defaultData: {},                                               w: 92,  h: 66  },
  { kind: 'pacemaker',         label: 'Processo marcapasso', group: 'anotacao',  defaultLabel: 'MARCAPASSO',          defaultData: {},                                               w: 118, h: 62  },
  { kind: 'future-principles', label: 'Princípios do futuro', group: 'anotacao', defaultLabel: 'Produção puxada\nHeijunka\nAnálise de gargalos\nFluxo contínuo\nTrabalho padronizado', defaultData: {}, w: 190, h: 150 },
  { kind: 'distance',          label: 'Distância percorrida', group: 'anotacao', defaultLabel: 'Distância',           defaultData: { distance: 0 },                                  w: 150, h: 42  },
];

export function makeId() {
  return Math.random().toString(36).slice(2, 10);
}
