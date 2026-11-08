import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = path.resolve(process.argv[2] || 'data/test-public.pdf');
const outDir = path.resolve(process.argv[3] || 'data/pdf-pages');
fs.mkdirSync(outDir, { recursive: true });

const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
console.log(`pages: ${doc.numPages}`);

for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  const out = path.join(outDir, `page-${i}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  const text = await page.getTextContent();
  const content = text.items.map((item) => item.str).join(' ');
  console.log(`page ${i}: ${canvas.width}x${canvas.height}, text ${content.length} chars`);
  console.log(content.slice(0, 220).replace(/\s+/g, ' '));
}
