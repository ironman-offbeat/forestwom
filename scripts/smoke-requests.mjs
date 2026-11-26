// Explicit opt-in: creates one synthetic request and published result in production Drive.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
if(!process.argv.includes('--live-production')||!process.env.ADMIN_KEY)throw Error('Requires --live-production and server-only ADMIN_KEY.');
const endpoint='https://forestwom.2hayoung.com/api/requests';let cookie='';
async function api(action,body={},admin=false){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(admin?{Cookie:cookie}:{})},body:JSON.stringify({action,...body})});const data=await r.json();if(!r.ok)throw Error(`${action}: ${data.error}`);if(action==='login')cookie=r.headers.get('set-cookie').split(';')[0];return data;}
const sha=b=>createHash('sha256').update(b).digest('hex');
const original=await readFile('public/samples/korean.pdf');
const files=[{name:'가상한글도면.pdf',type:'application/pdf',size:original.length,hash:sha(original)}];
await api('login',{key:process.env.ADMIN_KEY});
const session=await api('begin',{name:'화면 분리 통합 검증 - 가상 도면',note:'자동화 기능 검증용 가상 자료. 실제 법령 적합성 검토 결과가 아닙니다.',files});
async function upload(s,buffers){for(let index=0;index<buffers.length;index++){const t=await api('upload',{session:s,index});if(t.complete)continue;for(let offset=0;offset<buffers[index].length;offset+=1048576)await api('chunk',{ticket:t.ticket,offset,data:buffers[index].subarray(offset,offset+1048576).toString('base64')});}}
await upload(session.session,[original]);
const done=await api('finish',{session:session.session});assert.equal(done.state,'submitted');
const detail=await api('detail',{id:session.id},true);assert.equal(detail.originals[0].hash,sha(original));
await api('state',{id:session.id,state:'analyzing'},true);
const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const result={schemaVersion:1,requestId:session.id,reviewer:'기능 검증',reviewedAt:date,summary:'접수·결과 업로드·공개·다운로드 기능을 확인하는 가상 결과입니다. 법령 적합성 판정은 하지 않았습니다.',originals:files.map(({name,hash})=>({name,hash})),findings:[{title:'가상 자료 등록',status:'보류',detail:'기능 테스트이며 원본 검토를 대신하지 않습니다.',sources:[{file:files[0].name,page:1,quote:'가상 자료'}]}],holds:['실제 도면 검토 및 법령 적용 판단은 수행하지 않았습니다.'],lawConfirmed:true,lawCheckedAt:date,lawNote:'자동화 게이트 통과 테스트용 값. 실제 법령 확인 기록으로 사용하지 않습니다.'};
const json=Buffer.from(JSON.stringify(result));const report=await readFile('test-results/generated-review.pdf');
const outputs=[{name:'report.pdf',type:'application/pdf',size:report.length,hash:sha(report)},{name:'result.json',type:'application/json',size:json.length,hash:sha(json)}];
const rs=await api('resultBegin',{id:session.id,files:outputs},true);await upload(rs.session,[report,json]);
await api('publish',{id:session.id,session:rs.session,confirmed:true},true);
const published=await api('get',{id:session.id});assert.equal(published.state,'published');assert.equal(published.result.requestId,session.id);
const parts=[];for(let offset=0;offset<report.length;offset+=1048576){const b=await api('read',{id:session.id,file:published.pdf.id,offset});parts.push(Buffer.from(b.data,'base64'));}assert.equal(sha(Buffer.concat(parts)),sha(report));
await api('logout',{},true);
const evidence={id:session.id,url:`https://forestwom.2hayoung.com/#/result/${session.id}`,notification:done.notification.state,checks:['intake','original hash','administrator login','state update','publish','anonymous result','PDF download hash'],checkedAt:new Date().toISOString()};
await writeFile('test-results/live-request.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
