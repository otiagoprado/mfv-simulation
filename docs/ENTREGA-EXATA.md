# Motor de simulação MFV → Exata: pacote de entrega

Este pacote contém o **motor de simulação** do Simulador MFV (sem interface), os testes automatizados e as
instruções para integrá-lo à Exata. O código completo (com a interface React) está em
<https://github.com/otiagoprado/mfv-simulation> (branch `main`); a versão publicada roda em
<https://otiagoprado.github.io/mfv-simulation/>.

## 1. O que está no pacote

```
engine/
  canvas-types.ts   tipos do cenário (elementos, setas, premissas) e biblioteca de tipos de elemento
  numbers.ts        utilitários numéricos (percentuais com 0 válido)
  batch.ts          lote de produção, peças por ciclo, atraso de lote no lead time
  flow-order.ts     ordem do fluxo de material pelas setas (fallback: posição no mapa)
  flow-engine.ts    takt, carga, capacidade, kanban, lead time e SIMULAÇÃO AO VIVO (peça a peça)
  stress-test.ts    teste de estresse (simulação por minuto, vários dias, falhas, variação de ciclo)
  live-report.ts    relatório da simulação (indicadores, composição do tempo, carga por processo, séries)
tests/              testes com o executor nativo do Node (node --test)
```

Dependências: nenhuma. É TypeScript puro, sem React, sem DOM. Os imports internos usam extensão `.ts`
explícita para rodar direto no Node 22+ (`node --test --test-isolation=none tests/*.test.mjs`).

## 2. Modelo de dados (o que o motor recebe)

Um cenário é um `CanvasState`:

```ts
interface CanvasState {
  elements: CanvasElement[];   // processos, estoques, matéria-prima, expedição, cliente...
  arrows: CanvasArrow[];       // setas; as de material definem a ordem do fluxo
  assumptions: ScenarioAssumptions; // demanda mensal, dias úteis, minutos/dia, mix de produtos
  themeColor: string;
}

interface CanvasElement {
  id: string; kind: ElementKind; x: number; y: number; label: string;
  data: Record<string, unknown>;
}
```

Campos de `data` de um **processo** (`kind: 'process'`), todos numéricos:

| campo        | significado                                                         | padrão |
|--------------|---------------------------------------------------------------------|--------|
| `tc`         | tempo de ciclo, em segundos                                         | 0      |
| `pecasCiclo` | peças produzidas juntas em um ciclo (ex.: masseira para 5 pães)     | 1      |
| `setup`      | setup / troca, em minutos, no início de cada lote                   | 0      |
| `lote`       | lote de produção: 1 = peça a peça; >1 = produção em lotes (regra de SAÍDA: a peça entra em produção assim que chega, e o lote inteiro só segue quando a última fica pronta) | 1 |
| `op`         | operadores (informativo)                                            | 1      |
| `recurso`    | recursos paralelos                                                  | 1      |
| `disp`       | disponibilidade / OEE, em %                                         | 100    |
| `qualidade`  | qualidade na saída, em %                                            | 100    |

Outros elementos relevantes: `raw-material` (entrada do fluxo), `inventory`/`supermarket`/`fifo`/`buffer`
(estoques, com `qty`), `shipping-point` (expedição, com `lote` = lote de expedição), `customer` (fim do fluxo).

Para a Exata, estes dados vêm do **roteiro de fabricação** e da **OP**: cada operação do roteiro vira um
processo (nesta ordem, ligado por setas `arrow-push`), a quantidade da OP vira a ordem de produção da
simulação. Ver o conversor sugerido na seção 5.

## 3. API do motor (três chamadas)

```ts
import { calculateCanvasSimulation, calculateLiveFlow } from './engine/flow-engine.ts';
import { buildLiveReport } from './engine/live-report.ts';
import { runStressTest } from './engine/stress-test.ts';

// 1) Cálculo estático do cenário: takt, carga por processo, capacidade, gargalo, lead time.
const simulation = calculateCanvasSimulation(canvas);
simulation.taktTimeSec;            // takt em segundos
simulation.processMetrics;         // por processo: effectiveCycleSec, loadPercent, capacityPerDay, batch...
simulation.bottleneck;             // elemento gargalo
simulation.leadTimeDays;           // lead time total em dias

// 2) Simulação ao vivo em um instante (segundos simulados). Chame a cada quadro/tick.
//    Sem orderQuantity: fluxo contínuo no ritmo da demanda. Com orderQuantity: ordem de produção,
//    todo o insumo disponível no instante zero.
const flow = calculateLiveFlow(simulation, canvas.assumptions, elapsedSec, { orderQuantity: 200 });
flow.units;        // onde está cada unidade: trânsito, fila, produção, espera do lote, expedição
flow.stations;     // por processo: waiting, processing, holding
flow.completed;    // unidades entregues
flow.order;        // { quantity, firstDoneSec, lastDoneSec, deliveredSec, done } quando é ordem
flow.timeline;     // linha do tempo completa [processo][unidade]: arrival/start/finish/depart

// 3) Relatório (indicadores e gráficos) para um instante, normalmente ao pausar ou concluir.
const report = buildLiveReport(flow, simulation, elapsedSec);
report.avgPerUnitSec;      // tempo médio por unidade
report.firstDoneSec;       // 1ª unidade pronta (saída do último processo)
report.lastDoneSec;        // última unidade pronta
report.deliveredSec;       // ordem entregue (inclui lote de expedição)
report.avgLeadTimeSec;     // atravessamento médio
report.composition;        // produção / fila / espera do lote / movimentação (média por unidade)
report.processes;          // por processo: utilização, filas médias, maior fila, espera até a 1ª peça
report.bottleneckId;

// Extra: teste de estresse (vários dias, falhas, variação de ciclo).
const stress = runStressTest(canvas.elements, canvas.assumptions, settings, canvas.arrows);
```

Regras implementadas no motor (confirmadas com o cliente):
- Lote de produção é regra de saída, não de entrada.
- Peças por ciclo: o ciclo espera encher e produz todas juntas; no primeiro processo, alimentado pela
  matéria-prima, o ciclo puxa todo o insumo de uma vez.
- Ordem de produção: todo o insumo entra no instante zero; o último ciclo, o último lote e o último lote de
  expedição seguem mesmo incompletos.
- Lote de expedição: as unidades prontas ficam na expedição até completar o lote.
- A simulação contínua atravessa até 10 dias úteis (`LIVE_MAX_DAYS`); o trânsito entre processos é
  `LIVE_TRANSIT_SEC` (60 s).

## 4. Como levar para a Exata

Opção recomendada: **pacote npm interno** `@exata/mfv-engine`.

1. Criar o repositório na organização da Exata (ex.: `exataerp/mfv-engine`) com a pasta `engine/` como
   `src/`, os testes e um `package.json` mínimo:
   ```json
   { "name": "@exata/mfv-engine", "version": "0.1.0", "type": "module",
     "main": "dist/index.js", "types": "dist/index.d.ts",
     "scripts": { "test": "node --test --test-isolation=none tests/*.test.mjs", "build": "tsc -p tsconfig.json" } }
   ```
   Um `src/index.ts` reexportando `flow-engine`, `live-report`, `stress-test`, `batch`, `flow-order`,
   `canvas-types`. Para compilar com `tsc`, remover a extensão `.ts` dos imports ou usar
   `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` (TypeScript 5.7+).
2. CI: `npm test` + `npm run build` em cada push (o repositório original tem o workflow pronto em
   `.github/workflows/ci.yml`).
3. No ERP, instalar o pacote e chamar as três funções da seção 3. O motor é síncrono e rápido
   (ordem de 200 peças × 8 processos calcula em poucos milissegundos); para animar, chame
   `calculateLiveFlow` em `requestAnimationFrame` avançando `elapsedSec` pela velocidade escolhida.

Se o front da Exata for React, os componentes de interface do repositório original também podem ser
reaproveitados: `LiveReport.tsx` (relatório com gráficos SVG) e o `LiveFlowOverlay` em `App.tsx`
(animação das peças). Se não for React, usar só o motor e desenhar com a tecnologia do ERP, ou embutir o
simulador como micro-frontend em uma rota, passando o cenário por `postMessage`.

## 5. Conversor roteiro + OP → cenário (a escrever na integração)

```ts
function cenarioDeRoteiro(roteiro: OperacaoRoteiro[], op: { quantidade: number }, premissas: ScenarioAssumptions): CanvasState {
  const elements: CanvasElement[] = [
    { id: 'mp', kind: 'raw-material', x: 0, y: 300, label: 'Matéria-prima', data: { qty: op.quantidade } },
    ...roteiro.map((operacao, index) => ({
      id: `op-${operacao.codigo}`, kind: 'process' as const, x: 250 + index * 250, y: 250, label: operacao.descricao,
      data: { tc: operacao.tempoCicloSeg, setup: operacao.setupMin, lote: operacao.loteProducao ?? 1,
              pecasCiclo: operacao.pecasPorCiclo ?? 1, recurso: operacao.recursos ?? 1, disp: operacao.disponibilidade ?? 100, qualidade: 100 },
    })),
    { id: 'exp', kind: 'shipping-point', x: 250 + roteiro.length * 250, y: 275, label: 'Expedição', data: { lote: op.loteExpedicao ?? 1 } },
    { id: 'cliente', kind: 'customer', x: 250 + roteiro.length * 250, y: 0, label: 'Cliente', data: {} },
  ];
  const sequencia = ['mp', ...roteiro.map((o) => `op-${o.codigo}`), 'exp'];
  const arrows: CanvasArrow[] = sequencia.slice(1).map((destino, index) => ({
    id: `seta-${index}`, kind: 'arrow-push', x1: 0, y1: 0, x2: 0, y2: 0,
    startAnchor: { elementId: sequencia[index], x: 1, y: 0.5 }, endAnchor: { elementId: destino, x: 0, y: 0.5 },
  }));
  return { elements, arrows, assumptions: premissas, themeColor: '#0a2a4f' };
}
// Depois: const simulation = calculateCanvasSimulation(cenario);
//         const flow = calculateLiveFlow(simulation, cenario.assumptions, t, { orderQuantity: op.quantidade });
```

Transportes entre operações (empilhadeira, trator, terceiro) podem entrar como `truck`/`inventory` com
tempo de espera, ou como processos de "movimentação" com `tc` igual ao tempo de transporte.

## 6. Tema visual Exata (ícones monocromáticos)

A referência é o mapa da Exata: engrenagem para processamento, empilhadeira e trator para transporte,
pilha de caixas para estoque, operador em bancada para montagem, caminhão só para terceiro/expedição, tudo
em azul-marinho sólido. No repositório original os símbolos são componentes em `src/MfvSymbols.tsx`;
criar um tema significa um conjunto alternativo de glifos SVG para `process`, `truck` (empilhadeira,
trator), `inventory`, `work-cell` e `shipping-point`, selecionável por uma opção do mapa. Nada no motor
muda.

## 7. Checklist de integração

- [ ] Repositório `@exata/mfv-engine` criado, testes verdes no CI.
- [ ] Conversor roteiro + OP → cenário, com teste usando uma OP real.
- [ ] Tela no ERP: mapa gerado + botão Simular (ordem = quantidade da OP) + relatório.
- [ ] Tema de ícones Exata.
- [ ] Exportação (PDF/JPEG) se necessária: `src/export.ts` do repositório original (jsPDF + html2canvas).
