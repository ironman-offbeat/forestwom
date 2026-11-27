import { it, expect, vi } from 'vitest';
vi.mock('../server/requests.mjs',()=>({requestAction:vi.fn(async()=>({ok:true}))}));
// @ts-ignore native Vercel handler
import handler from '../api/requests.mjs';
// @ts-ignore native server module
import {requestAction} from '../server/requests.mjs';
it('review operations work without credentials or a cookie',async()=>{
 for(const action of ['list','detail','read','state','resultBegin','publish','saveReview']){
  const res:any={setHeader:vi.fn(),json:vi.fn(),status:vi.fn()};res.status.mockReturnValue(res);
  await handler({method:'POST',headers:{origin:'https://forestwom.2hayoung.com'},body:{action,id:'request_12345'}},res);
  expect(res.json).toHaveBeenCalledWith({ok:true});
  expect(requestAction).toHaveBeenLastCalledWith(action,{action,id:'request_12345'},process.env,fetch,true);
  expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie',expect.anything());
 }
});
it('still rejects cross-origin review writes',async()=>{
 const res:any={setHeader:vi.fn(),json:vi.fn(),status:vi.fn()};res.status.mockReturnValue(res);
 await handler({method:'POST',headers:{origin:'https://other.example'},body:{action:'publish'}},res);
 expect(res.status).toHaveBeenCalledWith(403);
});
