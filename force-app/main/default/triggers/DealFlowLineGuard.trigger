trigger DealFlowLineGuard on Quote_Line__c (before insert, before update, before delete) {
    // Version snapshots are immutable; even a draft correction creates another draft via the builder.
    if (!DealFlowQuoteController.isWritingLines()) {
        for (Quote_Line__c line : Trigger.isDelete ? Trigger.old : Trigger.new) {
            line.addError('Use the DealFlow quote builder. Quote line snapshots cannot be edited directly.');
        }
    }
}
