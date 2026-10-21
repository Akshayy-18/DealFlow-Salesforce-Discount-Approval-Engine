@IsTest
private class DealFlowQuoteControllerTest {
    @TestSetup static void setup(){
        String suffix=String.valueOf(System.now().getTime());
        User director=person('director',suffix,null);insert director;
        User manager=person('manager',suffix,director.Id);insert manager;
        User rep=person('rep',suffix,manager.Id);insert rep;
        Map<String,Id> permissions=new Map<String,Id>();
        for(PermissionSet permission:[SELECT Id,Name FROM PermissionSet WHERE Name IN ('DealFlow_Sales_Rep','DealFlow_Manager')])permissions.put(permission.Name,permission.Id);
        insert new List<PermissionSetAssignment>{new PermissionSetAssignment(AssigneeId=rep.Id,PermissionSetId=permissions.get('DealFlow_Sales_Rep')),
            new PermissionSetAssignment(AssigneeId=manager.Id,PermissionSetId=permissions.get('DealFlow_Manager')),
            new PermissionSetAssignment(AssigneeId=director.Id,PermissionSetId=permissions.get('DealFlow_Manager'))};
    }
    private static User person(String name,String suffix,Id manager){
        return new User(Alias=('df'+name).left(8),LastName='DealFlow '+name,Email=name+'@example.invalid',
            Username='dealflow.'+name+'.'+suffix+'.'+UserInfo.getOrganizationId()+'@example.invalid',
            ProfileId=UserInfo.getProfileId(),TimeZoneSidKey='Asia/Kolkata',LocaleSidKey='en_IN',EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',ManagerId=manager);
    }
    private static DealFlowQuoteController.LineInput line(Decimal discount){
        DealFlowQuoteController.LineInput line=new DealFlowQuoteController.LineInput();line.sku='DF-START';line.quantity=2;line.discount=discount;return line;
    }
    @IsTest static void pricesVersionsAndPreservesSnapshot(){
        User rep=[SELECT Id FROM User WHERE LastName='DealFlow rep' LIMIT 1];
        System.runAs(rep){
            Id first=DealFlowQuoteController.createQuote('Synthetic Customer',new List<DealFlowQuoteController.LineInput>{line(3)},null);
            DealFlowQuoteController.submitQuote(first);
            Id second=DealFlowQuoteController.createQuote('Changed Customer',new List<DealFlowQuoteController.LineInput>{line(12)},first);
            Id third=DealFlowQuoteController.createQuote('Another Revision',new List<DealFlowQuoteController.LineInput>{line(20)},first);
            Map<Id,Discount_Request__c> quotes=new Map<Id,Discount_Request__c>([SELECT Status__c,Version__c,Amount__c,Customer__c,Previous_Version__c FROM Discount_Request__c]);
            System.assertEquals('Approved',quotes.get(first).Status__c);System.assertEquals('Synthetic Customer',quotes.get(first).Customer__c);
            System.assertEquals(24000,quotes.get(first).Amount__c);System.assertEquals('Draft',quotes.get(second).Status__c);
            System.assertEquals(2,quotes.get(second).Version__c);System.assertEquals(3,quotes.get(third).Version__c);System.assertEquals(first,quotes.get(second).Previous_Version__c);
        }
    }
    @IsTest static void nativeManagerApprovalAndHistory(){
        User rep=[SELECT Id,ManagerId FROM User WHERE LastName='DealFlow rep' LIMIT 1];Id quoteId;
        System.runAs(rep){quoteId=DealFlowQuoteController.createQuote('Manager review',new List<DealFlowQuoteController.LineInput>{line(12)},null);DealFlowQuoteController.submitQuote(quoteId);}
        ProcessInstanceWorkitem work=[SELECT Id,ActorId FROM ProcessInstanceWorkitem WHERE ProcessInstance.TargetObjectId=:quoteId];
        System.assertEquals(rep.ManagerId,work.ActorId);
        System.runAs(new User(Id=rep.ManagerId)){
            Approval.ProcessWorkitemRequest decision=new Approval.ProcessWorkitemRequest();decision.setWorkitemId(work.Id);decision.setAction('Approve');
            System.assert(Approval.process(decision).isSuccess());
        }
        System.assertEquals('Approved',[SELECT Status__c FROM Discount_Request__c WHERE Id=:quoteId].Status__c);
        System.assertEquals(1,[SELECT COUNT() FROM Order_Dispatch__c WHERE Quote__c=:quoteId]);
    }
    @IsTest static void nativeDirectorRejection(){
        User rep=[SELECT Id,Manager.ManagerId FROM User WHERE LastName='DealFlow rep' LIMIT 1];Id quoteId;
        System.runAs(rep){quoteId=DealFlowQuoteController.createQuote('Director review',new List<DealFlowQuoteController.LineInput>{line(20)},null);DealFlowQuoteController.submitQuote(quoteId);}
        ProcessInstanceWorkitem work=[SELECT Id,ActorId FROM ProcessInstanceWorkitem WHERE ProcessInstance.TargetObjectId=:quoteId];
        System.assertEquals(rep.Manager.ManagerId,work.ActorId);
        System.runAs(new User(Id=work.ActorId)){
            Approval.ProcessWorkitemRequest decision=new Approval.ProcessWorkitemRequest();decision.setWorkitemId(work.Id);decision.setAction('Reject');
            System.assert(Approval.process(decision).isSuccess());
        }
        System.assertEquals('Rejected',[SELECT Status__c FROM Discount_Request__c WHERE Id=:quoteId].Status__c);
        System.assertEquals(0,[SELECT COUNT() FROM Order_Dispatch__c WHERE Quote__c=:quoteId]);
    }
    @IsTest static void validatesCatalogQuantityAndRole(){
        Boolean denied=false;
        try{DealFlowQuoteController.createQuote('Denied',new List<DealFlowQuoteController.LineInput>{line(3)},null);}catch(DealFlowQuoteController.QuoteException error){denied=true;}
        System.assert(denied,'Users without the sales permission must not create quotes.');
        User rep=[SELECT Id FROM User WHERE LastName='DealFlow rep' LIMIT 1];
        System.runAs(rep){
            DealFlowQuoteController.LineInput invalid=line(3);invalid.quantity=1.5;Boolean rejected=false;
            try{DealFlowQuoteController.createQuote('Invalid',new List<DealFlowQuoteController.LineInput>{invalid},null);}catch(DealFlowQuoteController.QuoteException error){rejected=true;}System.assert(rejected);
            invalid=line(3);invalid.sku='UNKNOWN';rejected=false;
            try{DealFlowQuoteController.createQuote('Invalid',new List<DealFlowQuoteController.LineInput>{invalid},null);}catch(DealFlowQuoteController.QuoteException error){rejected=true;}System.assert(rejected);
            System.assertEquals(3,DealFlowQuoteController.getProducts().size());
        }
    }
}
