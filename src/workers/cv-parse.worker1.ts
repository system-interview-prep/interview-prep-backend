import type { PipelineLogger } from './cv-pipeline.logger';

/**
 * Worker 1: Parse CV (theo sơ đồ)
 * - Upload S3 + checksum mới → SQS (xử lý ở user-cv.service)
 * - Worker nhận message → PARSING
 * - PDF: lớp text (pdf-parse, tương đương PyMuPDF extract text) → nếu không đủ text → OCR (Tesseract) sau khi render trang 1 bằng pdf.js + node-canvas
 * - DOCX: mammoth → raw text
 * - Lưu raw_text vào DynamoDB (qua UserCvService.updateProcessing)
 */
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { createCanvas } from 'canvas';

const MIN_PDF_TEXT_CHARS = 50;
/** Tránh vượt quá giới hạn item DynamoDB (~400KB) */
const MAX_RAW_TEXT_CHARS = 350_000;

export type CvParseSource =
  | 'pdf_text_layer'
  | 'pdf_ocr_tesseract'
  | 'docx_mammoth'
  | 'unknown';

export function guessFileType(params: {
  contentType?: string;
  filename?: string;
}): 'pdf' | 'docx' | 'unknown' {
  const ct = (params.contentType || '').toLowerCase();
  const fn = (params.filename || '').toLowerCase();
  if (ct.includes('pdf') || fn.endsWith('.pdf')) return 'pdf';
  if (ct.includes('word') || fn.endsWith('.docx')) return 'docx';
  return 'unknown';
}

function truncateRaw(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_RAW_TEXT_CHARS) return t;
  return t.slice(0, MAX_RAW_TEXT_CHARS);
}

/** Text layer từ PDF (pdf-parse v2: class PDFParse + getText — tương đương nhánh “PDF có text”) */
async function extractPdfTextLayer(buffer: Buffer): Promise<string> {
  if (!buffer?.length) return '';
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return (result?.text || '').trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
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
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const { pathToFileURL } = await import('url');
    const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

    const loadingTask = (pdfjs as any).getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
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
      canvas,
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

async function extractTextFromPdf(
  buffer: Buffer,
  log?: PipelineLogger,
): Promise<{ rawText: string; parseSource: CvParseSource }> {
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
  const parseSource: CvParseSource = layerText ? 'pdf_text_layer' : 'pdf_ocr_tesseract';
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
): Promise<{ rawText: string; parseSource: CvParseSource }> {
  log?.info('W1:DOCX:mammoth', { bytes: buffer.length });
  const res = await mammoth.extractRawText({ buffer });
  const text = (res.value || '').trim();
  const rawText = truncateRaw(text);
  log?.info('W1:DOCX:done', { outChars: rawText.length });
  return { rawText, parseSource: 'docx_mammoth' };
}

export async function worker1ParseCv(
  buffer: Buffer,
  fileType: 'pdf' | 'docx' | 'unknown',
  log?: PipelineLogger,
): Promise<{ rawText: string; parseSource: CvParseSource }> {
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
  log?.warn('W1:unsupported_type', { fileType });
  return { rawText: '', parseSource: 'unknown' };
}
