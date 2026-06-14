// Vercel serverless function: returns a fresh, original love message from Grok (xAI).
// The API key lives only here on the server, never in the browser.
//
// Required env var (set in Vercel -> Project -> Settings -> Environment Variables):
//   GROK_API_KEY   your xAI API key
// Optional:
//   GROK_MODEL     model id (default "grok-3"); set to whatever your account has access to

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

	// recently shown lines so we can ask Grok not to echo them
	let recent = [];
	try {
		const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
		if (Array.isArray(body.recent)) recent = body.recent.slice(-40);
	} catch (_) {}

	const avoid = recent.length
		? "Do not reuse, paraphrase, or closely echo any of these lines already shown:\n" +
		  recent.map((m) => "- " + m).join("\n")
		: "";

	const system =
		"You write a single, original, deeply romantic and glorifying one-line love message. " +
		"It is from a man named shazar to the woman he loves, Firdaous, praising and exalting her. " +
		"Rules: " +
		"1) Exactly one sentence, between 10 and 16 words, so every message is about the same length. " +
		"2) Make it brand new, fresh, beautiful, and unlike anything written before. " +
		"3) Warm, sincere, poetic, and adoring, but never cheesy or generic. " +
		"4) Never use an em dash, en dash, or any dash of any kind; use commas instead. " +
		"5) No quotation marks, no emojis, no hashtags, no name signature. " +
		"6) Return ONLY the sentence itself, with no extra text, labels, or punctuation around it.";

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
				max_tokens: 80,
				messages: [
					{ role: "system", content: system },
					{
						role: "user",
						content:
							"Write one brand-new, beautiful, glorifying love message for Firdaous, " +
							"between 10 and 16 words, in exactly one sentence, completely unlike anything before. " +
							avoid,
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
		let message = (data.choices?.[0]?.message?.content || "").trim();
		// final safety pass in case the model slips: strip wrapping quotes, and turn any
		// em/en dash (or a dash used between words) into a comma, without harming
		// normal hyphenated words like "one-in-a-billion".
		message = message
			.replace(/^["'`]+|["'`]+$/g, "")   // wrapping quotes
			.replace(/[—–]/g, ",")              // em dash / en dash
			.replace(/\s+-\s+/g, ", ")          // spaced hyphen used as a dash
			.replace(/\s*,\s*/g, ", ")          // tidy any double spacing around commas
			.trim();

		if (!message) {
			res.status(502).json({ error: "Empty message from Grok" });
			return;
		}

		// no caching: we want a fresh line each time it's called
		res.setHeader("Cache-Control", "no-store");
		res.status(200).json({ message });
	} catch (err) {
		res.status(502).json({ error: "Grok request error", detail: String(err) });
	}
}
