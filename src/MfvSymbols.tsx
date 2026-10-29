import { useEffect, useState } from 'react';
import { DEFAULT_TRUCK_COLOR, type CanvasElement } from './canvas-types';
import { percentValue } from './numbers';
import { batchSizeOf, piecesPerCycleOf } from './batch';
import truckThreeQuarter from './assets/truck-three-quarter.png';
import cargoAirplaneThreeQuarter from './assets/cargo-airplane-three-quarter.png';
import cargoShipThreeQuarter from './assets/cargo-ship-three-quarter.png';
import forkliftThreeQuarter from './assets/forklift-three-quarter.png';
import milkRunTuggerThreeQuarter from './assets/milk-run-tugger-three-quarter.png';
import supplierFactoryThreeQuarter from './assets/supplier-factory-three-quarter.png';
import finalCustomerThreeQuarter from './assets/final-customer-three-quarter.png';
import finishedGoodsThreeQuarter from './assets/finished-goods-three-quarter.png';
import warehouseThreeQuarter from './assets/warehouse-three-quarter.png';
import shippingDockThreeQuarter from './assets/shipping-dock-three-quarter.png';
import cncMachineThreeQuarter from './assets/cnc-machine-three-quarter.png';

interface SymProps {
  el: CanvasElement;
  selected: boolean;
  onEdit: () => void;
  taktTimeSec?: number;
  dailyDemand?: number;
  availableMinutesPerDay?: number;
  leadTimeDays?: number;
  processingTimeMin?: number;
  accentColor?: string;
  /** Logotipo da empresa (Identificação do MFV), usado no baú do caminhão quando configurado. */
  companyImage?: string;
  processLoadPercent?: number;
  processCapacityPerDay?: number;
  heijunkaSchedule?: {
    productId: string;
    name: string;
    code: string;
    color: string;
    packSize: number;
    pitchTimeSec: number;
  }[];
  timelineItems?: {
    id: string;
    type: 'process' | 'inventory';
    x: number;
    width: number;
    value: number;
  }[];
}

function mixColor(color: string, target: '#ffffff' | '#000000', ratio: number) {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : '#0071e3';
  const source = [1, 3, 5].map((index) => parseInt(safe.slice(index, index + 2), 16));
  const destination = target === '#ffffff' ? 255 : 0;
  const mixed = source.map((channel) => Math.round(channel + (destination - channel) * ratio));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function theme(accentColor = '#0071e3') {
  return {
    accent: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : '#0071e3',
    dark: mixColor(accentColor, '#000000', 0.42),
    darker: mixColor(accentColor, '#000000', 0.62),
    mid: mixColor(accentColor, '#ffffff', 0.45),
    light: mixColor(accentColor, '#ffffff', 0.82),
    pale: mixColor(accentColor, '#ffffff', 0.92),
  };
}

const STOCK_COLORS = {
  accent: '#d6a400',
  dark: '#8a6500',
  darker: '#5f4700',
  mid: '#f0ce40',
  light: '#fff0a3',
  pale: '#fff9dc',
};

function sel(selected: boolean, base: string) { return selected ? '#0071e3' : base; }
function selW(selected: boolean) { return selected ? 2.5 : 1.5; }

function EditBtn({ onEdit, x = 0, y = 0 }: { onEdit: () => void; x?: number; y?: number }) {
  return (
    <g className="edit-btn-group" transform={`translate(${x},${y})`}
      onClick={(e) => { e.stopPropagation(); onEdit(); }} style={{ cursor: 'pointer' }}>
      <rect x={-11} y={-11} width={22} height={22} rx={5} fill="white" stroke="#d0d0d8" strokeWidth={1} opacity={0.95} />
      <path d="M-4,4 L0,0 M-4,4 L-5,5 M0,0 L3,3 M-5,5 L-4,6 L-5,5 M-4,6 L-1,5 M0,0 C1,-1 2,-1 3,0 C4,1 4,2 3,3"
        stroke="#0071e3" strokeWidth={1.3} fill="none" strokeLinecap="round" />
    </g>
  );
}

function SelectionRect({ w, h }: { w: number; h: number }) {
  return <rect className="selection-rect" x={-2} y={-2} width={w + 4} height={h + 4} rx={4}
    fill="none" stroke="#0071e3" strokeWidth={2} strokeDasharray="4 2" opacity={0.7} />;
}

function TintedAssetImage({ el, href, x, y, width, height }: {
  el: CanvasElement;
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const color = String(el.data.color ?? DEFAULT_TRUCK_COLOR);
  const filterId = `asset-tint-${el.id}`;
  return <>
    <defs>
      <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="redChannel" />
        <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 1 0 0 0" result="greenChannel" />
        <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="blueChannel" />
        <feComponentTransfer in="redChannel" result="redSurface">
          <feFuncA type="table" tableValues="0 0 0 0 0 0 0 0.03 0.38 0.86 1" />
        </feComponentTransfer>
        <feComponentTransfer in="greenChannel" result="greenSurface">
          <feFuncA type="table" tableValues="0 0 0 0 0 0 0 0.03 0.38 0.86 1" />
        </feComponentTransfer>
        <feComponentTransfer in="blueChannel" result="blueSurface">
          <feFuncA type="table" tableValues="0 0 0 0 0 0 0 0.03 0.38 0.86 1" />
        </feComponentTransfer>
        <feComposite in="redSurface" in2="greenSurface" operator="in" result="redGreenSurface" />
        <feComposite in="redGreenSurface" in2="blueSurface" operator="in" result="whiteSurface" />
        <feComposite in="whiteSurface" in2="SourceAlpha" operator="in" result="paintableSurface" />
        <feFlood floodColor={color} floodOpacity={0.78} result="paintColor" />
        <feComposite in="paintColor" in2="paintableSurface" operator="in" result="paintedSurface" />
        <feBlend in="SourceGraphic" in2="paintedSurface" mode="multiply" />
      </filter>
    </defs>
    <image href={href} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid meet" filter={`url(#${filterId})`} />
  </>;
}

// ── Máquinas genéricas ───────────────────────────────────────────────────────
export const MACHINE_TYPES: { value: string; label: string }[] = [
  { value: 'cnc', label: 'Máquina CNC (imagem)' },
  { value: 'generica', label: 'Máquina genérica' },
  { value: 'forno', label: 'Forno / estufa' },
  { value: 'misturador', label: 'Misturador / masseira' },
  { value: 'esteira', label: 'Esteira transportadora' },
  { value: 'prensa', label: 'Prensa / injetora' },
  { value: 'embaladora', label: 'Embaladora / seladora' },
  { value: 'tanque', label: 'Tanque / reator' },
  { value: 'bancada', label: 'Bancada manual' },
];

/** Desenho vetorial simples de uma máquina genérica, na cor escolhida para o equipamento. Área 142×94 a partir de (4,2). */
function MachineGlyph({ tipo, color }: { tipo: string; color: string }) {
  const body = /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_TRUCK_COLOR;
  const dark = mixColor(body, '#000000', 0.45);
  const ink = '#3a3f47';
  const line = { stroke: ink, strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const base = <path d="M14,92 H136" {...line} />;
  switch (tipo) {
    case 'forno':
      return <g>
        <rect x={30} y={24} width={90} height={64} rx={6} fill={body} {...line} />
        <rect x={44} y={40} width={62} height={34} rx={4} fill="#fff" {...line} />
        <path d="M58,66 C60,58 54,56 58,48 M74,66 C76,58 70,56 74,48 M90,66 C92,58 86,56 90,48" fill="none" stroke="#ff9f0a" strokeWidth={2} strokeLinecap="round" />
        <rect x={100} y={8} width={12} height={18} fill={dark} {...line} />
        <circle cx={112} cy={32} r={2.2} fill="#ff3b30" />
        <path d="M40,88 V92 M110,88 V92" {...line} />
        {base}
      </g>;
    case 'misturador':
      return <g>
        <path d="M40,40 H110 L100,80 H50 Z" fill={body} {...line} />
        <rect x={62} y={14} width={26} height={16} rx={3} fill={dark} {...line} />
        <path d="M75,30 V72 M60,58 L90,58 M63,70 L87,46" {...line} />
        <path d="M46,80 V92 M104,80 V92" {...line} />
        <circle cx={118} cy={22} r={3} fill="#0a84ff" />
        {base}
      </g>;
    case 'esteira':
      return <g>
        <rect x={16} y={46} width={118} height={16} rx={8} fill={body} {...line} />
        {[28, 50, 72, 94, 116].map((cx) => <circle key={cx} cx={cx} cy={54} r={4.5} fill="#fff" {...line} />)}
        <rect x={60} y={30} width={22} height={16} rx={2} fill="#fff" {...line} />
        <path d="M30,62 V92 M120,62 V92 M24,92 H36 M114,92 H126" {...line} />
        <path d="M100,24 H128 M122,18 L128,24 L122,30" fill="none" {...line} />
      </g>;
    case 'prensa':
      return <g>
        <path d="M34,90 V18 H116 V90" fill="none" {...line} />
        <rect x={26} y={10} width={98} height={10} rx={3} fill={dark} {...line} />
        <rect x={56} y={20} width={38} height={26} fill={body} {...line} />
        <path d="M66,46 H84 V56 H66 Z" fill={dark} {...line} />
        <rect x={46} y={64} width={58} height={10} fill={body} {...line} />
        <path d="M62,56 L62,64 M88,56 L88,64" {...line} strokeDasharray="2 2" />
        {base}
      </g>;
    case 'embaladora':
      return <g>
        <rect x={34} y={36} width={82} height={44} rx={5} fill={body} {...line} />
        <circle cx={60} cy={22} r={11} fill="#fff" {...line} />
        <circle cx={60} cy={22} r={3.5} fill={dark} />
        <path d="M71,22 H110 V36" fill="none" {...line} />
        <rect x={116} y={58} width={18} height={14} rx={2} fill="#fff" {...line} />
        <path d="M42,52 H74 M42,62 H66" {...line} stroke="#fff" />
        <path d="M44,80 V92 M106,80 V92" {...line} />
        {base}
      </g>;
    case 'tanque':
      return <g>
        <rect x={46} y={22} width={58} height={56} rx={14} fill={body} {...line} />
        <ellipse cx={75} cy={24} rx={29} ry={7} fill={dark} {...line} />
        <path d="M104,46 H126 V92 M52,78 V92 M98,78 V92" fill="none" {...line} />
        <circle cx={126} cy={60} r={4} fill="#fff" {...line} />
        <path d="M58,50 H92" stroke="#fff" strokeWidth={2} strokeDasharray="4 3" />
        {base}
      </g>;
    case 'bancada':
      return <g>
        <rect x={22} y={44} width={106} height={10} rx={2} fill={body} {...line} />
        <path d="M30,54 V92 M120,54 V92 M30,74 H120" {...line} />
        <rect x={52} y={30} width={22} height={14} rx={2} fill="#fff" {...line} />
        <circle cx={96} cy={36} r={7} fill="#fff" {...line} />
        <path d="M96,29 V22 M89,36 H82" {...line} />
      </g>;
    default:
      return <g>
        <rect x={30} y={26} width={90} height={60} rx={6} fill={body} {...line} />
        <rect x={40} y={36} width={34} height={24} rx={3} fill="#fff" {...line} />
        <circle cx={96} cy={44} r={3} fill="#0a84ff" /><circle cx={108} cy={44} r={3} fill="#ff9f0a" />
        <rect x={88} y={56} width={24} height={14} rx={2} fill={dark} {...line} />
        <path d="M46,86 V92 M104,86 V92 M60,14 H90 M75,14 V26" {...line} />
        {base}
      </g>;
  }
}

// ── Processo ─────────────────────────────────────────────────────────────────
export function ProcessSymbol({ el, selected, onEdit, taktTimeSec = 0, availableMinutesPerDay = 0, accentColor, processLoadPercent, processCapacityPerDay }: SymProps) {
  const w = 150; const h = 160;
  const colors = theme(accentColor);
  const piecesPerCycle = piecesPerCycleOf(el.data);
  const cycleTime = Math.max(0, Number(el.data.tc) || 0) / piecesPerCycle;
  const setupPerUnit = (Math.max(0, Number(el.data.setup) || 0) * 60) / Math.max(1, Number(el.data.lote) || 1);
  const availability = Math.min(100, Math.max(1, percentValue(el.data.disp))) / 100;
  const resources = Math.max(1, Number(el.data.recurso) || 1);
  const effectiveCycle = (cycleTime + setupPerUnit) / (resources * availability);
  const localLoadPercent = taktTimeSec > 0 ? (effectiveCycle / taktTimeSec) * 100 : 0;
  const loadPercent = processLoadPercent ?? localLoadPercent;
  const valid = Number(el.data.tc) > 0;
  const overloaded = valid && loadPercent > 100;
  const capacityPerDay = processCapacityPerDay ?? (effectiveCycle > 0 ? (availableMinutesPerDay * 60) / effectiveCycle : 0);
  const rows = [
    { k: 'Nº operador', v: `${el.data.op ?? 1}` },
    { k: 'T/C', v: piecesPerCycle > 1 ? `${el.data.tc ?? 0} s · ${piecesPerCycle} un/ciclo` : `${el.data.tc ?? 0} s` },
    { k: 'Setup / lote', v: `${el.data.setup ?? 0} min · ${el.data.lote ?? 1} un` },
    { k: 'Recurso', v: `${el.data.recurso ?? 1}` },
    { k: 'Disponib.', v: `${el.data.disp ?? 100}%` },
    { k: 'Qualidade', v: `${el.data.qualidade ?? 100}%` },
    { k: 'Capacidade', v: effectiveCycle > 0 ? `${capacityPerDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/dia` : '—' },
  ];
  const label = el.label || 'Processo';
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      {taktTimeSec > 0 && <g transform="translate(4,-19)">
        <rect width={92} height={16} rx={8} fill={!valid ? '#fff2cf' : overloaded ? '#ffe2df' : '#dcf6e7'} stroke={!valid ? '#d79a18' : overloaded ? '#ff3b30' : '#1f9d5a'} strokeWidth={0.8} />
        <circle cx={9} cy={8} r={3} fill={!valid ? '#d79a18' : overloaded ? '#ff3b30' : '#1f9d5a'} />
        <text x={17} y={11} fontSize={7} fontWeight="700" fontFamily="Arial" fill={!valid ? '#815a08' : overloaded ? '#a51f18' : '#126b3b'}>
          {!valid ? 'SEM TEMPO DE CICLO' : overloaded ? 'SOBRECARREGADO' : `CARGA ${loadPercent.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`}
        </text>
      </g>}
      {batchSizeOf(el.data) > 1 && <g transform={`translate(${w - 58},-19)`}>
        <rect width={54} height={16} rx={8} fill={colors.light} stroke={colors.dark} strokeWidth={0.8} />
        <text x={27} y={11} textAnchor="middle" fontSize={7} fontWeight="700" fontFamily="Arial" fill={colors.darker}>POR LOTE</text>
      </g>}
      <rect width={w} height={h} rx={4} fill="white" stroke={selected ? '#0071e3' : overloaded ? '#ff3b30' : colors.dark} strokeWidth={selected || overloaded ? 2.5 : 1.5} />
      <rect width={w} height={38} rx={4} fill={selected ? colors.light : overloaded ? '#ffd5d1' : colors.mid} />
      <line x1={0} y1={38} x2={w} y2={38} stroke="#9aa0ae" strokeWidth={1} />
      <text x={w/2} y={16} textAnchor="middle" fontSize={8.5} fontWeight="700" fontFamily="Arial" fill="#1a2a1a">{label.split('\n')[0]}</text>
      {label.split('\n')[1] && <text x={w/2} y={28} textAnchor="middle" fontSize={8} fontFamily="Arial" fill="#1a2a1a">{label.split('\n')[1]}</text>}
      {/* Bandejas fixas: entrada à esquerda e saída à direita; a simulação empilha as peças nelas. */}
      <g className="process-trays">
        <path d={`M2,${h + 38} V${h + 52} H${w / 2 - 6} V${h + 38}`} fill="none" stroke="#5f6670" strokeWidth={1.6} />
        <path d={`M${w / 2 + 6},${h + 38} V${h + 52} H${w - 2} V${h + 38}`} fill="none" stroke="#5f6670" strokeWidth={1.6} />
        <text x={(w / 2 - 4) / 2} y={h + 62} textAnchor="middle" fontSize={6.5} fontWeight="800" fontFamily="Arial" fill="#4b5159">ENTRADA</text>
        <text x={(w / 2 + 6 + w - 2) / 2} y={h + 62} textAnchor="middle" fontSize={6.5} fontWeight="800" fontFamily="Arial" fill="#4b5159">SAÍDA</text>
      </g>
      {rows.map((r, i) => (
        <g key={r.k}>
          {i > 0 && <line x1={0} y1={38 + i * 17} x2={w} y2={38 + i * 17} stroke="#dde0e9" strokeWidth={0.8} />}
          <text x={6} y={38 + 12 + i * 17} fontSize={6.5} fontFamily="Arial" fill="#50575f" fontWeight="700">{r.k}</text>
          <text x={w-6} y={38 + 12 + i * 17} fontSize={7} fontFamily="Arial" fill="#1d2128" fontWeight="700" textAnchor="end">{r.v}</text>
        </g>
      ))}
      <EditBtn onEdit={onEdit} x={w - 2} y={2} />
    </g>
  );
}

// ── Célula de trabalho (U-shape) ──────────────────────────────────────────────
export function WorkCellSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 160; const h = 100;
  const colors = theme(accentColor);
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <path d={`M 10,8 L ${w-10},8 L ${w-10},${h-20} Q ${w-10},${h-8} ${w-22},${h-8} L 22,${h-8} Q 10,${h-8} 10,${h-20} Z`}
        fill={colors.light} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <text x={w/2} y={32} textAnchor="middle" fontSize={9} fontWeight="700" fontFamily="Arial" fill={colors.darker}>{el.label || 'Célula'}</text>
      <text x={w/2} y={48} textAnchor="middle" fontSize={7.5} fontFamily="Arial" fill={colors.dark}>{el.data.op ?? 1} operador(es)</text>
      {/* mini boneco */}
      <circle cx={w/2} cy={66} r={6} fill="white" stroke={colors.dark} strokeWidth={1.5} />
      <line x1={w/2} y1={72} x2={w/2} y2={84} stroke={colors.dark} strokeWidth={1.5} />
      <line x1={w/2-8} y1={76} x2={w/2+8} y2={76} stroke={colors.dark} strokeWidth={1.5} />
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Fornecedor / Cliente ──────────────────────────────────────────────────────
export function PartySymbol({ el, selected, onEdit }: SymProps) {
  const w = 170; const h = 120;
  const isC = el.kind === 'customer';
  const label = el.label || (isC ? 'Cliente final' : 'Fornecedor');
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <TintedAssetImage el={el} href={isC ? finalCustomerThreeQuarter : supplierFactoryThreeQuarter} x={4} y={2} width={w-8} height={92} />
      <text x={w/2} y={103} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="#34383e">{label}</text>
      {el.data.freq && <text x={w/2} y={115} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#6b7178">a cada {el.data.freq} dia(s)</text>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Caminhão ──────────────────────────────────────────────────────────────────
/**
 * Logotipo no baú do caminhão seguindo a perspectiva da imagem.
 * A lateral do baú é um trapézio; o logo é fatiado em colunas e cada fatia recebe a transformação
 * afim do seu trecho do trapézio, o que reproduz o encolhimento em perspectiva.
 */
function TrailerLogo({ href, id, fit }: { href: string; id: string; fit: 'ajustar' | 'preencher' }) {
  // Cantos da lateral do baú em coordenadas do símbolo (imagem 1681×935 desenhada em 206×108 a partir de 2,2).
  const sx = 206 / 1681; const sy = 108 / 935;
  const TL = { x: 2 + 22 * sx, y: 2 + 292 * sy }; const TR = { x: 2 + 688 * sx, y: 2 + 112 * sy };
  const BL = { x: 2 + 22 * sx, y: 2 + 640 * sy }; const BR = { x: 2 + 688 * sx, y: 2 + 622 * sy };
  // Região do logo dentro da lateral (fração da largura e da altura), afastada da cabine e do friso superior.
  // A lateral inteira (com uma pequena margem para o friso e as bordas).
  const U0 = 0.025; const U1 = 0.975; const V0 = 0.06; const V1 = 0.95;
  const W = 100; const H = 50; const SLICES = 16;
  const at = (u: number, v: number) => {
    const top = { x: TL.x + (TR.x - TL.x) * u, y: TL.y + (TR.y - TL.y) * u };
    const bottom = { x: BL.x + (BR.x - BL.x) * u, y: BL.y + (BR.y - BL.y) * u };
    return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
  };
  return <g>
    {Array.from({ length: SLICES }, (_, index) => {
      const f0 = index / SLICES; const f1 = (index + 1) / SLICES;
      const u0 = U0 + (U1 - U0) * f0; const u1 = U0 + (U1 - U0) * f1;
      const p00 = at(u0, V0); const p10 = at(u1, V0); const p01 = at(u0, V1);
      const sliceW = W * (f1 - f0);
      const a = (p10.x - p00.x) / sliceW; const b = (p10.y - p00.y) / sliceW;
      const c = (p01.x - p00.x) / H; const d = (p01.y - p00.y) / H;
      const clipId = `${id}-logo-slice-${index}`;
      return <g key={index} transform={`matrix(${a} ${b} ${c} ${d} ${p00.x} ${p00.y})`}>
        <clipPath id={clipId}><rect x={0} y={0} width={sliceW + 0.6} height={H} /></clipPath>
        <image href={href} x={-W * f0} y={0} width={W} height={H} preserveAspectRatio={fit === 'preencher' ? 'xMidYMid slice' : 'xMidYMid meet'} clipPath={`url(#)`} />
      </g>;
    })}
  </g>;
}

const imageBackgroundCache = new Map<string, string | null>();

/**
 * Cor de fundo de uma imagem: média dos pixels opacos ao longo das bordas.
 * Devolve null quando as bordas são transparentes (logo sem fundo).
 */
function useImageBackground(href: string) {
  const [color, setColor] = useState<string | null>(() => (href ? imageBackgroundCache.get(href) ?? null : null));
  useEffect(() => {
    if (!href) { setColor(null); return; }
    if (imageBackgroundCache.has(href)) { setColor(imageBackgroundCache.get(href) ?? null); return; }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, size, size);
        const data = context.getImageData(0, 0, size, size).data;
        let r = 0; let g = 0; let b = 0; let count = 0;
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const onBorder = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
            if (!onBorder) continue;
            const index = (y * size + x) * 4;
            if (data[index + 3] < 64) continue;
            r += data[index]; g += data[index + 1]; b += data[index + 2]; count += 1;
          }
        }
        const result = count >= 24
          ? `#${[r, g, b].map((channel) => Math.round(channel / count).toString(16).padStart(2, '0')).join('')}`
          : null;
        imageBackgroundCache.set(href, result);
        if (!cancelled) setColor(result);
      } catch {
        imageBackgroundCache.set(href, null);
        if (!cancelled) setColor(null);
      }
    };
    image.onerror = () => { if (!cancelled) setColor(null); };
    image.src = href;
    return () => { cancelled = true; };
  }, [href]);
  return color;
}

export function TruckSymbol({ el, selected, onEdit, companyImage }: SymProps) {
  const w = 210; const h = 130;
  const logoSource = String(el.data.logoFonte ?? 'nenhum');
  const logo = logoSource === 'empresa' ? (companyImage ?? '') : logoSource === 'proprio' ? String(el.data.logo ?? '') : '';
  const paintTrailer = String(el.data.logoFundo ?? 'auto') === 'auto';
  const logoBackground = useImageBackground(paintTrailer ? logo : '');
  // Lateral do baú (mesmos cantos do logo, com margem até as bordas) pintada na cor de fundo do logo.
  const sx = 206 / 1681; const sy = 108 / 935;
  const trailerSide = [[22, 284], [690, 104], [690, 626], [22, 644]].map(([x, y]) => `${2 + x * sx},${2 + y * sy}`).join(' ');
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <TintedAssetImage el={el} href={truckThreeQuarter} x={2} y={2} width={206} height={108} />
      {logo && logoBackground && <polygon points={trailerSide} fill={logoBackground} style={{ mixBlendMode: 'multiply' }} />}
      {logo && <TrailerLogo href={logo} id={el.id} fit={String(el.data.logoAjuste ?? 'ajustar') === 'preencher' ? 'preencher' : 'ajustar'} />}
      {el.label && <text x={w/2} y={120} textAnchor="middle" fontSize={8} fontFamily="Arial" fill="#34383e" fontWeight="700">{el.label}</text>}
      {el.data.freq && <text x={w/2} y={129} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#6b7178">a cada {el.data.freq} dia(s)</text>}
      <EditBtn onEdit={onEdit} x={w-2} y={5} />
    </g>
  );
}

// ── Ponto de expedição ────────────────────────────────────────────────────────
export function ShippingPointSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 150; const h = 110;
  const colors = theme(accentColor);
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <TintedAssetImage el={el} href={shippingDockThreeQuarter} x={4} y={2} width={w-8} height={88} />
      <text x={w/2} y={103} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="#34383e">{el.label || 'Expedição'}</text>
      {Number(el.data.lote) > 1 && <g transform={`translate(${w / 2 - 40},-19)`}>
        <rect width={80} height={16} rx={8} fill={colors.light} stroke={colors.dark} strokeWidth={0.8} />
        <text x={40} y={11} textAnchor="middle" fontSize={7} fontWeight="700" fontFamily="Arial" fill={colors.darker}>LOTE DE {el.data.lote} UN</text>
      </g>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Estoque ───────────────────────────────────────────────────────────────────
export function InventorySymbol({ el, selected, onEdit, dailyDemand = 0 }: SymProps) {
  const w = 60; const h = 60;
  const colors = STOCK_COLORS;
  const inventoryDays = dailyDemand > 0 ? Number(el.data.qty ?? 0) / dailyDemand : 0;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <polygon points={`${w/2},4 ${w-4},${h-18} 4,${h-18}`} fill={colors.mid} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <text x={w/2} y={h-22} textAnchor="middle" fontSize={8} fontFamily="Arial" fontWeight="700" fill="#363b43">{el.data.qty ?? 0}</text>
      <text x={w/2} y={h-8} textAnchor="middle" fontSize={6} fontFamily="Arial" fill="#636b73">{inventoryDays.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dias</text>
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Buffer ────────────────────────────────────────────────────────────────────
export function BufferSymbol({ el, selected, onEdit }: SymProps) {
  const w = 80; const h = 60;
  const colors = STOCK_COLORS;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={7} fill={colors.pale} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} strokeDasharray="5 3" />
      <circle cx={w/2} cy={20} r={13} fill={colors.accent}/><text x={w/2} y={25} textAnchor="middle" fontSize={14} fontWeight="900" fontFamily="Arial" fill="white">B</text>
      <text x={w/2} y={42} textAnchor="middle" fontSize={7} fontFamily="Arial" fontWeight="700" fill={colors.darker}>{el.label || 'Buffer'}</text>
      {el.data.qty !== undefined && Number(el.data.qty) > 0 &&
        <text x={w/2} y={52} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#886600">{el.data.qty} un</text>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Supermercado ──────────────────────────────────────────────────────────────
export function SupermarketSymbol({ el, selected, onEdit }: SymProps) {
  const w = 80; const h = 70;
  const colors = STOCK_COLORS;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect x={2} y={2} width={w-4} height={h-24} rx={4} fill={colors.pale} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <line x1={2} y1={18} x2={w-4} y2={18} stroke={colors.dark} strokeWidth={1} />
      <line x1={2} y1={32} x2={w-4} y2={32} stroke={colors.dark} strokeWidth={1} />
      {[8,22,36].map((x)=>[5,19,33].map((y)=>
        <rect key={`${x}-${y}`} x={x} y={y} width={8} height={8} fill={colors.mid} stroke={colors.dark} strokeWidth={0.5} rx={1.5}/>
      ))}
      {el.data.qty !== undefined && <text x={w/2} y={h-8} textAnchor="middle" fontSize={7} fontFamily="Arial" fontWeight="700" fill="#1a3a80">{el.data.qty} un</text>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── FIFO ──────────────────────────────────────────────────────────────────────
export function FifoSymbol({ el, selected, onEdit }: SymProps) {
  const w = 100; const h = 50;
  const colors = STOCK_COLORS;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect x={1} y={10} width={w-2} height={26} rx={6} fill={colors.pale} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <text x={w/2-8} y={27} textAnchor="middle" fontSize={9} fontWeight="800" fontFamily="Arial" fill={colors.darker}>FIFO</text>
      <polygon points={`${w-18},10 ${w-2},23 ${w-18},36`} fill={colors.accent} />
      {Number(el.data.qty) > 0 && <text x={w/2} y={46} textAnchor="middle" fontSize={6.5} fontWeight="700" fontFamily="Arial" fill={colors.darker}>limite {el.data.qty} un</text>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Kanban de produção (cartão laranja) ───────────────────────────────────────
export function KanbanProductionSymbol({ el, selected, onEdit }: SymProps) {
  const w = 60; const h = 44;
  const card = { accent: '#f59e0b', dark: '#9a4c07', pale: '#fff7df' };
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={5} fill="white" stroke={sel(selected,card.dark)} strokeWidth={selW(selected)} />
      <rect x={1} y={1} width={w-2} height={12} rx={4} fill={card.accent} />
      <path d={`M${w-10},1 H${w-1} V10 Z`} fill="#ffd98a" />
      <rect x={5} y={18} width={4} height={16} rx={2} fill={card.accent} />
      <text x={w/2} y={9} textAnchor="middle" fontSize={5.5} fontWeight="900" fontFamily="Arial" fill="white">KANBAN</text>
      <text x={13} y={25} fontSize={6.5} fontWeight="850" fontFamily="Arial" fill={card.dark}>PRODUÇÃO</text>
      <line x1={13} y1={29} x2={43} y2={29} stroke="#e3c693" strokeWidth={1} />
      {el.data.qty !== undefined && Number(el.data.qty) > 0 &&
        <g><rect x={13} y={32} width={30} height={9} rx={4.5} fill={card.pale} />
          <text x={28} y={39} textAnchor="middle" fontSize={5.5} fontFamily="Arial" fill={card.dark} fontWeight="800">{el.data.qty} cart.</text></g>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Kanban de retirada (cartão verde) ─────────────────────────────────────────
export function KanbanWithdrawalSymbol({ el, selected, onEdit }: SymProps) {
  const w = 60; const h = 44;
  const card = { accent: '#22a06b', dark: '#146344', pale: '#e5f7ef' };
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={5} fill="white" stroke={sel(selected,card.dark)} strokeWidth={selW(selected)} />
      <rect x={1} y={1} width={w-2} height={12} rx={4} fill={card.accent} />
      <path d={`M${w-10},1 H${w-1} V10 Z`} fill="#91dfbd" />
      <rect x={5} y={18} width={4} height={16} rx={2} fill={card.accent} />
      <text x={w/2} y={9} textAnchor="middle" fontSize={5.5} fontWeight="900" fontFamily="Arial" fill="white">KANBAN</text>
      <text x={13} y={25} fontSize={6.5} fontWeight="850" fontFamily="Arial" fill={card.dark}>RETIRADA</text>
      <line x1={13} y1={29} x2={43} y2={29} stroke="#a9d8c4" strokeWidth={1} />
      {el.data.qty !== undefined && Number(el.data.qty) > 0 &&
        <g><rect x={13} y={32} width={30} height={9} rx={4.5} fill={card.pale} />
          <text x={28} y={39} textAnchor="middle" fontSize={5.5} fontFamily="Arial" fill={card.dark} fontWeight="800">{el.data.qty} cart.</text></g>}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Quadro Kanban ─────────────────────────────────────────────────────────────
export function KanbanBoardSymbol({ el, selected, onEdit }: SymProps) {
  const w = 120; const h = 100;
  const colors = theme('#2c5fa8');
  const cols = Math.min(6, Math.max(1, Number(el.data.cols) || 3));
  const rows = Math.min(5, Math.max(1, Number(el.data.rows) || 3));
  const gap = 3; const inset = 5; const boardTop = 22; const columnHeaderHeight = 11;
  const cw = (w - inset * 2 - gap * (cols - 1)) / cols;
  const rh = (h - boardTop - columnHeaderHeight - 7) / rows;
  const columnColors = ['#e8f1ff', '#fff4d6', '#e5f7ef', '#f1eaff', '#ffe9e7', '#e9f7f8'];
  const cardColors = ['#72a7f2', '#f2b84b', '#4fbd8a', '#a987dc', '#ec7c72', '#55b8bd'];
  const columnNames = cols === 3 ? ['A FAZER', 'EM FLUXO', 'PRONTO'] : Array.from({ length: cols }, (_, index) => `ETAPA ${index + 1}`);
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={8} fill="#f7f8fa" stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <rect width={w} height={18} rx={8} fill={colors.accent} />
      <path d={`M0,11 Q0,18 8,18 H${w-8} Q${w},18 ${w},11 V18 H0 Z`} fill={colors.accent} />
      <circle cx={9} cy={9} r={2} fill="rgba(255,255,255,.72)" />
      <circle cx={16} cy={9} r={2} fill="rgba(255,255,255,.45)" />
      <text x={w/2} y={12} textAnchor="middle" fontSize={7.5} fontWeight="800" fontFamily="Arial" fill="white">{el.label || 'Quadro Kanban'}</text>
      {Array.from({length: cols}, (_,c) => {
        const x = inset + c * (cw + gap);
        return <g key={`column-${c}`}>
          <rect x={x} y={boardTop} width={cw} height={h-boardTop-5} rx={3} fill="white" stroke="#d7dbe2" strokeWidth={0.7} />
          <rect x={x} y={boardTop} width={cw} height={columnHeaderHeight} rx={3} fill={columnColors[c % columnColors.length]} />
          <text x={x+cw/2} y={boardTop+7.5} textAnchor="middle" fontSize={cols === 3 ? 4.2 : 3.5} fontWeight="850" fontFamily="Arial" fill="#475467">{columnNames[c]}</text>
          {Array.from({length: rows}, (_,r) => {
            const cardY = boardTop + columnHeaderHeight + 3 + r * rh;
            const showCard = r === 0 || (r + c) % 3 !== 2;
            return showCard && <g key={`card-${r}-${c}`}>
              <rect x={x+3} y={cardY} width={Math.max(4,cw-6)} height={Math.max(4,rh-3)} rx={2}
                fill={cardColors[(r+c) % cardColors.length]} opacity={0.94} />
              {cw > 18 && <><circle cx={x+7} cy={cardY+3.5} r={1.1} fill="rgba(255,255,255,.9)" />
                <line x1={x+10} y1={cardY+3.5} x2={x+cw-4} y2={cardY+3.5} stroke="rgba(255,255,255,.8)" strokeWidth={0.8} /></>}
            </g>;
          })}
        </g>;
      })}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Heijunka box ──────────────────────────────────────────────────────────────
export function HeijunkaSymbol({ el, selected, onEdit, heijunkaSchedule = [] }: SymProps) {
  const w = 140; const h = 80;
  const colors = theme('#2c5fa8');
  const products = heijunkaSchedule.filter((slot, index, items) => items.findIndex((candidate) => candidate.productId === slot.productId) === index).slice(0, 5);
  const cols = Math.min(8, Math.max(1, Number(el.data.cols) || Math.min(6, heijunkaSchedule.length || 5)));
  const rows = Math.max(1, products.length || Number(el.data.rows) || 2);
  const labelWidth = products.length ? 18 : 0;
  const cw = (w - 10 - labelWidth) / cols; const rh = (h - 22) / rows;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={7} fill={colors.pale} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <rect width={w} height={18} rx={7} fill={colors.accent} />
      <text x={w/2} y={12} textAnchor="middle" fontSize={7.5} fontWeight="700" fontFamily="Arial" fill="white">{el.label || 'Heijunka'}</text>
      {Array.from({length: rows}, (_,r) => {
        const product = products[r];
        return <g key={`row-${r}`}>
          {product && <text x={12} y={20+r*rh+rh/2+2} textAnchor="middle" fontSize={5.5} fontWeight="900" fontFamily="Arial" fill={product.color}>{product.code}</text>}
          {Array.from({length: cols}, (_,c) => {
            const slot = heijunkaSchedule[c % Math.max(1, heijunkaSchedule.length)];
            const filled = product ? slot?.productId === product.productId : r === 0;
            return <g key={`${r}-${c}`}>
              <rect x={5+labelWidth+c*cw} y={20+r*rh} width={cw-2} height={rh-2} rx={1}
                fill={filled ? (product?.color ?? colors.mid) : 'white'} stroke={colors.dark} strokeWidth={0.7}/>
              {filled && product && cw > 10 && <text x={5+labelWidth+c*cw+(cw-2)/2} y={20+r*rh+rh/2+2} textAnchor="middle" fontSize={4.5} fontWeight="900" fontFamily="Arial" fill="white">{product.packSize}</text>}
            </g>;
          })}
        </g>;
      })}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Caixa de sequenciamento ───────────────────────────────────────────────────
export function SequencingBoxSymbol({ el, selected, onEdit, heijunkaSchedule = [] }: SymProps) {
  const w = 120; const h = 60;
  const colors = theme('#2c5fa8');
  const slots = Math.max(1, Number(el.data.slots) || 6);
  const sw = (w - 10) / slots;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={7} fill={colors.pale} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <rect width={w} height={18} rx={7} fill={colors.accent} />
      <text x={w/2} y={12} textAnchor="middle" fontSize={7} fontWeight="700" fontFamily="Arial" fill="white">{el.label || 'Sequenciamento'}</text>
      {Array.from({length: slots}, (_,i) => (
        <g key={i}><rect x={5 + i*sw} y={22} width={sw-2} height={30} rx={2} fill={heijunkaSchedule[i % Math.max(1, heijunkaSchedule.length)]?.color ?? (i % 2 ? colors.light : 'white')} stroke={colors.dark} strokeWidth={0.8} />
          {heijunkaSchedule.length > 0 && <text x={5+i*sw+(sw-2)/2} y={40} textAnchor="middle" fontSize={Math.min(7,sw*.42)} fontWeight="900" fontFamily="Arial" fill="white">{heijunkaSchedule[i % heijunkaSchedule.length].code}</text>}</g>
      ))}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Controle de produção ──────────────────────────────────────────────────────
export function IdentificationSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 390; const h = 100;
  const colors = theme(accentColor);
  const companyImage = String(el.data.companyImage ?? '');
  const productImage = String(el.data.productImage ?? '');
  const family = String(el.data.family ?? '').trim() || 'Família não informada';
  const companyName = String(el.data.companyName ?? '').trim();
  const productName = String(el.data.productName ?? '').trim();
  const imageSlot = (x: number, image: string, title: string, fallback: string) => (
    <g>
      <rect x={x} y={0} width={90} height={h} fill="#f7f8fb" stroke="#8a93a8" strokeWidth={1} />
      {image ? (
        <image href={image} x={x + 5} y={17} width={80} height={66} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <>
          <rect x={x + 17} y={27} width={56} height={38} rx={4} fill="white" stroke="#bdc4cf" strokeDasharray="4 3" />
          <path d={`M${x + 26},57 L${x + 39},44 L${x + 48},52 L${x + 58},39 L${x + 66},57 Z`} fill="#dbe1ea" />
          <text x={x + 45} y={75} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#7a8494">{fallback}</text>
        </>
      )}
      <text x={x + 45} y={11} textAnchor="middle" fontSize={6.5} fontWeight="700" fontFamily="Arial" fill="#536176">{title}</text>
    </g>
  );
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} fill="white" stroke={sel(selected, '#66758c')} strokeWidth={selW(selected)} />
      {imageSlot(0, companyImage, 'EMPRESA', 'Logo ou foto')}
      <rect x={90} y={0} width={210} height={h} fill={colors.pale} stroke={colors.dark} strokeWidth={1} />
      <rect x={90} y={0} width={210} height={24} fill={colors.accent} />
      <text x={195} y={16} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill="white">FAMÍLIA DE PRODUTOS</text>
      <text x={195} y={51} textAnchor="middle" fontSize={12} fontWeight="800" fontFamily="Arial" fill={colors.darker}>{family.slice(0, 30)}</text>
      {companyName && <text x={195} y={70} textAnchor="middle" fontSize={7.5} fontFamily="Arial" fill="#536176">Empresa: {companyName.slice(0, 34)}</text>}
      {productName && <text x={195} y={85} textAnchor="middle" fontSize={7.5} fontFamily="Arial" fill="#536176">Produto: {productName.slice(0, 34)}</text>}
      {imageSlot(300, productImage, 'PRODUTO', 'Foto do produto')}
      <EditBtn onEdit={onEdit} x={w - 2} y={2} />
    </g>
  );
}

export function PlanningSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 190; const h = 170;
  const colors = theme(accentColor);
  const label = el.label || 'Controle da\nProdução';
  const format = (value: string | number | undefined, digits = 1) => Number(value ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: digits });
  const rows = [
    { k: 'Demanda mensal', v: `${format(el.data.demanda, 2)} un` },
    { k: 'Demanda diária', v: `${format(el.data.demandaDiaria, 2)} un` },
    { k: 'TAKT time', v: `${format(Number(el.data.takt ?? 0) / 60, 2)} min`, highlight: true },
    { k: 'Pitch médio', v: `${format(Number(el.data.pitch ?? 0) / 60, 2)} min` },
    { k: 'Tempo disponível', v: `${format(el.data.minutosDia, 0)} min/dia` },
  ];
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={4} fill="white" stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <rect width={w} height={28} rx={4} fill={colors.accent} />
      <line x1={0} y1={28} x2={w} y2={28} stroke="#8a93a8" strokeWidth={1} />
      {label.split('\n').map((ln,i) =>
        <text key={i} x={w/2} y={13+i*12} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="Arial" fill="white">{ln}</text>
      )}
      {rows.map((r,i)=>(
        <g key={r.k}>
          {r.highlight && <rect x={1} y={29+i*28} width={w-2} height={27} fill="#eaf7ee" />}
          <line x1={0} y1={28+(i+1)*28} x2={w} y2={28+(i+1)*28} stroke="#dde0e9" strokeWidth={0.8} />
          <text x={7} y={28+18+i*28} fontSize={7} fontFamily="Arial" fill={r.highlight ? '#16723a' : '#50575f'} fontWeight="700">{r.k}</text>
          <text x={w-7} y={28+18+i*28} fontSize={r.highlight ? 8.5 : 7.5} fontFamily="Arial" fill={r.highlight ? '#138a43' : '#1d2128'} fontWeight={r.highlight ? '800' : '700'} textAnchor="end">{r.v}</text>
        </g>
      ))}
      <EditBtn onEdit={onEdit} x={w-2} y={4} />
    </g>
  );
}

// ── Caixa de dados ────────────────────────────────────────────────────────────
export function DataBoxSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 130; const h = 90;
  const colors = theme(accentColor);
  const rows = [
    { k: 'T/C', v: `${el.data.tc ?? 0} s` },
    { k: 'TCP', v: `${el.data.tcp ?? 0} s` },
    { k: 'Disponib.', v: `${el.data.disp ?? 100}%` },
    { k: 'Turnos', v: `${el.data.turnos ?? 1}` },
  ];
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={4} fill="white" stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <rect width={w} height={20} rx={4} fill={colors.mid} />
      <text x={w/2} y={13} textAnchor="middle" fontSize={7.5} fontWeight="700" fontFamily="Arial" fill={colors.darker}>{el.label || 'Dados'}</text>
      {rows.map((r,i)=>(
        <g key={r.k}>
          <line x1={0} y1={20+(i+1)*17} x2={w} y2={20+(i+1)*17} stroke="#dde0e9" strokeWidth={0.8} />
          <text x={6} y={20+12+i*17} fontSize={6.5} fontFamily="Arial" fill="#50575f" fontWeight="700">{r.k}</text>
          <text x={w-6} y={20+12+i*17} fontSize={7} fontFamily="Arial" fill="#1d2128" fontWeight="700" textAnchor="end">{r.v}</text>
        </g>
      ))}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Demanda do cliente ────────────────────────────────────────────────────────
export function CustomerDemandSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 100; const h = 80;
  const colors = theme(accentColor);
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <polygon points={`${w/2},${h-4} 4,4 ${w-4},4`} fill={colors.light} stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <text x={w/2} y={22} textAnchor="middle" fontSize={7} fontWeight="700" fontFamily="Arial" fill={colors.darker}>DEMANDA</text>
      <text x={w/2} y={36} textAnchor="middle" fontSize={10} fontWeight="800" fontFamily="Arial" fill={colors.darker}>{el.data.qty ?? 0}</text>
      <text x={w/2} y={50} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#2a3a80">un / {el.data.periodo ?? 0} dias</text>
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Programação de produção (documento) ──────────────────────────────────────
export function ProductionScheduleSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 110; const h = 70;
  const colors = theme(accentColor);
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect x={12} y={5} width={86} height={60} rx={7} fill="white" stroke={sel(selected,colors.dark)} strokeWidth={selW(selected)} />
      <rect x={12} y={5} width={86} height={16} rx={7} fill={colors.accent} />
      <path d="M12,15 Q12,21 19,21 H91 Q98,21 98,15 V21 H12 Z" fill={colors.accent} />
      <rect x={43} y={2} width={24} height={9} rx={4.5} fill={colors.dark} />
      <text x={55} y={17} textAnchor="middle" fontSize={6.5} fontWeight="850" fontFamily="Arial" fill="white">{(el.label||'PROGRAMAÇÃO').slice(0,18)}</text>
      {[0,1,2].map((row) => <g key={row} transform={`translate(19,${27+row*11})`}>
        <rect width={9} height={7} rx={2} fill={[colors.mid,'#f2b84b','#4fbd8a'][row]} />
        <line x1={14} y1={2} x2={69-row*8} y2={2} stroke="#758195" strokeWidth={1.2} />
        <line x1={14} y1={6} x2={54-row*5} y2={6} stroke="#d2d7df" strokeWidth={1} />
      </g>)}
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Operador ──────────────────────────────────────────────────────────────────
export function OperatorSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 40; const h = 60;
  const colors = theme(accentColor);
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <circle cx={20} cy={14} r={7} fill="#f2c9a5" stroke={sel(selected,colors.dark)} strokeWidth={1.2} />
      <path d="M12,13 Q12,5 20,4 Q28,5 28,13 H25 Q24,9 20,9 Q16,9 15,13 Z" fill="#f2b84b" stroke="#9a6508" strokeWidth={1} />
      <rect x={10} y={22} width={20} height={23} rx={7} fill={colors.accent} stroke={sel(selected,colors.dark)} strokeWidth={1.2} />
      <path d="M15,23 L20,31 L25,23 M20,31 V43" fill="none" stroke="white" strokeWidth={2.2} />
      <path d="M11,27 L4,39 M29,27 L36,39" fill="none" stroke={colors.dark} strokeWidth={3} strokeLinecap="round" />
      <path d="M16,44 L11,57 M24,44 L29,57" fill="none" stroke={colors.darker} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M7,57 H13 M27,57 H33" stroke="#303640" strokeWidth={3} strokeLinecap="round" />
      {el.data.qty !== undefined && Number(el.data.qty) > 1 &&
        <g><circle cx={33} cy={49} r={7} fill="white" stroke={colors.dark}/><text x={33} y={52} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fontWeight="800" fill={colors.darker}>×{el.data.qty}</text></g>}
      <EditBtn onEdit={onEdit} x={w} y={2} />
    </g>
  );
}

// ── Kaizen burst ──────────────────────────────────────────────────────────────
export function KaizenSymbol({ el, selected, onEdit }: SymProps) {
  const r = 34;
  const pts = Array.from({length:16},(_,i)=>{const a=(i/16)*Math.PI*2;const rad=i%2===0?r:r*.64;return `${r+4+rad*Math.cos(a)},${r+4+rad*Math.sin(a)}`;}).join(' ');
  const label = el.label || 'Kaizen';
  return (
    <g>
      {selected && <rect x={-2} y={-2} width={78+4} height={78+4} rx={4} fill="none" stroke="#0071e3" strokeWidth={2} strokeDasharray="4 2" opacity={0.7} />}
      <polygon points={pts} fill={selected?'#ffe888':'#ffe04b'} stroke={sel(selected,'#b8930f')} strokeWidth={selW(selected)} />
      {label.split('\n').map((ln,i) =>
        <text key={i} x={r+4} y={r+2+(i-(label.split('\n').length-1)/2)*10} textAnchor="middle" fontSize={7.5} fontWeight="800" fontFamily="Arial" fill="#6b4c00">{ln}</text>
      )}
      <EditBtn onEdit={onEdit} x={r*2+2} y={2} />
    </g>
  );
}

// ── Ponto de intervenção (círculo com raios) ──────────────────────────────────
export function InterventionSymbol({ el, selected, onEdit }: SymProps) {
  const cx = 35; const cy = 35; const r = 24;
  const rays = Array.from({length:8},(_,i)=>{
    const a=(i/8)*Math.PI*2;
    const x1=cx+r*Math.cos(a); const y1=cy+r*Math.sin(a);
    const x2=cx+(r+10)*Math.cos(a); const y2=cy+(r+10)*Math.sin(a);
    return {x1,y1,x2,y2};
  });
  const label = el.label || 'Melhoria';
  return (
    <g>
      {selected && <rect x={-2} y={-2} width={74} height={74} rx={4} fill="none" stroke="#0071e3" strokeWidth={2} strokeDasharray="4 2" opacity={0.7} />}
      {rays.map((ray,i) => (
        <line key={i} x1={ray.x1} y1={ray.y1} x2={ray.x2} y2={ray.y2} stroke={sel(selected,'#e03030')} strokeWidth={2} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={selected?'#ffd0d0':'#ffebeb'} stroke={sel(selected,'#e03030')} strokeWidth={selW(selected)} />
      {label.split('\n').map((ln,i) =>
        <text key={i} x={cx} y={cy+2+(i-(label.split('\n').length-1)/2)*10} textAnchor="middle" fontSize={7} fontWeight="800" fontFamily="Arial" fill="#b01010">{ln}</text>
      )}
      <EditBtn onEdit={onEdit} x={68} y={2} />
    </g>
  );
}

// ── Nota / Post-it ────────────────────────────────────────────────────────────
export function NoteSymbol({ el, selected, onEdit }: SymProps) {
  const w = 120; const h = 80;
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      {/* sombra */}
      <rect x={4} y={4} width={w} height={h} rx={3} fill="rgba(0,0,0,.08)" />
      {/* corpo */}
      <rect width={w} height={h} rx={3} fill={selected?'#fffaaa':'#fff9c4'} stroke={sel(selected,'#c8b800')} strokeWidth={selW(selected)} />
      {/* dobra */}
      <path d={`M ${w-16},0 L ${w},16 L ${w-16},16 Z`} fill={selected?'#e8d000':'#e8cc00'} />
      <path d={`M ${w-16},0 L ${w},16`} fill="none" stroke={sel(selected,'#c8b800')} strokeWidth={1} />
      {/* linhas de texto */}
      {[20,32,44,56].map((y,i) => <line key={i} x1={8} y1={y} x2={w-20} y2={y} stroke="#d4c400" strokeWidth={0.8} />)}
      <text x={w/2-8} y={15} textAnchor="middle" fontSize={7.5} fontFamily="Arial" fontWeight="600" fill="#665c00">{(el.label||'Nota...').slice(0,18)}</text>
      <EditBtn onEdit={onEdit} x={w-2} y={2} />
    </g>
  );
}

// ── Linha do tempo (dente de serra) ──────────────────────────────────────────
export function TimelineSymbol({ selected, leadTimeDays = 0, processingTimeMin = 0, timelineItems = [] }: SymProps) {
  const labelWidth = 150;
  const summaryWidth = 220;
  const connectorGap = 36;
  const topY = 24;
  const bottomY = 56;
  const items = [...timelineItems].sort((a, b) => a.x - b.x);
  const segments = items.map((item, index) => {
    const previousGap = index > 0 ? item.x - items[index - 1].x : Infinity;
    const nextGap = index < items.length - 1 ? items[index + 1].x - item.x : Infinity;
    const availableHalf = Math.max(24, (Math.min(previousGap, nextGap) - connectorGap) / 2);
    const halfWidth = Math.max(24, Math.min(item.width / 2, availableHalf));
    return { ...item, left: item.x - halfWidth, right: item.x + halfWidth, y: item.type === 'inventory' ? topY : bottomY };
  });
  const lastRight = segments.length ? segments[segments.length - 1].right : labelWidth;
  const summaryX = Math.max(labelWidth + 80, lastRight + 55);
  const w = summaryX + summaryWidth;
  const h = 78;
  const format = (value: number, digits: number) => value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <text x={labelWidth - 12} y={topY - 6} textAnchor="end" fontSize={10} fontWeight="700" fontFamily="Arial" fill="#1d2128">ESTOQUE EM DIAS</text>
      <text x={labelWidth - 12} y={bottomY + 16} textAnchor="end" fontSize={10} fontWeight="700" fontFamily="Arial" fill="#1d2128">T/C (MIN)</text>

      {segments.map((segment, index) => {
        const previous = segments[index - 1];
        const connectorMiddle = previous ? (previous.right + segment.left) / 2 : segment.left;
        return <g key={segment.id}>
          {previous && <path d={`M${previous.right},${previous.y} H${connectorMiddle} V${segment.y} H${segment.left}`}
            fill="none" stroke="#24262b" strokeWidth={1.4} />}
          <line x1={segment.left} y1={segment.y} x2={segment.right} y2={segment.y} stroke="#24262b" strokeWidth={1.4} />
          <text x={segment.x} y={segment.type === 'inventory' ? topY - 7 : bottomY - 7} textAnchor="middle" fontSize={9} fontWeight="700" fontFamily="Arial" fill="#1d2128">
            {format(segment.value, segment.type === 'inventory' ? 2 : 1)}
          </text>
          <text x={segment.x} y={segment.type === 'inventory' ? topY + 10 : bottomY + 15} textAnchor="middle" fontSize={7.5} fontFamily="Arial" fill="#35383e">
            {segment.type === 'inventory' ? 'Dias' : 'Minutos'}
          </text>
        </g>;
      })}

      {segments.length > 0 && <path d={`M${lastRight},${segments[segments.length - 1].y} H${summaryX - 24} V${bottomY} H${summaryX}`}
        fill="none" stroke="#24262b" strokeWidth={1.4} />}

      <g transform={`translate(${summaryX},4)`}>
        <rect width={summaryWidth} height={52} fill="white" stroke="#24262b" strokeWidth={1.4} />
        <line x1={0} y1={26} x2={summaryWidth} y2={26} stroke="#24262b" strokeWidth={1.1} />
        <line x1={92} y1={0} x2={92} y2={52} stroke="#24262b" strokeWidth={1.1} />
        <text x={46} y={17} textAnchor="middle" fontSize={9} fontWeight="700" fontFamily="Arial" fill="#1d2128">{format(leadTimeDays, 2)}</text>
        <text x={46} y={43} textAnchor="middle" fontSize={9} fontWeight="700" fontFamily="Arial" fill="#1d2128">{format(processingTimeMin, 1)}</text>
        <text x={99} y={17} fontSize={9} fontWeight="700" fontFamily="Arial" fill="#1d2128">LEAD TIME DIAS</text>
        <text x={99} y={43} fontSize={9} fontWeight="700" fontFamily="Arial" fill="#1d2128">AGV (Min)</text>
      </g>
    </g>
  );
}

// ── Legenda ───────────────────────────────────────────────────────────────────
export function LegendSymbol({ el, selected, onEdit, accentColor }: SymProps) {
  const w = 160; const h = 120;
  const colors = theme(accentColor);
  const items = [
    { color: '#111', label: 'Fluxo empurrado' },
    { color: '#111', label: 'Fluxo puxado' },
    { color: '#111', label: 'Info manual' },
    { color: '#111', label: 'Info eletrônica', dash: true },
  ];
  return (
    <g>
      {selected && <SelectionRect w={w} h={h} />}
      <rect width={w} height={h} rx={3} fill="white" stroke={sel(selected,'#8a9099')} strokeWidth={selW(selected)} />
      <rect width={w} height={20} rx={3} fill={colors.accent} />
      <text x={w/2} y={13} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="Arial" fill="white">{el.label||'Legenda'}</text>
      {items.map((item,i) => (
        <g key={i} transform={`translate(8,${26+i*23})`}>
          <line x1={0} y1={8} x2={28} y2={8} stroke={item.color} strokeWidth={2.5} strokeDasharray={item.dash?'4 2':'none'} />
          {!item.dash && <polygon points="22,4 30,8 22,12" fill={item.color} />}
          {item.dash && <polygon points="22,4 30,8 22,12" fill={item.color} />}
          <text x={34} y={12} fontSize={7} fontFamily="Arial" fill="#363b43">{item.label}</text>
        </g>
      ))}
      <EditBtn onEdit={onEdit} x={w-2} y={4} />
    </g>
  );
}

// ── Símbolos complementares do MFV ──────────────────────────────────────────
export function ExtendedSymbol(props: SymProps) {
  const { el, selected, onEdit, accentColor } = props;
  const colors = theme(accentColor);
  const stroke = sel(selected, colors.dark);
  const strokeWidth = selW(selected);
  const edit = (x: number, y = 2) => <EditBtn onEdit={onEdit} x={x} y={y} />;
  const label = (x: number, y: number, text = el.label, color = colors.darker) => (
    <text x={x} y={y} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="Arial" fill={color}>{text}</text>
  );

  if (el.kind === 'shared-process') {
    return <g><ProcessSymbol {...props} /><rect x={4} y={4} width={142} height={152} fill="none" stroke="#65748a" strokeWidth={1} strokeDasharray="5 3" pointerEvents="none" /></g>;
  }

  if (el.kind === 'raw-material') {
    // Estoque genérico: pilha de caixas na cor do elemento, sem sugerir um tipo de material.
    const w = 130; const h = 110;
    const fill = String(el.data.color || DEFAULT_TRUCK_COLOR);
    const box = (x: number, y: number) => <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={36} height={26} rx={2} fill={fill} stroke="#5f6670" strokeWidth={1.2} />
      <line x1={x + 18} y1={y} x2={x + 18} y2={y + 26} stroke="#8a9099" strokeWidth={1} />
      <line x1={x} y1={y + 13} x2={x + 36} y2={y + 13} stroke="#8a9099" strokeWidth={0.8} strokeDasharray="3 2" />
    </g>;
    return <g>
      {selected && <SelectionRect w={w} h={h} />}
      {[8, 47, 86].map((x) => box(x, 58))}
      {[27, 66].map((x) => box(x, 31))}
      {box(47, 4)}
      <line x1={4} y1={85} x2={w - 4} y2={85} stroke="#5f6670" strokeWidth={1.4} />
      {label(w/2,h-11)}
      {Number(el.data.qty ?? 0) > 0 && <text x={w/2} y={h-2} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#6b7178">{el.data.qty} un</text>}
      {edit(w-2)}
    </g>;
  }

  if (el.kind === 'finished-goods' || el.kind === 'warehouse') {
    const isWarehouse = el.kind === 'warehouse';
    const w = isWarehouse ? 180 : 130; const h = isWarehouse ? 120 : 110;
    const image = el.kind === 'finished-goods' ? finishedGoodsThreeQuarter : warehouseThreeQuarter;
    return <g>
      {selected && <SelectionRect w={w} h={h} />}
      <TintedAssetImage el={el} href={image} x={4} y={2} width={w-8} height={h-25} />
      {label(w/2,h-11)}
      {Number(el.data.qty ?? 0) > 0 && <text x={w/2} y={h-2} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#6b7178">{el.data.qty} un</text>}
      {edit(w-2)}
    </g>;
  }

  if (el.kind === 'machine') {
    const w=150,h=120;
    const tipo = String(el.data.tipo ?? 'cnc');
    return <g>{selected && <SelectionRect w={w} h={h}/>}
      {tipo === 'cnc'
        ? <TintedAssetImage el={el} href={cncMachineThreeQuarter} x={4} y={2} width={w-8} height={94}/>
        : <MachineGlyph tipo={tipo} color={String(el.data.color ?? DEFAULT_TRUCK_COLOR)} />}
      {label(w/2,110)}{edit(w-2)}</g>;
  }

  if (el.kind === 'inspection') {
    const w=100,h=86;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<polygon points={`${w/2},5 ${w-5},${h/2} ${w/2},${h-5} 5,${h/2}`} fill="white" stroke={stroke} strokeWidth={strokeWidth}/>
      <circle cx={43} cy={36} r={13} fill={colors.pale} stroke={colors.dark} strokeWidth={1.6}/><path d="M52,45 L64,57" stroke={colors.dark} strokeWidth={4} strokeLinecap="round"/>
      <path d="M36,36 L41,41 L50,31" fill="none" stroke="#16834b" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
      <text x={w/2} y={68} textAnchor="middle" fontSize={7} fontWeight="850" fontFamily="Arial" fill={colors.darker}>{(el.label||'INSPEÇÃO').slice(0,18)}</text>{edit(w-2)}</g>;
  }

  if (el.kind === 'waiting-time') {
    const w=130,h=76;
    const minutes = Math.max(0, Number(el.data.durationMin) || 0);
    const duration = minutes >= 60
      ? `${(minutes / 60).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`
      : `${minutes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<rect width={w} height={h} rx={8} fill="white" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray="5 3"/>
      <circle cx={24} cy={28} r={13} fill={colors.light} stroke={colors.dark}/><path d="M24,20 V29 L31,33" fill="none" stroke={colors.darker} strokeWidth={2} strokeLinecap="round"/>
      <text x={78} y={24} textAnchor="middle" fontSize={8} fontWeight="800" fontFamily="Arial" fill={colors.darker}>{(el.label || 'Espera').slice(0,22)}</text>
      <text x={78} y={42} textAnchor="middle" fontSize={13} fontWeight="800" fontFamily="Arial" fill={colors.accent}>{duration}</text>
      <text x={w/2} y={64} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill="#667085">tempo sem agregação de valor</text>{edit(w-2)}</g>;
  }

  if (el.kind === 'resource-zone') {
    const w=340,h=180;
    const interventionRed = '#d92d20';
    return <g>{selected && <SelectionRect w={w} h={h}/>}<rect x={2} y={12} width={w-4} height={h-14} rx={10} fill="none" stroke={interventionRed} strokeWidth={2.2} strokeDasharray="8 5"/>
      <rect x={16} y={2} width={Math.min(w-32, Math.max(126, (el.label || '').length * 5.7))} height={22} rx={11} fill="#fff1f0" stroke={interventionRed}/>
      <text x={24} y={17} fontSize={7.5} fontWeight="800" fontFamily="Arial" fill="#8f1d16">{(el.label || 'ÁREA DE INTERVENÇÃO').slice(0,48)}</text>{edit(w-2,14)}</g>;
  }

  if (el.kind === 'safety-stock') {
    const w=76,h=64;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<polygon points="22,7 40,40 4,40" fill={STOCK_COLORS.light} stroke={sel(selected,STOCK_COLORS.dark)} strokeWidth={strokeWidth}/><polygon points="54,7 72,40 36,40" fill={STOCK_COLORS.mid} stroke={sel(selected,STOCK_COLORS.dark)} strokeWidth={strokeWidth}/>
      <text x={38} y={35} textAnchor="middle" fontSize={9} fontWeight="800" fontFamily="Arial" fill={STOCK_COLORS.darker}>SS</text><text x={38} y={55} textAnchor="middle" fontSize={7} fontFamily="Arial" fill="#4d5663">{el.data.qty ?? 0} un</text>{edit(w-2)}</g>;
  }

  if (['transport-air','transport-ship','forklift','milk-run'].includes(el.kind)) {
    const w=el.kind==='milk-run'?190:el.kind==='forklift'?140:180; const h=el.kind==='milk-run'?110:el.kind==='forklift'?115:105;
    return <g>{selected && <SelectionRect w={w} h={h}/>}
      {el.kind==='transport-air' && <TintedAssetImage el={el} href={cargoAirplaneThreeQuarter} x={5} y={5} width={w-10} height={h-24}/>}
      {el.kind==='transport-ship' && <TintedAssetImage el={el} href={cargoShipThreeQuarter} x={5} y={5} width={w-10} height={h-24}/>}
      {el.kind==='forklift' && <TintedAssetImage el={el} href={forkliftThreeQuarter} x={5} y={3} width={w-10} height={h-22}/>}
      {el.kind==='milk-run' && <TintedAssetImage el={el} href={milkRunTuggerThreeQuarter} x={3} y={2} width={w-6} height={h-22}/>}
      {label(w/2,h-6)}{edit(w-2)}</g>;
  }

  if (el.kind === 'signal-kanban') {
    const w=64,h=56;
    const kanbanColors = theme('#2c5fa8');
    return <g>{selected && <SelectionRect w={w} h={h}/>}<polygon points={`${w/2},4 ${w-5},${h-8} 5,${h-8}`} fill="#f2b84b" stroke={sel(selected,'#9a6508')} strokeWidth={strokeWidth}/><text x={w/2} y={31} textAnchor="middle" fontSize={9} fontWeight="800" fontFamily="Arial" fill={kanbanColors.darker}>K</text>{Number(el.data.qty) > 0 && <text x={w/2} y={41} textAnchor="middle" fontSize={5.5} fontWeight="800" fontFamily="Arial" fill={kanbanColors.darker}>{el.data.qty} cart.</text>}{edit(w-2)}</g>;
  }

  if (el.kind === 'kanban-post') {
    const w=88,h=72;
    const kanbanColors = theme('#2c5fa8');
    return <g>{selected && <SelectionRect w={w} h={h}/>}<rect x={18} y={8} width={52} height={48} rx={6} fill={kanbanColors.pale} stroke={sel(selected,kanbanColors.dark)} strokeWidth={strokeWidth}/><line x1={27} y1={20} x2={61} y2={20} stroke="#f2b84b" strokeWidth={3}/><line x1={27} y1={31} x2={61} y2={31} stroke="#4fbd8a" strokeWidth={3}/><line x1={27} y1={42} x2={61} y2={42} stroke="#72a7f2" strokeWidth={3}/>{Number(el.data.qty) > 0 && <text x={w/2} y={53} textAnchor="middle" fontSize={5.5} fontWeight="800" fontFamily="Arial" fill={kanbanColors.darker}>{el.data.qty} cart.</text>}{label(w/2,68,el.label,kanbanColors.darker)}{edit(w-2)}</g>;
  }

  if (el.kind === 'sequenced-pull') {
    const w=150,h=62;
    const kanbanColors = theme('#2c5fa8');
    const pullCards = ['#72a7f2','#f2b84b','#4fbd8a','#a987dc'];
    return <g>{selected && <SelectionRect w={w} h={h}/>}<path d="M8,31 H134" stroke={kanbanColors.accent} strokeWidth={2.5}/><polygon points="134,24 146,31 134,38" fill={kanbanColors.accent}/>{[20,48,76,104].map((x,i)=><rect key={i} x={x} y={16} width={15} height={22} rx={3} fill={pullCards[i]} stroke={kanbanColors.dark}/>)}{label(w/2,55,el.label,kanbanColors.darker)}{edit(w-2)}</g>;
  }

  if (el.kind === 'erp-system' || el.kind === 'go-see') {
    const w=el.kind==='erp-system'?120:130,h=el.kind==='erp-system'?76:72;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<rect width={w} height={h} rx={10} fill="#f7f9fc" stroke={stroke} strokeWidth={strokeWidth}/>
      {el.kind==='erp-system'?<>
        <rect x={12} y={10} width={74} height={42} rx={5} fill="#26384d" stroke={colors.dark}/><rect x={17} y={15} width={64} height={31} rx={3} fill="white"/>
        <rect x={21} y={20} width={19} height={7} rx={2} fill={colors.mid}/><rect x={44} y={20} width={31} height={7} rx={2} fill="#e5f7ef"/>
        <path d="M22,40 L31,33 L42,37 L54,28 L66,34 L75,25" fill="none" stroke={colors.accent} strokeWidth={2}/>
        <rect x={43} y={53} width={14} height={4} rx={2} fill={colors.dark}/><rect x={35} y={57} width={30} height={3} rx={1.5} fill={colors.mid}/>
        <rect x={91} y={13} width={18} height={41} rx={4} fill="white" stroke={colors.dark}/>{[21,31,41].map((y,index)=><g key={y}><rect x={95} y={y} width={10} height={5} rx={1.5} fill={[colors.mid,'#f2b84b','#4fbd8a'][index]}/><circle cx={106} cy={y+2.5} r={1} fill={colors.dark}/></g>)}
      </>:<>
        <path d="M32,21 Q39,13 49,18 L57,27 V45 Q46,51 35,45 L27,34 Z" fill={colors.accent} stroke={colors.dark} strokeWidth={1.5}/>
        <path d="M98,21 Q91,13 81,18 L73,27 V45 Q84,51 95,45 L103,34 Z" fill={colors.accent} stroke={colors.dark} strokeWidth={1.5}/>
        <circle cx={46} cy={33} r={10} fill="#dcecff" stroke={colors.darker} strokeWidth={2}/><circle cx={84} cy={33} r={10} fill="#dcecff" stroke={colors.darker} strokeWidth={2}/>
        <circle cx={46} cy={33} r={4} fill="#7fb3da"/><circle cx={84} cy={33} r={4} fill="#7fb3da"/><path d="M56,31 Q65,25 74,31" fill="none" stroke={colors.dark} strokeWidth={3}/>
        <path d="M65,9 V20 M60,15 L65,20 L70,15" fill="none" stroke="#16834b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      </>}
      {label(w/2,h-7,el.label)}{edit(w-2)}</g>;
  }

  if (el.kind === 'quality-problem') {
    const w=82,h=72;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<path d="M41,4 L51,16 L68,13 L66,30 L78,40 L64,50 L65,67 L48,63 L37,71 L27,58 L10,61 L12,44 L2,33 L17,24 L17,8 L34,12 Z" fill="#ffd9d5" stroke="#d43d32" strokeWidth={strokeWidth}/><text x={41} y={38} textAnchor="middle" fontSize={17} fontWeight="900" fontFamily="Arial" fill="#a2221a">Q!</text>{edit(w-2)}</g>;
  }

  if (el.kind === 'bottleneck') {
    const w=92,h=66;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<path d="M20,7 H72 L62,25 V41 L72,59 H20 L30,41 V25 Z" fill="#ffe2df" stroke="#d43d32" strokeWidth={strokeWidth}/><text x={46} y={37} textAnchor="middle" fontSize={9} fontWeight="900" fontFamily="Arial" fill="#a2221a">GARGALO</text>{edit(w-2)}</g>;
  }

  if (el.kind === 'pacemaker') {
    const w=118,h=62;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<rect x={2} y={7} width={w-4} height={h-14} rx={24} fill={colors.pale} stroke={stroke} strokeWidth={strokeWidth}/>
      <path d="M18,31 H35 M26.5,22 V40" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round"/>
      <circle cx={26.5} cy={31} r={13} fill="none" stroke={colors.accent} strokeWidth={1.5}/>
      <text x={75} y={28} textAnchor="middle" fontSize={8} fontWeight="900" fontFamily="Arial" fill={colors.darker}>MARCAPASSO</text>
      <text x={75} y={40} textAnchor="middle" fontSize={6.5} fontFamily="Arial" fill={colors.dark}>{(el.label || 'Processo').slice(0,18)}</text>{edit(w-2)}</g>;
  }

  if (el.kind === 'future-principles') {
    const w=190,h=150;
    const points = Array.from({length:24},(_,index)=>{const angle=(index/24)*Math.PI*2-Math.PI/2;const radius=index%2===0?72:59;return `${w/2+radius*Math.cos(angle)},${h/2+radius*Math.sin(angle)}`;}).join(' ');
    const lines = (el.label || '').split('\n').filter(Boolean).slice(0,6);
    return <g>{selected && <SelectionRect w={w} h={h}/>}<polygon points={points} fill="#fffbe8" stroke={sel(selected,'#e2b900')} strokeWidth={strokeWidth}/>
      <text x={w/2} y={42} textAnchor="middle" fontSize={8} fontWeight="900" fontFamily="Arial" fill="#6a5200">ESTADO FUTURO</text>
      {lines.map((line,index)=><text key={index} x={w/2} y={58+index*13} textAnchor="middle" fontSize={7.5} fontWeight="700" fontFamily="Arial" fill="#34383e">{line.slice(0,30)}</text>)}{edit(w-10,8)}</g>;
  }

  if (el.kind === 'distance') {
    const w=150,h=42;
    return <g>{selected && <SelectionRect w={w} h={h}/>}<line x1={10} y1={18} x2={140} y2={18} stroke={stroke} strokeWidth={2}/><polygon points="10,18 20,12 20,24" fill={stroke}/><polygon points="140,18 130,12 130,24" fill={stroke}/><text x={75} y={36} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="Arial" fill="#39485c">{Number(el.data.distance ?? 0).toLocaleString('pt-BR')} m</text>{edit(w-2)}</g>;
  }

  return null;
}
