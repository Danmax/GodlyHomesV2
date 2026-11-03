// Hostinger/Passenger loads startup files with CommonJS require(). Import the
// ESM application explicitly so it works regardless of require(esm) support.
process.chdir(__dirname);
console.log('Starting Godly Homes through the Passenger launcher.');
import('./server/index.js').catch(error => {
  console.error('Godly Homes launcher failed:', error.code || error.name, error.message);
  process.exitCode = 1;
});
