"""Build a file://-friendly, self-contained browser demo without dependencies."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
demo=root/'demo'
html=(demo/'index.html').read_text(encoding='utf-8')
css=(demo/'styles.css').read_text(encoding='utf-8')
css=re.sub(r'@import url\([^;]+;','',css) # Use local font fallbacks; no network needed.
scripts=[]
for name in ['policy.mjs','workflow.mjs','app.mjs']:
    source=(demo/name).read_text(encoding='utf-8')
    source=re.sub(r'^import .*?;\s*','',source,flags=re.M)
    scripts.append(source.replace('export ',''))
html=html.replace('<link rel="stylesheet" href="styles.css"><script type="module" src="app.mjs"></script>','<style>'+css+'</style>')
html=html.replace('</body>','<script type="module">\n'+'\n'.join(scripts)+'\n</script></body>')
(demo/'standalone.html').write_text(html,encoding='utf-8')
print('Built demo/standalone.html: double-click to run offline.')
