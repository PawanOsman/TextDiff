export type ChangeType = "insert" | "delete" | "replace" | "spell-correction";

export interface TextDiff {
	oldText: string;
	position: { startIndex: number; endIndex: number };
	newText: string;
	changeType: ChangeType;
}

interface Token {
	kind: "word" | "sep";
	value: string;
	start: number; // UTF-16 code unit index in original string
	end: number; // exclusive
}

interface WordToken extends Token {
	kind: "word";
}

interface SepToken extends Token {
	kind: "sep";
}

type AnyToken = WordToken | SepToken;

// Words are letters, numbers, and marks; separators cover everything else (including punctuation, spaces)
const WORD_REGEX = /([\p{L}\p{N}\p{M}]+)|([^\p{L}\p{N}\p{M}]+)/gu;

function normalize(input: string): string {
	return input.normalize("NFC");
}

function tokenize(text: string): AnyToken[] {
	const normalized = normalize(text);
	const tokens: AnyToken[] = [];

	// Prefer Intl.Segmenter if available for word boundaries
	// We still need separators to preserve positions, so we reconstruct them.
	// Fallback to regex if Segmenter not available or throws.
	const useSegmenter = typeof (Intl as any).Segmenter !== "undefined";

	if (useSegmenter) {
		try {
			const segmenter = new (Intl as any).Segmenter(undefined, { granularity: "word" });
			const segments = Array.from(segmenter.segment(normalized)) as Array<{ segment: string; index: number; isWordLike?: boolean }>;

			let cursor = 0;
			for (const seg of segments) {
				const { segment, index } = seg;
				if (index > cursor) {
					// preceding separator
					tokens.push({ kind: "sep", value: normalized.slice(cursor, index), start: cursor, end: index });
				}
				const isWord = seg.isWordLike ?? /[\p{L}\p{N}\p{M}]/u.test(segment);
				tokens.push({ kind: isWord ? "word" : "sep", value: segment, start: index, end: index + segment.length } as AnyToken);
				cursor = index + segment.length;
			}
			if (cursor < normalized.length) {
				tokens.push({ kind: "sep", value: normalized.slice(cursor), start: cursor, end: normalized.length });
			}
			return tokens;
		} catch {
			// fallthrough to regex
		}
	}

	// Regex fallback: alternate word and separator chunks while tracking indices
	let match: RegExpExecArray | null;
	while ((match = WORD_REGEX.exec(normalized)) !== null) {
		const value = match[0];
		const start = match.index;
		const end = start + value.length;
		const isWord = /[\p{L}\p{N}\p{M}]/u.test(value);
		tokens.push({ kind: isWord ? "word" : "sep", value, start, end } as AnyToken);
	}

	return tokens;
}

function extractWords(tokens: AnyToken[]): WordToken[] {
	return tokens.filter((t): t is WordToken => t.kind === "word");
}

// Generic LCS over token values
function lcsIndicesTokens(a: AnyToken[], b: AnyToken[]): Array<[number, number]> {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			if (a[i].value === b[j].value) dp[i][j] = dp[i + 1][j + 1] + 1;
			else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i].value === b[j].value) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return pairs;
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const n = a.length;
	const m = b.length;
	if (n === 0) return m;
	if (m === 0) return n;

	const prev: number[] = new Array(m + 1);
	const curr: number[] = new Array(m + 1);
	for (let j = 0; j <= m; j++) prev[j] = j;
	for (let i = 1; i <= n; i++) {
		curr[0] = i;
		const ai = a.charCodeAt(i - 1);
		for (let j = 1; j <= m; j++) {
			const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		for (let j = 0; j <= m; j++) prev[j] = curr[j];
	}
	return prev[m];
}

function classifyChange(oldTokSlice: AnyToken[], newTokSlice: AnyToken[], oldSlice: string, newSlice: string): ChangeType {
	if (oldSlice.length === 0 && newSlice.length > 0) return "insert";
	if (newSlice.length === 0 && oldSlice.length > 0) return "delete";
	const oldWords = oldTokSlice.filter((t) => t.kind === "word");
	const newWords = newTokSlice.filter((t) => t.kind === "word");
	if (oldWords.length === 1 && newWords.length === 1) {
		const d = levenshtein(oldWords[0].value, newWords[0].value);
		const maxLen = Math.max(oldWords[0].value.length, newWords[0].value.length);
		if (d > 0 && d <= Math.max(2, Math.ceil(0.3 * maxLen))) return "spell-correction";
	}
	return "replace";
}

function sliceFromOriginal(original: string, start: number, end: number): string {
	return original.slice(start, end);
}

export function getTextDiffs(oldTextInput: string, newTextInput: string): TextDiff[] {
	const oldText = normalize(oldTextInput);
	const newText = normalize(newTextInput);

	if (oldText === newText) return [];

	const oldTokens = tokenize(oldText);
	const newTokens = tokenize(newText);

	// LCS over all tokens (words and separators) so punctuation/spacing changes are included
	const lcs = lcsIndicesTokens(oldTokens, newTokens);

	type ChangeRange = { oldTokStart: number; oldTokEnd: number; newTokStart: number; newTokEnd: number };
	const changes: ChangeRange[] = [];
	let prevOld = 0;
	let prevNew = 0;
	for (let k = 0; k <= lcs.length; k++) {
		const pair = lcs[k];
		const nextOld = pair ? pair[0] : oldTokens.length;
		const nextNew = pair ? pair[1] : newTokens.length;
		if (nextOld > prevOld || nextNew > prevNew) {
			changes.push({ oldTokStart: prevOld, oldTokEnd: nextOld, newTokStart: prevNew, newTokEnd: nextNew });
		}
		prevOld = nextOld + 1;
		prevNew = nextNew + 1;
	}

	// Build diffs from change ranges
	// Merge adjacent changes separated only by unchanged separators
	const mergedChanges: typeof changes = [];
	for (const ch of changes) {
		const last = mergedChanges[mergedChanges.length - 1];
		if (last) {
			const oldBetweenStart = last.oldTokEnd;
			const oldBetweenEnd = ch.oldTokStart;
			const newBetweenStart = last.newTokEnd;
			const newBetweenEnd = ch.newTokStart;

			const onlySepsBetweenOld = oldBetweenStart <= oldBetweenEnd ? oldTokens.slice(oldBetweenStart, oldBetweenEnd).every((t) => t.kind === "sep") : true;
			const onlySepsBetweenNew = newBetweenStart <= newBetweenEnd ? newTokens.slice(newBetweenStart, newBetweenEnd).every((t) => t.kind === "sep") : true;

			if (onlySepsBetweenOld && onlySepsBetweenNew) {
				last.oldTokEnd = ch.oldTokEnd;
				last.newTokEnd = ch.newTokEnd;
				continue;
			}
		}
		mergedChanges.push({ ...ch });
	}

	const diffs: TextDiff[] = [];
	for (const ch of mergedChanges) {
		const hasOld = ch.oldTokEnd > ch.oldTokStart;
		const hasNew = ch.newTokEnd > ch.newTokStart;

		let oldStart: number;
		let oldEnd: number;
		if (hasOld) {
			oldStart = oldTokens[ch.oldTokStart].start;
			oldEnd = oldTokens[ch.oldTokEnd - 1].end;
		} else {
			const leftIdx = ch.oldTokStart - 1;
			oldStart = leftIdx >= 0 ? oldTokens[leftIdx].end : 0;
			oldEnd = oldStart;
		}

		let newStart: number | undefined;
		let newEnd: number | undefined;
		if (hasNew) {
			newStart = newTokens[ch.newTokStart].start;
			newEnd = newTokens[ch.newTokEnd - 1].end;
		}

		const oldSlice = sliceFromOriginal(oldText, oldStart, oldEnd);
		const newSlice = hasNew ? sliceFromOriginal(newText, newStart!, newEnd!) : "";

		if (oldSlice === newSlice) continue;

		const changeType = classifyChange(oldTokens.slice(ch.oldTokStart, ch.oldTokEnd), newTokens.slice(ch.newTokStart, ch.newTokEnd), oldSlice, newSlice);

		diffs.push({
			oldText: oldSlice,
			position: { startIndex: oldStart, endIndex: oldEnd },
			newText: newSlice,
			changeType,
		});
	}

	return diffs;
}

export default {
	getTextDiffs,
};
