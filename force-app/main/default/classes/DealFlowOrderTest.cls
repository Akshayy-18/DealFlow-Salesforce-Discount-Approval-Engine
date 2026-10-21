@IsTest
private class DealFlowOrderTest {
    @TestSetup static void setup(){
        List<PermissionSetAssignment> assignments=new List<PermissionSetAssignment>();
        for(PermissionSet permission:[SELECT Id FROM PermissionSet WHERE Name IN ('DealFlow_Sales_Rep','DealFlow_Operations')])assignments.add(new PermissionSetAssignment(AssigneeId=UserInfo.getUserId(),PermissionSetId=permission.Id));
        insert assignments;
    }
    private class MockAPI implements HttpCalloutMock {
        private Integer status;private String body;
        MockAPI(Integer status,String body){this.status=status;this.body=body;}
        public HttpResponse respond(HttpRequest request){
            System.assertEquals('POST',request.getMethod());System.assertEquals('callout:DealFlow_Order_API/orders',request.getEndpoint());
            Map<String,Object> payload=(Map<String,Object>)JSON.deserializeUntyped(request.getBody());
            System.assertEquals((String)payload.get('quoteId'),request.getHeader('Idempotency-Key'));
            HttpResponse response=new HttpResponse();response.setStatusCode(status);response.setBody(body);return response;
        }
    }
    private static Id approvedQuote(){
        DealFlowQuoteController.LineInput line=new DealFlowQuoteController.LineInput();line.sku='DF-START';line.quantity=1;line.discount=3;
        Id id;
        System.runAs(new User(Id=UserInfo.getUserId())){id=DealFlowQuoteController.createQuote('API test',new List<DealFlowQuoteController.LineInput>{line},null);DealFlowQuoteController.submitQuote(id);}
        return id;
    }
    @IsTest static void successfulDispatchAndUniqueOutbox(){
        Test.setMock(HttpCalloutMock.class,new MockAPI(201,'{"orderId":"ORD-TEST"}'));
        Test.startTest();Id quote=approvedQuote();DealFlowOrderService.stage(new Set<Id>{quote});Test.stopTest();
        List<Order_Dispatch__c> dispatches=[SELECT Status__c,External_Order_Id__c,Attempts__c FROM Order_Dispatch__c WHERE Quote__c=:quote];
        System.assertEquals(1,dispatches.size());System.assertEquals('Succeeded',dispatches[0].Status__c);System.assertEquals('ORD-TEST',dispatches[0].External_Order_Id__c);System.assertEquals(1,dispatches[0].Attempts__c);
    }
    @IsTest static void retryableFailure(){
        Test.setMock(HttpCalloutMock.class,new MockAPI(503,'{"error":"outage"}'));
        Test.startTest();Id quote=approvedQuote();Test.stopTest();
        Order_Dispatch__c dispatch=[SELECT Status__c,Attempts__c,Last_Error__c FROM Order_Dispatch__c WHERE Quote__c=:quote];
        System.assertEquals('Retryable',dispatch.Status__c);System.assertEquals(1,dispatch.Attempts__c);System.assert(dispatch.Last_Error__c.contains('503'));
    }
    @IsTest static void permanentFailureNeedsAttention(){
        Test.setMock(HttpCalloutMock.class,new MockAPI(400,'{"error":"bad payload"}'));
        Test.startTest();Id quote=approvedQuote();Test.stopTest();
        System.assertEquals('Needs Attention',[SELECT Status__c FROM Order_Dispatch__c WHERE Quote__c=:quote].Status__c);
    }
    @IsTest static void malformedSuccessIsNotMarkedDelivered(){
        Test.setMock(HttpCalloutMock.class,new MockAPI(200,'{}'));
        Test.startTest();Id quote=approvedQuote();Test.stopTest();
        System.assertEquals('Retryable',[SELECT Status__c FROM Order_Dispatch__c WHERE Quote__c=:quote].Status__c);
    }
    @IsTest static void retryReusesPayloadAndKey(){
        Id quote=approvedQuote();Order_Dispatch__c dispatch=[SELECT Id,Payload__c,Quote_Key__c FROM Order_Dispatch__c WHERE Quote__c=:quote];
        dispatch.Status__c='Retryable';dispatch.Attempts__c=1;update dispatch;
        Test.setMock(HttpCalloutMock.class,new MockAPI(200,'{"orderId":"ORD-REPLAY"}'));
        Test.startTest();System.runAs(new User(Id=UserInfo.getUserId())){DealFlowOrderService.retry(dispatch.Id);}Test.stopTest();
        Order_Dispatch__c after=[SELECT Status__c,Payload__c,Quote_Key__c,External_Order_Id__c FROM Order_Dispatch__c WHERE Id=:dispatch.Id];
        System.assertEquals(dispatch.Payload__c,after.Payload__c);System.assertEquals(dispatch.Quote_Key__c,after.Quote_Key__c);System.assertEquals('Succeeded',after.Status__c);
    }
}
