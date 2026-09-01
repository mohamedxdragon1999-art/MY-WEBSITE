P = 'tests/test_frontend.mjs'
s = open(P, encoding='utf-8').read()

old = """console.log('\\n== FORMS (real feature) ==');
await window.views.forms();
await sleep(200);
check('forms view renders', (g('topbar-title')?.textContent || '').includes('Forms'));
await window.openAddForm();
await sleep(50);
g('f-name').value = 'Website Lead Capture';
await window.createForm();
await sleep(300);"""
new = """console.log('\\n== FORMS (real feature) ==');
await window.navigate('forms');
await sleep(400);
check('forms view renders', (g('topbar-title')?.textContent || '').includes('Forms'));
await window.openAddForm();
await sleep(50);
g('f-name').value = 'Website Lead Capture';
document.querySelector('.f-label').value = 'Email';
await window.createForm();
await sleep(300);"""
assert old in s
s = s.replace(old, new)

old2 = """  const parsed = window.parseDate('2026-08-22 10:00:00');
  check('parseDate handles SQLite format', parsed instanceof Date && !isNaN(parsed.getTime()));
  check('timeAgo robust on bad input', window.timeAgo('garbage') === '\u2014');
  const csv = window.parseCSVLine('"Smith, John",acme@x.com,"hello, ""world"""');
  check('parseCSVLine handles quoted commas', csv.length === 3 && csv[0] === 'Smith, John' && csv[2] === 'hello, "world"');"""
new2 = """  const parsed = window.parseDate('2026-08-22 10:00:00');
  check('parseDate handles SQLite format', !!parsed && !isNaN(parsed.getTime()));
  const timeAgoFn = window.eval('timeAgo');
  check('timeAgo robust on bad input', timeAgoFn('garbage') === '\u2014');
  check('timeAgo parses ISO', timeAgoFn(new Date().toISOString()) === 'just now');
  const csv = window.parseCSVLine(String.raw`"Smith, John",acme@x.com,"hello, ""world"""`);
  check('parseCSVLine handles quoted commas', csv.length === 3 && csv[0] === 'Smith, John' && csv[2] === 'hello, "world"');"""
assert old2 in s, 'old2 not found'
s = s.replace(old2, new2)
open(P, 'w', encoding='utf-8').write(s)
print('ok')
