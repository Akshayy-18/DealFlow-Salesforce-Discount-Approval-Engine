/** At-least-once delivery; the receiving API must enforce Idempotency-Key atomically. */
public without sharing class DealFlowOrderJob implements Queueable,Database.AllowsCallouts {
    private List<Id> ids;
    public DealFlowOrderJob(List<Id> ids) { this.ids=ids; }
    public void execute(QueueableContext context) {
        // All callouts occur before DML. A batch of 20 bounds callout counts and heap usage.
        Set<Id> batch=new Set<Id>();List<Id> remaining=new List<Id>();
        for (Integer i=0;i<ids.size();i++) { if(i<20)batch.add(ids[i]);else remaining.add(ids[i]); }
        Map<Id,Order_Dispatch__c> outcomes=new Map<Id,Order_Dispatch__c>();
        for (Order_Dispatch__c dispatch:[SELECT Id,Quote_Key__c,Status__c,Attempts__c,Payload__c,Quote__r.Status__c FROM Order_Dispatch__c WHERE Id IN :batch]) {
            if(dispatch.Status__c=='Succeeded' || dispatch.Attempts__c>=5 || dispatch.Quote__r.Status__c!='Approved')continue;
            Order_Dispatch__c result=new Order_Dispatch__c(Id=dispatch.Id,Status__c='Retryable',Last_Attempt__c=System.now());
            try {
                HttpRequest request=new HttpRequest();request.setEndpoint('callout:DealFlow_Order_API/orders');request.setMethod('POST');
                request.setHeader('Content-Type','application/json');request.setHeader('Idempotency-Key',dispatch.Quote_Key__c);
                request.setBody(dispatch.Payload__c);request.setTimeout(10000);
                HttpResponse response=new Http().send(request);Integer code=response.getStatusCode();
                if(code==200 || code==201) {
                    Map<String,Object> body=(Map<String,Object>)JSON.deserializeUntyped(response.getBody());
                    String orderId=(String)body.get('orderId');
                    if(String.isBlank(orderId) || orderId.length()>80)throw new CalloutException('Order API returned an invalid orderId.');
                    result.Status__c='Succeeded';result.External_Order_Id__c=orderId;result.Last_Error__c=null;
                } else {
                    result.Status__c=(code==408 || code==429 || code>=500)?'Retryable':'Needs Attention';
                    // Do not persist response bodies: external errors may contain credentials or customer data.
                    result.Last_Error__c='Order API returned HTTP '+code+'.';
                }
            } catch(Exception error) {
                result.Status__c='Retryable';result.Last_Error__c='Transport or response error. Check the endpoint, credentials, and API response contract.';
            }
            outcomes.put(dispatch.Id,result);
        }
        List<Order_Dispatch__c> updates=new List<Order_Dispatch__c>();
        // Callouts release locks. Re-read after callouts so a late failure never overwrites a committed success.
        for(Order_Dispatch__c current:[SELECT Id,Status__c,Attempts__c FROM Order_Dispatch__c WHERE Id IN :outcomes.keySet() FOR UPDATE]) {
            if(current.Status__c=='Succeeded')continue;
            Order_Dispatch__c result=outcomes.get(current.Id);result.Attempts__c=current.Attempts__c+1;
            if(result.Attempts__c>=5 && result.Status__c=='Retryable')result.Status__c='Needs Attention';
            updates.add(result);
        }
        if(!updates.isEmpty())update updates;
        if(!remaining.isEmpty())System.enqueueJob(new DealFlowOrderJob(remaining));
    }
}
