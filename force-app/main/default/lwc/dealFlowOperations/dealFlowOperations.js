import { LightningElement,wire } from 'lwc';
import getDispatches from '@salesforce/apex/DealFlowOrderService.getDispatches';
import retry from '@salesforce/apex/DealFlowOrderService.retry';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
export default class DealFlowOperations extends LightningElement {
    rows=[];wired;busy=false;
    columns=[{label:'Dispatch',fieldName:'Name'},{label:'Status',fieldName:'Status__c'},
        {label:'Attempts',fieldName:'Attempts__c',type:'number'},{label:'External order',fieldName:'External_Order_Id__c'},
        {label:'Last error',fieldName:'Last_Error__c'},{type:'button',typeAttributes:{label:'Retry safely',name:'retry'}}];
    @wire(getDispatches) loaded(result){this.wired=result;if(result.data)this.rows=result.data;if(result.error)this.fail(result.error);}
    async refresh(){await refreshApex(this.wired);}
    async rowAction(event){this.busy=true;try{await retry({dispatchId:event.detail.row.Id});this.dispatchEvent(new ShowToastEvent({title:'Retry queued',message:'The existing quote-version key will be reused.',variant:'success'}));await this.refresh();}catch(error){this.fail(error);}finally{this.busy=false;}}
    fail(error){this.dispatchEvent(new ShowToastEvent({title:'DealFlow Operations',message:error?.body?.message||error.message||'Unable to load dispatches.',variant:'error'}));}
}
