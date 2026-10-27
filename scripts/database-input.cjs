"use strict"
function selection(args,env,parse) {
    if(args.length!==2 || args[0]!=='--env' || !['development','production'].includes(args[1]))
        throw Error('Select an explicit development or production environment')
    const environment=args[1],key=environment==='development'?'DEV_DATABASE_URL':'PROD_DATABASE_URL'
    if(!env[key]) throw Error(`Missing ${key}; no fallback to DATABASE_URL`)
    const target=parse(env[key],environment,env.DATABASE_CA_CERT||undefined)
    const other=env[environment==='development'?'PROD_DATABASE_URL':'DEV_DATABASE_URL']
    if(other) {
        // Comparison only: the selected connection's CA does not configure the unused destination.
        const alternate=parse(other,environment==='development'?'production':'development')
        if(target.host===alternate.host && target.port===alternate.port && target.database===alternate.database)
            throw Error('Development and production must use different databases')
    }
    return {environment,target}
}
module.exports={selection}
