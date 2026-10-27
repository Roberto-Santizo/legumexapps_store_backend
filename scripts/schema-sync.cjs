"use strict"
const {createInterface}=require('node:readline/promises')
const {selection}=require('./database-input.cjs')

async function main(args,env,adapters={}) {
    if(args.length!==1 || !['development','production'].includes(args[0])) throw Error('Use npm run db:dev or npm run db:prod')
    await (adapters.verifyBuild??(()=>require('./build-integrity.cjs').run('verify')))()
    require('reflect-metadata')
    const {parseDatabaseConnection}=require('../dist/config/databaseConnection.js')
    const {synchronizeSchema}=require('../dist/database/schemaSync.js')
    const {databaseModels}=require('../dist/database/models.js')
    const {Sequelize}=require('sequelize-typescript')
    const {environment,target}=selection(['--env',args[0]],env,parseDatabaseConnection)
    const details={environment,host:target.host,port:target.port,database:target.database,user:target.username,tls:target.ssl!==false}
    console.log(JSON.stringify(details,null,2))
    if(environment==='production') {
        const expected=`SYNC production ${JSON.stringify([target.host,target.port,target.database,target.username])}`
        const issued=Date.now()
        let answer
        if(adapters.confirm) answer=await adapters.confirm(expected,details)
        else {
            if(!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Interactive production confirmation required')
            const reader=createInterface({input:process.stdin,output:process.stdout})
            try{answer=await reader.question(`Type exactly: ${expected}\n> `)}finally{reader.close()}
        }
        if(answer!==expected || Date.now()-issued>120000 || Date.now()<issued) throw Error('Production confirmation incorrect or expired')
    }
    const db=new Sequelize(target.database,target.username,target.password,{dialect:'postgres',host:target.host,port:target.port,
        logging:false,models:databaseModels,dialectOptions:{ssl:target.ssl,options:'-c search_path=public',connectionTimeoutMillis:10000}})
    try {
        const [identity]=await db.query('SELECT current_database() AS database,current_user AS role',{type:require('sequelize').QueryTypes.SELECT})
        if(identity.database!==target.database || identity.role!==target.username) throw Error('Connected destination mismatch')
        await synchronizeSchema(db)
        console.log('Schema synchronized and verified. Existing data and PostgreSQL complements preserved.')
    } finally { await db.close() }
}
function failureMessage(error) {
    if(error?.name==='SchemaCompatibilityError') return error.message
    if(/^(Use npm|Missing (DEV|PROD)_DATABASE_URL|Development and production must|Interactive production|Production confirmation|Connected destination)/.test(error?.message??'')) return error.message
    return `Schema synchronization failed; no changes committed. Check build, TLS, privileges and model compatibility (${error?.original?.code?.match(/^[0-9A-Z]{5}$/)?.[0]??'details suppressed'}).`
}
module.exports={main,failureMessage}
if(require.main===module)main(process.argv.slice(2),process.env).catch(error=>{console.error(failureMessage(error));process.exitCode=1})
