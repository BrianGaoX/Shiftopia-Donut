const fs = require('fs');
const path = require('path');

const dir = '/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/components';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Regex replacements
  content = content.replace(/text-white\/70/g, 'text-muted-foreground');
  content = content.replace(/text-white\/60/g, 'text-foreground/60');
  content = content.replace(/text-white\/50/g, 'text-muted-foreground');
  content = content.replace(/text-white\/40/g, 'text-muted-foreground/80');
  content = content.replace(/text-white\/30/g, 'text-muted-foreground/60');
  content = content.replace(/text-white\/20/g, 'text-muted-foreground/40');
  content = content.replace(/text-white(?![\/\-\w])/g, 'text-foreground');
  content = content.replace(/bg-white\/\.?[\d\[\]\.]+/g, 'bg-muted/50');
  content = content.replace(/border-white\/\.?[\d\[\]\.]+/g, 'border-border');

  fs.writeFileSync(filePath, content);
});

console.log("Updated components.");
