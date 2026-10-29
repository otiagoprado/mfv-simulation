// Relatório da simulação ao vivo, exibido abaixo do mapa: indicadores, gráficos e tabela por processo.
import { useState } from 'react';
import { ChevronDown, ChevronUp, BarChart3, X } from 'lucide-react';
import type { LiveReport as LiveReportData, LiveReportProcess } from './live-report';

// Paleta Apple fixa por significado: azul = positivo / produção, vermelho = fora do padrão,
// âmbar = atenção, cinza = neutro. Nunca por posição.
const APPLE = { blue: '#0a84ff', red: '#ff3b30', amber: '#ff9f0a', gray: '#8e8e93', gray3: '#c7c7cc' };
const COLORS = {
  completed: APPLE.blue,
  launched: APPLE.gray,
  processing: APPLE.blue,
  queue: APPLE.amber,
  holding: APPLE.red,
  transit: APPLE.gray3,
  critical: APPLE.red,
};

const formatNumber = (value: number, digits = 0) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const formatMinutes = (seconds: number) => `${formatNumber(seconds / 60, seconds >= 600 ? 0 : 1)} min`;

export function formatWorkDuration(seconds: number, daySeconds: number) {
  const days = daySeconds > 0 ? Math.floor(seconds / daySeconds) : 0;
  const rest = seconds - days * daySeconds;
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  const secs = Math.round(rest % 60);
  const clock = hours > 0
    ? `${hours} h ${String(minutes).padStart(2, '0')} min`
    : minutes > 0 ? `${minutes} min ${String(secs).padStart(2, '0')} s` : `${secs} s`;
  return days > 0 ? `${days} dia${days > 1 ? 's' : ''} + ${clock}` : clock;
}

function StatTile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className={`report-stat ${tone ?? ''}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {detail && <small>{detail}</small>}
  </div>;
}

/** Área acumulada: liberadas (cinza) e concluídas (azul) ao longo do tempo, com cursor e dica. */
export function CumulativeChart({ report, daySeconds }: { report: LiveReportData; daySeconds: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640; const height = 220; const left = 40; const right = 16; const top = 14; const bottom = 28;
  const plotW = width - left - right; const plotH = height - top - bottom;
  const points = report.series;
  const maxY = Math.max(1, ...points.map((point) => point.launched));
  const maxX = Math.max(1, points[points.length - 1]?.timeSec ?? 1);
  const x = (time: number) => left + (time / maxX) * plotW;
  const y = (value: number) => top + plotH - (value / maxY) * plotH;
  const path = (key: 'launched' | 'completed') => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.timeSec).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const area = `${path('completed')} L${x(maxX).toFixed(1)},${y(0).toFixed(1)} L${left},${y(0).toFixed(1)} Z`;
  const ticks = 4;
  const hovered = hover !== null ? points[hover] : null;
  return <div className="report-chart">
    <div className="report-chart-head">
      <h4>Produção acumulada</h4>
      <div className="report-legend">
        <span><i style={{ background: COLORS.launched }} />Liberadas</span>
        <span><i style={{ background: COLORS.completed }} />Concluídas</span>
      </div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Unidades liberadas e concluídas ao longo do tempo"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width) * width;
        const ratio = Math.min(1, Math.max(0, (px - left) / plotW));
        setHover(Math.round(ratio * (points.length - 1)));
      }}
      onMouseLeave={() => setHover(null)}>
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const value = (maxY * index) / ticks;
        return <g key={index}>
          <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#e5e5ea" strokeWidth={1} />
          <text x={left - 6} y={y(value) + 3} textAnchor="end" fontSize={9} fill="#8e8e93">{formatNumber(value)}</text>
        </g>;
      })}
      {Array.from({ length: 5 }, (_, index) => {
        const time = (maxX * index) / 4;
        return <text key={index} x={x(time)} y={height - 8} textAnchor={index === 0 ? 'start' : index === 4 ? 'end' : 'middle'} fontSize={9} fill="#8e8e93">{formatWorkDuration(time, daySeconds)}</text>;
      })}
      <path d={area} fill={COLORS.completed} opacity={0.12} />
      <path d={path('launched')} fill="none" stroke={COLORS.launched} strokeWidth={2} strokeLinejoin="round" />
      <path d={path('completed')} fill="none" stroke={COLORS.completed} strokeWidth={2} strokeLinejoin="round" />
      {hovered && <g>
        <line x1={x(hovered.timeSec)} x2={x(hovered.timeSec)} y1={top} y2={top + plotH} stroke="#c7c7cc" strokeDasharray="3 3" />
        <circle cx={x(hovered.timeSec)} cy={y(hovered.completed)} r={4} fill={COLORS.completed} stroke="#fff" strokeWidth={2} />
        <circle cx={x(hovered.timeSec)} cy={y(hovered.launched)} r={4} fill={COLORS.launched} stroke="#fff" strokeWidth={2} />
        <g transform={`translate(${Math.min(width - right - 150, Math.max(left, x(hovered.timeSec) + 8))},${top})`}>
          <rect width={142} height={48} rx={10} fill="#1c1c1e" opacity={0.92} />
          <text x={10} y={16} fontSize={9.5} fontWeight={700} fill="#fff">{formatWorkDuration(hovered.timeSec, daySeconds)}</text>
          <text x={10} y={30} fontSize={9} fill="#d1d1d6">Liberadas · {formatNumber(hovered.launched)} un</text>
          <text x={10} y={42} fontSize={9} fill="#d1d1d6">Concluídas · {formatNumber(hovered.completed)} un</text>
        </g>
      </g>}
    </svg>
  </div>;
}

/** Linha do tempo da primeira peça: quanto cada operação esperou parada até receber a primeira peça e quando a terminou. */
function FirstPieceChart({ processes, daySeconds }: { processes: LiveReportProcess[]; daySeconds: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const horizon = Math.max(1, ...processes.map((process) => process.firstFinishSec ?? process.firstArrivalSec ?? 0));
  const rowH = 30; const labelW = 150; const width = 640; const right = 70; const plotW = width - labelW - right;
  const height = processes.length * rowH + 26;
  const x = (time: number) => labelW + (time / horizon) * plotW;
  return <div className="report-chart">
    <div className="report-chart-head">
      <h4>Espera de cada operação até a primeira peça</h4>
      <div className="report-legend">
        <span><i style={{ background: COLORS.queue }} />Parada esperando a 1ª peça</span>
        <span><i style={{ background: COLORS.processing }} />1ª peça em produção</span>
      </div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" role="img" aria-label="Espera de cada operação até receber a primeira peça">
      {Array.from({ length: 5 }, (_, index) => {
        const time = (horizon * index) / 4;
        return <g key={index}>
          <line x1={x(time)} x2={x(time)} y1={2} y2={height - 22} stroke="#e5e5ea" strokeWidth={1} />
          <text x={x(time)} y={height - 8} textAnchor={index === 0 ? 'start' : index === 4 ? 'end' : 'middle'} fontSize={9} fill="#8e8e93">{formatWorkDuration(time, daySeconds)}</text>
        </g>;
      })}
      {processes.map((process, index) => {
        const yTop = index * rowH + 6;
        const arrival = process.firstArrivalSec;
        const finish = process.firstFinishSec;
        return <g key={process.id} onMouseEnter={() => setHover(process.id)} onMouseLeave={() => setHover(null)}>
          <rect x={0} y={yTop - 4} width={width} height={rowH} fill={hover === process.id ? '#f2f2f7' : 'transparent'} rx={8} />
          <text x={labelW - 10} y={yTop + 14} textAnchor="end" fontSize={10} fontWeight={500} fill="#1c1c1e">
            {process.label.length > 24 ? `${process.label.slice(0, 23)}…` : process.label}
          </text>
          {arrival !== null && arrival > 0 && <rect x={labelW} y={yTop + 3} width={Math.max(2, x(arrival) - labelW - 1)} height={16} rx={3} fill={COLORS.queue} />}
          {arrival !== null && finish !== null && <rect x={x(arrival) + 1} y={yTop + 3} width={Math.max(2, x(finish) - x(arrival) - 1)} height={16} rx={3} fill={COLORS.processing} />}
          <text x={x(finish ?? arrival ?? 0) + 6} y={yTop + 15} fontSize={9.5} fontWeight={600} fill="#3a3a3c">
            {arrival === null ? 'ainda sem peça' : `esperou ${formatWorkDuration(arrival, daySeconds)}`}
          </text>
          <title>{arrival === null
            ? `${process.label}: ainda não recebeu a primeira peça`
            : `${process.label}: recebeu a 1ª peça em ${formatWorkDuration(arrival, daySeconds)}${finish !== null ? ` e terminou em ${formatWorkDuration(finish, daySeconds)}` : ''}`}</title>
        </g>;
      })}
    </svg>
  </div>;
}

/** Barras horizontais empilhadas: tempo médio por unidade em cada processo (fila, produção, espera do lote). */
function ProcessTimeChart({ processes, bottleneckId }: { processes: LiveReportProcess[]; bottleneckId: string | null }) {
  const [hover, setHover] = useState<string | null>(null);
  const maxTotal = Math.max(1, ...processes.map((process) => process.avgQueueSec + process.avgProcessSec + process.avgHoldingSec));
  const rowH = 30; const labelW = 150; const width = 640; const right = 56; const plotW = width - labelW - right;
  const height = processes.length * rowH + 8;
  return <div className="report-chart">
    <div className="report-chart-head">
      <h4>Tempo médio por unidade em cada processo</h4>
      <div className="report-legend">
        <span><i style={{ background: COLORS.queue }} />Fila na entrada</span>
        <span><i style={{ background: COLORS.processing }} />Produção</span>
        <span><i style={{ background: COLORS.holding }} />Espera do lote na saída</span>
      </div>
    </div>
    <svg viewBox={`0 0  `} preserveAspectRatio="xMinYMin meet" role="img" aria-label="Tempo médio por unidade em cada processo">
      {processes.map((process, index) => {
        const yTop = index * rowH + 6;
        const segments = [
          { key: 'queue', value: process.avgQueueSec, color: COLORS.queue },
          { key: 'processing', value: process.avgProcessSec, color: COLORS.processing },
          { key: 'holding', value: process.avgHoldingSec, color: COLORS.holding },
        ];
        let cursor = labelW;
        const total = segments.reduce((sum, segment) => sum + segment.value, 0);
        const isBottleneck = process.id === bottleneckId;
        return <g key={process.id} onMouseEnter={() => setHover(process.id)} onMouseLeave={() => setHover(null)}>
          <rect x={0} y={yTop - 4} width={width} height={rowH} fill={hover === process.id ? '#f2f2f7' : 'transparent'} rx={8} />
          <text x={labelW - 10} y={yTop + 14} textAnchor="end" fontSize={10} fontWeight={isBottleneck ? 700 : 500} fill={isBottleneck ? COLORS.critical : '#1c1c1e'}>
            {process.label.length > 24 ? `${process.label.slice(0, 23)}…` : process.label}
          </text>
          {segments.map((segment) => {
            const segmentW = (segment.value / maxTotal) * plotW;
            const rect = <rect key={segment.key} x={cursor} y={yTop + 3} width={Math.max(0, segmentW - 2)} height={16} rx={3} fill={segment.color} />;
            cursor += segmentW;
            return segmentW > 0 ? rect : null;
          })}
          <text x={labelW + (total / maxTotal) * plotW + 6} y={yTop + 15} fontSize={9.5} fill="#3a3a3c" fontWeight={600}>{formatMinutes(total)}</text>
          {hover === process.id && <title>{`${process.label}: fila ${formatMinutes(process.avgQueueSec)} · produção ${formatMinutes(process.avgProcessSec)} · espera do lote ${formatMinutes(process.avgHoldingSec)}`}</title>}
        </g>;
      })}
    </svg>
  </div>;
}

/** Ocupação de cada processo no tempo simulado; o gargalo é destacado. */
function UtilizationChart({ processes, bottleneckId }: { processes: LiveReportProcess[]; bottleneckId: string | null }) {
  return <div className="report-chart">
    <div className="report-chart-head"><h4>Ocupação dos processos</h4><span className="report-chart-note">% do tempo simulado em setup ou produção</span></div>
    <div className="report-utilization">
      {processes.map((process) => {
        const percent = Math.round(process.utilization * 100);
        const isBottleneck = process.id === bottleneckId;
        return <div key={process.id} className={isBottleneck ? 'bottleneck' : ''} title={`${process.label}: ${percent}% ocupado · maior fila ${process.maxQueue} un`}>
          <span>{process.label}{isBottleneck && <em>gargalo</em>}</span>
          <div className="report-bar"><i style={{ width: `${percent}%`, background: isBottleneck ? COLORS.critical : COLORS.processing }} /></div>
          <strong>{percent}%</strong>
        </div>;
      })}
    </div>
  </div>;
}

/** Rosca com a composição do atravessamento médio de uma unidade. */
function CompositionDonut({ report }: { report: LiveReportData }) {
  const parts = [
    { key: 'processing', label: 'Produção', value: report.composition.processing, color: COLORS.processing },
    { key: 'queue', label: 'Fila na entrada', value: report.composition.queue, color: COLORS.queue },
    { key: 'holding', label: 'Espera do lote', value: report.composition.holding, color: COLORS.holding },
    { key: 'transit', label: 'Movimentação', value: report.composition.transit, color: COLORS.transit },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 54; const stroke = 16; const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div className="report-chart report-donut">
    <div className="report-chart-head"><h4>De que é feito o tempo de uma unidade</h4></div>
    <div className="report-donut-body">
      <svg viewBox="0 0 140 140" role="img" aria-label="Composição do atravessamento médio">
        <circle cx={70} cy={70} r={radius} fill="none" stroke="#f2f2f7" strokeWidth={stroke} />
        {total > 0 && parts.map((part) => {
          const length = (part.value / total) * circumference;
          const element = <circle key={part.key} cx={70} cy={70} r={radius} fill="none" stroke={part.color} strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`} strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"><title>{`${part.label}: ${formatMinutes(part.value)}`}</title></circle>;
          offset += length;
          return element;
        })}
        <text x={70} y={66} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c1c1e">{report.avgLeadTimeSec !== null ? formatMinutes(report.avgLeadTimeSec) : '—'}</text>
        <text x={70} y={80} textAnchor="middle" fontSize={8} fill="#8e8e93">atravessamento médio</text>
      </svg>
      <ul>
        {parts.map((part) => <li key={part.key}>
          <i style={{ background: part.color }} /><span>{part.label}</span>
          <strong>{formatMinutes(part.value)}</strong>
          <small>{total > 0 ? `${Math.round((part.value / total) * 100)}%` : '—'}</small>
        </li>)}
      </ul>
    </div>
  </div>;
}

export function LiveReportPanel({ report, daySeconds, hidden = false, onClose, containerRef }: {
  report: LiveReportData;
  daySeconds: number;
  /** Mantém o relatório montado fora da tela (para exportação) sem exibi-lo. */
  hidden?: boolean;
  onClose?: () => void;
  containerRef?: React.RefObject<HTMLElement>;
}) {
  const [open, setOpen] = useState(true);
  const avgPerUnit = report.avgPerUnitSec;
  const taktTone = avgPerUnit !== null && report.taktTimeSec > 0 ? (avgPerUnit <= report.taktTimeSec ? 'good' : 'bad') : undefined;
  const valueAdded = report.composition.processing;
  const leadTotal = report.avgLeadTimeSec ?? 0;
  const valueAddedShare = leadTotal > 0 ? Math.round((valueAdded / leadTotal) * 100) : null;
  return <section ref={containerRef} className={`live-report ${open ? 'open' : ''} ${hidden ? 'offscreen' : ''}`} aria-label="Relatório da simulação" aria-hidden={hidden} onWheel={(event) => event.stopPropagation()}>
    <header className="live-report-header" onClick={() => setOpen((value) => !value)}>
      <div className="live-report-title">
        <span className="live-report-icon"><BarChart3 size={16} /></span>
        <div>
          <strong>Relatório da simulação</strong>
          <small>{report.mode === 'ordem'
            ? report.done ? `Ordem de ${formatNumber(report.quantity)} unidades concluída` : `Ordem de ${formatNumber(report.quantity)} unidades · parcial em ${formatWorkDuration(report.elapsedSec, daySeconds)}`
            : `Fluxo contínuo · parcial em ${formatWorkDuration(report.elapsedSec, daySeconds)}`}</small>
        </div>
      </div>
      <div className="live-report-actions">
        <button type="button" aria-label={open ? 'Recolher relatório' : 'Expandir relatório'}>{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
        {onClose && <button type="button" aria-label="Fechar relatório" onClick={(event) => { event.stopPropagation(); onClose(); }}><X size={15} /></button>}
      </div>
    </header>
    <div className="live-report-body">
      <div className="report-stats">
        <StatTile label="Tempo médio por unidade" value={avgPerUnit !== null ? formatWorkDuration(avgPerUnit, daySeconds) : '—'}
          detail={report.taktTimeSec > 0 ? `takt ${formatWorkDuration(report.taktTimeSec, daySeconds)}` : undefined} tone={taktTone} />
        <StatTile label="Unidades concluídas" value={`${formatNumber(report.completed)} de ${formatNumber(report.quantity)}`}
          detail={report.throughputPerHour !== null ? `${formatNumber(report.throughputPerHour, 1)} un/h` : undefined} />
        <StatTile label="1ª unidade pronta" value={report.firstDoneSec !== null && report.firstDoneSec <= report.elapsedSec ? formatWorkDuration(report.firstDoneSec, daySeconds) : '—'} />
        <StatTile label="Última unidade pronta" value={report.lastDoneSec !== null && report.lastDoneSec <= report.elapsedSec ? formatWorkDuration(report.lastDoneSec, daySeconds) : '—'} />
        <StatTile label={report.mode === 'ordem' ? 'Ordem entregue em' : 'Tempo simulado'} value={report.mode === 'ordem'
          ? (report.done && report.deliveredSec !== null ? formatWorkDuration(report.deliveredSec, daySeconds) : 'em andamento')
          : formatWorkDuration(report.elapsedSec, daySeconds)} detail={report.mode === 'ordem' ? 'inclui o lote de expedição' : undefined} />
        <StatTile label="Atravessamento médio" value={report.avgLeadTimeSec !== null ? formatWorkDuration(report.avgLeadTimeSec, daySeconds) : '—'}
          detail={valueAddedShare !== null ? `${valueAddedShare}% agregando valor` : undefined} tone={valueAddedShare !== null ? (valueAddedShare >= 50 ? 'good' : valueAddedShare >= 20 ? 'warn' : 'bad') : undefined} />
      </div>
      <div className="report-grid">
        <FirstPieceChart processes={report.processes} daySeconds={daySeconds} />
        <CompositionDonut report={report} />
        <ProcessTimeChart processes={report.processes} bottleneckId={report.bottleneckId} />
        <UtilizationChart processes={report.processes} bottleneckId={report.bottleneckId} />
      </div>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr><th>Processo</th><th>Unidades</th><th>Ocupação</th><th>Fila média</th><th>Produção média</th><th>Espera do lote</th><th>Maior fila</th></tr></thead>
          <tbody>
            {report.processes.map((process) => <tr key={process.id} className={process.id === report.bottleneckId ? 'bottleneck' : ''}>
              <td>{process.label}</td>
              <td>{formatNumber(process.unitsDone)}</td>
              <td>{Math.round(process.utilization * 100)}%</td>
              <td>{formatMinutes(process.avgQueueSec)}</td>
              <td>{formatMinutes(process.avgProcessSec)}</td>
              <td>{formatMinutes(process.avgHoldingSec)}</td>
              <td>{formatNumber(process.maxQueue)} un</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </section>;
}
