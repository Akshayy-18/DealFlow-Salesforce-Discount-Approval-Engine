@IsTest
private class DiscountSubmitActionTest {
    private static Discount_Request__c draft(Decimal discount) {
        Discount_Request__c record=new Discount_Request__c(Customer__c='Synthetic Customer',Amount__c=10000,Discount__c=discount);
        insert record;
        return record;
    }
    private static DiscountSubmitAction.Input input(Id requestId) {
        DiscountSubmitAction.Input item=new DiscountSubmitAction.Input(); item.requestId=requestId; return item;
    }
    @IsTest static void approvesLowDiscountAndPreventsResubmission() {
        Discount_Request__c record=draft(5);
        Test.startTest();
        List<DiscountSubmitAction.Output> output=DiscountSubmitAction.submit(new List<DiscountSubmitAction.Input>{input(record.Id)});
        Test.stopTest();
        record=[SELECT Status__c,Route__c,Applied_Rule__c FROM Discount_Request__c WHERE Id=:record.Id];
        System.assertEquals('Approved',record.Status__c);
        System.assertEquals('Auto',record.Route__c);
        System.assertEquals('Standard',record.Applied_Rule__c);
        System.assert(output[0].message.contains('automatically'));
        Boolean failed=false;
        try { DiscountSubmitAction.submit(new List<DiscountSubmitAction.Input>{input(record.Id)}); }
        catch (DiscountSubmitAction.SubmissionException e) { failed=true; }
        System.assert(failed);
    }
    @IsTest static void blockedDiscountStaysDraft() {
        Discount_Request__c record=draft(30);
        Boolean failed=false;
        try { DiscountSubmitAction.submit(new List<DiscountSubmitAction.Input>{input(record.Id)}); }
        catch (DiscountSubmitAction.SubmissionException e) { failed=true; }
        System.assert(failed);
        System.assertEquals('Draft',[SELECT Status__c FROM Discount_Request__c WHERE Id=:record.Id].Status__c);
    }
    @IsTest static void duplicateInputsFail() {
        Discount_Request__c record=draft(4);
        Boolean failed=false;
        try { DiscountSubmitAction.submit(new List<DiscountSubmitAction.Input>{input(record.Id),input(record.Id)}); }
        catch (DiscountSubmitAction.SubmissionException e) { failed=true; }
        System.assert(failed);
    }
    @IsTest static void preventsForgedRouteAndEditsAfterApproval() {
        Discount_Request__c record=draft(4);
        record.Route__c='Auto';
        System.assertEquals(false,Database.update(record,false).isSuccess());
        DiscountSubmitAction.submit(new List<DiscountSubmitAction.Input>{input(record.Id)});
        System.assertEquals(false,Database.update(new Discount_Request__c(Id=record.Id,Discount__c=1),false).isSuccess());
    }
    @IsTest static void bulkAutoApprovals() {
        List<Discount_Request__c> records=new List<Discount_Request__c>();
        for (Integer i=0;i<200;i++) records.add(new Discount_Request__c(Amount__c=100,Discount__c=1));
        insert records;
        List<DiscountSubmitAction.Input> inputs=new List<DiscountSubmitAction.Input>();
        for (Discount_Request__c record:records) inputs.add(input(record.Id));
        Test.startTest();
        System.assertEquals(200,DiscountSubmitAction.submit(inputs).size());
        Test.stopTest();
        System.assertEquals(200,[SELECT COUNT() FROM Discount_Request__c WHERE Status__c='Approved']);
    }
}
