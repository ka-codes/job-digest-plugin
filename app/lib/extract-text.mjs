// Extracts plain text from uploaded CV/cover-letter files (.docx, .doc, .pdf,
// .xlsx, .md) at upload time, in this server process — which has full Node
// access, no permission restrictions. This is what makes the headless
// `claude -p` run able to read a CV at all: it never needs to open the
// binary file itself, under its deliberately locked-down tool permissions.
// It just reads the plain-text sidecar this writes alongside the original
// upload. Images are the one exception — see IMAGE_EXTENSIONS below.
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';

// Claude's own Read tool can view an image directly (it's in every headless
// run's allowed tools already) — no library can "extract text" from a CV
// screenshot that isn't already a flat scan, so there's nothing useful to
// pre-extract. Skipping the sidecar for these lets SKILL.md's own "read the
// CV file" instruction fall through to Read-ing the image natively instead
// of silently getting handed garbled bytes as if they were plain text.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export async function extractText(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value;
  }
  if (ext === '.doc') {
    const doc = await new WordExtractor().extract(filePath);
    return doc.getBody();
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: readFileSync(filePath) });
    try {
      const { text } = await parser.getText();
      return text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath);
    return workbook.SheetNames.map(
      (name) => `--- ${name} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
    ).join('\n\n');
  }
  // .md, .txt, or anything else — already plain text.
  return readFileSync(filePath, 'utf8');
}

// Writes `<filePath>.txt` alongside the original and returns its path.
// Returns null for images (see IMAGE_EXTENSIONS) and never throws otherwise
// — a file type extraction can't handle just means no sidecar, not a failed
// upload.
export async function writeTextSidecar(filePath) {
  if (IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return null;
  try {
    const text = await extractText(filePath);
    const sidecarPath = `${filePath}.txt`;
    writeFileSync(sidecarPath, text);
    return sidecarPath;
  } catch (err) {
    console.error(`[extract-text] Could not extract text from ${filePath}:`, err.message);
    return null;
  }
}
