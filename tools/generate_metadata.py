"""Generate repetitive Salesforce metadata. Run from the project root."""
from pathlib import Path
from xml.sax.saxutils import escape
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1] / 'force-app/main/default'
NS = 'http://soap.sforce.com/2006/04/metadata'
def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + '\n', encoding='utf-8')
def xml(kind, body):
    if kind == 'PermissionSet':
        wrapper=ET.fromstring('<root>'+body+'</root>')
        body=''.join(ET.tostring(child,encoding='unicode') for child in sorted(wrapper,key=lambda child:child.tag))
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<{kind} xmlns="{NS}">{body}</{kind}>'
def field(obj, name, body):
    label = name.replace('__c', '').replace('_', ' ')
    if obj.endswith('__mdt') and '<fieldManageability>' not in body:
        body='<fieldManageability>DeveloperControlled</fieldManageability>'+body
    write(f'objects/{obj}/fields/{name}.field-meta.xml', xml('CustomField', f'<fullName>{name}</fullName><label>{label}</label>{body}'))

obj = 'Discount_Request__c'
write(f'objects/{obj}/{obj}.object-meta.xml', xml('CustomObject', '''
<deploymentStatus>Deployed</deploymentStatus><description>Standalone discount approval demonstration using synthetic data.</description>
<enableActivities>true</enableActivities><enableHistory>true</enableHistory><label>Discount Request</label>
<nameField><displayFormat>DF-{00000}</displayFormat><label>Request Number</label><type>AutoNumber</type></nameField>
<pluralLabel>Discount Requests</pluralLabel><sharingModel>Private</sharingModel>'''))
for name, precision, scale in [('Amount__c',16,2), ('Discount__c',5,2)]:
    field(obj,name,f'<precision>{precision}</precision><required>true</required><scale>{scale}</scale><trackHistory>true</trackHistory><type>Number</type>')
for name, length in [('Customer__c',120),('Applied_Rule__c',80),('Route__c',20)]:
    field(obj,name,f'<length>{length}</length><type>Text</type>')
field(obj,'Status__c','''<defaultValue>"Draft"</defaultValue><trackHistory>true</trackHistory><type>Text</type><length>30</length>''')
field(obj,'Approver__c','<deleteConstraint>SetNull</deleteConstraint><referenceTo>User</referenceTo><relationshipName>DealFlowRequests</relationshipName><trackHistory>true</trackHistory><type>Lookup</type>')
field(obj,'Net_Amount__c','<formula>IF(ISBLANK(Discount_Value__c), ROUND(Amount__c * (1 - Discount__c / 100), 2), Amount__c - Discount_Value__c)</formula><formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs><precision>18</precision><scale>2</scale><type>Number</type>')
for name, formula, message in [
    ('Valid_Discount','OR(Discount__c &lt; 0, Discount__c &gt; 100)','Discount must be between 0 and 100.'),
    ('Positive_Amount','Amount__c &lt;= 0','Amount must be greater than zero.')]:
    write(f'objects/{obj}/validationRules/{name}.validationRule-meta.xml',xml('ValidationRule',f'<fullName>{name}</fullName><active>true</active><errorConditionFormula>{formula}</errorConditionFormula><errorMessage>{message}</errorMessage>'))
mdt='Discount_Rule__mdt'
write(f'objects/{mdt}/{mdt}.object-meta.xml',xml('CustomObject','<label>Discount Rule</label><pluralLabel>Discount Rules</pluralLabel><visibility>Public</visibility>'))
for name in ['Minimum__c','Maximum__c']:
    field(mdt,name,'<fieldManageability>DeveloperControlled</fieldManageability><precision>5</precision><scale>2</scale><type>Number</type>')
field(mdt,'Route__c','<fieldManageability>DeveloperControlled</fieldManageability><length>20</length><type>Text</type>')
field(mdt,'Active__c','<defaultValue>true</defaultValue><fieldManageability>DeveloperControlled</fieldManageability><type>Checkbox</type>')
for name, low, high, route in [('Standard',0,5,'Auto'),('Manager',5,15,'Manager'),('Director',15,25,'Director'),('Blocked',25,100,'Block')]:
    values=''
    for f,v,t in [('Minimum__c',low,'double'),('Maximum__c',high,'double'),('Route__c',route,'string'),('Active__c','true','boolean')]:
        values+=f'<values><field>{f}</field><value xsi:type="xsd:{t}">{v}</value></values>'
    write(f'customMetadata/Discount_Rule.{name}.md-meta.xml',f'<?xml version="1.0" encoding="UTF-8"?><CustomMetadata xmlns="{NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><label>{name}</label><protected>false</protected>{values}</CustomMetadata>')
write('tabs/Discount_Request__c.tab-meta.xml',xml('CustomTab','<customObject>true</customObject><motif>Custom18: Form</motif>'))
write('applications/DealFlow.app-meta.xml',xml('CustomApplication','<description>Configurable discount approval engine</description><formFactors>Large</formFactors><formFactors>Small</formFactors><label>DealFlow</label><navType>Standard</navType><tabs>Discount_Request__c</tabs><uiType>Lightning</uiType>'))
fields=['Customer__c','Amount__c','Discount__c','Net_Amount__c','Status__c','Route__c','Applied_Rule__c','Approver__c']
items=''.join(f'<layoutItems><behavior>{"Edit" if n in fields[:3] else "Readonly"}</behavior><field>{n}</field></layoutItems>' for n in fields)
write('layouts/Discount_Request__c-DealFlow.layout-meta.xml',xml('Layout',f'<layoutSections><customLabel>false</customLabel><detailHeading>true</detailHeading><editHeading>true</editHeading><label>Information</label><layoutColumns>{items}</layoutColumns><style>OneColumn</style></layoutSections><showEmailCheckbox>false</showEmailCheckbox><showHighlightsPanel>true</showHighlightsPanel><showInteractionLogPanel>false</showInteractionLogPanel><showRunAssignmentRulesCheckbox>false</showRunAssignmentRulesCheckbox><showSubmitAndAttachButton>false</showSubmitAndAttachButton>'))
permissions=''
for name in ['DiscountEngine','DiscountSubmitAction']:
    permissions+=f'<classAccesses><apexClass>{name}</apexClass><enabled>true</enabled></classAccesses>'
for f in fields:
    if f in ['Amount__c','Discount__c']: continue # Required fields receive access through object permissions.
    permissions+=f'<fieldPermissions><editable>{str(f=="Customer__c").lower()}</editable><field>{obj}.{f}</field><readable>true</readable></fieldPermissions>'
permissions+='<flowAccesses><enabled>true</enabled><flow>Submit_Discount_Request</flow></flowAccesses>'
permissions+='<hasActivationRequired>false</hasActivationRequired><label>DealFlow User</label>'
permissions+=f'<objectPermissions><allowCreate>true</allowCreate><allowDelete>false</allowDelete><allowEdit>true</allowEdit><allowRead>true</allowRead><modifyAllRecords>false</modifyAllRecords><object>{obj}</object><viewAllRecords>false</viewAllRecords></objectPermissions><tabSettings><tab>Discount_Request__c</tab><visibility>Visible</visibility></tabSettings>'
write('permissionsets/DealFlow_User.permissionset-meta.xml',xml('PermissionSet',permissions))
for cls in ['DiscountEngine','DiscountSubmitAction','DiscountEngineTest','DiscountSubmitActionTest']:
    write(f'classes/{cls}.cls-meta.xml',xml('ApexClass','<apiVersion>65.0</apiVersion><status>Active</status>'))
write('triggers/DiscountRequestGuard.trigger-meta.xml',xml('ApexTrigger','<apiVersion>65.0</apiVersion><status>Active</status>'))
# Quote-to-order extension.
def number(name, scale=2, default=None, obj=obj):
    field(obj,name,(f'<defaultValue>{default}</defaultValue>' if default is not None else '')+f'<precision>16</precision><scale>{scale}</scale><type>Number</type>')
def text(name, length=100, obj=obj, unique=False):
    field(obj,name,f'<length>{length}</length>'+ ('<externalId>true</externalId><unique>true</unique>' if unique else '')+'<type>Text</type>')
def lookup(name, target, rel, obj=obj):
    constraint='SetNull' if target==obj or target=='User' else 'Restrict'
    field(obj,name,f'<deleteConstraint>{constraint}</deleteConstraint><referenceTo>{target}</referenceTo><relationshipName>{rel}</relationshipName><type>Lookup</type>')
def custom_object(name,label,body=''):
    write(f'objects/{name}/{name}.object-meta.xml',xml('CustomObject',f'<deploymentStatus>Deployed</deploymentStatus><label>{label}</label><nameField><displayFormat>DF-{{00000}}</displayFormat><label>{label} Number</label><type>AutoNumber</type></nameField><pluralLabel>{label}s</pluralLabel><sharingModel>Private</sharingModel>{body}'))
custom_object('Quote_Family__c','Quote Family')
number('Next_Version__c',0,1,obj='Quote_Family__c')
lookup('Family__c','Quote_Family__c','Versions')
lookup('Previous_Version__c',obj,'Revisions')
number('Version__c',0,1)
number('Discount_Value__c')
text('Version_Key__c',60,unique=True)
line='Quote_Line__c'
write(f'objects/{line}/{line}.object-meta.xml',xml('CustomObject','<deploymentStatus>Deployed</deploymentStatus><label>Quote Line</label><nameField><displayFormat>QL-{00000}</displayFormat><label>Line Number</label><type>AutoNumber</type></nameField><pluralLabel>Quote Lines</pluralLabel><sharingModel>ControlledByParent</sharingModel>'))
field(line,'Quote__c','<referenceTo>Discount_Request__c</referenceTo><relationshipLabel>Quote Lines</relationshipLabel><relationshipName>Quote_Lines</relationshipName><reparentableMasterDetail>false</reparentableMasterDetail><type>MasterDetail</type><writeRequiresMasterRead>false</writeRequiresMasterRead>')
text('Product_Code__c',40,obj=line)
text('Product_Name__c',100,obj=line)
for name,scale in [('Quantity__c',0),('Unit_Price__c',2),('Discount__c',2)]: number(name,scale,obj=line)
for name,formula in [('Gross__c','Quantity__c * Unit_Price__c'),('Net__c','ROUND(Quantity__c * Unit_Price__c * (1 - Discount__c / 100), 2)')]:
    field(line,name,f'<formula>{formula}</formula><formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs><precision>18</precision><scale>2</scale><type>Number</type>')
catalog='DealFlow_Product__mdt'
write(f'objects/{catalog}/{catalog}.object-meta.xml',xml('CustomObject','<label>DealFlow Product</label><pluralLabel>DealFlow Products</pluralLabel><visibility>Public</visibility>'))
text('SKU__c',40,obj=catalog)
number('Price__c',2,obj=catalog)
field(catalog,'Active__c','<defaultValue>true</defaultValue><fieldManageability>DeveloperControlled</fieldManageability><type>Checkbox</type>')
for name,sku,price in [('Sales_Starter','DF-START',12000),('Analytics_Pro','DF-ANALYTICS',24000),('Support_Plus','DF-SUPPORT',6000)]:
    vals=''.join(f'<values><field>{f}</field><value xsi:type="xsd:{t}">{v}</value></values>' for f,v,t in [('SKU__c',sku,'string'),('Price__c',price,'double'),('Active__c','true','boolean')])
    write(f'customMetadata/DealFlow_Product.{name}.md-meta.xml',f'<CustomMetadata xmlns="{NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><label>{name.replace("_"," ")}</label><protected>false</protected>{vals}</CustomMetadata>')
dispatch='Order_Dispatch__c'
custom_object(dispatch,'Order Dispatch')
lookup('Quote__c',obj,'Order_Dispatches',obj=dispatch)
text('Quote_Key__c',60,obj=dispatch,unique=True)
for name,length in [('Status__c',30),('External_Order_Id__c',80),('Last_Error__c',255)]:text(name,length,obj=dispatch)
number('Attempts__c',0,0,obj=dispatch)
field(dispatch,'Payload__c','<length>32768</length><type>LongTextArea</type><visibleLines>5</visibleLines>')
field(dispatch,'Last_Attempt__c','<type>DateTime</type>')
for name in ['DealFlow_Sales','DealFlow_Operations']:
    write(f'customPermissions/{name}.customPermission-meta.xml',xml('CustomPermission',f'<isLicensed>false</isLicensed><label>{name.replace("_"," ")}</label>'))
extra={'Discount_Request__c':['Family__c','Previous_Version__c','Version__c','Version_Key__c','Discount_Value__c'],line:['Quote__c','Product_Code__c','Product_Name__c','Quantity__c','Unit_Price__c','Discount__c','Gross__c','Net__c'],dispatch:['Quote__c','Quote_Key__c','Status__c','External_Order_Id__c','Last_Error__c','Attempts__c','Payload__c','Last_Attempt__c']}
for role,label in [('Sales_Rep','DealFlow Sales Rep'),('Manager','DealFlow Manager'),('Operations','DealFlow Operations')]:
    body='<hasActivationRequired>false</hasActivationRequired><label>'+label+'</label>'
    body+='<classAccesses><apexClass>DealFlowQuoteController</apexClass><enabled>true</enabled></classAccesses>'
    if role=='Sales_Rep':
        body+='<classAccesses><apexClass>DiscountSubmitAction</apexClass><enabled>true</enabled></classAccesses><classAccesses><apexClass>DiscountEngine</apexClass><enabled>true</enabled></classAccesses><customPermissions><enabled>true</enabled><name>DealFlow_Sales</name></customPermissions><flowAccesses><enabled>true</enabled><flow>Submit_Discount_Request</flow></flowAccesses>'
    if role=='Operations':body+='<classAccesses><apexClass>DealFlowOrderService</apexClass><enabled>true</enabled></classAccesses><customPermissions><enabled>true</enabled><name>DealFlow_Operations</name></customPermissions>'
    for object_name, object_fields in {obj:fields+extra[obj],line:extra[line],dispatch:extra[dispatch]}.items():
        if object_name==dispatch and role!='Operations': continue
        for f in object_fields:
            if object_name==obj and f in ['Amount__c','Discount__c']:continue
            if object_name==line and f=='Quote__c':continue
            body+=f'<fieldPermissions><editable>false</editable><field>{object_name}.{f}</field><readable>true</readable></fieldPermissions>'
        # Mutations are through a small Apex service with custom-permission and ownership checks.
        body+=f'<objectPermissions><allowCreate>false</allowCreate><allowDelete>false</allowDelete><allowEdit>false</allowEdit><allowRead>true</allowRead><modifyAllRecords>false</modifyAllRecords><object>{object_name}</object><viewAllRecords>{str(role=="Operations").lower()}</viewAllRecords></objectPermissions>'
    # Universally required header fields cannot carry fieldPermissions entries.
    body+='<tabSettings><tab>Discount_Request__c</tab><visibility>Visible</visibility></tabSettings>'
    write(f'permissionsets/DealFlow_{role}.permissionset-meta.xml',xml('PermissionSet',body))
for cls in ['DealFlowQuoteController','DealFlowQuoteControllerTest','DealFlowOrderService','DealFlowOrderJob','DealFlowOrderTest']:
    write(f'classes/{cls}.cls-meta.xml',xml('ApexClass','<apiVersion>65.0</apiVersion><status>Active</status>'))
for trigger in ['DealFlowQuoteLifecycle','DealFlowLineGuard']:
    write(f'triggers/{trigger}.trigger-meta.xml',xml('ApexTrigger','<apiVersion>65.0</apiVersion><status>Active</status>'))
print('Generated Salesforce discount, quote, product catalog, versioning, integration, and role metadata.')
