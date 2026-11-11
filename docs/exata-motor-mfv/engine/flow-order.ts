import { LIBRARY, type CanvasArrow, type CanvasElement } from './canvas-types.ts';

/**
 * Setas que levam material no sentido em que foram desenhadas. As setas retas genéricas também
 * contam: na prática são usadas para ligar processos, estoques e expedição.
 */
const FORWARD_MATERIAL_ARROWS: CanvasArrow['kind'][] = [
  'arrow-push', 'arrow-physical', 'arrow-shipment',
  'arrow-straight', 'arrow-info-manual-straight', 'arrow-info-electronic-straight', 'line-straight',
];
/** A seta puxada vai do cliente interno ao fornecedor interno: o material segue no sentido contrário. */
const REVERSE_MATERIAL_ARROWS: CanvasArrow['kind'][] = ['arrow-pull'];
const PROCESS_KINDS = ['process', 'shared-process'];
/** Elementos de informação e anotação: setas que chegam ou saem deles nunca são fluxo de material. */
const NON_FLOW_KINDS = [
  'planning', 'identification', 'note', 'legend', 'timeline', 'data-box', 'kaizen', 'operator', 'intervention',
  'production-schedule', 'heijunka', 'kanban-board', 'sequencing-box', 'kanban-production', 'kanban-withdrawal',
];
/** Margem, em px do mapa, para uma ponta solta de seta contar como ligada ao elemento sob ela. */
const LOOSE_END_MARGIN = 24;

function boxOf(element: CanvasElement) {
  const item = LIBRARY.find((candidate) => candidate.kind === element.kind);
  const width = Math.min(1200, Math.max(30, Number(element.data.width) || item?.w || 120));
  const height = Math.min(800, Math.max(30, Number(element.data.height) || item?.h || 80));
  return { left: element.x, top: element.y, right: element.x + width, bottom: element.y + height };
}

/** Elemento sob um ponto do mapa (o menor, quando há sobreposição), ou undefined. */
function elementAt(elements: CanvasElement[], x: number, y: number) {
  let best: { element: CanvasElement; area: number } | undefined;
  elements.forEach((element) => {
    if (NON_FLOW_KINDS.includes(element.kind) || element.kind.startsWith('arrow') || element.kind.startsWith('line')) return;
    const box = boxOf(element);
    if (x < box.left - LOOSE_END_MARGIN || x > box.right + LOOSE_END_MARGIN || y < box.top - LOOSE_END_MARGIN || y > box.bottom + LOOSE_END_MARGIN) return;
    const area = (box.right - box.left) * (box.bottom - box.top);
    if (!best || area < best.area) best = { element, area };
  });
  return best?.element;
}

/**
 * Setas desenhadas com a ponta solta sobre um elemento (sem âncora gravada) passam a contar como
 * ligadas a ele, para o fluxo seguir o que está desenhado.
 */
export function resolveLooseArrowEnds(elements: CanvasElement[], arrows: CanvasArrow[]): CanvasArrow[] {
  return arrows.map((arrow) => {
    if (arrow.startAnchor?.elementId && arrow.endAnchor?.elementId) return arrow;
    const start = arrow.startAnchor?.elementId ? undefined : elementAt(elements, arrow.x1, arrow.y1);
    const end = arrow.endAnchor?.elementId ? undefined : elementAt(elements, arrow.x2, arrow.y2);
    if (!start && !end) return arrow;
    return {
      ...arrow,
      startAnchor: start ? { elementId: start.id, x: 0, y: 0 } : arrow.startAnchor,
      endAnchor: end ? { elementId: end.id, x: 0, y: 0 } : arrow.endAnchor,
    };
  });
}

export interface MaterialFlowOrder {
  /** Processos na ordem do fluxo de material. */
  processes: CanvasElement[];
  /** Elementos ligados por setas entre cada processo e o seguinte, indexados pelo processo de origem. */
  between: Map<string, CanvasElement[]>;
  /** 'setas' quando todos os processos estão ligados por setas de material; senão a posição completa a ordem. */
  source: 'setas' | 'posicao';
}

function byPosition(left: CanvasElement, right: CanvasElement) {
  return left.x - right.x || left.y - right.y;
}

function materialAdjacency(elements: CanvasElement[], arrows: CanvasArrow[]) {
  const ids = new Set(elements.filter((element) => !NON_FLOW_KINDS.includes(element.kind)).map((element) => element.id));
  const adjacency = new Map<string, string[]>();
  resolveLooseArrowEnds(elements, arrows).forEach((arrow) => {
    const start = arrow.startAnchor?.elementId;
    const end = arrow.endAnchor?.elementId;
    if (!start || !end || start === end || !ids.has(start) || !ids.has(end)) return;
    const forward = FORWARD_MATERIAL_ARROWS.includes(arrow.kind);
    if (!forward && !REVERSE_MATERIAL_ARROWS.includes(arrow.kind)) return;
    const [from, to] = forward ? [start, end] : [end, start];
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  });
  return adjacency;
}

/**
 * Ordena os processos pelo fluxo de material desenhado com setas. Processos sem seta
 * (ou mapas antigos, sem nenhuma) mantêm a ordem pela posição horizontal.
 */
export function materialFlowOrder(elements: CanvasElement[], arrows: CanvasArrow[] = []): MaterialFlowOrder {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const processes = elements.filter((element) => PROCESS_KINDS.includes(element.kind)).sort(byPosition);
  const adjacency = materialAdjacency(elements, arrows);

  // Do processo, segue as setas por estoques, transportes etc. até chegar ao próximo processo.
  const successors = new Map<string, Map<string, CanvasElement[]>>();
  processes.forEach((process) => {
    const reached = new Map<string, CanvasElement[]>();
    const parent = new Map<string, string>();
    const queue = [process.id];
    const visited = new Set(queue);
    while (queue.length) {
      const current = queue.shift()!;
      (adjacency.get(current) ?? []).forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        parent.set(next, current);
        const element = byId.get(next);
        if (element && PROCESS_KINDS.includes(element.kind)) {
          const path: CanvasElement[] = [];
          for (let step = parent.get(next); step && step !== process.id; step = parent.get(step)) {
            const intermediate = byId.get(step);
            if (intermediate) path.unshift(intermediate);
          }
          reached.set(next, path);
        } else queue.push(next);
      });
    }
    successors.set(process.id, reached);
  });

  const incoming = new Map(processes.map((process) => [process.id, 0]));
  successors.forEach((reached) => reached.forEach((_, id) => incoming.set(id, (incoming.get(id) ?? 0) + 1)));
  const connected = new Set<string>();
  successors.forEach((reached, id) => {
    if (reached.size) connected.add(id);
    reached.forEach((_, next) => connected.add(next));
  });

  const ordered: CanvasElement[] = [];
  const remaining = new Set(processes.map((process) => process.id));
  while (remaining.size) {
    // Entre os processos liberados, o mais à esquerda vai primeiro; os ligados por setas têm prioridade
    // sobre os soltos (que ficam para o fim, na ordem da posição); num ciclo (retrabalho), a posição desempata.
    const candidates = processes.filter((process) => remaining.has(process.id));
    const released = candidates.filter((process) => (incoming.get(process.id) ?? 0) <= 0);
    const next = released.find((process) => connected.has(process.id)) ?? released[0] ?? candidates[0];
    ordered.push(next);
    remaining.delete(next.id);
    successors.get(next.id)?.forEach((_, id) => incoming.set(id, (incoming.get(id) ?? 0) - 1));
  }

  const between = new Map<string, CanvasElement[]>();
  ordered.slice(0, -1).forEach((process, index) => {
    const path = successors.get(process.id)?.get(ordered[index + 1].id);
    if (path) between.set(process.id, path);
  });

  const source = processes.length > 1 && processes.every((process) => connected.has(process.id)) ? 'setas' : 'posicao';
  return { processes: ordered, between, source };
}
