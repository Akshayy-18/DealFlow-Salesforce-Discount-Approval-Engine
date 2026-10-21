import { LightningElement, wire } from 'lwc';
import getProducts from '@salesforce/apex/DealFlowQuoteController.getProducts';
import getQuotes from '@salesforce/apex/DealFlowQuoteController.getQuotes';
import createQuote from '@salesforce/apex/DealFlowQuoteController.createQuote';
import submitQuote from '@salesforce/apex/DealFlowQuoteController.submitQuote';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
export default class DealFlowQuoteBuilder extends LightningElement {
    customer='';products=[];lines=[];quotes=[];busy=false;previousVersionId;wiredQuotes;
    columns=[{label:'Quote',fieldName:'Name'},{label:'Customer',fieldName:'Customer__c'},
        {label:'Version',fieldName:'Version__c',type:'number'},{label:'Gross (INR)',fieldName:'Amount__c',type:'number'},
        {label:'Policy discount (%)',fieldName:'Discount__c',type:'number'},{label:'Status',fieldName:'Status__c'},
        {type:'button',typeAttributes:{label:'Submit',name:'submit'}},{type:'button',typeAttributes:{label:'Revise',name:'revise'}}];
    @wire(getProducts) productsLoaded({data,error}) {if(data){this.products=data;this.addLine();}if(error)this.fail(error);}
    @wire(getQuotes) quotesLoaded(result){this.wiredQuotes=result;if(result.data)this.quotes=result.data;if(result.error)this.fail(result.error);}
    get productOptions(){return this.products.map(product=>({label:`${product.name} · ₹${product.price}`,value:product.sku}));}
    get gross(){return this.lines.reduce((sum,line)=>sum+line.price*line.quantity,0);}
    get net(){return this.lines.reduce((sum,line)=>sum+Math.round(line.price*line.quantity*(1-line.discount/100)*100)/100,0);}
    get revisionLabel(){return this.previousVersionId?'New version of an approved quote':'New quote · INR';}
    customerChanged(event){this.customer=event.target.value;}
    addLine(){if(this.products.length && this.lines.length<50){const product=this.products[0];this.lines=[...this.lines,{key:String(Date.now())+String(this.lines.length),sku:product.sku,price:product.price,quantity:1,discount:0}];}}
    removeLine(event){this.lines=this.lines.filter(line=>line.key!==event.target.dataset.key);}
    lineChanged(event){const {key,field}=event.target.dataset;this.lines=this.lines.map(line=>{if(line.key!==key)return line;const updated={...line,[field]:field==='sku'?event.detail.value:Number(event.target.value)};if(field==='sku')updated.price=this.products.find(product=>product.sku===updated.sku).price;return updated;});}
    async save(){
        if(![...this.template.querySelectorAll('lightning-input,lightning-combobox')].reduce((valid,input)=>{input.reportValidity();return input.checkValidity()&&valid;},true))return;
        this.busy=true;
        try{await createQuote({customer:this.customer,lines:this.lines.map(({sku,quantity,discount})=>({sku,quantity,discount})),previousVersionId:this.previousVersionId||null});this.notify('Draft saved','Submit the saved quote for fresh policy evaluation.','success');this.previousVersionId=undefined;await refreshApex(this.wiredQuotes);}
        catch(error){this.fail(error);}finally{this.busy=false;}
    }
    async rowAction(event){
        const {row,action}=event.detail;
        if(action.name==='revise'){
            if(row.Status__c!=='Approved'){this.notify('Cannot revise','Choose an approved quote owned by you.','warning');return;}
            this.previousVersionId=row.Id;this.customer=row.Customer__c;this.notify('New version','Choose products and quantities for the replacement version. The approved quote stays unchanged.','info');return;
        }
        this.busy=true;
        try{this.notify('Submission',await submitQuote({quoteId:row.Id}),'success');await refreshApex(this.wiredQuotes);}
        catch(error){this.fail(error);}finally{this.busy=false;}
    }
    notify(title,message,variant){this.dispatchEvent(new ShowToastEvent({title,message,variant}));}
    fail(error){this.notify('DealFlow',error?.body?.message||error.message||'Unable to complete the action.','error');}
}
