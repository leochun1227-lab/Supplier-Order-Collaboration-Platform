import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {buildPartsWorkbookXlsx} from '../src/parts-workbook-export.mjs'
import {cloneBook,setCell,insertRow,deleteRows,insertColumn,deleteColumn} from '../src/parts-workbook.mjs'
const seed=JSON.parse(readFileSync(new URL('../public/parts-workbook.json',import.meta.url)))
const template=readFileSync(new URL('../public/parts-workbook-template.xlsx',import.meta.url))
const directory=new URL('../work/parts-export-qa/',import.meta.url)
mkdirSync(directory,{recursive:true})
writeFileSync(new URL('export-original.xlsx',directory),buildPartsWorkbookXlsx(seed,template,seed))
const book=cloneBook(seed),sheet=book.sheets[0]
setCell(sheet,'s0-r4',9,'30');setCell(sheet,'s0-r4',19,'0');setCell(sheet,'s0-r4',13,'2026-09-11');setCell(sheet,'s0-r4',26,'导出验证 & <保留格式>')
const id=insertRow(sheet,4);setCell(sheet,id,8,'NEW-PART');setCell(sheet,id,9,'12')
deleteRows(sheet,['s0-r6']);insertColumn(sheet,9);deleteColumn(sheet,0)
writeFileSync(new URL('export-edited.xlsx',directory),buildPartsWorkbookXlsx(book,template,seed))
writeFileSync(new URL('export-edited.json',directory),JSON.stringify(book))
console.log('Created original and edited exports for independent Excel validation.')
