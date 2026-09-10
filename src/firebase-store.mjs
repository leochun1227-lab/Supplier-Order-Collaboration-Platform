import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getDatabase, ref, get, query, orderByChild, limitToLast, onValue, runTransaction, serverTimestamp } from 'firebase/database'
import { projectState, hydrateState, revisionKey, changeSummary } from './persistence.mjs'

export const databaseURL='https://supplier-collaboration-30ddf-default-rtdb.asia-southeast1.firebasedatabase.app'
export const cloudConfigured=!!import.meta.env.VITE_FIREBASE_API_KEY
const ROOT='supplierCollaboration'
let app,auth,db
function init(){
  if(!cloudConfigured)throw new Error('cloud_not_configured')
  if(!app){app=initializeApp({apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:'supplier-collaboration-30ddf.firebaseapp.com',projectId:'supplier-collaboration-30ddf',databaseURL});auth=getAuth(app);db=getDatabase(app)}
}
export async function connectCloud(email,password,onChange,onError){
  init();await setPersistence(auth,browserSessionPersistence)
  await signInWithEmailAndPassword(auth,email,password)
  let unsubSource,unsubVersions
  try{
    const member=(await get(ref(db,`${ROOT}/members/${auth.currentUser.uid}`))).val()
    // Pilot access is internal-only. Supplier access needs a supplier-scoped source projection.
    if(member?.role!=='buyer'||!member.workspace||/[.#$\[\]/]/.test(member.workspace))throw new Error('membership_required')
    const base=`${ROOT}/workspaces/${member.workspace}`
    let source=(await get(ref(db,`${base}/source`))).val()
    if(source?.kind!=='demo'||source?.schemaVersion!==1)throw new Error('source_not_ready')
    let latest={},revision=0
    const readState=version=>version.stateJson?JSON.parse(version.stateJson):undefined
    function deliver(){onChange({state:hydrateState(source.data,readState(latest)),revision,generation:source.generation,sourceUpdatedAt:source.updatedAt,savedAt:latest.at||null,email:auth.currentUser?.email})}
    const versions=query(ref(db,`${base}/versions`),orderByChild('revision'),limitToLast(1))
    const initial=(await get(versions)).val()||{}
    latest=Object.values(initial)[0]||{};revision=latest.revision||0
    const connection={
      get revision(){return revision},
      async save(state,action,expectedRevision,expectedGeneration){
        if(!auth.currentUser)throw new Error('auth_required')
        if(expectedRevision!==revision||expectedGeneration!==source.generation)throw new Error('save_conflict')
        const next=projectState(state),previous=readState(latest)||projectState(hydrateState(source.data))
        const changes=changeSummary(previous,next)
        if(!changes.length)return
        // JSON preserves cleared fields and empty arrays that RTDB otherwise removes.
        const payload={revision:expectedRevision+1,sourceGeneration:source.generation,actor:auth.currentUser.uid,at:serverTimestamp(),action,stateJson:JSON.stringify(next),changes}
        // Immutable version, create only. Concurrent writers contend for the SAME revision.
        const result=await runTransaction(ref(db,`${base}/versions/${revisionKey(expectedRevision+1)}`),current=>current===null?payload:undefined,{applyLocally:false})
        if(!result.committed)throw new Error('save_conflict')
        latest=result.snapshot.val();revision=latest.revision
        return {revision,at:latest.at}
      },
      async disconnect(){unsubSource?.();unsubVersions?.();await signOut(auth)},
    }
    deliver()
    unsubSource=onValue(ref(db,`${base}/source`),snapshot=>{const value=snapshot.val();if(value?.kind!=='demo'||value.schemaVersion!==1){onError(new Error('source_not_ready'));return}source=value;deliver()},onError)
    unsubVersions=onValue(versions,snapshot=>{latest=Object.values(snapshot.val()||{})[0]||{};revision=latest.revision||0;deliver()},onError)
    return connection
  }catch(e){unsubSource?.();unsubVersions?.();await signOut(auth);throw e}
}
