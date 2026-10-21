import { defaultRules, evaluate, calculate } from './policy.mjs';
import { catalog, priceLines, QuoteWorkflow } from './workflow.mjs';
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(value);
const el = (tag,text,className) => { const node=document.createElement(tag); if(text!==undefined) node.textContent=text; if(className)node.className=className; return node; };
let rules=defaultRules.map(rule=>({...rule}));
let workflow=new QuoteWorkflow();let cart=[{sku:'DF-START',quantity:10,discount:12}];let previousId=null;
let requests=[]; let filter='All'; let currentId=null; let toastTimer;
const seeds = [
  {id:'DF-01001',customer:'Northstar Labs',amount:240000,discount:12},
  {id:'DF-01002',customer:'Atlas Commerce',amount:180000,discount:3},
  {id:'DF-01003',customer:'Evergreen Systems',amount:350000,discount:20},
];
function reset(){
  rules=defaultRules.map(rule=>({...rule}));
  workflow=new QuoteWorkflow();
  for(const seed of seeds){const quote=workflow.create({customer:seed.customer,lines:[{sku:'DF-START',quantity:10,discount:seed.discount}]});workflow.submit(quote.id);if(quote.status==='Approved')workflow.deliver(quote.id);}
  requests=workflow.quotes;filter='All';previousId=null;cart=[{sku:'DF-START',quantity:10,discount:12}];$('#version-label').textContent='NEW QUOTE · VERSION 1';$('#actor').value='Sales';$('#failure-mode').value='success';
  $('#auto-max').value=5;$('#manager-max').value=15;$('#director-max').value=25;
  document.querySelectorAll('.filter').forEach(button=>{button.classList.toggle('active',button.dataset.filter==='All');button.setAttribute('aria-pressed',String(button.dataset.filter==='All'));});
  renderRules();renderCart();render();preview();
}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function showError(selector,error){$(selector).textContent=error.message;$(selector).hidden=false;}
function preview(){
  try{const totals=priceLines(cart);$('#amount').value=totals.gross;$('#discount').value=totals.discount;}catch(error){showError('#form-error',error);return;}
  const discount=Number($('#discount').value),amount=Number($('#amount').value);
  document.querySelectorAll('[data-discount]').forEach(button=>button.classList.toggle('selected',Number(button.dataset.discount)===discount));
  $('#form-error').hidden=true;
  try{
    if($('#discount').value===''||$('#amount').value==='')throw new Error('Enter a deal amount and discount.');
    const totals=calculate(amount,discount),rule=evaluate(discount,rules);
  const priced=priceLines(cart);$('#saving-preview').textContent=money(priced.saving);$('#net-preview').textContent=money(priced.net);
    $('#route-banner').className='route-banner'+(rule.route==='Auto'?' auto':rule.route==='Block'?' block':'');
    $('#rule-name').textContent=rule.name.toUpperCase()+' RULE MATCHED';
    $('#route-title').textContent={Auto:'Automatically approved',Manager:'Manager approval',Director:'Director approval',Block:'Outside discount policy'}[rule.route];
    $('#route-discount').textContent=discount+'%';$('#route-symbol').textContent=rule.route==='Auto'?'✓':rule.route==='Block'?'!':'↗';
    $('#rule-explanation').textContent=rule.min===0?`From 0% through ${rule.max}%`:`Over ${rule.min}%, up to and including ${rule.max}%`;
    $('#approver-title').textContent={Auto:'Approve without manual review',Manager:'Route to Sales Manager',Director:'Route to Sales Director',Block:'Submission blocked'}[rule.route];
    $('#approver-description').textContent={Auto:'The rule allows this discount automatically.',Manager:'Priya reviews the request and records a decision.',Director:'Arjun reviews the request and records a decision.',Block:'Reduce the discount to submit this request.'}[rule.route];
  }catch(error){$('#saving-preview').textContent='—';$('#net-preview').textContent='—';$('#route-title').textContent='Check your inputs';$('#route-discount').textContent='—';$('#approver-title').textContent='Awaiting valid inputs';$('#approver-description').textContent=error.message;$('#rule-name').textContent='VALIDATION REQUIRED';$('#rule-explanation').textContent='No route selected.';}
}
function render(){
  const pending=requests.filter(request=>request.status==='Pending').length;
  $('#total-stat').textContent=requests.length;$('#pending-stat').textContent=pending;$('#pending-count').textContent=pending;
  $('#value-stat').textContent=money(requests.filter(request=>request.status==='Approved').reduce((sum,request)=>sum+request.net,0));
  $('#request-count-label').textContent=`${requests.length} requests`;
  const rows=$('#request-rows');rows.replaceChildren();
  const visible=requests.filter(request=>filter==='All'||request.status===filter);
  $('#empty-state').hidden=visible.length>0;
  for(const request of visible){
    const row=el('tr'),customer=el('td');customer.append(el('strong',request.customer),el('small',`${request.id} · v${request.version}${request.previousId?' · revises '+request.previousId:''}`));row.append(customer);
    row.append(el('td',money(request.amount)),el('td',request.discount+'%'),el('td',request.approver||'Not submitted'));
    const status=el('td');status.append(el('span',request.status,'status '+request.status));row.append(status);
    const actions=el('td');
    const button=el('button',request.status==='Pending'?'Review ↗':'Details','review-button');
    button.type='button';button.addEventListener('click',()=>openReview(request.id));actions.append(button);row.append(actions);rows.append(row);
  }
  renderDispatches();
}
function renderRules(){
  $('#rule-cards').replaceChildren();
  rules.forEach((rule,index)=>{const card=el('article',undefined,'rule-card');card.append(el('span',`0${index+1} / ${rule.name.toUpperCase()}`),el('h3',`${rule.min}–${rule.max}%`),el('p',{Auto:'Automatic approval',Manager:'Sales Manager review',Director:'Sales Director review',Block:'Submission blocked'}[rule.route]),el('small',index===0?'Includes 0% and upper limit':'Lower limit excluded · upper included'));$('#rule-cards').append(card);});
}
function openReview(id){
  currentId=id;const request=requests.find(item=>item.id===id);$('#review-title').textContent=request.customer;
  $('#review-summary').textContent=`${request.id} · ${request.discount}% discount · ${money(request.net)} net value`;
  const audit=$('#review-audit');audit.replaceChildren();
  for(const [label,value] of [['Quote version',String(request.version)],['Matched rule',request.rule||'Not evaluated'],['Assigned approver',request.approver||'—'],['Status',request.status],['Decision note',request.comment||'—']]){
    const line=el('div');line.append(el('strong',label+': '),document.createTextNode(value));audit.append(line);
  }
  $('#review-comment').value='';$('#review-comment').disabled=request.status!=='Pending';$('#review-error').hidden=true;
  $('#approve-request').hidden=request.status!=='Pending';$('#reject-request').hidden=request.status!=='Pending';
  $('#revise-request').hidden=request.status!=='Approved';
  $('#review-dialog').showModal();
}
function decide(action){
  const index=requests.findIndex(request=>request.id===currentId);
  try{workflow.decide(currentId,action,$('#actor').value,$('#review-comment').value);requests=workflow.quotes;if(action==='Approved')workflow.deliver(currentId,$('#failure-mode').value);$('#review-dialog').close();render();toast(`${currentId} ${action.toLowerCase()}.`);}
  catch(error){showError('#review-error',error);}
}
$('#request-form').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    const request=workflow.create({customer:$('#customer').value,lines:cart,previousId},$('#actor').value);requests=workflow.quotes;
    workflow.submit(request.id,rules,$('#actor').value);if(request.status==='Approved')workflow.deliver(request.id,$('#failure-mode').value);previousId=null;$('#version-label').textContent='NEW QUOTE · VERSION 1';render();
    toast(request.status==='Approved'?`${request.id} automatically approved.`:`${request.id} routed to ${request.route.toLowerCase()} for review.`);
  }catch(error){render();showError('#form-error',error);}
});
$('#amount').readOnly=true;$('#discount').readOnly=true;
$('#amount').setAttribute('aria-label','Calculated gross deal amount');$('#discount').setAttribute('aria-label','Calculated effective quote discount');
document.querySelectorAll('[data-discount]').forEach(button=>button.addEventListener('click',()=>{cart=cart.map(line=>({...line,discount:Number(button.dataset.discount)}));renderCart();preview();}));
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('.filter').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));});render();}));
$('#approve-request').addEventListener('click',()=>decide('Approved'));$('#reject-request').addEventListener('click',()=>decide('Rejected'));
$('#revise-request').addEventListener('click',()=>{
  if($('#actor').value!=='Sales')return showError('#review-error',new Error('Switch to Sales Rep before creating a new quote version.'));
  const quote=requests.find(item=>item.id===currentId);previousId=quote.id;cart=quote.lines.map(({sku,quantity,discount})=>({sku,quantity,discount}));$('#customer').value=quote.customer;
  const version=Math.max(...requests.filter(item=>item.family===quote.family).map(item=>item.version))+1;
  $('#version-label').textContent=`NEW VERSION ${version} · REVISES ${quote.id}`;renderCart();preview();$('#review-dialog').close();$('#customer').focus();toast('Approved version preserved. Edit the new version and submit for fresh approval.');
});
$('#add-product').addEventListener('click',()=>{if(cart.length>=50)return toast('Maximum 50 lines.');cart.push({sku:catalog[0].sku,quantity:1,discount:0});renderCart();preview();});
function renderCart(){
  $('#cart-lines').replaceChildren();
  cart.forEach((line,index)=>{
    const row=el('div',undefined,'cart-line');
    for(const [field,title] of [['sku','Product'],['quantity','Quantity'],['discount','Discount %']]){
      const wrap=el('div'),id=`line-${index}-${field}`,label=el('label',title);label.htmlFor=id;
      const input=el(field==='sku'?'select':'input');input.id=id;
      if(field==='sku'){catalog.forEach(product=>{const option=el('option',product.name);option.value=product.sku;input.append(option);});input.value=line.sku;}
      else{input.type='number';input.min=field==='quantity'?'1':'0';input.max=field==='quantity'?'100000':'100';input.step=field==='quantity'?'1':'0.01';input.value=line[field];input.required=true;}
      input.addEventListener('change',()=>{cart[index]={...cart[index],[field]:field==='sku'?input.value:Number(input.value)};preview();});wrap.append(label,input);row.append(wrap);
    }
    const remove=el('button','×','remove-product');remove.type='button';remove.setAttribute('aria-label',`Remove product line ${index+1}`);remove.disabled=cart.length===1;remove.addEventListener('click',()=>{cart.splice(index,1);renderCart();preview();});row.append(remove);$('#cart-lines').append(row);
  });
}
function renderDispatches(){
  $('#external-count').textContent=workflow.externalOrders.size;const body=$('#dispatch-rows');body.replaceChildren();
  workflow.dispatches.forEach(dispatch=>{const row=el('tr'),quote=el('td');quote.append(el('strong',dispatch.key),el('small','Idempotency-Key: '+dispatch.key));row.append(quote);const status=el('td');status.append(el('span',dispatch.status,'status '+dispatch.status.replaceAll(' ','-')));if(dispatch.error)status.append(el('small',dispatch.error,'dispatch-error'));row.append(status,el('td',String(dispatch.attempts)),el('td',dispatch.orderId||'Awaiting acknowledgement'));
    const action=el('td');if(dispatch.status==='Retryable'){const button=el('button','Retry safely ↗','review-button');button.addEventListener('click',()=>{try{workflow.retry(dispatch.key,$('#actor').value,$('#failure-mode').value);render();toast('Retried with the same key. External orders: '+workflow.externalOrders.size);}catch(error){toast(error.message);}});action.append(button);}else action.append(el('span',dispatch.status==='Succeeded'?'Delivered once':'Investigate','row-note'));row.append(action);body.append(row);});
}
$('#reset-demo').addEventListener('click',()=>{reset();toast('Sample requests and default rules restored.');});
$('#policy-form').addEventListener('submit',event=>{
  event.preventDefault();$('#policy-error').hidden=true;
  const values=[$('#auto-max').value,$('#manager-max').value,$('#director-max').value].map(Number);
  if(!(0<values[0]&&values[0]<values[1]&&values[1]<values[2]&&values[2]<100))return showError('#policy-error',new Error('Use increasing limits: 0 < Auto < Manager < Director < 100.'));
  const bounds=[0,...values,100];rules=defaultRules.map((rule,index)=>({...rule,min:bounds[index],max:bounds[index+1]}));renderRules();preview();toast('Demo policy updated. Existing requests keep their original route.');
});
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav-link').forEach(item=>item.classList.toggle('active',item===link));}));
reset();
