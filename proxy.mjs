// Experimental display projection only. Never edits rollouts or model requests.
import http from 'node:http';
import https from 'node:https';
import {pathToFileURL} from 'node:url';
import WebSocket, {WebSocketServer} from 'ws';

const visible = item => ['userMessage','agentMessage'].includes(item?.type);
export const MESSAGE_LIMIT=49;
export function lastMessages(turns) {
  let left=MESSAGE_LIMIT; const result=[];
  for(let i=turns.length-1;i>=0 && left>0;i--){
    const turn=turns[i], items=turn.items??[]; let start=items.length;
    for(let j=items.length-1;j>=0;j--){
      start=j;
      if(visible(items[j]) && --left===0) break;
    }
    result.unshift({...turn,items:items.slice(start)});
  }
  return result;
}
export class Projection {
  constructor(thread){this.thread=thread;this.requests=new Map();this.chunks=new Map();this.count=0;}
  key(e,id){return JSON.stringify([e.client_id,e.stream_id,id]);}
  inbound(e){
    const m=e.type==='client_message'?e.message:null;
    if(m?.params?.threadId!==this.thread || m.id===undefined)return e;
    const methods=['thread/read','thread/resume','thread/turns/list','thread/items/list'];
    if(!methods.includes(m.method))return e;
    this.requests.set(this.key(e,m.id),{method:m.method,params:{...m.params}});
    if(this.requests.size>2000)this.requests.delete(this.requests.keys().next().value);
    console.log(JSON.stringify({event:'history-request',method:m.method,cursor:!!m.params.cursor}));
    // Ask for the newest complete turns; restore the requested order in the reply.
    if(m.method==='thread/turns/list')return {...e,message:{...m,params:{...m.params,cursor:null,limit:MESSAGE_LIMIT,sortDirection:'desc',itemsView:'full'}}};
    return e;
  }
  project(m,e){
    const req=this.requests.get(this.key(e,m.id));
    if(m.result?.thread?.id===this.thread && Array.isArray(m.result.thread.turns)){
      const before=m.result.thread.turns,after=lastMessages(before);
      this.record(before,after);
      return {...m,result:{...m.result,thread:{...m.result.thread,turns:after}}};
    }
    if(req?.method==='thread/turns/list' && Array.isArray(m.result?.data)){
      const before=[...m.result.data].reverse();
      const after=lastMessages(before);this.record(before,after);
      return {...m,result:{...m.result,data:req.params.sortDirection==='asc'?after:after.reverse(),nextCursor:null,backwardsCursor:null}};
    }
    return m;
  }
  record(before,after){
    this.count++;
    const count=ts=>ts.reduce((n,t)=>n+(t.items??[]).filter(visible).length,0);
    console.log(JSON.stringify({event:'history-projected',before:count(before),after:count(after)}));
  }
  outbound(e){
    if(e.type==='server_message')return [{...e,message:this.project(e.message,e)}];
    if(e.type!=='server_message_chunk')return [e];
    const key=this.key(e,e.seq_id);
    let entry=this.chunks.get(key);
    if(!entry){
      entry={parts:new Map()};this.chunks.set(key,entry);
      if(this.chunks.size>100)this.chunks.delete(this.chunks.keys().next().value);
    }
    entry.parts.set(e.segment_id,e);
    if(entry.parts.size!==e.segment_count)return [];
    this.chunks.delete(key);
    const parts=[...entry.parts.values()].sort((a,b)=>a.segment_id-b.segment_id);
    const raw=Buffer.concat(parts.map(p=>Buffer.from(p.message_chunk_base64,'base64')));
    let projected;
    try {projected=Buffer.from(JSON.stringify(this.project(JSON.parse(raw),e)));}
    catch {return parts;}
    if(projected.length>raw.length)return parts;
    // Preserve chunk IDs, counts and byte sizes, so relay ACK/replay stays unchanged.
    const padded=Buffer.alloc(raw.length,32);projected.copy(padded);let offset=0;
    return parts.map(p=>{const length=Buffer.from(p.message_chunk_base64,'base64').length;
      const output={...p,message_chunk_base64:padded.subarray(offset,offset+length).toString('base64')};offset+=length;return output;});
  }
}
const hop=new Set(['host','connection','upgrade','content-length','transfer-encoding','accept-encoding',
 'sec-websocket-key','sec-websocket-version','sec-websocket-extensions']);
function headers(input){return Object.fromEntries(Object.entries(input).filter(([k])=>!hop.has(k.toLowerCase())));}
export function serve({port=18749,thread,upstream='https://chatgpt.com'}){
  if(!thread)throw Error('A single test thread ID is required');
  const projection=new Projection(thread);
  const server=http.createServer((req,res)=>{
    if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,limit:MESSAGE_LIMIT,projections:projection.count}));return;}
    if(!req.url.startsWith('/backend-api/')){res.writeHead(404);res.end();return;}
    const target=new URL(upstream);target.pathname=req.url.split('?')[0];target.search=req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'';
    const request=https.request(target,{method:req.method,headers:headers(req.headers)},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    req.pipe(request);res.on('close',()=>request.destroy());
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:128*1024*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url.split('?')[0]!=='/backend-api/wham/remote/control/server'){socket.destroy();return;}
    const url=new URL(upstream);url.protocol='wss:';url.pathname=req.url.split('?')[0];url.search=req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'';
    const remote=new WebSocket(url,{headers:headers(req.headers),maxPayload:128*1024*1024,perMessageDeflate:false});
    remote.once('error',()=>socket.destroy());
    remote.once('open',()=>wss.handleUpgrade(req,socket,head,local=>{
      console.log(JSON.stringify({event:'remote-connected'}));
      const relay=(source,dest,transform)=>source.on('message',(raw,binary)=>{
        if(dest.readyState!==WebSocket.OPEN)return;
        try{const outputs=transform(JSON.parse(raw));for(const output of outputs)dest.send(JSON.stringify(output));}
        catch{dest.send(raw,{binary});}
      });
      relay(remote,local,e=>[projection.inbound(e)]);
      relay(local,remote,e=>projection.outbound(e));
      local.on('close',()=>remote.close());remote.on('close',()=>local.close());
      local.on('error',()=>remote.close());remote.on('error',()=>local.close());
    }));
  });
  server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'listening',port})));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)serve({thread:process.env.LAST20_THREAD});
