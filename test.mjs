import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lastMessages,Projection} from './proxy.mjs';
const turns=Array.from({length:30},(_,i)=>({id:`t${i}`,items:[{id:`u${i}`,type:'userMessage'},{id:`tool${i}`,type:'commandExecution'},{id:`a${i}`,type:'agentMessage'}]}));
test('retains last 49 conversational messages and does not mutate history',()=>{
  const before=JSON.stringify(turns),out=lastMessages(turns);
  assert.equal(out.reduce((n,t)=>n+t.items.filter(i=>['userMessage','agentMessage'].includes(i.type)).length,0),49);assert.equal(out.length,25);assert.equal(out[0].items[0].id,'a5');assert.equal(out.at(-1).items.at(-1).id,'a29');assert.equal(JSON.stringify(turns),before);
});
test('legacy response, unrelated threads, and page ordering',()=>{
  const p=new Projection('target'),e={client_id:'c',stream_id:'s'};
  const m={id:1,result:{thread:{id:'target',turns}}};assert.equal(p.project(m,e).result.thread.turns.length,25);
  const other={result:{thread:{id:'other',turns}}};assert.equal(p.project(other,e),other);
  const request=p.inbound({...e,type:'client_message',message:{id:2,method:'thread/turns/list',params:{threadId:'target',sortDirection:'asc'}}});
  assert.equal(request.message.params.sortDirection,'desc');
  const out=p.project({id:2,result:{data:[...turns].reverse(),nextCursor:'old'}},e);
  assert.equal(out.result.data[0].id,'t5');assert.equal(out.result.nextCursor,null);
});
test('segmented reply retains transport ACK IDs, lengths and original history',()=>{
  const p=new Projection('target'),raw=Buffer.from(JSON.stringify({id:1,result:{thread:{id:'target',turns}}}));
  const midpoint=Math.floor(raw.length/2),parts=[raw.subarray(0,midpoint),raw.subarray(midpoint)];
  const env=parts.map((b,i)=>({type:'server_message_chunk',client_id:'c',stream_id:'s',seq_id:4,segment_id:i,segment_count:2,message_size_bytes:raw.length,message_chunk_base64:b.toString('base64')}));
  assert.deepEqual(p.outbound(env[0]),[]);const out=p.outbound(env[1]);assert.equal(out.length,2);
  out.forEach((e,i)=>{assert.equal(e.seq_id,4);assert.equal(e.segment_id,i);assert.equal(Buffer.from(e.message_chunk_base64,'base64').length,parts[i].length)});
  const decoded=JSON.parse(Buffer.concat(out.map(e=>Buffer.from(e.message_chunk_base64,'base64'))));assert.equal(decoded.result.thread.turns.length,25);assert.equal(turns.length,30);
});
