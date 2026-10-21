"""Run an org dry-run and print only actionable diagnostics; retain raw output locally."""
from pathlib import Path
import argparse,json,subprocess,sys
parser=argparse.ArgumentParser()
parser.add_argument('--cli',help='Optional path to Salesforce CLI bin/run.js')
parser.add_argument('--org',default='DealFlow')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
command=['node',args.cli] if args.cli else ['sf']
command+=['project','deploy','start','--dry-run','--target-org',args.org,'--source-dir','force-app','--test-level','RunSpecifiedTests']
for test in ['DiscountEngineTest','DiscountSubmitActionTest','DealFlowQuoteControllerTest','DealFlowOrderTest']:command+=['--tests',test]
command+=['--wait','10','--json']
result=subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace')
(root/'.tools').mkdir(exist_ok=True)
(root/'.tools/validation-result.json').write_text(result.stdout,encoding='utf-8')
try:
    payload=json.loads(result.stdout);details=payload.get('result',{});tests=details.get('details',{}).get('runTestResult',{})
    print('Deployment:',details.get('status',payload.get('message','Unknown')),'ID:',details.get('id',''))
    for item in details.get('details',{}).get('componentFailures',[]):print(item.get('fullName'),item.get('lineNumber',''),item.get('problem'))
    failures=tests.get('failures',[])
    if isinstance(failures,dict):failures=[failures]
    for item in failures:print(item.get('name'),item.get('methodName'),item.get('message'),item.get('stackTrace',''))
    print('Tests:',tests.get('numTestsRun',0),'Failures:',tests.get('numFailures',0))
    for warning in tests.get('codeCoverageWarnings',[]):print('Coverage:',warning)
except json.JSONDecodeError:print(result.stdout[-3000:],result.stderr[-1000:])
sys.exit(result.returncode)
