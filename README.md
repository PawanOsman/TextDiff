# TextDiff

Unicode-aware multilingual text diff library for Node.js. Diffs by whole words and merges adjacent changes. Accurately tracks positions in the original string (UTF-16 indices).

## Install

```bash
pnpm add textdiff
```

## Usage

```ts
import { getTextDiffs } from "textdiff";

const oldText = "The quick brown fox jumps over the lazy dog";
const newText = "The fast dark wolf leaps over the lazy dog";

const diffs = getTextDiffs(oldText, newText);
// [
//   {
//     text: 'quick brown fox',
//     position: { startIndex: 4, endIndex: 19 },
//     replacedWith: 'fast dark wolf'
//   }
// ]
```

## API

```ts
export type ChangeType = "insert" | "delete" | "replace" | "spell-correction";

export interface TextDiff {
	oldText: string;
	position: { startIndex: number; endIndex: number };
	newText: string;
	changeType: ChangeType;
}

export function getTextDiffs(oldText: string, newText: string): TextDiff[];
```
