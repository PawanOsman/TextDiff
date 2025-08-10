import { getTextDiffs } from "../dist/index.js";

const examples = [
	["The quick brown fox jumps over the lazy dog", "The fast dark wolf leaps over the lazy dog"],
	[
		"Привет мир", // Russian
		"Здравствуйте мир",
	],
	[
		"你好世界", // Chinese (no spaces)
		"你好，世界",
	],
	["color", "colour"],
	["I ❤️ TypeScript", "We ❤️ TypeScript"],
];

for (const [oldText, newText] of examples) {
	const diffs = getTextDiffs(oldText, newText);
	console.log("\n— Example —");
	console.log("old:", oldText);
	console.log("new:", newText);
	console.log("diffs:", JSON.stringify(diffs, null, 2));
}
