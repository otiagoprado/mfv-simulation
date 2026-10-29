import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, AlertTriangle, BarChart3, BookOpen, Calculator, CheckCircle2, Copy, Download, FileImage, FileText, GitCompareArrows,
  ChevronDown, FolderOpen, ImageDown, LayoutTemplate, Loader2, Map, Menu as MenuIcon, Palette, Pencil, Plus,
  Pause, Play, RotateCcw, Route, Save, Search, Sparkles, Square, Trash2, X, ZoomIn, ZoomOut, Minus,
} from 'lucide-react';
import {
  ARROW_KINDS, DEFAULT_TRUCK_COLOR, LIBRARY, makeId,
  type ArrowAnchor, type CanvasArrow, type CanvasElement, type CanvasState,
  type ElementKind, type LibraryItem, type ProductMixItem, type ScenarioAssumptions,
} from './canvas-types';
import {
  BufferSymbol, CustomerDemandSymbol, DataBoxSymbol, ExtendedSymbol, FifoSymbol,
  HeijunkaSymbol, InterventionSymbol, InventorySymbol, KaizenSymbol,
  IdentificationSymbol,
  KanbanBoardSymbol, KanbanProductionSymbol, KanbanWithdrawalSymbol,
  LegendSymbol, NoteSymbol, OperatorSymbol, PartySymbol, PlanningSymbol,
  ProcessSymbol, ProductionScheduleSymbol, SequencingBoxSymbol,
  ShippingPointSymbol, SupermarketSymbol, TimelineSymbol, TruckSymbol,
  WorkCellSymbol,
} from './MfvSymbols';
import { exportJPEG, exportPDF, exportSVG, type PaperSize } from './export';
import { cloneCanvas, syncCanvasForward } from './canvas-sync';
import { runStressTest, type StressTestSettings } from './stress-test';
import { batchLeadTime, batchSettings } from './batch';
import {
  DEFAULT_ASSUMPTIONS, KANBAN_CONTROL_KINDS, LIVE_MAX_DAYS,
  buildLeveledSequence, calculateCanvasSimulation, calculateKanbanSizing, calculateLiveFlow, calculateScenario,
  defaultElementDimensions, elementDimensions, nearestProcess, normalizedProductMix, positiveNumber,
  type LiveUnit,
} from './flow-engine';
import { materialFlowOrder } from './flow-order';
import { buildLiveReport } from './live-report';
import { LiveReportPanel } from './LiveReport';
import { percentValue } from './numbers';
import type { Scenario } from './types';
import truckThreeQuarter from './assets/truck-three-quarter.png';

// ─── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mfv-canvas:v5';
const PREVIOUS_STORAGE_KEY = 'mfv-canvas:v4';
const OLDER_STORAGE_KEY = 'mfv-canvas:v3';
const OLDEST_STORAGE_KEY = 'mfv-canvas:v2';
const LEGACY_STORAGE_KEY = 'mfv-simulation:v2';
const LIVE_ORDER_STORAGE_KEY = 'mfv-live-order:v1';
const MANUAL_SEEN_KEY = 'mfv-manual-seen:v1';
const FIXED_PLANNING_ID = '__mfv-demand-planning__';
const FIXED_IDENTIFICATION_ID = '__mfv-identification__';
const GRID_SIZE = 20;
const ALIGN_THRESHOLD = 8;
const DEFAULT_THEME_COLOR = '#0071e3';
const TINTABLE_ASSET_KINDS: ElementKind[] = [
  'supplier','customer','truck','raw-material','finished-goods','warehouse','shipping-point','machine',
  'transport-air','transport-ship','forklift','milk-run',
];
type ActiveKind = 'current' | 'future';
type ScenarioPreset = 'current' | 'demand-up' | 'demand-down' | 'setup-half' | 'availability-up' | 'bottleneck-resource' | 'quality-up' | 'one-piece-flow' | 'batch-production';

interface FutureVariant {
  id: string;
  name: string;
  canvas: CanvasState;
}

interface CanvasWorkspace {
  current: CanvasState;
  futures: FutureVariant[];
  activeFutureId: string;
}

function cloneWorkspace(workspace: CanvasWorkspace): CanvasWorkspace {
  return {
    current: cloneCanvas(workspace.current),
    futures: workspace.futures.map((variant) => ({ ...variant, canvas: cloneCanvas(variant.canvas) })),
    activeFutureId: workspace.activeFutureId,
  };
}

function validThemeColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_THEME_COLOR;
}


type LeanAdviceLevel = 'critical' | 'opportunity' | 'good';
type LeanAdviceArea = 'fluxo' | 'pull' | 'marcapasso' | 'programacao' | 'kanban' | 'dados';
type LeanFixKind = 'add-boundary' | 'add-resources' | 'remove-elements' | 'create-pull'
  | 'set-pacemaker' | 'remove-arrow' | 'add-schedule' | 'add-kanban' | 'set-buffer-limit'
  | 'size-kanban' | 'add-heijunka' | 'reduce-setup' | 'increase-pull-limit';

interface LeanFix {
  kind: LeanFixKind;
  label: string;
  change: string;
  targetId?: string;
  targetIds?: string[];
  processId?: string;
  upstreamId?: string;
  downstreamId?: string;
  elementKind?: 'raw-material' | 'customer';
  controlKind?: 'supermarket' | 'fifo';
  value?: number;
}

interface LeanAdvice {
  id: string;
  level: LeanAdviceLevel;
  area: LeanAdviceArea;
  title: string;
  why: string;
  action: string;
  expected?: string;
  fix?: LeanFix;
  targetId?: string;
  targetLabel?: string;
}

interface AppliedLeanFix {
  id: string;
  title: string;
  reason: string;
  change: string;
  expected: string;
  impact: string;
}

function centerOf(element: CanvasElement) {
  const size = elementDimensions(element);
  return { x: element.x + size.width / 2, y: element.y + size.height / 2 };
}

function nearestProcessToPoint(x: number, y: number, processes: CanvasElement[], maxDistance = 130) {
  const match = processes.reduce((nearest, process) => {
    const center = centerOf(process);
    const distance = Math.hypot(x - center.x, y - center.y);
    return !nearest || distance < nearest.distance ? { process, distance } : nearest;
  }, undefined as { process: CanvasElement; distance: number } | undefined);
  return match && match.distance <= maxDistance ? match.process : undefined;
}

function buildLeanAssistant(canvas: CanvasState, simulation: ReturnType<typeof calculateCanvasSimulation>) {
  const advice: LeanAdvice[] = [];
  const reverseRoute = simulation.rawMaterialEntry && simulation.finalCustomer
    ? centerOf(simulation.rawMaterialEntry).x > centerOf(simulation.finalCustomer).x
    : false;
  const processes = reverseRoute ? [...simulation.processElements].reverse() : simulation.processElements;
  const metricsById = new globalThis.Map(simulation.processMetrics.map((metric) => [metric.element.id, metric]));
  const stockKinds: ElementKind[] = ['inventory','safety-stock','buffer','supermarket','fifo','waiting-time'];

  if (!simulation.rawMaterialEntry) advice.push({
    id: 'missing-entry', level: 'critical', area: 'dados', title: 'Entrada do fluxo não definida',
    why: 'Sem matéria-prima o assistente não consegue avaliar o fluxo completo de porta a porta.',
    action: 'Adicione o estoque de matéria-prima no início do MFV.',
    expected: 'O fluxo passa a ter uma origem física definida e pode ser simulado de porta a porta.',
    fix: { kind: 'add-boundary', elementKind: 'raw-material', label: 'Adicionar matéria-prima', change: 'Criar a entrada de matéria-prima antes do primeiro processo.' },
  });
  if (!simulation.finalCustomer) advice.push({
    id: 'missing-customer', level: 'critical', area: 'dados', title: 'Cliente final não definido',
    why: 'O valor deve ser analisado até o cliente que puxa a demanda.',
    action: 'Adicione o cliente final no término do MFV.',
    expected: 'O fluxo ganha um ponto final que representa quem consome e puxa a demanda.',
    fix: { kind: 'add-boundary', elementKind: 'customer', label: 'Adicionar cliente final', change: 'Criar o cliente final depois do último processo.' },
  });
  if (!processes.length) advice.push({
    id: 'missing-processes', level: 'critical', area: 'dados', title: 'Fluxo sem processos',
    why: 'Não existem etapas produtivas suficientes para analisar capacidade, continuidade ou puxada.',
    action: 'Adicione e preencha pelo menos um processo produtivo.',
  });

  simulation.invalidProcesses.forEach((metric) => advice.push({
    id: `invalid-${metric.element.id}`, level: 'critical', area: 'dados', title: `${metric.element.label}: tempo de ciclo ausente`,
    why: 'Sem T/C não é possível comparar a capacidade do processo com o takt.',
    action: 'Meça o ciclo no gemba e informe o valor observado.', targetId: metric.element.id, targetLabel: metric.element.label,
  }));
  simulation.overloadedProcesses.forEach((metric) => {
    const guidance = bottleneckGuidance(metric, canvas.assumptions);
    const currentResources = Math.max(1, Number(metric.element.data.recurso) || 1);
    const requiredResources = Math.max(currentResources + 1, Math.ceil(currentResources * metric.loadPercent / 100));
    advice.push({
      id: `overload-${metric.element.id}`, level: 'critical', area: 'fluxo', title: `${metric.element.label}: capacidade abaixo da necessidade`,
      why: `A carga calculada é ${metric.loadPercent.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% e o processo não sustenta a demanda deste cenário.`,
      action: guidance.actions.join(' '), targetId: metric.element.id, targetLabel: metric.element.label,
      expected: `A capacidade paralela simulada sobe de ${currentResources} para ${requiredResources} recurso(s), reduzindo a carga para perto ou abaixo de 100%.`,
      fix: { kind: 'add-resources', targetId: metric.element.id, value: requiredResources, label: `Simular ${requiredResources} recursos`, change: `Alterar recursos paralelos de ${currentResources} para ${requiredResources}.` },
    });
  });

  for (let index = 0; index < processes.length - 1; index += 1) {
    const upstream = processes[index];
    const downstream = processes[index + 1];
    const upstreamCenter = centerOf(upstream);
    const downstreamCenter = centerOf(downstream);
    const lowX = Math.min(upstreamCenter.x, downstreamCenter.x);
    const highX = Math.max(upstreamCenter.x, downstreamCenter.x);
    const lowY = Math.min(upstreamCenter.y, downstreamCenter.y) - 140;
    const highY = Math.max(upstreamCenter.y, downstreamCenter.y) + 140;
    const between = canvas.elements.filter((element) => stockKinds.includes(element.kind) && (() => {
      const center = centerOf(element);
      return center.x > lowX && center.x < highX && center.y >= lowY && center.y <= highY;
    })());
    const pullControl = between.find((element) => ['supermarket','fifo'].includes(element.kind));
    const upstreamMetric = metricsById.get(upstream.id);
    const downstreamMetric = metricsById.get(downstream.id);
    const largestCycle = Math.max(upstreamMetric?.effectiveCycleSec ?? 0, downstreamMetric?.effectiveCycleSec ?? 0, 1);
    const cycleDifference = Math.abs((upstreamMetric?.effectiveCycleSec ?? 0) - (downstreamMetric?.effectiveCycleSec ?? 0)) / largestCycle;
    const setupMinutes = Math.max(Number(upstream.data.setup) || 0, Number(downstream.data.setup) || 0);
    const continuousCandidate = Boolean(upstreamMetric?.valid && downstreamMetric?.valid
      && !upstreamMetric?.overloaded && !downstreamMetric?.overloaded
      && cycleDifference <= 0.2 && setupMinutes <= 5);

    if (continuousCandidate) {
      advice.push({
        id: `flow-${upstream.id}-${downstream.id}`, level: 'opportunity', area: 'fluxo',
        title: `Avaliar fluxo contínuo: ${upstream.label} → ${downstream.label}`,
        why: `Os ciclos estão próximos e ambos atendem ao takt${between.length ? ', mas existe estoque entre eles' : ''}.`,
        action: between.length
          ? 'Teste remover o estoque intermediário e transferir uma peça diretamente ao processo seguinte.'
          : 'Confirme proximidade física, trabalho padronizado e transferência de uma peça por vez.',
        targetId: between[0]?.id ?? upstream.id, targetLabel: between[0]?.label ?? upstream.label,
        expected: between.length ? 'O estoque intermediário é retirado do cenário futuro para testar transferência direta entre as etapas.' : undefined,
        fix: between.length ? { kind: 'remove-elements', targetIds: between.map((element) => element.id), label: 'Testar fluxo contínuo', change: `Remover ${between.length} estoque(s)/espera(s) entre os dois processos.` } : undefined,
      });
    } else if (!pullControl && upstreamMetric?.valid && downstreamMetric?.valid) {
      const preferFifo = upstream.kind === 'shared-process' || downstream.kind === 'shared-process';
      advice.push({
        id: `disconnect-${upstream.id}-${downstream.id}`, level: 'critical', area: 'pull',
        title: `Fluxo desconectado entre ${upstream.label} e ${downstream.label}`,
        why: cycleDifference > 0.2
          ? 'A diferença de ritmo pode criar falta de material ou acúmulo sem um limite explícito.'
          : 'Setup, disponibilidade ou sobrecarga impedem recomendar fluxo contínuo com segurança.',
        action: preferFifo
          ? 'Crie uma FIFO com limite máximo e preserve a sequência entre os processos.'
          : 'Crie um supermercado com reposição puxada pelo consumo do processo seguinte.',
        targetId: between[0]?.id ?? upstream.id, targetLabel: between[0]?.label ?? upstream.label,
        expected: `O WIP entre as etapas passa a ter limite explícito e sinal de reposição, evitando produção sem consumo.`,
        fix: { kind: 'create-pull', upstreamId: upstream.id, downstreamId: downstream.id, controlKind: preferFifo ? 'fifo' : 'supermarket', label: `Criar ${preferFifo ? 'FIFO' : 'supermercado'} puxado`, change: `Adicionar ${preferFifo ? 'uma FIFO' : 'um supermercado'}, Kanban e limites iniciais entre os processos.` },
      });
    }
  }

  const recommendedPacemaker = processes[processes.length - 1];
  if (recommendedPacemaker && !simulation.pacemakerMarkers.length) advice.push({
    id: 'pacemaker-missing', level: 'critical', area: 'marcapasso', title: 'Processo marcapasso não definido',
    why: 'A programação deve ser enviada a um único ponto; o processo mais a jusante é o candidato inicial.',
    action: `Adicione o marcapasso e vincule-o a ${recommendedPacemaker.label}.`,
    targetId: recommendedPacemaker.id, targetLabel: recommendedPacemaker.label,
    expected: 'A programação passa a ter um único ponto de liberação próximo do cliente.',
    fix: { kind: 'set-pacemaker', processId: recommendedPacemaker.id, label: 'Definir marcapasso', change: `Criar o marcador e vinculá-lo a ${recommendedPacemaker.label}.` },
  });
  if (recommendedPacemaker && simulation.pacemaker && simulation.pacemaker.id !== recommendedPacemaker.id) advice.push({
    id: 'pacemaker-position', level: 'opportunity', area: 'marcapasso', title: 'Revisar a posição do marcapasso',
    why: `${simulation.pacemaker.label} está programado, mas ${recommendedPacemaker.label} é o processo produtivo mais próximo do cliente.`,
    action: `Valide no gemba; se não houver uma razão específica, programe somente ${recommendedPacemaker.label}.`,
    targetId: recommendedPacemaker.id, targetLabel: recommendedPacemaker.label,
    expected: 'O cenário concentra a programação no último processo produtivo antes do cliente.',
    fix: { kind: 'set-pacemaker', processId: recommendedPacemaker.id, label: 'Mover marcapasso', change: `Vincular o marcapasso existente a ${recommendedPacemaker.label}.` },
  });
  if (recommendedPacemaker && simulation.pacemaker?.id === recommendedPacemaker.id) advice.push({
    id: 'pacemaker-ok', level: 'good', area: 'marcapasso', title: `Marcapasso coerente: ${recommendedPacemaker.label}`,
    why: 'A programação está concentrada no processo produtivo mais a jusante.',
    action: 'Mantenha os processos a montante respondendo por fluxo ou sinais puxados.',
    targetId: recommendedPacemaker.id, targetLabel: recommendedPacemaker.label,
  });

  const informationKinds: CanvasArrow['kind'][] = [
    'arrow-info-manual','arrow-info-electronic','arrow-schedule',
    'arrow-info-manual-straight','arrow-info-electronic-straight',
  ];
  const scheduledProcesses = canvas.arrows
    .filter((arrow) => informationKinds.includes(arrow.kind))
    .map((arrow) => {
      const anchored = processes.find((process) => process.id === arrow.endAnchor?.elementId);
      return { arrow, process: anchored ?? nearestProcessToPoint(arrow.x2, arrow.y2, processes) };
    })
    .filter((item): item is { arrow: CanvasArrow; process: CanvasElement } => Boolean(item.process));
  scheduledProcesses.filter((item) => item.process.id !== simulation.pacemaker?.id).forEach((item) => advice.push({
    id: `schedule-${item.arrow.id}`, level: 'critical', area: 'programacao', title: `Programação enviada diretamente a ${item.process.label}`,
    why: 'Programar vários processos cria empurrada, prioridades conflitantes e excesso de WIP.',
    action: 'Remova esta programação direta e faça o processo responder ao fluxo ou ao sinal Kanban.',
    targetId: item.arrow.id, targetLabel: item.process.label,
    expected: 'O processo deixa de receber uma programação paralela que poderia empurrar produção.',
    fix: { kind: 'remove-arrow', targetId: item.arrow.id, label: 'Remover programação paralela', change: `Excluir a seta de programação direta para ${item.process.label}.` },
  }));
  if (simulation.pacemaker && !scheduledProcesses.some((item) => item.process.id === simulation.pacemaker?.id)) advice.push({
    id: 'schedule-pacemaker', level: 'opportunity', area: 'programacao', title: 'Marcapasso sem programação visível',
    why: 'O mapa não mostra como o Controle da Produção libera trabalho para o marcapasso.',
    action: 'Conecte o Controle da Produção ao marcapasso com uma seta de programação.',
    targetId: simulation.pacemaker.id, targetLabel: simulation.pacemaker.label,
    expected: 'O MFV passa a mostrar visualmente o único elo programado pelo Controle da Produção.',
    fix: { kind: 'add-schedule', processId: simulation.pacemaker.id, label: 'Conectar programação', change: `Criar uma seta de programação do Controle da Produção para ${simulation.pacemaker.label}.` },
  });

  simulation.pullBuffers.forEach((buffer) => {
    const bufferCenter = centerOf(buffer);
    const nearbyKanban = simulation.kanbanControls.find((kanban) => {
      const kanbanCenter = centerOf(kanban);
      return Math.hypot(bufferCenter.x - kanbanCenter.x, bufferCenter.y - kanbanCenter.y) <= 240;
    });
    if (!nearbyKanban) advice.push({
      id: `kanban-missing-${buffer.id}`, level: 'critical', area: 'kanban', title: `${buffer.label}: reposição sem Kanban`,
      why: 'O estoque controlado existe, mas não há um sinal próximo que autorize a reposição.',
      action: 'Adicione Kanban de retirada/produção e informe a quantidade de cartões.',
      targetId: buffer.id, targetLabel: buffer.label,
      expected: 'O estoque controlado ganha um sinal explícito de reposição e um limite calculável.',
      fix: { kind: 'add-kanban', targetId: buffer.id, label: 'Adicionar Kanban', change: `Adicionar um Kanban de retirada próximo a ${buffer.label} e dimensioná-lo com os dados atuais.` },
    });
    if (Number(buffer.data.qty) <= 0) advice.push({
      id: `limit-missing-${buffer.id}`, level: 'critical', area: 'pull', title: `${buffer.label}: limite não informado`,
      why: 'Sem limite máximo, o controle puxado não consegue impedir o crescimento do WIP.',
      action: 'Informe o limite de unidades permitido neste ponto.', targetId: buffer.id, targetLabel: buffer.label,
      expected: 'A simulação passa a bloquear liberações quando o limite do estoque controlado é atingido.',
      fix: { kind: 'set-buffer-limit', targetId: buffer.id, value: Math.max(1, Math.ceil(simulation.weightedPackSize), nearbyKanban ? calculateKanbanSizing(nearbyKanban, canvas.assumptions).authorizedUnits : 0), label: 'Definir limite inicial', change: `Definir um limite inicial que comporte a embalagem e os cartões do circuito.` },
    });
  });
  simulation.kanbanSizing.filter((sizing) => sizing.cards <= 0).forEach(({ element: kanban }) => advice.push({
    id: `cards-missing-${kanban.id}`, level: 'critical', area: 'kanban', title: 'Kanban sem quantidade de cartões',
    why: 'Um cartão sem quantidade não define o limite de trabalho autorizado.',
    action: 'Informe o produto, o tempo de reposição e a segurança para calcular a quantidade recomendada.',
    targetId: kanban.id, targetLabel: kanban.label,
    expected: 'O circuito passa a autorizar uma quantidade finita de unidades e pode controlar a liberação.',
    fix: { kind: 'size-kanban', targetId: kanban.id, value: Math.max(1, calculateKanbanSizing({ ...kanban, data: { ...kanban.data, replenishmentMin: Number(kanban.data.replenishmentMin) || 60, safetyPercent: Number(kanban.data.safetyPercent) || 10 } }, canvas.assumptions).recommendedCards), label: 'Dimensionar Kanban', change: 'Assumir reposição inicial de 60 min e segurança de 10%, calcular e aplicar os cartões.' },
  }));
  simulation.kanbanSizing.filter((sizing) => sizing.cards > 0 && sizing.replenishmentMin <= 0).forEach(({ element: kanban }) => advice.push({
    id: `replenishment-missing-${kanban.id}`, level: 'opportunity', area: 'dados', title: 'Tempo de reposição do Kanban não informado',
    why: 'Sem o ciclo completo de coleta, produção e entrega, não é possível validar a quantidade de cartões.',
    action: 'Cronometre o tempo de reposição e informe-o no cartão Kanban.', targetId: kanban.id, targetLabel: kanban.label,
    expected: 'O cartão ganha uma hipótese explícita para permitir o cálculo; o valor ainda deve ser validado no gemba.',
    fix: { kind: 'size-kanban', targetId: kanban.id, label: 'Usar hipótese de 60 min', change: 'Definir provisoriamente reposição de 60 min e segurança de 10%, recalculando os cartões.' },
  }));
  simulation.kanbanSizing.filter((sizing) => sizing.recommendedCards > 0 && sizing.cards > 0 && sizing.cards < sizing.recommendedCards)
    .forEach((sizing) => advice.push({
      id: `kanban-short-${sizing.element.id}`, level: 'critical', area: 'kanban', title: `${sizing.productName}: faltam cartões no circuito`,
      why: `${sizing.cards} cartão(ões) autorizam ${sizing.authorizedUnits} unidades, abaixo dos ${sizing.recommendedCards} cartões calculados para a reposição.`,
      action: `Teste ${sizing.recommendedCards} cartões (${sizing.recommendedUnits} unidades) e valide o consumo real.`,
      targetId: sizing.element.id, targetLabel: sizing.element.label,
      expected: `O circuito passa a cobrir o consumo durante a reposição com ${sizing.recommendedCards} cartões.`,
      fix: { kind: 'size-kanban', targetId: sizing.element.id, value: sizing.recommendedCards, label: 'Aplicar recomendação', change: `Alterar de ${sizing.cards} para ${sizing.recommendedCards} cartões.` },
    }));
  simulation.kanbanSizing.filter((sizing) => sizing.recommendedCards > 0 && sizing.cards > sizing.recommendedCards * 1.5)
    .forEach((sizing) => advice.push({
      id: `kanban-excess-${sizing.element.id}`, level: 'opportunity', area: 'kanban', title: `${sizing.productName}: excesso potencial de cartões`,
      why: `${sizing.cards} cartões foram configurados, enquanto o cálculo indica ${sizing.recommendedCards}.`,
      action: 'Reduza gradualmente o número de cartões e acompanhe rupturas antes de consolidar o novo limite.',
      targetId: sizing.element.id, targetLabel: sizing.element.label,
      expected: `O WIP autorizado cai de ${sizing.authorizedUnits} para ${sizing.recommendedUnits} unidades, preservando a cobertura calculada.`,
      fix: { kind: 'size-kanban', targetId: sizing.element.id, value: sizing.recommendedCards, label: 'Reduzir cartões', change: `Alterar de ${sizing.cards} para ${sizing.recommendedCards} cartões.` },
    }));

  if (simulation.pacemaker && !simulation.heijunkaBoxes.length) advice.push({
    id: 'heijunka-missing', level: 'opportunity', area: 'marcapasso', title: 'Nivelamento ainda não representado',
    why: 'O marcapasso existe, mas o mapa não mostra como volume e mix serão nivelados.',
    action: 'Adicione um Heijunka Box próximo ao marcapasso.', targetId: simulation.pacemaker.id, targetLabel: simulation.pacemaker.label,
    expected: 'O cenário passa a representar o nivelamento de volume e mix por intervalos de pitch.',
    fix: { kind: 'add-heijunka', processId: simulation.pacemaker.id, label: 'Adicionar Heijunka Box', change: `Criar o quadro próximo a ${simulation.pacemaker.label}, com linhas para os produtos ativos.` },
  });
  if (simulation.pacemaker && simulation.heijunkaBoxes.length > 0 && simulation.leveledSequence.length > 0) advice.push({
    id: 'heijunka-active', level: 'good', area: 'programacao', title: `Sequência nivelada em ${simulation.leveledSequence.length} slots`,
    why: `O quadro distribui ${simulation.activeProductCount} produto(s) conforme demanda, embalagem e pitch: ${simulation.leveledSequence.slice(0, 10).map((slot) => slot.code).join(' → ')}${simulation.leveledSequence.length > 10 ? '…' : ''}`,
    action: 'Execute a sequência no marcapasso e compare a frequência real de troca com o EPEI calculado.',
    targetId: simulation.heijunkaBoxes[0].id, targetLabel: simulation.heijunkaBoxes[0].label,
  });
  if (simulation.activeProductCount > 1 && simulation.pacemaker) {
    if (simulation.epeiDays === Infinity) advice.push({
      id: 'epei-no-capacity', level: 'critical', area: 'programacao', title: 'O mix não cabe no tempo disponível',
      why: 'Depois de produzir a demanda diária, não sobra capacidade suficiente para realizar os setups do ciclo completo.',
      action: 'Reduza setup, alivie a carga do marcapasso ou amplie o tempo disponível antes de nivelar o mix.',
      targetId: simulation.pacemaker.id, targetLabel: simulation.pacemaker.label,
      expected: 'A capacidade adicional abre espaço para a demanda e para as trocas; o EPEI será recalculado em seguida.',
      fix: { kind: 'add-resources', targetId: simulation.pacemaker.id, value: Math.max((Number(simulation.pacemaker.data.recurso) || 1) + 1, Math.ceil((Number(simulation.pacemaker.data.recurso) || 1) * (simulation.pacemakerMetric?.loadPercent || 100) / 90)), label: 'Abrir capacidade no marcapasso', change: 'Elevar os recursos paralelos até a carga estimada ficar próxima de 90%, reservando tempo para setups.' },
    });
    else if (simulation.epeiDays > 1) advice.push({
      id: 'epei-long', level: 'opportunity', area: 'programacao', title: `EPEI estimado em ${simulation.epeiDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dias`,
      why: 'O marcapasso não consegue completar todo o mix diariamente com o setup atual.',
      action: 'Use SMED para reduzir setup e aproxime o EPEI de um dia ou menos.',
      targetId: simulation.pacemaker.id, targetLabel: simulation.pacemaker.label,
      expected: 'O EPEI simulado se aproxima de um dia, permitindo percorrer o mix com maior frequência.',
      fix: { kind: 'reduce-setup', targetId: simulation.pacemaker.id, value: Math.max(0.1, (Number(simulation.pacemaker.data.setup) || 0) / simulation.epeiDays * 0.95), label: 'Simular EPEI de 1 dia', change: `Reduzir o setup de ${Number(simulation.pacemaker.data.setup) || 0} para uma meta calculada que permita percorrer o mix diariamente.` },
    });
    else if (simulation.epeiDays > 0) advice.push({
      id: 'epei-ok', level: 'good', area: 'programacao', title: `Mix nivelável · EPEI ${simulation.epeiDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dia(s)`,
      why: 'O tempo disponível comporta a demanda e os setups necessários para percorrer o mix.',
      action: 'Converta os pitches por produto em intervalos no Heijunka Box.',
      targetId: simulation.pacemaker.id, targetLabel: simulation.pacemaker.label,
    });
    else advice.push({
      id: 'epei-setup-missing', level: 'opportunity', area: 'dados', title: 'Informe o setup do marcapasso para calcular o EPEI',
      why: 'Há mais de um produto no mix, mas o tempo de troca está zerado.',
      action: 'Meça a troca entre produtos e preencha o setup do processo marcapasso.',
      targetId: simulation.pacemaker.id, targetLabel: simulation.pacemaker.label,
    });
  }
  if (simulation.pullSystemActive) advice.push({
    id: 'pull-ok', level: 'good', area: 'pull', title: `Sistema puxado ativo · WIP máximo ${simulation.pullWipLimit}`,
    why: 'Supermercado/FIFO e Kanban possuem limites e já controlam a liberação da simulação.',
    action: 'Valide se o limite representa a condição real e observe as ordens bloqueadas durante o teste.',
    targetId: simulation.pullBuffers[0]?.id, targetLabel: simulation.pullBuffers[0]?.label,
  });
  if (simulation.pullSystemActive && simulation.pullWipLimit < Math.ceil(simulation.weightedPackSize)) advice.push({
    id: 'pull-below-pack', level: 'critical', area: 'pull', title: 'Limite puxado menor que uma embalagem',
    why: `O limite é ${simulation.pullWipLimit}, mas a embalagem média libera ${Math.ceil(simulation.weightedPackSize)} unidades por pitch.`,
    action: 'Ajuste a quantidade por embalagem ou dimensione o limite puxado para comportar ao menos uma reposição completa.',
    targetId: simulation.pullBuffers[0]?.id, targetLabel: simulation.pullBuffers[0]?.label,
    expected: 'Ao menos uma embalagem completa consegue entrar no circuito sem ficar bloqueada na origem.',
    fix: simulation.pullBuffers[0] ? { kind: 'increase-pull-limit', targetId: simulation.pullBuffers[0].id, value: Math.ceil(simulation.weightedPackSize), label: 'Ajustar limite mínimo', change: `Elevar o limite para ${Math.ceil(simulation.weightedPackSize)} unidades e permitir uma embalagem completa.` } : undefined,
  });

  const rank: Record<LeanAdviceLevel, number> = { critical: 0, opportunity: 1, good: 2 };
  return advice.sort((left, right) => rank[left.level] - rank[right.level]);
}

function applyLeanFix(canvas: CanvasState, advice: LeanAdvice): CanvasState {
  const fix = advice.fix;
  if (!fix) return canvas;
  const next = cloneCanvas(canvas);
  const findElement = (id?: string) => next.elements.find((element) => element.id === id);
  const processElements = materialFlowOrder(next.elements, next.arrows).processes;
  const createLibraryElement = (kind: ElementKind, x: number, y: number, label?: string): CanvasElement => {
    const item = LIBRARY.find((candidate) => candidate.kind === kind);
    return { id: `${kind}-${makeId()}`, kind, x, y, label: label ?? item?.defaultLabel ?? kind, data: { ...(item?.defaultData ?? {}) } };
  };

  if (fix.kind === 'add-boundary' && fix.elementKind) {
    if (fix.elementKind === 'raw-material') {
      const first = processElements[0];
      next.elements.push(createLibraryElement('raw-material', first ? first.x - 190 : 80, first ? first.y + 20 : 260, 'Matéria-prima'));
    } else {
      const last = processElements[processElements.length - 1];
      next.elements.push(createLibraryElement('customer', last ? last.x + elementDimensions(last).width + 190 : 1500, last ? Math.max(20, last.y - 190) : 40, 'Cliente final'));
    }
  }
  if (fix.kind === 'add-resources') {
    const target = findElement(fix.targetId);
    if (target) target.data.recurso = Math.max(1, Math.round(fix.value || 1));
  }
  if (fix.kind === 'remove-elements' && fix.targetIds?.length) {
    const removedControls = next.elements.filter((element) => fix.targetIds!.includes(element.id));
    const dependentKanbanIds = next.elements.filter((element) => KANBAN_CONTROL_KINDS.includes(element.kind)
      && removedControls.some((control) => Math.hypot(centerOf(element).x - centerOf(control).x, centerOf(element).y - centerOf(control).y) <= 180))
      .map((element) => element.id);
    const removeIds = new Set([...fix.targetIds, ...dependentKanbanIds]);
    next.elements = next.elements.filter((element) => !removeIds.has(element.id));
    next.arrows = next.arrows.filter((arrow) => !removeIds.has(arrow.startAnchor?.elementId ?? '') && !removeIds.has(arrow.endAnchor?.elementId ?? ''));
  }
  if (fix.kind === 'create-pull') {
    const upstream = findElement(fix.upstreamId);
    const downstream = findElement(fix.downstreamId);
    if (upstream && downstream && fix.controlKind) {
      const upstreamCenter = centerOf(upstream);
      const downstreamCenter = centerOf(downstream);
      const control = createLibraryElement(fix.controlKind, (upstreamCenter.x + downstreamCenter.x) / 2 - 40, Math.max(upstream.y, downstream.y) + 45, fix.controlKind === 'fifo' ? 'FIFO' : 'Supermercado');
      const kanban = createLibraryElement('kanban-withdrawal', control.x + 10, control.y - 70, 'Kanban\nretirada');
      kanban.data.replenishmentMin = 60;
      kanban.data.safetyPercent = 10;
      const sizing = calculateKanbanSizing(kanban, next.assumptions);
      kanban.data.qty = Math.max(1, sizing.recommendedCards);
      control.data.qty = Math.max(sizing.recommendedUnits, Math.ceil(calculateScenario(next.assumptions).weightedPackSize));
      next.elements.push(control, kanban);
      next.arrows.push({
        id: `pull-${makeId()}`, kind: 'arrow-pull',
        x1: downstream.x, y1: downstreamCenter.y,
        x2: upstream.x + elementDimensions(upstream).width, y2: upstreamCenter.y,
        startAnchor: { elementId: downstream.id, x: 0, y: .5 },
        endAnchor: { elementId: upstream.id, x: 1, y: .5 },
        label: 'Reposição puxada',
      });
    }
  }
  if (fix.kind === 'set-pacemaker' && fix.processId) {
    const process = findElement(fix.processId);
    if (process) {
      const markers = next.elements.filter((element) => element.kind === 'pacemaker');
      if (markers.length) {
        const keep = markers[0];
        keep.data.processId = process.id;
        keep.label = process.label;
        keep.x = process.x + elementDimensions(process).width / 2 - 59;
        keep.y = process.y - 82;
        const extraIds = new Set(markers.slice(1).map((marker) => marker.id));
        next.elements = next.elements.filter((element) => !extraIds.has(element.id));
      } else {
        const marker = createLibraryElement('pacemaker', process.x + elementDimensions(process).width / 2 - 59, process.y - 82, process.label);
        marker.data.processId = process.id;
        next.elements.push(marker);
      }
    }
  }
  if (fix.kind === 'remove-arrow' && fix.targetId) next.arrows = next.arrows.filter((arrow) => arrow.id !== fix.targetId);
  if (fix.kind === 'add-schedule' && fix.processId) {
    const process = findElement(fix.processId);
    const planning = findElement(FIXED_PLANNING_ID);
    if (process && planning) {
      const planningSize = elementDimensions(planning);
      const processSize = elementDimensions(process);
      next.arrows.push({
        id: `schedule-${makeId()}`, kind: 'arrow-schedule', label: 'Programação',
        x1: planning.x + planningSize.width / 2, y1: planning.y + planningSize.height,
        x2: process.x + processSize.width / 2, y2: process.y,
        startAnchor: { elementId: planning.id, x: .5, y: 1 },
        endAnchor: { elementId: process.id, x: .5, y: 0 },
      });
    }
  }
  if (fix.kind === 'add-kanban' && fix.targetId) {
    const buffer = findElement(fix.targetId);
    if (buffer) {
      const kanban = createLibraryElement('kanban-withdrawal', buffer.x + elementDimensions(buffer).width / 2 - 30, buffer.y - 66, 'Kanban\nretirada');
      const sizing = calculateKanbanSizing(kanban, next.assumptions);
      kanban.data.qty = Math.max(1, sizing.recommendedCards);
      buffer.data.qty = Math.max(Number(buffer.data.qty) || 0, sizing.recommendedUnits, Math.ceil(calculateScenario(next.assumptions).weightedPackSize));
      next.elements.push(kanban);
    }
  }
  if (fix.kind === 'set-buffer-limit') {
    const buffer = findElement(fix.targetId);
    if (buffer) buffer.data.qty = Math.max(1, Math.ceil(fix.value || 1));
  }
  if (fix.kind === 'size-kanban') {
    const kanban = findElement(fix.targetId);
    if (kanban) {
      kanban.data.replenishmentMin = Math.max(1, Number(kanban.data.replenishmentMin) || 60);
      kanban.data.safetyPercent = Math.max(0, Number(kanban.data.safetyPercent) || 10);
      const sizing = calculateKanbanSizing(kanban, next.assumptions);
      kanban.data.qty = Math.max(1, Math.round(fix.value || sizing.recommendedCards || 1));
    }
  }
  if (fix.kind === 'add-heijunka' && fix.processId) {
    const process = findElement(fix.processId);
    if (process) {
      const scenario = calculateScenario(next.assumptions);
      const leveling = buildLeveledSequence(scenario.productMetrics);
      const heijunka = createLibraryElement('heijunka', process.x + elementDimensions(process).width / 2 - 70, process.y - 190, 'Heijunka');
      heijunka.data.rows = Math.max(1, scenario.productMetrics.filter((item) => item.monthlyDemand > 0).length);
      heijunka.data.cols = Math.min(8, Math.max(1, leveling.slots.length));
      next.elements.push(heijunka);
    }
  }
  if (fix.kind === 'reduce-setup') {
    const process = findElement(fix.targetId);
    if (process) process.data.setup = Math.max(0.1, Number((fix.value || .1).toFixed(2)));
  }
  if (fix.kind === 'increase-pull-limit') {
    const minimum = Math.max(1, Math.ceil(fix.value || 1));
    next.elements.forEach((element) => {
      if (['supermarket','fifo'].includes(element.kind)) element.data.qty = Math.max(minimum, Number(element.data.qty) || 0);
      if (KANBAN_CONTROL_KINDS.includes(element.kind)) {
        const sizing = calculateKanbanSizing(element, next.assumptions);
        element.data.qty = Math.max(sizing.cards, Math.ceil(minimum / sizing.packSize));
      }
    });
  }
  next.arrows = syncAnchoredArrows(next.arrows, next.elements);
  return normalizeCanvas(next);
}

function planningData(assumptions: ScenarioAssumptions) {
  const metrics = calculateScenario(assumptions);
  return {
    demanda: metrics.monthlyDemand,
    demandaDiaria: metrics.dailyDemand,
    diasUteis: assumptions.workdaysPerMonth,
    minutosDia: assumptions.availableMinutesPerDay,
    takt: metrics.taktTimeSec,
    pitch: metrics.pitchTimeSec,
    embalagem: metrics.weightedPackSize,
    produtos: metrics.productMetrics.filter((item) => item.monthlyDemand > 0).length,
  };
}

function createFixedPlanning(assumptions: ScenarioAssumptions): CanvasElement {
  return {
    id: FIXED_PLANNING_ID,
    kind: 'planning',
    x: 520,
    y: 30,
    label: 'Controle da Produção',
    data: planningData(assumptions),
  };
}

function createFixedIdentification(planning: CanvasElement): CanvasElement {
  return {
    id: FIXED_IDENTIFICATION_ID,
    kind: 'identification',
    x: planning.x - 100,
    y: Math.max(-60, planning.y - 115),
    label: 'Identificação do MFV',
    data: { family: '', companyName: '', productName: '', companyImage: '', productImage: '' },
  };
}

function isCanvasElement(value: unknown): value is CanvasElement {
  const element = value as Partial<CanvasElement> | null;
  return typeof element === 'object' && element !== null
    && typeof element.id === 'string' && typeof element.kind === 'string'
    && Number.isFinite(element.x) && Number.isFinite(element.y)
    && typeof element.data === 'object' && element.data !== null;
}

function isCanvasArrow(value: unknown): value is CanvasArrow {
  const arrow = value as Partial<CanvasArrow> | null;
  return typeof arrow === 'object' && arrow !== null
    && typeof arrow.id === 'string' && typeof arrow.kind === 'string'
    && [arrow.x1, arrow.y1, arrow.x2, arrow.y2].every(Number.isFinite);
}

function normalizeCanvas(raw: Partial<CanvasState> | undefined, legacy?: Partial<Scenario>, resetThemeLinkedTrucks = false): CanvasState {
  const elements = (Array.isArray(raw?.elements) ? raw.elements : [])
    .filter(isCanvasElement)
    .map((element) => typeof element.label === 'string' ? element : { ...(element as CanvasElement), label: '' });
  const existingPlanning = elements.find((element) => element.id === FIXED_PLANNING_ID)
    ?? elements.find((element) => element.kind === 'planning');
  const legacyDemand = positiveNumber(raw?.assumptions?.monthlyDemand ?? legacy?.monthlyDemand ?? existingPlanning?.data.demanda, DEFAULT_ASSUMPTIONS.monthlyDemand);
  const productMix = normalizedProductMix(raw?.assumptions?.productMix, legacyDemand);
  const assumptions: ScenarioAssumptions = {
    monthlyDemand: productMix.reduce((sum, item) => sum + item.monthlyDemand, 0) || legacyDemand,
    workdaysPerMonth: positiveNumber(raw?.assumptions?.workdaysPerMonth ?? legacy?.workdaysPerMonth ?? existingPlanning?.data.diasUteis, DEFAULT_ASSUMPTIONS.workdaysPerMonth),
    availableMinutesPerDay: positiveNumber(raw?.assumptions?.availableMinutesPerDay ?? legacy?.availableMinutesPerDay ?? existingPlanning?.data.minutosDia, DEFAULT_ASSUMPTIONS.availableMinutesPerDay),
    productMix,
  };
  const fixedPlanning = existingPlanning
    ? { ...existingPlanning, id: FIXED_PLANNING_ID, kind: 'planning' as const, data: { ...existingPlanning.data, ...planningData(assumptions) } }
    : createFixedPlanning(assumptions);
  const existingIdentification = elements.find((element) => element.id === FIXED_IDENTIFICATION_ID)
    ?? elements.find((element) => element.kind === 'identification');
  const fixedIdentification = existingIdentification
    ? { ...existingIdentification, id: FIXED_IDENTIFICATION_ID, kind: 'identification' as const }
    : createFixedIdentification(fixedPlanning);
  const themeColor = validThemeColor(raw?.themeColor);
  return {
    elements: [
      fixedIdentification,
      fixedPlanning,
      ...elements.filter((element) => element !== existingPlanning && element !== existingIdentification
        && element.id !== FIXED_PLANNING_ID && element.id !== FIXED_IDENTIFICATION_ID && element.kind !== 'timeline')
        .map((element) => ['process','shared-process'].includes(element.kind) && element.data.qualidade === undefined
          ? { ...element, data: { ...element.data, qualidade: 100 } }
          : element)
        .map((element) => element.kind === 'resource-zone' && element.label === 'RECURSOS DA CÉLULA / MANUTENÇÃO'
          ? { ...element, label: 'ÁREA DE INTERVENÇÃO' }
          : element)
        .map((element) => element.kind === 'customer' && element.label === 'Cliente'
          ? { ...element, label: 'Cliente final' }
          : element)
        .map((element) => {
          if (!TINTABLE_ASSET_KINDS.includes(element.kind)) return element;
          const elementColor = String(element.data.color ?? '');
          const defaultColor = DEFAULT_TRUCK_COLOR;
          const shouldRestoreDefault = !elementColor
            || (element.kind === 'truck' && resetThemeLinkedTrucks && elementColor.toLowerCase() === themeColor.toLowerCase());
          return shouldRestoreDefault ? { ...element, data: { ...element.data, color: defaultColor } } : element;
        }),
    ],
    arrows: Array.isArray(raw?.arrows) ? raw.arrows.filter(isCanvasArrow) : [],
    assumptions,
    themeColor,
  };
}

function syncCurrentIntoFuture(previousCurrent: CanvasState, current: CanvasState, future: CanvasState): CanvasState {
  return normalizeCanvas(syncCanvasForward(previousCurrent, current, future));
}

function createExcelTemplate(assumptions: ScenarioAssumptions, scenario: ActiveKind): CanvasState {
  const processSpecs = [
    ['Posicionar caixa na esteira', 690],
    ['Início da montagem da caixa', 1620],
    ['Finalizar montagem e fechamento', 2160],
    ['Passar fita de fechamento', 450],
    ['Túnel de embalamento', 1980],
    ['Colagem de adesivo e empilhamento', 900],
  ] as const;
  const fixedPlanning = { ...createFixedPlanning(assumptions), x: 660, y: 20 };
  const processes = processSpecs.map(([label, tc], index): CanvasElement => ({
    id: `${scenario}-process-${index + 1}-${makeId()}`,
    kind: 'process',
    x: 220 + index * 210,
    y: 250,
    label,
    data: { tc, setup: 0, lote: 1, op: 1, recurso: 1, disp: 100, qualidade: 100 },
  }));
  const inventories = processSpecs.map((_, index): CanvasElement => ({
    id: `${scenario}-inventory-${index + 1}-${makeId()}`,
    kind: 'inventory',
    x: 382 + index * 210,
    y: 325,
    label: `Estoque ${index + 1}`,
    data: { qty: 0 },
  }));
  const supplier: CanvasElement = { id: `${scenario}-supplier-${makeId()}`, kind: 'supplier', x: 70, y: 25, label: 'Fornecedor', data: { freq: 1 } };
  const customer: CanvasElement = { id: `${scenario}-customer-${makeId()}`, kind: 'customer', x: 1730, y: 25, label: 'Cliente final', data: { freq: 1 } };
  const rawMaterial: CanvasElement = { id: `${scenario}-raw-${makeId()}`, kind: 'raw-material', x: 45, y: 275, label: 'Matéria-prima', data: { qty: 0 } };
  const shipping: CanvasElement = { id: `${scenario}-shipping-${makeId()}`, kind: 'shipping-point', x: 1510, y: 285, label: 'Expedição', data: {} };
  const materialNodes = [rawMaterial, ...processes, shipping, customer];
  const materialArrows = materialNodes.slice(0, -1).map((node, index): CanvasArrow => {
    const next = materialNodes[index + 1];
    const nodeSize = elementDimensions(node);
    const nextSize = elementDimensions(next);
    return {
      id: `${scenario}-flow-${index}-${makeId()}`,
      kind: 'arrow-push',
      x1: node.x + nodeSize.width,
      y1: node.y + nodeSize.height / 2,
      x2: next.x,
      y2: next.y + nextSize.height / 2,
      startAnchor: { elementId: node.id, x: 1, y: .5 },
      endAnchor: { elementId: next.id, x: 0, y: .5 },
    };
  });
  const informationArrows: CanvasArrow[] = [
    { id: `${scenario}-info-supplier-${makeId()}`, kind: 'arrow-info-manual', x1: fixedPlanning.x, y1: fixedPlanning.y + 65, x2: supplier.x + 120, y2: supplier.y + 40, label: 'Programação' },
    { id: `${scenario}-info-customer-${makeId()}`, kind: 'arrow-info-electronic', x1: customer.x, y1: customer.y + 40, x2: fixedPlanning.x + 190, y2: fixedPlanning.y + 65, label: 'Demanda' },
  ];
  return normalizeCanvas({
    assumptions,
    elements: [fixedPlanning, supplier, customer, rawMaterial, ...processes, ...inventories, shipping],
    arrows: [...materialArrows, ...informationArrows],
  });
}

function createFutureVariant(current: CanvasState, name = 'Cenário base', id = `future-${makeId()}`): FutureVariant {
  return { id, name, canvas: cloneCanvas(current) };
}

function normalizeWorkspace(
  parsed: Partial<CanvasWorkspace>,
  legacy?: { current?: Scenario; future?: Scenario },
  resetThemeLinkedTrucks = false,
): CanvasWorkspace {
  const current = normalizeCanvas(parsed.current, legacy?.current, resetThemeLinkedTrucks);
  const rawFutures = Array.isArray(parsed.futures)
    ? parsed.futures.filter((variant): variant is FutureVariant => typeof variant === 'object' && variant !== null)
    : [];
  const futures = rawFutures.length
    ? rawFutures.map((variant, index) => ({
        id: typeof variant.id === 'string' && variant.id ? variant.id : `future-${makeId()}`,
        name: typeof variant.name === 'string' && variant.name ? variant.name : `Cenário ${index + 1}`,
        canvas: normalizeCanvas(variant.canvas, legacy?.future, resetThemeLinkedTrucks),
      }))
    : [createFutureVariant(current)];
  return {
    current,
    futures,
    activeFutureId: futures.some((variant) => variant.id === parsed.activeFutureId) ? String(parsed.activeFutureId) : futures[0].id,
  };
}

/** Grava o workspace no navegador; devolve false quando o armazenamento está cheio ou bloqueado. */
function persistWorkspace(workspace: CanvasWorkspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

const PROJECT_FILE_FORMAT = 'mfv-simulation-project';

function projectFileContents(workspace: CanvasWorkspace) {
  return JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 1, savedAt: new Date().toISOString(), workspace }, null, 2);
}

function parseProjectFile(text: string): CanvasWorkspace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const file = parsed as { format?: unknown; workspace?: Partial<CanvasWorkspace> } | null;
  if (!file || file.format !== PROJECT_FILE_FORMAT || typeof file.workspace !== 'object' || file.workspace === null) {
    throw new Error('Este arquivo não é um projeto do Simulador MFV.');
  }
  return normalizeWorkspace(file.workspace);
}

function loadWorkspace(): CanvasWorkspace {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const previousCanvasRaw = localStorage.getItem(PREVIOUS_STORAGE_KEY);
    const olderCanvasRaw = localStorage.getItem(OLDER_STORAGE_KEY);
    const oldestCanvasRaw = localStorage.getItem(OLDEST_STORAGE_KEY);
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const legacy = legacyRaw ? JSON.parse(legacyRaw) as { current?: Scenario; future?: Scenario } : undefined;
    if (saved) return normalizeWorkspace(JSON.parse(saved) as Partial<CanvasWorkspace>, legacy);
    if (previousCanvasRaw) {
      const result = normalizeWorkspace(JSON.parse(previousCanvasRaw) as Partial<CanvasWorkspace>, legacy, true);
      persistWorkspace(result);
      return result;
    }
    const priorRaw = olderCanvasRaw ?? oldestCanvasRaw;
    if (priorRaw) {
      const parsed = JSON.parse(priorRaw) as Partial<Record<ActiveKind, CanvasState>>;
      const current = normalizeCanvas(parsed.current, legacy?.current, true);
      const future = parsed.future ? normalizeCanvas(parsed.future, legacy?.future, true) : cloneCanvas(current);
      const result: CanvasWorkspace = { current, futures: [{ id: 'future-base', name: 'Cenário base', canvas: future }], activeFutureId: 'future-base' };
      persistWorkspace(result);
      return result;
    }
    const current = normalizeCanvas(undefined, legacy?.current);
    const variant = createFutureVariant(current, 'Cenário base', 'future-base');
    return { current, futures: [variant], activeFutureId: variant.id };
  } catch { /* ignore */ }
  const current = normalizeCanvas(undefined);
  const variant = createFutureVariant(current, 'Cenário base', 'future-base');
  return { current, futures: [variant], activeFutureId: variant.id };
}

function canvasForPreset(current: CanvasState, preset: ScenarioPreset) {
  const next = cloneCanvas(current);
  if (preset === 'demand-up' || preset === 'demand-down') {
    const factor = preset === 'demand-up' ? 1.2 : 0.8;
    next.assumptions.productMix = next.assumptions.productMix.map((item) => ({ ...item, monthlyDemand: item.monthlyDemand * factor }));
    next.assumptions.monthlyDemand = next.assumptions.productMix.reduce((sum, item) => sum + item.monthlyDemand, 0);
  }
  if (preset === 'setup-half') next.elements = next.elements.map((element) => ['process','shared-process'].includes(element.kind)
    ? { ...element, data: { ...element.data, setup: Math.max(0, Number(element.data.setup) || 0) * 0.5 } }
    : element);
  if (preset === 'availability-up') next.elements = next.elements.map((element) => ['process','shared-process'].includes(element.kind)
    ? { ...element, data: { ...element.data, disp: Math.min(100, percentValue(element.data.disp) + 10) } }
    : element);
  if (preset === 'one-piece-flow') next.elements = next.elements.map((element) => ['process','shared-process'].includes(element.kind)
    ? { ...element, data: { ...element.data, lote: 1 } }
    : element);
  if (preset === 'batch-production') next.elements = next.elements.map((element) => ['process','shared-process'].includes(element.kind)
    ? { ...element, data: { ...element.data, lote: Math.max(1, Number(element.data.lote) || 1) > 1 ? Number(element.data.lote) : 5 } }
    : element);
  if (preset === 'quality-up') next.elements = next.elements.map((element) => ['process','shared-process'].includes(element.kind)
    ? { ...element, data: { ...element.data, qualidade: Math.min(100, percentValue(element.data.qualidade) + 5) } }
    : element);
  if (preset === 'bottleneck-resource') {
    const bottleneckId = calculateCanvasSimulation(next).bottleneck?.id;
    if (bottleneckId) next.elements = next.elements.map((element) => element.id === bottleneckId
      ? { ...element, data: { ...element.data, recurso: Math.max(1, Number(element.data.recurso) || 1) + 1 } }
      : element);
  }
  next.elements = next.elements.map((element) => element.id === FIXED_PLANNING_ID
    ? { ...element, data: planningData(next.assumptions) }
    : element);
  return normalizeCanvas(next);
}

// ─── Field definitions para cada elemento ────────────────────────────────────

const FIELD_DEFS: Partial<Record<ElementKind, { key: string; label: string; type?: string; suffix?: string }[]>> = {
  process:              [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'tc', label: 'Tempo de ciclo', suffix: 's' },{ key: 'pecasCiclo', label: 'Peças por ciclo', suffix: 'un' },{ key: 'setup', label: 'Setup / troca', suffix: 'min' },{ key: 'lote', label: 'Lote de produção', suffix: 'un' },{ key: 'op', label: 'Operadores', suffix: 'pess.' },{ key: 'recurso', label: 'Recursos paralelos', suffix: 'un' },{ key: 'disp', label: 'Disponibilidade / OEE', suffix: '%' },{ key: 'qualidade', label: 'Qualidade na saída', suffix: '%' }],
  'shared-process':     [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'tc', label: 'Tempo de ciclo', suffix: 's' },{ key: 'pecasCiclo', label: 'Peças por ciclo', suffix: 'un' },{ key: 'setup', label: 'Setup / troca', suffix: 'min' },{ key: 'lote', label: 'Lote de produção', suffix: 'un' },{ key: 'op', label: 'Operadores', suffix: 'pess.' },{ key: 'recurso', label: 'Recursos paralelos', suffix: 'un' },{ key: 'disp', label: 'Disponibilidade / OEE', suffix: '%' },{ key: 'qualidade', label: 'Qualidade na saída', suffix: '%' }],
  machine:              [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'color', label: 'Cor da máquina', type: 'color' },{ key: 'recurso', label: 'Quantidade', suffix: 'un' },{ key: 'disp', label: 'Disponibilidade', suffix: '%' }],
  inspection:           [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'tc', label: 'Tempo de ciclo', suffix: 's' },{ key: 'op', label: 'Operadores', suffix: 'pess.' }],
  'work-cell':          [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'op', label: 'Operadores', suffix: 'pess.' }],
  supplier:             [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'color', label: 'Cor do fornecedor', type: 'color' },{ key: 'freq', label: 'Frequência entrega', suffix: 'dias' }],
  customer:             [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'color', label: 'Cor do cliente', type: 'color' },{ key: 'freq', label: 'Frequência expedição', suffix: 'dias' }],
  truck:                [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'color', label: 'Cor do caminhão', type: 'color' },{ key: 'freq', label: 'Frequência', suffix: 'dias' }],
  'shipping-point':     [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'color', label: 'Cor da expedição', type: 'color' },{ key: 'lote', label: 'Lote de expedição', suffix: 'un' }],
  inventory:            [{ key: 'qty', label: 'Quantidade', suffix: 'un' }],
  'safety-stock':       [{ key: 'qty', label: 'Quantidade', suffix: 'un' }],
  'raw-material':       [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'color', label: 'Cor da matéria-prima', type: 'color' },{ key: 'qty', label: 'Quantidade', suffix: 'un' }],
  'finished-goods':     [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'color', label: 'Cor do produto acabado', type: 'color' },{ key: 'qty', label: 'Quantidade', suffix: 'un' }],
  warehouse:            [{ key: 'label', label: 'Nome', type: 'text' },{ key: 'color', label: 'Cor do armazém', type: 'color' },{ key: 'qty', label: 'Quantidade', suffix: 'un' }],
  buffer:               [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'qty', label: 'Quantidade', suffix: 'un' }],
  supermarket:          [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'qty', label: 'Limite de WIP', suffix: 'un' }],
  fifo:                 [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'qty', label: 'Limite da fila', suffix: 'un' }],
  'waiting-time':       [{ key: 'label', label: 'Tipo de espera', type: 'text' },{ key: 'durationMin', label: 'Duração', suffix: 'min' }],
  'resource-zone':      [{ key: 'label', label: 'Título da área', type: 'text' }],
  'kanban-production':  [],
  'kanban-withdrawal':  [],
  'kanban-board':       [{ key: 'label', label: 'Título', type: 'text' },{ key: 'cols', label: 'Colunas' },{ key: 'rows', label: 'Linhas' }],
  heijunka:             [{ key: 'label', label: 'Título', type: 'text' },{ key: 'cols', label: 'Slots visíveis' }],
  'sequencing-box':     [{ key: 'label', label: 'Título', type: 'text' },{ key: 'slots', label: 'Slots' }],
  planning:             [{ key: 'label', label: 'Título', type: 'text' },{ key: 'demanda', label: 'Demanda', suffix: 'un/mês' },{ key: 'takt', label: 'Takt time', suffix: 's' }],
  'data-box':           [{ key: 'label', label: 'Título', type: 'text' },{ key: 'tc', label: 'T/C', suffix: 's' },{ key: 'tcp', label: 'TCP', suffix: 's' },{ key: 'disp', label: 'Disponibilidade', suffix: '%' },{ key: 'turnos', label: 'Turnos' }],
  'customer-demand':    [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'qty', label: 'Quantidade', suffix: 'un' },{ key: 'periodo', label: 'Período', suffix: 'dias' }],
  'production-schedule':[{ key: 'label', label: 'Título', type: 'text' }],
  'erp-system':         [{ key: 'label', label: 'Nome do sistema', type: 'text' }],
  'go-see':             [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'freq', label: 'Frequência', suffix: 'dias' }],
  'transport-air':      [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'color', label: 'Cor do avião', type: 'color' },{ key: 'freq', label: 'Frequência', suffix: 'dias' }],
  'transport-ship':     [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'color', label: 'Cor do navio', type: 'color' },{ key: 'freq', label: 'Frequência', suffix: 'dias' }],
  forklift:             [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'color', label: 'Cor da empilhadeira', type: 'color' },{ key: 'distance', label: 'Distância', suffix: 'm' }],
  'milk-run':           [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'color', label: 'Cor do milk run', type: 'color' },{ key: 'freq', label: 'Frequência', suffix: 'dias' }],
  distance:             [{ key: 'distance', label: 'Distância', suffix: 'm' }],
  'quality-problem':    [{ key: 'label', label: 'Descrição', type: 'text' },{ key: 'qty', label: 'Ocorrências', suffix: 'un' }],
  bottleneck:           [{ key: 'label', label: 'Descrição', type: 'text' }],
  pacemaker:            [],
  'future-principles':  [{ key: 'label', label: 'Princípios (uma linha por item)', type: 'textarea' }],
  'signal-kanban':      [],
  'kanban-post':        [{ key: 'label', label: 'Título', type: 'text' }],
  'sequenced-pull':     [{ key: 'label', label: 'Rótulo', type: 'text' },{ key: 'pitch', label: 'Pitch', suffix: 'min' }],
  operator:             [{ key: 'qty', label: 'Quantidade', suffix: 'pess.' }],
  kaizen:               [{ key: 'label', label: 'Texto', type: 'text' }],
  intervention:         [{ key: 'label', label: 'Texto', type: 'text' }],
  note:                 [{ key: 'label', label: 'Texto', type: 'text' }],
  timeline:             [{ key: 'label', label: 'Descrição', type: 'text' }],
  legend:               [{ key: 'label', label: 'Título', type: 'text' }],
};

// ─── Render de elemento ───────────────────────────────────────────────────────

function renderElement(el: CanvasElement, selected: boolean, onEdit: () => void, simulation: ReturnType<typeof calculateCanvasSimulation>, availableMinutesPerDay: number, accentColor = DEFAULT_THEME_COLOR) {
  const processMetric = simulation.processMetrics.find((metric) => metric.element.id === el.id);
  const p = {
    el,
    selected,
    onEdit,
    taktTimeSec: simulation.taktTimeSec,
    dailyDemand: simulation.dailyDemand,
    availableMinutesPerDay,
    leadTimeDays: simulation.leadTimeDays,
    processingTimeMin: simulation.processingTimeMin,
    accentColor,
    processLoadPercent: processMetric?.loadPercent,
    processCapacityPerDay: processMetric?.capacityPerDay,
    heijunkaSchedule: simulation.leveledSequence,
  };
  let symbol;
  switch (el.kind) {
    case 'process':             symbol = <ProcessSymbol {...p} />; break;
    case 'work-cell':           symbol = <WorkCellSymbol {...p} />; break;
    case 'supplier': case 'customer': symbol = <PartySymbol {...p} />; break;
    case 'truck':               symbol = <TruckSymbol {...p} />; break;
    case 'shipping-point':      symbol = <ShippingPointSymbol {...p} />; break;
    case 'inventory':           symbol = <InventorySymbol {...p} />; break;
    case 'buffer':              symbol = <BufferSymbol {...p} />; break;
    case 'supermarket':         symbol = <SupermarketSymbol {...p} />; break;
    case 'fifo':                symbol = <FifoSymbol {...p} />; break;
    case 'kanban-production':   symbol = <KanbanProductionSymbol {...p} />; break;
    case 'kanban-withdrawal':   symbol = <KanbanWithdrawalSymbol {...p} />; break;
    case 'kanban-board':        symbol = <KanbanBoardSymbol {...p} />; break;
    case 'heijunka':            symbol = <HeijunkaSymbol {...p} />; break;
    case 'sequencing-box':      symbol = <SequencingBoxSymbol {...p} />; break;
    case 'planning':            symbol = <PlanningSymbol {...p} />; break;
    case 'identification':      symbol = <IdentificationSymbol {...p} />; break;
    case 'data-box':            symbol = <DataBoxSymbol {...p} />; break;
    case 'customer-demand':     symbol = <CustomerDemandSymbol {...p} />; break;
    case 'production-schedule': symbol = <ProductionScheduleSymbol {...p} />; break;
    case 'operator':            symbol = <OperatorSymbol {...p} />; break;
    case 'kaizen':              symbol = <KaizenSymbol {...p} />; break;
    case 'intervention':        symbol = <InterventionSymbol {...p} />; break;
    case 'note':                symbol = <NoteSymbol {...p} />; break;
    case 'timeline':            symbol = <TimelineSymbol {...p} />; break;
    case 'legend':              symbol = <LegendSymbol {...p} />; break;
    default:                    symbol = <ExtendedSymbol {...p} />;
  }
  const defaults = defaultElementDimensions(el);
  const size = elementDimensions(el);
  if (size.width === defaults.width && size.height === defaults.height) return symbol;
  return <g transform={`scale(${size.width / defaults.width} ${size.height / defaults.height})`}>{symbol}</g>;
}

// ─── Thumbs da biblioteca ─────────────────────────────────────────────────────

function LibraryThumb({ kind, accentColor }: { kind: ElementKind; accentColor: string }) {
  const item = LIBRARY.find((candidate) => candidate.kind === kind);
  if (item && !ARROW_KINDS.includes(kind)) {
    const previewSimulation = calculateCanvasSimulation({ elements: [], arrows: [], assumptions: DEFAULT_ASSUMPTIONS, themeColor: accentColor });
    const previewElement: CanvasElement = {
      id: `preview-${kind}`,
      kind,
      x: 0,
      y: 0,
      label: item.defaultLabel,
      data: { ...item.defaultData },
    };
    return (
      <svg className="library-symbol-preview" width={52} height={52} viewBox={`${-6} ${-6} ${item.w + 12} ${item.h + 12}`} preserveAspectRatio="xMidYMid meet">
        {renderElement(previewElement, false, () => undefined, previewSimulation, DEFAULT_ASSUMPTIONS.availableMinutesPerDay, accentColor)}
      </svg>
    );
  }
  const S = 44;
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ overflow: 'visible' }}>
      {kind === 'process' && (<g transform="scale(0.275) translate(2,2)"><rect width={150} height={100} fill="white" stroke="#7a8494" strokeWidth={2}/><rect width={150} height={35} fill="#bfefc0"/><text x={75} y={22} textAnchor="middle" fontSize={16} fontWeight="700" fontFamily="Arial" fill="#1a2a1a">Processo</text></g>)}
      {(kind==='supplier'||kind==='customer') && (<g transform="scale(0.35) translate(2,2)"><rect width={120} height={80} fill={kind==='customer'?'#b8ccf5':'#a8bcf0'} stroke="#6a80cc" strokeWidth={2}/><rect x={8} y={10} width={22} height={18} fill="none" stroke="#1a2560" strokeWidth={1}/><polygon points="8,10 19,4 30,10" fill="#1a2560"/><text x={60} y={52} textAnchor="middle" fontSize={16} fontWeight="700" fontFamily="Arial" fill="#122060">{kind==='customer'?'Cliente':'Fornec.'}</text></g>)}
      {kind==='truck' && <image href={truckThreeQuarter} x={1} y={8} width={42} height={27} preserveAspectRatio="xMidYMid meet" />}
      {kind==='shipping-point' && (<g transform="scale(0.42) translate(2,2)"><rect width={100} height={70} rx={4} fill="#e8f0ff" stroke="#4a6ab0" strokeWidth={2}/><rect x={30} y={10} width={40} height={30} fill="none" stroke="#2a4a90" strokeWidth={2}/><polygon points="50,10 60,16 60,22 50,28 40,22 40,16" fill="#a8bcf0" stroke="#2a4a90" strokeWidth={1}/></g>)}
      {kind==='inventory' && (<polygon points="22,4 42,38 2,38" fill="#f0ce40" stroke="#b89020" strokeWidth={2}/>)}
      {kind==='buffer' && (<g><rect width={44} height={36} rx={3} fill="#fff3cc" stroke="#cc8800" strokeWidth={1.5} strokeDasharray="4 2" y={4}/><text x={22} y={26} textAnchor="middle" fontSize={16} fontWeight="900" fontFamily="Arial" fill="#cc8800">B</text></g>)}
      {kind==='supermarket' && (<g transform="translate(2,3)"><rect x={1} y={1} width={40} height={34} fill="none" stroke="#2c5fa8" strokeWidth={2}/><line x1={1} y1={12} x2={41} y2={12} stroke="#2c5fa8" strokeWidth={1}/><line x1={1} y1={23} x2={41} y2={23} stroke="#2c5fa8" strokeWidth={1}/>{[4,14,24].map(x=>[2,13,24].map(y=><rect key={`${x}-${y}`} x={x} y={y} width={6} height={7} fill="#a8c4f0" stroke="#2c5fa8" strokeWidth={0.5} rx={0.5}/>))}</g>)}
      {kind==='fifo' && (<g transform="translate(2,14)"><rect x={1} y={0} width={40} height={16} fill="none" stroke="#555" strokeWidth={2}/><text x={20} y={11} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="Arial" fill="#333">FIFO</text><polygon points="34,0 42,8 34,16" fill="#555"/></g>)}
      {kind==='kanban-production' && (<rect width={44} height={32} rx={3} y={6} fill="#ff9500" stroke="#cc6600" strokeWidth={1.5}/>)}
      {kind==='kanban-withdrawal' && (<rect width={44} height={32} rx={3} y={6} fill="#30a830" stroke="#1a7a1a" strokeWidth={1.5}/>)}
      {kind==='kanban-board' && (<g transform="scale(0.35) translate(2,2)"><rect width={120} height={100} rx={3} fill="#f0f4ff" stroke="#4a6ab0" strokeWidth={2}/><rect width={120} height={18} rx={3} fill="#4a6ab0"/><rect x={4} y={22} width={34} height={22} fill="#ff9500" stroke="#8090c0" strokeWidth={1}/><rect x={42} y={22} width={34} height={22} fill="white" stroke="#8090c0" strokeWidth={1}/><rect x={80} y={22} width={34} height={22} fill="#30a830" stroke="#8090c0" strokeWidth={1}/></g>)}
      {kind==='heijunka' && (<g transform="scale(0.3) translate(2,10)"><rect width={140} height={80} rx={3} fill="#fffbe8" stroke="#cc8800" strokeWidth={2}/><rect width={140} height={18} rx={3} fill="#cc8800"/>{[0,1,2,3,4].map(c=><rect key={c} x={5+c*26} y={20} width={24} height={24} rx={1} fill={['#ff9500','#30a830','#0071e3','#ff3b30','#5856d6'][c]} stroke="#cc8800" strokeWidth={1}/>)}</g>)}
      {kind==='sequencing-box' && (<g transform="scale(0.35) translate(2,10)"><rect width={120} height={60} rx={3} fill="#f5eeff" stroke="#6040b0" strokeWidth={2}/><rect width={120} height={18} rx={3} fill="#6040b0"/>{[0,1,2,3,4,5].map(i=><rect key={i} x={5+i*19} y={22} width={17} height={30} rx={1} fill="white" stroke="#8060c0" strokeWidth={1}/>)}</g>)}
      {kind==='planning' && (<g transform="scale(0.26) translate(2,2)"><rect width={160} height={110} fill="white" stroke="#8a93a8" strokeWidth={2}/><rect width={160} height={28} fill="#a8bcf0"/><text x={80} y={18} textAnchor="middle" fontSize={16} fontWeight="700" fontFamily="Arial" fill="#122060">Controle</text></g>)}
      {kind==='data-box' && (<g transform="scale(0.32) translate(2,2)"><rect width={130} height={90} fill="white" stroke="#606878" strokeWidth={2}/><rect width={130} height={20} fill="#c0c8d8"/><text x={65} y={13} textAnchor="middle" fontSize={13} fontWeight="700" fontFamily="Arial" fill="#202838">Dados</text>{['T/C','TCP','Disp.','Turnos'].map((k,i)=><text key={k} x={8} y={30+i*17} fontSize={11} fontFamily="Arial" fill="#50575f" fontWeight="700">{k}</text>)}</g>)}
      {kind==='customer-demand' && (<polygon points="22,4 4,40 40,40" fill="#c8dcff" stroke="#2a50a0" strokeWidth={2}/>)}
      {kind==='production-schedule' && (<g><path d="M4,4 L34,4 L40,10 L40,40 L4,40 Z" fill="#f0f2ff" stroke="#4a5ab0" strokeWidth={1.5}/><path d="M34,4 L34,10 L40,10" fill="none" stroke="#4a5ab0" strokeWidth={1.5}/>{[16,22,28,34].map(y=><line key={y} x1={8} y1={y} x2={36} y2={y} stroke="#8090c0" strokeWidth={0.8}/>)}</g>)}
      {kind==='operator' && (<g><circle cx={22} cy={10} r={7} fill="#e8f0ff" stroke="#2a50a0" strokeWidth={1.5}/><line x1={22} y1={17} x2={22} y2={30} stroke="#2a50a0" strokeWidth={2}/><line x1={12} y1={22} x2={32} y2={22} stroke="#2a50a0" strokeWidth={2}/><line x1={22} y1={30} x2={14} y2={42} stroke="#2a50a0" strokeWidth={2}/><line x1={22} y1={30} x2={30} y2={42} stroke="#2a50a0" strokeWidth={2}/></g>)}
      {kind==='kaizen' && (()=>{const pts=Array.from({length:16},(_,i)=>{const a=(i/16)*Math.PI*2;const r=i%2===0?20:13;return `${22+r*Math.cos(a)},${22+r*Math.sin(a)}`;}).join(' ');return <polygon points={pts} fill="#ffe04b" stroke="#b8930f" strokeWidth={1}/>;})()}
      {kind==='intervention' && (<g><circle cx={22} cy={22} r={16} fill="#ffebeb" stroke="#e03030" strokeWidth={2}/>{Array.from({length:8},(_,i)=>{const a=(i/8)*Math.PI*2;return <line key={i} x1={22+16*Math.cos(a)} y1={22+16*Math.sin(a)} x2={22+22*Math.cos(a)} y2={22+22*Math.sin(a)} stroke="#e03030" strokeWidth={2}/>;})} <text x={22} y={26} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="#b01010">!</text></g>)}
      {kind==='note' && (<g><rect x={2} y={6} width={40} height={32} rx={2} fill="#fff9c4" stroke="#c8b800" strokeWidth={1.5}/><path d="M32,6 L42,16 L32,16 Z" fill="#e8cc00"/>{[14,20,26].map(y=><line key={y} x1={6} y1={y} x2={30} y2={y} stroke="#d4c400" strokeWidth={0.8}/>)}</g>)}
      {kind==='timeline' && (<g transform="translate(2,10)"><rect width={40} height={24} rx={2} fill="#f4f6fc" stroke="#6070a0" strokeWidth={1.5}/><path d="M0,18 L8,8 L16,18 L24,8 L32,18 L40,18" fill="none" stroke="#6070a0" strokeWidth={1.5}/></g>)}
      {kind==='legend' && (<g transform="scale(0.27) translate(2,2)"><rect width={160} height={120} rx={3} fill="white" stroke="#8a9099" strokeWidth={2}/><rect width={160} height={20} rx={3} fill="#9aa0ae"/>{['Empurrado','Puxado','Manual','Eletrônica'].map((l,i)=><text key={l} x={36} y={30+i*22} fontSize={12} fontFamily="Arial" fill="#363b43">{l}</text>)}</g>)}
      {kind==='arrow-push' && (<g><defs><pattern id="thumb-push-zebra" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(24)"><rect width="8" height="8" fill="white"/><rect width="4" height="8" fill="#111"/></pattern></defs><path d="M2,19 H32 V15 L42,22 L32,29 V25 H2 Z" fill="url(#thumb-push-zebra)" stroke="#111" strokeWidth={1.4}/></g>)}
      {kind==='arrow-pull' && (<g><path d="M4,22 Q4,8 22,8 Q40,8 40,22 Q40,36 22,36 Q12,36 8,30" fill="none" stroke="#111" strokeWidth={2}/><polygon points="4,16 4,28 -1,22" fill="#111"/><circle cx={8} cy={30} r={3} fill="#111"/></g>)}
      {kind==='arrow-info-manual' && (<g><path d="M4,36 Q22,4 40,16" fill="none" stroke="#333" strokeWidth={2}/><polygon points="34,12 42,18 34,22" fill="#333"/></g>)}
      {kind==='arrow-info-electronic' && (<g><path d="M4,36 Q22,4 40,16" fill="none" stroke="#111" strokeWidth={2} strokeDasharray="4 3"/><polygon points="19,10 16,19 20,19 17,28 25,17 21,17" fill="#111"/><polygon points="34,12 42,18 34,22" fill="#111"/></g>)}
      {kind==='arrow-adjustment' && (<g><path d="M4,36 Q22,4 40,16" fill="none" stroke="#111" strokeWidth={2} strokeDasharray="2 2"/><polygon points="34,12 42,18 34,22" fill="#111"/><circle cx={4} cy={36} r={3} fill="#111"/></g>)}
      {kind==='arrow-schedule' && (<g><path d="M3,36 Q22,1 40,18" fill="none" stroke="#333" strokeWidth={2}/><polygon points="34,13 42,19 34,23" fill="#333"/></g>)}
      {kind==='arrow-shipment' && (<g><path d="M3,22 H39" fill="none" stroke="#333" strokeWidth={2} strokeDasharray="7 4"/><polygon points="34,17 42,22 34,27" fill="#333"/></g>)}
      {kind==='arrow-physical' && (<path d="M3,16 H30 L30,11 L41,22 L30,33 L30,28 H3 Z" fill="white" stroke="#111" strokeWidth={2}/>)}
      {kind==='line-straight' && (<line x1={3} y1={22} x2={41} y2={22} stroke="#111" strokeWidth={2}/>)}
      {kind==='line-dashed' && (<line x1={3} y1={22} x2={41} y2={22} stroke="#111" strokeWidth={2} strokeDasharray="6 4"/>)}
      {kind==='arrow-straight' && (<g><line x1={3} y1={22} x2={36} y2={22} stroke="#111" strokeWidth={2}/><polygon points="34,16 42,22 34,28" fill="#111"/></g>)}
      {kind==='arrow-double' && (<g><line x1={9} y1={22} x2={35} y2={22} stroke="#111" strokeWidth={2}/><polygon points="10,16 2,22 10,28" fill="#111"/><polygon points="34,16 42,22 34,28" fill="#111"/></g>)}
      {kind==='arrow-info-manual-straight' && (<g><line x1={3} y1={22} x2={36} y2={22} stroke="#111" strokeWidth={1.6}/><polygon points="34,17 42,22 34,27" fill="#111"/></g>)}
      {kind==='arrow-info-electronic-straight' && (<g><line x1={3} y1={22} x2={36} y2={22} stroke="#111" strokeWidth={1.8} strokeDasharray="4 3"/><polygon points="20,10 17,19 21,19 18,30 27,17 22,17" fill="#111"/><polygon points="34,17 42,22 34,27" fill="#111"/></g>)}
      <g transform="scale(.3)"><ExtendedSymbol el={{ id:'thumb', kind, x:0, y:0, label:'', data:{} }} selected={false} onEdit={() => undefined} /></g>
    </svg>
  );
}

// ─── Biblioteca lateral ───────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  material: 'Material e processo', logistica: 'Logística', kanban: 'Kanban', informacao: 'Informação',
  operador: 'Operador', fluxo: 'Setas / Fluxo', anotacao: 'Anotação',
};

interface SiteSelectOption { value: string; label: string }

function SiteSelect({ value, options, onChange, ariaLabel, className = '' }: {
  value: string;
  options: SiteSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 220, above: false });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const estimatedHeight = Math.min(280, options.length * 36 + 12);
      const above = rect.bottom + estimatedHeight > window.innerHeight - 12 && rect.top > estimatedHeight;
      const width = Math.min(Math.max(rect.width, 190), window.innerWidth - 20);
      const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
      setMenuPosition({ left, top: above ? rect.top - 6 : rect.bottom + 6, width, above });
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return <>
    <button ref={buttonRef} type="button" className={`site-select-trigger ${className}`} onClick={toggle} aria-label={ariaLabel} aria-expanded={open}>
      <span>{selected?.label ?? 'Selecione'}</span><ChevronDown size={14}/>
    </button>
    {open && createPortal(<div className="site-select-layer" onMouseDown={() => setOpen(false)}>
      <div className={`site-select-menu ${menuPosition.above ? 'above' : ''}`} style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }} onMouseDown={(event) => event.stopPropagation()}>
        {options.map((option) => <button type="button" key={option.value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false); }}>
          <span>{option.label}</span>{option.value === value && <CheckCircle2 size={14}/>}
        </button>)}
      </div>
    </div>, document.body)}
  </>;
}

function LibraryPanel({ onDragStart, accentColor }: { onDragStart: (item: LibraryItem, e: React.DragEvent) => void; accentColor: string }) {
  const [activeGroup, setActiveGroup] = useState('material');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(true);
  const groups = ['material','logistica','kanban','informacao','operador','fluxo','anotacao'];
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const visibleItems = LIBRARY.filter((item) => !['planning','timeline'].includes(item.kind))
    .filter((item) => normalizedQuery
      ? `${item.label} ${item.defaultLabel} ${GROUP_LABELS[item.group]}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery)
      : item.group === activeGroup);
  return (
    <div className={`library-panel ${open ? 'open' : 'collapsed'}`}>
      <button className="library-heading" onClick={() => setOpen((value) => !value)} aria-expanded={open}><div><strong>Biblioteca</strong><span>{open ? 'Arraste para o mapa' : 'Clique para expandir'}</span></div><span className="library-heading-action"><b>{visibleItems.length}</b><ChevronDown size={14}/></span></button>
      {open && <>
      <label className="library-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar símbolo" aria-label="Buscar símbolo" />{query && <button onClick={() => setQuery('')} aria-label="Limpar busca"><X size={12}/></button>}</label>
      {!normalizedQuery && <label className="library-category-select">
        <span>Categoria</span>
        <SiteSelect value={activeGroup} onChange={setActiveGroup} ariaLabel="Categoria da biblioteca" options={groups.map((group) => ({ value: group, label: `${GROUP_LABELS[group]} · ${LIBRARY.filter((item) => item.group === group && !['planning','timeline'].includes(item.kind)).length}` }))}/>
      </label>}
      {normalizedQuery && <div className="library-search-result"><span>Resultados para “{query.trim()}”</span></div>}
      <div className="library-items">
        {visibleItems.map((item) => (
          <div key={item.kind} className="library-item" draggable onDragStart={(event) => onDragStart(item, event)} title={`Arraste: ${item.label}`}>
            <div className="library-item-visual"><LibraryThumb kind={item.kind} accentColor={accentColor} /></div>
            <span>{item.label}</span>
          </div>
        ))}
        {!visibleItems.length && <div className="library-empty"><Search size={20}/><strong>Nenhum símbolo</strong><span>Tente buscar por outro nome.</span></div>}
      </div>
      </>}
    </div>
  );
}

// ─── Setas SVG ────────────────────────────────────────────────────────────────

function ArrowShape({ arrow, selected }: {
  arrow: CanvasArrow; selected: boolean;
}) {
  const dx = arrow.x2 - arrow.x1; const dy = arrow.y2 - arrow.y1;
  const len = Math.sqrt(dx*dx + dy*dy);
  const mx = (arrow.x1+arrow.x2)/2; const my = (arrow.y1+arrow.y2)/2;
  const ux = len>0?dx/len:1; const uy = len>0?dy/len:0;
  const ex = arrow.x2 - ux*10; const ey = arrow.y2 - uy*10;

  const isAdj = arrow.kind === 'arrow-adjustment';
  const isElec = arrow.kind === 'arrow-info-electronic';
  const isPull = arrow.kind === 'arrow-pull';
  const isPush = arrow.kind === 'arrow-push';
  const isSchedule = arrow.kind === 'arrow-schedule';
  const isShipment = arrow.kind === 'arrow-shipment';
  const isPhysical = arrow.kind === 'arrow-physical';
  const isLineStraight = arrow.kind === 'line-straight';
  const isLineDashed = arrow.kind === 'line-dashed';
  const isArrowStraight = arrow.kind === 'arrow-straight';
  const isArrowDouble = arrow.kind === 'arrow-double';
  const isManualStraight = arrow.kind === 'arrow-info-manual-straight';
  const isElectronicStraight = arrow.kind === 'arrow-info-electronic-straight';

  const color = '#111111';
  const dash = (isElec||isAdj||isShipment) ? (isAdj?'3 3':isShipment?'9 6':'5 3') : 'none';
  const sw = selected ? 3 : 2;
  const id = arrow.id;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const pushHeadLength = Math.min(10, Math.max(7, len * 0.16));
  const pushShaftEnd = Math.max(8, len - pushHeadLength);

  return (
    <g pointerEvents="none">
      <defs>
        <marker id={`m-${id}`} markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto-start-reverse">
          <polygon points="0,0 9,3.5 0,7" fill={color} />
        </marker>
        <pattern id={`zebra-${id}`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <rect width="10" height="10" fill="white" />
          <rect width="5" height="10" fill={color} />
        </pattern>
      </defs>
      {isPhysical ? (
        <path d={`M${arrow.x1},${arrow.y1-8} L${ex-16},${ey-8} L${ex},${ey} L${ex-16},${ey+8} L${arrow.x1},${arrow.y1+8} Z`}
          fill="white" stroke={color} strokeWidth={sw} />
      ) : isPush ? (
        <g transform={`translate(${arrow.x1},${arrow.y1}) rotate(${angle})`}>
          <path d={`M0,-3 H${pushShaftEnd} V-6 L${len},0 L${pushShaftEnd},6 V3 H0 Z`}
            fill={`url(#zebra-${id})`} stroke={color} strokeWidth={selected ? 2.2 : 1.4} strokeLinejoin="round" />
        </g>
      ) : isPull ? (
        <>
          <path d={`M${arrow.x1},${arrow.y1} Q${mx-dy*.25},${my+dx*.25} ${ex},${ey}`}
            fill="none" stroke={color} strokeWidth={sw} markerEnd={`url(#m-${id})`} />
          <circle cx={arrow.x1} cy={arrow.y1} r={4} fill={color} />
        </>
      ) : isSchedule ? (
        <path d={`M${arrow.x1},${arrow.y1} Q${mx},${Math.min(arrow.y1, arrow.y2)-90} ${ex},${ey}`}
          fill="none" stroke={color} strokeWidth={sw} markerEnd={`url(#m-${id})`} />
      ) : isLineStraight ? (
        <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}
          stroke={color} strokeWidth={sw} />
      ) : isLineDashed ? (
        <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}
          stroke={color} strokeWidth={sw} strokeDasharray="8 6" />
      ) : isArrowDouble ? (
        <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2}
          stroke={color} strokeWidth={sw} markerStart={`url(#m-${id})`} markerEnd={`url(#m-${id})`} />
      ) : isArrowStraight || isManualStraight || isElectronicStraight ? (
        <>
          <line x1={arrow.x1} y1={arrow.y1} x2={ex} y2={ey}
            stroke={color} strokeWidth={isManualStraight ? (selected ? 2.6 : 1.6) : sw}
            strokeDasharray={isElectronicStraight ? '5 3' : undefined} markerEnd={`url(#m-${id})`} />
          {isElectronicStraight && <polygon points={`${mx-4},${my-11} ${mx-7},${my-1} ${mx-2},${my-1} ${mx-6},${my+7} ${mx+4},${my-5} ${mx-1},${my-5}`}
            fill={color} opacity={0.85} />}
        </>
      ) : (
        <>
          <path d={`M${arrow.x1},${arrow.y1} Q${mx},${my-30} ${ex},${ey}`}
            fill="none" stroke={color} strokeWidth={sw} strokeDasharray={dash} markerEnd={`url(#m-${id})`} />
          {isElec && <polygon points={`${mx-4},${my-26} ${mx-7},${my-16} ${mx-2},${my-16} ${mx-6},${my-8} ${mx+4},${my-20} ${mx-1},${my-20}`}
            fill={color} opacity={0.85} />}
          {isAdj && <circle cx={arrow.x1} cy={arrow.y1} r={4} fill={color} />}
        </>
      )}
      {arrow.label && <text x={mx} y={my-12} textAnchor="middle" fontSize={8} fontFamily="Arial" fill="#444">{arrow.label}</text>}
    </g>
  );
}

function ArrowInteractionShape({ arrow, onMouseDown, onClick, onDoubleClick }: {
  arrow: CanvasArrow;
  onMouseDown: (event: React.MouseEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: (event: React.MouseEvent) => void;
}) {
  const dx = arrow.x2 - arrow.x1;
  const dy = arrow.y2 - arrow.y1;
  const mx = (arrow.x1 + arrow.x2) / 2;
  const my = (arrow.y1 + arrow.y2) / 2;
  const path = arrow.kind === 'arrow-pull'
    ? `M${arrow.x1},${arrow.y1} Q${mx-dy*.25},${my+dx*.25} ${arrow.x2},${arrow.y2}`
    : arrow.kind === 'arrow-schedule'
      ? `M${arrow.x1},${arrow.y1} Q${mx},${Math.min(arrow.y1, arrow.y2)-90} ${arrow.x2},${arrow.y2}`
      : ['arrow-push', 'arrow-physical', 'arrow-shipment', 'line-straight', 'line-dashed', 'arrow-straight', 'arrow-double', 'arrow-info-manual-straight', 'arrow-info-electronic-straight'].includes(arrow.kind)
        ? `M${arrow.x1},${arrow.y1} L${arrow.x2},${arrow.y2}`
        : `M${arrow.x1},${arrow.y1} Q${mx},${my-30} ${arrow.x2},${arrow.y2}`;
  return <path d={path} fill="none" stroke="transparent" strokeWidth={18} pointerEvents="stroke"
    style={{ cursor: 'move' }} onMouseDown={onMouseDown} onClick={onClick} onDoubleClick={onDoubleClick} />;
}

function pointAlongRoute(points: { x: number; y: number }[], progress: number) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    return { from: previous, to: point, length: Math.hypot(point.x - previous.x, point.y - previous.y) };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;
  let remaining = Math.min(1, Math.max(0, progress)) * total;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length > 0 ? remaining / segment.length : 0;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
      };
    }
    remaining -= segment.length;
  }
  return points[points.length - 1];
}

function bottleneckGuidance(metric: ReturnType<typeof calculateCanvasSimulation>['processMetrics'][number], assumptions: ScenarioAssumptions) {
  const cycle = Math.max(0, Number(metric.element.data.tc) || 0);
  const setup = Math.max(0, Number(metric.element.data.setup) || 0);
  const lot = Math.max(1, Number(metric.element.data.lote) || 1);
  const setupPerUnitSec = setup * 60 / lot;
  const availability = Math.min(100, Math.max(1, percentValue(metric.element.data.disp)));
  const quality = Math.min(100, Math.max(0.1, percentValue(metric.element.data.qualidade)));
  const resources = Math.max(1, Number(metric.element.data.recurso) || 1);
  const setupShare = cycle + setupPerUnitSec > 0 ? setupPerUnitSec / (cycle + setupPerUnitSec) : 0;
  const load = Math.max(100, metric.loadPercent);
  const reduction = Math.max(0, (1 - 100 / load) * 100);
  const extraResources = Math.max(1, Math.ceil(resources * load / 100) - resources);
  const dailyDemand = calculateScenario(assumptions).dailyDemand;
  const capacityGap = Math.max(0, dailyDemand - metric.capacityPerDay);

  if (setupShare >= 0.15) return {
    cause: [`Setup representa ${(setupShare * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do tempo efetivo.`, `Capacidade ${metric.capacityPerDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/dia · faltam ${capacityGap.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/dia.`],
    actions: [`Reduza o setup e libere lotes menores.`, `Meta: diminuir o tempo efetivo em ${reduction.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%.`],
  };
  if (availability < 90) {
    const targetAvailability = Math.min(100, availability * load / 100);
    return {
      cause: [`Disponibilidade de ${availability.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% limita a saída.`, `Carga calculada em ${metric.loadPercent.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do processo.`],
      actions: [`Eleve a disponibilidade para perto de ${targetAvailability.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%.`, `Atue em paradas, manutenção e abastecimento.`],
    };
  }
  if (quality < 98) return {
    cause: [`Qualidade de ${quality.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% aumenta a carga a montante.`, `Perdas acumuladas exigem produzir acima da demanda.`],
    actions: [`Reduza refugo e retrabalho neste processo.`, `Meta inicial: qualidade acima de 98%.`],
  };
  return {
    cause: [`T/C efetivo ${metric.effectiveCycleSec.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}s · carga ${metric.loadPercent.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%.`, `Capacidade ${metric.capacityPerDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/dia para demanda ${dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/dia.`],
    actions: [`Reduza o ciclo efetivo em ${reduction.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%.`, `Ou adicione ${extraResources} recurso(s) e rebalanceie o trabalho.`],
  };
}

function LiveFlowOverlay({ canvas, simulation, elapsedSec, orderQuantity = 0 }: {
  canvas: CanvasState;
  simulation: ReturnType<typeof calculateCanvasSimulation>;
  elapsedSec: number;
  orderQuantity?: number;
}) {
  if (elapsedSec <= 0 || simulation.processElements.length === 0 || !Number.isFinite(simulation.taktTimeSec) || !simulation.routeReady) return null;
  const stageElements = simulation.productionRouteElements;
  const centers = stageElements.map((element) => {
    const size = elementDimensions(element);
    return { x: element.x + size.width / 2, y: element.y + size.height / 2 };
  });
  const truckCenters = stageElements.filter((element) => element.kind === 'truck').map((element) => {
    const size = elementDimensions(element);
    return { id: element.id, x: element.x + size.width * 0.42, y: element.y + size.height * 0.43, element, size };
  });
  const route = centers;
  const liveFlow = calculateLiveFlow(simulation, canvas.assumptions, elapsedSec, { orderQuantity });
  const stationBoxes = simulation.processMetrics.map((metric) => {
    const size = elementDimensions(metric.element);
    const bottom = metric.element.y + size.height;
    // Bandejas de entrada e saída logo abaixo da máquina; `trayFloor` é o fundo delas.
    return { left: metric.element.x, top: metric.element.y, right: metric.element.x + size.width, bottom, cx: metric.element.x + size.width / 2, cy: metric.element.y + size.height / 2, trayFloor: bottom + 52 };
  });
  // Trechos percorridos entre a entrada, cada processo e o cliente; o primeiro e o último seguem o traçado do mapa.
  const routeIndexOf = (id?: string) => stageElements.findIndex((element) => element.id === id);
  const firstRouteIndex = routeIndexOf(simulation.processMetrics[0]?.element.id);
  const lastRouteIndex = routeIndexOf(simulation.processMetrics[simulation.processMetrics.length - 1]?.element.id);
  const shippingRouteIndex = routeIndexOf(simulation.shippingPoint?.id);
  const shippingSize = simulation.shippingPoint ? elementDimensions(simulation.shippingPoint) : null;
  const shippingCenter = simulation.shippingPoint && shippingSize
    ? { x: simulation.shippingPoint.x + shippingSize.width / 2, y: simulation.shippingPoint.y + shippingSize.height / 2 }
    : route[route.length - 1];
  const legPoints = (station: number) => {
    if (station === 0) return firstRouteIndex > 0 ? route.slice(0, firstRouteIndex + 1) : [route[0], { x: stationBoxes[0].cx, y: stationBoxes[0].cy }];
    if (station >= stationBoxes.length) {
      const last = stationBoxes[stationBoxes.length - 1];
      if (lastRouteIndex >= 0 && shippingRouteIndex > lastRouteIndex) return route.slice(lastRouteIndex, shippingRouteIndex + 1);
      return [{ x: last.cx, y: last.cy }, shippingCenter];
    }
    const from = stationBoxes[station - 1];
    const to = stationBoxes[station];
    return [{ x: from.cx, y: from.cy }, { x: to.cx, y: to.cy }];
  };
  const STACK_COLUMNS = 4;
  const STACK_VISIBLE = 12;
  // Peças de um mesmo lote viajam juntas: contam quantas dividem o mesmo ponto do trajeto para desenhá-las como uma pilha.
  const transitKey = (stage: LiveUnit['stage']) => stage.kind === 'transit' ? `${stage.station}:${Math.round(stage.progress * 1000)}` : '';
  const transitGroups: Record<string, number> = {};
  liveFlow.units.slice(0, 160).forEach((unit) => {
    const key = transitKey(unit.stage);
    if (key) transitGroups[key] = (transitGroups[key] ?? 0) + 1;
  });
  const transitSeen: Record<string, number> = {};
  const tokens = liveFlow.units.slice(0, 160).flatMap((unit) => {
    const { stage } = unit;
    const box = stationBoxes[stage.station];
    let point: { x: number; y: number };
    let scale = 1;
    if (stage.kind === 'transit') {
      point = pointAlongRoute(legPoints(stage.station), Math.min(1, Math.max(0, stage.progress)));
      const key = transitKey(stage);
      const groupSize = transitGroups[key] ?? 1;
      if (groupSize > 1) {
        const slot = transitSeen[key] ?? 0;
        transitSeen[key] = slot + 1;
        if (slot >= STACK_VISIBLE) return [];
        const column = slot % 3;
        const row = Math.floor(slot / 3);
        point = { x: point.x - 11 + column * 11, y: point.y + 6 - row * 9 };
        scale = 0.55;
      }
    }
    else if (stage.position >= STACK_VISIBLE) return [];
    else if (stage.kind === 'processing') {
      const count = Math.min(STACK_VISIBLE, liveFlow.stations[stage.station].processing);
      point = { x: box.cx + (stage.position - (count - 1) / 2) * 22, y: box.cy };
      scale = 0.8;
    } else if (stage.kind === 'shipping') {
      // Produtos prontos empilhados na expedição até fechar o lote.
      const column = stage.position % 6;
      const row = Math.floor(stage.position / 6);
      const floor = simulation.shippingPoint && shippingSize ? simulation.shippingPoint.y + shippingSize.height + 22 : route[route.length - 1].y + 80;
      const left = simulation.shippingPoint ? simulation.shippingPoint.x + 4 : route[route.length - 1].x - 70;
      point = { x: left + 10 + column * 15, y: floor - 7 - row * 13 };
      scale = 0.55;
    } else {
      const column = stage.position % STACK_COLUMNS;
      const row = Math.floor(stage.position / STACK_COLUMNS);
      const y = box.trayFloor - 7 - row * 13;
      point = stage.kind === 'queue'
        ? { x: box.left + 12 + column * 15, y }
        : { x: box.right - 12 - column * 15, y };
      scale = 0.55;
    }
    const truck = stage.kind === 'transit' ? truckCenters.find((center) => Math.hypot(point.x - center.x, point.y - center.y) < 58) : undefined;
    return [{ index: unit.index, packIndex: unit.packIndex, product: unit.product, point, scale, moving: stage.kind === 'transit', processing: stage.kind === 'processing', truckId: truck?.id }];
  });
  const loadingTruckIds = new Set(tokens.map((token) => token.truckId).filter(Boolean));
  const bottleneckMetric = simulation.processMetrics.find((metric) => metric.element.id === simulation.bottleneck?.id);
  const guidance = bottleneckMetric?.overloaded ? bottleneckGuidance(bottleneckMetric, canvas.assumptions) : null;

  return (
    <g data-export-ui className="live-flow-overlay" pointerEvents="none">
      <polyline points={route.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={canvas.themeColor} strokeWidth={2} strokeDasharray="4 8" opacity={0.3} />
      {simulation.pullBuffers.map((control) => {
        const size = elementDimensions(control);
        return <g key={`pull-${control.id}`} transform={`translate(${control.x + size.width / 2},${control.y - 17})`}>
          <rect x={-48} y={-10} width={96} height={20} rx={10} fill="#7a5b00" />
          <text x={0} y={4} textAnchor="middle" fontSize={7.5} fontWeight="850" fontFamily="Arial" fill="white">PULL · LIMITE {Math.max(0, Number(control.data.qty) || 0)}</text>
        </g>;
      })}
      {simulation.processMetrics.filter((metric) => metric.batch.mode === 'lote').map((metric) => {
        const size = elementDimensions(metric.element);
        return <g key={`batch-${metric.element.id}`} transform={`translate(${metric.element.x + size.width / 2},${metric.element.y + size.height + 76})`}>
          <rect x={-60} y={-10} width={120} height={20} rx={10} fill="#5b3fa0" />
          <text x={0} y={4} textAnchor="middle" fontSize={7.5} fontWeight="850" fontFamily="Arial" fill="white">LOTE DE {metric.batch.batchSize} PEÇAS</text>
        </g>;
      })}
      {truckCenters.map((truck) => loadingTruckIds.has(truck.id) && <g key={`loading-${truck.id}`}>
        <rect x={truck.element.x - 5} y={truck.element.y - 5} width={truck.size.width + 10} height={truck.size.height + 10} rx={12} className="live-truck-loading" />
        <g transform={`translate(${truck.element.x + truck.size.width / 2 - 45},${truck.element.y - 30})`}>
          <rect width={90} height={22} rx={11} fill="#1a6b3a" />
          <text x={45} y={15} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="white">CARREGANDO</text>
        </g>
      </g>)}
      {stationBoxes.map((box, station) => {
        const state = liveFlow.stations[station];
        const pill = (x: number, value: number) => <g transform={`translate(${x},${box.trayFloor - 22})`}>
          <rect x={-11} y={-8} width={22} height={16} rx={8} fill={value > 0 ? '#b42318' : '#9aa0ae'} />
          <text x={0} y={4} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="white">{value}</text>
        </g>;
        return <g key={`tray-counts-${state?.id ?? station}`}>
          {pill(box.cx - 16, state?.waiting ?? 0)}
          {pill(box.cx + 16, state?.holding ?? 0)}
        </g>;
      })}
      {(() => {
        const shippingPoint = simulation.shippingPoint;
        const shipping = liveFlow.shipping;
        const size = shippingPoint ? elementDimensions(shippingPoint) : null;
        const left = shippingPoint && size ? shippingPoint.x + 4 : route[route.length - 1].x - 70;
        const right = shippingPoint && size ? shippingPoint.x + size.width - 4 : route[route.length - 1].x + 70;
        const floor = shippingPoint && size ? shippingPoint.y + size.height + 22 : route[route.length - 1].y + 80;
        return <g className="live-shipping-tray">
          <path d={`M${left},${floor - 14} V${floor} H${right} V${floor - 14}`} fill="none" stroke="#5f6670" strokeWidth={1.6} />
          <text x={(left + right) / 2} y={floor + 10} textAnchor="middle" fontSize={6.5} fontWeight="800" fontFamily="Arial" fill="#4b5159">
            PRONTOS · {shipping.waiting}{shipping.lot > 1 ? ` DE ${shipping.lot}` : ''}
          </text>
        </g>;
      })()}
      {simulation.processMetrics.map((metric, station) => {
        const size = elementDimensions(metric.element);
        const queue = liveFlow.stations[station]?.waiting ?? 0;
        const critical = metric.overloaded || queue > 0;
        return <g key={`live-${metric.element.id}`}>
          <rect x={metric.element.x - 7} y={metric.element.y - 27} width={size.width + 14} height={size.height + 34} rx={9}
            className={`live-process-halo ${critical ? 'critical' : metric.element.id === simulation.bottleneck?.id ? 'bottleneck' : 'healthy'}`} />
          {queue > 0 && <g transform={`translate(${metric.element.x + size.width - 40},${metric.element.y - 38})`}>
            <rect width={80} height={22} rx={11} fill="#b42318" />
            <text x={40} y={15} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="white">FILA {queue}</text>
          </g>}
        </g>;
      })}
      {guidance && bottleneckMetric && (() => {
        const size = elementDimensions(bottleneckMetric.element);
        const placeAbove = bottleneckMetric.element.y > 170;
        const cardX = bottleneckMetric.element.x + size.width / 2 - 135;
        const cardY = placeAbove ? bottleneckMetric.element.y - 168 : bottleneckMetric.element.y + size.height + 32;
        const anchorX = bottleneckMetric.element.x + size.width / 2;
        const anchorY = placeAbove ? bottleneckMetric.element.y : bottleneckMetric.element.y + size.height;
        const cardAnchorY = placeAbove ? cardY + 132 : cardY;
        return <g className="live-bottleneck-help">
          <path d={`M${anchorX},${anchorY} L${cardX + 135},${cardAnchorY}`} fill="none" stroke="#b42318" strokeWidth={2} strokeDasharray="5 3" />
          <g transform={`translate(${cardX},${cardY})`}>
            <rect width={270} height={132} rx={12} fill="white" stroke="#e6aaa5" strokeWidth={1.5} />
            <rect width={270} height={30} rx={12} fill="#fff0ee" />
            <circle cx={17} cy={15} r={7} fill="#b42318"/><text x={17} y={19} textAnchor="middle" fontSize={9} fontWeight="900" fontFamily="Arial" fill="white">!</text>
            <text x={31} y={19} fontSize={9} fontWeight="900" fontFamily="Arial" fill="#8f1f17">POR QUE ESTÁ GARGALANDO?</text>
            {guidance.cause.map((line,index)=><text key={`cause-${index}`} x={14} y={48+index*14} fontSize={7.5} fontFamily="Arial" fill="#4b5159">{line.slice(0,58)}</text>)}
            <text x={14} y={82} fontSize={7.5} fontWeight="900" fontFamily="Arial" fill="#167044">COMO ALIVIAR</text>
            {guidance.actions.map((line,index)=><text key={`action-${index}`} x={14} y={98+index*15} fontSize={7.5} fontWeight="700" fontFamily="Arial" fill="#2f3b45">• {line.slice(0,57)}</text>)}
          </g>
        </g>;
      })()}
      {tokens.map((token) => <g key={token.index} transform={`translate(${token.point.x},${token.point.y}) scale(${token.scale})`} className={`live-product-token ${token.truckId ? 'inside-truck' : ''}`}>
        {token.processing && <circle r={19} fill="#fff6c2" stroke="#d79a18" strokeWidth={1.5} />}
        <path d="M-13,-7 L0,-13 L13,-7 L0,-1 Z" fill={token.product?.color ?? canvas.themeColor} stroke="#23415a" strokeWidth={1.2}/>
        <path d="M-13,-7 V8 L0,14 V-1 Z" fill="white" stroke="#23415a" strokeWidth={1.2}/>
        <path d="M13,-7 V8 L0,14 V-1 Z" fill={token.product?.color ?? '#dcecff'} fillOpacity={0.22} stroke="#23415a" strokeWidth={1.2}/>
        <path d="M0,-13 V-1" stroke="#23415a" strokeWidth={1}/>
        {token.moving && <text x={0} y={-18} textAnchor="middle" fontSize={7} fontWeight="800" fontFamily="Arial" fill="#34383e">{token.product?.code ?? 'P1'} · CX {token.packIndex + 1}</text>}
      </g>)}
    </g>
  );
}

// ─── Popovers de edição ───────────────────────────────────────────────────────

function ElementSizeFields({ el, onUpdate }: {
  el: CanvasElement;
  onUpdate: (patch: Partial<CanvasElement>) => void;
}) {
  const defaults = defaultElementDimensions(el);
  const size = elementDimensions(el);
  const setSize = (key: 'width' | 'height', value: string) => {
    const limit = key === 'width' ? 1200 : 800;
    const fallback = key === 'width' ? defaults.width : defaults.height;
    const next = Math.min(limit, Math.max(30, Number(value) || fallback));
    onUpdate({ data: { ...el.data, [key]: next } });
  };
  const restore = () => {
    const data = { ...el.data };
    delete data.width;
    delete data.height;
    onUpdate({ data });
  };

  return (
    <div className="element-size-editor">
      <div className="element-size-heading">
        <span>Tamanho</span>
        <button type="button" onClick={restore}>Restaurar padrão</button>
      </div>
      <div className="element-size-grid">
        <label><span>Largura</span><div className="popover-input-wrap"><input type="number" min={30} max={1200} step={10} value={size.width} onChange={(event) => setSize('width', event.target.value)} /><span>px</span></div></label>
        <label><span>Altura</span><div className="popover-input-wrap"><input type="number" min={30} max={800} step={10} value={size.height} onChange={(event) => setSize('height', event.target.value)} /><span>px</span></div></label>
      </div>
    </div>
  );
}

function ElementPopover({ el, processes, assumptions, onUpdate, onDelete, onClose }: {
  el: CanvasElement; onUpdate: (p: Partial<CanvasElement>) => void;
  processes: CanvasElement[]; assumptions: ScenarioAssumptions; onDelete: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fields = FIELD_DEFS[el.kind] ?? [{ key: 'label', label: 'Rótulo', type: 'text' }];
  const isKanbanControl = KANBAN_CONTROL_KINDS.includes(el.kind);
  const scenario = calculateScenario(assumptions);
  const leveling = buildLeveledSequence(scenario.productMetrics);
  const kanbanSizing = isKanbanControl ? calculateKanbanSizing(el, assumptions) : null;
  const isProcessKind = el.kind === 'process' || el.kind === 'shared-process';
  const batch = batchSettings(el);
  const batchLead = batchLeadTime(batch, scenario.taktTimeSec);
  const formatMinutes = (seconds: number) => `${(seconds / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
  const updateKanbanData = (key: string, value: string | number) => onUpdate({ data: { ...el.data, [key]: value } });

  useEffect(() => {
    const pop = ref.current; if (!pop) return;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth/2 - 150, window.innerWidth - 316))}px`;
    pop.style.top  = `${Math.max(12, (window.innerHeight - pop.offsetHeight) / 2)}px`;
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key==='Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return createPortal(
    <div className="process-popover" ref={ref} style={{ width: 300 }}>
      <div className="popover-header">
        <strong>Editar elemento</strong>
        <button className="popover-close" onClick={onClose}><X size={15} /></button>
      </div>
      <div style={{ padding: '0 0 4px' }}>
        {el.kind === 'pacemaker' && <div className="popover-field" style={{ marginTop: 8 }}>
          <label>Processo programado</label>
          <SiteSelect className="popover-select" value={String(el.data.processId ?? '')} ariaLabel="Processo programado"
            options={[{ value: '', label: 'Selecione o processo' }, ...processes.map((process) => ({ value: process.id, label: process.label || 'Processo sem nome' }))]}
            onChange={(value) => {
              const process = processes.find((candidate) => candidate.id === value);
              onUpdate({ label: process?.label ?? 'Processo', data: { ...el.data, processId: value } });
            }}/>
          <small className="popover-field-help">Somente este processo recebe a programação do fluxo.</small>
        </div>}
        {kanbanSizing && <div className="kanban-sizing-editor">
          <div className="popover-field">
            <label>Produto atendido</label>
            <SiteSelect className="popover-select" value={kanbanSizing.productId} ariaLabel="Produto atendido"
              options={[{ value: '', label: 'Mix total' }, ...scenario.productMetrics.filter((item) => item.monthlyDemand > 0).map((item) => ({ value: item.id, label: item.name }))]}
              onChange={(value) => {
                const data: Record<string, string | number> = { ...el.data, productId: value };
                delete data.packSize;
                onUpdate({ data });
              }}/>
          </div>
          <div className="kanban-sizing-grid">
            <label><span>Reposição completa</span><div className="popover-input-wrap"><input type="number" min={0} step="any" value={kanbanSizing.replenishmentMin} onChange={(event) => updateKanbanData('replenishmentMin', Math.max(0, Number(event.target.value) || 0))}/><span>min</span></div></label>
            <label><span>Segurança</span><div className="popover-input-wrap"><input type="number" min={0} step="any" value={kanbanSizing.safetyPercent} onChange={(event) => updateKanbanData('safetyPercent', Math.max(0, Number(event.target.value) || 0))}/><span>%</span></div></label>
            <label><span>Unidades por cartão</span><div className="popover-input-wrap"><input type="number" min={1} step={1} value={kanbanSizing.packSize} onChange={(event) => updateKanbanData('packSize', Math.max(1, Math.round(Number(event.target.value) || 1)))}/><span>un</span></div></label>
            <label><span>Cartões no circuito</span><div className="popover-input-wrap"><input type="number" min={0} step={1} value={kanbanSizing.cards} onChange={(event) => updateKanbanData('qty', Math.max(0, Math.floor(Number(event.target.value) || 0)))}/><span>cart.</span></div></label>
          </div>
          <div className="kanban-sizing-result">
            <div><span>Demanda no tempo de reposição</span><strong>{kanbanSizing.demandDuringReplenishment.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} un</strong></div>
            <div><span>Recomendação</span><strong>{kanbanSizing.recommendedCards || '—'} cartão(ões) · {kanbanSizing.recommendedUnits} un</strong></div>
            <button type="button" disabled={!kanbanSizing.recommendedCards} onClick={() => updateKanbanData('qty', kanbanSizing.recommendedCards)}>Aplicar quantidade recomendada</button>
          </div>
          <small className="kanban-sizing-formula">Cálculo: consumo durante a reposição × segurança ÷ unidades por cartão.</small>
        </div>}
        {['heijunka','sequencing-box'].includes(el.kind) && <div className="leveling-editor-preview">
          <div><strong>Sequência nivelada calculada</strong><span>{leveling.totalPacksPerDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} embalagem(ns)/dia</span></div>
          <div className="leveling-sequence-chips">{leveling.slots.slice(0, 16).map((slot, index) => <span key={`${slot.productId}-${index}`} style={{ background: slot.color }} title={`${slot.name} · ${slot.packSize} un · pitch ${(slot.pitchTimeSec / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`}>{slot.code}</span>)}</div>
          <small>A ordem distribui as embalagens proporcionalmente ao mix. Passe o mouse nos slots para ver produto, embalagem e pitch.</small>
        </div>}
        {fields.map((f) => (
          <div key={f.key} className="popover-field" style={{ marginTop: 8 }}>
            <label>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea value={el.label} rows={6} onChange={(e) => onUpdate({ label: e.target.value })} />
            ) : f.type === 'text' ? (
              <input value={el.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            ) : f.type === 'color' ? (
              <div className="popover-color-wrap">
                <input className="popover-color-input" type="color" value={String(el.data[f.key] ?? DEFAULT_TRUCK_COLOR)}
                  onChange={(e) => onUpdate({ data: { ...el.data, [f.key]: e.target.value } })} />
                <span>{String(el.data[f.key] ?? DEFAULT_TRUCK_COLOR).toUpperCase()}</span>
              </div>
            ) : (
              <div className="popover-input-wrap">
                <input type="number" min={0} value={el.data[f.key] ?? (f.key === 'pecasCiclo' ? 1 : 0)}
                  onChange={(e) => onUpdate({ data: { ...el.data, [f.key]: Number(e.target.value) } })} />
                {f.suffix && <span>{f.suffix}</span>}
              </div>
            )}
          </div>
        ))}
        {isProcessKind && <div className="batch-editor">
          <small className="popover-field-help">{batch.mode === 'lote'
            ? `Produção em lotes: cada peça entra em produção assim que chega, fica no buffer de saída e o lote de ${batch.batchSize} peças só segue ao próximo processo quando a última fica pronta. Lote 1 volta ao fluxo contínuo.`
            : 'Fluxo contínuo: cada peça segue para o próximo processo assim que fica pronta. Para produzir em lotes, informe um lote de produção maior que 1.'}</small>
          {batch.mode === 'lote' && <div className="kanban-sizing-result">
            <div><span>Espera na saída até fechar o lote</span><strong>{formatMinutes(batchLead.formationSec)}</strong></div>
            <div><span>Setup do lote</span><strong>{formatMinutes(batchLead.processingSec)}</strong></div>
            <div><span>Atraso por peça neste processo</span><strong>{formatMinutes(batchLead.totalSec)}</strong></div>
          </div>}
        </div>}
        <ElementSizeFields el={el} onUpdate={onUpdate} />
      </div>
      <div className="popover-footer">
        <button className="popover-delete" onClick={onDelete}><Trash2 size={13} />Excluir</button>
      </div>
    </div>,
    document.body
  );
}

async function prepareIdentificationImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  if (file.size > 10 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
      image.src = url;
    });
    const scale = Math.min(1, 800 / image.naturalWidth, 500 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível processar esta imagem.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(outputType, outputType === 'image/jpeg' ? 0.86 : undefined);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function IdentificationEditor({ el, onUpdate, onClose }: {
  el: CanvasElement;
  onUpdate: (patch: Partial<CanvasElement>) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string|null>(null);
  const updateData = (key: string, value: string) => onUpdate({ data: { ...el.data, [key]: value } });
  const upload = async (key: 'companyImage' | 'productImage', file?: File) => {
    if (!file) return;
    setError(null);
    try {
      updateData(key, await prepareIdentificationImage(file));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Não foi possível carregar a imagem.');
    }
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const imageField = (key: 'companyImage' | 'productImage', title: string, description: string) => {
    const image = String(el.data[key] ?? '');
    return (
      <div className="identification-image-field">
        <div className="identification-image-preview">
          {image ? <img src={image} alt="" /> : <FileImage size={28} />}
        </div>
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
          <div className="identification-image-actions">
            <label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(key, event.target.files?.[0])} />Escolher imagem</label>
            {image && <button onClick={() => updateData(key, '')}>Remover</button>}
          </div>
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="identification-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar identificação" />
      <section className="editor-window identification-editor">
        <header>
          <div><h2 id="identification-title">Identificação do MFV</h2><p>Defina a família analisada e, se quiser, adicione imagens.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <div className="identification-editor-body">
          <div className="identification-fields">
            <label><span>Família de produtos</span><input value={String(el.data.family ?? '')} onChange={(event) => updateData('family', event.target.value)} placeholder="Ex.: Camas infantis" /></label>
            <label><span>Empresa</span><input value={String(el.data.companyName ?? '')} onChange={(event) => updateData('companyName', event.target.value)} placeholder="Nome opcional" /></label>
            <label><span>Produto</span><input value={String(el.data.productName ?? '')} onChange={(event) => updateData('productName', event.target.value)} placeholder="Nome opcional" /></label>
            <ElementSizeFields el={el} onUpdate={onUpdate} />
          </div>
          <div className="identification-images">
            {imageField('companyImage', 'Empresa', 'Logotipo ou foto da empresa')}
            {imageField('productImage', 'Produto', 'Foto do produto analisado')}
          </div>
          {error && <p className="identification-error">{error}</p>}
        </div>
        <footer className="identification-editor-footer"><button className="primary-button" onClick={onClose}>Concluir</button></footer>
      </section>
    </div>,
    document.body,
  );
}

function DemandModal({ assumptions, planning, canvas, onSave, onUpdatePlanning, onClose }: {
  assumptions: ScenarioAssumptions;
  planning: CanvasElement;
  canvas: CanvasState;
  onSave: (next: ScenarioAssumptions) => void;
  onUpdatePlanning: (patch: Partial<CanvasElement>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(assumptions);
  const metrics = calculateScenario(draft);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const setNumber = (key: 'workdaysPerMonth' | 'availableMinutesPerDay', value: string) => {
    setDraft((previous) => ({ ...previous, [key]: Math.max(0, Number(value) || 0) }));
  };
  const updateProduct = (id: string, patch: Partial<ProductMixItem>) => {
    setDraft((previous) => {
      const productMix = previous.productMix.map((item) => item.id === id ? { ...item, ...patch } : item);
      return { ...previous, productMix, monthlyDemand: productMix.reduce((sum, item) => sum + item.monthlyDemand, 0) };
    });
  };
  const addProduct = () => setDraft((previous) => ({
    ...previous,
    productMix: [...previous.productMix, {
      id: `product-${makeId()}`,
      name: `Produto ${previous.productMix.length + 1}`,
      monthlyDemand: 0,
      packSize: 1,
    }],
  }));
  const removeProduct = (id: string) => setDraft((previous) => {
    if (previous.productMix.length <= 1) return previous;
    const productMix = previous.productMix.filter((item) => item.id !== id);
    return { ...previous, productMix, monthlyDemand: productMix.reduce((sum, item) => sum + item.monthlyDemand, 0) };
  });
  const draftSimulation = calculateCanvasSimulation({ ...canvas, assumptions: draft });
  const formatDuration = (seconds: number) => seconds >= 60
    ? `${(seconds / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`
    : `${seconds.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;

  return createPortal(
    <div className="editor-overlay demand-overlay" role="dialog" aria-modal="true" aria-labelledby="demand-modal-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar dados de demanda" />
      <section className="editor-window demand-modal">
        <header>
          <div className="modal-title-row">
            <div className="modal-symbol"><Calculator size={20} /></div>
            <div>
              <span className="scenario-pill current">Simulação</span>
              <h2 id="demand-modal-title">Demanda, mix e ritmo</h2>
              <p>Defina os produtos, embalagens e o tempo disponível para calcular takt, pitch e EPEI.</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>

        <div className="demand-modal-body">
          <div className="demand-fields">
            <label>
              <span>Dias úteis no mês</span>
              <div className="popover-input-wrap">
                <input type="number" min={1} step="1" value={draft.workdaysPerMonth}
                  onChange={(event) => setNumber('workdaysPerMonth', event.target.value)} />
                <span>dias</span>
              </div>
            </label>
            <label>
              <span>Tempo disponível por dia</span>
              <div className="popover-input-wrap">
                <input type="number" min={1} step="any" value={draft.availableMinutesPerDay}
                  onChange={(event) => setNumber('availableMinutesPerDay', event.target.value)} />
                <span>min/dia</span>
              </div>
            </label>
            <ElementSizeFields el={planning} onUpdate={onUpdatePlanning} />
          </div>

          <div className="takt-result-card">
            <span>TAKT calculado</span>
            <strong>{metrics.taktTimeSec > 0 ? `${metrics.taktTimeSec.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '—'}</strong>
            <small>{metrics.taktTimeSec > 0 ? `${(metrics.taktTimeSec / 60).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} min por unidade` : 'Preencha valores maiores que zero'}</small>
            <div>
              <span>Demanda diária</span>
              <b>{Number.isFinite(metrics.dailyDemand) ? metrics.dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'} un/dia</b>
            </div>
            <div><span>Pitch médio</span><b>{metrics.pitchTimeSec > 0 ? formatDuration(metrics.pitchTimeSec) : '—'}</b></div>
            <div><span>EPEI estimado</span><b>{draftSimulation.epeiDays === Infinity ? 'Sem capacidade' : draftSimulation.epeiDays > 0 ? `${draftSimulation.epeiDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dia(s)` : 'Não aplicável'}</b></div>
          </div>
        </div>

        <div className="product-mix-section">
          <div className="product-mix-heading">
            <div><strong>Mix de produtos</strong><span>A demanda total é a soma das famílias abaixo.</span></div>
            <button type="button" onClick={addProduct}><Plus size={14}/>Adicionar produto</button>
          </div>
          <div className="product-mix-table">
            <div className="product-mix-header"><span>Produto</span><span>Demanda/mês</span><span>Emb./caixa</span><span>Mix</span><span>Pitch</span><span /></div>
            {metrics.productMetrics.map((item) => <div className="product-mix-row" key={item.id}>
              <input value={item.name} onChange={(event) => updateProduct(item.id, { name: event.target.value })} aria-label="Nome do produto" />
              <input type="number" min={0} step="any" value={item.monthlyDemand} onChange={(event) => updateProduct(item.id, { monthlyDemand: Math.max(0, Number(event.target.value) || 0) })} aria-label={`Demanda mensal de ${item.name}`} />
              <input type="number" min={1} step={1} value={item.packSize} onChange={(event) => updateProduct(item.id, { packSize: Math.max(1, Math.round(Number(event.target.value) || 1)) })} aria-label={`Quantidade por embalagem de ${item.name}`} />
              <span>{(item.share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
              <span>{item.pitchTimeSec > 0 ? formatDuration(item.pitchTimeSec) : '—'}</span>
              <button type="button" className="product-remove" disabled={draft.productMix.length <= 1} onClick={() => removeProduct(item.id)} aria-label={`Remover ${item.name}`}><Trash2 size={14}/></button>
            </div>)}
          </div>
          <div className="product-mix-total"><span>Demanda mensal total</span><strong>{metrics.monthlyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un</strong><span>Embalagem média</span><strong>{metrics.weightedPackSize.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} un</strong></div>
        </div>

        <footer className="demand-modal-footer">
          <p>O pitch passa a comandar a liberação em embalagens; o EPEI considera o setup do marcapasso.</p>
          <button className="primary-button" disabled={!metrics.monthlyDemand || !draft.workdaysPerMonth || !draft.availableMinutesPerDay}
            onClick={() => onSave({ ...draft, monthlyDemand: metrics.monthlyDemand, productMix: metrics.productMetrics.map(({ id, name, monthlyDemand, packSize }) => ({ id, name, monthlyDemand, packSize })) })}>
            <Calculator size={16} />Calcular e aplicar
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ArrowPopover({ arrow, onUpdate, onDelete, onClose }: {
  arrow: CanvasArrow; onUpdate: (p: Partial<CanvasArrow>) => void;
  onDelete: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pop = ref.current; if (!pop) return;
    pop.style.left = `${Math.max(12, window.innerWidth/2 - 140)}px`;
    pop.style.top  = `${Math.max(12, window.innerHeight/2 - 80)}px`;
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key==='Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const kinds: { value: CanvasArrow['kind']; label: string }[] = [
    { value: 'arrow-push',            label: 'Fluxo empurrado' },
    { value: 'arrow-pull',            label: 'Fluxo puxado' },
    { value: 'arrow-info-manual',     label: 'Info manual' },
    { value: 'arrow-info-electronic', label: 'Info eletrônica' },
    { value: 'arrow-adjustment',      label: 'Seta de ajuste / correção' },
    { value: 'arrow-schedule',        label: 'Programação curva' },
    { value: 'arrow-shipment',        label: 'Transporte externo' },
    { value: 'arrow-physical',        label: 'Fluxo físico (chevron)' },
    { value: 'line-straight',         label: 'Linha reta (sem ponta)' },
    { value: 'line-dashed',           label: 'Linha tracejada (sem ponta)' },
    { value: 'arrow-straight',        label: 'Seta reta' },
    { value: 'arrow-double',          label: 'Seta dupla' },
    { value: 'arrow-info-manual-straight', label: 'Informação manual reta' },
    { value: 'arrow-info-electronic-straight', label: 'Informação eletrônica reta' },
  ];
  return createPortal(
    <div className="process-popover" ref={ref} style={{ width: 280 }}>
      <div className="popover-header">
        <strong>Editar seta</strong>
        <button className="popover-close" onClick={onClose}><X size={15} /></button>
      </div>
      <div style={{ padding: '0 0 4px' }}>
        <div className="popover-field" style={{ marginTop: 8 }}>
          <label>Tipo</label>
          <SiteSelect value={arrow.kind} onChange={(value) => onUpdate({ kind: value as CanvasArrow['kind'] })}
            ariaLabel="Tipo da seta" className="popover-select" options={kinds}/>
        </div>
        <div className="popover-field" style={{ marginTop: 8 }}>
          <label>Rótulo</label>
          <input value={arrow.label ?? ''} onChange={(e) => onUpdate({ label: e.target.value })} />
        </div>
      </div>
      <div className="popover-footer">
        <button className="popover-delete" onClick={onDelete}><Trash2 size={13} />Excluir seta</button>
      </div>
    </div>,
    document.body
  );
}

// ─── App principal ────────────────────────────────────────────────────────────

type Dragging =
  | { type: 'element'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { type: 'element-resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; origX: number; origY: number; origWidth: number; origHeight: number }
  | { type: 'arrow'; id: string; startX: number; startY: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'arrow-point'; id: string; point: 'start' | 'end' }
  | { type: 'pan'; startX: number; startY: number; origX: number; origY: number };

type CanvasClipboard =
  | { type: 'element'; element: CanvasElement }
  | { type: 'arrow'; arrow: CanvasArrow };

type AlignmentGuides = { x?: number; y?: number };

const ARROW_CONNECT_DISTANCE = 18;

function findArrowAnchor(x: number, y: number, elements: CanvasElement[]) {
  let best: { x: number; y: number; anchor: ArrowAnchor; distance: number } | null = null;
  for (const element of elements) {
    const size = elementDimensions(element);
    const left = element.x;
    const top = element.y;
    const right = left + size.width;
    const bottom = top + size.height;
    if (x < left - ARROW_CONNECT_DISTANCE || x > right + ARROW_CONNECT_DISTANCE
      || y < top - ARROW_CONNECT_DISTANCE || y > bottom + ARROW_CONNECT_DISTANCE) continue;

    const localX = Math.max(0, Math.min(size.width, x - left));
    const localY = Math.max(0, Math.min(size.height, y - top));
    const sides = [
      { x: 0, y: localY, distance: Math.abs(x - left) },
      { x: size.width, y: localY, distance: Math.abs(x - right) },
      { x: localX, y: 0, distance: Math.abs(y - top) },
      { x: localX, y: size.height, distance: Math.abs(y - bottom) },
    ];
    const nearest = sides.reduce((choice, side) => side.distance < choice.distance ? side : choice);
    const snappedX = left + nearest.x;
    const snappedY = top + nearest.y;
    const distance = Math.hypot(x - snappedX, y - snappedY);
    if (distance <= ARROW_CONNECT_DISTANCE || (x >= left && x <= right && y >= top && y <= bottom)) {
      if (!best || distance < best.distance) {
        best = {
          x: snappedX,
          y: snappedY,
          distance,
          anchor: { elementId: element.id, x: nearest.x / size.width, y: nearest.y / size.height },
        };
      }
    }
  }
  return best;
}

function syncAnchoredArrows(arrows: CanvasArrow[], elements: CanvasElement[]) {
  const positions = new globalThis.Map(elements.map((element) => {
    const size = elementDimensions(element);
    return [element.id, { element, size }];
  }));
  return arrows.map((arrow) => {
    const start = arrow.startAnchor ? positions.get(arrow.startAnchor.elementId) : undefined;
    const end = arrow.endAnchor ? positions.get(arrow.endAnchor.elementId) : undefined;
    return {
      ...arrow,
      ...(start ? {
        x1: start.element.x + start.size.width * arrow.startAnchor!.x,
        y1: start.element.y + start.size.height * arrow.startAnchor!.y,
      } : {}),
      ...(end ? {
        x2: end.element.x + end.size.width * arrow.endAnchor!.x,
        y2: end.element.y + end.size.height * arrow.endAnchor!.y,
      } : {}),
    };
  });
}

function snapElementPosition(target: CanvasElement, x: number, y: number, elements: CanvasElement[]) {
  const { width, height } = elementDimensions(target);
  let snappedX = Math.round(x / GRID_SIZE) * GRID_SIZE;
  let snappedY = Math.round(y / GRID_SIZE) * GRID_SIZE;
  let guideX: number | undefined;
  let guideY: number | undefined;
  let bestX = ALIGN_THRESHOLD + 1;
  let bestY = ALIGN_THRESHOLD + 1;

  for (const other of elements) {
    if (other.id === target.id) continue;
    const otherSize = elementDimensions(other);
    const xMatches = [
      { position: other.x, line: other.x },
      { position: other.x + otherSize.width / 2 - width / 2, line: other.x + otherSize.width / 2 },
      { position: other.x + otherSize.width - width, line: other.x + otherSize.width },
    ];
    const yMatches = [
      { position: other.y, line: other.y },
      { position: other.y + otherSize.height / 2 - height / 2, line: other.y + otherSize.height / 2 },
      { position: other.y + otherSize.height - height, line: other.y + otherSize.height },
    ];
    for (const match of xMatches) {
      const distance = Math.abs(x - match.position);
      if (distance <= ALIGN_THRESHOLD && distance < bestX) {
        bestX = distance;
        snappedX = match.position;
        guideX = match.line;
      }
    }
    for (const match of yMatches) {
      const distance = Math.abs(y - match.position);
      if (distance <= ALIGN_THRESHOLD && distance < bestY) {
        bestY = distance;
        snappedY = match.position;
        guideY = match.line;
      }
    }
  }

  return { x: snappedX, y: snappedY, guides: { x: guideX, y: guideY } as AlignmentGuides };
}

const SCENARIO_PRESETS: { id: ScenarioPreset; title: string; description: string }[] = [
  { id: 'current', title: 'Cópia do Estado atual', description: 'Base neutra para editar livremente.' },
  { id: 'demand-up', title: 'Demanda +20%', description: 'Testa crescimento e revela sobrecargas.' },
  { id: 'demand-down', title: 'Demanda −20%', description: 'Avalia ociosidade e consolidação.' },
  { id: 'bottleneck-resource', title: '+1 recurso no gargalo', description: 'Duplica a capacidade paralela da restrição atual.' },
  { id: 'setup-half', title: 'Setup −50%', description: 'Simula melhoria de troca e lotes menores.' },
  { id: 'availability-up', title: 'Disponibilidade +10 p.p.', description: 'Testa estabilidade e manutenção.' },
  { id: 'quality-up', title: 'Qualidade +5 p.p.', description: 'Reduz perdas acumuladas ao longo do fluxo.' },
  { id: 'one-piece-flow', title: 'Fluxo unitário', description: 'Lote de produção 1 em todos os processos: as peças andam uma a uma.' },
  { id: 'batch-production', title: 'Produção em lotes', description: 'Todos os processos fabricam por lote; lotes de 1 peça passam a 5.' },
];

function ScenarioCreateModal({ onCreate, onClose }: { onCreate: (name: string, preset: ScenarioPreset) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<ScenarioPreset>('current');
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return createPortal(
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="scenario-create-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar criação de cenário" />
      <section className="editor-window scenario-create-modal">
        <header><div><h2 id="scenario-create-title">Novo cenário futuro</h2><p>Comece sempre do Estado atual e aplique uma hipótese inicial.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></header>
        <div className="scenario-create-body">
          <label className="scenario-name-field"><span>Nome do cenário</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Demanda alta — 2º semestre" /></label>
          <div className="scenario-preset-grid">
            {SCENARIO_PRESETS.map((item) => <button key={item.id} className={preset === item.id ? 'active' : ''} onClick={() => setPreset(item.id)}>
              <strong>{item.title}</strong><span>{item.description}</span>
            </button>)}
          </div>
        </div>
        <footer className="scenario-modal-footer"><button className="quiet-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={() => onCreate(name, preset)}>Criar cenário</button></footer>
      </section>
    </div>, document.body,
  );
}

function ComparisonModal({ workspace, onSelect, onClose }: { workspace: CanvasWorkspace; onSelect: (id: string) => void; onClose: () => void }) {
  const rows = [
    { id: '', name: 'Estado atual', kind: 'current' as const, canvas: workspace.current },
    ...workspace.futures.map((variant) => ({ id: variant.id, name: variant.name, kind: 'future' as const, canvas: variant.canvas })),
  ].map((row) => {
    const result = calculateCanvasSimulation(row.canvas);
    const wip = result.inventoryElements
      .filter((element) => element.kind !== 'waiting-time')
      .reduce((sum, element) => sum + Math.max(0, Number(element.data.qty) || 0), 0);
    const operators = result.processElements.reduce((sum, element) => sum + Math.max(0, Number(element.data.op) || 0), 0);
    const qualityYield = result.processElements.reduce((yieldRate, element) => {
      const quality = Math.min(100, Math.max(0, percentValue(element.data.qualidade))) / 100;
      return yieldRate * quality;
    }, 1) * 100;
    const maxLoad = result.processMetrics.reduce((maximum, metric) => Math.max(maximum, metric.loadPercent), 0);
    const totalLeadTimeDays = result.leadTimeDays + (row.canvas.assumptions.availableMinutesPerDay > 0
      ? result.processingTimeMin / row.canvas.assumptions.availableMinutesPerDay
      : 0);
    const capacityMargin = result.dailyDemand > 0
      ? (result.bottleneckCapacity / result.dailyDemand - 1) * 100
      : 0;
    return { ...row, result, metrics: { wip, operators, qualityYield, maxLoad, totalLeadTimeDays, capacityMargin } };
  });
  const baseline = rows[0];
  const selected = rows.find((row) => row.id === workspace.activeFutureId) ?? rows[1] ?? rows[0];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  const number = (value: number, digits = 1) => Number.isFinite(value) ? value.toLocaleString('pt-BR', { maximumFractionDigits: digits }) : '—';
  const delta = (value: number, current: number, direction: 'higher' | 'lower' | 'neutral' = 'neutral', suffix = '', digits = 1) => {
    const difference = value - current;
    const tolerance = Math.max(0.001, Math.abs(current) * 0.0001);
    const state = Math.abs(difference) <= tolerance
      ? 'neutral'
      : direction === 'neutral'
        ? 'changed'
        : (direction === 'higher' ? difference > 0 : difference < 0) ? 'good' : 'bad';
    const sign = difference > tolerance ? '+' : '';
    return { state, label: `${sign}${number(difference, digits)}${suffix}` };
  };
  const selectedCards = [
    { label: 'Capacidade diária', value: `${number(selected.result.bottleneckCapacity)} un`, change: delta(selected.result.bottleneckCapacity, baseline.result.bottleneckCapacity, 'higher', ' un') },
    { label: 'Tempo de atravessamento', value: `${number(selected.metrics.totalLeadTimeDays, 2)} dias`, change: delta(selected.metrics.totalLeadTimeDays, baseline.metrics.totalLeadTimeDays, 'lower', ' d', 2) },
    { label: 'WIP total', value: `${number(selected.metrics.wip)} un`, change: delta(selected.metrics.wip, baseline.metrics.wip, 'lower', ' un') },
    { label: 'Operadores informados', value: number(selected.metrics.operators, 0), change: delta(selected.metrics.operators, baseline.metrics.operators, 'neutral', '', 0) },
    { label: 'Qualidade acumulada', value: `${number(selected.metrics.qualityYield, 1)}%`, change: delta(selected.metrics.qualityYield, baseline.metrics.qualityYield, 'higher', ' p.p.') },
    { label: 'Carga máxima', value: `${number(selected.metrics.maxLoad, 0)}%`, change: delta(selected.metrics.maxLoad, baseline.metrics.maxLoad, 'lower', ' p.p.', 0) },
  ];
  const selectedStatus = selected.result.invalidProcesses.length ? 'warning' : selected.result.overloadedProcesses.length ? 'critical' : 'ok';
  return createPortal(
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="comparison-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar comparação" />
      <section className="editor-window comparison-modal">
        <header><div><h2 id="comparison-title">Estado Atual × Estados Futuros</h2><p>Compare resultado, desperdício e capacidade antes de escolher o cenário que será implantado.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></header>
        <div className={`comparison-hero ${selectedStatus}`}>
          <div className="comparison-hero-title"><span>Cenário selecionado</span><strong>{selected.name}</strong><small>comparado ao Estado atual</small></div>
          <div className="comparison-hero-status">
            <strong>{selected.result.invalidProcesses.length ? 'Dados incompletos' : selected.result.overloadedProcesses.length ? 'Não atende à demanda' : 'Atende à demanda'}</strong>
            <span>Margem de capacidade {selected.metrics.capacityMargin >= 0 ? '+' : ''}{number(selected.metrics.capacityMargin, 1)}%</span>
          </div>
        </div>
        <div className="comparison-delta-grid">
          {selectedCards.map((card) => <div key={card.label}>
            <span>{card.label}</span><strong>{card.value}</strong><small className={card.change.state}>{card.change.label} vs. atual</small>
          </div>)}
        </div>
        <div className="comparison-table-heading"><div><strong>Todos os cenários</strong><span>Os valores menores de WIP, atravessamento e carga representam melhoria; operadores são exibidos sem julgamento automático.</span></div></div>
        <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Cenário</th><th>Demanda/dia</th><th>Capacidade/dia</th><th>Margem</th><th>Atravessamento</th><th>WIP</th><th>Operadores</th><th>Qualidade</th><th>Carga máx.</th><th>Restrição</th><th>Situação</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id || 'current'} className={row.id === workspace.activeFutureId ? 'active' : ''}>
            <td><span className={`scenario-dot ${row.kind}`}/><strong>{row.name}</strong>{row.id && <button onClick={() => { onSelect(row.id); onClose(); }}>Abrir</button>}</td>
            <td>{number(row.result.dailyDemand, 2)} un</td><td>{number(row.result.bottleneckCapacity)} un</td>
            <td className={row.metrics.capacityMargin < 0 ? 'metric-bad' : 'metric-good'}>{row.metrics.capacityMargin >= 0 ? '+' : ''}{number(row.metrics.capacityMargin)}%</td>
            <td>{number(row.metrics.totalLeadTimeDays, 2)} d{row.kind === 'future' && <small className={delta(row.metrics.totalLeadTimeDays, baseline.metrics.totalLeadTimeDays, 'lower').state}>{delta(row.metrics.totalLeadTimeDays, baseline.metrics.totalLeadTimeDays, 'lower', ' d').label}</small>}</td>
            <td>{number(row.metrics.wip)} un{row.kind === 'future' && <small className={delta(row.metrics.wip, baseline.metrics.wip, 'lower').state}>{delta(row.metrics.wip, baseline.metrics.wip, 'lower', ' un').label}</small>}</td>
            <td>{number(row.metrics.operators, 0)}{row.kind === 'future' && <small className="changed">{delta(row.metrics.operators, baseline.metrics.operators, 'neutral', '', 0).label}</small>}</td>
            <td>{number(row.metrics.qualityYield)}%{row.kind === 'future' && <small className={delta(row.metrics.qualityYield, baseline.metrics.qualityYield, 'higher').state}>{delta(row.metrics.qualityYield, baseline.metrics.qualityYield, 'higher', ' p.p.').label}</small>}</td>
            <td>{number(row.metrics.maxLoad, 0)}%{row.kind === 'future' && <small className={delta(row.metrics.maxLoad, baseline.metrics.maxLoad, 'lower').state}>{delta(row.metrics.maxLoad, baseline.metrics.maxLoad, 'lower', ' p.p.', 0).label}</small>}</td>
            <td>{row.result.bottleneck?.label || '—'}</td>
            <td><span className={`comparison-status ${row.result.invalidProcesses.length ? 'warning' : row.result.overloadedProcesses.length ? 'critical' : 'ok'}`}>{row.result.invalidProcesses.length ? 'Dados incompletos' : row.result.overloadedProcesses.length ? `${row.result.overloadedProcesses.length} quebra(m)` : 'Atende'}</span></td>
          </tr>)}
        </tbody></table></div>
      </section>
    </div>, document.body,
  );
}

function LeanAssistantModal({ advice, activeKind, appliedFixes, onFocus, onApply, onUndo, onClose }: {
  advice: LeanAdvice[];
  activeKind: ActiveKind;
  appliedFixes: AppliedLeanFix[];
  onFocus: (targetId: string) => void;
  onApply: (advice: LeanAdvice) => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const critical = advice.filter((item) => item.level === 'critical').length;
  const opportunities = advice.filter((item) => item.level === 'opportunity').length;
  const confirmed = advice.filter((item) => item.level === 'good').length;
  const score = Math.max(0, 100 - critical * 14 - opportunities * 5);
  const areaLabels: Record<LeanAdviceArea, string> = {
    fluxo: 'Fluxo contínuo', pull: 'Sistema puxado', marcapasso: 'Marcapasso',
    programacao: 'Programação', kanban: 'Kanban', dados: 'Dados',
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return createPortal(
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="lean-assistant-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar Assistente Lean" />
      <section className="editor-window lean-assistant-modal">
        <header>
          <div><h2 id="lean-assistant-title">Assistente Lean</h2><p>{activeKind === 'future' ? 'Diagnostique, simule a correção e entenda o efeito no Estado Futuro.' : 'Diagnóstico do Estado Atual; correções automáticas ficam disponíveis no Estado Futuro.'}</p></div>
          <button className="icon-button" onClick={onClose}><X size={20}/></button>
        </header>
        <div className="lean-assistant-summary">
          <div className="lean-score"><strong>{score}</strong><span>coerência</span></div>
          <div><strong>{critical}</strong><span>correções prioritárias</span></div>
          <div><strong>{opportunities}</strong><span>oportunidades</span></div>
          <div><strong>{confirmed}</strong><span>pontos coerentes</span></div>
        </div>
        <div className={`lean-assistant-note ${activeKind === 'future' ? 'future' : ''}`}><BookOpen size={14}/><span>{activeKind === 'future' ? 'As ações alteram somente este cenário futuro. Hipóteses automáticas ficam explicadas e devem ser confirmadas no gemba.' : 'O Estado Atual é preservado como retrato do processo. Abra um cenário futuro para o assistente aplicar melhorias sem alterar a realidade registrada.'}</span></div>
        {appliedFixes.length > 0 && <details className="lean-applied-log" open>
          <summary><CheckCircle2 size={14}/>Alterações feitas pelo assistente <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onUndo(); }}>Desfazer última</button><b>{appliedFixes.length}</b></summary>
          <div>{appliedFixes.map((item) => <article key={item.id}>
            <strong>{item.title}</strong>
            <p><b>Por que:</b> {item.reason}</p>
            <p><b>Alteração:</b> {item.change}</p>
            <p><b>Efeito esperado:</b> {item.expected}</p>
            <p><b>Resultado recalculado:</b> {item.impact}</p>
          </article>)}</div>
        </details>}
        <div className="lean-advice-list">
          {advice.length === 0 ? <div className="lean-advice-empty"><CheckCircle2 size={28}/><strong>Nenhuma incoerência encontrada</strong><span>Continue validando o mapa com quem executa o processo.</span></div> : advice.map((item) => (
            <article key={item.id} className={`lean-advice-card ${item.level}`}>
              <div className="lean-advice-card-heading">
                <span className="lean-advice-area">{areaLabels[item.area]}</span>
                <span className="lean-advice-level">{item.level === 'critical' ? 'Corrigir' : item.level === 'opportunity' ? 'Melhorar' : 'Coerente'}</span>
              </div>
              <h3>{item.title}</h3>
              <div className="lean-advice-copy"><span>Por quê</span><p>{item.why}</p></div>
              <div className="lean-advice-copy action"><span>O que fazer</span><p>{item.action}</p></div>
              {item.fix && <div className="lean-fix-preview">
                <span>O assistente vai alterar</span><p>{item.fix.change}</p>
                {item.expected && <><span>Resultado esperado</span><p>{item.expected}</p></>}
              </div>}
              <div className="lean-advice-actions">
                {item.targetId && <button className="lean-focus-button" onClick={() => onFocus(item.targetId!)}><Route size={13}/>Mostrar no MFV{item.targetLabel ? ` · ${item.targetLabel}` : ''}</button>}
                {item.fix && activeKind === 'future' && <button className="lean-apply-button" onClick={() => onApply(item)}><Sparkles size={13}/>{item.fix.label}</button>}
                {item.fix && activeKind === 'current' && <span className="lean-future-only">Disponível no Estado Futuro</span>}
                {!item.fix && item.level !== 'good' && <span className="lean-manual-only">Exige medição ou decisão humana — não será inventado pelo assistente</span>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ScenarioPill({ kind }: { kind: ActiveKind }) {
  return <span className={`scenario-pill ${kind}`}>{kind==='current'?'Estado atual':'Estado futuro'}</span>;
}

interface AppDialogState {
  type: 'alert' | 'confirm' | 'prompt';
  title: string;
  message: string;
  value?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: (value?: string) => void;
}

function AppDialog({ dialog, onClose }: { dialog: AppDialogState; onClose: () => void }) {
  const [value, setValue] = useState(dialog.value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog.type === 'prompt') setTimeout(() => inputRef.current?.select(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter' && dialog.type === 'prompt' && value.trim()) {
        dialog.onConfirm?.(value.trim());
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose, value]);

  const confirm = () => {
    dialog.onConfirm?.(dialog.type === 'prompt' ? value.trim() : undefined);
    onClose();
  };

  return createPortal(<div className="editor-overlay app-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
    <button className="editor-backdrop" onClick={onClose} aria-label="Fechar diálogo"/>
    <section className="editor-window app-dialog">
      <div className={`app-dialog-symbol ${dialog.destructive ? 'destructive' : ''}`}>
        {dialog.destructive ? <AlertTriangle size={21}/> : dialog.type === 'alert' ? <Activity size={21}/> : <Route size={21}/>}
      </div>
      <h2 id="app-dialog-title">{dialog.title}</h2>
      <p>{dialog.message}</p>
      {dialog.type === 'prompt' && <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} aria-label={dialog.title}/>}
      <footer>
        {dialog.type !== 'alert' && <button className="quiet-button" onClick={onClose}>Cancelar</button>}
        <button className={`primary-button ${dialog.destructive ? 'destructive' : ''}`} disabled={dialog.type === 'prompt' && !value.trim()} onClick={confirm}>{dialog.confirmLabel ?? (dialog.type === 'alert' ? 'Entendi' : 'Confirmar')}</button>
      </footer>
    </section>
  </div>, document.body);
}

export default function App() {
  const [activeKind, setActiveKind] = useState<ActiveKind>('current');
  const [workspace, setWorkspace] = useState<CanvasWorkspace>(loadWorkspace);
  const workspaceRef = useRef(workspace);
  const undoStackRef = useRef<CanvasWorkspace[]>([]);
  const dragUndoSnapshotRef = useRef<CanvasWorkspace | null>(null);
  workspaceRef.current = workspace;
  const activeFuture = workspace.futures.find((variant) => variant.id === workspace.activeFutureId) ?? workspace.futures[0];
  const canvas = activeKind === 'current' ? workspace.current : activeFuture.canvas;
  const simulation = calculateCanvasSimulation(canvas);
  const leanAdvice = buildLeanAssistant(canvas, simulation);
  const leanActionCount = leanAdvice.filter((item) => item.level !== 'good').length;
  const simulatedDaySeconds = canvas.assumptions.availableMinutesPerDay * 60;
  const timelineSourceElements = [...simulation.processElements, ...simulation.inventoryElements];
  const automaticTimelinePosition = timelineSourceElements.length
    ? {
        x: Math.min(...timelineSourceElements.map((element) => element.x)) - 150,
        y: Math.max(...timelineSourceElements.map((element) => element.y + elementDimensions(element).height)) + 115,
      }
    : null;

  const setCanvas = useCallback((next: CanvasState | ((p: CanvasState) => CanvasState), skipHistory = false) => {
    setWorkspace((previous) => {
      const selectedFuture = previous.futures.find((variant) => variant.id === previous.activeFutureId) ?? previous.futures[0];
      const activeCanvas = activeKind === 'current' ? previous.current : selectedFuture.canvas;
      const updated = normalizeCanvas(typeof next === 'function' ? next(activeCanvas) : next);
      if (!skipHistory) {
        const snapshot = cloneWorkspace(previous);
        if (!undoStackRef.current[0] || JSON.stringify(undoStackRef.current[0]) !== JSON.stringify(snapshot)) {
          undoStackRef.current = [snapshot, ...undoStackRef.current].slice(0, 80);
        }
      }
      const result: CanvasWorkspace = activeKind === 'current'
        ? {
            ...previous,
            current: updated,
            futures: previous.futures.map((variant) => ({
              ...variant,
              canvas: syncCurrentIntoFuture(previous.current, updated, variant.canvas),
            })),
          }
        : {
            ...previous,
            futures: previous.futures.map((variant) => variant.id === previous.activeFutureId ? { ...variant, canvas: updated } : variant),
          };
      workspaceRef.current = result;
      return result;
    });
  }, [activeKind]);

  const undoLastChange = useCallback(() => {
    const previous = undoStackRef.current[0];
    if (!previous) return;
    undoStackRef.current = undoStackRef.current.slice(1);
    const restored = cloneWorkspace(previous);
    workspaceRef.current = restored;
    setWorkspace(restored);
    setSelectedId(null);
    setEditingEl(null);
    setEditingArrow(null);
    setDragging(null);
    setAlignmentGuides({});
  }, []);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingEl, setEditingEl] = useState<CanvasElement | null>(null);
  const [editingArrow, setEditingArrow] = useState<CanvasArrow | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectToolsOpen, setProjectToolsOpen] = useState(false);
  const [leanPanelOpen, setLeanPanelOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [demandOpen, setDemandOpen] = useState(false);
  const [scenarioCreateOpen, setScenarioCreateOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [leanAssistantOpen, setLeanAssistantOpen] = useState(false);
  const [stressTestOpen, setStressTestOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(() => {
    try { return localStorage.getItem(MANUAL_SEEN_KEY) !== 'true'; } catch { return true; }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const saveFailureNotifiedRef = useRef(false);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [appDialog, setAppDialog] = useState<AppDialogState | null>(null);
  const [appliedLeanFixes, setAppliedLeanFixes] = useState<AppliedLeanFix[]>([]);
  const [leanUndoStack, setLeanUndoStack] = useState<CanvasState[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveElapsedSec, setLiveElapsedSec] = useState(0);
  const [liveSpeed, setLiveSpeed] = useState(300);
  // Quantidade da ordem de produção simulada; vazio = fluxo contínuo no ritmo da demanda.
  const [liveOrderInput, setLiveOrderInput] = useState(() => {
    try { return localStorage.getItem(LIVE_ORDER_STORAGE_KEY) ?? ''; } catch { return ''; }
  });
  const liveOrderQuantity = Math.max(0, Math.round(Number(liveOrderInput) || 0));
  useEffect(() => {
    try { localStorage.setItem(LIVE_ORDER_STORAGE_KEY, liveOrderInput); } catch { /* armazenamento indisponível */ }
  }, [liveOrderInput]);
  const [clipboardNotice, setClipboardNotice] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const leanFloatingRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const canvasClipboardRef = useRef<CanvasClipboard | null>(null);
  const pasteCountRef = useRef(0);
  const liveFrameRef = useRef<number | null>(null);
  const liveLastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!leanPanelOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (leanFloatingRef.current && !leanFloatingRef.current.contains(event.target as Node)) setLeanPanelOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setLeanPanelOpen(false); };
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [leanPanelOpen]);

  useEffect(() => {
    setSelectedId(null);
    setEditingEl(null);
    setEditingArrow(null);
    setLeanAssistantOpen(false);
    setStressTestOpen(false);
    setAppliedLeanFixes([]);
    setLeanUndoStack([]);
    setLiveRunning(false);
    setLiveElapsedSec(0);
  }, [activeKind, workspace.activeFutureId]);

  useEffect(() => {
    if (!liveRunning) {
      liveLastTickRef.current = null;
      return;
    }
    const tick = (timestamp: number) => {
      if (liveLastTickRef.current !== null) {
        const deltaSeconds = Math.min(0.1, (timestamp - liveLastTickRef.current) / 1000);
        setLiveElapsedSec((previous) => Math.min(simulatedDaySeconds * LIVE_MAX_DAYS, previous + deltaSeconds * liveSpeed));
      }
      liveLastTickRef.current = timestamp;
      liveFrameRef.current = window.requestAnimationFrame(tick);
    };
    liveFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (liveFrameRef.current !== null) window.cancelAnimationFrame(liveFrameRef.current);
      liveFrameRef.current = null;
      liveLastTickRef.current = null;
    };
  }, [liveRunning, liveSpeed, simulatedDaySeconds]);

  useEffect(() => {
    if (liveElapsedSec >= simulatedDaySeconds * LIVE_MAX_DAYS && liveRunning) setLiveRunning(false);
  }, [liveElapsedSec, liveRunning, simulatedDaySeconds]);
  // Quando a ordem de produção fica pronta, a simulação para e o relógio fica no tempo total.
  useEffect(() => {
    setLiveRunning(false);
    setLiveElapsedSec(0);
  }, [liveOrderQuantity]);

  const openElementEditor = (element: CanvasElement) => {
    if (element.id === FIXED_PLANNING_ID) {
      setDemandOpen(true);
      return;
    }
    setEditingEl(element);
  };

  const focusAssistantTarget = (targetId: string) => {
    const element = canvas.elements.find((candidate) => candidate.id === targetId);
    const arrow = canvas.arrows.find((candidate) => candidate.id === targetId);
    const bounds = svgRef.current?.getBoundingClientRect();
    if (bounds && element) {
      const size = elementDimensions(element);
      setPan({
        x: bounds.width / 2 - (element.x + size.width / 2) * zoom,
        y: bounds.height / 2 - (element.y + size.height / 2) * zoom,
      });
    } else if (bounds && arrow) {
      setPan({
        x: bounds.width / 2 - ((arrow.x1 + arrow.x2) / 2) * zoom,
        y: bounds.height / 2 - ((arrow.y1 + arrow.y2) / 2) * zoom,
      });
    }
    setSelectedId(targetId);
    setLeanAssistantOpen(false);
  };

  const applyAssistantFix = (item: LeanAdvice) => {
    if (activeKind !== 'future' || !item.fix) return;
    const before = calculateCanvasSimulation(canvas);
    const updated = applyLeanFix(canvas, item);
    const after = calculateCanvasSimulation(updated);
    const impactParts: string[] = [];
    if (before.overloadedProcesses.length !== after.overloadedProcesses.length) impactParts.push(`quebras ${before.overloadedProcesses.length} → ${after.overloadedProcesses.length}`);
    if (before.bottleneckCapacity !== after.bottleneckCapacity) impactParts.push(`capacidade ${before.bottleneckCapacity.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} → ${after.bottleneckCapacity.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} un/dia`);
    if (before.pullWipLimit !== after.pullWipLimit) impactParts.push(`WIP puxado ${before.pullWipLimit || '—'} → ${after.pullWipLimit || '—'} un`);
    if (before.pacemaker?.id !== after.pacemaker?.id) impactParts.push(`marcapasso ${before.pacemaker?.label || 'não definido'} → ${after.pacemaker?.label || 'não definido'}`);
    if (before.epeiDays !== after.epeiDays) impactParts.push(`EPEI ${Number.isFinite(before.epeiDays) ? before.epeiDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : 'sem capacidade'} → ${Number.isFinite(after.epeiDays) ? after.epeiDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : 'sem capacidade'} dia(s)`);
    if (canvas.elements.length !== updated.elements.length) impactParts.push(`elementos ${canvas.elements.length} → ${updated.elements.length}`);
    const impact = impactParts.length ? impactParts.join(' · ') : 'A estrutura foi ajustada; os indicadores principais permaneceram estáveis.';
    setLeanUndoStack((previous) => [cloneCanvas(canvas), ...previous].slice(0, 12));
    setCanvas(updated);
    setAppliedLeanFixes((previous) => [{
      id: `${item.id}-${makeId()}`,
      title: item.title,
      reason: item.why,
      change: item.fix!.change,
      expected: item.expected ?? item.action,
      impact,
    }, ...previous].slice(0, 12));
  };

  const undoAssistantFix = () => {
    if (activeKind !== 'future' || !leanUndoStack.length) return;
    setCanvas(leanUndoStack[0]);
    setLeanUndoStack((previous) => previous.slice(1));
    setAppliedLeanFixes((previous) => previous.slice(1));
  };

  useEffect(() => {
    const persisted = persistWorkspace(workspace);
    setSaveFailed(!persisted);
    if (persisted) saveFailureNotifiedRef.current = false;
    else if (!saveFailureNotifiedRef.current) {
      saveFailureNotifiedRef.current = true;
      setAppDialog({
        type: 'alert', title: 'Alterações não salvas',
        message: 'O armazenamento do navegador está cheio ou bloqueado. Use “Salvar projeto (.json)” em Ferramentas do projeto para não perder o trabalho, e remova imagens ou cenários que não usa.',
      });
    }
    setSaved(false);
    const t = setTimeout(() => setSaved(true), 500);
    return () => clearTimeout(t);
  }, [workspace]);

  const toCanvas = useCallback((cx: number, cy: number) => ({
    x: (cx - pan.x) / zoom, y: (cy - pan.y) / zoom,
  }), [pan, zoom]);

  const onLibDragStart = (item: LibraryItem, e: React.DragEvent) => {
    e.dataTransfer.setData('mfv/kind', item.kind);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('mfv/kind') as ElementKind;
    if (!kind) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top);
    const lib = LIBRARY.find((l) => l.kind === kind)!;
    if (ARROW_KINDS.includes(kind)) {
      const k = kind as CanvasArrow['kind'];
      const a: CanvasArrow = { id: makeId(), kind: k, x1: x, y1: y, x2: x+120, y2: y, label: lib.defaultLabel || undefined };
      setCanvas((p) => ({ ...p, arrows: [...p.arrows, a] }));
      setSelectedId(a.id);
    } else {
      const draftData = { ...lib.defaultData };
      if (kind === 'pacemaker') {
        const existingPacemaker = canvas.elements.find((element) => element.kind === 'pacemaker');
        if (existingPacemaker) {
          setAppDialog({ type: 'alert', title: 'Marcapasso já definido', message: 'O MFV deve ter somente um processo marcapasso. Edite ou mova o marcapasso existente.' });
          setSelectedId(existingPacemaker.id);
          return;
        }
        const candidate: CanvasElement = { id: '', kind, x: x - lib.w/2, y: y - lib.h/2, label: '', data: {} };
        const process = nearestProcess(candidate, canvas.elements.filter((element) => ['process','shared-process'].includes(element.kind)));
        if (process) {
          draftData.processId = process.id;
        }
      }
      const draft: CanvasElement = { id: makeId(), kind, x: x - lib.w/2, y: y - lib.h/2, label: lib.defaultLabel, data: draftData };
      if (kind === 'pacemaker' && draftData.processId) {
        const process = canvas.elements.find((element) => element.id === draftData.processId);
        draft.label = process?.label ?? draft.label;
      }
      const snapped = snapElementPosition(draft, draft.x, draft.y, canvas.elements);
      const el = { ...draft, x: snapped.x, y: snapped.y };
      setCanvas((p) => ({ ...p, elements: [...p.elements, el] }));
      setSelectedId(el.id);
    }
  };

  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const t = e.target as SVGElement;
    if (t === svgRef.current || t.classList.contains('canvas-bg')) {
      setSelectedId(null);
      dragUndoSnapshotRef.current = null;
      setDragging({ type: 'pan', startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y });
      e.preventDefault();
    }
  };

  const onElMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const el = canvas.elements.find((el) => el.id === id)!;
    setSelectedId(id);
    dragMovedRef.current = false;
    dragUndoSnapshotRef.current = cloneWorkspace(workspaceRef.current);
    setDragging({ type: 'element', id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y });
  };

  const onHandleMouseDown = (e: React.MouseEvent, id: string, point: 'start'|'end') => {
    e.stopPropagation();
    setSelectedId(id);
    dragMovedRef.current = false;
    dragUndoSnapshotRef.current = cloneWorkspace(workspaceRef.current);
    setDragging({ type: 'arrow-point', id, point });
  };

  const onElementResizeMouseDown = (e: React.MouseEvent, element: CanvasElement, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const size = elementDimensions(element);
    setSelectedId(element.id);
    dragMovedRef.current = false;
    dragUndoSnapshotRef.current = cloneWorkspace(workspaceRef.current);
    setDragging({
      type: 'element-resize', id: element.id, corner, startX: e.clientX, startY: e.clientY,
      origX: element.x, origY: element.y, origWidth: size.width, origHeight: size.height,
    });
  };

  const onArrowMouseDown = (e: React.MouseEvent, arrow: CanvasArrow) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedId(arrow.id);
    dragMovedRef.current = false;
    dragUndoSnapshotRef.current = cloneWorkspace(workspaceRef.current);
    setDragging({
      type: 'arrow', id: arrow.id, startX: e.clientX, startY: e.clientY,
      x1: arrow.x1, y1: arrow.y1, x2: arrow.x2, y2: arrow.y2,
    });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      if (dragging.type === 'pan') {
        setPan({ x: dragging.origX + e.clientX - dragging.startX, y: dragging.origY + e.clientY - dragging.startY });
      } else if (dragging.type === 'element') {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;
        if (Math.abs(e.clientX - dragging.startX) > 4 || Math.abs(e.clientY - dragging.startY) > 4) dragMovedRef.current = true;
        setCanvas((p) => {
          const target = p.elements.find((element) => element.id === dragging.id);
          if (!target) return p;
          const snapped = snapElementPosition(target, dragging.origX + dx, dragging.origY + dy, p.elements);
          setAlignmentGuides(snapped.guides);
          const elements = p.elements.map((el) =>
            el.id === dragging.id ? { ...el, x: snapped.x, y: snapped.y } : el);
          return { ...p, elements, arrows: syncAnchoredArrows(p.arrows, elements) };
        }, true);
      } else if (dragging.type === 'element-resize') {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;
        if (Math.abs(e.clientX - dragging.startX) > 3 || Math.abs(e.clientY - dragging.startY) > 3) dragMovedRef.current = true;
        const fromWest = dragging.corner === 'nw' || dragging.corner === 'sw';
        const fromNorth = dragging.corner === 'nw' || dragging.corner === 'ne';
        const rawWidth = dragging.origWidth + (fromWest ? -dx : dx);
        const rawHeight = dragging.origHeight + (fromNorth ? -dy : dy);
        const width = Math.max(100, Math.round(rawWidth / GRID_SIZE) * GRID_SIZE);
        const height = Math.max(70, Math.round(rawHeight / GRID_SIZE) * GRID_SIZE);
        const x = fromWest ? dragging.origX + dragging.origWidth - width : dragging.origX;
        const y = fromNorth ? dragging.origY + dragging.origHeight - height : dragging.origY;
        setCanvas((p) => {
          const elements = p.elements.map((element) => element.id === dragging.id
            ? { ...element, x, y, data: { ...element.data, width, height } }
            : element);
          return { ...p, elements, arrows: syncAnchoredArrows(p.arrows, elements) };
        }, true);
      } else if (dragging.type === 'arrow') {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;
        if (Math.abs(e.clientX - dragging.startX) > 4 || Math.abs(e.clientY - dragging.startY) > 4) dragMovedRef.current = true;
        setCanvas((p) => ({ ...p, arrows: p.arrows.map((arrow) => arrow.id === dragging.id ? {
          ...arrow,
          x1: dragging.x1 + dx,
          y1: dragging.y1 + dy,
          x2: dragging.x2 + dx,
          y2: dragging.y2 + dy,
          startAnchor: undefined,
          endAnchor: undefined,
        } : arrow) }), true);
      } else if (dragging.type === 'arrow-point') {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const { x, y } = toCanvas(e.clientX - rect.left, e.clientY - rect.top);
        dragMovedRef.current = true;
        setCanvas((p) => {
          const connection = findArrowAnchor(x, y, p.elements);
          return { ...p, arrows: p.arrows.map((a) => {
            if (a.id !== dragging.id) return a;
            if (dragging.point === 'start') return {
              ...a,
              x1: connection?.x ?? x,
              y1: connection?.y ?? y,
              startAnchor: connection?.anchor,
            };
            return {
              ...a,
              x2: connection?.x ?? x,
              y2: connection?.y ?? y,
              endAnchor: connection?.anchor,
            };
          }) };
        }, true);
      }
    };
    const onUp = () => {
      const snapshot = dragUndoSnapshotRef.current;
      if (dragging?.type !== 'pan' && snapshot && JSON.stringify(snapshot) !== JSON.stringify(workspaceRef.current)) {
        undoStackRef.current = [snapshot, ...undoStackRef.current].slice(0, 80);
      }
      dragUndoSnapshotRef.current = null;
      setDragging(null);
      setAlignmentGuides({});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, zoom, toCanvas, setCanvas]);

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    setZoom((z) => {
      const nz = Math.min(4, Math.max(0.15, z * factor));
      setPan((p) => ({ x: mx - (mx - p.x) * (nz/z), y: my - (my - p.y) * (nz/z) }));
      return nz;
    });
  };

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      event.preventDefault();
      undoLastChange();
    };
    window.addEventListener('keydown', handleUndoShortcut);
    return () => window.removeEventListener('keydown', handleUndoShortcut);
  }, [undoLastChange]);

  useEffect(() => {
    if (!clipboardNotice) return;
    const timeout = window.setTimeout(() => setClipboardNotice(''), 1800);
    return () => window.clearTimeout(timeout);
  }, [clipboardNotice]);

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') || target?.closest('.editor-window,.process-popover,.site-select-menu')) return;
      if (window.getSelection()?.toString()) return;

      if (key === 'c') {
        if (!selectedId) return;
        const element = canvas.elements.find((candidate) => candidate.id === selectedId);
        if (element) {
          if ([FIXED_PLANNING_ID, FIXED_IDENTIFICATION_ID].includes(element.id) || ['pacemaker','timeline'].includes(element.kind)) {
            setClipboardNotice(element.kind === 'pacemaker' ? 'O marcapasso é único e não pode ser duplicado.' : 'Este elemento é fixo e não pode ser duplicado.');
            event.preventDefault();
            return;
          }
          canvasClipboardRef.current = { type: 'element', element: { ...element, data: { ...element.data } } };
          pasteCountRef.current = 0;
          setClipboardNotice(`${element.label || 'Elemento'} copiado.`);
          event.preventDefault();
          return;
        }
        const arrow = canvas.arrows.find((candidate) => candidate.id === selectedId);
        if (arrow) {
          canvasClipboardRef.current = { type: 'arrow', arrow: { ...arrow, startAnchor: arrow.startAnchor ? { ...arrow.startAnchor } : undefined, endAnchor: arrow.endAnchor ? { ...arrow.endAnchor } : undefined } };
          pasteCountRef.current = 0;
          setClipboardNotice('Seta copiada.');
          event.preventDefault();
        }
        return;
      }

      const clipboard = canvasClipboardRef.current;
      if (!clipboard) return;
      event.preventDefault();
      pasteCountRef.current = (pasteCountRef.current % 6) + 1;
      const offset = 20 + pasteCountRef.current * GRID_SIZE;

      if (clipboard.type === 'element') {
        const source = clipboard.element;
        const id = makeId();
        const processCopy = ['process','shared-process'].includes(source.kind);
        const draft: CanvasElement = {
          ...source,
          id,
          x: source.x + offset,
          y: source.y + offset,
          label: processCopy && !source.label.toLocaleLowerCase('pt-BR').includes('cópia') ? `${source.label || 'Processo'} — cópia` : source.label,
          data: { ...source.data },
        };
        setCanvas((previous) => {
          const snapped = snapElementPosition(draft, draft.x, draft.y, previous.elements);
          return { ...previous, elements: [...previous.elements, { ...draft, x: snapped.x, y: snapped.y }] };
        });
        setSelectedId(id);
        setClipboardNotice(processCopy ? 'Processo duplicado e incluído nos cálculos.' : `${source.label || 'Elemento'} duplicado.`);
        return;
      }

      const source = clipboard.arrow;
      const id = makeId();
      const duplicate: CanvasArrow = {
        ...source,
        id,
        x1: source.x1 + offset,
        y1: source.y1 + offset,
        x2: source.x2 + offset,
        y2: source.y2 + offset,
        startAnchor: undefined,
        endAnchor: undefined,
      };
      setCanvas((previous) => ({ ...previous, arrows: [...previous.arrows, duplicate] }));
      setSelectedId(id);
      setClipboardNotice('Seta duplicada; conecte as extremidades desejadas.');
    };
    window.addEventListener('keydown', handleClipboardShortcut);
    return () => window.removeEventListener('keydown', handleClipboardShortcut);
  }, [canvas, selectedId, setCanvas]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!selectedId) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if ([FIXED_PLANNING_ID, FIXED_IDENTIFICATION_ID].includes(selectedId)) return;
      setCanvas((p) => ({
        ...p,
        elements: p.elements.filter((el) => el.id !== selectedId),
        arrows: p.arrows.filter((arrow) => arrow.id !== selectedId).map((arrow) => ({
          ...arrow,
          startAnchor: arrow.startAnchor?.elementId === selectedId ? undefined : arrow.startAnchor,
          endAnchor: arrow.endAnchor?.elementId === selectedId ? undefined : arrow.endAnchor,
        })),
      }));
      setSelectedId(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selectedId, setCanvas]);

  const updateEl = (id: string, patch: Partial<CanvasElement>) => {
    setCanvas((p) => {
      const elements = p.elements
        .map((el) => el.id===id ? { ...el, ...patch } : el)
        .map((el) => el.kind === 'pacemaker' && el.data.processId === id && patch.label !== undefined
          ? { ...el, label: String(patch.label) }
          : el);
      return { ...p, elements, arrows: syncAnchoredArrows(p.arrows, elements) };
    });
    if (editingEl?.id === id) setEditingEl((p) => p ? { ...p, ...patch } : p);
  };
  const deleteEl = (id: string) => {
    if ([FIXED_PLANNING_ID, FIXED_IDENTIFICATION_ID].includes(id)) return;
    setCanvas((p) => ({
      ...p,
      elements: p.elements.filter((el) => el.id!==id),
      arrows: p.arrows.map((arrow) => ({
        ...arrow,
        startAnchor: arrow.startAnchor?.elementId === id ? undefined : arrow.startAnchor,
        endAnchor: arrow.endAnchor?.elementId === id ? undefined : arrow.endAnchor,
      })),
    }));
    setEditingEl(null); setSelectedId(null);
  };

  const guideBounds = canvas.elements.reduce((bounds, element) => {
    const size = elementDimensions(element);
    return {
      minX: Math.min(bounds.minX, element.x),
      minY: Math.min(bounds.minY, element.y),
      maxX: Math.max(bounds.maxX, element.x + size.width),
      maxY: Math.max(bounds.maxY, element.y + size.height),
    };
  }, { minX: 0, minY: 0, maxX: 1600, maxY: 700 });
  const updateArrow = (id: string, patch: Partial<CanvasArrow>) => {
    setCanvas((p) => ({ ...p, arrows: p.arrows.map((a) => a.id===id ? { ...a, ...patch } : a) }));
    if (editingArrow?.id === id) setEditingArrow((p) => p ? { ...p, ...patch } : p);
  };
  const deleteArrow = (id: string) => {
    setCanvas((p) => ({ ...p, arrows: p.arrows.filter((a) => a.id!==id) }));
    setEditingArrow(null); setSelectedId(null);
  };

  const saveAssumptions = (assumptions: ScenarioAssumptions) => {
    setCanvas((previous) => ({
      ...previous,
      assumptions,
      elements: previous.elements.map((element) => element.id === FIXED_PLANNING_ID
        ? { ...element, data: { ...element.data, ...planningData(assumptions) } }
        : element),
    }));
    setDemandOpen(false);
  };

  const applyThemeColor = (themeColor: string) => {
    const color = validThemeColor(themeColor);
    setCanvas((previous) => ({
      ...previous,
      themeColor: color,
    }));
  };

  const applyExcelTemplate = () => {
    setAppDialog({
      type: 'confirm', title: 'Aplicar modelo base do Excel', destructive: true,
      message: 'O cenário atual será substituído pelo modelo base inspirado no Excel. Os dados existentes deste cenário serão removidos.',
      confirmLabel: 'Substituir cenário',
      onConfirm: () => { setCanvas((previous) => createExcelTemplate(previous.assumptions, activeKind)); setSelectedId(null); },
    });
  };

  const requestClearCanvas = () => {
    setAppDialog({
      type: 'confirm', title: 'Limpar o MFV', destructive: true,
      message: 'Todos os elementos e setas serão removidos. As caixas fixas de identificação e demanda serão mantidas.',
      confirmLabel: 'Limpar MFV',
      onConfirm: () => {
        setCanvas((previous) => ({ ...previous, elements: previous.elements.filter((element) => [FIXED_PLANNING_ID, FIXED_IDENTIFICATION_ID].includes(element.id)), arrows: [] }));
        setSelectedId(null);
      },
    });
  };

  const selectFuture = (id: string) => {
    setWorkspace((previous) => {
      if (!previous.futures.some((variant) => variant.id === id)) return previous;
      const next = { ...previous, activeFutureId: id };
      return next;
    });
    setActiveKind('future');
  };

  const createScenario = (name: string, preset: ScenarioPreset) => {
    setWorkspace((previous) => {
      const variant: FutureVariant = {
        id: `future-${makeId()}`,
        name: name.trim() || `Cenário ${previous.futures.length + 1}`,
        canvas: canvasForPreset(previous.current, preset),
      };
      const next = { ...previous, futures: [...previous.futures, variant], activeFutureId: variant.id };
      return next;
    });
    setActiveKind('future');
    setScenarioCreateOpen(false);
  };

  const duplicateScenario = () => {
    setWorkspace((previous) => {
      const source = previous.futures.find((variant) => variant.id === previous.activeFutureId) ?? previous.futures[0];
      const variant = { id: `future-${makeId()}`, name: `${source.name} — cópia`, canvas: cloneCanvas(source.canvas) };
      const next = { ...previous, futures: [...previous.futures, variant], activeFutureId: variant.id };
      return next;
    });
    setActiveKind('future');
  };

  const renameScenario = () => {
    setAppDialog({
      type: 'prompt', title: 'Renomear cenário', message: 'Escolha um nome curto e claro para identificar esta simulação.', value: activeFuture.name, confirmLabel: 'Salvar nome',
      onConfirm: (value) => setWorkspace((previous) => {
        const next = { ...previous, futures: previous.futures.map((variant) => variant.id === previous.activeFutureId ? { ...variant, name: value?.trim() || variant.name } : variant) };
        return next;
      }),
    });
  };

  const deleteScenario = () => {
    if (workspace.futures.length === 1) {
      setAppDialog({ type: 'alert', title: 'Cenário necessário', message: 'Mantenha pelo menos um cenário futuro. Você pode limpar ou renomear o cenário atual.' });
      return;
    }
    setAppDialog({
      type: 'confirm', title: 'Excluir cenário', destructive: true, message: `O cenário “${activeFuture.name}” e suas alterações serão excluídos.`, confirmLabel: 'Excluir cenário',
      onConfirm: () => setWorkspace((previous) => {
        const futures = previous.futures.filter((variant) => variant.id !== previous.activeFutureId);
        const next = { ...previous, futures, activeFutureId: futures[0].id };
        return next;
      }),
    });
  };

  const liveFlow = calculateLiveFlow(simulation, canvas.assumptions, liveElapsedSec, { orderQuantity: liveOrderQuantity });
  const liveLaunched = liveFlow.launched;
  const liveCompleted = liveFlow.completed;
  const liveWip = liveFlow.wip;
  const liveOrder = liveFlow.order;
  // Relatório abaixo do mapa: aparece com a simulação pausada ou concluída.
  const liveReport = liveElapsedSec > 0 && simulation.processElements.length ? buildLiveReport(liveFlow, simulation, liveElapsedSec) : null;
  useEffect(() => {
    if (liveOrder?.done && liveRunning) {
      setLiveRunning(false);
      if (liveOrder.deliveredSec !== null) setLiveElapsedSec(liveOrder.deliveredSec);
    }
  }, [liveOrder?.done, liveOrder?.deliveredSec, liveRunning]);
  // Tempo de trabalho decorrido: "2 h 05 min", ou com os dias úteis quando passa de um dia.
  const formatWorkTime = (seconds: number) => {
    const days = Math.floor(seconds / simulatedDaySeconds);
    const rest = seconds - days * simulatedDaySeconds;
    const hours = Math.floor(rest / 3600);
    const minutes = Math.floor((rest % 3600) / 60);
    const clock = hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`;
    return days > 0 ? `${days} dia${days > 1 ? 's' : ''} + ${clock}` : clock;
  };
  const nextLeveledSlot = liveFlow.blocked > 0
    ? liveFlow.demandedBatches[liveFlow.launchedBatches.length]?.product
    : simulation.leveledSequence[liveFlow.demandedPacks % Math.max(1, simulation.leveledSequence.length)];
  const liveDay = Math.min(LIVE_MAX_DAYS, Math.floor(liveElapsedSec / simulatedDaySeconds) + 1);
  const liveDaySec = liveElapsedSec - (liveDay - 1) * simulatedDaySeconds;
  const liveClock = `Dia ${liveDay} · ${String(Math.floor(liveDaySec / 3600)).padStart(2, '0')}:${String(Math.floor((liveDaySec % 3600) / 60)).padStart(2, '0')}`;
  const toggleLiveSimulation = () => {
    if (!simulation.rawMaterialEntry) {
      setAppDialog({ type: 'alert', title: 'Entrada do fluxo ausente', message: 'Adicione um estoque de matéria-prima para definir a entrada do fluxo produtivo.' });
      return;
    }
    if (!simulation.finalCustomer) {
      setAppDialog({ type: 'alert', title: 'Saída do fluxo ausente', message: 'Adicione um cliente final para definir o término do fluxo produtivo.' });
      return;
    }
    if (!simulation.processElements.length) {
      setAppDialog({ type: 'alert', title: 'Processos não configurados', message: 'Adicione ao menos um processo com tempo de ciclo para executar a simulação.' });
      return;
    }
    if (liveElapsedSec >= simulatedDaySeconds * LIVE_MAX_DAYS) setLiveElapsedSec(0);
    setSelectedId(null);
    setLiveRunning((running) => !running);
  };

  const resetLiveSimulation = () => {
    setLiveRunning(false);
    setLiveElapsedSec(0);
  };
  const closeManual = () => {
    try { localStorage.setItem(MANUAL_SEEN_KEY, 'true'); } catch { /* o manual volta a abrir na próxima visita */ }
    setManualOpen(false);
  };

  const exportProjectFile = () => {
    const blob = new Blob([projectFileContents(workspaceRef.current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `projeto-mfv-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProjectFile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = parseProjectFile(await file.text());
      setAppDialog({
        type: 'confirm', title: 'Abrir projeto', destructive: true,
        message: `O projeto “${file.name}” vai substituir o Estado atual e todos os cenários deste navegador. Você pode desfazer logo em seguida.`,
        confirmLabel: 'Abrir projeto',
        onConfirm: () => {
          undoStackRef.current = [cloneWorkspace(workspaceRef.current), ...undoStackRef.current].slice(0, 80);
          workspaceRef.current = imported;
          setWorkspace(imported);
          setActiveKind('current');
          setSelectedId(null);
          setEditingEl(null);
          setEditingArrow(null);
        },
      });
    } catch (error) {
      setAppDialog({ type: 'alert', title: 'Não foi possível abrir', message: error instanceof Error ? error.message : 'Arquivo inválido.' });
    }
  };

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <button
        className="menu-floating-trigger no-print"
        type="button"
        aria-controls="main-menu-panel"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X size={17} /> : <MenuIcon size={17} />}
        <span>{menuOpen ? 'Fechar' : 'Menu'}</span>
      </button>

      {/* Menu lateral flutuante */}
      <aside id="main-menu-panel" className="app-sidebar no-print" aria-hidden={!menuOpen}>
        <div className="sidebar-brand">
          <div className="app-symbol"><Route size={20} /></div>
          <div className="sidebar-brand-text"><strong>MFV Simulador</strong><span>Fluxo de valor inteligente</span></div>
        </div>

        <div className="sidebar-section-label"><span>Mapa e cenário</span></div>
        <nav className="sidebar-nav">
          <button className={activeKind==='current'?'active current':''} onClick={() => setActiveKind('current')} title="Estado atual">
            <Map size={18} /><span className="sidebar-nav-copy"><strong>Estado atual</strong><small>Base observada</small></span>
          </button>
          <button className={activeKind==='future'?'active future':''} onClick={() => setActiveKind('future')} title="Estado futuro">
            <GitCompareArrows size={18} /><span className="sidebar-nav-copy"><strong>Estado futuro</strong><small>{workspace.futures.length} cenário(s)</small></span>
          </button>
          <button className="demand-nav-button" onClick={() => setDemandOpen(true)} title="Dados de demanda e TAKT">
            <Calculator size={18} /><span className="sidebar-nav-copy"><strong>Demanda e TAKT</strong><small>Premissas da simulação</small></span>
          </button>
        </nav>

        <div className="sidebar-workspace">
          <div className="sidebar-group">
            <LibraryPanel onDragStart={onLibDragStart} accentColor={DEFAULT_THEME_COLOR} />
          </div>

          <div className="sidebar-bottom">
            <button className="sidebar-help-button" onClick={() => setManualOpen(true)} title="Abrir manual de uso"><BookOpen size={17} /><span>Manual de uso</span></button>
            <button className="sidebar-project-toggle" onClick={() => setProjectToolsOpen((value) => !value)} aria-expanded={projectToolsOpen}>
              <span>Ferramentas do projeto</span><div className={`save-state ${saveFailed ? 'error' : ''}`}><i/><span>{saveFailed ? 'Não salvo' : saved ? 'Salvo' : 'Salvando…'}</span></div><ChevronDown size={14}/>
            </button>
            {projectToolsOpen && <div className="sidebar-project-actions">
              <button onClick={applyExcelTemplate} title="Montar o fluxo padrão usado no Excel"><LayoutTemplate size={17} /><span>Modelo base do Excel</span></button>
              <button onClick={exportProjectFile} title="Baixar o projeto completo para backup ou para enviar a outra pessoa"><Save size={17} /><span>Salvar projeto (.json)</span></button>
              <button onClick={() => projectFileInputRef.current?.click()} title="Abrir um projeto salvo em arquivo"><FolderOpen size={17} /><span>Abrir projeto (.json)</span></button>
              <input ref={projectFileInputRef} type="file" accept="application/json,.json" hidden
                onChange={(event) => { void importProjectFile(event.target.files?.[0]); event.target.value = ''; }} />
              <button className="sidebar-export-button" onClick={() => { resetLiveSimulation(); setSelectedId(null); setExportOpen(true); }}><Download size={17} /><span>Imprimir e exportar</span></button>
              <button className="sidebar-clear-button" onClick={requestClearCanvas}>
                <RotateCcw size={17} /><span>Limpar</span>
              </button>
            </div>}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="app-main" style={{ display:'flex', flexDirection:'column' }}>
        <header className="app-header">
          <div className="header-heading">
            <ScenarioPill kind={activeKind} />
            <h1>{activeKind==='current'?'Estado atual':activeFuture.name}</h1>
          </div>
          <div className="simulation-summary">
            <div><span>Demanda/dia</span><strong>{simulation.dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un</strong></div>
            <div><span>TAKT</span><strong>{(simulation.taktTimeSec / 60).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} min</strong></div>
            <div title={simulation.bottleneck ? `Gargalo: ${simulation.bottleneck.label}` : undefined}><span>Capacidade/dia</span><strong>{simulation.bottleneckCapacity ? `${simulation.bottleneckCapacity.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} un` : '—'}</strong></div>
            <div className={!simulation.routeReady || simulation.invalidProcesses.length ? 'summary-warning' : simulation.overloadedProcesses.length ? 'summary-critical' : 'summary-ok'}>
              {!simulation.routeReady || simulation.invalidProcesses.length || simulation.overloadedProcesses.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              <span>{!simulation.rawMaterialEntry
                ? 'Falta matéria-prima'
                : !simulation.finalCustomer
                  ? 'Falta cliente final'
                  : simulation.invalidProcesses.length
                ? `${simulation.invalidProcesses.length} sem T/C`
                : simulation.overloadedProcesses.length
                  ? `${simulation.overloadedProcesses.length} crítico(s)`
                  : simulation.processElements.length ? 'Fluxo atende' : 'Sem processos'}</span>
            </div>
          </div>
          <div className="header-actions">
            {activeKind === 'future' && <button className="future-sync-status" onClick={() => setComparisonOpen(true)} title="Comparar todos os cenários com o Estado atual">
              <BarChart3 size={15}/><span>Comparar</span>
            </button>}
            <label className="live-order-field header" title="Quantidade da ordem de produção a simular. Vazio: fluxo contínuo no ritmo da demanda."><span>Ordem</span>
              <input type="number" min={0} step={1} placeholder="contínuo" value={liveOrderInput} onChange={(event) => setLiveOrderInput(event.target.value)} aria-label="Quantidade da ordem de produção" />
              <small>un</small>
            </label>
            <button className={`live-launch-button ${liveRunning ? 'running' : ''}`} onClick={toggleLiveSimulation} title="Executar o fluxo produtivo no canvas">
              {liveRunning ? <Pause size={16}/> : <Activity size={16}/>}<span>{liveRunning ? 'Pausar' : liveElapsedSec > 0 ? 'Continuar' : 'Simular fluxo'}</span>
            </button>
            <button className="primary-button" onClick={() => { resetLiveSimulation(); setSelectedId(null); setExportOpen(true); }}>
              <Download size={17}/>Exportar
            </button>
          </div>
        </header>

        {(liveRunning || liveElapsedSec > 0) && <div className="live-simulation-bar no-print">
          <div className="live-playback-controls">
            <div className="live-panel-heading">
              <span><Activity size={15}/></span>
              <div><strong>Simulação ao vivo</strong><small>{liveRunning ? 'Fluxo produtivo em execução' : 'Simulação pausada'}</small></div>
            </div>
            <button className="live-play-button" onClick={toggleLiveSimulation} aria-label={liveRunning ? 'Pausar simulação' : 'Continuar simulação'}>
              {liveRunning ? <Pause size={16}/> : <Play size={16}/>}
            </button>
            <button onClick={resetLiveSimulation} aria-label="Reiniciar simulação"><Square size={13}/></button>
            <label><span>Velocidade</span><SiteSelect className="dark" value={String(liveSpeed)} onChange={(value) => setLiveSpeed(Number(value))} ariaLabel="Velocidade da simulação" options={[
              { value: '60', label: '1 min/s' }, { value: '300', label: '5 min/s' }, { value: '1200', label: '20 min/s' },
            ]}/></label>
            <label className="live-order-field" title="Quantidade da ordem de produção. Vazio: fluxo contínuo no ritmo da demanda."><span>Ordem</span>
              <input type="number" min={0} step={1} placeholder="contínuo" value={liveOrderInput} onChange={(event) => setLiveOrderInput(event.target.value)} aria-label="Quantidade da ordem de produção" />
              <small>un</small>
            </label>
          </div>
          <div className="live-metrics">
            <div><span>Tempo simulado</span><strong>{liveClock}</strong></div>
            {liveOrder
              ? <div><span>Ordem de produção</span><strong>{liveOrder.quantity} un</strong></div>
              : <div className={liveFlow.blocked > 0 ? 'attention' : ''}><span>{liveFlow.blocked > 0 ? 'Unidade aguardando' : 'Próxima unidade'}</span><strong style={{ color: nextLeveledSlot?.color }}>{nextLeveledSlot ? `${nextLeveledSlot.code} · ${nextLeveledSlot.packSize} un` : '—'}</strong></div>}
            <div><span>Unidades liberadas</span><strong>{liveLaunched}</strong></div>
            {!liveOrder && <div className={liveFlow.blocked > 0 ? 'attention' : ''}><span>Bloqueadas pelo pull</span><strong>{liveFlow.blocked}</strong></div>}
            <div><span>Unidades concluídas</span><strong>{liveCompleted}</strong></div>
            <div className={liveWip > 0 ? 'attention' : ''}><span>Unidades em processo</span><strong>{liveWip}</strong></div>
            {liveOrder ? <>
              <div className={liveOrder.firstDoneSec !== null && liveOrder.firstDoneSec <= liveElapsedSec ? 'healthy' : ''}><span>1ª unidade pronta</span><strong>{liveOrder.firstDoneSec !== null && liveOrder.firstDoneSec <= liveElapsedSec ? formatWorkTime(liveOrder.firstDoneSec) : '—'}</strong></div>
              <div className={liveOrder.lastDoneSec !== null && liveOrder.lastDoneSec <= liveElapsedSec ? 'healthy' : ''}><span>Última unidade pronta</span><strong>{liveOrder.lastDoneSec !== null && liveOrder.lastDoneSec <= liveElapsedSec ? formatWorkTime(liveOrder.lastDoneSec) : '—'}</strong></div>
              <div className={liveOrder.done ? 'healthy' : ''} title="Inclui a espera pelo lote de expedição"><span>Ordem entregue em</span><strong>{liveOrder.done && liveOrder.deliveredSec !== null ? formatWorkTime(liveOrder.deliveredSec) : 'em andamento'}</strong></div>
            </> : <div className={simulation.overloadedProcesses.length ? 'critical' : 'healthy'}><span>Situação</span><strong>{simulation.overloadedProcesses.length ? `${simulation.overloadedProcesses.length} quebra(m)` : 'Fluxo atende'}</strong></div>}
          </div>
          <div className="live-day-progress" title={`Dia ${liveDay} de ${LIVE_MAX_DAYS}`}><i style={{ width: `${Math.min(100, (liveDaySec / simulatedDaySeconds) * 100)}%` }}/></div>
        </div>}

        {activeKind === 'future' && <div className="scenario-toolbar no-print">
          <div className="scenario-selector">
            <span>Cenário de simulação</span>
            <SiteSelect value={workspace.activeFutureId} onChange={selectFuture} ariaLabel="Cenário de simulação" options={workspace.futures.map((variant) => ({ value: variant.id, label: variant.name }))}/>
            <span className="future-sync-note"><CheckCircle2 size={13}/> recebe alterações do Estado atual</span>
          </div>
          <div className="scenario-actions">
            <button onClick={() => setScenarioCreateOpen(true)}><Plus size={15}/>Novo cenário</button>
            <button onClick={duplicateScenario} title="Duplicar cenário"><Copy size={15}/><span>Duplicar</span></button>
            <button onClick={renameScenario} title="Renomear cenário"><Pencil size={15}/><span>Renomear</span></button>
            <button className="danger" onClick={deleteScenario} title="Excluir cenário"><Trash2 size={15}/><span>Excluir</span></button>
          </div>
        </div>}

        <div ref={leanFloatingRef} className={`lean-floating-control no-print ${activeKind === 'future' ? 'future' : ''} ${(liveRunning || liveElapsedSec > 0) ? 'with-live' : ''} ${simulation.leanWarnings.length ? 'warning' : 'ready'}`}>
          <button className="lean-floating-trigger" onClick={() => setLeanPanelOpen((value) => !value)} aria-expanded={leanPanelOpen}>
            <Route size={15}/><span>Controle Lean</span>
            <b>{leanActionCount}</b><ChevronDown size={14}/>
          </button>
          {leanPanelOpen && <div className="lean-floating-popover">
            <header>
              <div><strong>Controle Lean</strong><span>{simulation.leanWarnings.length ? `${simulation.leanWarnings.length} ponto(s) precisam de atenção` : 'Fluxo configurado'}</span></div>
              <button onClick={() => setLeanPanelOpen(false)} aria-label="Fechar Controle Lean"><X size={15}/></button>
            </header>
            <div className="lean-floating-message" title={simulation.leanWarnings.join(' ')}>
              {simulation.leanWarnings.length
                ? <><AlertTriangle size={15}/><span>{simulation.leanWarnings[0]}{simulation.leanWarnings.length > 1 ? ` +${simulation.leanWarnings.length - 1}` : ''}</span></>
                : <><CheckCircle2 size={15}/><span>Fluxo puxado configurado e limitado.</span></>}
            </div>
            <dl className="lean-floating-facts">
              <div><dt>Marcapasso</dt><dd>{simulation.pacemaker?.label || 'Não definido'}</dd></div>
              <div><dt>Pull</dt><dd>{simulation.pullSystemActive ? `Ativo · WIP ${simulation.pullWipLimit}` : 'Incompleto'}</dd></div>
              <div><dt>Kanban</dt><dd>{simulation.kanbanCardTotal} cartão(ões) · {simulation.kanbanAuthorizedUnits} un</dd></div>
              <div><dt>Heijunka</dt><dd>{simulation.heijunkaBoxes.length && simulation.pacemaker ? `Ativo · ${simulation.leveledSequence.length} slots` : 'Inativo'}</dd></div>
              <div><dt>Pitch</dt><dd>{simulation.pitchTimeSec > 0 ? `${(simulation.pitchTimeSec / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min` : '—'}</dd></div>
              <div><dt>EPEI</dt><dd>{simulation.epeiDays === Infinity ? 'Sem capacidade' : simulation.epeiDays > 0 ? `${simulation.epeiDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dia(s)` : '—'}</dd></div>
            </dl>
            <div className="lean-floating-actions">
              <button className="lean-assistant-button" onClick={() => { setLeanPanelOpen(false); setLeanAssistantOpen(true); }}><BookOpen size={14}/><span>Abrir Assistente Lean</span><b>{leanActionCount}</b></button>
              {activeKind === 'future' && <button className="stress-test-button" onClick={() => { setLeanPanelOpen(false); setStressTestOpen(true); }}><Activity size={14}/><span>Teste de estresse</span></button>}
            </div>
          </div>}
        </div>

        <div className="canvas-floating-tools no-print">
          <label className="theme-color-button" title="Personalizar a cor de todo o MFV">
            <Palette size={16}/><span>Cor</span>
            <input type="color" value={canvas.themeColor} onChange={(event) => applyThemeColor(event.target.value)} aria-label="Cor do MFV" />
            <i style={{ backgroundColor: canvas.themeColor }} />
          </label>
          <div className="zoom-controls">
            <button onClick={() => setZoom(z => Math.max(0.15, z*.85))} title="Diminuir zoom"><ZoomOut size={15}/></button>
            <span>{Math.round(zoom*100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, z*1.15))} title="Aumentar zoom"><ZoomIn size={15}/></button>
            <button onClick={() => { setZoom(1); setPan({x:80,y:80}); }} title="Restaurar visualização"><Minus size={13}/></button>
          </div>
        </div>

        {canvas.elements.every((element) => [FIXED_PLANNING_ID, FIXED_IDENTIFICATION_ID].includes(element.id)) && canvas.arrows.length===0 && (
          <div className="canvas-empty-hint">
            <BookOpen size={32}/>
            <strong>Comece pelo fluxo</strong>
            <p>Arraste elementos da biblioteca à esquerda para montar o MFV.</p>
          </div>
        )}

        <svg ref={svgRef} className="mfv-canvas"
          style={{ flex:1, cursor: dragging?.type==='pan'?'grabbing':'default' }}
          onMouseDown={onSvgMouseDown}
          onWheel={onWheel}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}>
          <defs>
            <pattern id="grid" width={20*zoom} height={20*zoom} patternUnits="userSpaceOnUse"
              x={pan.x%(20*zoom)} y={pan.y%(20*zoom)}>
              <circle cx={1} cy={1} r={0.8} fill="#d5d5db"/>
            </pattern>
          </defs>
          <rect className="canvas-bg" width="100%" height="100%" fill="url(#grid)"/>

          <g data-export-content transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {(alignmentGuides.x !== undefined || alignmentGuides.y !== undefined) && (
              <g data-export-ui pointerEvents="none">
                {alignmentGuides.x !== undefined && <line x1={alignmentGuides.x} y1={guideBounds.minY - 80} x2={alignmentGuides.x} y2={guideBounds.maxY + 140} stroke="#0071e3" strokeWidth={1.2} strokeDasharray="6 4" />}
                {alignmentGuides.y !== undefined && <line x1={guideBounds.minX - 80} y1={alignmentGuides.y} x2={guideBounds.maxX + 140} y2={alignmentGuides.y} stroke="#0071e3" strokeWidth={1.2} strokeDasharray="6 4" />}
              </g>
            )}
            {canvas.arrows.map((arrow) => (
              <ArrowShape key={arrow.id} arrow={arrow} selected={selectedId===arrow.id} />
            ))}
            {canvas.elements.filter((el) => el.kind !== 'timeline').map((el) => (
              <g key={el.id} transform={`translate(${el.x},${el.y})`}
                style={{ cursor: el.kind === 'identification' ? 'pointer' : 'move', userSelect:'none' }}
                onMouseDown={(e) => onElMouseDown(e, el.id)}
                onClick={(e) => {
                  if (el.kind !== 'identification' || dragMovedRef.current) return;
                  e.stopPropagation();
                  openElementEditor(el);
                }}
                onDoubleClick={(e) => { e.stopPropagation(); openElementEditor(el); }}>
                {renderElement(el, selectedId===el.id, () => openElementEditor(el), simulation, canvas.assumptions.availableMinutesPerDay, canvas.themeColor)}
              </g>
            ))}
            {canvas.elements.filter((element) => element.id === selectedId && element.kind === 'resource-zone').map((element) => {
              const size = elementDimensions(element);
              const handles = [
                { corner: 'nw' as const, x: element.x + 2, y: element.y + 12, cursor: 'nwse-resize' },
                { corner: 'ne' as const, x: element.x + size.width - 2, y: element.y + 12, cursor: 'nesw-resize' },
                { corner: 'sw' as const, x: element.x + 2, y: element.y + size.height - 2, cursor: 'nesw-resize' },
                { corner: 'se' as const, x: element.x + size.width - 2, y: element.y + size.height - 2, cursor: 'nwse-resize' },
              ];
              return <g key={`resize-${element.id}`} data-export-ui>
                {handles.map((handle) => <rect key={handle.corner} x={handle.x-5} y={handle.y-5} width={10} height={10} rx={2}
                  fill="white" stroke="#d92d20" strokeWidth={2} style={{ cursor: handle.cursor }}
                  onMouseDown={(event) => onElementResizeMouseDown(event, element, handle.corner)} />)}
              </g>;
            })}
            <g data-export-ui>
              {canvas.arrows.map((arrow) => (
                <ArrowInteractionShape key={`interaction-${arrow.id}`} arrow={arrow}
                  onMouseDown={(event) => onArrowMouseDown(event, arrow)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(arrow.id);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!dragMovedRef.current) setEditingArrow(arrow);
                  }} />
              ))}
              {canvas.arrows.filter((arrow) => arrow.id===selectedId).map((arrow) => (
                <g key={`h-${arrow.id}`}>
                  <circle cx={arrow.x1} cy={arrow.y1} r={8} fill="white" stroke="#0071e3" strokeWidth={2} style={{cursor:'crosshair'}}
                    onMouseDown={(event) => onHandleMouseDown(event, arrow.id, 'start')} />
                  <circle cx={arrow.x2} cy={arrow.y2} r={8} fill="white" stroke="#0071e3" strokeWidth={2} style={{cursor:'crosshair'}}
                    onMouseDown={(event) => onHandleMouseDown(event, arrow.id, 'end')} />
                </g>
              ))}
            </g>
            <LiveFlowOverlay canvas={canvas} simulation={simulation} elapsedSec={liveElapsedSec} orderQuantity={liveOrderQuantity} />
            {automaticTimelinePosition && (
              <g transform={`translate(${automaticTimelinePosition.x},${automaticTimelinePosition.y})`}>
                <TimelineSymbol
                  el={{ id: '__automatic-timeline__', kind: 'timeline', x: 0, y: 0, label: '', data: {} }}
                  selected={false}
                  onEdit={() => undefined}
                  timelineItems={simulation.timelineItems.map((item) => ({ ...item, x: item.x - automaticTimelinePosition.x }))}
                  leadTimeDays={simulation.leadTimeDays}
                  processingTimeMin={simulation.processingTimeMin}
                  accentColor={canvas.themeColor}
                />
              </g>
            )}
          </g>
        </svg>

        {selectedId && (
          <div className="canvas-delete-hint">
            {[FIXED_PLANNING_ID, FIXED_IDENTIFICATION_ID].includes(selectedId)
              ? <>Caixa fixa do cenário · arraste para mover · duplo clique para editar</>
              : <><kbd>Ctrl</kbd> + <kbd>C</kbd>/<kbd>V</kbd> copiar e colar · <kbd>Ctrl</kbd> + <kbd>Z</kbd> desfazer · <kbd>Delete</kbd> remover</>}
          </div>
        )}
        {clipboardNotice && <div className="clipboard-toast"><Copy size={14}/><span>{clipboardNotice}</span></div>}
        {liveReport && !liveRunning && <LiveReportPanel report={liveReport} daySeconds={simulatedDaySeconds} />}
      </main>

      {editingEl && editingEl.kind === 'identification' && (
        <IdentificationEditor el={editingEl}
          onUpdate={(patch) => updateEl(editingEl.id, patch)}
          onClose={() => setEditingEl(null)} />
      )}
      {editingEl && editingEl.kind !== 'identification' && (
        <ElementPopover el={editingEl} processes={simulation.processElements} assumptions={canvas.assumptions}
          onUpdate={(p) => updateEl(editingEl.id, p)}
          onDelete={() => deleteEl(editingEl.id)}
          onClose={() => setEditingEl(null)} />
      )}
      {editingArrow && (
        <ArrowPopover arrow={editingArrow}
          onUpdate={(p) => updateArrow(editingArrow.id, p)}
          onDelete={() => deleteArrow(editingArrow.id)}
          onClose={() => setEditingArrow(null)} />
      )}
      {exportOpen && <ExportModal svgRef={svgRef} name={activeKind==='current'?'Estado_Atual':`Estado_Futuro_${activeFuture.name.replace(/[^a-z0-9]+/gi,'_')}`} onClose={() => setExportOpen(false)} />}
      {demandOpen && <DemandModal assumptions={canvas.assumptions} canvas={canvas}
        planning={canvas.elements.find((element) => element.id === FIXED_PLANNING_ID)!}
        onSave={saveAssumptions}
        onUpdatePlanning={(patch) => updateEl(FIXED_PLANNING_ID, patch)}
        onClose={() => setDemandOpen(false)} />}
      {scenarioCreateOpen && <ScenarioCreateModal onCreate={createScenario} onClose={() => setScenarioCreateOpen(false)} />}
      {comparisonOpen && <ComparisonModal workspace={workspace} onSelect={selectFuture} onClose={() => setComparisonOpen(false)} />}
      {leanAssistantOpen && <LeanAssistantModal advice={leanAdvice} activeKind={activeKind} appliedFixes={appliedLeanFixes}
        onFocus={focusAssistantTarget} onApply={applyAssistantFix} onUndo={undoAssistantFix} onClose={() => setLeanAssistantOpen(false)} />}
      {stressTestOpen && <StressTestModal canvas={canvas} onFocus={(targetId) => {
        setStressTestOpen(false);
        focusAssistantTarget(targetId);
      }} onClose={() => setStressTestOpen(false)} />}
      {manualOpen && <ManualModal onClose={closeManual} />}
      {appDialog && <AppDialog dialog={appDialog} onClose={() => setAppDialog(null)} />}
    </div>
  );
}

function ManualModal({ onClose }: { onClose: () => void }) {
  const [activeStep, setActiveStep] = useState(0);
  const steps = [
    {
      title: 'Comece pelo Estado Atual', icon: <Map size={18}/>, summary: 'Registre o processo como ele realmente acontece hoje, sem antecipar melhorias.',
      bullets: [
        'Abra Menu e selecione Estado atual. Tudo que for criado nele será levado automaticamente aos cenários futuros.',
        'Use Modelo base do Excel se quiser começar com a estrutura padrão já montada.',
        'Mantenha Matéria-prima como início do fluxo e Cliente final como término.',
      ],
      tip: 'O Estado Atual é a fotografia da realidade. Faça as experiências somente no Estado Futuro.',
    },
    {
      title: 'Informe demanda e TAKT', icon: <Calculator size={18}/>, summary: 'Defina o ritmo exigido pelo cliente antes de analisar capacidade.',
      bullets: [
        'Clique em Demanda e TAKT dentro do Menu ou na caixa fixa Controle da Produção.',
        'Informe demanda mensal, dias úteis e minutos disponíveis por dia.',
        'Cadastre o mix de produtos e a quantidade por embalagem para calcular pitch e Heijunka.',
      ],
      tip: 'TAKT é o ritmo necessário para atender o cliente. Ele não é o tempo de ciclo da máquina.',
    },
    {
      title: 'Monte o mapa pela biblioteca', icon: <LayoutTemplate size={18}/>, summary: 'Arraste símbolos para o quadro e monte o fluxo na ordem real de produção.',
      bullets: [
        'Escolha uma categoria ou pesquise o símbolo pelo nome.',
        'Arraste processos, estoques, logística, Kanban, informações e setas para o canvas.',
        'A linha do tempo é criada automaticamente seguindo processos e estoques posicionados no mapa.',
      ],
      tip: 'As linhas de alinhamento aparecem durante o movimento para manter o MFV simétrico.',
    },
    {
      title: 'Edite e organize os elementos', icon: <Pencil size={18}/>, summary: 'Cada símbolo possui dados próprios, posição, tamanho e regras visuais.',
      bullets: [
        'Dê duplo clique em uma caixa para editar nome, tempos, quantidade, disponibilidade, qualidade e dimensões.',
        'Na simulação ao vivo, informe a quantidade da Ordem de produção para simular uma ordem: todo o insumo entra de uma vez e o painel mostra quando a primeira e a última unidade ficam prontas e o tempo total. Vazio, a simulação segue o ritmo da demanda.',
        'Nos processos, Peças por ciclo indica quantas peças um ciclo produz de uma vez (ex.: masseira que faz massa para 5 pães em 60 s): a capacidade usa o tempo por peça e a simulação processa o grupo junto. O campo Lote de produção define o fluxo: 1 é peça a peça; maior que 1 é fabricação por lotes: a peça entra em produção assim que chega, mas o lote só segue ao próximo processo quando todas as suas peças ficam prontas.',
        'Arraste o elemento para mover. Nas setas, arraste o corpo para mover e as pontas para redimensionar ou conectar.',
        'Selecione um elemento e use Delete para excluir. A caixa de Controle da Produção é fixa e não pode ser removida.',
      ],
      tip: 'Estoques permanecem amarelos, setas permanecem pretas e a Área de intervenção permanece vermelha.',
    },
    {
      title: 'Crie o Estado Futuro', icon: <GitCompareArrows size={18}/>, summary: 'Teste melhorias sem alterar o registro do processo atual.',
      bullets: [
        'Tudo que for adicionado ou atualizado no Estado Atual avança para o Futuro; alterações futuras nunca voltam.',
        'Crie vários cenários para testar demanda, setup, disponibilidade, qualidade ou recursos diferentes.',
        'Use Comparar para enxergar capacidade, WIP, atravessamento, qualidade, carga e operadores contra o Atual.',
      ],
      tip: 'Uma alteração manual no Futuro vira uma hipótese local e é preservada nas próximas sincronizações.',
    },
    {
      title: 'Execute as simulações', icon: <Activity size={18}/>, summary: 'Veja o fluxo acontecer e descubra onde ele deixa de atender à demanda.',
      bullets: [
        'Simular fluxo anima embalagens, filas, WIP, bloqueios e carregamento do transporte durante um dia.',
        'Teste de estresse simula vários dias, demanda, turnos, intervalos, falhas, fornecedor e transporte.',
        'Leia o nível de serviço, atraso, WIP máximo, dia da ruptura e processo restritivo.',
      ],
      tip: 'O teste de estresse não altera o cenário; ele aplica condições temporárias somente ao cálculo.',
    },
    {
      title: 'Use o Assistente Lean', icon: <BookOpen size={18}/>, summary: 'Receba explicações e correções guiadas para o Estado Futuro.',
      bullets: [
        'O assistente verifica gargalos, fluxo contínuo, sistema puxado, marcapasso, programação, Kanban e Heijunka.',
        'Abra uma recomendação para entender por que o problema existe, o que será alterado e o efeito esperado.',
        'No Estado Futuro, aplique a correção automática e use Desfazer se quiser voltar.',
      ],
      tip: 'As recomendações são hipóteses para simulação e devem ser confirmadas no gemba antes da implantação.',
    },
    {
      title: 'Imprima somente o MFV', icon: <Download size={18}/>, summary: 'Exporte o mapa completo sem sidebar, controles ou espaço vazio do canvas.',
      bullets: [
        'Clique em Imprimir e exportar dentro do Menu ou em Exportar no cabeçalho.',
        'Escolha A1, A2, A3 ou A4. A orientação e a escala são calculadas automaticamente.',
        'Use PDF para impressão, JPEG para apresentação ou SVG para manter o desenho vetorial.',
      ],
      tip: 'Antes de exportar, organize o MFV no canvas. O arquivo será recortado somente na área ocupada pelo mapa.',
    },
  ];
  const step = steps[activeStep];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return createPortal(
    <div className="editor-overlay manual-overlay" role="dialog" aria-modal="true" aria-labelledby="manual-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar manual" />
      <section className="editor-window manual-modal">
        <header>
          <div><span className="manual-eyebrow">Guia rápido</span><h2 id="manual-title">Como usar o MFV Simulador</h2><p>Do primeiro processo ao cenário futuro, em oito passos.</p></div>
          <button className="icon-button" onClick={onClose}><X size={20}/></button>
        </header>
        <div className="manual-layout">
          <nav className="manual-navigation" aria-label="Etapas do manual">
            {steps.map((item, index) => <button key={item.title} className={activeStep === index ? 'active' : ''} onClick={() => setActiveStep(index)}>
              <i>{index + 1}</i><span>{item.title}</span>
            </button>)}
          </nav>
          <article className="manual-content">
            <div className="manual-step-icon">{step.icon}</div>
            <span className="manual-step-count">Passo {activeStep + 1} de {steps.length}</span>
            <h3>{step.title}</h3>
            <p className="manual-summary">{step.summary}</p>
            <ol>{step.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ol>
            <div className="manual-tip"><Sparkles size={15}/><div><strong>Dica prática</strong><p>{step.tip}</p></div></div>
          </article>
        </div>
        <footer className="manual-footer">
          <div className="manual-progress"><i style={{ width: `${(activeStep + 1) / steps.length * 100}%` }}/></div>
          <button className="quiet-button" disabled={activeStep === 0} onClick={() => setActiveStep((current) => Math.max(0, current - 1))}>Anterior</button>
          {activeStep < steps.length - 1
            ? <button className="primary-button" onClick={() => setActiveStep((current) => Math.min(steps.length - 1, current + 1))}>Próximo</button>
            : <button className="primary-button" onClick={onClose}>Entendi, começar</button>}
        </footer>
      </section>
    </div>, document.body,
  );
}

function StressTestModal({ canvas, onFocus, onClose }: {
  canvas: CanvasState;
  onFocus: (targetId: string) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<StressTestSettings>({
    days: 5,
    demandPercent: 120,
    cycleVariationPercent: 15,
    extraDowntimePercent: 5,
    shiftsPerDay: 1,
    minutesPerShift: Math.round(canvas.assumptions.availableMinutesPerDay),
    breakMinutesPerShift: 0,
    failureProcessId: '',
    failureStartMinute: 120,
    failureDurationMinutes: 0,
    supplierDelayMinutes: 0,
    transportDelayMinutes: 0,
  });
  const result = runStressTest(canvas.elements, canvas.assumptions, settings, canvas.arrows);
  const update = <Key extends keyof StressTestSettings>(key: Key, value: StressTestSettings[Key]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };
  const flowOrder = materialFlowOrder(canvas.elements, canvas.arrows);
  const processOptions = flowOrder.processes;
  const format = (value: number, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
  const statusLabel = result.status === 'rupture' ? 'Ruptura' : result.status === 'attention' ? 'Atenção' : result.status === 'stable' ? 'Estável' : 'Incompleto';
  const maxDaily = Math.max(1, ...result.dayResults.map((day) => Math.max(day.required, day.delivered)));

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="stress-test-title">
      <button className="editor-backdrop" onClick={onClose} aria-label="Fechar teste de estresse" />
      <section className="editor-window stress-test-modal">
        <header>
          <div><h2 id="stress-test-title">Teste de estresse produtivo</h2><p>Simule vários dias sem alterar os dados deste Estado Futuro.</p>
            <p className="stress-flow-order">{flowOrder.source === 'setas'
              ? `Ordem do fluxo pelas setas: ${processOptions.map((process) => process.label || 'Processo').join(' → ')}`
              : 'Ordem do fluxo pela posição no mapa. Ligue os processos com setas de material para definir a sequência.'}</p></div>
          <button className="icon-button" onClick={onClose}><X size={20}/></button>
        </header>

        <div className="stress-settings">
          <label><span>Duração</span><strong>{settings.days} dia(s)</strong><input type="range" min={1} max={30} step={1} value={settings.days} onChange={(event) => update('days', Number(event.target.value))} /></label>
          <label><span>Pressão de demanda</span><strong>{settings.demandPercent}%</strong><input type="range" min={50} max={250} step={5} value={settings.demandPercent} onChange={(event) => update('demandPercent', Number(event.target.value))} /></label>
          <label><span>Variação dos ciclos</span><strong>{settings.cycleVariationPercent}%</strong><input type="range" min={0} max={60} step={5} value={settings.cycleVariationPercent} onChange={(event) => update('cycleVariationPercent', Number(event.target.value))} /></label>
          <label><span>Paradas adicionais</span><strong>{settings.extraDowntimePercent}%</strong><input type="range" min={0} max={40} step={1} value={settings.extraDowntimePercent} onChange={(event) => update('extraDowntimePercent', Number(event.target.value))} /></label>
        </div>
        <details className="stress-advanced" open>
          <summary><div><strong>Calendário, falhas e logística</strong><span>Condições adicionais aplicadas em todos os dias do teste</span></div><b>Configurar</b></summary>
          <div className="stress-advanced-grid">
            <label><span>Turnos por dia</span><SiteSelect value={String(settings.shiftsPerDay)} onChange={(value) => update('shiftsPerDay', Number(value))} ariaLabel="Turnos por dia" options={[{ value: '1', label: '1 turno' }, { value: '2', label: '2 turnos' }, { value: '3', label: '3 turnos' }]}/></label>
            <label><span>Minutos por turno</span><input type="number" min={60} max={720} step={15} value={settings.minutesPerShift} onChange={(event) => update('minutesPerShift', Number(event.target.value))} /></label>
            <label><span>Intervalo por turno</span><div><input type="number" min={0} max={240} step={5} value={settings.breakMinutesPerShift} onChange={(event) => update('breakMinutesPerShift', Number(event.target.value))} /><small>min</small></div></label>
            <label><span>Atraso do fornecedor</span><div><input type="number" min={0} max={1440} step={15} value={settings.supplierDelayMinutes} onChange={(event) => update('supplierDelayMinutes', Number(event.target.value))} /><small>min/dia</small></div></label>
            <label><span>Tempo de transporte</span><div><input type="number" min={0} max={2880} step={15} value={settings.transportDelayMinutes} onChange={(event) => update('transportDelayMinutes', Number(event.target.value))} /><small>min</small></div></label>
            <label className="stress-failure-process"><span>Falha específica em</span><SiteSelect value={settings.failureProcessId} onChange={(value) => update('failureProcessId', value)} ariaLabel="Processo com falha específica" options={[{ value: '', label: 'Nenhuma falha direcionada' }, ...processOptions.map((process) => ({ value: process.id, label: process.label }))]}/></label>
            <label><span>Início da falha</span><div><input type="number" min={0} max={2160} step={15} disabled={!settings.failureProcessId} value={settings.failureStartMinute} onChange={(event) => update('failureStartMinute', Number(event.target.value))} /><small>min do dia</small></div></label>
            <label><span>Duração da falha</span><div><input type="number" min={0} max={1440} step={15} disabled={!settings.failureProcessId} value={settings.failureDurationMinutes} onChange={(event) => update('failureDurationMinutes', Number(event.target.value))} /><small>min/dia</small></div></label>
          </div>
        </details>

        <div className="stress-test-body">
          <section className={`stress-result-hero ${result.status}`}>
            <div><span className="stress-status">{statusLabel}</span><h3>{result.headline}</h3><p>{result.explanation}</p></div>
            {result.constraintId && <button onClick={() => onFocus(result.constraintId!)}><Route size={14}/> Ver {result.constraintLabel} no MFV</button>}
          </section>

          <div className="stress-kpis">
            <div><span>Nível de serviço</span><strong>{format(result.serviceLevelPercent)}%</strong></div>
            <div><span>Demanda testada</span><strong>{format(result.requestedUnits)} un</strong></div>
            <div className={result.backlogUnits > 0.1 ? 'critical' : ''}><span>Atraso final</span><strong>{format(result.backlogUnits)} un</strong></div>
            <div><span>WIP máximo</span><strong>{format(result.maxWip)} un</strong></div>
            <div><span>Restrição</span><strong>{result.constraintLabel}</strong></div>
          </div>

          <div className="stress-recommendation"><Sparkles size={16}/><div><strong>O que fazer primeiro</strong><p>{result.recommendation}</p></div></div>

          {!!result.dayResults.length && <section className="stress-days">
            <div className="stress-section-title"><strong>Comportamento por dia</strong><span>Meta × entrega acumulada</span></div>
            <div className="stress-day-chart">
              {result.dayResults.map((day) => <div className="stress-day" key={day.day} title={`Dia ${day.day}: ${format(day.delivered)} entregues de ${format(day.required)}`}>
                <div className="stress-day-bars"><i className="required" style={{ height: `${day.required / maxDaily * 100}%` }}/><i className="delivered" style={{ height: `${day.delivered / maxDaily * 100}%` }}/></div>
                <b>D{day.day}</b><small className={day.backlog > 0.1 ? 'late' : ''}>{day.backlog > 0.1 ? `-${format(day.backlog)}` : 'OK'}</small>
              </div>)}
            </div>
          </section>}

          {!!result.processResults.length && <section className="stress-processes">
            <div className="stress-section-title"><strong>Leitura por processo</strong><span>Onde o fluxo acumula, espera ou bloqueia</span></div>
            <div className="stress-table-wrap"><table><thead><tr><th>Processo</th><th>Utilização</th><th>Maior fila</th><th>Sem material</th><th>Aguardando lote</th><th>Bloqueado</th><th>Intervalos</th><th>Falha</th><th>Outras paradas</th></tr></thead><tbody>
              {result.processResults.map((process) => <tr key={process.id} className={process.id === result.constraintId ? 'constraint' : ''} onClick={() => onFocus(process.id)}>
                <td><strong>{process.label}</strong>{process.id === result.constraintId && <span>restrição</span>}</td>
                <td>{format(process.utilizationPercent)}%</td><td>{format(process.maxQueue)} un</td>
                <td>{format(process.starvationMinutes, 0)} min</td><td>{process.batchMode ? `${format(process.batchWaitMinutes, 0)} min` : '—'}</td><td>{format(process.blockedMinutes, 0)} min</td><td>{format(process.breakMinutes, 0)} min</td><td>{format(process.failureMinutes, 0)} min</td><td>{format(process.downtimeMinutes, 0)} min</td>
              </tr>)}
            </tbody></table></div>
          </section>}
        </div>
      </section>
    </div>
  );
}

// ─── Modal exportação ─────────────────────────────────────────────────────────

function ExportModal({ svgRef, name, onClose }: { svgRef: React.RefObject<SVGSVGElement>; name: string; onClose: () => void }) {
  const [loading, setLoading] = useState<string|null>(null);
  const [paperSize, setPaperSize] = useState<PaperSize>('a3');
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key==='Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const run = async (fmt: 'pdf'|'jpeg'|'svg') => {
    const svg = svgRef.current; if (!svg) return;
    setLoading(fmt);
    setError(null);
    try {
      const filename = `MFV_${name}`;
      if (fmt === 'pdf') await exportPDF(svg, filename, paperSize);
      if (fmt === 'jpeg') await exportJPEG(svg, filename);
      if (fmt === 'svg') exportSVG(svg, filename);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Não foi possível exportar o MFV.');
    } finally {
      setLoading(null);
    }
  };

  const formats = [
    { fmt:'pdf' as const, icon:<FileText size={20}/>, label:'PDF para impressão', desc:`${paperSize.toUpperCase()} · orientação e escala automáticas` },
    { fmt:'jpeg' as const, icon:<FileImage size={20}/>, label:'JPEG', desc:'Imagem recortada somente no MFV' },
    { fmt:'svg' as const, icon:<ImageDown size={20}/>, label:'SVG', desc:'Vetorial recortado somente no MFV' },
  ];

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true">
      <button className="editor-backdrop" onClick={onClose} />
      <section className="editor-window export-modal">
        <header>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <Download size={20}/>
            <div><h2 style={{margin:'0 0 2px'}}>Imprimir e exportar MFV</h2><p style={{margin:0,color:'#8e8e93',fontSize:11}}>Somente a área ocupada pelo mapa será exportada.</p></div>
          </div>
          <button className="icon-button" onClick={onClose}><X size={20}/></button>
        </header>

        <div className="paper-size-picker">
          <span>Tamanho da folha</span>
          <div>
            {(['a1','a2','a3','a4'] as PaperSize[]).map((size) => (
              <button key={size} className={paperSize === size ? 'active' : ''} onClick={() => setPaperSize(size)} disabled={!!loading}>
                {size.toUpperCase()}
              </button>
            ))}
          </div>
          <small>A orientação será definida automaticamente conforme o formato do MFV.</small>
        </div>
        <div className="export-options">
          {formats.map(({fmt,icon,label,desc}) => (
            <button key={fmt} className={`export-option ${loading===fmt?'loading':''}`} onClick={() => run(fmt)} disabled={!!loading}>
              <div className="export-icon">{loading===fmt?<Loader2 size={20} className="spin"/>:icon}</div>
              <div><strong>{label}</strong><span>{desc}</span></div>
            </button>
          ))}
          {error && <p className="export-error">{error}</p>}
        </div>
      </section>
    </div>
  );
}
