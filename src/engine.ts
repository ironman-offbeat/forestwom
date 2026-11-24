export const RULE_VERSION = '2026-11-24.experimental.1';
export const fields = [
  ['site','대지면적','Site area'], ['gross','연면적','Gross floor area'],
  ['landscape','계획 조경면적','Landscape area'], ['planting','식재면적','Planting area'],
  ['natural','자연지반면적','Natural ground area'], ['roof','옥상조경면적','Roof area'],
  ['wall','벽면녹화면적','Wall area'],
] as const;
export type Key = typeof fields[number][0];
export type Page = { id: string; file: string; number: number; text: string; held: boolean; kind: string };
export type Candidate = { value: string; pageId: string; excerpt: string };
export type Entry = { value: string; pageId: string; note: string; confirmed: boolean };
export type Entries = Record<Key, Entry>;
export const emptyEntries = (): Entries => Object.fromEntries(fields.map(([k]) => [k, {value:'',pageId:'',note:'',confirmed:false}])) as Entries;
export function parseNumber(raw: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw.replaceAll(',',''));
  return Number.isFinite(n) && n <= 1e9 ? n : null;
}
export function extract(pages: Page[]): Record<Key, Candidate[]> {
  return Object.fromEntries(fields.map(([k,ko,en]) => {
    const labels = k === 'landscape' ? '계획\\s*조경면적|조경계획면적|Landscape area' : `${ko}|${en}`;
    // Unit required: an unlabeled number or a percentage must never become an area.
    const re = new RegExp(`(?:${labels})\\s*[:：=]?\\s*([0-9][0-9,.]*)\\s*(?:㎡|m²|m2|제곱미터)(?![a-zA-Z0-9])`, 'gi');
    const matches = pages.flatMap(p => [...p.text.matchAll(re)].filter(m => parseNumber(m[1]) !== null).map(m => ({value:m[1],pageId:p.id,excerpt:m[0]})));
    return [k,matches];
  })) as Record<Key,Candidate[]>;
}
export function classify(text: string) {
  if (/수목일람|plant schedule/i.test(text)) return '수목일람표';
  if (/조경|landscape/i.test(text)) return '조경 관련';
  if (/신청서|application/i.test(text)) return '신청서';
  return '미분류 · 원본 확인';
}
export type Gates = { scope: boolean; law: boolean; conflicts: boolean; lawDate: string; basisDate: string; lawNote: string };
export const emptyGates = (): Gates => ({scope:false,law:false,conflicts:false,lawDate:'',basisDate:'',lawNote:''});
export function todayKorea() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()); }
export function validDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s; }
export function evaluate(entries: Entries, pages: Page[], gates: Gates, today = todayKorea()) {
  const holds: string[] = [];
  if (!pages.length) holds.push('검토할 PDF가 없습니다.');
  if (pages.some(p => p.held)) holds.push('텍스트 부족·스캔 의심 페이지가 있어 판독을 보류합니다.');
  const values = {} as Record<Key,number>;
  for (const [key,label] of fields) {
    const e = entries[key], n = parseNumber(e.value);
    const page = pages.find(p => p.id === e.pageId);
    if (n === null || !e.confirmed || !e.note.trim() || !page || page.held) holds.push(`${label}: 원본 페이지·수치·검수 사유 확정 필요`);
    values[key] = n ?? NaN;
  }
  if (!gates.scope) holds.push('일반 건축물 적용 범위 및 면제·특례 미해당 확인 필요');
  if (!gates.conflicts) holds.push('상충 규칙·정오표 미확보 사항 검토 필요');
  const age = (Date.parse(today)-Date.parse(gates.lawDate))/86400000;
  if (!gates.law || !validDate(gates.lawDate) || age < 0 || age > 30 || !gates.lawNote.trim()) holds.push('법령 원문 확인 기록 필요 (확인일 30일 이내, 미래 날짜 불가)');
  if (!validDate(gates.basisDate) || gates.basisDate < '2025-03-10' || gates.basisDate > today) holds.push('적용기준일 확인 필요 (2025-03-10 이전·미래 사건은 지원하지 않음)');
  if (values.site < 300) holds.push('대지 300㎡ 미만: 면제·완화 및 조례 관계 개별 검토 필요');
  if (values.gross <= 0 || values.site <= 0) holds.push('대지면적·연면적은 0보다 커야 합니다.');
  if (values.roof > 0 || values.wall > 0) holds.push('옥상·벽면녹화 산입은 자동 검산 범위 밖입니다.');
  if (values.landscape > values.site || values.planting > values.landscape || values.natural > values.landscape) holds.push('면적 간 포함 관계 불일치: 대지 ≥ 조경 ≥ 식재/자연지반 확인 필요');
  if (holds.length) return {holds, checks:[], rate:null, required:null};
  const rate = values.gross >= 2000 ? 15 : values.gross >= 1000 ? 10 : 5;
  const required = values.site * rate / 100;
  const checks = [
    {name:'조경 의무면적',actual:values.landscape,required,formula:`${values.site} × ${rate}%`,source:'성남시 건축 조례 제19조 제1항'},
    {name:'식재 의무면적',actual:values.planting,required:required * .5,formula:`${required} × 50%`,source:'조경기준 제4조 제1호'},
    {name:'자연지반 최소면적',actual:values.natural,required:required * .1,formula:`${required} × 10%`,source:'조경기준 제5조 제1항'},
  ].map(c => ({...c,pass:c.actual + 1e-9 >= c.required}));
  return {holds,checks,rate,required};
}
