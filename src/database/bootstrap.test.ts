import { validateBootstrapCredentials } from "./bootstrap"
test("bootstrap requires explicit strong bounded credentials", () => {
    expect(()=>validateBootstrapCredentials({username:'admin-test',password:'Synthetic-password-2026'})).not.toThrow()
    for(const input of [undefined,{username:'a',password:'short'},{username:'admin',password:'short'},{username:'admin',password:'x'.repeat(73)}])
        expect(()=>validateBootstrapCredentials(input as any)).toThrow('Invalid bootstrap credentials')
})

test("administrative password boundaries count Unicode characters and bcrypt bytes",()=>{
    expect(()=>validateBootstrapCredentials({username:'admin',password:'a'.repeat(72)})).not.toThrow()
    expect(()=>validateBootstrapCredentials({username:'admin',password:'\u00e1'.repeat(16)})).not.toThrow()
    for(const password of ['\ud83d\udd12'.repeat(8),'\u00e1'.repeat(37),'valid-passphrase-2026\n'])
        expect(()=>validateBootstrapCredentials({username:'admin',password})).toThrow('Invalid bootstrap credentials')
})
