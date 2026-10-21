public without sharing class DealFlowOrderService {
    public class DispatchException extends Exception {}
    public static void stage(Set<Id> quoteIds) {
        Map<Id,Discount_Request__c> quotes=new Map<Id,Discount_Request__c>([
            SELECT Id,Name,Customer__c,Status__c,Version__c,Version_Key__c,Amount__c,Discount__c,Net_Amount__c,
                (SELECT Product_Code__c,Product_Name__c,Quantity__c,Unit_Price__c,Discount__c,Net__c FROM Quote_Lines__r ORDER BY Id)
            FROM Discount_Request__c WHERE Id IN :quoteIds AND Status__c='Approved'
        ]);
        Set<String> existingKeys=new Set<String>();
        for (Order_Dispatch__c dispatch:[SELECT Quote_Key__c FROM Order_Dispatch__c WHERE Quote__c IN :quoteIds])existingKeys.add(dispatch.Quote_Key__c);
        List<Order_Dispatch__c> staged=new List<Order_Dispatch__c>();
        for (Discount_Request__c quote:quotes.values()) {
            String key=String.valueOf(quote.Id); // Each Salesforce record is one immutable quote version.
            if (existingKeys.contains(key)) continue;
            List<Object> lines=new List<Object>();Decimal net=0;
            for (Quote_Line__c line:quote.Quote_Lines__r) {
                lines.add(new Map<String,Object>{'sku'=>line.Product_Code__c,'quantity'=>line.Quantity__c,
                    'unitPrice'=>line.Unit_Price__c,'discount'=>line.Discount__c,'net'=>line.Net__c});net+=line.Net__c;
            }
            // Legacy discount-only records have no orderable product lines.
            if (lines.isEmpty()) continue;
            String payload=JSON.serialize(new Map<String,Object>{'quoteId'=>quote.Id,'version'=>quote.Version__c,
                'customer'=>quote.Customer__c,'currency'=>'INR','gross'=>quote.Amount__c,'net'=>net,'lines'=>lines});
            if (payload.length()>32768) throw new DispatchException('Order snapshot exceeds the payload limit.');
            staged.add(new Order_Dispatch__c(Quote__c=quote.Id,Quote_Key__c=key,Status__c='Queued',Attempts__c=0,Payload__c=payload));
        }
        if (!staged.isEmpty()) {
            insert staged;
            List<Id> ids=new List<Id>();for(Order_Dispatch__c dispatch:staged)ids.add(dispatch.Id);
            System.enqueueJob(new DealFlowOrderJob(ids));
        }
    }
    @AuraEnabled(cacheable=true)
    public static List<Order_Dispatch__c> getDispatches() {
        requireOperations();
        return [SELECT Id,Name,Quote__c,Quote__r.Name,Status__c,Attempts__c,Last_Error__c,External_Order_Id__c,Last_Attempt__c
            FROM Order_Dispatch__c WITH USER_MODE ORDER BY CreatedDate DESC LIMIT 100];
    }
    @AuraEnabled
    public static void retry(Id dispatchId) {
        requireOperations();
        Order_Dispatch__c dispatch=[SELECT Id,Status__c,Attempts__c,Quote__r.Status__c FROM Order_Dispatch__c WHERE Id=:dispatchId FOR UPDATE];
        if (dispatch.Status__c!='Retryable' || dispatch.Attempts__c>=5 || dispatch.Quote__r.Status__c!='Approved') {
            throw new DispatchException('Only retryable failures on approved quotes can be retried, with at most five attempts.');
        }
        dispatch.Status__c='Queued';update dispatch;
        System.enqueueJob(new DealFlowOrderJob(new List<Id>{dispatch.Id}));
    }
    private static void requireOperations() {
        if (!FeatureManagement.checkPermission('DealFlow_Operations'))throw new DispatchException('The DealFlow Operations permission is required.');
    }
}
