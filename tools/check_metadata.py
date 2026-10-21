"""Offline integrity checks; this does not replace Salesforce compilation."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parents[1]
source=root/'force-app/main/default'
ns={'m':'http://soap.sforce.com/2006/04/metadata'}
errors=[]
for path in source.rglob('*.xml'):
    try: ET.parse(path)
    except ET.ParseError as error: errors.append(f'{path.relative_to(root)}: {error}')
for path in (source/'classes').glob('*.cls-meta.xml'):
    if not path.with_name(path.name.replace('-meta.xml','')).exists():errors.append(f'Missing Apex class: {path.name}')
for path in (source/'triggers').glob('*.trigger-meta.xml'):
    if not path.with_name(path.name.replace('-meta.xml','')).exists():errors.append(f'Missing Apex trigger: {path.name}')
for path in (source/'permissionsets').glob('*.xml'):
    tree=ET.parse(path)
    for item in tree.findall('m:classAccesses/m:apexClass',ns):
        if not (source/'classes'/f'{item.text}.cls').exists():errors.append(f'{path.name}: unknown class {item.text}')
    for item in tree.findall('m:fieldPermissions/m:field',ns):
        obj,field=item.text.split('.')
        if not (source/'objects'/obj/'fields'/f'{field}.field-meta.xml').exists():errors.append(f'{path.name}: unknown field {item.text}')
for path in [root/'sfdx-project.json',root/'package.json',root/'config/project-scratch-def.json']:json.loads(path.read_text())
if errors:raise SystemExit('\n'.join(errors))
print(f'PASS: {len(list(source.rglob("*.xml")))} XML files parsed; Apex companions and permission references resolve.')
