import http from 'node:http';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export async function createOrderServer({ directory = '.data', token = process.env.MOCK_API_TOKEN || '' } = {}) {
  await mkdir(directory,{recursive:true});
  const file=path.join(directory,'orders.json');
  let orders={};
  try { orders=JSON.parse(await readFile(file,'utf8')); }
  catch(error){ if(error.code!=='ENOENT')throw new Error('Order store is unreadable; refusing to reset idempotency history.'); }
  let tail=Promise.resolve();
  const transaction=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
  const respond=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  return http.createServer(async(req,res)=>{
    if(req.url==='/health'&&req.method==='GET')return respond(res,200,{status:'ok',service:'DealFlow Mock Order API'});
    if(token){const supplied=Buffer.from(req.headers['x-api-key']||'');const expected=Buffer.from(token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return respond(res,401,{error:'Unauthorized'});}
    if(req.url==='/orders'&&req.method==='GET')return respond(res,200,{orders:Object.values(orders)});
    if(req.url!=='/orders'||req.method!=='POST')return respond(res,404,{error:'Not found'});
    let raw='';
    try{
      for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32768)return respond(res,413,{error:'Payload too large'});}
      const payload=JSON.parse(raw),key=req.headers['idempotency-key'];
      if(typeof key!=='string'||!key||key.length>100||payload.quoteId!==key||!Array.isArray(payload.lines)||payload.lines.length<1||payload.lines.length>50||!Number.isFinite(payload.net)||payload.net<0||payload.currency!=='INR')return respond(res,400,{error:'Invalid order contract'});
      if(payload.lines.some(line=>typeof line.sku!=='string'||!line.sku||!Number.isInteger(line.quantity)||line.quantity<=0||!Number.isFinite(line.unitPrice)||line.unitPrice<=0||!Number.isFinite(line.discount)||line.discount<0||line.discount>100||!Number.isFinite(line.net)||line.net<0))return respond(res,400,{error:'Invalid order line'});
      const expectedNet=payload.lines.reduce((sum,line)=>sum+Math.round(line.quantity*line.unitPrice*(1-line.discount/100)*100)/100,0);
      if(Math.abs(expectedNet-payload.net)>0.01)return respond(res,400,{error:'Order total does not match lines'});
      const fingerprint=createHash('sha256').update(raw).digest('hex');
      const result=await transaction(async()=>{
        if(Object.hasOwn(orders,key)){
          if(orders[key].fingerprint!==fingerprint)return {status:409,body:{error:'Idempotency key was already used for a different payload'}};
          return {status:200,body:{orderId:orders[key].orderId,replayed:true}};
        }
        if(req.headers['x-demo-failure']==='before-commit')return {status:503,body:{error:'Simulated outage before commit'}};
        const order={orderId:'ORD-'+randomUUID().slice(0,8).toUpperCase(),quoteId:key,fingerprint,payload,createdAt:new Date().toISOString()};
        const next={...orders,[key]:order};
        // The response is sent only after an atomic file replacement. Single server process only.
        const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(next,null,2));await rename(temporary,file);orders=next;
        if(req.headers['x-demo-failure']==='after-commit')return {status:503,body:{error:'Simulated lost acknowledgement after commit'}};
        return {status:201,body:{orderId:order.orderId,replayed:false}};
      });
      return respond(res,result.status,result.body);
    }catch(error){return respond(res,error instanceof SyntaxError?400:500,{error:error instanceof SyntaxError?'Invalid JSON':'Unable to persist order'});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const host=process.env.HOST||'127.0.0.1';
  if(host!=='127.0.0.1'&&host!=='localhost'&&!process.env.MOCK_API_TOKEN)throw new Error('Set MOCK_API_TOKEN before binding to a non-loopback interface.');
  const server=await createOrderServer();server.listen(Number(process.env.MOCK_PORT||4180),host,()=>console.log(`DealFlow mock API: http://${host}:${server.address().port}`));
}
