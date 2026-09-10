import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
export const databaseURL='https://supplier-collaboration-30ddf-default-rtdb.asia-southeast1.firebasedatabase.app'
export function adminDatabase(){
  if(!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a local service-account file; never place it in the web build.')
  const app=initializeApp({projectId:'supplier-collaboration-30ddf',databaseURL,...(!process.env.FIREBASE_DATABASE_EMULATOR_HOST?{credential:applicationDefault()}:{})})
  return getDatabase(app)
}
export async function requirePrivatePath(path){
  if(process.env.FIREBASE_DATABASE_EMULATOR_HOST)return
  const response=await fetch(`${databaseURL}/${path}.json?shallow=true`,{signal:AbortSignal.timeout(15000)})
  if(response.status!==401&&response.status!==403)throw new Error('Anonymous read is not denied. Protect this database path before publishing private records.')
}
