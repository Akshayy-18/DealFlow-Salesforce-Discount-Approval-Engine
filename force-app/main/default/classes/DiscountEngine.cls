/** Pure policy evaluation: configuration errors fail closed, never choose a random rule. */
public with sharing class DiscountEngine {
    public class PolicyException extends Exception {}
    public static Discount_Rule__mdt evaluate(Decimal discount, List<Discount_Rule__mdt> rules) {
        if (discount == null || discount < 0 || discount > 100) {
            throw new PolicyException('Discount must be between 0 and 100.');
        }
        Discount_Rule__mdt match;
        Set<String> routes = new Set<String>{'Auto', 'Manager', 'Director', 'Block'};
        for (Discount_Rule__mdt rule : rules) {
            if (!rule.Active__c) continue;
            if (rule.Minimum__c == null || rule.Maximum__c == null ||
                rule.Minimum__c < 0 || rule.Maximum__c > 100 ||
                rule.Minimum__c >= rule.Maximum__c || !routes.contains(rule.Route__c)) {
                throw new PolicyException('Invalid discount rule: ' + rule.DeveloperName);
            }
            // Lower bound exclusive, upper bound inclusive; zero belongs to the zero-start rule.
            if ((discount > rule.Minimum__c || (discount == 0 && rule.Minimum__c == 0)) &&
                discount <= rule.Maximum__c) {
                if (match != null) throw new PolicyException('Overlapping discount rules. Contact an administrator.');
                match = rule;
            }
        }
        if (match == null) throw new PolicyException('No active rule covers this discount. Contact an administrator.');
        return match;
    }
}
