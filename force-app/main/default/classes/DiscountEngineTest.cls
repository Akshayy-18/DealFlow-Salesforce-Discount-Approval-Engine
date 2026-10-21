@IsTest
private class DiscountEngineTest {
    private static Discount_Rule__mdt rule(Decimal low, Decimal high, String route) {
        return new Discount_Rule__mdt(Minimum__c=low, Maximum__c=high, Route__c=route, Active__c=true);
    }
    @IsTest static void boundaries() {
        List<Discount_Rule__mdt> rules = new List<Discount_Rule__mdt>{
            rule(0,5,'Auto'), rule(5,15,'Manager'), rule(15,25,'Director'), rule(25,100,'Block')
        };
        for (Decimal value : new List<Decimal>{0,5}) System.assertEquals('Auto', DiscountEngine.evaluate(value,rules).Route__c);
        for (Decimal value : new List<Decimal>{5.01,15}) System.assertEquals('Manager', DiscountEngine.evaluate(value,rules).Route__c);
        for (Decimal value : new List<Decimal>{15.01,25}) System.assertEquals('Director', DiscountEngine.evaluate(value,rules).Route__c);
        for (Decimal value : new List<Decimal>{25.01,100}) System.assertEquals('Block', DiscountEngine.evaluate(value,rules).Route__c);
    }
    @IsTest static void failsClosed() {
        for (Decimal value : new List<Decimal>{null,-1,101}) {
            Boolean failed=false;
            try { DiscountEngine.evaluate(value,new List<Discount_Rule__mdt>{rule(0,100,'Auto')}); }
            catch (DiscountEngine.PolicyException e) { failed=true; }
            System.assert(failed,'Invalid discount must fail.');
        }
        for (List<Discount_Rule__mdt> rules : new List<List<Discount_Rule__mdt>>{
            new List<Discount_Rule__mdt>(),
            new List<Discount_Rule__mdt>{rule(0,10,'Auto'),rule(5,20,'Manager')},
            new List<Discount_Rule__mdt>{rule(0,100,'Unknown')},
            new List<Discount_Rule__mdt>{rule(20,10,'Auto')}
        }) {
            Boolean failed=false;
            try { DiscountEngine.evaluate(7,rules); }
            catch (DiscountEngine.PolicyException e) { failed=true; }
            System.assert(failed,'Missing, ambiguous, or invalid policy must fail.');
        }
        Discount_Rule__mdt disabled=rule(0,100,'Block'); disabled.Active__c=false;
        System.assertEquals('Auto',DiscountEngine.evaluate(3,new List<Discount_Rule__mdt>{disabled,rule(0,5,'Auto')}).Route__c);
    }
}
