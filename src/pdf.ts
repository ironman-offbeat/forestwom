import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {classify, type Page} from './engine';
GlobalWorkerOptions.workerSrc = workerUrl;
export type Document = {id:string; name:string; pdf:PDFDocumentProxy; pages:Page[]};
export async function readPDF(file: File): Promise<Document> {
  if (file.size > 30*1024*1024) throw new Error('파일당 30MB 이하만 지원합니다.');
  if (!/\.pdf$/i.test(file.name)) throw new Error('PDF 파일만 선택하세요.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('PDF 파일 형식이 아닙니다.');
  const assetBase = `${import.meta.env.BASE_URL}pdfjs/`;
  const task = getDocument({data:bytes, enableXfa:false, useSystemFonts:true,
    cMapUrl:`${assetBase}cmaps/`,cMapPacked:true,standardFontDataUrl:`${assetBase}standard_fonts/`,wasmUrl:`${assetBase}wasm/`});
  // No password prompt or embedded document scripts/actions are executed.
  task.onPassword = () => { void task.destroy(); };
  let pdf: PDFDocumentProxy;
  try { pdf = await task.promise; } catch { throw new Error('손상되었거나 암호화된 PDF입니다. 비식별 PDF를 확인하세요.'); }
  try {
    if (pdf.numPages > 100) throw new Error('파일당 100페이지 이하만 지원합니다.');
    const id = crypto.randomUUID(), pages:Page[] = [];
    for (let number=1;number<=pdf.numPages;number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n':' ') : '').join('');
      pages.push({id:`${id}:${number}`,file:file.name,number,text,held:text.replace(/\s/g,'').length<30,kind:classify(text)});
    }
    return {id,name:file.name,pdf,pages};
  } catch(e) { await pdf.loadingTask.destroy(); throw e; }
}

