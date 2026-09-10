import { adminDatabase, requirePrivatePath } from './firebase-admin.mjs'
import { workspaceOrders, workspaceShipments } from '../src/reconciliation.mjs'
import { seedIssues } from '../src/domain.mjs'
const uid=process.argv[2],workspace=process.argv[3]||'internal-pilot'
if(!uid||/[.#$\[\]/]/.test(uid+workspace))throw new Error('Usage: node scripts/initialize-firebase-pilot.mjs FIREBASE_AUTH_UID [workspace]')
await requirePrivatePath('supplierCollaboration/workspaces')
const db=adminDatabase(),source=db.ref(`supplierCollaboration/workspaces/${workspace}/source`)
if((await source.get()).exists())throw new Error('Workspace already exists; initialization cannot overwrite it.')
const result=await source.transaction(current=>current===null?{kind:'demo',schemaVersion:1,generation:crypto.randomUUID(),updatedAt:Date.now(),data:{orders:workspaceOrders(),shipments:workspaceShipments(),issues:seedIssues().filter(i=>i.id!=='EX-002')}}:undefined)
if(!result.committed)throw new Error('Workspace initialization conflict.')
await db.ref(`supplierCollaboration/members/${uid}`).set({role:'buyer',workspace})
console.log('Internal fictional pilot initialized. No SAP or Excel records were uploaded.')
process.exit(0)
