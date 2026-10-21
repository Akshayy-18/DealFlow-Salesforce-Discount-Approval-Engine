trigger DealFlowQuoteLifecycle on Discount_Request__c (after update) {
    Set<Id> approved=new Set<Id>();
    for(Discount_Request__c quote:Trigger.new) {
        if(quote.Status__c=='Approved' && Trigger.oldMap.get(quote.Id).Status__c!='Approved')approved.add(quote.Id);
    }
    if(!approved.isEmpty())DealFlowOrderService.stage(approved);
}
