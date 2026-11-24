import {describe,it,expect} from 'vitest';
import {emptyEntries,emptyGates,evaluate,extract,fields,parseNumber,type Page} from '../src/engine';
const pages:Page[]=[{id:'a:1',file:'fake.pdf',number:1,text:'가상 조경계획도',held:false,kind:'조경'}];
function ready(){const entries=emptyEntries(); const values=[1000,2000,160,80,20,0,0];fields.forEach(([k],i)=>entries[k]={value:String(values[i]),pageId:'a:1',note:'가상 원본 확인',confirmed:true});return {entries,gates:{...emptyGates(),scope:true,law:true,conflicts:true,lawDate:'2026-11-24',basisDate:'2026-11-24',lawNote:'원문 및 부칙 확인'}};}
describe('conservative rule engine',()=>{
  it.each([[999.99,5],[1000,10],[1999.99,10],[2000,15]])('gross %s selects %s percent',(gross,rate)=>{const {entries,gates}=ready();entries.gross.value=String(gross);expect(evaluate(entries,pages,gates,'2026-11-24').rate).toBe(rate);});
  it('uses mandatory area, not planned area, as planting/natural denominator',()=>{const {entries,gates}=ready();entries.landscape.value='500';const r=evaluate(entries,pages,gates,'2026-11-24');expect(r.checks.map(c=>c.required)).toEqual([150,75,15]);});
  it('reports deficits without rounding an insufficient amount into compliance',()=>{const {entries,gates}=ready();entries.landscape.value='149.999999';expect(evaluate(entries,pages,gates,'2026-11-24').checks[0].pass).toBe(false);});
  it.each(['','-1','NaN','Infinity','1e3','1,00','1.2.3','100㎡','1000000001'])('rejects invalid value %s',raw=>expect(parseNumber(raw)).toBeNull());
  it('allows well-formed comma separated decimals',()=>expect(parseNumber('1,000.25')).toBe(1000.25));
  it.each([199,200,299.99])('holds small site %s',(n)=>{const {entries,gates}=ready();entries.site.value=String(n);expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
  it('accepts site 300 boundary',()=>{const {entries,gates}=ready();entries.site.value='300';expect(evaluate(entries,pages,gates,'2026-11-24').holds).toHaveLength(0);});
  it('holds missing confirmation or fabricated page reference',()=>{const {entries,gates}=ready();entries.site.pageId='missing';expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);entries.site.pageId='a:1';entries.site.confirmed=false;expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
  it('holds mixed scan documents even if values were confirmed',()=>{const {entries,gates}=ready();expect(evaluate(entries,[...pages,{...pages[0],id:'b:1',held:true}],gates,'2026-11-24').checks).toHaveLength(0);});
  it.each(['2026-10-24','2026-11-25','2026-02-30',''])('blocks stale/future/invalid check date %s',date=>{const {entries,gates}=ready();gates.lawDate=date;expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
  it('holds old applicability date',()=>{const {entries,gates}=ready();gates.basisDate='2024-01-01';expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
  it.each(['scope','law','conflicts'] as const)('requires %s gate',key=>{const {entries,gates}=ready();gates[key]=false;expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
  it.each(['roof','wall'] as const)('holds unsupported %s credits',key=>{const {entries,gates}=ready();entries[key].value='10';expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
  it('rejects inconsistent area hierarchy',()=>{const {entries,gates}=ready();entries.planting.value='170';expect(evaluate(entries,pages,gates,'2026-11-24').checks).toHaveLength(0);});
});
describe('source-preserving extraction',()=>{
  it('retains all conflicting values with exact source pages',()=>{const r=extract([{...pages[0],text:'대지면적: 1,000.25 ㎡'},{...pages[0],id:'b:2',text:'대지면적 1200 m2'}]);expect(r.site.map(c=>[c.value,c.pageId])).toEqual([['1,000.25','a:1'],['1200','b:2']]);});
  it('does not treat legal percentage or unlabeled numbers as plan area',()=>{const r=extract([{...pages[0],text:'법정 조경면적 150 m2 조경면적 15% 대지면적 1000 계획 조경면적 160㎡'}]);expect(r.landscape.map(c=>c.value)).toEqual(['160']);expect(r.site).toHaveLength(0);});
  it('rejects corrupt number formatting instead of guessing',()=>expect(extract([{...pages[0],text:'대지면적 1,00㎡'}]).site).toHaveLength(0));
});
