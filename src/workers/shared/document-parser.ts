import * as path from 'path';
import type { PipelineLogger } from '../cv-worker/cv-pipeline.logger';

/**
 * Worker 1: Parse CV (theo sơ đồ)
 * - Upload S3 + checksum mới -> RabbitMQ (xử lý ở user-cv.service)
 * - Worker nhận message → PARSING
 * - PDF: lớp text (pdf-parse, tương đương PyMuPDF extract text) → nếu không đủ text → OCR (Tesseract) sau khi render trang 1 bằng pdf.js + node-canvas
 * - DOCX: mammoth → raw text
 * - Lưu raw_text vào DynamoDB (qua UserCvService.updateProcessing)
 */
import * as mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import { createCanvas } from 'canvas';

const MIN_PDF_TEXT_CHARS = 50;
/** Tránh vượt quá giới hạn item DynamoDB (~400KB) */
const MAX_RAW_TEXT_CHARS = 350_000;

export type DocumentParseSource =
  | 'pdf_text_layer'
  | 'pdf_ocr_tesseract'
  | 'image_ocr_tesseract'
  | 'docx_mammoth'
  | 'unknown';

export function guessFileType(params: {
  contentType?: string;
  filename?: string;
}): 'pdf' | 'docx' | 'image' | 'unknown' {
  const ct = (params.contentType || '').toLowerCase();
  const fn = (params.filename || '').toLowerCase();
  if (ct.includes('pdf') || fn.endsWith('.pdf')) return 'pdf';
  if (ct.includes('word') || fn.endsWith('.docx')) return 'docx';
  if (
    ct.startsWith('image/') ||
    fn.endsWith('.png') ||
    fn.endsWith('.jpg') ||
    fn.endsWith('.jpeg') ||
    fn.endsWith('.webp')
  ) {
    return 'image';
  }
  return 'unknown';
}

function truncateRaw(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_RAW_TEXT_CHARS) return t;
  return t.slice(0, MAX_RAW_TEXT_CHARS);
}

/** Text layer từ PDF (pdfjs-dist legacy, đồng bộ với OCR renderer) */
async function extractPdfTextLayer(buffer: Buffer): Promise<string> {
  if (!buffer?.length) return '';
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs: any = require('pdfjs-dist/legacy/build/pdf.js');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
  });
  const pdfDoc = await loadingTask.promise;
  const maxPages = Math.min(pdfDoc.numPages || 0, 50); // safety
  let out = '';
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const items: any[] = content?.items || [];
    out +=
      items
        .map((it) => (typeof it?.str === 'string' ? it.str : ''))
        .filter(Boolean)
        .join(' ') + '\n';
    if (out.length >= MAX_RAW_TEXT_CHARS) break;
  }
  try {
    await loadingTask.destroy();
  } catch {}
  return out.trim();
}

function pdfHasSelectableText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < MIN_PDF_TEXT_CHARS) return false;
  const letters = (t.match(/[a-zA-ZÀ-ỹ]/g) || []).length;
  return letters >= 20;
}

/** Render trang 1 → PNG → Tesseract (nhánh “không có text / scan”) */
async function pdfFirstPageToPngBuffer(buffer: Buffer): Promise<Buffer | null> {
  try {
    // Use pdfjs-dist v3 legacy build (CommonJS) for Node compatibility.
    // This avoids pdfjs v5 ESM/"exports" issues and API/worker version mismatch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfjs: any = require('pdfjs-dist/legacy/build/pdf.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
      'pdfjs-dist/legacy/build/pdf.worker.js',
    );

    const loadingTask = (pdfjs as any).getDocument({
      data: new Uint8Array(buffer),
    });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const renderTask = page.render({
      canvasContext: ctx as any,
      viewport,
    });
    await renderTask.promise;
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[CV pipeline][Worker1] pdf render for OCR failed:', e);
    return null;
  }
}

async function ocrPngBuffer(png: Buffer): Promise<string> {
  const worker = await createWorker('eng+vie');
  try {
    const {
      data: { text },
    } = await worker.recognize(png);
    return (text || '').trim();
  } finally {
    await worker.terminate();
  }
}

async function extractTextFromImage(
  buffer: Buffer,
  log?: PipelineLogger,
): Promise<{ rawText: string; parseSource: DocumentParseSource }> {
  log?.info('W1:IMAGE:ocr_tesseract', { bytes: buffer.length });
  const text = await ocrPngBuffer(buffer);
  const rawText = truncateRaw(text);
  log?.info('W1:IMAGE:done', { outChars: rawText.length });
  return { rawText, parseSource: 'image_ocr_tesseract' };
}

async function extractTextFromPdf(
  buffer: Buffer,
  log?: PipelineLogger,
): Promise<{ rawText: string; parseSource: DocumentParseSource }> {
  log?.info('W1:PDF:text_layer', { bytes: buffer.length });
  const layerText = await extractPdfTextLayer(buffer);
  const layerLen = layerText.length;
  const hasSelectable = pdfHasSelectableText(layerText);
  log?.info('W1:PDF:text_layer:result', {
    chars: layerLen,
    hasSelectableText: hasSelectable,
  });

  if (hasSelectable) {
    const rawText = truncateRaw(layerText);
    log?.info('W1:PDF:branch', { branch: 'pdf_text_layer', outChars: rawText.length });
    return { rawText, parseSource: 'pdf_text_layer' };
  }

  log?.info('W1:PDF:branch', { branch: 'ocr_tesseract_attempt' });
  const png = await pdfFirstPageToPngBuffer(buffer);
  log?.info('W1:PDF:page1_png', { ok: Boolean(png), pngBytes: png?.length ?? 0 });
  if (png) {
    const ocrText = await ocrPngBuffer(png);
    log?.info('W1:PDF:ocr', { ocrChars: ocrText.length });
    if (ocrText.length > 0) {
      const rawText = truncateRaw(ocrText);
      log?.info('W1:PDF:branch', { branch: 'pdf_ocr_tesseract', outChars: rawText.length });
      return { rawText, parseSource: 'pdf_ocr_tesseract' };
    }
  }

  const rawText = truncateRaw(layerText);
  const parseSource: DocumentParseSource = layerText ? 'pdf_text_layer' : 'pdf_ocr_tesseract';
  log?.warn('W1:PDF:branch', {
    branch: 'fallback_empty_or_weak',
    parseSource,
    outChars: rawText.length,
  });
  return { rawText, parseSource };
}

async function extractTextFromDocx(
  buffer: Buffer,
  log?: PipelineLogger,
): Promise<{ rawText: string; parseSource: DocumentParseSource }> {
  log?.info('W1:DOCX:mammoth', { bytes: buffer.length });
  const res = await mammoth.extractRawText({ buffer });
  const text = (res.value || '').trim();
  const rawText = truncateRaw(text);
  log?.info('W1:DOCX:done', { outChars: rawText.length });
  return { rawText, parseSource: 'docx_mammoth' };
}

export async function parseDocument(
  buffer: Buffer,
  fileType: 'pdf' | 'docx' | 'image' | 'unknown',
  log?: PipelineLogger,
): Promise<{ rawText: string; parseSource: DocumentParseSource }> {
  if (!buffer?.length) {
    log?.warn('W1:input', { reason: 'empty_buffer' });
    return { rawText: '', parseSource: 'unknown' };
  }
  log?.info('W1:start', { fileType, bufferBytes: buffer.length });
  if (fileType === 'pdf') {
    return extractTextFromPdf(buffer, log);
  }
  if (fileType === 'docx') {
    return extractTextFromDocx(buffer, log);
  }
  if (fileType === 'image') {
    return extractTextFromImage(buffer, log);
  }
  log?.warn('W1:unsupported_type', { fileType });
  return { rawText: '', parseSource: 'unknown' };
}
