const fs = require('fs');
const path = require('path');

const filesToProcess = [
  '/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/users/ui/components/AddContractDialog.tsx',
  '/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/users/ui/components/AddLicenseDialog.tsx'
];

filesToProcess.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/bg-slate-900\/95 border-white\/10 text-white/g, 'bg-card border-border text-foreground shadow-xl shadow-black/5 dark:shadow-black/20');
  content = content.replace(/text-white\/70/g, 'text-muted-foreground');
  content = content.replace(/bg-white\/5 border-white\/10/g, 'bg-muted/30 border-border');
  fs.writeFileSync(file, content);
});

console.log("Updated standard dialogs.");
