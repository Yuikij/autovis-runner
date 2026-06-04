const fs = require('fs');
const files = [
  'E:/code/AutoVis/apps/web/src/app/sections/cases/CaseDetails.tsx',
  'E:/code/AutoVis/apps/web/src/app/sections/cases/CaseEditForm.tsx',
  'E:/code/AutoVis/apps/web/src/app/sections/cases/SuiteSelector.tsx',
  'E:/code/AutoVis/apps/web/src/app/sections/cases/CasesSidebar.tsx',
  'E:/code/AutoVis/apps/web/src/app/sections/CasesSection.tsx'
];
files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/\\`/g, '`');
    content = content.replace(/\\\$/g, '$');
    content = content.replace(/\\\\n/g, '\\n');
    fs.writeFileSync(f, content);
  }
});
console.log('Fixed escaping');
