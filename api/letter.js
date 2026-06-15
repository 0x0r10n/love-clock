// Vercel serverless function: returns a fresh, original "code love letter" from
// Grok (xAI) as structured JSON. The browser assembles it into the page's
// Java-styled code spans, so the model never sends raw HTML.
//
// Required env var (set in Vercel -> Project -> Settings -> Environment Variables):
//   GROK_API_KEY   your xAI API key
// Optional:
//   GROK_MODEL     model id (default "grok-3")

// strip any dash, double quote, or angle bracket out of a text value
function cleanText(t) {
	return String(t == null ? "" : t)
		.replace(/[<>]/g, "")
		.replace(/["“”]/g, "")
		.replace(/[—–]/g, ",")
		.replace(/\s+-\s+/g, ", ")
		.replace(/\s*,\s*/g, ", ")
		.trim();
}
// a method name must be a single bare word (letters only)
function methodName(t, fallback) {
	return String(t == null ? "" : t).replace(/[^A-Za-z]/g, "") || fallback;
}

export default async function handler(req, res) {
	if (req.method !== "POST" && req.method !== "GET") {
		res.status(405).json({ error: "Method not allowed" });
		return;
	}

	const apiKey = process.env.GROK_API_KEY;
	if (!apiKey) {
		res.status(500).json({ error: "GROK_API_KEY is not set" });
		return;
	}

	// recently shown closing lines so we can ask Grok not to echo them
	let recent = [];
	try {
		const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
		if (Array.isArray(body.recent)) recent = body.recent.slice(-30);
	} catch (_) {}

	const avoid = recent.length
		? "Do not reuse, paraphrase, or closely echo any of these closing lines already shown:\n" +
		  recent.map((m) => "- " + m).join("\n")
		: "";

	const system =
		"You write a short, original, deeply romantic 'code love letter' from a man named shazar " +
		"to the woman he loves, Firdaous. It is rendered as stylized Java-like code, so you must return " +
		"ONLY a JSON object (no markdown, no code fences, no extra text) with these exact string fields:\n" +
		"- intro: array of 3 to 5 short poetic lines for the opening comment block (each 6 to 12 words, no leading asterisk)\n" +
		"- sinceComment: one line that begins with 'Since December 9, 2025,' celebrating her or your love\n" +
		"- actionComment: one short line praising something she does (6 to 12 words)\n" +
		"- actionMethod: a single lowercase verb for that action, one word, letters only (e.g. shine, create, inspire)\n" +
		"- traitComment1: one short line praising a virtuous trait, comparing her worth to something precious\n" +
		"- traitComment2: one short line continuing traitComment1\n" +
		"- loopMethods: array of exactly two lowercase verbs for how he loves her forever, one word each, letters only (e.g. honor, protect, cherish, adore)\n" +
		"- closeComment1: one short line of final praise\n" +
		"- closeComment2: a short punchy line such as 'Rare. Irreplaceable. Mine.'\n" +
		"- finalLine: one beautiful closing sentence addressed to Firdaous, 10 to 18 words\n" +
		"Rules: warm, sincere, poetic, and adoring, but never cheesy or generic. Make every letter brand new " +
		"and unlike any before. Never use a dash of any kind; use commas instead. Do not use double quotes " +
		"inside any value. Return ONLY the JSON object.";

	try {
		const r = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + apiKey,
			},
			body: JSON.stringify({
				model: process.env.GROK_MODEL || "grok-3",
				temperature: 1.1,
				max_tokens: 500,
				messages: [
					{ role: "system", content: system },
					{
						role: "user",
						content:
							"Write one brand-new code love letter as a JSON object for Firdaous, " +
							"completely unlike anything before. " + avoid,
					},
				],
			}),
		});

		if (!r.ok) {
			const detail = await r.text();
			res.status(502).json({ error: "Grok request failed", detail });
			return;
		}

		const data = await r.json();
		let raw = (data.choices?.[0]?.message?.content || "").trim();
		// tolerate code fences if the model adds them despite instructions
		raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

		let obj;
		try {
			obj = JSON.parse(raw);
		} catch (_) {
			res.status(502).json({ error: "Could not parse Grok JSON", raw });
			return;
		}

		// sanitize every field server-side as well (defense in depth)
		const intro = (Array.isArray(obj.intro) ? obj.intro : []).map(cleanText).filter(Boolean).slice(0, 5);
		const loop = Array.isArray(obj.loopMethods) ? obj.loopMethods : [];
		const letter = {
			intro,
			sinceComment: cleanText(obj.sinceComment),
			actionComment: cleanText(obj.actionComment),
			actionMethod: methodName(obj.actionMethod, "shine"),
			traitComment1: cleanText(obj.traitComment1),
			traitComment2: cleanText(obj.traitComment2),
			loopMethods: [methodName(loop[0], "honor"), methodName(loop[1], "protect")],
			closeComment1: cleanText(obj.closeComment1),
			closeComment2: cleanText(obj.closeComment2) || "Rare. Irreplaceable. Mine.",
			finalLine: cleanText(obj.finalLine),
		};

		if (intro.length < 2 || !letter.finalLine) {
			res.status(502).json({ error: "Incomplete letter from Grok", raw });
			return;
		}

		// no caching: we want a fresh letter each time it's called
		res.setHeader("Cache-Control", "no-store");
		res.status(200).json({ letter });
	} catch (err) {
		res.status(502).json({ error: "Grok request error", detail: String(err) });
	}
}
