import { getTextDiffs } from "../dist/index.js";

const a = 'He said: "Hello"';
const b = 'He said: "Hello"   ';

console.log(JSON.stringify(getTextDiffs(a, b), null, 2));
