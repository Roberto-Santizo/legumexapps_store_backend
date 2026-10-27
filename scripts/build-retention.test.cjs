const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash,randomUUID}=require('node:crypto')
const {pruneCompilerBackups}=require('./build.cjs')
test('retention keeps one verified compiler rollback and preserves changed or unknown artifacts',async()=>{
    const base=await fs.mkdtemp(path.join(os.tmpdir(),'legumex-retention-'))
    assert.equal(path.dirname(base),os.tmpdir())
    const backups=path.join(base,'.local-build-backups');await fs.mkdir(backups)
    const paths=[]
    try {
        for(let i=0;i<3;i++){
            const directory=path.join(backups,randomUUID());paths.push(directory);await fs.mkdir(directory)
            const bytes=Buffer.from(`generated ${i}`);await fs.writeFile(path.join(directory,'index.js'),bytes)
            await fs.writeFile(path.join(directory,'.compiler-output.json'),JSON.stringify({producer:'legumex-typescript-build',files:{'index.js':createHash('sha256').update(bytes).digest('hex')}}))
            await fs.utimes(directory,new Date(1000*i),new Date(1000*i))
        }
        const unique=path.join(backups,randomUUID());paths.push(unique);await fs.mkdir(unique);await fs.writeFile(path.join(unique,'user.txt'),'unique user work')
        await pruneCompilerBackups(base)
        assert.equal((await fs.readdir(backups)).length,2)
        assert.equal(await fs.readFile(path.join(unique,'user.txt'),'utf8'),'unique user work')
        await fs.appendFile(path.join(paths[2],'index.js'),' manually changed')
        await pruneCompilerBackups(base,0)
        assert.equal((await fs.readdir(backups)).length,2)
    }finally{
        // Only this test's verified newly-created temporary directory.
        if(path.dirname(base)!==os.tmpdir()||!path.basename(base).startsWith('legumex-retention-'))throw Error('Unsafe test cleanup')
        await fs.rm(base,{recursive:true})
    }
})
