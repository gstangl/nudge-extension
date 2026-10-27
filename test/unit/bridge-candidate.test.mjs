import {test,expect} from 'vitest'
import net from 'node:net'
import {freePort,commandBinding} from '../support/bridge-candidate.mjs'
test('H04 rejects the live default endpoint and an occupied foreign endpoint',async()=>{
 await expect(freePort(4700)).rejects.toThrow('live default')
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
 try{await expect(freePort(port)).rejects.toMatchObject({code:'EADDRINUSE'});expect(server.listening).toBe(true)}finally{await new Promise(r=>server.close(r))}
})
test('H05 executable content is separately bound from Git source',()=>{
 const bound=commandBinding([process.execPath]);expect(bound).toHaveLength(1);expect(bound[0].sha256).toMatch(/^[a-f0-9]{64}$/)
})
