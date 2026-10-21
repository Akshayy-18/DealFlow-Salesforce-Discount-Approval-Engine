import { defaultRules, evaluate, decideRequest } from './policy.mjs';
export const catalog=Object.freeze([
  {sku:'DF-START',name:'Sales Starter',price:12000},
  {sku:'DF-ANALYTICS',name:'Analytics Pro',price:24000},
  {sku:'DF-SUPPORT',name:'Support Plus',price:6000},
]);
export function priceLines(inputs){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>50)throw new Error('Add between 1 and 50 product lines.');
  const lines=inputs.map(input=>{
    const product=catalog.find(item=>item.sku===input.sku);
    if(!product)throw new Error('Choose an active product.');
    if(!Number.isInteger(input.quantity)||input.quantity<1||input.quantity>100000)throw new Error('Quantity must be a whole number from 1 to 100000.');
    if(!Number.isFinite(input.discount)||input.discount<0||input.discount>100||Math.abs(input.discount*100-Math.round(input.discount*100))>1e-7)throw new Error('Discount must have at most two decimal places and be between 0 and 100.');
    const gross=product.price*input.quantity,net=Math.round(gross*(1-input.discount/100)*100)/100;
    return {...product,quantity:input.quantity,discount:input.discount,gross,net};
  });
  const gross=lines.reduce((sum,line)=>sum+line.gross,0),net=Math.round(lines.reduce((sum,line)=>sum+line.net,0)*100)/100;
  const rawDiscount=(gross-net)/gross*100;
  // Compensate for floating-point noise only; Apex uses exact Decimal arithmetic.
  const discount=Math.ceil(rawDiscount*100-1e-8)/100;
  return {lines,gross,net,discount,saving:Math.round((gross-net)*100)/100};
}
export class QuoteWorkflow{
  constructor(){this.quotes=[];this.dispatches=[];this.externalOrders=new Map();this.sequence=1001;this.orderSequence=2001;}
  create({customer,lines,previousId},actor='Sales'){
    if(actor!=='Sales')throw new Error('Switch to Sales Rep to create a quote.');
    if(!customer?.trim()||customer.length>120)throw new Error('Enter a customer name of 1–120 characters.');
    const totals=priceLines(lines),previous=previousId?this.quotes.find(quote=>quote.id===previousId):null;
    if(previousId&&(!previous||previous.status!=='Approved'))throw new Error('Only approved quotes can be revised.');
    const id='DF-'+String(this.sequence++).padStart(5,'0'),family=previous?.family||id;
    const version=previous?Math.max(...this.quotes.filter(quote=>quote.family===family).map(quote=>quote.version))+1:1;
    const quote={id,family,version,previousId:previousId||null,customer:customer.trim(),...totals,amount:totals.gross,status:'Draft'};
    this.quotes.unshift(quote);return quote;
  }
  submit(id,rules=defaultRules,actor='Sales'){
    if(actor!=='Sales')throw new Error('Only Sales Rep can submit quotes in this simulation.');
    const quote=this.quotes.find(item=>item.id===id);
    if(!quote||quote.status!=='Draft')throw new Error('Only Draft quotes can be submitted.');
    const rule=evaluate(quote.discount,rules);
    if(rule.route==='Block')throw new Error('Discount exceeds policy. The saved draft cannot be submitted.');
    Object.assign(quote,{rule:rule.name,route:rule.route,approver:rule.route==='Auto'?'Policy engine':rule.route==='Manager'?'Priya · Sales Manager':'Arjun · Sales Director',status:rule.route==='Auto'?'Approved':'Pending'});
    if(quote.status==='Approved')this.stage(quote);return quote;
  }
  decide(id,action,actor,comment=''){
    const index=this.quotes.findIndex(item=>item.id===id);if(index<0)throw new Error('Quote not found.');
    this.quotes[index]=decideRequest(this.quotes[index],action,actor,comment);
    if(action==='Approved')this.stage(this.quotes[index]);return this.quotes[index];
  }
  stage(quote){
    if(quote.status!=='Approved')throw new Error('Only approved quotes can be ordered.');
    if(this.dispatches.some(dispatch=>dispatch.key===quote.id))return;
    const payload=JSON.stringify({quoteId:quote.id,version:quote.version,customer:quote.customer,currency:'INR',gross:quote.gross,net:quote.net,lines:quote.lines.map(line=>({sku:line.sku,quantity:line.quantity,unitPrice:line.price,discount:line.discount,net:line.net}))});
    this.dispatches.unshift({id:'DSP-'+quote.id,key:quote.id,payload,status:'Queued',attempts:0,error:'',orderId:''});
  }
  deliver(key,mode='success'){
    const dispatch=this.dispatches.find(item=>item.key===key);if(!dispatch)throw new Error('No dispatch found.');
    if(dispatch.status==='Succeeded')return dispatch;
    if(dispatch.attempts>=5)throw new Error('Maximum five attempts reached. Investigate this dispatch.');
    dispatch.attempts++;
    if(mode==='before-commit'){dispatch.status=dispatch.attempts>=5?'Needs Attention':'Retryable';dispatch.error='HTTP 503 · API unavailable before order creation.';return dispatch;}
    let order=this.externalOrders.get(key);
    if(!order){order={id:'ORD-'+this.orderSequence++,payload:dispatch.payload};this.externalOrders.set(key,order);}
    else if(order.payload!==dispatch.payload){dispatch.status='Needs Attention';dispatch.error='HTTP 409 · Key reused with a different payload.';return dispatch;}
    if(mode==='after-commit'){dispatch.status=dispatch.attempts>=5?'Needs Attention':'Retryable';dispatch.error='HTTP 503 · Order created, acknowledgement lost.';return dispatch;}
    dispatch.status='Succeeded';dispatch.orderId=order.id;dispatch.error='';return dispatch;
  }
  retry(key,actor,mode='success'){
    if(actor!=='Operations')throw new Error('Switch to Operations to retry failed deliveries.');
    const dispatch=this.dispatches.find(item=>item.key===key);
    if(!dispatch||dispatch.status!=='Retryable')throw new Error('Only retryable failures can be retried.');
    return this.deliver(key,mode);
  }
}
