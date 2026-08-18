import {describe,expect,it} from 'vitest';
import {NdjsonParser} from '../src/agent/ndjson-parser.js';
import {migrateLegacy} from '../src/persistence/migrate-v1.js';
describe('NDJSON parser',()=>{it('parses incremental lines and reports malformed input',()=>{const values:unknown[]=[];const bad:string[]=[];const parser=new NdjsonParser(v=>values.push(v),v=>bad.push(v));parser.push('{"a":');parser.push('1}\nnot-json\n{"b":2}');parser.end();expect(values).toEqual([{a:1},{b:2}]);expect(bad).toEqual(['not-json']);});});
describe('legacy migration',()=>{it('marks processing unknown without replaying the prompt',()=>{const state=migrateLegacy([{threadId:'t',channelId:'t',sessionId:'s',isProcessing:true,lastPrompt:'danger'}],10);expect(Object.values(state.requests)[0]).toMatchObject({state:'interrupted_unknown',prompt:'[legacy prompt withheld]'});expect(JSON.stringify(state)).not.toContain('danger');expect(state.outbox).toHaveLength(1);});});
