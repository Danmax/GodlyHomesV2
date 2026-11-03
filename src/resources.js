export { resources } from '../shared/resources.js';

export function downloadWorksheet(resource) {
  const text = `GODLY HOMES\n${resource.title}\n${'='.repeat(resource.title.length)}\n\n${resource.description}\n\n${resource.prompts.map(prompt => `${prompt}\n\n________________________________________________\n`).join('\n')}\nFor personal and household use.\nhttps://godlyhomes.com/resources/${resource.slug}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${resource.slug}-worksheet.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
