export type PaperSize = 'a1' | 'a2' | 'a3' | 'a4';

const EXPORT_PADDING = 28;

function download(url: string, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
}

const imageDataCache = new Map<string, Promise<string>>();

/** Converte a URL de uma imagem (PNG dos símbolos) em data URL para o SVG exportado ser autocontido. */
function imageAsDataUrl(url: string) {
  const cached = imageDataCache.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Imagem indisponível: ${url}`);
      return response.blob();
    })
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Não foi possível ler a imagem ${url}`));
      reader.readAsDataURL(blob);
    }));
  imageDataCache.set(url, pending);
  return pending;
}

/** Embute todas as imagens externas do SVG: ao desenhar o SVG fora da página, referências por URL não carregam. */
async function inlineImages(root: SVGElement) {
  const images = Array.from(root.querySelectorAll('image'));
  await Promise.all(images.map(async (image) => {
    const href = image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || href.startsWith('data:')) return;
    try {
      const dataUrl = await imageAsDataUrl(new URL(href, window.location.href).toString());
      image.setAttribute('href', dataUrl);
      image.removeAttribute('xlink:href');
      image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    } catch {
      // Sem a imagem, o símbolo sai sem a figura em vez de impedir a exportação.
    }
  }));
}

async function croppedSvg(svg: SVGSVGElement) {
  const content = svg.querySelector<SVGGElement>('[data-export-content]');
  if (!content) throw new Error('Conteúdo do MFV não encontrado.');

  const bounds = content.getBBox();
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error('O MFV está vazio.');

  const clone = content.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');
  clone.querySelectorAll('[data-export-ui], .edit-btn-group, .selection-rect').forEach((node) => node.remove());
  await inlineImages(clone);

  const x = bounds.x - EXPORT_PADDING;
  const y = bounds.y - EXPORT_PADDING;
  const width = bounds.width + EXPORT_PADDING * 2;
  const height = bounds.height + EXPORT_PADDING * 2;
  const markup = new XMLSerializer().serializeToString(clone);
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>${markup}</svg>`;

  return { source, width, height };
}

async function rasterize(svg: SVGSVGElement) {
  const cropped = await croppedSvg(svg);
  const blob = new Blob([cropped.source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível renderizar o MFV.'));
      image.src = url;
    });

    const longestSide = Math.max(cropped.width, cropped.height);
    const scale = Math.max(1, Math.min(3, 7200 / longestSide));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(cropped.width * scale);
    canvas.height = Math.ceil(cropped.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas de exportação indisponível.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, ...cropped };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Captura o relatório da simulação (HTML) como imagem, expandido e sem rolagem. */
async function captureReport(report: HTMLElement) {
  const { default: html2canvas } = await import('html2canvas');
  report.classList.add('exporting');
  try {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return await html2canvas(report, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: report.scrollWidth,
      height: report.scrollHeight,
      windowWidth: report.scrollWidth,
      windowHeight: report.scrollHeight,
    });
  } finally {
    report.classList.remove('exporting');
  }
}

export async function exportPDF(svg: SVGSVGElement, filename: string, paperSize: PaperSize, report?: HTMLElement) {
  const { canvas, width, height } = await rasterize(svg);
  const { jsPDF } = await import('jspdf');
  const orientation = width >= height ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: paperSize });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = paperSize === 'a4' ? 8 : paperSize === 'a3' ? 10 : 12;
  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;
  const placeImage = (image: HTMLCanvasElement, imageWidth: number, imageHeight: number) => {
    const ratio = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
    const drawWidth = imageWidth * ratio;
    const drawHeight = imageHeight * ratio;
    pdf.addImage(image.toDataURL('image/png'), 'PNG', (pageWidth - drawWidth) / 2, (pageHeight - drawHeight) / 2, drawWidth, drawHeight, undefined, 'FAST');
  };
  placeImage(canvas, width, height);
  if (report) {
    // O relatório da simulação sai na página seguinte, na mesma orientação.
    const reportCanvas = await captureReport(report);
    pdf.addPage(paperSize, orientation);
    placeImage(reportCanvas, reportCanvas.width, reportCanvas.height);
  }
  pdf.save(`${filename}_${paperSize.toUpperCase()}.pdf`);
}

export async function exportJPEG(svg: SVGSVGElement, filename: string, report?: HTMLElement) {
  const { canvas } = await rasterize(svg);
  if (!report) {
    download(canvas.toDataURL('image/jpeg', 0.96), `${filename}.jpg`);
    return;
  }
  // Mapa em cima e relatório embaixo, ajustado à largura do mapa.
  const reportCanvas = await captureReport(report);
  const reportHeight = Math.round(reportCanvas.height * (canvas.width / reportCanvas.width));
  const gap = Math.round(canvas.width * 0.02);
  const combined = document.createElement('canvas');
  combined.width = canvas.width;
  combined.height = canvas.height + gap + reportHeight;
  const context = combined.getContext('2d');
  if (!context) throw new Error('Canvas de exportação indisponível.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, combined.width, combined.height);
  context.drawImage(canvas, 0, 0);
  context.drawImage(reportCanvas, 0, canvas.height + gap, canvas.width, reportHeight);
  download(combined.toDataURL('image/jpeg', 0.96), `${filename}.jpg`);
}

export async function exportSVG(svg: SVGSVGElement, filename: string) {
  const { source } = await croppedSvg(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(url, `${filename}.svg`);
  URL.revokeObjectURL(url);
}
