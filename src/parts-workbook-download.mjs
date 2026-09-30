export function createPartsExportWorker() {
  return new Worker(new URL('./parts-workbook-export.worker.mjs',import.meta.url),{type:'module'})
}
export function createPartsImportWorker() {
  return new Worker(new URL('./parts-workbook-import.worker.mjs',import.meta.url),{type:'module'})
}
