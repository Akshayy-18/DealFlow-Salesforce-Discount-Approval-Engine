trigger DiscountRequestGuard on Discount_Request__c (before insert, before update) {
    for (Discount_Request__c record : Trigger.new) {
        if (Trigger.isInsert) {
            record.Status__c = 'Draft';
            record.Route__c = null;
            record.Approver__c = null;
            record.Applied_Rule__c = null;
        } else {
            Discount_Request__c previous = Trigger.oldMap.get(record.Id);
            Boolean changedInputs = record.Amount__c != previous.Amount__c ||
                record.Discount__c != previous.Discount__c || record.Customer__c != previous.Customer__c ||
                record.OwnerId != previous.OwnerId || record.Discount_Value__c != previous.Discount_Value__c ||
                record.Family__c != previous.Family__c || record.Previous_Version__c != previous.Previous_Version__c ||
                record.Version__c != previous.Version__c || record.Version_Key__c != previous.Version_Key__c;
            if (previous.Status__c != 'Draft' && changedInputs) {
                record.addError('Submitted requests cannot be changed. Create a new request.');
            }
            // Status transitions on approval/rejection are native workflow field updates.
            // Field-level security prevents end users editing derived fields directly.
            if (!DiscountSubmitAction.isInternalWrite() &&
                (record.Route__c != previous.Route__c || record.Approver__c != previous.Approver__c ||
                 record.Applied_Rule__c != previous.Applied_Rule__c)) {
                record.addError('Routing fields are maintained by DealFlow.');
            }
        }
    }
}
