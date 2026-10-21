/** Screen Flow entry point. All inputs are re-read and evaluated on the server. */
public with sharing class DiscountSubmitAction {
    @TestVisible private static Boolean internalWrite = false;
    public static Boolean isInternalWrite() { return internalWrite; }
    public class SubmissionException extends Exception {}
    public class Input {
        @InvocableVariable(required=true label='Discount Request ID') public Id requestId;
    }
    public class Output {
        @InvocableVariable public String message;
    }
    @InvocableMethod(label='Submit DealFlow Discount' description='Evaluate metadata rules and submit to native Salesforce approvals.')
    public static List<Output> submit(List<Input> inputs) {
        Set<Id> ids = new Set<Id>();
        for (Input item : inputs) {
            if (item.requestId == null || ids.contains(item.requestId)) {
                throw new SubmissionException('Provide distinct, non-empty request IDs.');
            }
            ids.add(item.requestId);
        }
        // USER_MODE enforces object/field permissions; sharing limits record visibility.
        Map<Id, Discount_Request__c> records = new Map<Id, Discount_Request__c>([
            SELECT Id, OwnerId, Amount__c, Discount__c, Status__c
            FROM Discount_Request__c WHERE Id IN :ids WITH USER_MODE FOR UPDATE
        ]);
        if (records.size() != ids.size()) throw new SubmissionException('A request is missing or inaccessible.');
        Map<Id, User> owners = new Map<Id, User>([
            SELECT Id, ManagerId, Manager.IsActive, Manager.ManagerId, Manager.Manager.IsActive
            FROM User WHERE Id IN (SELECT OwnerId FROM Discount_Request__c WHERE Id IN :ids)
        ]);
        List<Discount_Rule__mdt> rules = [
            SELECT DeveloperName, Minimum__c, Maximum__c, Route__c, Active__c FROM Discount_Rule__mdt
        ];
        List<Discount_Request__c> updates = new List<Discount_Request__c>();
        List<Discount_Request__Share> shares = new List<Discount_Request__Share>();
        List<Approval.ProcessRequest> approvals = new List<Approval.ProcessRequest>();
        List<Output> outputs = new List<Output>();
        for (Input item : inputs) {
            Discount_Request__c record = records.get(item.requestId);
            if (record.OwnerId != UserInfo.getUserId()) throw new SubmissionException('Only the request owner can submit.');
            if (record.Status__c != 'Draft') throw new SubmissionException('Only Draft requests can be submitted.');
            if (record.Amount__c == null || record.Amount__c <= 0) throw new SubmissionException('Amount must be positive.');
            Discount_Rule__mdt rule = DiscountEngine.evaluate(record.Discount__c, rules);
            if (rule.Route__c == 'Block') throw new SubmissionException('Discount exceeds policy. Reduce it before submitting.');
            Id approver;
            User owner = owners.get(record.OwnerId);
            if (rule.Route__c != 'Auto') {
                if (owner == null || owner.ManagerId == null || !owner.Manager.IsActive) {
                    throw new SubmissionException('An active manager must be configured on the request owner.');
                }
                approver = owner.ManagerId;
                if (rule.Route__c == 'Director') {
                    if (owner.Manager.ManagerId == null || !owner.Manager.Manager.IsActive) {
                        throw new SubmissionException('An active manager of the manager must be configured.');
                    }
                    approver = owner.Manager.ManagerId;
                }
                if (approver == record.OwnerId) throw new SubmissionException('Self-approval is not allowed.');
                shares.add(new Discount_Request__Share(ParentId=record.Id,UserOrGroupId=approver,AccessLevel='Read',RowCause=Schema.Discount_Request__Share.RowCause.Manual));
            }
            updates.add(new Discount_Request__c(Id=record.Id, Applied_Rule__c=rule.DeveloperName,
                Route__c=rule.Route__c, Approver__c=approver, Status__c=approver == null ? 'Approved' : 'Pending'));
            if (approver != null) {
                Approval.ProcessSubmitRequest request = new Approval.ProcessSubmitRequest();
                request.setObjectId(record.Id);
                request.setProcessDefinitionNameOrId('DealFlow_Discount_Approval');
                request.setComments('DealFlow rule: ' + rule.DeveloperName);
                approvals.add(request);
            }
            Output result = new Output();
            result.message = approver == null ? 'Discount automatically approved.' : 'Submitted for ' + rule.Route__c + ' approval.';
            outputs.add(result);
        }
        // Roll back field updates AND all approval work items if any submission fails.
        Savepoint point = Database.setSavepoint();
        try {
            internalWrite = true;
            update updates;
            if (!shares.isEmpty()) insert shares;
            if (!approvals.isEmpty()) {
                for (Approval.ProcessResult result : Approval.process(approvals)) {
                    if (!result.isSuccess()) throw new SubmissionException(result.getErrors()[0].getMessage());
                }
            }
        } catch (Exception error) {
            Database.rollback(point);
            throw new SubmissionException(error.getMessage());
        } finally {
            internalWrite = false;
        }
        return outputs;
    }
}
