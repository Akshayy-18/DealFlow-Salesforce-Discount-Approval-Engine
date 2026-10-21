/** Narrow mutation boundary: role + ownership checks precede deliberate system-mode DML. */
public with sharing class DealFlowQuoteController {
    public class QuoteException extends Exception {}
    @TestVisible private static Boolean writingLines=false;
    public static Boolean isWritingLines() { return writingLines; }
    public class LineInput {
        @AuraEnabled public String sku {get;set;}
        @AuraEnabled public Decimal quantity {get;set;}
        @AuraEnabled public Decimal discount {get;set;}
    }
    public class Product {
        @AuraEnabled public String sku {get;set;}
        @AuraEnabled public String name {get;set;}
        @AuraEnabled public Decimal price {get;set;}
    }
    @AuraEnabled(cacheable=true)
    public static List<Product> getProducts() {
        List<Product> products=new List<Product>();
        for (DealFlow_Product__mdt record:[SELECT MasterLabel,SKU__c,Price__c FROM DealFlow_Product__mdt WHERE Active__c=true ORDER BY MasterLabel]) {
            Product product=new Product();product.sku=record.SKU__c;product.name=record.MasterLabel;product.price=record.Price__c;products.add(product);
        }
        return products;
    }
    @AuraEnabled(cacheable=true)
    public static List<Discount_Request__c> getQuotes() {
        return [SELECT Id,Name,Customer__c,Amount__c,Discount__c,Net_Amount__c,Status__c,Version__c,Previous_Version__c,Approver__c
            FROM Discount_Request__c WITH USER_MODE ORDER BY CreatedDate DESC LIMIT 50];
    }
    @AuraEnabled
    public static Id createQuote(String customer,List<LineInput> lines,Id previousVersionId) {
        if (!FeatureManagement.checkPermission('DealFlow_Sales')) throw new QuoteException('The DealFlow Sales permission is required.');
        if (String.isBlank(customer) || customer.length()>120) throw new QuoteException('Enter a customer name of 1–120 characters.');
        if (lines==null || lines.isEmpty() || lines.size()>50) throw new QuoteException('Add between 1 and 50 product lines.');
        Map<String,DealFlow_Product__mdt> catalog=new Map<String,DealFlow_Product__mdt>();
        for (DealFlow_Product__mdt product:[SELECT MasterLabel,SKU__c,Price__c FROM DealFlow_Product__mdt WHERE Active__c=true]) {
            if (catalog.containsKey(product.SKU__c)) throw new QuoteException('Catalog contains duplicate product codes.');
            catalog.put(product.SKU__c,product);
        }
        Decimal gross=0,net=0;
        List<Quote_Line__c> quoteLines=new List<Quote_Line__c>();
        for (LineInput line:lines) {
            DealFlow_Product__mdt product=catalog.get(line.sku);
            if (product==null || product.Price__c==null || product.Price__c<=0) throw new QuoteException('Choose an active, priced product.');
            if (line.quantity==null || line.quantity<=0 || line.quantity>100000 || line.quantity!=line.quantity.setScale(0)) throw new QuoteException('Quantity must be a whole number from 1 to 100000.');
            if (line.discount==null || line.discount<0 || line.discount>100 || line.discount!=line.discount.setScale(2)) throw new QuoteException('Discount must be 0–100 with at most two decimal places.');
            Decimal lineGross=product.Price__c*line.quantity;
            gross+=lineGross;net+=(lineGross*(1-line.discount/100)).setScale(2);
            quoteLines.add(new Quote_Line__c(Product_Code__c=line.sku,Product_Name__c=product.MasterLabel,
                Unit_Price__c=product.Price__c,Quantity__c=line.quantity,Discount__c=line.discount));
        }
        if (gross>99999999999999.99) throw new QuoteException('Quote exceeds the supported amount.');
        Quote_Family__c family;
        Decimal version;
        if (previousVersionId==null) {
            family=new Quote_Family__c(Next_Version__c=2);insert family;version=1;
        } else {
            Discount_Request__c previous=[SELECT Id,OwnerId,Status__c,Family__c FROM Discount_Request__c WHERE Id=:previousVersionId WITH USER_MODE];
            if (previous.OwnerId!=UserInfo.getUserId() || previous.Status__c!='Approved' || previous.Family__c==null) throw new QuoteException('Only the owner can revise an approved quote.');
            family=[SELECT Id,Next_Version__c FROM Quote_Family__c WHERE Id=:previous.Family__c FOR UPDATE];
            version=family.Next_Version__c;family.Next_Version__c=version+1;update family;
        }
        Discount_Request__c quote=new Discount_Request__c(Customer__c=customer.trim(),Amount__c=gross,
            Discount__c=((gross-net)/gross*100).setScale(2,System.RoundingMode.CEILING),
            Discount_Value__c=gross-net,Family__c=family.Id,Version__c=version,Version_Key__c=String.valueOf(family.Id)+':'+String.valueOf(version),Previous_Version__c=previousVersionId);
        // Ceiling to two decimals prevents routing a slightly-over-limit weighted discount into a lower band.
        insert quote;
        for (Quote_Line__c line:quoteLines)line.Quote__c=quote.Id;
        try { writingLines=true;insert quoteLines; } finally { writingLines=false; }
        return quote.Id;
    }
    @AuraEnabled
    public static String submitQuote(Id quoteId) {
        if (!FeatureManagement.checkPermission('DealFlow_Sales')) throw new QuoteException('The DealFlow Sales permission is required.');
        DiscountSubmitAction.Input input=new DiscountSubmitAction.Input();input.requestId=quoteId;
        return DiscountSubmitAction.submit(new List<DiscountSubmitAction.Input>{input})[0].message;
    }
}
